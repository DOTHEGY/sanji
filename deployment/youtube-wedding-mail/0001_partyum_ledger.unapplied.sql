-- Local, unapplied. Review in development before any authorized schema deployment.
begin;
create schema sanji_partyum_internal;
revoke all on schema sanji_partyum_internal from public, anon, authenticated;
grant usage on schema sanji_partyum_internal to service_role;
create table sanji_partyum_internal.worker_health (
  project_id text primary key check (project_id = 'private-wedding-research'),
  wake_ready boolean not null,
  checked_at timestamptz not null,
  cooldown_until timestamptz
);
create table sanji_partyum_internal.dispatch_rate_slots (
  project_id text not null check(project_id='private-wedding-research'),
  id uuid primary key,
  started_at timestamptz not null
);
create index partyum_dispatch_rate_slots_recent on sanji_partyum_internal.dispatch_rate_slots(project_id,started_at);
create table sanji_partyum_internal.batches (
  id uuid primary key,
  owner uuid not null,
  project_id text not null check (project_id = 'private-wedding-research'),
  day date not null,
  mode text not null check (mode in ('now','tomorrow')),
  run_at timestamptz not null,
  recipient_count integer not null check (recipient_count between 1 and 100),
  selection_digest text not null,
  copy_id uuid not null,
  copy_version integer not null check(copy_version>0),
  copy_digest text not null,
  sender_ref text not null,
  idempotency_key uuid not null,
  fingerprint text not null,
  admitted_at timestamptz not null default clock_timestamp(),
  unique(owner,project_id,idempotency_key),
  unique(owner,project_id,day,id)
);
create table sanji_partyum_internal.attempts (
  id uuid primary key,
  owner uuid not null,
  project_id text not null,
  day date not null,
  batch_id uuid not null,
  channel_id text not null check(channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  recipient text not null check(length(recipient) between 5 and 254 and recipient=lower(btrim(recipient))),
  recipient_key text not null check(length(recipient_key) between 5 and 254 and recipient_key=lower(btrim(recipient_key))),
  contact_revision text not null,
  state text not null check(state in ('queued','scheduled','claimed','dispatching','accepted','failed','unknown','review_required')),
  claim_id uuid,
  claim_expires_at timestamptz,
  intent_id uuid unique,
  dispatch_started_at timestamptz,
  provider_id text unique,
  provider_accepted_at timestamptz,
  state_at timestamptz not null default clock_timestamp(),
  constraint batch_identity foreign key(owner,project_id,day,batch_id)
    references sanji_partyum_internal.batches(owner,project_id,day,id),
  constraint evidence check (
    (state <> 'accepted' or (intent_id is not null and provider_id is not null and provider_accepted_at is not null))
    and (state <> 'dispatching' or (intent_id is not null and claim_id is not null))
    and ((intent_id is null) = (dispatch_started_at is null))
    and ((provider_id is null) = (provider_accepted_at is null))
    and (state='accepted' or (provider_id is null and provider_accepted_at is null))
  ),
  unique(owner,project_id,channel_id),
  unique(owner,project_id,recipient_key)
);
create index partyum_dispatch_rate on sanji_partyum_internal.attempts(project_id,dispatch_started_at) where intent_id is not null;
create index partyum_attempt_due on sanji_partyum_internal.attempts(project_id,state,state_at);
alter table sanji_partyum_internal.worker_health enable row level security;
alter table sanji_partyum_internal.batches enable row level security;
alter table sanji_partyum_internal.dispatch_rate_slots enable row level security;
alter table sanji_partyum_internal.attempts enable row level security;
revoke all on all tables in schema sanji_partyum_internal from public, anon, authenticated;
grant select,insert,update on all tables in schema sanji_partyum_internal to service_role;
grant delete on sanji_partyum_internal.dispatch_rate_slots to service_role;
commit;
