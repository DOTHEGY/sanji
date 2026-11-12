begin;
CREATE OR REPLACE FUNCTION public.sanji_youtube_manual_schedule_batch(p_owner uuid, p_batch uuid, p_approval text, p_items jsonb, p_expected_run_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.sanji_youtube_manual_batches;s public.sanji_youtube_manual_schedule;at_time timestamptz;items jsonb;
begin
 select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch for update;
 if not found or b.confirmed_by is distinct from p_owner or b.confirmed_at is null or b.approval_hash is distinct from p_approval then raise exception 'confirmed batch required';end if;
 select * into s from public.sanji_youtube_manual_schedule where owner=p_owner and batch_id=p_batch;
 if found then
  if s.approval_hash is distinct from p_approval or s.state<>'scheduled' or s.run_at is distinct from p_expected_run_at then raise exception 'schedule cannot be repeated';end if;
  items:=public.sanji_youtube_manual_reserve_batch(p_owner,p_batch,p_approval,p_items);
  return jsonb_build_object('runAt',s.run_at,'rows',items,'state',s.state);
 end if;
 if b.expires_at<=clock_timestamp() or not public.sanji_youtube_manual_batch_current(p_owner,p_batch) then raise exception 'review expired';end if;
 if b.review#>>'{scope,projectId}' is distinct from 'gs-bbangteojineunjip-chewy-bread' or coalesce(b.review#>>'{scope,day}','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(b.review->'entries') is distinct from 'array' then raise exception 'project scope required';end if;
 if exists(select 1 from jsonb_array_elements(b.review->'entries') e left join public.sanji_records r on r.id::text=e->>'id' and r.owner=p_owner and r.kind='candidate' where r.id is null or r.version is distinct from (e->>'version')::integer or (select count(*) from jsonb_array_elements(case when jsonb_typeof(r.data#>'{youtubeResearch,projects}')='array' then r.data#>'{youtubeResearch,projects}' else '[]'::jsonb end) p where p->>'id'=b.review#>>'{scope,projectId}')<>1 or (select count(*) from jsonb_array_elements(case when jsonb_typeof(r.data#>'{youtubeResearch,projects}')='array' then r.data#>'{youtubeResearch,projects}' else '[]'::jsonb end) p where p->>'id'=b.review#>>'{scope,projectId}' and coalesce(p->>'assignedDay',to_char((p->>'addedAt')::timestamptz at time zone 'Asia/Seoul','YYYY-MM-DD'))=b.review#>>'{scope,day}')<>1) then raise exception 'project scope changed';end if;
 at_time:=p_expected_run_at;
 if at_time is null or not isfinite(at_time) or at_time<=clock_timestamp() or (at_time at time zone 'Asia/Seoul')::time not in (time '10:00:00',time '15:00:00') then raise exception 'schedule time must be a future 10:00 or 15:00 Asia/Seoul';end if;
 -- Revalidation still runs at dispatch. This extension is not a send grant.
 update public.sanji_youtube_manual_batches set expires_at=at_time+interval '24 hours' where owner=p_owner and id=p_batch;
 items:=public.sanji_youtube_manual_reserve_batch(p_owner,p_batch,p_approval,p_items);
 insert into public.sanji_youtube_manual_schedule(owner,batch_id,approval_hash,run_at) values(p_owner,p_batch,p_approval,at_time);
 return jsonb_build_object('runAt',at_time,'rows',items,'state','scheduled');
end $function$
;
commit;
