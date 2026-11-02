-- Collector snapshots are owner-bound aggregate evidence, never collector controls.
create table if not exists public.sanji_dot_snapshot (
 owner uuid not null references public.sanji_members(user_id),
 snapshot_id text not null, ledger_generation_id text not null, revision text not null,
 day date not null, source_as_of timestamptz not null, exported_at timestamptz not null,
 received_at timestamptz not null default now(), payload jsonb not null,
 primary key(owner,snapshot_id), unique(owner,day,ledger_generation_id,revision)
);
create table if not exists public.sanji_dot_snapshot_head (
 owner uuid not null references public.sanji_members(user_id), day date not null,
 snapshot_id text not null, primary key(owner,day),
 foreign key(owner,snapshot_id) references public.sanji_dot_snapshot(owner,snapshot_id)
);
alter table public.sanji_dot_snapshot enable row level security;
alter table public.sanji_dot_snapshot_head enable row level security;
revoke all on public.sanji_dot_snapshot,public.sanji_dot_snapshot_head from public,anon,authenticated,service_role;
grant select on public.sanji_dot_snapshot,public.sanji_dot_snapshot_head to service_role;
create or replace function public.sanji_store_dot_snapshot(p_owner uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.sanji_dot_snapshot%rowtype; existing public.sanji_dot_snapshot%rowtype; d date; sid text; gen text; rev text; src timestamptz; exp timestamptz; k text; before_time timestamptz; after_time timestamptz; before_quality text; after_quality text; before_rank integer; after_rank integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음'; end if;
 d:=(p_data->>'day')::date; sid:=p_data->>'snapshot_id'; gen:=p_data->>'ledger_generation_id'; rev:=p_data->>'revision'; src:=(p_data->>'source_as_of')::timestamptz; exp:=(p_data->>'exported_at')::timestamptz;
 if sid is null or gen is null or rev is null or rev='' or d is null or src is null or exp is null or src>exp or exp>now()+interval '5 minutes' then raise exception '잘못된 스냅샷'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||d::text,746));
 select * into existing from public.sanji_dot_snapshot where owner=p_owner and snapshot_id=sid;
 if found then
  if (existing.payload - 'exported_at')=(p_data - 'exported_at') then return jsonb_build_object('duplicate',true,'received_at',existing.received_at); end if;
  raise exception '스냅샷 ID가 다른 내용에 이미 사용되었습니다';
 end if;
 select s.* into old from public.sanji_dot_snapshot_head h join public.sanji_dot_snapshot s on s.owner=h.owner and s.snapshot_id=h.snapshot_id where h.owner=p_owner and h.day=d;
 if found then
  if src<old.source_as_of or exp<old.exported_at then raise exception '오래된 스냅샷입니다'; end if;
  if gen=old.ledger_generation_id and src=old.source_as_of and exp<=old.exported_at then raise exception '이전 내보내기입니다'; end if;
  if gen=old.ledger_generation_id and src=old.source_as_of then
   -- A newer export may add audit/login/coverage evidence, but must not roll back evidence.
   before_time:=nullif(old.payload->>'last_profile_observed_at','')::timestamptz; after_time:=nullif(p_data->>'last_profile_observed_at','')::timestamptz;
   if before_time is not null and (after_time is null or after_time<before_time) then raise exception '이전 프로필 관찰입니다'; end if;
   foreach k in array array['login','database_audit'] loop
    before_time:=nullif(old.payload->k->>'observed_at','')::timestamptz;
    after_time:=nullif(p_data->k->>'observed_at','')::timestamptz;
    if before_time is not null and (after_time is null or after_time<before_time) then raise exception '이전 보완 관찰입니다'; end if;
    if before_time is not null and after_time=before_time and old.payload->k is distinct from p_data->k then
     if k<>'login' or ((old.payload->k) - 'stale' - 'current_state') is distinct from ((p_data->k) - 'stale' - 'current_state') or coalesce((p_data->k->>'stale')::boolean,false) is not true or (p_data->k->>'current_state') is distinct from 'unknown' then raise exception '같은 시각에 상충하는 보완 관찰입니다'; end if;
    end if;
   end loop;
   foreach k in array array['checked_attempts','unique_handles','outcomes','usage_cost'] loop
    before_quality:=coalesce(old.payload->'coverage'->k->>'status',old.payload->'coverage'->k->>'quality',old.payload->'coverage'->>k,'unavailable');
    after_quality:=coalesce(p_data->'coverage'->k->>'status',p_data->'coverage'->k->>'quality',p_data->'coverage'->>k,'unavailable');
    before_rank:=case before_quality when 'complete' then 2 when 'partial' then 1 else 0 end;
    after_rank:=case after_quality when 'complete' then 2 when 'partial' then 1 else 0 end;
    if after_rank<before_rank then raise exception '지표 근거가 이전 상태로 되돌아갑니다'; end if;
   end loop;
  end if;
  if gen<>old.ledger_generation_id and (src<=old.source_as_of or exists(select 1 from public.sanji_dot_snapshot where owner=p_owner and day=d and ledger_generation_id=gen)) then raise exception '이전 원장 세대입니다'; end if;
 end if;
 insert into public.sanji_dot_snapshot(owner,snapshot_id,ledger_generation_id,revision,day,source_as_of,exported_at,payload) values(p_owner,sid,gen,rev,d,src,exp,p_data);
 insert into public.sanji_dot_snapshot_head(owner,day,snapshot_id) values(p_owner,d,sid) on conflict(owner,day) do update set snapshot_id=excluded.snapshot_id;
 return jsonb_build_object('duplicate',false,'received_at',now());
end $$;
revoke all on function public.sanji_store_dot_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_store_dot_snapshot(uuid,jsonb) to service_role;
