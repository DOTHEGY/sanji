begin;
create table if not exists public.sanji_jobs(
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 draft_id uuid not null unique,preview_hash text not null,run_at timestamptz not null,
 status text not null default 'queued' check(status in('queued','processing','completed','failed','cancelled','outcome_unknown')),
 attempts integer not null default 0,approved_at timestamptz not null default now(),claimed_at timestamptz,
 result jsonb not null default '{}',created timestamptz not null default now()
);
create index if not exists sanji_jobs_due on public.sanji_jobs(run_at) where status='queued';
alter table public.sanji_jobs enable row level security;
drop policy if exists sanji_jobs_read on public.sanji_jobs;
create policy sanji_jobs_read on public.sanji_jobs for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
revoke all on public.sanji_jobs from anon,authenticated;
grant select on public.sanji_jobs to authenticated;
grant all on public.sanji_jobs to service_role;
create or replace function public.sanji_schedule_dispatch(p_owner uuid,p_draft uuid,p_hash text,p_run_at timestamptz) returns public.sanji_jobs language plpgsql security definer set search_path='' as $$
declare d public.sanji_drafts;t public.sanji_records;j public.sanji_jobs;v jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 if p_run_at<now() or p_run_at>now()+interval '30 days' then raise exception '예약은 현재부터 30일 이내입니다.';end if;
 select * into d from public.sanji_drafts where id=p_draft and owner=p_owner for update;
 if not found or d.used or d.expires<now() or d.hash<>p_hash then raise exception '미리보기가 만료되었거나 승인 해시가 다릅니다.';end if;
 if d.data->>'channel'<>'email' then raise exception '예약 자동 발송은 이메일만 지원합니다. Instagram 신규 DM은 수동 발송입니다.';end if;
 if coalesce((d.data->>'marketing')::boolean,true) and (extract(hour from p_run_at at time zone 'Asia/Seoul')<8 or extract(hour from p_run_at at time zone 'Asia/Seoul')>=21) then raise exception '광고성 이메일은 한국시간 08~21시에 예약하세요.';end if;
 select * into t from public.sanji_records where id=(d.data->>'target')::uuid and owner=p_owner and kind='candidate';
 if not found or t.version<>(d.data->>'targetVersion')::integer or public.sanji_blocked(p_owner,t.data) then raise exception '후보가 변경됐거나 거절·수신 거부 대상입니다.';end if;
 for v in select * from jsonb_array_elements(d.data->'dealVersions') loop
 if not exists(select 1 from public.sanji_records where id=(v->>'id')::uuid and owner=p_owner and version=(v->>'version')::integer and kind='deal' and data->>'state'='확정') then raise exception '상품 조건 변경. 다시 미리보기를 승인하세요.';end if;end loop;
 if coalesce(d.data->>'replyTo','')='' and (exists(select 1 from public.sanji_outbox where owner=p_owner and target=t.id) or exists(select 1 from public.sanji_jobs q join public.sanji_drafts qd on qd.id=q.draft_id where q.owner=p_owner and q.status in('queued','processing') and qd.data->>'target'=t.id::text) or exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and data->>'target'=t.id::text)) then raise exception '같은 대상에게 기존 연락 또는 승인 예약이 있습니다.';end if;
 update public.sanji_drafts set expires=p_run_at+interval '24 hours' where id=d.id;
 insert into public.sanji_jobs(owner,draft_id,preview_hash,run_at) values(p_owner,p_draft,p_hash,p_run_at) returning * into j;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'dispatch_scheduled',jsonb_build_object('job',j.id,'previewHash',p_hash,'runAt',p_run_at));return j;
end $$;
revoke all on function public.sanji_schedule_dispatch(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sanji_schedule_dispatch(uuid,uuid,text,timestamptz) to service_role;
create or replace function public.sanji_claim_job() returns setof public.sanji_jobs language plpgsql security definer set search_path='' as $$
begin
 return query update public.sanji_jobs set status='processing',claimed_at=now(),attempts=attempts+1
 where id=(select id from public.sanji_jobs where status='queued' and run_at<=now() order by run_at for update skip locked limit 1) returning *;
end $$;
revoke all on function public.sanji_claim_job() from public,anon,authenticated;
grant execute on function public.sanji_claim_job() to service_role;
create or replace function public.sanji_cancel_job(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 if not public.sanji_is_member() then raise exception '권한 없음';end if;
 update public.sanji_jobs set status='cancelled' where id=p_id and owner=auth.uid() and status='queued' returning draft_id into d;
 if not found then raise exception '이미 처리 중이거나 취소할 수 없는 예약입니다.';end if;
 update public.sanji_drafts set used=true where id=d and owner=auth.uid();
 insert into public.sanji_audit(owner,action,data) values(auth.uid(),'dispatch_cancelled',jsonb_build_object('job',p_id));
end $$;
revoke all on function public.sanji_cancel_job(uuid) from public,anon,authenticated;
grant execute on function public.sanji_cancel_job(uuid) to authenticated;
commit;
