begin;
create table public.sanji_creator_inbound_messages(owner uuid not null references auth.users(id),creator_id uuid not null,provider_thread_id text not null,provider_message_id text not null,observation_message_id text not null,data jsonb not null,created timestamptz not null default now(),primary key(owner,provider_thread_id,provider_message_id));
alter table public.sanji_creator_inbound_messages enable row level security;
revoke all on public.sanji_creator_inbound_messages from public,anon,authenticated;
grant select,insert on public.sanji_creator_inbound_messages to service_role;
create or replace function public.sanji_creator_inbound_store(p_owner uuid,p_creator uuid,p_version int,p_sent text,p_thread text,p_messages jsonb) returns int language plpgsql security definer set search_path='' as $$
declare review public.sanji_creator_contact_review; m jsonb; count_added int:=0; inserted int; addr text;
begin
 select * into review from public.sanji_creator_contact_review where owner=p_owner and creator_id=p_creator for update;
 if not found or review.version is distinct from p_version or review.data#>>'{email,observation,provider}'<>'gmail' or review.data#>>'{email,observation,providerMessageId}' is distinct from p_sent then return 0;end if;
 if length(p_thread) not between 1 and 300 or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>100 then raise exception 'invalid incoming messages';end if;
 addr:=lower(review.data#>>'{email,observation,recipient}');if coalesce(addr,'')='' then return 0;end if;
 for m in select value from jsonb_array_elements(p_messages) loop
  if coalesce(m->>'id','')='' or length(m->>'id')>300 or m->'out' is distinct from 'false'::jsonb or coalesce((m->>'automatic')::boolean,true) or lower(coalesce(m->>'replyAddress',''))<>addr then raise exception 'invalid incoming message';end if;
  insert into public.sanji_creator_inbound_messages(owner,creator_id,provider_thread_id,provider_message_id,observation_message_id,data) values(p_owner,p_creator,p_thread,m->>'id',p_sent,m) on conflict do nothing;
  get diagnostics inserted=row_count;count_added:=count_added+inserted;
  if coalesce(m->>'text','') ~* '(수신\s*거부(합니다|할게|해\s*주세요|요청합니다)|^\s*수신\s*거부[.!]?\s*$|unsubscribe\s+me|please\s+(unsubscribe|stop)|연락.{0,8}(중단해|그만해|하지\s*마))' then insert into public.sanji_suppression(owner,identity,reason) values(p_owner,'email:'||addr,'수신 메일의 수신 거부 요청') on conflict(owner,identity) do update set reason=excluded.reason;end if;
 end loop;return count_added;
end $$;
revoke all on function public.sanji_creator_inbound_store(uuid,uuid,int,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_inbound_store(uuid,uuid,int,text,text,jsonb) to service_role;
commit;
