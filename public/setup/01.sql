-- SANJI STEP 1 START
-- Run in the Supabase SQL editor as the project administrator.
-- Additive only: existing unrelated project tables are not modified.
begin;
create table if not exists public.sanji_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.sanji_members enable row level security;
drop policy if exists sanji_member_self on public.sanji_members;
create policy sanji_member_self on public.sanji_members for select to authenticated using(user_id=auth.uid());
grant select on public.sanji_members to authenticated;
create or replace function public.sanji_is_member() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.sanji_members where user_id=auth.uid())$$;
revoke all on function public.sanji_is_member() from public,anon,authenticated;
grant execute on function public.sanji_is_member() to authenticated;
create table if not exists public.sanji_records (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('candidate','deal','template','thread','settings')),
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object'),
 version integer not null default 1,updated timestamptz not null default now()
);
create index if not exists sanji_owner_kind on public.sanji_records(owner,kind);
create unique index if not exists sanji_company_unique on public.sanji_records(owner,lower(data->>'companyKey')) where kind='candidate' and coalesce(data->>'companyKey','')<>'';
create unique index if not exists sanji_handle_unique on public.sanji_records(owner,lower(data->>'handle')) where kind='candidate' and coalesce(data->>'handle','')<>'';
create unique index if not exists sanji_email_unique on public.sanji_records(owner,lower(data#>>'{contact,email}')) where kind='candidate' and coalesce(data#>>'{contact,email}','')<>'';
create unique index if not exists sanji_one_settings on public.sanji_records(owner) where kind='settings';
alter table public.sanji_records enable row level security;
drop policy if exists sanji_record_read on public.sanji_records;
create policy sanji_record_read on public.sanji_records for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_records to authenticated;
revoke insert,update,delete on public.sanji_records from anon,authenticated;
create table if not exists public.sanji_suppression(owner uuid not null references auth.users(id) on delete cascade,identity text not null,reason text not null,primary key(owner,identity));
alter table public.sanji_suppression enable row level security;
drop policy if exists sanji_suppression_read on public.sanji_suppression;
create policy sanji_suppression_read on public.sanji_suppression for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_suppression to authenticated;
create table if not exists public.sanji_audit(id bigint generated always as identity primary key,owner uuid not null references auth.users(id) on delete cascade,action text not null,data jsonb not null default '{}',created timestamptz not null default now());
alter table public.sanji_audit enable row level security;
drop policy if exists sanji_audit_read on public.sanji_audit;
create policy sanji_audit_read on public.sanji_audit for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_audit to authenticated;
create table if not exists public.sanji_connections(owner uuid not null references auth.users(id) on delete cascade,provider text not null,encrypted text not null,summary jsonb not null default '{}',primary key(owner,provider));
alter table public.sanji_connections enable row level security;
-- No browser read policies for OAuth tokens or pending authentication state.
create table if not exists public.sanji_oauth_states(state text primary key,owner uuid not null references auth.users(id) on delete cascade,provider text not null,verifier text not null,expires timestamptz not null);
alter table public.sanji_oauth_states enable row level security;
create table if not exists public.sanji_drafts(id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,data jsonb not null,hash text not null,expires timestamptz not null,used boolean not null default false);
alter table public.sanji_drafts enable row level security;
create table if not exists public.sanji_outbox(id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,target uuid not null,channel text not null,fingerprint text not null unique,status text not null,data jsonb not null,created timestamptz not null default now());
alter table public.sanji_outbox enable row level security;
drop policy if exists sanji_outbox_read on public.sanji_outbox;
create policy sanji_outbox_read on public.sanji_outbox for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_outbox to authenticated;
create table if not exists public.sanji_webhook_events(id text primary key,created timestamptz not null default now());
alter table public.sanji_webhook_events enable row level security;
revoke all on public.sanji_connections,public.sanji_oauth_states,public.sanji_drafts,public.sanji_webhook_events from anon,authenticated;
-- Service role is only used inside the Edge Function after verified user membership.
grant all on public.sanji_members,public.sanji_records,public.sanji_suppression,public.sanji_audit,public.sanji_connections,public.sanji_oauth_states,public.sanji_drafts,public.sanji_outbox,public.sanji_webhook_events to service_role;
grant usage,select on sequence public.sanji_audit_id_seq to service_role;
create or replace function public.sanji_identities(p_data jsonb) returns text[] language sql immutable set search_path='' as $$
 select array_remove(array[nullif(lower(p_data#>>'{contact,email}'),''),case when coalesce(p_data->>'companyKey','')<>'' then 'company:'||lower(p_data->>'companyKey') end,case when coalesce(p_data->>'handle','')<>'' then 'instagram:'||lower(p_data->>'handle') end,nullif(p_data->>'profile','')],null)
$$;
create or replace function public.sanji_blocked(p_owner uuid,p_data jsonb) returns boolean language sql stable security definer set search_path='' as $$select coalesce(p_data->>'status' in ('거절','수신 거부'),false) or exists(select 1 from public.sanji_suppression where owner=p_owner and identity=any(public.sanji_identities(p_data)))$$;
revoke all on function public.sanji_blocked(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_blocked(uuid,jsonb) to service_role;

commit;
-- SANJI STEP 1 COMPLETE
