begin;
create table if not exists public.sanji_creator_config(
 owner uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,auto_send boolean not null default false,target integer not null default 500 check(target between 1 and 500),
 keywords jsonb not null default '["공동구매 레시피","공구 푸드","웰니스 크리에이터"]',dm_copy text not null default '',sender_handle text not null default '',
 approved_hash text not null default '',worker_hash text unique,worker_expires timestamptz,worker_seen timestamptz,worker_state text not null default 'not_connected',
 search_cursor integer not null default 0,last_search timestamptz,runtime jsonb not null default '{}',updated timestamptz not null default now());
create table if not exists public.sanji_creator_prospects(
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 handle text not null,profile text not null,name text not null default '',source_url text not null,excerpt text not null default '',checked timestamptz not null default now(),
 reasons jsonb not null default '[]',uncertainties jsonb not null default '["검색 색인 후보 · 팔로워·반응·최근 활동은 미확인"]',
 status text not null default 'new' check(status in('new','queued','sending','sent','failed','unknown','blocked','cancelled')),
 body text not null default '',approved_hash text not null default '',sender_handle text not null default '',
 claimed timestamptz,finished timestamptz,result jsonb not null default '{}',unique(owner,handle));
create index if not exists sanji_creator_queue on public.sanji_creator_prospects(owner,checked) where status='queued';
alter table public.sanji_creator_config enable row level security;
alter table public.sanji_creator_prospects enable row level security;
revoke all on public.sanji_creator_config,public.sanji_creator_prospects from anon,authenticated;
grant all on public.sanji_creator_config,public.sanji_creator_prospects to service_role;
-- No browser worker or cold-DM claim endpoint is enabled by this migration.
commit;
