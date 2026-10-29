begin;
-- Separate non-binding creator proposals. Existing standard confirmed-deal checks stay in force.
create or replace function public.sanji_validate_creator_proposal(p_owner uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.sanji_creator_contact_review;c public.sanji_creator_recovery;t public.sanji_records;recipient text;
begin
 if coalesce(p_data->>'proposalType','')<>'creator_product_proposal' then return; end if;
 if p_data->>'channel'<>'email' or coalesce(p_data->>'replyTo','')<>'' then raise exception '크리에이터 제안 채널 오류';end if;
 select * into t from public.sanji_records where owner=p_owner and id=(p_data->>'target')::uuid and kind='candidate';
 if not found or t.data->>'kind'<>'크리에이터' then raise exception '크리에이터 제안 대상 불일치';end if;
 select * into r from public.sanji_creator_contact_review where owner=p_owner and creator_id=(p_data->>'creatorReviewId')::uuid for share;
 if not found or r.version is distinct from (p_data->>'creatorReviewVersion')::integer then raise exception '크리에이터 검토 버전 불일치';end if;
 select * into c from public.sanji_creator_recovery where owner=p_owner and id=r.creator_id for share;
 recipient:=lower(coalesce(r.data->'email'->>'address',''));
 if not found or lower(coalesce(c.handle,''))<>lower(coalesce(t.data->>'handle','')) or recipient='' or recipient<>lower(coalesce(p_data->>'email','')) or recipient<>lower(coalesce(t.data->'contact'->>'email','')) or coalesce(r.data->'email'->>'sourceUrl','')<>coalesce(c.profile_url,'') or coalesce(c.profile_url,'')='' then raise exception '공개 이메일 또는 계정 불일치';end if;
 if coalesce(c.status,'')<>'new' or coalesce(c.bio_status,'')<>'email_present' or jsonb_typeof(c.emails) is distinct from 'array' or not coalesce(c.emails ? recipient,false) or position(recipient in lower(coalesce(c.bio,'')))=0 then raise exception '크리에이터 상태 또는 공개 소개란 이메일 확인 필요';end if;
 if jsonb_typeof(p_data->'emails') is distinct from 'array' or jsonb_array_length(p_data->'emails')<>1 or lower(p_data->'emails'->>0)<>recipient then raise exception '수신자 불일치';end if;
 if p_data->>'subject' is distinct from r.data->'email'->>'subject' or p_data->>'proposalReviewBody' is distinct from r.data->'email'->>'body' or position(coalesce(r.data->'email'->>'body','') in coalesce(p_data->>'body',''))<>1 or coalesce(r.data->'email'->>'body','')='' then raise exception '승인된 본문 또는 제목 불일치';end if;
 if coalesce(r.data->'email'->'observation'->>'status','') in ('scheduled','sent','unknown') then raise exception '외부 발송 이력 확인 필요';end if;
 if exists(select 1 from public.sanji_creator_contact_review other where other.owner=p_owner and lower(coalesce(other.data->'email'->'observation'->>'recipient',''))=recipient and other.data->'email'->'observation'->>'status' in ('scheduled','sent','unknown')) then raise exception '같은 이메일의 외부 연락 이력 확인 필요';end if;
 if exists(select 1 from public.sanji_suppression s where s.owner=p_owner and s.identity in (recipient,'email:'||recipient)) then raise exception '수신 거부 또는 반송 주소';end if;
 if exists(select 1 from public.sanji_outbox ob where ob.owner=p_owner and ob.channel='email' and (lower(coalesce(ob.data->>'email',''))=recipient or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(ob.data->'emails')='array' then ob.data->'emails' else '[]'::jsonb end) as address(value) where lower(address.value)=recipient))) then raise exception '같은 이메일에 기존 발송 이력';end if;
 if exists(select 1 from public.sanji_jobs j join public.sanji_drafts q on q.id=j.draft_id and q.owner=j.owner where j.owner=p_owner and j.status in ('queued','processing') and q.data->>'channel'='email' and coalesce(q.data->>'messageId','')<>coalesce(p_data->>'messageId','') and (lower(coalesce(q.data->>'email',''))=recipient or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(q.data->'emails')='array' then q.data->'emails' else '[]'::jsonb end) as address(value) where lower(address.value)=recipient))) then raise exception '같은 이메일에 기존 예약';end if;
 if jsonb_typeof(p_data->'dealVersions') is distinct from 'array' or jsonb_array_length(p_data->'dealVersions') not between 1 and 3 then raise exception '상품 확인 필요';end if;
 if jsonb_typeof(r.data->'email'->'productIds') is distinct from 'array' or jsonb_array_length(r.data->'email'->'productIds')<>jsonb_array_length(p_data->'dealVersions') or exists(select 1 from jsonb_array_elements(p_data->'dealVersions') d where not (r.data->'email'->'productIds' ? (d->>'id'))) then raise exception '승인한 상품 불일치';end if;
