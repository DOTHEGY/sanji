begin;
create or replace function public.sanji_tagby_observation_commit(p_owner uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare x jsonb;r public.sanji_creator_contact_review;c public.sanji_creator_recovery;n integer:=0;newdm jsonb;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 30 then raise exception '권한 또는 행 수 오류'; end if;
 if (select count(distinct y->>'creatorId') from jsonb_array_elements(p_rows) y)<>jsonb_array_length(p_rows) then raise exception '중복 대상'; end if;
 for x in select value from jsonb_array_elements(p_rows) order by value->>'creatorId' loop
  select * into r from public.sanji_creator_contact_review where owner=p_owner and creator_id=(x->>'creatorId')::uuid for update;
  if not found or r.version<>(x->>'version')::integer then raise exception '버전 변경: 다시 미리보기 필요'; end if;
  select * into c from public.sanji_creator_recovery where owner=p_owner and id=r.creator_id;
  if not found or lower(c.handle)<>lower(x->>'handle') or r.data->'dm'->>'campaignUrl'<>x->>'campaignUrl' or lower(r.data->'dm'->>'sourceAccount')<>lower(x->>'sourceAccount') then raise exception '계정 또는 캠페인 변경'; end if;
  newdm:=coalesce(r.data->'dm','{}'::jsonb)||jsonb_build_object('observationHistory',coalesce(r.data->'dm'->'observationHistory','[]'::jsonb)||jsonb_build_array(x));
  update public.sanji_creator_contact_review set data=jsonb_set(data,'{dm}',newdm),version=version+1,updated=now() where owner=p_owner and creator_id=r.creator_id;n:=n+1;
 end loop;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'tagby_observations_recorded',jsonb_build_object('count',n,'noDispatch',true));return n;
end $$;
revoke all on function public.sanji_tagby_observation_commit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_tagby_observation_commit(uuid,jsonb) to service_role;
commit;
