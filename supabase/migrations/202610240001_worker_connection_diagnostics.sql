begin;
alter table public.sanji_creator_config add column if not exists server_last_attempt timestamptz, add column if not exists server_reported_sender text, add column if not exists server_connection_issue text;
commit;
