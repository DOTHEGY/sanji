begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- PENDING ACTIVATION REVIEW ONLY: never apply or invoke without approval.
-- Read-only metadata verified 2026-11-09: this Vault NAME already belongs to the
-- existing isolated email runner. No secret value was read or copied here.
-- No new credential, broad Vault grant, cron or network invocation is executed by
-- creating this function. Function invocation DOES enqueue a worker HTTP request.
-- It remains fail-closed until an approved operator enables the runtime gates.
create function public.sanji_daily_supply_kick() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare runner_token text; request_id bigint;
begin
 -- Existing credential access must already be authorized for the invoker. This
 -- script deliberately grants no SELECT on vault.decrypted_secrets and no new
 -- network/schema privileges. Verify those separately before approved activation.
 select decrypted_secret into strict runner_token from vault.decrypted_secrets
 where name='sanji_approved_email_runner';
 if runner_token is null or length(runner_token)<32 then raise exception 'approved existing runner credential unavailable';end if;
 select net.http_post(
  url:='https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/creator-daily-outreach-worker/run',
  headers:=jsonb_build_object('Content-Type','application/json','x-job-token',runner_token),
  body:='{}'::jsonb,
  timeout_milliseconds:=180000
 ) into request_id;
 -- Acceptance is not completion or delivery. Poll authenticated run status;
 -- never include credentials/provider headers in automation output or prompts.
 return jsonb_build_object('accepted',true,'requestId',request_id,'completionVerified',false);
end $$;
revoke all on function public.sanji_daily_supply_kick() from public,anon,authenticated;
grant execute on function public.sanji_daily_supply_kick() to service_role;
commit;