end $$;
revoke all on function public.sanji_validate_creator_proposal(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_validate_creator_proposal(uuid,jsonb) to service_role;
do $guard$
declare definition text; sig text; previous text; revised text;
begin
 foreach sig in array array['public.sanji_schedule_dispatch(uuid,uuid,text,timestamptz)','public.sanji_reserve_dispatch(uuid,uuid,text,text)'] loop
  select pg_get_functiondef(sig::regprocedure) into definition;
  if position('perform public.sanji_validate_creator_proposal(p_owner,d.data);' in definition)>0 then raise exception '이미 적용된 함수: %',sig;end if;
  previous:='for v in select * from jsonb_array_elements(d.data->''dealVersions'') loop';
  if position(previous in definition)=0 then raise exception '검증 지점을 찾을 수 없습니다: %',sig;end if;
  definition:=replace(definition,previous,'perform public.sanji_validate_creator_proposal(p_owner,d.data);'||chr(10)||' '||previous);
  previous:='and data->>''state''=''확정''';
  revised:='and (data->>''state''=''확정'' or (d.data->>''proposalType''=''creator_product_proposal'' and data->>''state''=''협의 중''))';
  if position(previous in definition)=0 then raise exception '상품 검증 지점을 찾을 수 없습니다: %',sig;end if;
  definition:=replace(definition,previous,revised);
  execute definition;
 end loop;
end $guard$;
-- Provision or reuse an owner-scoped creator candidate only after public bio evidence checks.
create or replace function public.sanji_creator_proposal_target(p_owner uuid,p_creator uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.sanji_creator_recovery;r public.sanji_creator_contact_review;t public.sanji_records;address text;display_name text;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into r from public.sanji_creator_contact_review where owner=p_owner and creator_id=p_creator for share;
 if not found or r.version<>p_version then raise exception '검토 버전이 변경되었습니다';end if;
 select * into c from public.sanji_creator_recovery where owner=p_owner and id=p_creator;
 address:=lower(coalesce(r.data->'email'->>'address',''));
 if not found or coalesce(c.status,'')<>'new' or coalesce(c.bio_status,'')<>'email_present' or address='' or jsonb_typeof(c.emails) is distinct from 'array' or not coalesce(c.emails ? address,false) or position(address in lower(coalesce(c.bio,'')))=0 or r.data->'email'->>'sourceUrl'<>c.profile_url then raise exception '공개 소개란 이메일 확인 필요';end if;
 if coalesce(r.data->'email'->'observation'->>'status','') in ('scheduled','sent','unknown') or exists(select 1 from public.sanji_suppression where owner=p_owner and identity in (address,'email:'||address)) then raise exception '기존 발송 또는 수신 거부 확인 필요';end if;
 select * into t from public.sanji_records where owner=p_owner and kind='candidate' and lower(data->>'handle')=lower(c.handle) limit 1;
 if found then if t.data->>'kind'<>'크리에이터' or lower(coalesce(t.data->'contact'->>'email',''))<>address or coalesce((t.data->'contact'->>'verified')::boolean,false)=false then raise exception '기존 크리에이터 연락처 확인 필요';end if;return t.id;end if;
 if exists(select 1 from public.sanji_records where owner=p_owner and kind='candidate' and lower(coalesce(data->'contact'->>'email',''))=address) then raise exception '공유 이메일의 기존 연락 이력 확인 필요';end if;
 display_name:=coalesce(nullif(c.nickname,''),c.handle);
 insert into public.sanji_records(owner,kind,data) values(p_owner,'candidate',jsonb_build_object('name',display_name,'company',display_name,'companyKey','creator:'||c.handle,'kind','크리에이터','handle',c.handle,'profile',c.profile_url,'status','미접촉','contact',jsonb_build_object('email',address,'source',c.profile_url,'verified',true,'purpose','비즈니스'),'note','공개 소개란 이메일 · 실제 수신 가능 여부 미검증')) returning id into t.id;
 return t.id;
end $$;
revoke all on function public.sanji_creator_proposal_target(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_proposal_target(uuid,uuid,integer) to service_role;
commit;
