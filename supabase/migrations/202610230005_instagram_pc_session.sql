begin;
alter table public.sanji_creator_config add column if not exists session_backup_enabled boolean not null default false;
create table if not exists public.sanji_instagram_pc_sessions(
 owner uuid not null references auth.users(id) on delete cascade,
 handle text not null check(handle~'^[a-z0-9._]{2,30}$'),
 encrypted text not null,checked timestamptz not null default now(),expires timestamptz not null,
 primary key(owner,handle)
);
alter table public.sanji_instagram_pc_sessions enable row level security;
revoke all on public.sanji_instagram_pc_sessions from public,anon,authenticated;
grant all on public.sanji_instagram_pc_sessions to service_role;
do $$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
  execute $schedule$select cron.schedule('sanji-pc-session-retention','23 * * * *','delete from public.sanji_instagram_pc_sessions where expires<now()')$schedule$;
 end if;
end $$;
commit;
