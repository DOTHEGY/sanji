-- Run in the Supabase SQL editor as the project administrator.
-- Additive only: existing unrelated project tables are not modified.
begin;
create table if not exists public.sanji_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.sanji_members enable row level security;
drop policy if exists sanji_member_self on public.sanji_members;
create policy sanji_member_self on public.sanji_members for select to authenticated using(user_id=auth.uid());
grant select on public.sanji_members to authenticated;
create or replace function public.sanji_is_member() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.sanji_members where user_id=auth.uid())$$;
revoke all on function public.sanji_is_member() from public,anon,authenticated;
grant execute on function public.sanji_is_member() to authenticated;
create table if not exists public.sanji_records (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('candidate','deal','template','thread','settings')),
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object'),
 version integer not null default 1,updated timestamptz not null default now()
);
create index if not exists sanji_owner_kind on public.sanji_records(owner,kind);
create unique index if not exists sanji_company_unique on public.sanji_records(owner,lower(data->>'companyKey')) where kind='candidate' and coalesce(data->>'companyKey','')<>'';
create unique index if not exists sanji_handle_unique on public.sanji_records(owner,lower(data->>'handle')) where kind='candidate' and coalesce(data->>'handle','')<>'';
create unique index if not exists sanji_email_unique on public.sanji_records(owner,lower(data#>>'{contact,email}')) where kind='candidate' and coalesce(data#>>'{contact,email}','')<>'';
create unique index if not exists sanji_one_settings on public.sanji_records(owner) where kind='settings';
alter table public.sanji_records enable row level security;
drop policy if exists sanji_record_read on public.sanji_records;
create policy sanji_record_read on public.sanji_records for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_records to authenticated;
revoke insert,update,delete on public.sanji_records from anon,authenticated;
create table if not exists public.sanji_suppression(owner uuid not null references auth.users(id) on delete cascade,identity text not null,reason text not null,primary key(owner,identity));
alter table public.sanji_suppression enable row level security;
drop policy if exists sanji_suppression_read on public.sanji_suppression;
create policy sanji_suppression_read on public.sanji_suppression for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_suppression to authenticated;
create table if not exists public.sanji_audit(id bigint generated always as identity primary key,owner uuid not null references auth.users(id) on delete cascade,action text not null,data jsonb not null default '{}',created timestamptz not null default now());
alter table public.sanji_audit enable row level security;
drop policy if exists sanji_audit_read on public.sanji_audit;
create policy sanji_audit_read on public.sanji_audit for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_audit to authenticated;
create table if not exists public.sanji_connections(owner uuid not null references auth.users(id) on delete cascade,provider text not null,encrypted text not null,summary jsonb not null default '{}',primary key(owner,provider));
alter table public.sanji_connections enable row level security;
-- No browser read policies for OAuth tokens or pending authentication state.
create table if not exists public.sanji_oauth_states(state text primary key,owner uuid not null references auth.users(id) on delete cascade,provider text not null,verifier text not null,expires timestamptz not null);
alter table public.sanji_oauth_states enable row level security;
create table if not exists public.sanji_drafts(id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,data jsonb not null,hash text not null,expires timestamptz not null,used boolean not null default false);
alter table public.sanji_drafts enable row level security;
create table if not exists public.sanji_outbox(id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,target uuid not null,channel text not null,fingerprint text not null unique,status text not null,data jsonb not null,created timestamptz not null default now());
alter table public.sanji_outbox enable row level security;
drop policy if exists sanji_outbox_read on public.sanji_outbox;
create policy sanji_outbox_read on public.sanji_outbox for select to authenticated using(owner=auth.uid() and public.sanji_is_member());
grant select on public.sanji_outbox to authenticated;
create table if not exists public.sanji_webhook_events(id text primary key,created timestamptz not null default now());
alter table public.sanji_webhook_events enable row level security;
revoke all on public.sanji_connections,public.sanji_oauth_states,public.sanji_drafts,public.sanji_webhook_events from anon,authenticated;
-- Service role is only used inside the Edge Function after verified user membership.
grant all on public.sanji_members,public.sanji_records,public.sanji_suppression,public.sanji_audit,public.sanji_connections,public.sanji_oauth_states,public.sanji_drafts,public.sanji_outbox,public.sanji_webhook_events to service_role;
grant usage,select on sequence public.sanji_audit_id_seq to service_role;
create or replace function public.sanji_identities(p_data jsonb) returns text[] language sql immutable set search_path='' as $$
 select array_remove(array[nullif(lower(p_data#>>'{contact,email}'),''),case when coalesce(p_data->>'companyKey','')<>'' then 'company:'||lower(p_data->>'companyKey') end,case when coalesce(p_data->>'handle','')<>'' then 'instagram:'||lower(p_data->>'handle') end,nullif(p_data->>'profile','')],null)
$$;
create or replace function public.sanji_blocked(p_owner uuid,p_data jsonb) returns boolean language sql stable security definer set search_path='' as $$select coalesce(p_data->>'status' in ('거절','수신 거부'),false) or exists(select 1 from public.sanji_suppression where owner=p_owner and identity=any(public.sanji_identities(p_data)))$$;
revoke all on function public.sanji_blocked(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_blocked(uuid,jsonb) to service_role;
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
create or replace function public.sanji_manage_thread(p_id uuid,p_version integer,p_data jsonb) returns public.sanji_records language plpgsql security definer set search_path='' as $$
declare t public.sanji_records;result public.sanji_records;c public.sanji_records;ident text;
begin
 if not public.sanji_is_member() then raise exception '권한 없음' using errcode='42501';end if;
 select * into t from public.sanji_records where id=p_id and owner=auth.uid() and kind='thread' for update;
 if not found or t.version is distinct from p_version then raise exception '대화가 없거나 변경됐습니다.' using errcode='40001';end if;
 if p_data->>'classification' not in('미분류','자동 응답','관심 회신','단순 안내','거절','수신 거부','수락','공동구매 확정') then raise exception '회신 분류 오류';end if;
 update public.sanji_records set data=data||jsonb_build_object('owner',coalesce(p_data->>'owner',''),'next',coalesce(p_data->>'next',''),'due',coalesce(p_data->>'due',''),'classification',p_data->>'classification'),version=version+1,updated=now() where id=p_id returning * into result;
 if p_data->>'classification' in('거절','수신 거부') then
 select * into c from public.sanji_records where id=(t.data->>'target')::uuid and owner=auth.uid() and kind='candidate';
 if found then foreach ident in array public.sanji_identities(c.data) loop insert into public.sanji_suppression values(auth.uid(),ident,p_data->>'classification') on conflict(owner,identity) do update set reason=excluded.reason;end loop;
 update public.sanji_records set data=jsonb_set(data,'{status}',p_data->'classification'),version=version+1,updated=now() where id=c.id;end if;end if;return result;
end $$;
revoke all on function public.sanji_manage_thread(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_manage_thread(uuid,integer,jsonb) to authenticated;
create or replace function public.sanji_connection_status() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(provider,summary),'{}'::jsonb) from public.sanji_connections where owner=auth.uid() and public.sanji_is_member()
$$;
revoke all on function public.sanji_connection_status() from public,anon,authenticated;
grant execute on function public.sanji_connection_status() to authenticated;
create or replace function public.sanji_reserve_dispatch(p_owner uuid,p_draft uuid,p_hash text,p_fingerprint text) returns public.sanji_outbox language plpgsql security definer set search_path='' as $$
declare d public.sanji_drafts;t public.sanji_records;s public.sanji_records;v jsonb;lim integer;result public.sanji_outbox;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 select * into d from public.sanji_drafts where id=p_draft and owner=p_owner for update;
 if not found or d.used or d.expires<now() or d.hash<>p_hash then raise exception '승인 미리보기 만료 또는 중복';end if;
 select * into t from public.sanji_records where id=(d.data->>'target')::uuid and owner=p_owner and kind='candidate';
 if not found or t.version<>(d.data->>'targetVersion')::integer or public.sanji_blocked(p_owner,t.data) then raise exception '수신자가 변경됐거나 수신 거부 대상입니다.';end if;
 for v in select * from jsonb_array_elements(d.data->'dealVersions') loop
 if not exists(select 1 from public.sanji_records where id=(v->>'id')::uuid and owner=p_owner and kind='deal' and version=(v->>'version')::integer and data->>'state'='확정') then raise exception '상품 조건이 변경되었습니다.';end if;end loop;
 if coalesce(d.data->>'replyTo','')='' then
  if exists(select 1 from public.sanji_outbox where owner=p_owner and target=t.id) or exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and data->>'target'=t.id::text) then raise exception '기존 연락 이력이 있습니다. 기존 대화에서 회신하세요.';end if;
 else if not exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and id=(d.data->>'replyTo')::uuid and data->>'target'=t.id::text and data->>'channel'=d.data->>'channel') then raise exception '회신 대상 불일치';end if;end if;
 select * into s from public.sanji_records where owner=p_owner and kind='settings';lim:=coalesce((s.data->>'dailyLimit')::integer,20);
 if (select count(*) from public.sanji_outbox where owner=p_owner and created>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=lim then raise exception '일일 제한 초과';end if;
 update public.sanji_drafts set used=true where id=d.id;
 insert into public.sanji_outbox(owner,target,channel,fingerprint,status,data) values(p_owner,t.id,d.data->>'channel',p_fingerprint,'submitting',(d.data-'attachments')||jsonb_build_object('attachments',coalesce(d.data->'attachmentSummary','[]'::jsonb))) returning * into result;return result;
end $$;
revoke all on function public.sanji_reserve_dispatch(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sanji_reserve_dispatch(uuid,uuid,text,text) to service_role;
-- Private attachments bucket. Only members may read/write their own UUID prefix.
insert into storage.buckets(id,name,public,file_size_limit) values('sanji-attachments','sanji-attachments',false,5242880) on conflict(id) do nothing;
drop policy if exists sanji_storage_read on storage.objects;
create policy sanji_storage_read on storage.objects for select to authenticated using(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
drop policy if exists sanji_storage_insert on storage.objects;
create policy sanji_storage_insert on storage.objects for insert to authenticated with check(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
drop policy if exists sanji_storage_delete on storage.objects;
create policy sanji_storage_delete on storage.objects for delete to authenticated using(bucket_id='sanji-attachments' and (storage.foldername(name))[1]=auth.uid()::text and public.sanji_is_member());
commit;
