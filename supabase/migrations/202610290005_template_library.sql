begin;
-- A standalone library never mutates sanji_records or invokes outbound-copy triggers.
create table if not exists public.sanji_template_library(id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,data jsonb not null check(jsonb_typeof(data)='object'),legacy_record_id uuid,version integer not null default 1,archived boolean not null default false,created timestamptz not null default now(),updated timestamptz not null default now());
create table if not exists public.sanji_template_library_versions(template_id uuid not null references public.sanji_template_library(id) on delete cascade,owner uuid not null references auth.users(id) on delete cascade,version integer not null,data jsonb not null,archived boolean not null,created timestamptz not null default now(),primary key(template_id,version));
alter table public.sanji_template_library enable row level security;alter table public.sanji_template_library_versions enable row level security;
revoke all on public.sanji_template_library,public.sanji_template_library_versions from public,anon,authenticated;
grant all on public.sanji_template_library,public.sanji_template_library_versions to service_role;
create unique index if not exists sanji_template_library_legacy_once on public.sanji_template_library(owner,legacy_record_id) where legacy_record_id is not null;
insert into public.sanji_template_library(owner,data,legacy_record_id) select owner,data,id from public.sanji_records where kind='template' and coalesce(data->>'purpose','')<>'brand_auto_profile' on conflict do nothing;
insert into public.sanji_template_library_versions(template_id,owner,version,data,archived) select id,owner,version,data,archived from public.sanji_template_library on conflict do nothing;
create or replace function public.sanji_template_library_change(p_owner uuid,p_action text,p_id uuid,p_version integer,p_data jsonb) returns public.sanji_template_library language plpgsql security definer set search_path='' as $$
declare r public.sanji_template_library;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 if p_action='create' then
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception '템플릿 내용 오류';end if;
  insert into public.sanji_template_library(owner,data) values(p_owner,p_data) returning * into r;
 elsif p_action in ('edit','archive','restore') then
  select * into r from public.sanji_template_library where owner=p_owner and id=p_id for update;
  if not found or r.version is distinct from p_version then raise exception '템플릿이 변경됐습니다. 다시 불러오세요';end if;
  if p_action='edit' and (r.archived or jsonb_typeof(p_data) is distinct from 'object') then raise exception '보관된 템플릿은 복구 후 수정하세요';end if;
  if (p_action='archive' and r.archived) or (p_action='restore' and not r.archived) then raise exception '이미 변경된 상태입니다';end if;
  update public.sanji_template_library set data=case when p_action='edit' then p_data else data end,archived=case when p_action='archive' then true when p_action='restore' then false else archived end,version=version+1,updated=now() where id=r.id and owner=p_owner returning * into r;
 else raise exception '지원하지 않는 작업';end if;
 insert into public.sanji_template_library_versions(template_id,owner,version,data,archived) values(r.id,p_owner,r.version,r.data,r.archived);
 return r;
end $$;
revoke all on function public.sanji_template_library_change(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_template_library_change(uuid,text,uuid,integer,jsonb) to service_role;
-- An explicitly selected immutable outbound template; existing references stay valid.
create table if not exists public.sanji_brand_outbound_profile(owner uuid primary key references auth.users(id) on delete cascade,template_id uuid not null references public.sanji_records(id),template_version integer not null,revision integer not null default 1,updated timestamptz not null default now());
alter table public.sanji_brand_outbound_profile enable row level security;revoke all on public.sanji_brand_outbound_profile from public,anon,authenticated;grant all on public.sanji_brand_outbound_profile to service_role;
insert into public.sanji_brand_outbound_profile(owner,template_id,template_version)
 select c.owner,t.id,t.version from public.sanji_brand_auto_config c cross join lateral (select id,version,data from public.sanji_records where owner=c.owner and kind='template' order by updated asc limit 20) t
 where t.data->>'channel'='이메일' and coalesce(t.data->>'purpose','') not in ('brand_reply','creator_proposal')
 and t.id=(select x.id from (select id,data,updated from public.sanji_records where owner=c.owner and kind='template' order by updated asc limit 20) x where x.data->>'channel'='이메일' and coalesce(x.data->>'purpose','') not in ('brand_reply','creator_proposal') order by x.updated asc limit 1)
 on conflict(owner) do nothing;
create or replace function public.sanji_template_refresh_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='template' and new.data->>'channel'='이메일' and coalesce(new.data->>'purpose','') not in ('brand_reply','creator_proposal','brand_auto_profile') then perform public.sanji_refresh_template_leads(new.id);end if;return new;
end $$;
-- Profile records are immutable: changing copy always creates a new snapshot.
create or replace function public.sanji_protect_outbound_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.kind='template' and old.data->>'purpose'='brand_auto_profile' then raise exception '자동 발송 본문 스냅샷은 변경하거나 삭제할 수 없습니다';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists sanji_outbound_profile_immutable on public.sanji_records;
create trigger sanji_outbound_profile_immutable before update or delete on public.sanji_records for each row execute function public.sanji_protect_outbound_profile();
create or replace function public.sanji_brand_outbound_replace(p_owner uuid,p_revision integer,p_old text,p_new text) returns public.sanji_brand_outbound_profile language plpgsql security definer set search_path='' as $$
declare p public.sanji_brand_outbound_profile;t public.sanji_records;newid uuid;original text;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '권한 없음';end if;
 select * into p from public.sanji_brand_outbound_profile where owner=p_owner for update;
 if not found or p.revision is distinct from p_revision then raise exception '자동 발송 설정이 변경됐습니다';end if;
 select * into t from public.sanji_records where id=p.template_id and owner=p_owner and kind='template' for share;
 if not found or t.version is distinct from p.template_version then raise exception '자동 발송 원본이 변경됐습니다';end if;
 original:=coalesce(t.data->>'body','');if coalesce(p_old,'')='' or coalesce(p_new,'')='' or length(p_new)>15000 or length(original)-length(replace(original,p_old,''))<>length(p_old) then raise exception '교체할 문단이 정확히 한 번 있는지 확인하세요';end if;
 insert into public.sanji_records(owner,kind,data) values(p_owner,'template',jsonb_set(jsonb_set(t.data,'{body}',to_jsonb(replace(original,p_old,p_new))),'{purpose}',to_jsonb('brand_auto_profile'::text))) returning id into newid;
 update public.sanji_brand_outbound_profile set template_id=newid,template_version=1,revision=revision+1,updated=now() where owner=p_owner returning * into p;return p;
end $$;
revoke all on function public.sanji_brand_outbound_replace(uuid,integer,text,text) from public,anon,authenticated;grant execute on function public.sanji_brand_outbound_replace(uuid,integer,text,text) to service_role;
commit;
