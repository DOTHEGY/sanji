-- Review candidate: preserve ACLs, do not backfill or touch existing records.
begin;
do $$ begin
 if to_regprocedure('public.sanji_youtube_manual_reserve(uuid,uuid,uuid,integer,text,text,text,text)') is null or to_regprocedure('public.sanji_youtube_manual_finish(uuid,uuid,uuid,text,text,text)') is null then raise exception 'expected existing functions missing'; end if;
end $$;
create or replace function public.sanji_youtube_manual_reserve(p_owner uuid,p_batch uuid,p_candidate uuid,p_version integer,p_email text,p_approval text,p_payload text,p_message_id text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.sanji_records; b public.sanji_youtube_manual_batches; k text; ch text; result uuid;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'membership required';end if;
 select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch and confirmed_at is not null and confirmed_by=p_owner and confirmation_version='manual_source_review_v1' and approval_hash=p_approval and expires_at>clock_timestamp() for update;
 if not found or not public.sanji_youtube_manual_batch_current(p_owner,p_batch) or not exists(select 1 from jsonb_array_elements(b.review->'entries') x where x->>'id'=p_candidate::text and (x->>'version')::integer=p_version and lower(x->>'email')=lower(trim(p_email))) then raise exception 'review confirmation required';end if;
 select * into c from public.sanji_records where id=p_candidate and owner=p_owner and kind='candidate' for update nowait;
  if c.id is null or c.version is distinct from p_version or c.data->>'kind' is distinct from '크리에이터' or coalesce(c.data->>'profile','') !~ '^https://(www\.)?youtube\.com/channel/UC[A-Za-z0-9_-]{22}/?$' then raise exception 'candidate verification failed';end if;
 k:=public.sanji_youtube_manual_email_key(p_email);if k is null then raise exception 'invalid email';end if;
 if not (lower(coalesce(c.data#>>'{contact,email}',''))=lower(trim(p_email)) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.data#>'{youtubeResearch,businessContacts}')='array' then c.data#>'{youtubeResearch,businessContacts}' else '[]'::jsonb end) x where lower(x->>'email')=lower(trim(p_email)))) then raise exception 'email not in candidate';end if;
 if coalesce(c.data->>'status','') in ('상대방 거절','우리 측 거절','제외') or public.sanji_blocked(p_owner,c.data) or public.sanji_youtube_manual_refused(p_owner,k,c.id) then raise exception 'recipient blocked';end if;
 ch:=regexp_replace(c.data->>'profile','^https://(www\.)?youtube\.com/channel/(UC[A-Za-z0-9_-]{22})/?$','\2');
 insert into public.sanji_youtube_manual_ledger(owner,batch_id,candidate_id,candidate_version,channel,email,email_key,approval_hash,payload_hash,message_id) values(p_owner,p_batch,p_candidate,p_version,ch,lower(trim(p_email)),k,p_approval,p_payload,p_message_id) returning id into result;
 return result;
end $$;
create or replace function public.sanji_youtube_manual_finish(p_owner uuid,p_id uuid,p_token uuid,p_result text,p_provider_id text default null,p_provider_thread text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.sanji_youtube_manual_ledger;b public.sanji_youtube_manual_batches;snap public.sanji_daily_campaign_snapshots;entry jsonb;d jsonb;o uuid;t uuid;
begin
 if p_result not in ('accepted','outcome_unknown','held') or (p_result='accepted' and (coalesce(p_provider_id,'') !~ '^[A-Za-z0-9_-]{1,200}$' or coalesce(p_provider_thread,'') !~ '^[A-Za-z0-9_-]{1,200}$')) then raise exception 'invalid outcome';end if;
 select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and id=p_id and claim_token=p_token and ((state='sending' and p_result='held') or (state='granted' and p_result in ('accepted','outcome_unknown'))) for update;
 if not found then raise exception 'invalid claim';end if;
 if p_result='accepted' then
  select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=r.batch_id;
  select * into snap from public.sanji_daily_campaign_snapshots where owner=p_owner and id=b.snapshot_id and sha256=b.snapshot_hash;
  select value into entry from jsonb_array_elements(b.review->'entries') where value->>'id'=r.candidate_id::text and value->>'email'=r.email;
  if b.id is null or snap.id is null or entry is null or entry->>'channel' is distinct from r.channel then raise exception 'receipt source missing';end if;
  if coalesce(b.review#>>'{scope,projectId}','')='' then raise exception 'project provenance missing';end if;
  d:=jsonb_build_object('projectId',b.review#>>'{scope,projectId}','channel','email','proposalType','youtube_manual_campaign','target',r.candidate_id,'platform','youtube','creatorKey','youtube:'||r.channel,'email',r.email,'emails',jsonb_build_array(r.email),'subject',entry->>'subject','body',entry->>'body','signatureText',snap.data#>>'{signature,text}','signatureHtml',snap.data#>>'{signature,html}','senderName',snap.data#>>'{signature,senderName}','senderEmail',b.review->>'sender','messageId',r.message_id,'marketing',false,'tracking',jsonb_build_object('enabled',false),'attachments','[]'::jsonb,'rawHash',r.payload_hash,'providerId',p_provider_id,'providerThread',p_provider_thread,'manualBatchId',b.id);
  insert into public.sanji_outbox(owner,target,channel,fingerprint,status,data) values(p_owner,r.candidate_id,'email',p_owner::text||':youtube-manual:'||r.channel,'accepted',d) returning id into o;
  insert into public.sanji_records(owner,kind,data) values(p_owner,'thread',jsonb_build_object('projectId',b.review#>>'{scope,projectId}','target',r.candidate_id,'platform','youtube','creatorKey','youtube:'||r.channel,'channel','email','subject',entry->>'subject','providerId',p_provider_thread,'next','회신 대기','classification','미분류','messages',jsonb_build_array(jsonb_build_object('id',p_provider_id,'messageId','<'||r.message_id||'@sanji.local>','outboxId',o,'out',true,'text',entry->>'body','at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'status','accepted')))) returning id into t;
 end if;
 update public.sanji_youtube_manual_ledger set state=p_result,provider_id=case when p_result='accepted' then p_provider_id else null end,provider_thread=case when p_result='accepted' then p_provider_thread else null end,outbox_id=o,thread_id=t,claim_token=null,updated_at=clock_timestamp() where id=r.id;
end $$;
revoke all on function public.sanji_youtube_manual_reserve(uuid,uuid,uuid,integer,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.sanji_youtube_manual_finish(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_finish(uuid,uuid,uuid,text,text,text) to service_role;
commit;
