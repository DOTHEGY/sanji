-- SANJI STEP 2 START
begin;
create or replace function public.sanji_save_record(p_kind text,p_data jsonb,p_id uuid default null,p_version integer default null) returns public.sanji_records language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();old public.sanji_records;result public.sanji_records;v jsonb:=p_data;company text;identifier text;
begin
 if not public.sanji_is_member() then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
 if p_kind not in('candidate','deal','template','settings') then raise exception '허용되지 않은 항목';end if;
 if jsonb_typeof(v)<>'object' or octet_length(v::text)>100000 then raise exception '입력 크기 또는 형식 오류';end if;
 if p_id is not null then select * into old from public.sanji_records where id=p_id and owner=u and kind=p_kind for update;if not found then raise exception '항목을 찾을 수 없습니다.';end if;if p_version is distinct from old.version then raise exception '다른 변경이 있습니다. 새로고침하세요.' using errcode='40001';end if;end if;
 v:=v-'id'-'version'-'updated'-'history';
 if p_kind in('candidate','deal','template') and length(coalesce(v->>'name','')) not between 1 and 200 then raise exception '이름을 입력하세요.';end if;
 if p_kind='candidate' then
  foreach identifier in array array['website','profile','metricsSource'] loop if coalesce(v->>identifier,'')<>'' and v->>identifier !~ '^https://' then raise exception '공식 링크는 HTTPS 주소만 가능합니다.';end if;end loop;
  if v->>'kind' not in('브랜드','제조사','공식 유통사','크리에이터') then raise exception '관계를 확인하세요.';end if;
  v:=jsonb_build_object('company','','companyKey','','category','미확인','classification','미확인','authority','미확인','product','','website','','profile','','handle','','agency','','channels','','contact',jsonb_build_object('email','','owner','','source','','checked','','verified',false,'purpose','미확인'),'topics','[]'::jsonb,'evidence','[]'::jsonb,'followers',null,'metricsSource','','metricsChecked','','reaction','미확인','experience','미확인','active','미확인','schedule','미확인','reason','','status','미접촉','owner','','next','','due','','note','')||v;
  company:=coalesce(v->>'company','');if coalesce(v->>'companyKey','')='' and company<>'' then v:=jsonb_set(v,'{companyKey}',to_jsonb(regexp_replace(company,'\s','','g')));end if;
  if v->'followers'<>'null'::jsonb and (coalesce(v->>'metricsSource','')='' or coalesce(v->>'metricsChecked','')='') then raise exception '수치 출처 URL과 확인일이 필요합니다.';end if;
  if coalesce(v#>>'{contact,email}','')<>'' and v#>>'{contact,email}' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '이메일 형식 오류';end if;
  if coalesce((v#>>'{contact,verified}')::boolean,false) then
   if coalesce(v#>>'{contact,email}','')='' or coalesce(v#>>'{contact,source}','') !~ '^https://' or coalesce(v#>>'{contact,checked}','')='' or v#>>'{contact,owner}' is distinct from company or coalesce(v#>>'{contact,purpose}','미확인')='미확인' then raise exception '공식 사업용 연락처 소유 회사·출처·확인일을 확인하세요.';end if;
   if v#>>'{contact,email}' ~* '(^|[._-])(privacy|recruit|career|jobs|security|support|noreply|tech)([._-]|@)' then raise exception '채용·개인정보·지원 주소는 사용할 수 없습니다.';end if;
  end if;
 elsif p_kind='deal' then
  foreach identifier in array array['productUrl','image','source'] loop if coalesce(v->>identifier,'')<>'' and v->>identifier !~ '^https://' then raise exception 'HTTPS 주소만 가능합니다.';end if;end loop;
  if not exists(select 1 from public.sanji_records where id=(v->>'brand')::uuid and owner=u and kind='candidate' and data->>'kind'<>'크리에이터') then raise exception '소유한 브랜드 후보가 필요합니다.';end if;
  v:=jsonb_build_object('category','미확인','productUrl','','image','','retail',null,'price',null,'supply',null,'commission','미협의','settlement','미협의','moq',null,'stock',null,'shipping','미협의','returns','미확인','expiry','미확인','schedule','미협의','target','','claims','미확인','assets','미확인','topics','[]'::jsonb,'source','','sourceNote','','checked','','state','협의 중')||v;
  if v->>'state' not in('협의 중','확정') then raise exception '협의 상태 오류';end if;
  foreach identifier in array array['price','retail','supply','moq','stock'] loop if v->identifier<>'null'::jsonb and (v->>identifier)::numeric<0 then raise exception '음수 수치 불가';end if;end loop;
  v:=jsonb_set(v,'{history}',coalesce(old.data->'history','[]'::jsonb)||case when old.id is null then '[]'::jsonb else jsonb_build_array((old.data-'history')||jsonb_build_object('version',old.version,'updated',old.updated)) end);
 elsif p_kind='settings' then
  if (v->>'dailyLimit')::integer not between 1 and 100 then raise exception '일일 제한은 1~100입니다.';end if;
  v:=jsonb_build_object('dailyLimit',(v->>'dailyLimit')::integer,'senderName',coalesce(v->>'senderName',''),'senderAddress',coalesce(v->>'senderAddress',''),'senderPhone',coalesce(v->>'senderPhone',''),'optOut','회신으로 수신 거부를 요청하실 수 있습니다.');
 elsif p_kind='template' then v:=jsonb_build_object('channel','이메일','subject','','body','','signature','','attachments','[]'::jsonb)||v;
 end if;
 if p_id is null then insert into public.sanji_records(owner,kind,data) values(u,p_kind,v) returning * into result;
 else update public.sanji_records set data=v,version=version+1,updated=now() where id=p_id and owner=u returning * into result;end if;
 if p_kind='candidate' and v->>'status' in('거절','수신 거부') then foreach identifier in array public.sanji_identities(v) loop insert into public.sanji_suppression values(u,identifier,v->>'status') on conflict(owner,identity) do update set reason=excluded.reason;end loop;end if;
 insert into public.sanji_audit(owner,action,data) values(u,p_kind||'_saved',jsonb_build_object('id',result.id,'version',result.version));return result;
end $$;
revoke all on function public.sanji_save_record(text,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.sanji_save_record(text,jsonb,uuid,integer) to authenticated;

commit;
-- SANJI STEP 2 COMPLETE
