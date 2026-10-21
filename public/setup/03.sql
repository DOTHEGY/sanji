-- SANJI STEP 3 START
begin;
create or replace function public.sanji_manage_thread(p_id uuid,p_version integer,p_data jsonb) returns public.sanji_records language plpgsql security definer set search_path='' as $$
declare t public.sanji_records;result public.sanji_records;c public.sanji_records;ident text;
begin
 if not public.sanji_is_member() then raise exception '권한 없음' using errcode='42501';end if;
 select * into t from public.sanji_records where id=p_id and owner=auth.uid() and kind='thread' for update;
 if not found or t.version is distinct from p_version then raise exception '대화가 없거나 변경됐습니다.' using errcode='40001';end if;
 if p_data->>'classification' not in('미분류','자동 응답','관심 회신','단순 안내','거절','수신 거부','수락','공동구매 확정') then raise exception '회신 분류 오류';end if;
 update public.sanji_records set data=data||jsonb_build_object('owner',coalesce(p_data->>'owner',''),'next',coalesce(p_data->>'next',''),'due',coalesce(p_data->>'due',''),'classification',p_data->>'classification'),version=version+1,updated=now() where id=p_id returning * into result;
 if p_data->>'classification' in('거절','수신 거부') then
 select * into c from public.sanji_records where id=(t.data->>'target')::uuid and owner=auth.uid() and kind='candidate';
 if found then foreach ident in array public.sanji_identities(c.data) loop insert into public.sanji_suppression values(auth.uid(),ident,p_data->>'classification') on conflict(owner,identity) do update set reason=excluded.reason;end loop;
 update public.sanji_records set data=jsonb_set(data,'{status}',p_data->'classification'),version=version+1,updated=now() where id=c.id;end if;end if;return result;
end $$;
revoke all on function public.sanji_manage_thread(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_manage_thread(uuid,integer,jsonb) to authenticated;
create or replace function public.sanji_connection_status() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(provider,summary),'{}'::jsonb) from public.sanji_connections where owner=auth.uid() and public.sanji_is_member()
$$;
revoke all on function public.sanji_connection_status() from public,anon,authenticated;
grant execute on function public.sanji_connection_status() to authenticated;
create or replace function public.sanji_reserve_dispatch(p_owner uuid,p_draft uuid,p_hash text,p_fingerprint text) returns public.sanji_outbox language plpgsql security definer set search_path='' as $$
declare d public.sanji_drafts;t public.sanji_records;s public.sanji_records;v jsonb;lim integer;result public.sanji_outbox;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 select * into d from public.sanji_drafts where id=p_draft and owner=p_owner for update;
 if not found or d.used or d.expires<now() or d.hash<>p_hash then raise exception '승인 미리보기 만료 또는 중복';end if;
 select * into t from public.sanji_records where id=(d.data->>'target')::uuid and owner=p_owner and kind='candidate';
 if not found or t.version<>(d.data->>'targetVersion')::integer or public.sanji_blocked(p_owner,t.data) then raise exception '수신자가 변경됐거나 수신 거부 대상입니다.';end if;
 for v in select * from jsonb_array_elements(d.data->'dealVersions') loop
 if not exists(select 1 from public.sanji_records where id=(v->>'id')::uuid and owner=p_owner and kind='deal' and version=(v->>'version')::integer and data->>'state'='확정') then raise exception '상품 조건이 변경되었습니다.';end if;end loop;
 if coalesce(d.data->>'replyTo','')='' then
  if exists(select 1 from public.sanji_outbox where owner=p_owner and target=t.id) or exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and data->>'target'=t.id::text) then raise exception '기존 연락 이력이 있습니다. 기존 대화에서 회신하세요.';end if;
 else if not exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and id=(d.data->>'replyTo')::uuid and data->>'target'=t.id::text and data->>'channel'=d.data->>'channel') then raise exception '회신 대상 불일치';end if;end if;
 select * into s from public.sanji_records where owner=p_owner and kind='settings';lim:=coalesce((s.data->>'dailyLimit')::integer,20);
 if (select count(*) from public.sanji_outbox where owner=p_owner and created>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=lim then raise exception '일일 제한 초과';end if;
 update public.sanji_drafts set used=true where id=d.id;
 insert into public.sanji_outbox(owner,target,channel,fingerprint,status,data) values(p_owner,t.id,d.data->>'channel',p_fingerprint,'submitting',(d.data-'attachments')||jsonb_build_object('attachments',coalesce(d.data->'attachmentSummary','[]'::jsonb))) returning * into result;return result;
end $$;
revoke all on function public.sanji_reserve_dispatch(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sanji_reserve_dispatch(uuid,uuid,text,text) to service_role;
-- Private attachments bucket. Only members may read/write their own UUID prefix.
insert into storage.buckets(id,name,public,file_size_limit) values('sanji-attachments','sanji-attachments',false,5242880) on conflict(id) do nothing;
drop policy if exists sanji_storage_read on storage.objects;
create policy sanji_storage_read on storage.objects for select to authenticated using(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
drop policy if exists sanji_storage_insert on storage.objects;
create policy sanji_storage_insert on storage.objects for insert to authenticated with check(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
drop policy if exists sanji_storage_delete on storage.objects;
create policy sanji_storage_delete on storage.objects for delete to authenticated using(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
commit;

-- SANJI STEP 3 COMPLETE
