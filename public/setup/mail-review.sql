begin;
alter table public.sanji_jobs drop constraint if exists sanji_jobs_status_check;
alter table public.sanji_jobs add constraint sanji_jobs_status_check check(status in('queued','processing','completed','failed','outcome_unknown','cancelled','review_pending'));
-- Recipient exclusions and existing draft/queue review changes are a separately approved data change.
-- Keep legitimate, officially published support/customer-care contacts usable.
do $review$
declare definition text;
begin
 select pg_get_functiondef('public.sanji_save_record(text,jsonb,uuid,integer)'::regprocedure) into definition;
 definition:=replace(definition,'security|support|noreply','security|noreply');
 execute definition;
 select pg_get_functiondef('public.sanji_reserve_dispatch(uuid,uuid,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'public.sanji_blocked(p_owner,t.data)',
 $replacement$public.sanji_blocked(p_owner,jsonb_set(t.data-'recipientEmails','{contact}',coalesce(t.data->'contact','{}'::jsonb)||jsonb_build_object('email','')))$replacement$);
 if position('실제 수신자에 제외' in definition)=0 then
 definition:=replace(definition,
 $old$update public.sanji_drafts set used=true where id=d.id;$old$,
 $new$if d.data->>'channel'='email' and exists(
  select 1 from jsonb_array_elements_text(case when jsonb_typeof(d.data->'emails')='array' and jsonb_array_length(d.data->'emails')>0 then d.data->'emails' else jsonb_build_array(d.data->>'email') end) recipient_row(address)
  join public.sanji_suppression excluded_address on excluded_address.owner=p_owner and excluded_address.identity in(lower(recipient_row.address),'email:'||lower(recipient_row.address))
 ) then raise exception '실제 수신자에 제외·수신 거부·영구 반송 주소가 포함되어 있습니다.';end if;
 update public.sanji_drafts set used=true where id=d.id;$new$);
 end if;
 if position('실제 수신자에 제외' in definition)=0 then raise exception 'Dispatch recipient guard migration did not match';end if;
 execute definition;
end $review$;

commit;
