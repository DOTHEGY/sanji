begin;
alter table public.sanji_discovery_config add column if not exists runtime jsonb not null default '{}';
commit;
