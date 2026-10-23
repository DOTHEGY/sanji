-- Dedicated low-cost backlog validation. Reuse the existing authenticated discovery job internally;
-- no credential values are read into the client, returned, or copied to this source file.
begin;
select cron.schedule('sanji-contact-rechecks','*/2 * * * *',$job$
do $run$
declare task_command text;changed_command text;
begin
 update public.sanji_discovery_leads set data=data||jsonb_build_object('officialRecheckRequested',true),updated=now()
 where data->'officialRecheck'->>'status'='running' and (data->'officialRecheck'->>'checked')::timestamptz<now()-interval '10 minutes' and coalesce((data->'officialRecheck'->>'attempts')::integer,1)<2;
 update public.sanji_discovery_leads set data=data||jsonb_build_object('officialRecheckRequested',false,'officialRecheck',data->'officialRecheck'||jsonb_build_object('status','failed','error','작업 응답 없음 · 제한된 재시도 종료')),updated=now()
 where data->'officialRecheck'->>'status'='running' and (data->'officialRecheck'->>'checked')::timestamptz<now()-interval '10 minutes' and coalesce((data->'officialRecheck'->>'attempts')::integer,1)>=2;
 if not exists(select 1 from public.sanji_discovery_leads l join public.sanji_discovery_config c using(owner) where c.enabled and (l.data->>'officialRecheckRequested'='true' or l.data->'officialRecheck'->>'status'='running')) then
  perform cron.unschedule('sanji-contact-rechecks');return;
 end if;
 select command into task_command from cron.job where jobname='sanji-email-discovery' and active and position('/discovery/tick' in command)>0;
 if task_command is null then raise exception 'Existing discovery schedule missing';end if;
 changed_command=replace(task_command,'''{}''::jsonb','''{"task":"official_recheck"}''::jsonb');
 if changed_command=task_command then raise exception 'Expected discovery request body not found';end if;
 execute changed_command;
end $run$;
$job$);
commit;
