begin;
create table if not exists public.sanji_apify_creator_trials(
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id),
 status text not null default 'pending' check(status in('pending','running','complete','budget_exhausted','failed','submission_unknown','partial')),
 budget_usd numeric not null default 0.35 check(budget_usd>0 and budget_usd<=0.35),target int not null default 30 check(target between 1 and 30),
 queries jsonb not null default '["한국인 레시피","한국인 엄마","한국인 공구"]',runs jsonb not null default '[]',
 accepted int not null default 0,reviewed int not null default 0,excluded jsonb not null default '[]',cost_usd numeric not null default 0,
 lease_until timestamptz,created timestamptz not null default now(),updated timestamptz not null default now(),error text not null default '');
alter table public.sanji_apify_creator_trials drop constraint if exists sanji_apify_creator_trials_status_check;
alter table public.sanji_apify_creator_trials add constraint sanji_apify_creator_trials_status_check check(status in('pending','running','complete','budget_exhausted','failed','submission_unknown','partial'));
create unique index if not exists sanji_apify_one_active on public.sanji_apify_creator_trials(owner) where status in('pending','running','submission_unknown');
alter table public.sanji_apify_creator_trials enable row level security;
revoke all on public.sanji_apify_creator_trials from public,anon,authenticated;
grant all on public.sanji_apify_creator_trials to service_role;
commit;
