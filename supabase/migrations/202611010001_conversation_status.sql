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
 if p_data ? 'conversationStatus' then
  if coalesce(p_data->>'conversationStatus','') not in ('미정','대화 중','답변 대기','회신 중단','다른 제안 검토','상대방 거절','우리 측 거절','협업 진행','종료') then raise exception '대화 상태를 확인하세요.';end if;
  if coalesce(t.data->>'conversationStatus','미정') is distinct from p_data->>'conversationStatus' or coalesce(t.data->>'next','') is distinct from coalesce(p_data->>'next','') then
   update public.sanji_records set data=jsonb_set(jsonb_set(data,'{conversationStatus}',to_jsonb(p_data->>'conversationStatus')),'{conversationStatusHistory}',coalesce(data->'conversationStatusHistory','[]'::jsonb)||jsonb_build_array(jsonb_build_object('from',coalesce(t.data->>'conversationStatus','미정'),'to',p_data->>'conversationStatus','previousNote',coalesce(t.data->>'next',''),'note',coalesce(p_data->>'next',''),'updatedAt',now(),'source','operator_reported'))) where id=t.id returning * into result;
  end if;
 end if;
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

create table public.sanji_creator_conversation_status(owner uuid not null,mailbox text not null,creator_id uuid not null,provider_thread_id text not null,status text not null,note text not null default '',version int not null default 1,history jsonb not null default '[]'::jsonb,updated timestamptz not null default now(),primary key(owner,mailbox,creator_id,provider_thread_id));
alter table public.sanji_creator_conversation_status enable row level security;
revoke all on public.sanji_creator_conversation_status from public,anon,authenticated;
create function public.sanji_creator_conversation_list() returns setof public.sanji_creator_conversation_status language plpgsql security definer set search_path='' as $$
begin
 if not public.sanji_is_member() then raise exception '권한 없음' using errcode='42501';end if;
 return query select s.* from public.sanji_creator_conversation_status s where s.owner=auth.uid() and exists(select 1 from public.sanji_connections c where c.owner=s.owner and c.provider='gmail' and lower(c.summary->>'email')=s.mailbox);
end $$;
create function public.sanji_creator_conversation_save(p_creator uuid,p_thread text,p_version int,p_status text,p_note text) returns public.sanji_creator_conversation_status language plpgsql security definer set search_path='' as $$
declare v_mailbox text;old public.sanji_creator_conversation_status;result public.sanji_creator_conversation_status;
begin
 if not public.sanji_is_member() then raise exception '권한 없음' using errcode='42501';end if;
 if coalesce(p_status,'') not in ('미정','대화 중','답변 대기','회신 중단','다른 제안 검토','상대방 거절','우리 측 거절','협업 진행','종료') or length(coalesce(p_note,''))>5000 or coalesce(length(p_thread),0) not between 1 and 300 then raise exception '상태 또는 메모를 확인하세요.';end if;
 select lower(summary->>'email') into v_mailbox from public.sanji_connections where owner=auth.uid() and provider='gmail';
 if coalesce(v_mailbox,'')='' or not exists(select 1 from public.sanji_creator_inbound_messages where owner=auth.uid() and sanji_creator_inbound_messages.mailbox=v_mailbox and creator_id=p_creator and provider_thread_id=p_thread) then raise exception '연결된 수신 대화를 확인하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||v_mailbox||p_creator::text||p_thread,751));
 select * into old from public.sanji_creator_conversation_status s where s.owner=auth.uid() and s.mailbox=v_mailbox and s.creator_id=p_creator and s.provider_thread_id=p_thread for update;
 if found then
  if p_version is distinct from old.version then raise exception '대화가 변경됐습니다.' using errcode='40001';end if;
  update public.sanji_creator_conversation_status s set status=p_status,note=coalesce(p_note,''),version=old.version+1,updated=now(),history=case when old.status is distinct from p_status or old.note is distinct from coalesce(p_note,'') then old.history||jsonb_build_array(jsonb_build_object('from',old.status,'to',p_status,'previousNote',old.note,'note',coalesce(p_note,''),'updatedAt',now(),'source','operator_reported')) else old.history end where s.owner=auth.uid() and s.mailbox=v_mailbox and s.creator_id=p_creator and s.provider_thread_id=p_thread returning s.* into result;
 else
  if p_version is distinct from 0 then raise exception '대화가 변경됐습니다.' using errcode='40001';end if;
  insert into public.sanji_creator_conversation_status(owner,mailbox,creator_id,provider_thread_id,status,note,history) values(auth.uid(),v_mailbox,p_creator,p_thread,p_status,coalesce(p_note,''),jsonb_build_array(jsonb_build_object('from','미정','to',p_status,'updatedAt',now(),'source','operator_reported'))) returning * into result;
 end if;
 return result;
end $$;
revoke all on function public.sanji_creator_conversation_list(),public.sanji_creator_conversation_save(uuid,text,int,text,text) from public,anon;
grant execute on function public.sanji_creator_conversation_list(),public.sanji_creator_conversation_save(uuid,text,int,text,text) to authenticated;

commit;
