begin;
create or replace function public.sanji_manage_thread(p_id uuid,p_version integer,p_data jsonb) returns public.sanji_records language plpgsql security definer set search_path='' as $$
declare t public.sanji_records;result public.sanji_records;c public.sanji_records;ident text; prior jsonb; meeting jsonb;
begin
 if not public.sanji_is_member() then raise exception '권한 없음' using errcode='42501';end if;
 select * into t from public.sanji_records where id=p_id and owner=auth.uid() and kind='thread' for update;
 if not found or t.version is distinct from p_version then raise exception '대화가 없거나 변경됐습니다.' using errcode='40001';end if;
 if p_data->>'classification' not in('미분류','자동 응답','관심 회신','단순 안내','거절','수신 거부','수락','공동구매 확정') then raise exception '회신 분류 오류';end if;
 update public.sanji_records set data=data||jsonb_build_object('owner',coalesce(p_data->>'owner',''),'next',coalesce(p_data->>'next',''),'due',coalesce(p_data->>'due',''),'classification',p_data->>'classification'),version=version+1,updated=now() where id=p_id returning * into result;
 if p_data->>'classification' in('거절','수신 거부') then
 select * into c from public.sanji_records where id=(t.data->>'target')::uuid and owner=auth.uid() and kind='candidate';
 if found then foreach ident in array public.sanji_identities(c.data) loop insert into public.sanji_suppression values(auth.uid(),ident,p_data->>'classification') on conflict(owner,identity) do update set reason=excluded.reason;end loop;
 update public.sanji_records set data=jsonb_set(data,'{status}',p_data->'classification'),version=version+1,updated=now() where id=c.id;end if;end if;
 if p_data ? 'meeting' then
  if not exists(select 1 from public.sanji_records where owner=auth.uid() and kind='candidate' and id::text=t.data->>'target') then raise exception '연결된 업체를 확인하세요.';end if;
  meeting:=p_data->'meeting';
  if jsonb_typeof(meeting)<>'object' or coalesce(meeting->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' or coalesce(meeting->>'mode','') not in ('비대면','대면','미확인') or coalesce(meeting->>'status','') not in ('예정','변경','완료','취소','미확인') or length(coalesce(meeting->>'result',''))>5000 then raise exception '미팅 날짜와 내용을 확인하세요.';end if;
  perform (meeting->>'at')::timestamptz;
  prior:=coalesce(t.data->'meeting','{}'::jsonb);
  meeting:=prior||jsonb_build_object('at',meeting->>'at','mode',meeting->>'mode','status',meeting->>'status','result',coalesce(meeting->>'result',''),'timezone','Asia/Seoul','source','operator_reported');
  update public.sanji_records set data=jsonb_set(jsonb_set(data,'{meeting}',meeting),'{meetingHistory}',coalesce(data->'meetingHistory','[]'::jsonb)||jsonb_build_array(jsonb_build_object('previous',prior,'updatedAt',now(),'source','operator_reported'))) where id=t.id returning * into result;
 end if;
 return result;
end $$;
commit;
