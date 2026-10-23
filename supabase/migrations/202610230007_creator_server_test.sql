begin;
alter table public.sanji_creator_config add column if not exists server_test_id uuid, add column if not exists server_test_deadline timestamptz;
create or replace function public.sanji_creator_server_test_claim(p_owner uuid,p_sender text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sanji_creator_config;r public.sanji_creator_prospects;
begin
 perform pg_advisory_xact_lock(hashtextextended('creator-local:'||p_owner::text,0));
 select * into c from public.sanji_creator_config where owner=p_owner;
 if not c.server_enabled or c.server_test_deadline is null or c.server_test_deadline<=now() or p_sender<>'valu_est' or c.sender_handle<>p_sender then return null;end if;
 select * into r from public.sanji_creator_prospects where owner=p_owner and id=c.server_test_id for update;
 if not found or r.status<>'queued' or r.handle<>'taemin_dtg' or r.sender_handle<>p_sender or r.body<>'산지 Instagram DM 발송 기능 확인용 테스트 메시지입니다. 확인되시면 답장 부탁드립니다!' or coalesce(r.approved_hash,'')='' then return null;end if;
 update public.sanji_creator_prospects set status='sending',claimed=now(),result='{"note":"서버 내부 테스트 처리 중 · 재시도 금지"}' where id=r.id;
 return jsonb_build_object('type','dm','id',r.id,'handle',r.handle,'sender',r.sender_handle,'body',r.body,'approvedHash',r.approved_hash);
end $$;
revoke all on function public.sanji_creator_server_test_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.sanji_creator_server_test_claim(uuid,text) to service_role;
commit;
