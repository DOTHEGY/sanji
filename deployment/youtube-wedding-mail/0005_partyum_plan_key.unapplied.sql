-- Private Partyum signing credential; never emits key bytes; no activation.
begin;
do $guard$
begin
  if not exists (select 1 from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid=e.extnamespace
      where e.extname='pgcrypto' and n.nspname='extensions') then
    raise exception 'Expected preinstalled extensions.pgcrypto';
  end if;
  if not exists (select 1 from sanji_partyum_internal.partyum_runtime_controls
      where project_id='private-wedding-research' and not send_enabled for share) then
    raise exception 'Disable Partyum before installing its plan credential';
  end if;
end
$guard$;
create table sanji_partyum_internal.partyum_plan_key (
  project_id text primary key check(project_id='private-wedding-research'),
  material bytea not null check(pg_catalog.octet_length(material)=32)
);
alter table sanji_partyum_internal.partyum_plan_key enable row level security;
revoke all on table sanji_partyum_internal.partyum_plan_key from public, anon, authenticated, service_role;
grant select on table sanji_partyum_internal.partyum_plan_key to service_role;
insert into sanji_partyum_internal.partyum_plan_key(project_id,material)
values ('private-wedding-research',extensions.gen_random_bytes(32));
commit;
