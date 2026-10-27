begin;
create table if not exists public.sanji_creator_recovery_config (
 owner uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false, target integer not null default 30 check(target between 1 and 500),
 run_time time not null default '09:00', last_run_day date,
 daily_lookup_limit integer not null default 0 check(daily_lookup_limit between 0 and 500),
 retry_limit integer not null default 0 check(retry_limit between 0 and 5),
 paid_limit_usd numeric not null default 0 check(paid_limit_usd between 0 and 100), updated timestamptz not null default now()
);
create table if not exists public.sanji_creator_recovery (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 handle text not null check(handle ~ '^[a-z0-9._]{1,30}$'), source_id text not null, profile_url text not null,
 nickname text not null default '', followers bigint check(followers is null or followers>=0), category text not null default '',bio text not null default '',
 emails jsonb not null default '[]',email_status text not null default '아직 조회하지 않음', source_kind text not null,source_file text not null default '', source_created_at timestamptz, last_verified timestamptz,
 link_status text not null default 'needs_verification' check(link_status in ('source_confirmed','needs_verification','lookup_failed')), entity_type text not null default 'unknown' check(entity_type in ('unknown','creator_evidence','noncreator_suspected')),
 assessment text not null check(assessment in ('candidate','review','excluded')), reasons jsonb not null default '[]',
 status text not null default 'new' check(status in ('new','hold','excluded','contacted')),
 created timestamptz not null default now(),updated timestamptz not null default now(),unique(owner,handle),unique(owner,source_id)
);
create table if not exists public.sanji_creator_recommendations (
 owner uuid not null references auth.users(id) on delete cascade, creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 day date not null,created timestamptz not null default now(),primary key(owner,creator_id)
);
-- Source checkpoint contains no credentials. Provider access must be authorized separately.
create table if not exists public.sanji_creator_source_checkpoints (
 owner uuid not null references auth.users(id) on delete cascade, source_key text not null,
 cursor text, status text not null default 'paused', processed integer not null default 0,
 updated timestamptz not null default now(),primary key(owner,source_key)
);
alter table public.sanji_creator_source_checkpoints enable row level security;
revoke all on public.sanji_creator_source_checkpoints from public,anon,authenticated;
grant all on public.sanji_creator_source_checkpoints to service_role;
create or replace function public.sanji_creator_checkpoint_page(p_owner uuid,p_source text,p_expected text,p_next text,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare current_cursor text;n integer;
begin
 if p_source not in ('tagby_authorized_export') or not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>20 then raise exception 'invalid source or page';end if;
 insert into public.sanji_creator_source_checkpoints(owner,source_key) values(p_owner,p_source) on conflict do nothing;
 select cursor into current_cursor from public.sanji_creator_source_checkpoints where owner=p_owner and source_key=p_source for update;
 if current_cursor is distinct from p_expected then raise exception 'checkpoint changed';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'handle','') !~ '^[a-z0-9._]{1,30}$' or coalesce(x->>'source_id','')='' or coalesce(x->>'profile_url','') !~ '^https://(www\.)?instagram\.com/[a-z0-9._]+/?$' or lower(split_part(split_part(x->>'profile_url','instagram.com/',2),'/',1))<>lower(x->>'handle')) then raise exception 'unverified profile';end if;
 with ins as (insert into public.sanji_creator_recovery(owner,handle,source_id,profile_url,nickname,followers,category,source_kind,source_file,link_status,assessment,reasons) select p_owner,x->>'handle',x->>'source_id',x->>'profile_url',coalesce(x->>'nickname',''),case when coalesce(x->>'followers','') ~ '^[0-9]{1,12}$' then (x->>'followers')::bigint else null end,coalesce(x->>'category',''),'tagby_authorized_export','Tagby','source_confirmed','review','["태그바이 계정 유형·한국 활동·적합성 확인 필요"]'::jsonb from jsonb_array_elements(p_rows) x on conflict do nothing returning 1) select count(*) into n from ins;
 update public.sanji_creator_source_checkpoints set cursor=p_next,status=case when p_next is null then 'complete' else 'paused' end,processed=processed+jsonb_array_length(p_rows),updated=now() where owner=p_owner and source_key=p_source;
 return n;
end $$;
revoke all on function public.sanji_creator_checkpoint_page(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_checkpoint_page(uuid,text,text,text,jsonb) to service_role;
create index if not exists creator_recovery_selection on public.sanji_creator_recovery(owner,assessment,status,created);
create index if not exists creator_recovery_day on public.sanji_creator_recommendations(owner,day);
alter table public.sanji_creator_recovery_config enable row level security;
alter table public.sanji_creator_recovery enable row level security;
alter table public.sanji_creator_recommendations enable row level security;
revoke all on public.sanji_creator_recovery_config,public.sanji_creator_recovery,public.sanji_creator_recommendations from public,anon,authenticated;
grant all on public.sanji_creator_recovery_config,public.sanji_creator_recovery,public.sanji_creator_recommendations to service_role;
create or replace function public.sanji_creator_preview(p_owner uuid,p_target integer) returns setof public.sanji_creator_recovery language sql stable security definer set search_path='' as $$
 select c.* from public.sanji_creator_recovery c where c.owner=p_owner and c.assessment='candidate' and c.status='new' and p_target between 1 and 500 and exists(select 1 from public.sanji_members where user_id=p_owner) and not exists(select 1 from public.sanji_creator_recommendations r where r.owner=p_owner and r.creator_id=c.id) and not exists(select 1 from public.sanji_creator_prospects p where p.owner=p_owner and lower(ltrim(p.handle,'@'))=c.handle) and not exists(select 1 from public.sanji_records x where x.owner=p_owner and x.kind='candidate' and x.data->>'kind'='크리에이터' and lower(ltrim(coalesce(x.data->>'handle',''),'@'))=c.handle) order by c.created,c.id limit greatest(0,least(p_target,500));
$$;
revoke all on function public.sanji_creator_preview(uuid,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_preview(uuid,integer) to service_role;
create or replace function public.sanji_creator_recommend(p_owner uuid,p_day date,p_target integer) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; already integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_target not between 1 and 500 then raise exception 'invalid owner or target';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select count(*) into already from public.sanji_creator_recommendations r join public.sanji_creator_recovery c on c.id=r.creator_id and c.owner=r.owner where r.owner=p_owner and r.day=p_day and c.status='new';
 with choices as (select c.id from public.sanji_creator_recovery c where c.owner=p_owner and c.assessment='candidate' and c.status='new' and not exists(select 1 from public.sanji_creator_recommendations r where r.owner=p_owner and r.creator_id=c.id) and not exists(select 1 from public.sanji_creator_prospects p where p.owner=p_owner and lower(ltrim(p.handle,'@'))=c.handle) and not exists(select 1 from public.sanji_records x where x.owner=p_owner and x.kind='candidate' and x.data->>'kind'='크리에이터' and lower(ltrim(coalesce(x.data->>'handle',''),'@'))=c.handle) order by c.created,c.id limit greatest(0,p_target-already)),
 inserted as (insert into public.sanji_creator_recommendations(owner,creator_id,day) select p_owner,id,p_day from choices on conflict do nothing returning 1) select count(*) into n from inserted;
 return n;
end $$;
revoke all on function public.sanji_creator_recommend(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_recommend(uuid,date,integer) to service_role;
commit;
