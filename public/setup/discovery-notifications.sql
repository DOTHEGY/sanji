begin;
alter table public.sanji_discovery_config add column if not exists notify_completion boolean not null default false;
create table if not exists public.sanji_discovery_notifications (
 owner uuid not null references auth.users(id) on delete cascade,
 day date not null, status text not null default 'reserved' check(status in('reserved','accepted','failed','outcome_unknown')),
 snapshot jsonb not null, provider_id text, error text, created timestamptz not null default now(), updated timestamptz not null default now(),
 primary key(owner,day)
);
alter table public.sanji_discovery_notifications enable row level security;
revoke all on public.sanji_discovery_notifications from anon,authenticated;
grant select on public.sanji_discovery_notifications to authenticated;
grant all on public.sanji_discovery_notifications to service_role;
drop policy if exists discovery_notifications_owner on public.sanji_discovery_notifications;
create policy discovery_notifications_owner on public.sanji_discovery_notifications for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
create or replace function public.sanji_claim_discovery_notification(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.sanji_discovery_config;u public.sanji_discovery_usage;d date:=(now() at time zone 'Asia/Seoul')::date;recipient text;s jsonb;n integer;
begin
 select * into cfg from public.sanji_discovery_config where owner=p_owner and enabled and notify_completion;
 if not found or not exists(select 1 from public.sanji_members where user_id=p_owner) then return null;end if;
 select * into u from public.sanji_discovery_usage where owner=p_owner and day=d;
 if not found or u.companies<cfg.target then return null;end if;
 select email into recipient from auth.users where id=p_owner;
 if recipient is null or recipient!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null;end if;
 s:=jsonb_build_object('day',d,'recipient',recipient,'target',cfg.target,'companies',u.companies,'emails',u.emails,'processed',u.processed);
 insert into public.sanji_discovery_notifications(owner,day,snapshot) values(p_owner,d,s) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return null;end if;
 return s;
end $$;
revoke all on function public.sanji_claim_discovery_notification(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_discovery_notification(uuid) to service_role;
commit;
