begin;
create table if not exists public.sanji_discovery_config (
 owner uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false, target integer not null default 30 check(target between 1 and 100),
 keywords jsonb not null default '["건강기능식품 유산균","건강식품 효소","건강식품 단백질","건강식품 견과","건강식품 올리브오일"]'::jsonb,
 updated timestamptz not null default now()
);
create table if not exists public.sanji_discovery_leads (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 identity text not null, data jsonb not null, status text not null default 'new' check(status in('new','review','imported','blocked')),
 created timestamptz not null default now(), updated timestamptz not null default now(), unique(owner,identity)
);
create table if not exists public.sanji_discovery_usage (
 owner uuid not null references auth.users(id) on delete cascade, day date not null,
 emails integer not null default 0, calls integer not null default 0, added integer not null default 0, processed integer not null default 0,
 lease_until timestamptz, last_error text not null default '', primary key(owner,day)
);
alter table public.sanji_discovery_config enable row level security;
alter table public.sanji_discovery_leads enable row level security;
alter table public.sanji_discovery_usage enable row level security;
revoke all on public.sanji_discovery_config,public.sanji_discovery_leads,public.sanji_discovery_usage from anon,authenticated;
grant select on public.sanji_discovery_config,public.sanji_discovery_leads,public.sanji_discovery_usage to authenticated;
grant all on public.sanji_discovery_config,public.sanji_discovery_leads,public.sanji_discovery_usage to service_role;
drop policy if exists discovery_config_owner on public.sanji_discovery_config;
create policy discovery_config_owner on public.sanji_discovery_config for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
drop policy if exists discovery_leads_owner on public.sanji_discovery_leads;
create policy discovery_leads_owner on public.sanji_discovery_leads for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
drop policy if exists discovery_usage_owner on public.sanji_discovery_usage;
create policy discovery_usage_owner on public.sanji_discovery_usage for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
create or replace function public.sanji_discovery_claim(p_owner uuid) returns public.sanji_discovery_usage language plpgsql security definer set search_path='' as $$
declare r public.sanji_discovery_usage; d date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '관리자 권한이 필요합니다.';end if;
 insert into public.sanji_discovery_usage(owner,day) values(p_owner,d) on conflict do nothing;
 update public.sanji_discovery_usage set calls=calls+1,lease_until=now()+interval '2 minutes' where owner=p_owner and day=d and (lease_until is null or lease_until<now()) and calls<160 returning * into r;
 return r;
end $$;
revoke all on function public.sanji_discovery_claim(uuid) from public,anon,authenticated;
grant execute on function public.sanji_discovery_claim(uuid) to service_role;
commit;
