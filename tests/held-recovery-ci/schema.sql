-- SYNTHETIC fixture only; no production data.
create role anon;create role authenticated;create role service_role;
create table public.sanji_members(user_id uuid primary key);
create table public.sanji_records(id uuid primary key,owner uuid,kind text,version int,data jsonb);
create table public.sanji_youtube_manual_batches(id uuid primary key,owner uuid,confirmed_by uuid,confirmed_at timestamptz,approval_hash text,expires_at timestamptz,review jsonb);
create table public.sanji_youtube_manual_schedule(owner uuid,batch_id uuid primary key,approval_hash text,run_at timestamptz,state text,claim_token uuid,updated_at timestamptz);
create table public.sanji_youtube_manual_ledger(id uuid primary key,owner uuid,batch_id uuid,candidate_id uuid,candidate_version int,channel text,email text,email_key text,approval_hash text,payload_hash text,state text,claim_token uuid,provider_id text,provider_thread text,outbox_id uuid,thread_id uuid,message_id text,refusal_checked_at timestamptz,updated_at timestamptz);
create table public.fixture_block(kind text);
create table public.sanji_suppression(owner uuid,identity text);
create table public.sanji_connections(owner uuid,provider text,summary jsonb);
create table public.sanji_daily_campaign_policy(owner uuid,revision int,snapshot_id uuid,data jsonb);
create table public.sanji_daily_campaign_snapshots(owner uuid,id uuid,sha256 text,data jsonb);
alter table public.sanji_youtube_manual_batches add snapshot_id uuid,add snapshot_hash text,add settings_version int,add policy_revision int;
