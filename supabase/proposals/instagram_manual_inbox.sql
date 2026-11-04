-- Proposal only: apply via a reviewed migration, never directly to production.
begin;
-- Preserve owner referential integrity through the already-existing creator FK.
-- Fail closed if its verified production shape is absent or unvalidated.
do $$
begin
 if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.sanji_creator_recovery'::regclass and c.confrelid='auth.users'::regclass and c.contype='f' and c.confdeltype='c' and c.convalidated and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='owner' and not attisdropped)]::smallint[] and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id' and not attisdropped)]::smallint[]) then raise exception 'creator owner cascade prerequisite missing'; end if;
end $$;
-- This additive constraint changes the existing creator table and requires a
-- separate reviewed migration, lock/rollout review and approval. It lets the
-- child FK enforce that creator and conversation belong to the same owner.
alter table public.sanji_creator_recovery add constraint sanji_creator_recovery_id_owner_key unique(id,owner);
-- One lazily-created generation per creator; no creator-table trigger or broad backfill.
create table public.sanji_ig_creator_generations (
 owner uuid not null, creator_id uuid not null, generation uuid not null default gen_random_uuid(),
 primary key(owner,creator_id), unique(generation), unique(owner,creator_id,generation),
 foreign key(creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade
);
alter table public.sanji_ig_creator_generations enable row level security;
revoke all on public.sanji_ig_creator_generations from public,anon,authenticated,service_role;
grant select,insert(owner,creator_id) on public.sanji_ig_creator_generations to service_role;
create table public.sanji_ig_manual_conversations (
 owner uuid not null,
 account_id text not null check(account_id ~ '^[0-9]{1,100}$'),
 peer_id text not null check(peer_id ~ '^[0-9]{1,100}$' and peer_id<>account_id),
 creator_id uuid not null, creator_generation_id uuid not null,
 username text not null check(username ~ '^[a-z0-9._]{1,30}$'),
 conversation_id text not null check(length(conversation_id) between 1 and 500),
 generation_id uuid not null default gen_random_uuid(), conversation_revision uuid not null default gen_random_uuid(), content_conflict boolean not null default false, sync_in_progress boolean not null default false,
 provider_updated_at timestamptz, checked_at timestamptz not null default now(), sync_id uuid not null,
 last_direction text not null default 'review' check(last_direction in ('inbound','outbound','review')),
 primary key(owner,account_id,peer_id), unique(owner,account_id,conversation_id),
 unique(owner,account_id,peer_id,creator_id,creator_generation_id,generation_id),
 foreign key(creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade,
 foreign key(owner,creator_id,creator_generation_id) references public.sanji_ig_creator_generations(owner,creator_id,generation) on delete cascade
);
-- Supports creator-side FK cascade lookups without a full conversation-table scan.
create index sanji_ig_manual_conversations_creator_owner_idx on public.sanji_ig_manual_conversations(creator_id,owner);
create table public.sanji_ig_manual_messages (
 owner uuid not null, account_id text not null, peer_id text not null,
 message_id text not null check(length(message_id) between 1 and 500),
 received_at timestamptz not null, body text not null check(length(body) between 1 and 10000),
 direction text not null check(direction='inbound'),
 primary key(owner,account_id,message_id),
 foreign key(owner,account_id,peer_id) references public.sanji_ig_manual_conversations(owner,account_id,peer_id) on delete cascade
);
create index sanji_ig_manual_messages_recent on public.sanji_ig_manual_messages(owner,account_id,received_at desc);
-- Supports message-side FK cascade lookups; draft primary key already covers its FK.
create index sanji_ig_manual_messages_conversation_idx on public.sanji_ig_manual_messages(owner,account_id,peer_id,received_at desc,message_id desc);
create table public.sanji_ig_manual_drafts (
 owner uuid not null, account_id text not null, peer_id text not null,
 body text not null check(length(body)<=10000), updated_at timestamptz not null default clock_timestamp(),
 primary key(owner,account_id,peer_id),
 foreign key(owner,account_id,peer_id) references public.sanji_ig_manual_conversations(owner,account_id,peer_id) on delete cascade
);
-- Three bounded technical slots per owner; expired abandoned metadata needs a separately approved cleanup process.
create table public.sanji_ig_manual_cursors (
 owner uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('directory','thread','sync')),
 account_id text not null check(account_id ~ '^[0-9]{1,100}$'),
 anchor_creator_id uuid, anchor_creator_generation_id uuid, anchor_peer_id text, anchor_conversation_generation_id uuid,
 token_hash text check(token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb check(payload is null or (jsonb_typeof(payload)='object' and octet_length(payload::text)<=20000)),
 expires_at timestamptz,
 primary key(owner,kind),
 foreign key(anchor_creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade,
 foreign key(owner,anchor_creator_id,anchor_creator_generation_id) references public.sanji_ig_creator_generations(owner,creator_id,generation) on delete cascade,
 foreign key(owner,account_id,anchor_peer_id,anchor_creator_id,anchor_creator_generation_id,anchor_conversation_generation_id) references public.sanji_ig_manual_conversations(owner,account_id,peer_id,creator_id,creator_generation_id,generation_id) on delete cascade,
 check(payload is null or ((
  payload->>'owner'=owner::text and payload->>'account'=account_id and payload->>'kind'=kind
  and jsonb_typeof(payload->'owner')='string' and jsonb_typeof(payload->'account')='string' and jsonb_typeof(payload->'kind')='string'
  and jsonb_typeof(payload->'since')='string' and payload->>'since' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  and (kind<>'sync' or (case when jsonb_typeof(payload->'providerHistory')='array' and jsonb_typeof(payload->'messageHistory')='array' then jsonb_array_length(payload->'providerHistory')<=100 and jsonb_array_length(payload->'messageHistory')<=100 and (payload->'providerHistory')::text ~ '^\[("[a-f0-9]{64}"(, )?)*\]$' and (payload->'messageHistory')::text ~ '^\[("[a-f0-9]{64}"(, )?)*\]$' else false end))
  and ((kind='sync' and payload->>'phase'='provider' and anchor_creator_id is null and anchor_creator_generation_id is null and anchor_peer_id is null and anchor_conversation_generation_id is null and payload ?& array['owner','account','kind','since','phase','page','providerHistory','messageHistory'] and payload-array['owner','account','kind','since','phase','page','providerHistory','messageHistory']='{}'::jsonb and jsonb_typeof(payload->'page')='string' and length(payload->>'page') between 1 and 512 and payload->>'page' ~ '^[A-Za-z0-9._~:+/=-]+$' and payload->>'page' !~ '://')
   or (anchor_creator_id is not null and anchor_creator_generation_id is not null and anchor_peer_id is not null and anchor_conversation_generation_id is not null and payload->>'peer'=anchor_peer_id and payload->>'generation'=anchor_conversation_generation_id::text and payload->>'creator'=anchor_creator_id::text and jsonb_typeof(payload->'creator')='string' and payload->>'creatorGeneration'=anchor_creator_generation_id::text and jsonb_typeof(payload->'creatorGeneration')='string' and jsonb_typeof(payload->'peer')='string' and payload->>'peer' ~ '^[0-9]{1,100}$' and jsonb_typeof(payload->'generation')='string' and payload->>'generation' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and ((kind='directory' and payload ?& array['owner','account','kind','since','peer','creator','creatorGeneration','generation'] and payload-array['owner','account','kind','since','peer','creator','creatorGeneration','generation']='{}'::jsonb)
     or (kind='thread' and payload ?& array['owner','account','kind','since','peer','creator','creatorGeneration','generation','at','messageId'] and payload-array['owner','account','kind','since','peer','creator','creatorGeneration','generation','at','messageId']='{}'::jsonb and jsonb_typeof(payload->'at')='string' and length(payload->>'at') between 20 and 40 and payload->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]{8,30}(Z|[+-][0-9]{2}:[0-9]{2})$' and jsonb_typeof(payload->'messageId')='string' and length(payload->>'messageId') between 1 and 500 and payload->>'messageId' !~ '[[:cntrl:]]')
     or (kind='sync' and payload->>'phase'='resume' and payload ?& array['owner','account','kind','since','phase','page','message','thread','offset','hash','peer','creator','creatorGeneration','generation','syncId','providerNextHash','providerHistory','messageHistory'] and payload-array['owner','account','kind','since','phase','page','message','thread','offset','hash','peer','creator','creatorGeneration','generation','syncId','providerNextHash','providerHistory','messageHistory']='{}'::jsonb
      and jsonb_typeof(payload->'providerNextHash')='string' and payload->>'providerNextHash' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(payload->'thread')='string' and length(payload->>'thread') between 1 and 500 and payload->>'thread' !~ '[[:cntrl:]]'
      and (payload->'page'='null'::jsonb or (jsonb_typeof(payload->'page')='string' and length(payload->>'page') between 1 and 512 and payload->>'page' ~ '^[A-Za-z0-9._~:+/=-]+$' and payload->>'page' !~ '://'))
      and (payload->'message'='null'::jsonb or (jsonb_typeof(payload->'message')='string' and length(payload->>'message') between 1 and 512 and payload->>'message' ~ '^[A-Za-z0-9._~:+/=-]+$' and payload->>'message' !~ '://'))
      and jsonb_typeof(payload->'offset')='number' and payload->>'offset' ~ '^[0-9]{1,3}$' and (payload->>'offset')::int<=996 and (payload->>'offset')::int%4=0 and ((payload->>'offset')::int>0 or payload->'message'<>'null'::jsonb)
      and jsonb_typeof(payload->'hash')='string' and payload->>'hash' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(payload->'creatorGeneration')='string' and payload->>'creatorGeneration' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(payload->'syncId')='string' and payload->>'syncId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))))
 ) is true)),
 check((token_hash is null and payload is null and expires_at is null) or (token_hash is not null and payload is not null and expires_at is not null))
);
alter table public.sanji_ig_manual_cursors enable row level security;
revoke all on public.sanji_ig_manual_cursors from public,anon,authenticated,service_role;
grant select,insert,update on public.sanji_ig_manual_cursors to service_role;
alter table public.sanji_ig_manual_conversations enable row level security;
alter table public.sanji_ig_manual_messages enable row level security;
alter table public.sanji_ig_manual_drafts enable row level security;
revoke all on public.sanji_ig_manual_conversations,public.sanji_ig_manual_messages,public.sanji_ig_manual_drafts from public,anon,authenticated,service_role;
grant select on public.sanji_ig_manual_conversations to service_role;
grant insert(owner,account_id,peer_id,creator_id,creator_generation_id,username,conversation_id,provider_updated_at,checked_at,last_direction,sync_id,sync_in_progress), update(conversation_id,provider_updated_at,checked_at,last_direction,sync_id,conversation_revision,content_conflict,sync_in_progress) on public.sanji_ig_manual_conversations to service_role;
grant select,insert,update on public.sanji_ig_manual_drafts to service_role;
grant select,insert on public.sanji_ig_manual_messages to service_role;
-- The target becomes the current uniquely eligible creator after provider metadata, before any message read.
-- Parent row lock prevents creator deletion while its lazy generation and conversation are bound.
create function public.sanji_ig_manual_acquire_target(p_owner uuid,p_account text,p_peer text,p_username text,p_conversation text,p_updated timestamptz,p_sync uuid,p_expected_creator uuid,p_expected_creator_generation uuid,p_expected_conversation_generation uuid,p_expected_sync uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare creator uuid; creator_gen uuid; conversation_gen uuid; target_type text; target_assessment text; target_status text;
begin
 if p_username !~ '^[a-z0-9._]{1,30}$' or not ((p_expected_creator is null and p_expected_creator_generation is null and p_expected_conversation_generation is null and p_expected_sync is null) or (p_expected_creator is not null and p_expected_creator_generation is not null and p_expected_conversation_generation is not null and p_expected_sync is not null)) then raise exception 'invalid target';end if;
 begin
  select r.id,r.entity_type,r.assessment,r.status into strict creator,target_type,target_assessment,target_status from public.sanji_creator_recovery r where r.owner=p_owner and lower(r.handle)=p_username for share;
 exception when no_data_found or too_many_rows then return null;end;
 if target_type is distinct from 'creator_evidence' or target_assessment is null or target_assessment='excluded' or target_status is null or target_status='excluded' then return null;end if;
 if p_expected_creator is not null and creator<>p_expected_creator then return null;end if;
 if p_expected_creator is null then insert into public.sanji_ig_creator_generations(owner,creator_id) values(p_owner,creator) on conflict(owner,creator_id) do nothing returning generation into creator_gen;end if;
 if creator_gen is null then select generation into creator_gen from public.sanji_ig_creator_generations where owner=p_owner and creator_id=creator;end if;
 if p_expected_creator is not null then
  if creator_gen is distinct from p_expected_creator_generation then return null;end if;
  perform 1 from public.sanji_ig_manual_conversations c where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=creator and c.creator_generation_id=creator_gen and c.generation_id=p_expected_conversation_generation and c.sync_id=p_expected_sync and c.conversation_id=p_conversation for update;
  if not found then return null;end if;
 end if;
 if creator_gen is null then raise exception 'creator generation unavailable; retry';end if;
 insert into public.sanji_ig_manual_conversations(owner,account_id,peer_id,creator_id,creator_generation_id,username,conversation_id,provider_updated_at,checked_at,last_direction,sync_id,sync_in_progress)
 values(p_owner,p_account,p_peer,creator,creator_gen,p_username,p_conversation,null,'1970-01-01 00:00:00+00'::timestamptz,'review',p_sync,true)
 on conflict(owner,account_id,peer_id) do update set conversation_id=excluded.conversation_id,checked_at=excluded.checked_at,last_direction='review',sync_id=excluded.sync_id,sync_in_progress=true,conversation_revision=gen_random_uuid()
 where public.sanji_ig_manual_conversations.creator_id=excluded.creator_id and public.sanji_ig_manual_conversations.creator_generation_id=excluded.creator_generation_id and public.sanji_ig_manual_conversations.username=excluded.username and not public.sanji_ig_manual_conversations.content_conflict
 returning generation_id into conversation_gen;
 if conversation_gen is null then return null;end if;
 return jsonb_build_object('creatorId',creator,'creatorGeneration',creator_gen,'conversationGeneration',conversation_gen);
end $$;
revoke all on function public.sanji_ig_manual_acquire_target(uuid,text,text,text,text,timestamptz,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_acquire_target(uuid,text,text,text,text,timestamptz,uuid,uuid,uuid,uuid,uuid) to service_role;
-- Atomic optimistic update: null expected timestamp means create only. Empty body is a saved empty draft.
create function public.sanji_ig_manual_save_draft(p_owner uuid,p_account text,p_peer text,p_generation uuid,p_body text,p_expected timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.sanji_ig_manual_drafts; creator uuid; creator_handle text; conversation_handle text;
begin
 if p_generation is null or p_body is null or length(p_body)>10000 then raise exception 'invalid draft'; end if;
 -- First read identifies the parent only. Locks and a second check provide the guarantee.
 select c.creator_id into creator from public.sanji_ig_manual_conversations c where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.generation_id=p_generation;
 if not found then raise exception 'conversation not verified';end if;
 select lower(r.handle) into creator_handle from public.sanji_creator_recovery r where r.owner=p_owner and r.id=creator and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1 for share;
 if not found then raise exception 'conversation not verified';end if;
 select c.username into conversation_handle from public.sanji_ig_manual_conversations c where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=creator and c.generation_id=p_generation and not c.content_conflict and not c.sync_in_progress for update;
 if not found or creator_handle<>conversation_handle then raise exception 'conversation not verified';end if;
 if p_expected is null then
  insert into public.sanji_ig_manual_drafts(owner,account_id,peer_id,body) values(p_owner,p_account,p_peer,p_body) on conflict do nothing returning * into result;
 else
  update public.sanji_ig_manual_drafts set body=p_body,updated_at=clock_timestamp() where owner=p_owner and account_id=p_account and peer_id=p_peer and updated_at=p_expected returning * into result;
 end if;
 if result.owner is null then return jsonb_build_object('conflict',true);end if;
 return jsonb_build_object('conflict',false,'body',result.body,'updatedAt',result.updated_at);
end $$;
revoke all on function public.sanji_ig_manual_save_draft(uuid,text,text,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_save_draft(uuid,text,text,uuid,text,timestamptz) to service_role;
-- Append-only self-reported review metadata, without copies of draft content.
-- Parent draft deletion cascades this metadata. Retention/cleanup is not specified.
create table public.sanji_ig_manual_review_audit (
 owner uuid not null, account_id text not null, peer_id text not null,
 audit_id uuid not null default gen_random_uuid(), saved_at timestamptz not null default clock_timestamp(),
 creator_id uuid not null, conversation_generation uuid not null, conversation_revision uuid not null, draft_updated_at timestamptz not null,
 reviewer_type text not null check(reviewer_type in ('user','assistant','other_authorized_worker')),
 source_check text not null check(source_check='self_reported_checked'), policy_check text not null check(policy_check='self_reported_checked'),
 primary key(owner,account_id,peer_id,audit_id),
 unique(owner,account_id,peer_id,conversation_generation,conversation_revision,draft_updated_at,reviewer_type),
 foreign key(owner,account_id,peer_id) references public.sanji_ig_manual_drafts(owner,account_id,peer_id) on delete cascade
);
alter table public.sanji_ig_manual_review_audit enable row level security;
revoke all on public.sanji_ig_manual_review_audit from public,anon,authenticated,service_role;
grant select on public.sanji_ig_manual_review_audit to service_role;
grant insert(owner,account_id,peer_id,creator_id,conversation_generation,conversation_revision,draft_updated_at,reviewer_type,source_check,policy_check) on public.sanji_ig_manual_review_audit to service_role;
create index sanji_ig_manual_review_audit_history on public.sanji_ig_manual_review_audit(owner,account_id,peer_id,saved_at desc,audit_id desc);
-- This validates local observation, not Meta's latest message or a person's actual source check.
create function public.sanji_ig_manual_save_reviewed_draft(p_owner uuid,p_account text,p_peer text,p_creator uuid,p_generation uuid,p_revision uuid,p_body text,p_expected timestamptz,p_reviewer text,p_source_check text,p_policy_check text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.sanji_ig_manual_drafts; h text; ch text; eligible boolean;
begin
 if p_creator is null or p_generation is null or p_revision is null or p_body is null or p_body !~ '[^[:space:]]' or length(p_body)>10000 or (p_reviewer is null or p_reviewer not in ('user','assistant','other_authorized_worker')) or p_source_check is distinct from 'self_reported_checked' or p_policy_check is distinct from 'self_reported_checked' then raise exception 'invalid review';end if;
 select count(*)=1 and coalesce(bool_and(c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account),false) into eligible from public.sanji_connections c where c.owner=p_owner and c.provider like 'instagram:%' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb and lower(c.summary->>'username')='valu_est';
 if not eligible then return jsonb_build_object('conflict',true);end if;
 select lower(r.handle) into h from public.sanji_creator_recovery r where r.owner=p_owner and r.id=p_creator and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1 for share;
 if not found then return jsonb_build_object('conflict',true);end if;
 select c.username into ch from public.sanji_ig_manual_conversations c where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=p_creator and c.generation_id=p_generation and c.conversation_revision=p_revision and not c.content_conflict and not c.sync_in_progress and c.checked_at between clock_timestamp()-interval '5 minutes' and clock_timestamp() for update;
 if not found or ch<>h then return jsonb_build_object('conflict',true);end if;
 select * into d from public.sanji_ig_manual_drafts where owner=p_owner and account_id=p_account and peer_id=p_peer for update;
 if found then
  if d.body<>p_body then return jsonb_build_object('conflict',true);end if;
  if p_expected is null then
   if not exists(select 1 from public.sanji_ig_manual_review_audit a where (a.owner,a.account_id,a.peer_id,a.creator_id,a.conversation_generation,a.conversation_revision,a.draft_updated_at,a.reviewer_type,a.source_check)=(p_owner,p_account,p_peer,p_creator,p_generation,p_revision,d.updated_at,p_reviewer,p_source_check)) then return jsonb_build_object('conflict',true);end if;
  elsif d.updated_at<>p_expected then return jsonb_build_object('conflict',true);end if;
 else
  if p_expected is not null then return jsonb_build_object('conflict',true);end if;
  insert into public.sanji_ig_manual_drafts(owner,account_id,peer_id,body) values(p_owner,p_account,p_peer,p_body) on conflict do nothing returning * into d;
  if d.owner is null then return jsonb_build_object('conflict',true);end if;
 end if;
 insert into public.sanji_ig_manual_review_audit(owner,account_id,peer_id,creator_id,conversation_generation,conversation_revision,draft_updated_at,reviewer_type,source_check,policy_check) values(p_owner,p_account,p_peer,p_creator,p_generation,p_revision,d.updated_at,p_reviewer,p_source_check,p_policy_check) on conflict(owner,account_id,peer_id,conversation_generation,conversation_revision,draft_updated_at,reviewer_type) do nothing;
 return jsonb_build_object('conflict',false,'body',d.body,'updatedAt',d.updated_at);
end $$;
revoke all on function public.sanji_ig_manual_save_reviewed_draft(uuid,text,text,uuid,uuid,uuid,text,timestamptz,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_save_reviewed_draft(uuid,text,text,uuid,uuid,uuid,text,timestamptz,text,text,text) to service_role;
-- Owner-scoped review metadata only. Cursor is an untrusted keyset anchor; it cannot expand scope.
create function public.sanji_ig_manual_review_audit_list(p_owner uuid,p_account text,p_peer text,p_creator uuid,p_generation uuid,p_before timestamptz,p_before_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with account_gate as (select count(*)=1 and coalesce(bool_and(c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account),false) valid from public.sanji_connections c where c.owner=p_owner and c.provider like 'instagram:%' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb and lower(c.summary->>'username')='valu_est'),
 target as (select c.* from public.sanji_ig_manual_conversations c join public.sanji_creator_recovery r on r.owner=c.owner and r.id=c.creator_id and lower(r.handle)=c.username cross join account_gate g where g.valid and c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=p_creator and c.generation_id=p_generation and not c.content_conflict and not c.sync_in_progress and c.checked_at between statement_timestamp()-interval '5 minutes' and statement_timestamp() and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1),
 twentyone as (select a.* from public.sanji_ig_manual_review_audit a join target t on (a.owner,a.account_id,a.peer_id,a.creator_id,a.conversation_generation)=(t.owner,t.account_id,t.peer_id,t.creator_id,t.generation_id) where (p_before is null and p_before_id is null) or (p_before is not null and p_before_id is not null and (a.saved_at,a.audit_id)<(p_before,p_before_id)) order by a.saved_at desc,a.audit_id desc limit 21),
 page as (select * from twentyone order by saved_at desc,audit_id desc limit 20)
 select jsonb_build_object('targetValid',exists(select 1 from target),'hasMore',(select count(*)>20 from twentyone),'events',coalesce((select jsonb_agg(jsonb_build_object('auditId',audit_id,'savedAt',saved_at,'conversationRevision',conversation_revision,'matchesCurrentRevision',conversation_revision=(select t.conversation_revision from target t),'matchesCurrentDraft',draft_updated_at=(select d.updated_at from public.sanji_ig_manual_drafts d join target t on (d.owner,d.account_id,d.peer_id)=(t.owner,t.account_id,t.peer_id)),'draftUpdatedAt',draft_updated_at,'reviewerType',reviewer_type,'sourceCheck',source_check,'policyCheck',policy_check) order by saved_at desc,audit_id desc) from page),'[]'::jsonb),'nextBefore',(select jsonb_build_object('savedAt',saved_at,'auditId',audit_id) from page order by saved_at asc,audit_id asc limit 1));
$$;
revoke all on function public.sanji_ig_manual_review_audit_list(uuid,text,text,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_review_audit_list(uuid,text,text,uuid,uuid,timestamptz,uuid) to service_role;
-- Rotate the local observation revision for every actual message insert, including direct service inserts.
create function public.sanji_ig_manual_message_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.sanji_ig_manual_conversations set conversation_revision=gen_random_uuid() where owner=new.owner and account_id=new.account_id and peer_id=new.peer_id;
 return new;
end $$;
revoke all on function public.sanji_ig_manual_message_revision() from public,anon,authenticated,service_role;
create trigger sanji_ig_manual_message_revision after insert on public.sanji_ig_manual_messages for each row execute function public.sanji_ig_manual_message_revision();
-- Per-batch fencing is checked before/after remote reads; it cannot atomically cancel an HTTP call.
create function public.sanji_ig_manual_sync_active(p_owner uuid,p_account text,p_peer text,p_creator uuid,p_creator_generation uuid,p_generation uuid,p_sync uuid)
returns boolean language sql security invoker set search_path='' as $$
 select (select count(*)=1 and coalesce(bool_and(x.provider='instagram:'||p_account and x.summary->>'accountId'=p_account),false) from public.sanji_connections x where x.owner=p_owner and x.provider like 'instagram:%' and x.summary->'connected'='true'::jsonb and x.summary->'apiVerified'='true'::jsonb and lower(x.summary->>'username')='valu_est') and exists(select 1 from public.sanji_ig_manual_conversations c join public.sanji_creator_recovery r on r.id=c.creator_id and r.owner=c.owner and lower(r.handle)=c.username where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=p_creator and c.creator_generation_id=p_creator_generation and c.generation_id=p_generation and c.sync_id=p_sync and not c.content_conflict and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1)
$$;
revoke all on function public.sanji_ig_manual_sync_active(uuid,text,text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_sync_active(uuid,text,text,uuid,uuid,uuid,uuid) to service_role;
-- Serialize each write with creator deletion and sync replacement; never write a late result to a new generation.
create function public.sanji_ig_manual_store_sync(p_owner uuid,p_account text,p_peer text,p_creator uuid,p_creator_generation uuid,p_generation uuid,p_sync uuid,p_mid text,p_at timestamptz,p_body text,p_direction text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare creator_handle text; stored_handle text; inserted_count integer; prior public.sanji_ig_manual_messages;
begin
 if p_mid is null or length(p_mid) not between 1 and 500 or p_at is null or p_at>clock_timestamp()+interval '5 minutes' or p_at<clock_timestamp()-interval '90 days' or p_body is null or length(trim(p_body))=0 or length(p_body)>10000 or p_direction is distinct from 'inbound' then raise exception 'invalid message';end if;
 if not (select count(*)=1 and coalesce(bool_and(x.provider='instagram:'||p_account and x.summary->>'accountId'=p_account),false) from public.sanji_connections x where x.owner=p_owner and x.provider like 'instagram:%' and x.summary->'connected'='true'::jsonb and x.summary->'apiVerified'='true'::jsonb and lower(x.summary->>'username')='valu_est') then return false;end if;
 select lower(r.handle) into creator_handle from public.sanji_creator_recovery r where r.owner=p_owner and r.id=p_creator and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1 for share;
 if not found then return false;end if;
 select c.username into stored_handle from public.sanji_ig_manual_conversations c where c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.creator_id=p_creator and c.creator_generation_id=p_creator_generation and c.generation_id=p_generation and c.sync_id=p_sync and c.sync_in_progress and not c.content_conflict for update;
 if not found or stored_handle<>creator_handle then return false;end if;
 insert into public.sanji_ig_manual_messages(owner,account_id,peer_id,message_id,received_at,body,direction) values(p_owner,p_account,p_peer,p_mid,p_at,p_body,p_direction) on conflict(owner,account_id,message_id) do nothing;
 get diagnostics inserted_count = row_count;
 if inserted_count=0 then
  select * into prior from public.sanji_ig_manual_messages m where m.owner=p_owner and m.account_id=p_account and m.message_id=p_mid;
  if not found or prior.peer_id is distinct from p_peer or prior.received_at is distinct from p_at or prior.body is distinct from p_body or prior.direction is distinct from p_direction then
   update public.sanji_ig_manual_conversations set content_conflict=true,conversation_revision=gen_random_uuid(),last_direction='review' where owner=p_owner and account_id=p_account and peer_id in (p_peer,prior.peer_id);
   return false;
  end if;
 end if;
 return true;
end $$;
revoke all on function public.sanji_ig_manual_store_sync(uuid,text,text,uuid,uuid,uuid,uuid,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_store_sync(uuid,text,text,uuid,uuid,uuid,uuid,text,timestamptz,text,text) to service_role;
-- Each page uses one STABLE SQL statement and revalidates owner/account/creator/generation.
create function public.sanji_ig_manual_list(p_owner uuid,p_account text,p_since timestamptz,p_after_peer text,p_after_creator uuid,p_after_generation uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with account_gate as (select count(*)=1 and coalesce(bool_and(c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account),false) as valid from public.sanji_connections c where c.owner=p_owner and c.provider like 'instagram:%' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb and lower(c.summary->>'username')='valu_est'),
 eligible as (select c.*,(not c.content_conflict and not c.sync_in_progress and c.checked_at between statement_timestamp()-interval '5 minutes' and statement_timestamp()) as fresh from public.sanji_ig_manual_conversations c join public.sanji_creator_recovery r on r.owner=c.owner and r.id=c.creator_id and lower(r.handle)=c.username cross join account_gate g where g.valid and c.owner=p_owner and c.account_id=p_account and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1),
 candidates as (select e.* from eligible e where not e.fresh or exists(select 1 from public.sanji_ig_manual_drafts d where (d.owner,d.account_id,d.peer_id)=(e.owner,e.account_id,e.peer_id)) or exists(select 1 from public.sanji_ig_manual_messages m where (m.owner,m.account_id,m.peer_id)=(e.owner,e.account_id,e.peer_id) and m.direction='inbound' and m.received_at>=p_since)),
 anchor as (select p_after_peer is null or exists(select 1 from candidates c where c.peer_id=p_after_peer and c.creator_id=p_after_creator and c.generation_id=p_after_generation) as valid),
 four as (select c.* from candidates c cross join anchor a where a.valid and (p_after_peer is null or c.peer_id>p_after_peer) order by c.peer_id limit 4),
 page as (select * from four order by peer_id limit 3),
 rows as (select p.*,m.message_id,m.received_at,m.body as message_body,m.direction,d.body as draft_body,d.updated_at as draft_updated from page p left join lateral (select m.* from public.sanji_ig_manual_messages m where p.fresh and (m.owner,m.account_id,m.peer_id)=(p.owner,p.account_id,p.peer_id) and m.direction='inbound' and m.received_at>=p_since order by m.received_at desc,m.message_id desc limit 1) m on true left join public.sanji_ig_manual_drafts d on p.fresh and (d.owner,d.account_id,d.peer_id)=(p.owner,p.account_id,p.peer_id)),
 payload as (select case when coalesce((select sum(coalesce(octet_length(message_body),0)+coalesce(octet_length(draft_body),0)) from rows),0)>262144 then null else jsonb_build_object(
 'accountValid',(select valid from account_gate),'anchorValid',(select valid from anchor),'hasMore',(select count(*)>3 from four),
 'nextAnchor',(select jsonb_build_object('peer',peer_id,'creator',creator_id,'generation',generation_id,'creatorGeneration',creator_generation_id) from page order by peer_id desc limit 1),
 'items',coalesce((select jsonb_agg(jsonb_build_object('verifiedCreatorMatch',true,'conversationGeneration',generation_id,'conversationRevision',conversation_revision,'account_id',account_id,'peer_id',peer_id,'message_id',message_id,'received_at',received_at,'body',message_body,'direction',direction,'peerProfile',jsonb_build_object('username',username),'creatorId',creator_id,'lastDirection',last_direction) order by peer_id) from rows where fresh and message_id is not null),'[]'::jsonb),
 'draftConversations',coalesce((select jsonb_agg(jsonb_build_object('verifiedCreatorMatch',true,'conversationGeneration',generation_id,'conversationRevision',conversation_revision,'peer_id',peer_id,'peerProfile',jsonb_build_object('username',username),'creatorId',creator_id,'lastDirection','review','draft',jsonb_build_object('body',draft_body,'updatedAt',draft_updated)) order by peer_id) from rows where fresh and draft_updated is not null),'[]'::jsonb),
 'expiredMatches',(select count(*) from rows where not fresh),
 'staleConversations',coalesce((select jsonb_agg(jsonb_build_object('peerId',peer_id,'username',username,'creatorId',creator_id,'contentConflict',content_conflict,'syncInProgress',sync_in_progress,'conversationGeneration',generation_id,'conversationRevision',conversation_revision) order by peer_id) from rows where not fresh),'[]'::jsonb)) end as value)
 select case when value is null or octet_length(value::text)>2097152 then jsonb_build_object('tooMany',true) else value end from payload
$$;
revoke all on function public.sanji_ig_manual_list(uuid,text,timestamptz,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_list(uuid,text,timestamptz,text,uuid,uuid) to service_role;
create function public.sanji_ig_manual_thread(p_owner uuid,p_account text,p_since timestamptz,p_peer text,p_generation uuid,p_creator uuid,p_before_at timestamptz,p_before_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with account_gate as (select count(*)=1 and coalesce(bool_and(c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account),false) as valid from public.sanji_connections c where c.owner=p_owner and c.provider like 'instagram:%' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb and lower(c.summary->>'username')='valu_est'),
 target as (select c.* from public.sanji_ig_manual_conversations c join public.sanji_creator_recovery r on r.owner=c.owner and r.id=c.creator_id and lower(r.handle)=c.username cross join account_gate g where g.valid and c.owner=p_owner and c.account_id=p_account and c.peer_id=p_peer and c.generation_id=p_generation and (p_creator is null or c.creator_id=p_creator) and not c.content_conflict and not c.sync_in_progress and c.checked_at between statement_timestamp()-interval '5 minutes' and statement_timestamp() and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1),
 anchor as (select p_before_at is null or exists(select 1 from public.sanji_ig_manual_messages m join target t on (t.owner,t.account_id,t.peer_id)=(m.owner,m.account_id,m.peer_id) where m.received_at=p_before_at and m.message_id=p_before_id and m.received_at>=p_since) as valid),
 six as (select m.*,t.creator_id,t.username,t.generation_id,t.conversation_revision,t.last_direction from public.sanji_ig_manual_messages m join target t on (t.owner,t.account_id,t.peer_id)=(m.owner,m.account_id,m.peer_id) cross join anchor a where a.valid and m.received_at>=p_since and (p_before_at is null or (m.received_at,m.message_id)<(p_before_at,p_before_id)) order by m.received_at desc,m.message_id desc limit 6),
 page as (select * from six order by received_at desc,message_id desc limit 5),
 d as (select d.* from public.sanji_ig_manual_drafts d join target t on (t.owner,t.account_id,t.peer_id)=(d.owner,d.account_id,d.peer_id)),
 payload as (select case when coalesce((select sum(octet_length(body)) from page),0)+coalesce((select sum(octet_length(body)) from d),0)>262144 then null else jsonb_build_object('accountValid',(select valid from account_gate),'targetValid',exists(select 1 from target),'anchorValid',(select valid from anchor),'hasMore',(select count(*)>5 from six),'creatorId',(select creator_id from target),'username',(select username from target),'conversationRevision',(select conversation_revision from target),'creatorGeneration',(select creator_generation_id from target),'peerId',p_peer,'conversationGeneration',p_generation,
 'nextAnchor',(select jsonb_build_object('at',received_at,'messageId',message_id) from page order by received_at asc,message_id asc limit 1),
 'items',coalesce((select jsonb_agg(jsonb_build_object('verifiedCreatorMatch',true,'conversationGeneration',generation_id,'conversationRevision',conversation_revision,'account_id',account_id,'peer_id',peer_id,'message_id',message_id,'received_at',received_at,'body',body,'direction',direction,'peerProfile',jsonb_build_object('username',username),'creatorId',creator_id,'lastDirection',last_direction) order by received_at desc,message_id desc) from page),'[]'::jsonb),
 'draft',(select jsonb_build_object('body',body,'updatedAt',updated_at) from d)) end as value)
 select case when value is null or octet_length(value::text)>2097152 then jsonb_build_object('tooMany',true) else value end from payload
$$;
revoke all on function public.sanji_ig_manual_thread(uuid,text,timestamptz,text,uuid,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_thread(uuid,text,timestamptz,text,uuid,uuid,timestamptz,text) to service_role;
-- A cursor can only contain a real current anchor; this also protects direct service-role table writes.
create function public.sanji_ig_manual_cursor_anchor_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.payload is null or (new.kind='sync' and new.payload->>'phase'='provider' and new.anchor_creator_id is null) then return new;end if;
 if not exists(select 1 from public.sanji_ig_manual_conversations c join public.sanji_creator_recovery r on r.owner=c.owner and r.id=c.creator_id and lower(r.handle)=c.username where c.owner=new.owner and c.account_id=new.account_id and c.creator_id=new.anchor_creator_id and c.creator_generation_id=new.anchor_creator_generation_id and c.peer_id=new.payload->>'peer' and c.generation_id=(new.payload->>'generation')::uuid and r.entity_type='creator_evidence' and r.assessment<>'excluded' and r.status<>'excluded' and (select count(*) from public.sanji_creator_recovery dup where dup.owner=r.owner and lower(dup.handle)=lower(r.handle))=1 and (new.kind='directory' or (not c.content_conflict and ((new.kind='sync' and new.payload->>'phase'='resume' and c.creator_generation_id=(new.payload->>'creatorGeneration')::uuid and c.sync_id=(new.payload->>'syncId')::uuid and c.conversation_id=new.payload->>'thread') or (new.kind='thread' and exists(select 1 from public.sanji_ig_manual_messages m where (m.owner,m.account_id,m.peer_id)=(c.owner,c.account_id,c.peer_id) and m.message_id=new.payload->>'messageId' and m.received_at=(new.payload->>'at')::timestamptz and m.received_at>=(new.payload->>'since')::timestamptz)))))) then raise exception 'cursor anchor unavailable';end if;
 return new;
end $$;
revoke all on function public.sanji_ig_manual_cursor_anchor_guard() from public,anon,authenticated,service_role;
create trigger sanji_ig_manual_cursor_anchor_guard before insert or update on public.sanji_ig_manual_cursors for each row execute function public.sanji_ig_manual_cursor_anchor_guard();
-- Cursor tokens are random client references, stored only as hashes. Owner/account/purpose are mandatory.
create function public.sanji_ig_manual_cursor_issue(p_owner uuid,p_account text,p_kind text,p_creator uuid,p_creator_generation uuid,p_hash text,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_kind not in ('directory','thread','sync') or p_account !~ '^[0-9]{1,100}$' or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 or p_payload->>'owner' is distinct from p_owner::text or p_payload->>'account' is distinct from p_account or p_payload->>'kind' is distinct from p_kind or not ((p_kind='sync' and p_payload->>'phase'='provider' and p_creator is null and p_creator_generation is null and not (p_payload ? 'creator')) or (p_creator is not null and p_creator_generation is not null and p_payload->>'creator'=p_creator::text and p_payload->>'creatorGeneration'=p_creator_generation::text)) then raise exception 'invalid cursor';end if;
 insert into public.sanji_ig_manual_cursors(owner,kind,account_id,anchor_creator_id,anchor_creator_generation_id,anchor_peer_id,anchor_conversation_generation_id,token_hash,payload,expires_at) values(p_owner,p_kind,p_account,p_creator,p_creator_generation,case when p_creator is null then null else p_payload->>'peer' end,case when p_creator is null then null else (p_payload->>'generation')::uuid end,p_hash,p_payload,clock_timestamp()+interval '10 minutes')
 on conflict(owner,kind) do update set account_id=excluded.account_id,anchor_creator_id=excluded.anchor_creator_id,anchor_creator_generation_id=excluded.anchor_creator_generation_id,anchor_peer_id=excluded.anchor_peer_id,anchor_conversation_generation_id=excluded.anchor_conversation_generation_id,token_hash=excluded.token_hash,payload=excluded.payload,expires_at=excluded.expires_at;
 return true;
end $$;
revoke all on function public.sanji_ig_manual_cursor_issue(uuid,text,text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_cursor_issue(uuid,text,text,uuid,uuid,text,jsonb) to service_role;
create function public.sanji_ig_manual_cursor_take(p_owner uuid,p_account text,p_kind text,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row public.sanji_ig_manual_cursors; result jsonb;
begin
 if p_kind not in ('directory','thread','sync') or p_account !~ '^[0-9]{1,100}$' or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid cursor';end if;
 select * into row from public.sanji_ig_manual_cursors where owner=p_owner and kind=p_kind for update;
 if not found or row.account_id<>p_account or row.token_hash is distinct from p_hash then return null;end if;
 if row.expires_at>clock_timestamp() then result=row.payload;end if;
 update public.sanji_ig_manual_cursors set token_hash=null,payload=null,expires_at=null where owner=p_owner and kind=p_kind;
 return result;
end $$;
revoke all on function public.sanji_ig_manual_cursor_take(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_ig_manual_cursor_take(uuid,text,text,text) to service_role;
-- Fail closed if owner, inherited roles, default ACLs or superuser authority defeat the intended ACL.
-- This does not modify role memberships, ownership or default privileges.
do $$
declare obj record; grant_row record; col record; p text; restricted_role text;
begin
 foreach restricted_role in array array['service_role','anon','authenticated'] loop
  if exists(select 1 from pg_catalog.pg_roles r where r.rolsuper and pg_catalog.pg_has_role(restricted_role,r.oid,'MEMBER')) then raise exception '% can assume a superuser role',restricted_role;end if;
  if exists(select 1 from pg_catalog.pg_roles r where (r.rolname in ('pg_write_all_data','pg_maintain') or (restricted_role<>'service_role' and r.rolname='pg_read_all_data')) and pg_catalog.pg_has_role(restricted_role,r.oid,'MEMBER')) then raise exception '% can assume a broad built-in role',restricted_role;end if;
 end loop;
 for obj in select c.oid,c.relowner,n.nspname,c.relname,c.relacl from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('sanji_ig_manual_conversations','sanji_ig_manual_messages','sanji_ig_manual_drafts','sanji_ig_manual_cursors') and c.relkind='r' loop
  foreach restricted_role in array array['service_role','anon','authenticated'] loop
   if pg_catalog.pg_has_role(restricted_role,obj.relowner,'MEMBER') then raise exception '% owns or inherits ownership of %',restricted_role,obj.relname;end if;
  end loop;
  if pg_catalog.pg_has_role('anon','service_role','MEMBER') or pg_catalog.pg_has_role('authenticated','service_role','MEMBER') then raise exception 'client role can assume service_role';end if;
  for col in select attname,attacl from pg_catalog.pg_attribute where attrelid=obj.oid and attnum>0 and not attisdropped and attacl is not null loop
   for grant_row in select * from pg_catalog.aclexplode(col.attacl) loop
    if obj.relname<>'sanji_ig_manual_conversations' or grant_row.grantee<>'service_role'::regrole::oid or grant_row.is_grantable or not ((grant_row.privilege_type='INSERT' and col.attname in ('owner','account_id','peer_id','creator_id','creator_generation_id','username','conversation_id','provider_updated_at','checked_at','last_direction','sync_id','sync_in_progress')) or (grant_row.privilege_type='UPDATE' and col.attname in ('conversation_id','provider_updated_at','checked_at','last_direction','sync_id','conversation_revision','content_conflict','sync_in_progress'))) then raise exception 'unexpected column ACL on %.%',obj.relname,col.attname;end if;
   end loop;
  end loop;
  foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
   if pg_catalog.has_any_column_privilege('anon',obj.oid,p) or pg_catalog.has_any_column_privilege('authenticated',obj.oid,p) then raise exception 'unexpected client column privilege % on %',p,obj.relname;end if;
  end loop;
  if not (select relrowsecurity from pg_catalog.pg_class where oid=obj.oid) then raise exception 'RLS is not enabled on %',obj.relname;end if;
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if pg_catalog.has_table_privilege('anon',obj.oid,p) or pg_catalog.has_table_privilege('authenticated',obj.oid,p) then raise exception 'unexpected client privilege % on %',p,obj.relname;end if;
  end loop;
  if not pg_catalog.has_table_privilege('service_role',obj.oid,'SELECT') then raise exception 'missing required privilege on %',obj.relname;end if;
  if obj.relname='sanji_ig_manual_conversations' then
   if pg_catalog.has_table_privilege('service_role',obj.oid,'INSERT') or pg_catalog.has_table_privilege('service_role',obj.oid,'UPDATE') or pg_catalog.has_column_privilege('service_role',obj.oid,'generation_id','INSERT') or pg_catalog.has_column_privilege('service_role',obj.oid,'generation_id','UPDATE') then raise exception 'unexpected conversation generation privilege';end if;
   foreach p in array array['owner','account_id','peer_id','creator_id','creator_generation_id','username','conversation_id','provider_updated_at','checked_at','last_direction','sync_id','sync_in_progress'] loop if not pg_catalog.has_column_privilege('service_role',obj.oid,p,'INSERT') then raise exception 'missing conversation insert privilege';end if;end loop;
   foreach p in array array['conversation_id','provider_updated_at','checked_at','last_direction','sync_id','conversation_revision','content_conflict','sync_in_progress'] loop if not pg_catalog.has_column_privilege('service_role',obj.oid,p,'UPDATE') then raise exception 'missing conversation update privilege';end if;end loop;
  elsif not pg_catalog.has_table_privilege('service_role',obj.oid,'INSERT') or (obj.relname in ('sanji_ig_manual_drafts','sanji_ig_manual_cursors') and not pg_catalog.has_table_privilege('service_role',obj.oid,'UPDATE')) then raise exception 'missing required privilege on %',obj.relname;end if;
  for grant_row in select * from pg_catalog.aclexplode(coalesce(obj.relacl,pg_catalog.acldefault('r',obj.relowner))) loop
   if grant_row.grantee not in (obj.relowner,'service_role'::regrole::oid) or grant_row.is_grantable then raise exception 'unexpected table ACL on %',obj.relname;end if;
   if grant_row.grantee='service_role'::regrole::oid and (grant_row.privilege_type not in ('SELECT','INSERT','UPDATE') or (obj.relname='sanji_ig_manual_messages' and grant_row.privilege_type='UPDATE') or (obj.relname='sanji_ig_manual_conversations' and grant_row.privilege_type in ('INSERT','UPDATE'))) then raise exception 'unexpected table ACL privilege % on %',grant_row.privilege_type,obj.relname;end if;
  end loop;
  foreach p in array array['DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if pg_catalog.has_table_privilege('service_role',obj.oid,p) then raise exception 'unexpected effective table privilege % on %',p,obj.relname;end if;
  end loop;
  if obj.relname='sanji_ig_manual_messages' and pg_catalog.has_any_column_privilege('service_role',obj.oid,'UPDATE') then raise exception 'unexpected message update privilege';end if;
  if pg_catalog.has_any_column_privilege('service_role',obj.oid,'REFERENCES') then raise exception 'unexpected service column references privilege on %',obj.relname;end if;
  foreach p in array array['SELECT','INSERT','UPDATE'] loop
   if pg_catalog.has_table_privilege('service_role',obj.oid,p||' WITH GRANT OPTION') then raise exception 'unexpected grant option % on %',p,obj.relname;end if;
  end loop;
 end loop;
 select c.oid,c.relowner,c.relacl into obj from pg_catalog.pg_class c where c.oid='public.sanji_ig_manual_review_audit'::regclass;
 foreach restricted_role in array array['service_role','anon','authenticated'] loop if pg_catalog.pg_has_role(restricted_role,obj.relowner,'MEMBER') then raise exception 'unsafe audit owner';end if;end loop;
 for grant_row in select * from pg_catalog.aclexplode(coalesce(obj.relacl,pg_catalog.acldefault('r',obj.relowner))) loop if grant_row.is_grantable or (grant_row.grantee<>obj.relowner and not (grant_row.grantee='service_role'::regrole::oid and grant_row.privilege_type='SELECT')) then raise exception 'unexpected audit ACL';end if;end loop;
 for col in select attname,attacl from pg_catalog.pg_attribute where attrelid=obj.oid and attnum>0 and not attisdropped and attacl is not null loop for grant_row in select * from pg_catalog.aclexplode(col.attacl) loop if grant_row.grantee<>'service_role'::regrole::oid or grant_row.is_grantable or grant_row.privilege_type<>'INSERT' or col.attname not in ('owner','account_id','peer_id','creator_id','conversation_generation','conversation_revision','draft_updated_at','reviewer_type','source_check','policy_check') then raise exception 'unexpected audit column ACL';end if;end loop;end loop;
 foreach restricted_role in array array['anon','authenticated'] loop foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop if pg_catalog.has_any_column_privilege(restricted_role,obj.oid,p) then raise exception 'unsafe audit client access';end if;end loop; foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop if pg_catalog.has_table_privilege(restricted_role,obj.oid,p) then raise exception 'unsafe audit client access';end if;end loop;end loop;
 if not pg_catalog.has_table_privilege('service_role',obj.oid,'SELECT') then raise exception 'missing audit read access';end if;
 foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop if pg_catalog.has_table_privilege('service_role',obj.oid,p) then raise exception 'unexpected audit table access';end if;end loop;
 foreach p in array array['owner','account_id','peer_id','creator_id','conversation_generation','conversation_revision','draft_updated_at','reviewer_type','source_check','policy_check'] loop if not pg_catalog.has_column_privilege('service_role',obj.oid,p,'INSERT') then raise exception 'missing audit insert access';end if;end loop;
 if not (select relrowsecurity from pg_catalog.pg_class where oid=obj.oid) or pg_catalog.has_column_privilege('service_role',obj.oid,'saved_at','INSERT') or pg_catalog.has_column_privilege('service_role',obj.oid,'audit_id','INSERT') or pg_catalog.has_any_column_privilege('service_role',obj.oid,'UPDATE') or pg_catalog.has_any_column_privilege('service_role',obj.oid,'REFERENCES') then raise exception 'unsafe audit access';end if;
 select c.oid,c.relowner,c.relacl into obj from pg_catalog.pg_class c where c.oid='public.sanji_ig_creator_generations'::regclass;
 foreach restricted_role in array array['service_role','anon','authenticated'] loop if pg_catalog.pg_has_role(restricted_role,obj.relowner,'MEMBER') then raise exception 'unsafe creator generation owner';end if;end loop;
 for grant_row in select * from pg_catalog.aclexplode(coalesce(obj.relacl,pg_catalog.acldefault('r',obj.relowner))) loop if grant_row.grantee not in (obj.relowner,'service_role'::regrole::oid) or grant_row.is_grantable or (grant_row.grantee='service_role'::regrole::oid and grant_row.privilege_type<>'SELECT') then raise exception 'unexpected creator generation ACL';end if;end loop;
 for col in select attname,attacl from pg_catalog.pg_attribute where attrelid=obj.oid and attnum>0 and not attisdropped and attacl is not null loop for grant_row in select * from pg_catalog.aclexplode(col.attacl) loop if grant_row.grantee<>'service_role'::regrole::oid or grant_row.is_grantable or grant_row.privilege_type<>'INSERT' or col.attname not in ('owner','creator_id') then raise exception 'unexpected creator generation column ACL';end if;end loop;end loop;
 foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop if pg_catalog.has_table_privilege('service_role',obj.oid,p) then raise exception 'unexpected creator generation privilege';end if;end loop;
 if not pg_catalog.has_table_privilege('service_role',obj.oid,'SELECT') or not pg_catalog.has_column_privilege('service_role',obj.oid,'owner','INSERT') or not pg_catalog.has_column_privilege('service_role',obj.oid,'creator_id','INSERT') then raise exception 'missing creator generation access';end if;
 foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
  if pg_catalog.has_any_column_privilege('anon',obj.oid,p) or pg_catalog.has_any_column_privilege('authenticated',obj.oid,p) then raise exception 'unsafe creator generation client access';end if;
 end loop;
 foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
  if pg_catalog.has_table_privilege('anon',obj.oid,p) or pg_catalog.has_table_privilege('authenticated',obj.oid,p) or pg_catalog.has_table_privilege('service_role',obj.oid,p||' WITH GRANT OPTION') then raise exception 'unsafe creator generation access';end if;
 end loop;
 if not (select relrowsecurity from pg_catalog.pg_class where oid=obj.oid) or pg_catalog.has_column_privilege('service_role',obj.oid,'generation','INSERT') or pg_catalog.has_any_column_privilege('service_role',obj.oid,'UPDATE') or pg_catalog.has_any_column_privilege('service_role',obj.oid,'REFERENCES') then raise exception 'unsafe creator generation access';end if;
 for obj in select p.oid,p.proowner,p.proacl,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sanji_ig_manual_acquire_target','sanji_ig_manual_save_draft','sanji_ig_manual_save_reviewed_draft','sanji_ig_manual_review_audit_list','sanji_ig_manual_sync_active','sanji_ig_manual_store_sync','sanji_ig_manual_list','sanji_ig_manual_thread','sanji_ig_manual_cursor_issue','sanji_ig_manual_cursor_take','sanji_ig_manual_cursor_anchor_guard','sanji_ig_manual_message_revision') loop
  foreach restricted_role in array array['service_role','anon','authenticated'] loop
   if pg_catalog.pg_has_role(restricted_role,obj.proowner,'MEMBER') then raise exception '% owns or inherits ownership of %',restricted_role,obj.proname;end if;
  end loop;
  for grant_row in select * from pg_catalog.aclexplode(coalesce(obj.proacl,pg_catalog.acldefault('f',obj.proowner))) loop
   if grant_row.grantee not in (obj.proowner,'service_role'::regrole::oid) or grant_row.is_grantable then raise exception 'unexpected function ACL on %',obj.proname;end if;
  end loop;
  if obj.proname in ('sanji_ig_manual_cursor_anchor_guard','sanji_ig_manual_message_revision') then
   if pg_catalog.has_function_privilege('service_role',obj.oid,'EXECUTE') then raise exception 'unexpected trigger execute privilege';end if;
  elsif not pg_catalog.has_function_privilege('service_role',obj.oid,'EXECUTE') then raise exception 'missing required function privilege on %',obj.proname;end if;
  if pg_catalog.has_function_privilege('service_role',obj.oid,'EXECUTE WITH GRANT OPTION') or pg_catalog.has_function_privilege('anon',obj.oid,'EXECUTE') or pg_catalog.has_function_privilege('authenticated',obj.oid,'EXECUTE') then raise exception 'unexpected effective function privilege on %',obj.proname;end if;
 end loop;
end $$;
commit;
