-- Additive private primitives; does not create, activate, or execute any cron job.
begin;
create table sanji_partyum_internal.worker_pulses (
  project_id text not null check (project_id='private-wedding-research'),
  minute_bucket timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key(project_id,minute_bucket)
);
alter table sanji_partyum_internal.worker_pulses enable row level security;
revoke all on sanji_partyum_internal.worker_pulses from public, anon, authenticated;
grant select, update on sanji_partyum_internal.worker_pulses to service_role;

create table sanji_partyum_internal.copy_attestations (
  owner uuid not null,
  content_digest text not null check (content_digest ~ '^[A-Za-z0-9_-]{43}$'),
  decision_ref text not null check (length(decision_ref) between 1 and 240),
  approved_at timestamptz not null default clock_timestamp(),
  primary key(owner,content_digest)
);
alter table sanji_partyum_internal.copy_attestations enable row level security;
revoke all on sanji_partyum_internal.copy_attestations from public, anon, authenticated;
grant select on sanji_partyum_internal.copy_attestations to service_role;

create function sanji_partyum_internal.enqueue_worker_hint(p_endpoint text,p_gateway_public_key text)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
 t timestamptz;
 created integer;
 claims jsonb;
 b64 text;
 ref text;
begin
 -- The operator also verifies this is the same exact deployment project.
 if p_endpoint is null or p_endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/youtube-wedding-mail-worker$' then
  raise exception 'invalid Partyum worker destination';
 end if;
 -- Never accidentally publish a privileged secret or service-role key to pg_net.
 if p_gateway_public_key is null or length(p_gateway_public_key)>1024 then
  raise exception 'public Partyum gateway key required';
 elsif p_gateway_public_key ~ '^sb_publishable_[A-Za-z0-9_-]+$' then
  null; -- Same designated public project API key only; the gateway checks it.
 elsif p_gateway_public_key ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
  b64 := pg_catalog.translate(pg_catalog.split_part(p_gateway_public_key,'.',2),'-_','+/');
  claims := pg_catalog.convert_from(pg_catalog.decode(b64||pg_catalog.repeat('=',(4-length(b64)%4)%4),'base64'),'UTF8')::jsonb;
  ref := pg_catalog.substring(p_endpoint,9,20);
  if claims->>'role' is distinct from 'anon' or claims->>'iss' is distinct from 'supabase'
      or claims->>'ref' is distinct from ref
      or jsonb_typeof(claims->'exp') is distinct from 'number'
      or (claims->>'exp')::numeric <= extract(epoch from pg_catalog.clock_timestamp()) then
   raise exception 'role is not public anon for this project';
  end if;
 else
  raise exception 'public Partyum gateway key required';
 end if;
 t := pg_catalog.clock_timestamp();
 delete from sanji_partyum_internal.worker_pulses
  where expires_at < t - interval '5 minutes';
 insert into sanji_partyum_internal.worker_pulses(project_id,minute_bucket,expires_at)
  values('private-wedding-research',pg_catalog.date_trunc('minute',t),t+interval '35 seconds')
  on conflict(project_id,minute_bucket) do nothing;
 get diagnostics created = row_count;
 if created=1 then
  -- Untrusted hint only: the pg_net queue receives no capability, credential,
  -- owner, recipient, query, or message. Fresh private state is the capability.
  perform net.http_post(url:=p_endpoint, body:='{}'::jsonb,
   headers:=case when p_gateway_public_key ~ '^sb_publishable_' then
    pg_catalog.jsonb_build_object('Content-Type','application/json','X-Sanji-Partyum-Wake','native-v1','apikey',p_gateway_public_key)
    else pg_catalog.jsonb_build_object('Content-Type','application/json','X-Sanji-Partyum-Wake','native-v1','Authorization','Bearer '||p_gateway_public_key)
   end,
   timeout_milliseconds:=10000);
 end if;
end;
$$;
revoke all on function sanji_partyum_internal.enqueue_worker_hint(text,text) from public, anon, authenticated, service_role;
commit;
