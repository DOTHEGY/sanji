-- LOCAL REVIEW ONLY. Apply only after the independent YouTube ledger, ACL,
-- scheduler identity and the exact source have been reviewed. No cron is created.
begin;
create table public.sanji_youtube_manual_schedule (
 owner uuid not null references auth.users(id),batch_id uuid primary key,
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 run_at timestamptz not null,state text not null default 'scheduled' check(state in ('scheduled','processing','complete','held','outcome_unknown','cancelled')),
 claim_token uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(owner,batch_id) references public.sanji_youtube_manual_batches(owner,id)
);
alter table public.sanji_youtube_manual_schedule enable row level security;
revoke all on public.sanji_youtube_manual_schedule from public,anon,authenticated,service_role;
grant select on public.sanji_youtube_manual_schedule to service_role;

-- Only the confirmed snapshot's server-derived items are accepted by the
-- existing atomic reserve function. Explicit send time is validated on the server in KST.
create function public.sanji_youtube_manual_schedule_batch(p_owner uuid,p_batch uuid,p_approval text,p_items jsonb,p_expected_run_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.sanji_youtube_manual_batches;s public.sanji_youtube_manual_schedule;at_time timestamptz;items jsonb;
begin
 select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch for update;
 if not found or b.confirmed_by is distinct from p_owner or b.confirmed_at is null or b.approval_hash is distinct from p_approval then raise exception 'confirmed batch required';end if;
 select * into s from public.sanji_youtube_manual_schedule where owner=p_owner and batch_id=p_batch;
 if found then
  if s.approval_hash is distinct from p_approval or s.state<>'scheduled' or s.run_at is distinct from p_expected_run_at then raise exception 'schedule cannot be repeated';end if;
  items:=public.sanji_youtube_manual_reserve_batch(p_owner,p_batch,p_approval,p_items);
  return jsonb_build_object('runAt',s.run_at,'rows',items,'state',s.state);
 end if;
 if b.expires_at<=clock_timestamp() or not public.sanji_youtube_manual_batch_current(p_owner,p_batch) then raise exception 'review expired';end if;
 if b.review#>>'{scope,projectId}' is distinct from 'gs-bbangteojineunjip-chewy-bread' or coalesce(b.review#>>'{scope,day}','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(b.review->'entries') is distinct from 'array' then raise exception 'project scope required';end if;
 if exists(select 1 from jsonb_array_elements(b.review->'entries') e left join public.sanji_records r on r.id::text=e->>'id' and r.owner=p_owner and r.kind='candidate' where r.id is null or r.version is distinct from (e->>'version')::integer or (select count(*) from jsonb_array_elements(case when jsonb_typeof(r.data#>'{youtubeResearch,projects}')='array' then r.data#>'{youtubeResearch,projects}' else '[]'::jsonb end) p where p->>'id'=b.review#>>'{scope,projectId}')<>1 or (select count(*) from jsonb_array_elements(case when jsonb_typeof(r.data#>'{youtubeResearch,projects}')='array' then r.data#>'{youtubeResearch,projects}' else '[]'::jsonb end) p where p->>'id'=b.review#>>'{scope,projectId}' and coalesce(p->>'assignedDay',to_char((p->>'addedAt')::timestamptz at time zone 'Asia/Seoul','YYYY-MM-DD'))=b.review#>>'{scope,day}')<>1) then raise exception 'project scope changed';end if;
 at_time:=p_expected_run_at;
 if at_time is null or not isfinite(at_time) or at_time<=clock_timestamp() or (at_time at time zone 'Asia/Seoul')::time<>time '10:00:00' then raise exception 'schedule time must be a future 10:00 Asia/Seoul';end if;
 -- Revalidation still runs at dispatch. This extension is not a send grant.
 update public.sanji_youtube_manual_batches set expires_at=at_time+interval '24 hours' where owner=p_owner and id=p_batch;
 items:=public.sanji_youtube_manual_reserve_batch(p_owner,p_batch,p_approval,p_items);
 insert into public.sanji_youtube_manual_schedule(owner,batch_id,approval_hash,run_at) values(p_owner,p_batch,p_approval,at_time);
 return jsonb_build_object('runAt',at_time,'rows',items,'state','scheduled');
end $$;
revoke all on function public.sanji_youtube_manual_schedule_batch(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_schedule_batch(uuid,uuid,text,jsonb,timestamptz) to service_role;

-- No client can cause a mail grant before the server's time and a worker claim.
alter function public.sanji_youtube_manual_claim(uuid,uuid,text,text) rename to sanji_youtube_manual_claim_internal;
revoke all on function public.sanji_youtube_manual_claim_internal(uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.sanji_youtube_manual_claim(p_owner uuid,p_id uuid,p_approval text,p_payload text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 raise exception 'worker token required';
end $$;
revoke all on function public.sanji_youtube_manual_claim(uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.sanji_youtube_manual_claim_scheduled(p_owner uuid,p_id uuid,p_approval text,p_payload text,p_scheduler_token uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sanji_youtube_manual_ledger l join public.sanji_youtube_manual_schedule s on s.owner=l.owner and s.batch_id=l.batch_id where l.owner=p_owner and l.id=p_id and s.approval_hash=p_approval and s.state='processing' and s.claim_token=p_scheduler_token and s.run_at<=clock_timestamp()) then raise exception 'not due or invalid worker token';end if;
 return public.sanji_youtube_manual_claim_internal(p_owner,p_id,p_approval,p_payload);
end $$;
revoke all on function public.sanji_youtube_manual_claim_scheduled(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_claim_scheduled(uuid,uuid,text,text,uuid) to service_role;
alter function public.sanji_youtube_manual_cancel_pending(uuid,uuid) rename to sanji_youtube_manual_cancel_pending_internal;
revoke all on function public.sanji_youtube_manual_cancel_pending_internal(uuid,uuid) from public,anon,authenticated,service_role;
create function public.sanji_youtube_manual_cancel_pending(p_owner uuid,p_batch uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 n:=public.sanji_youtube_manual_cancel_pending_internal(p_owner,p_batch);
 update public.sanji_youtube_manual_schedule set state='cancelled',updated_at=clock_timestamp() where owner=p_owner and batch_id=p_batch and state='scheduled';
 return n;
end $$;
revoke all on function public.sanji_youtube_manual_cancel_pending(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_cancel_pending(uuid,uuid) to service_role;

-- A worker may claim each batch once. A crash stays processing/unknown and is
-- never automatically made runnable again. No user-supplied owner is accepted.
create function public.sanji_youtube_manual_claim_due() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sanji_youtube_manual_schedule;t uuid;
begin
 select * into s from public.sanji_youtube_manual_schedule where state='scheduled' and run_at<=clock_timestamp() order by run_at,batch_id for update skip locked limit 1;
 if not found then return null;end if;
 t:=gen_random_uuid();update public.sanji_youtube_manual_schedule set state='processing',claim_token=t,updated_at=clock_timestamp() where batch_id=s.batch_id;
 return jsonb_build_object('owner',s.owner,'batchId',s.batch_id,'approvalHash',s.approval_hash,'runAt',s.run_at,'token',t);
end $$;
revoke all on function public.sanji_youtube_manual_claim_due() from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_claim_due() to service_role;
-- Continue only after all already-attempted rows have a definite accepted or
-- cancelled state; a crash or uncertain provider response cannot be retried.
create function public.sanji_youtube_manual_continue_schedule(p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare s public.sanji_youtube_manual_schedule;result text;
begin
 select * into s from public.sanji_youtube_manual_schedule where claim_token=p_token and state='processing' for update;
 if not found then raise exception 'claim unavailable';end if;
 if exists(select 1 from public.sanji_youtube_manual_ledger where owner=s.owner and batch_id=s.batch_id and state not in ('accepted','cancelled','reserved')) then raise exception 'uncertain or held row';end if;
 result:=case when exists(select 1 from public.sanji_youtube_manual_ledger where owner=s.owner and batch_id=s.batch_id and state='reserved') then 'scheduled' else 'complete' end;
 update public.sanji_youtube_manual_schedule set state=result,claim_token=null,updated_at=clock_timestamp() where batch_id=s.batch_id;return result;
end $$;
revoke all on function public.sanji_youtube_manual_continue_schedule(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_continue_schedule(uuid) to service_role;
create function public.sanji_youtube_manual_finish_schedule(p_token uuid,p_result text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_result not in ('complete','held','outcome_unknown') then raise exception 'invalid result';end if;
 if p_result='complete' and exists(select 1 from public.sanji_youtube_manual_schedule s join public.sanji_youtube_manual_ledger l on l.owner=s.owner and l.batch_id=s.batch_id where s.claim_token=p_token and s.state='processing' and l.state not in ('accepted','cancelled')) then raise exception 'batch is not complete';end if;
 update public.sanji_youtube_manual_schedule set state=p_result,updated_at=clock_timestamp() where claim_token=p_token and state='processing';
 if not found then raise exception 'claim unavailable';end if;
end $$;
revoke all on function public.sanji_youtube_manual_finish_schedule(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_finish_schedule(uuid,text) to service_role;
commit;

