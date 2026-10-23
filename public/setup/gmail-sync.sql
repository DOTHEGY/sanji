begin;
create table if not exists public.sanji_gmail_sync(owner uuid primary key references auth.users(id) on delete cascade,cursor integer not null default 0,lease_until timestamptz,last_checked timestamptz,result jsonb not null default '{}');
alter table public.sanji_gmail_sync enable row level security;
revoke all on public.sanji_gmail_sync from anon,authenticated;
grant all on public.sanji_gmail_sync to service_role;
commit;
create or replace function public.sanji_claim_gmail_sync(p_owner uuid) returns public.sanji_gmail_sync language plpgsql security definer set search_path='' as $$
declare r public.sanji_gmail_sync;
begin
 insert into public.sanji_gmail_sync(owner) values(p_owner) on conflict do nothing;
 update public.sanji_gmail_sync set lease_until=now()+interval '55 seconds' where owner=p_owner and (lease_until is null or lease_until<now()) returning * into r;
 return r;
end $$;
revoke all on function public.sanji_claim_gmail_sync(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_gmail_sync(uuid) to service_role;
