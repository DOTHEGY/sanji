-- Generated with Supabase CLI 3.0.0 after explicit rollout approval.
-- No provider state or legacy grants are changed. Service API must authenticate
-- JWT + membership and derive owner from the verified user, never request JSON.
begin;
create table public.sanji_creator_manual_notes (
 owner uuid not null,
 creator_id uuid not null,
 note_id uuid not null,
 handle text not null check(handle ~ '^[a-z0-9._]{1,30}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 supersedes_id uuid,
 payload jsonb not null,
 primary key(owner,note_id),
 unique(owner,creator_id,note_id),
 foreign key(creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade,
 foreign key(owner,creator_id,supersedes_id) references public.sanji_creator_manual_notes(owner,creator_id,note_id),
 check(supersedes_id is distinct from note_id)
);
create index sanji_creator_manual_notes_page on public.sanji_creator_manual_notes(owner,creator_id,recorded_at desc,note_id desc);
create index sanji_creator_manual_notes_owner_page on public.sanji_creator_manual_notes(owner,recorded_at desc,note_id desc);
alter table public.sanji_creator_manual_notes enable row level security;
revoke all on public.sanji_creator_manual_notes from public,anon,authenticated,service_role;
grant select on public.sanji_creator_manual_notes to service_role;
grant insert(owner,creator_id,note_id,handle,supersedes_id,payload) on public.sanji_creator_manual_notes to service_role;

-- An invoker trigger also guards direct service inserts, including conflict retries.
create function public.sanji_creator_manual_note_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text; observed text; observed_date date; observed_time timestamptz; target public.sanji_creator_recovery;
begin
 if new.owner is null or new.creator_id is null or new.note_id is null then raise exception 'invalid manual note' using errcode='22023';end if;
 perform 1 from public.sanji_members where user_id=new.owner for share;
 if not found then raise exception 'manual note membership required' using errcode='42501';end if;
 -- Existing recovery unique(owner,handle) + lowercase handle CHECK prevent
 -- duplicate insertion; row lock preserves identity/eligibility through commit.
 select * into target from public.sanji_creator_recovery where owner=new.owner and id=new.creator_id for share;
 if not found or target.entity_type is distinct from 'creator_evidence'
 or target.assessment is null or target.assessment='excluded' or target.status is null or target.status='excluded'
 or target.handle is distinct from new.handle
 or (select count(*) from public.sanji_creator_recovery where owner=new.owner and lower(handle)=lower(new.handle))<>1
 then raise exception 'manual note target unavailable' using errcode='22023';end if;
 if jsonb_typeof(new.payload) is distinct from 'object'
 or not (new.payload ?& array['observedAt','sourceUrl','inboundWhen','summary','intent','afterInboundOutbound','recorderType'])
 or exists(select 1 from jsonb_object_keys(new.payload) key where key<>all(array['observedAt','sourceUrl','inboundWhen','summary','draft','intent','afterInboundOutbound','recorderType']))
 then raise exception 'invalid manual note payload' using errcode='22023';end if;
 for k in select jsonb_object_keys(new.payload) loop
  if jsonb_typeof(new.payload->k) is distinct from 'string' then raise exception 'invalid manual note field' using errcode='22023';end if;
 end loop;
 if (new.payload->>'summary') !~ '[^[:space:]]' or length(new.payload->>'summary')>4000
 or length(coalesce(new.payload->>'draft',''))>5000
 or length(new.payload->>'inboundWhen')>500 or length(new.payload->>'intent')>500 or length(new.payload->>'afterInboundOutbound')>500
 or new.payload->>'recorderType' not in ('user','assistant','other_authorized_worker')
 or new.payload->>'sourceUrl' !~ '^https://(www\.)?instagram\.com/direct/t/[0-9]+/?$'
 or length(new.payload->>'sourceUrl')>2048
 then raise exception 'invalid manual note field' using errcode='22023';end if;
 observed:=new.payload->>'observedAt';
 begin
  if substring(observed,1,4)::integer<2000 then raise exception 'year';end if;
  if observed ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   observed_date:=observed::date;
   if observed_date>(statement_timestamp() at time zone 'UTC')::date then raise exception 'future';end if;
  elsif observed ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
   observed_date:=substring(observed,1,10)::date;
   observed_time:=observed::timestamptz;
   if observed_time>statement_timestamp() then raise exception 'future';end if;
  else raise exception 'format';end if;
 exception when others then raise exception 'invalid manual note observed time' using errcode='22023';end;
 if new.supersedes_id is not null and (new.supersedes_id=new.note_id or not exists(select 1 from public.sanji_creator_manual_notes where owner=new.owner and creator_id=new.creator_id and note_id=new.supersedes_id))
 then raise exception 'manual note correction target unavailable' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.sanji_creator_manual_note_guard() from public,anon,authenticated,service_role;
create trigger sanji_creator_manual_note_insert_guard before insert on public.sanji_creator_manual_notes for each row execute function public.sanji_creator_manual_note_guard();

create function public.sanji_creator_manual_note_save(p_owner uuid,p_creator uuid,p_handle text,p_note uuid,p_payload jsonb,p_supersedes uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.sanji_creator_manual_notes; inserted boolean;
begin
 insert into public.sanji_creator_manual_notes(owner,creator_id,note_id,handle,payload,supersedes_id)
 values(p_owner,p_creator,p_note,p_handle,p_payload,p_supersedes)
 on conflict(owner,note_id) do nothing returning * into saved;
 inserted:=found;
 if not inserted then
  select * into saved from public.sanji_creator_manual_notes where owner=p_owner and note_id=p_note;
  if not found or saved.creator_id is distinct from p_creator or saved.handle is distinct from p_handle
   or saved.payload is distinct from p_payload or saved.supersedes_id is distinct from p_supersedes
  then raise exception 'manual note id conflict' using errcode='23505';end if;
 end if;
 return jsonb_build_object('duplicate',not inserted,'note',jsonb_build_object(
  'id',saved.note_id,'creatorId',saved.creator_id,'handle',saved.handle,'recordedAt',saved.recorded_at,
  'supersedesId',saved.supersedes_id,'payload',saved.payload,'recordType','manual_historical_note','latestVerified',false,'dispatchState','not_sent'));
end $$;
revoke all on function public.sanji_creator_manual_note_save(uuid,uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_creator_manual_note_save(uuid,uuid,text,uuid,jsonb,uuid) to service_role;

-- Fail closed rather than modifying pre-existing roles, inherited access or defaults.
do $$
declare obj record; a record; col record; r text; p text;
begin
 foreach r in array array['service_role','anon','authenticated'] loop
  if exists(select 1 from pg_catalog.pg_roles x where (x.rolsuper or x.rolname in ('pg_write_all_data','pg_maintain') or (r<>'service_role' and x.rolname='pg_read_all_data')) and pg_catalog.pg_has_role(r,x.oid,'MEMBER')) then raise exception 'unsafe broad role membership';end if;
 end loop;
 if pg_catalog.pg_has_role('anon','service_role','MEMBER') or pg_catalog.pg_has_role('authenticated','service_role','MEMBER') then raise exception 'unsafe service role membership';end if;
 select * into obj from pg_catalog.pg_class where oid='public.sanji_creator_manual_notes'::regclass;
 foreach r in array array['service_role','anon','authenticated'] loop
  if pg_catalog.pg_has_role(r,obj.relowner,'MEMBER') then raise exception 'unsafe table ownership';end if;
 end loop;
 for a in select * from pg_catalog.aclexplode(coalesce(obj.relacl,pg_catalog.acldefault('r',obj.relowner))) loop
  if a.grantee not in (obj.relowner,'service_role'::regrole::oid) or a.is_grantable or (a.grantee='service_role'::regrole::oid and a.privilege_type<>'SELECT') then raise exception 'unexpected manual note table ACL';end if;
 end loop;
 for col in select attname,attacl from pg_catalog.pg_attribute where attrelid=obj.oid and attnum>0 and not attisdropped and attacl is not null loop
  for a in select * from pg_catalog.aclexplode(col.attacl) loop
   if a.grantee<>'service_role'::regrole::oid or a.is_grantable or a.privilege_type<>'INSERT' or col.attname not in ('owner','creator_id','note_id','handle','payload','supersedes_id') then raise exception 'unexpected manual note column ACL';end if;
  end loop;
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if pg_catalog.has_table_privilege(r,obj.oid,p) is distinct from (r='service_role' and p='SELECT') or pg_catalog.has_table_privilege(r,obj.oid,p||' WITH GRANT OPTION') then raise exception 'unexpected effective table privilege';end if;
  end loop;
  foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
   if pg_catalog.has_any_column_privilege(r,obj.oid,p) is distinct from (r='service_role' and p in ('SELECT','INSERT')) then raise exception 'unexpected effective column privilege';end if;
  end loop;
 end loop;
 foreach p in array array['owner','creator_id','note_id','handle','supersedes_id','payload'] loop
  if not pg_catalog.has_column_privilege('service_role',obj.oid,p,'INSERT') then raise exception 'missing manual note insert privilege';end if;
 end loop;
 if not obj.relrowsecurity or pg_catalog.has_column_privilege('service_role',obj.oid,'recorded_at','INSERT') or exists(select 1 from pg_catalog.pg_policy where polrelid=obj.oid) then raise exception 'unsafe manual note row access';end if;
 for obj in select * from pg_catalog.pg_proc where oid in ('public.sanji_creator_manual_note_guard()'::regprocedure,'public.sanji_creator_manual_note_save(uuid,uuid,text,uuid,jsonb,uuid)'::regprocedure) loop
  if obj.prosecdef then raise exception 'unsafe definer function';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
   if pg_catalog.pg_has_role(r,obj.proowner,'MEMBER') then raise exception 'unsafe function ownership';end if;
   if pg_catalog.has_function_privilege(r,obj.oid,'EXECUTE') is distinct from (r='service_role' and obj.proname='sanji_creator_manual_note_save') or pg_catalog.has_function_privilege(r,obj.oid,'EXECUTE WITH GRANT OPTION') then raise exception 'unexpected effective function privilege';end if;
  end loop;
  for a in select * from pg_catalog.aclexplode(coalesce(obj.proacl,pg_catalog.acldefault('f',obj.proowner))) loop
   if a.grantee not in (obj.proowner,'service_role'::regrole::oid) or a.is_grantable then raise exception 'unexpected manual note function ACL';end if;
  end loop;
 end loop;
end $$;
commit;
