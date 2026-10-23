begin;
alter table public.sanji_creator_config
 add column if not exists server_worker_hash text unique,
 add column if not exists server_worker_expires timestamptz,
 add column if not exists server_enabled boolean not null default false,
 add column if not exists server_revision integer not null default 0,
 add column if not exists server_lease_owner uuid,
 add column if not exists server_lease_until timestamptz,
 add column if not exists server_runtime jsonb not null default '{}';
create or replace function public.sanji_creator_server_lease(p_owner uuid,p_instance uuid,p_sender text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.sanji_creator_config set server_lease_owner=p_instance,server_lease_until=now()+interval '120 seconds'
 where owner=p_owner and sender_handle=p_sender and server_enabled and server_worker_hash is not null and server_worker_expires>now() and (server_lease_owner=p_instance or server_lease_until is null or server_lease_until<now());
 return found;
end $$;
revoke all on function public.sanji_creator_server_lease(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sanji_creator_server_lease(uuid,uuid,text) to service_role;
-- The common claim RPC is service-only; both public handlers validate their separate keys first.
do $$ declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='sanji_claim_local_creator' and pronamespace='public'::regnamespace;
 if position('c.server_worker_hash' in definition)=0 then
  definition=replace(definition,'if c.worker_hash is null or c.worker_expires<now() then return null;end if;',
   'if not ((c.worker_hash is not null and c.worker_expires>now()) or (c.server_worker_hash is not null and c.server_worker_expires>now())) then return null;end if;');
  execute definition;
 end if;
end $$;
commit;
