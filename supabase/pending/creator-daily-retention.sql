begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Pending reviewed maintenance: no cron is registered here. Apply after base
-- daily outreach tables. API evidence is deleted, not merely hidden by the UI.
grant update(snapshot) on public.sanji_daily_outreach_candidates to service_role;
create function public.sanji_daily_outreach_sweep() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 -- API-derived identity/name may only enter this table with independent creator
 -- evidence. Those independent facts and send/dedup audit stay; raw API facts go.
 update public.sanji_daily_outreach_candidates set snapshot=(snapshot
  -array['audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt','apiSnapshot']::text[]
  -case when snapshot#>>'{mukbang,sourceUrl}'~*'^https://([^/]+\.)?(youtube\.com|youtu\.be|googleapis\.com)(/|$)' then array['mukbang']::text[] else '{}'::text[] end
  -case when snapshot#>'{apiSnapshot,titleFromApi}'='true'::jsonb and snapshot#>'{displayNameEvidence,verified}' is distinct from 'true'::jsonb then array['name']::text[] else '{}'::text[] end
 )||jsonb_build_object('apiDataRemovedAt',clock_timestamp())
 where snapshot ? 'apiSnapshot' and (snapshot#>>'{apiSnapshot,expiresAt}')::timestamptz<=clock_timestamp();
 get diagnostics changed=row_count;
 return jsonb_build_object('preparedApiSnapshotsRemoved',changed);
end $$;
revoke all on function public.sanji_daily_outreach_sweep() from public,anon,authenticated,service_role;
grant execute on function public.sanji_daily_outreach_sweep() to service_role;
commit;
