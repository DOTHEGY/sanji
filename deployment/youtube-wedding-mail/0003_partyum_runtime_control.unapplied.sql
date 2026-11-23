-- Separate product gate; never enables mail during migration.
begin;
create table sanji_partyum_internal.partyum_runtime_controls (
  project_id text primary key check(project_id='private-wedding-research'),
  send_enabled boolean not null default false,
  changed_at timestamptz not null default clock_timestamp()
);
alter table sanji_partyum_internal.partyum_runtime_controls enable row level security;
revoke all on sanji_partyum_internal.partyum_runtime_controls from public, anon, authenticated, service_role;
grant select on sanji_partyum_internal.partyum_runtime_controls to service_role;
insert into sanji_partyum_internal.partyum_runtime_controls(project_id,send_enabled)
values('private-wedding-research',false);
commit;
