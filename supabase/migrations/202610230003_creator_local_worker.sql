begin;
alter table public.sanji_creator_prospects add column if not exists profile_preview jsonb not null default '{}';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sanji-creator-previews','sanji-creator-previews',false,400000,array['image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.sanji_claim_local_creator(p_owner uuid,p_sender text,p_send boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sanji_creator_prospects;c public.sanji_creator_config;
begin
 perform pg_advisory_xact_lock(hashtextextended('creator-local:'||p_owner::text,0));
 select * into c from public.sanji_creator_config where owner=p_owner;
 if c.worker_hash is null or c.worker_expires<now() then return null;end if;
 update public.sanji_creator_prospects set status='unknown',finished=now(),result=result||'{"note":"PC 처리 응답 없음 · 전송 여부 미확인, 자동 재시도 안 함"}'::jsonb where owner=p_owner and status='sending' and claimed<now()-interval '30 minutes';
 if p_send and lower(c.sender_handle)=lower(p_sender) then
  select * into r from public.sanji_creator_prospects where owner=p_owner and status='queued' and sender_handle=p_sender and approved_hash<>'' order by checked for update skip locked limit 1;
  if found then
   if jsonb_array_length(coalesce(r.profile_preview->'businessEmails','[]'::jsonb))>0 or exists(select 1 from public.sanji_suppression where owner=p_owner and identity in ('instagram:'||r.handle,r.handle)) or exists(select 1 from public.sanji_records where owner=p_owner and kind='candidate' and lower(replace(data->>'handle','@',''))=r.handle and (data->>'status' in ('거절','수신 거부') or (data#>>'{contact,verified}'='true' and coalesce(data#>>'{contact,email}','')<>'') or exists(select 1 from public.sanji_outbox o where o.owner=p_owner and o.target=sanji_records.id and o.status in ('accepted','submitting','outcome_unknown')))) then
    update public.sanji_creator_prospects set status='blocked',result=result||'{"note":"수신 거부·기존 연락 이력 확인 필요"}'::jsonb where id=r.id;return null;
   end if;
   update public.sanji_creator_prospects set status='sending',claimed=now() where id=r.id;
   return jsonb_build_object('type','dm','id',r.id,'handle',r.handle,'body',r.body,'sender',r.sender_handle,'approvedHash',r.approved_hash);
  end if;
 end if;
 if (select count(*) from public.sanji_creator_prospects where owner=p_owner and (profile_preview->>'attempted')::timestamptz>=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')>=50 then return null;end if;
 select * into r from public.sanji_creator_prospects where owner=p_owner and (profile_preview->>'attempted' is null or (profile_preview->>'attempted')::timestamptz<now()-interval '7 days') order by checked desc for update skip locked limit 1;
 if not found then return null;end if;
 update public.sanji_creator_prospects set profile_preview=profile_preview||jsonb_build_object('attempted',now(),'status','checking') where id=r.id;
 return jsonb_build_object('type','profile','id',r.id,'handle',r.handle);
end $$;
revoke all on function public.sanji_claim_local_creator(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.sanji_claim_local_creator(uuid,text,boolean) to service_role;
commit;
