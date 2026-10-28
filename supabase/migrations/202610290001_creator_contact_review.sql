begin;
create table if not exists public.sanji_creator_contact_review(
 owner uuid not null references auth.users(id) on delete cascade,
 creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object'),
 version integer not null default 1,updated timestamptz not null default now(),
 primary key(owner,creator_id)
);
alter table public.sanji_creator_contact_review enable row level security;
revoke all on public.sanji_creator_contact_review from public,anon,authenticated;
grant all on public.sanji_creator_contact_review to service_role;
create or replace function public.sanji_creator_review_import(p_owner uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 30 then raise exception '권한 또는 입력 건수 오류';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,729));
 if (select count(distinct x->>'creatorId') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception '중복 크리에이터';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x left join public.sanji_creator_recovery c on c.owner=p_owner and c.id=(x->>'creatorId')::uuid where c.id is null or jsonb_typeof(x->'data')<>'object') then raise exception '크리에이터 또는 내용 오류';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x join public.sanji_creator_contact_review r on r.owner=p_owner and r.creator_id=(x->>'creatorId')::uuid) then raise exception '이미 저장된 검토 내용이 있습니다. 개별 편집을 사용하세요.';end if;
 insert into public.sanji_creator_contact_review(owner,creator_id,data) select p_owner,(x->>'creatorId')::uuid,x->'data' from jsonb_array_elements(p_rows) x;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.sanji_creator_review_import(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_review_import(uuid,jsonb) to service_role;
create or replace function public.sanji_creator_move_recommendations(p_owner uuid,p_handles text[],p_from date,p_to date) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or cardinality(p_handles)<>30 or (select count(distinct lower(h)) from unnest(p_handles) h)<>30 or p_from<>'2026-10-28'::date or p_to<>'2026-10-29'::date then raise exception '추천 대상 또는 날짜가 올바르지 않습니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 if (select count(*) from public.sanji_creator_recommendations where owner=p_owner and day=p_to)<>0 then raise exception '대상 날짜에 기존 추천이 있습니다.';end if;
 if (select count(*) from public.sanji_creator_recommendations where owner=p_owner and day=p_from)<>30 then raise exception '기존 날짜의 전체 추천 수가 30이 아닙니다.';end if;
 if (select count(*) from public.sanji_creator_recommendations r join public.sanji_creator_recovery c on c.owner=r.owner and c.id=r.creator_id where r.owner=p_owner and r.day=p_from and c.handle=any(p_handles))<>30 then raise exception '기존 추천 30명과 일치하지 않습니다.';end if;
 update public.sanji_creator_recommendations r set day=p_to from public.sanji_creator_recovery c where r.owner=p_owner and r.day=p_from and c.owner=r.owner and c.id=r.creator_id and c.handle=any(p_handles);
 get diagnostics n=row_count;if n<>30 then raise exception '이동 건수 불일치';end if;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'creator_recommendations_moved',jsonb_build_object('from',p_from,'to',p_to,'count',n));return n;
end $$;
revoke all on function public.sanji_creator_move_recommendations(uuid,text[],date,date) from public,anon,authenticated;
grant execute on function public.sanji_creator_move_recommendations(uuid,text[],date,date) to service_role;
-- Count every existing recommendation for the day, including later contact-state changes.
create or replace function public.sanji_creator_recommend(p_owner uuid,p_day date,p_target integer) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; already integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_target not between 1 and 500 then raise exception 'invalid owner or target';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select count(*) into already from public.sanji_creator_recommendations r where r.owner=p_owner and r.day=p_day;
 with choices as (select id from public.sanji_creator_preview(p_owner,greatest(0,p_target-already))),
 inserted as (insert into public.sanji_creator_recommendations(owner,creator_id,day) select p_owner,id,p_day from choices on conflict do nothing returning 1) select count(*) into n from inserted;
 return n;
end $$;
revoke all on function public.sanji_creator_recommend(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_recommend(uuid,date,integer) to service_role;
commit;
