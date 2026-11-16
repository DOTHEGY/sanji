CREATE OR REPLACE FUNCTION public.sanji_youtube_manual_claim_due()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.sanji_youtube_manual_schedule;t uuid;
begin
 select * into s from public.sanji_youtube_manual_schedule where state='scheduled' and run_at<=clock_timestamp() order by run_at,batch_id for update skip locked limit 1;
 if not found then return null;end if;
 t:=gen_random_uuid();update public.sanji_youtube_manual_schedule set state='processing',claim_token=t,updated_at=clock_timestamp() where batch_id=s.batch_id;
 return jsonb_build_object('owner',s.owner,'batchId',s.batch_id,'approvalHash',s.approval_hash,'runAt',s.run_at,'token',t);
end $function$
;
CREATE OR REPLACE FUNCTION public.sanji_identities(p_data jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select array_remove(array[nullif(lower(p_data#>>'{contact,email}'),''),case when coalesce(p_data->>'companyKey','')<>'' then 'company:'||lower(p_data->>'companyKey') end,case when coalesce(p_data->>'handle','')<>'' then 'instagram:'||lower(p_data->>'handle') end,nullif(p_data->>'profile','')],null)
$function$
;