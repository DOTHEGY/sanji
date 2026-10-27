begin;
create table if not exists public.sanji_creator_recovery_config (
 owner uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false, target integer not null default 30 check(target between 1 and 500),
 run_time time not null default '09:00', explore_percent integer not null default 20 check(explore_percent between 0 and 100), last_run_day date,
 daily_lookup_limit integer not null default 0 check(daily_lookup_limit between 0 and 500),
 retry_limit integer not null default 0 check(retry_limit between 0 and 5),
 paid_limit_usd numeric not null default 0 check(paid_limit_usd between 0 and 100), updated timestamptz not null default now()
);
create table if not exists public.sanji_creator_recovery (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete cascade,
 handle text not null check(handle ~ '^[a-z0-9._]{1,30}$'), source_id text not null, profile_url text not null,
 nickname text not null default '', followers bigint check(followers is null or followers>=0), category text not null default '',bio text not null default '',
 emails jsonb not null default '[]',bio_status text not null default 'not_checked' check(bio_status in ('email_present','email_not_in_bio','bio_unreadable','not_checked')),email_status text not null default '아직 조회하지 않음', source_provider text not null default 'recovery',source_kind text not null,source_file text not null default '',source_url text not null default '', source_created_at timestamptz, last_verified timestamptz, followers_checked timestamptz,followers_source text not null default '',lookup_state text not null default 'not_checked',
 link_status text not null default 'needs_verification' check(link_status in ('source_confirmed','needs_verification','lookup_failed')), entity_type text not null default 'unknown' check(entity_type in ('unknown','creator_evidence','noncreator_suspected')),
 priority_score integer not null default 0 check(priority_score between 0 and 100), assessment text not null check(assessment in ('candidate','explore','review','excluded')), reasons jsonb not null default '[]',
 status text not null default 'new' check(status in ('new','hold','excluded','contacted')),
 created timestamptz not null default now(),updated timestamptz not null default now(),unique(owner,handle),unique(owner,source_id)
);
create table if not exists public.sanji_creator_evidence (
 owner uuid not null references auth.users(id) on delete cascade,creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 source_provider text not null default 'unknown',source_kind text not null, source_url text not null, source_ref text not null default '', observation_key text not null default '', batch_id text not null default '',detail jsonb not null default '{}', seen_at timestamptz not null default now(),
 primary key(owner,creator_id,source_kind,source_url,source_ref,observation_key)
);
alter table public.sanji_creator_evidence enable row level security;
revoke all on public.sanji_creator_evidence from public,anon,authenticated;
grant all on public.sanji_creator_evidence to service_role;
create table if not exists public.sanji_creator_visible_batches (
 owner uuid not null references auth.users(id) on delete cascade,batch_hash text not null,processed integer not null,added integer not null,existing integer not null default 0,evidence_added integer not null default 0,created timestamptz not null default now(),primary key(owner,batch_hash)
);
alter table public.sanji_creator_visible_batches enable row level security;
revoke all on public.sanji_creator_visible_batches from public,anon,authenticated;
grant all on public.sanji_creator_visible_batches to service_role;
create or replace function public.sanji_creator_import_visible(p_owner uuid,p_hash text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.sanji_creator_visible_batches;added_count integer;existing_count integer;evidence_count integer;bio_evidence_count integer;row_count integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 30 then raise exception 'invalid import';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,728));
 select * into previous from public.sanji_creator_visible_batches where owner=p_owner and batch_hash=p_hash;
 if found then return jsonb_build_object('processed',0,'added',0,'existing',0,'evidenceAdded',0,'failed',0,'batchId',p_hash,'duplicateBatch',true);end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'handle','') !~ '^[a-z0-9._]{1,30}$' or coalesce(x->>'source_url','') not in ('https://tagby.io/influencer/search','https://tagby.io/instant/recommend/search') or coalesce(x->>'source_ref','') !~ '^[a-z0-9._]{0,30}$' or (coalesce(x->>'profile_url','')<>'' and (x->>'profile_url' !~ '^https://(www\.)?instagram\.com/[a-z0-9._]+/?$' or lower(split_part(split_part(x->>'profile_url','instagram.com/',2),'/',1))<>lower(x->>'handle')))) then raise exception 'invalid visible evidence';end if;
 row_count:=jsonb_array_length(p_rows);
 select count(distinct x->>'handle') into existing_count from jsonb_array_elements(p_rows) x join public.sanji_creator_recovery c on c.owner=p_owner and c.handle=x->>'handle';
 with ins as (insert into public.sanji_creator_recovery(owner,handle,source_id,profile_url,nickname,followers,category,bio,emails,bio_status,email_status,source_provider,source_kind,source_file,source_url,link_status,priority_score,entity_type,assessment,reasons)
 select p_owner,x->>'handle','tagby:'||(x->>'handle'),coalesce(x->>'profile_url',''),coalesce(x->>'nickname',''),case when coalesce(x->>'followers','') ~ '^[0-9]{1,12}$' then (x->>'followers')::bigint else null end,coalesce(x->>'category',''),coalesce(x->>'bio',''),coalesce(x->'emails','[]'::jsonb),coalesce(x->>'bio_status','not_checked'),coalesce(x->>'email_status','아직 조회하지 않음'),'tagby',case when x->>'source_url'='https://tagby.io/instant/recommend/search' then 'tagby_similar' else 'tagby_general' end,'Tagby',x->>'source_url',case when coalesce(x->>'profile_url','')='' then 'needs_verification' else 'source_confirmed' end,(case when coalesce(x->>'category','') ~* '(푸드|식품|웰니스|운동|건강|라이프|일상|육아|공구|food|fitness)' then 25 else 0 end + case when coalesce(x->>'bio','') ~* '(요리|식단|레시피|푸드|웰니스|운동|일상|육아)' then 15 else 0 end + case when coalesce(x->>'bio','') ~* '(공구|공동구매)' then 20 else 0 end + case when x->>'source_url'='https://tagby.io/instant/recommend/search' and coalesce(x->>'source_ref','')<>'' then 10 else 0 end),case when (coalesce(x->>'category','')||' '||coalesce(x->>'bio','')) ~* '(브랜드|쇼핑몰|공식몰|기관|협회|팬계정|fan[[:space:]]*page)' then 'noncreator_suspected' else 'unknown' end,case when coalesce(x->>'profile_url','')='' or (coalesce(x->>'category','')||' '||coalesce(x->>'bio','')) ~* '(브랜드|쇼핑몰|공식몰|기관|협회|팬계정|fan[[:space:]]*page)' then 'review' else 'explore' end,jsonb_build_array('TAGby 화면에서 전달받은 후보 · 한국 크리에이터 여부와 적합성 확인 필요') || case when x->>'source_url'='https://tagby.io/instant/recommend/search' and coalesce(x->>'source_ref','')<>'' then jsonb_build_array('기준 @'||(x->>'source_ref')||'의 유사 추천 · 공구 성과는 미확인') else '[]'::jsonb end from jsonb_array_elements(p_rows) x on conflict do nothing returning 1) select count(*) into added_count from ins;
 with evidence_rows as (insert into public.sanji_creator_evidence(owner,creator_id,source_provider,source_kind,source_url,source_ref,observation_key,batch_id,detail)
 select p_owner,c.id,'tagby',case when x->>'source_url'='https://tagby.io/instant/recommend/search' then 'tagby_similar' else 'tagby_general' end,x->>'source_url',coalesce(x->>'source_ref',''),md5(concat_ws('|',x->>'profile_url',x->>'followers',x->>'checked',x->>'source_position',x->>'similarity',x->>'average_likes',x->>'average_comments')),p_hash,jsonb_build_object('source_result_url',coalesce(x->>'source_result_url',''),'category',coalesce(x->>'category',''),'profile_url',coalesce(x->>'profile_url',''),'followers',x->'followers','checked',x->>'checked','observation_kind',coalesce(x->>'observation_kind','unknown'),'source_position',x->'source_position','similarity',coalesce(x->>'similarity',''),'average_likes',x->'average_likes','average_comments',x->'average_comments') from jsonb_array_elements(p_rows) x join public.sanji_creator_recovery c on c.owner=p_owner and c.handle=x->>'handle' on conflict do nothing returning 1) select count(*) into evidence_count from evidence_rows;
 with bio_rows as (insert into public.sanji_creator_evidence(owner,creator_id,source_provider,source_kind,source_url,source_ref,observation_key,batch_id,detail)
 select p_owner,c.id,'instagram_public','public_bio',x->>'bio_source_url','',md5(concat_ws('|',x->>'bio_status',x->>'bio',x->>'bio_checked_at')),p_hash,jsonb_build_object('bio',coalesce(x->>'bio',''),'bio_source_url',x->>'bio_source_url','bio_status',x->>'bio_status','bio_checked_at',x->>'bio_checked_at','bio_content_available',coalesce((x->>'bio_content_available')::boolean,false),'emails',coalesce(x->'emails','[]'::jsonb)) from jsonb_array_elements(p_rows) x join public.sanji_creator_recovery c on c.owner=p_owner and c.handle=x->>'handle' where coalesce(x->>'bio_status','not_checked')<>'not_checked' on conflict do nothing returning 1) select count(*) into bio_evidence_count from bio_rows;
 evidence_count:=evidence_count+bio_evidence_count;
 insert into public.sanji_creator_visible_batches(owner,batch_hash,processed,added,existing,evidence_added) values(p_owner,p_hash,row_count,added_count,existing_count,evidence_count);
 return jsonb_build_object('processed',row_count,'added',added_count,'existing',existing_count,'evidenceAdded',evidence_count,'failed',0,'batchId',p_hash,'duplicateBatch',false);
end $$;
revoke all on function public.sanji_creator_import_visible(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_import_visible(uuid,text,jsonb) to service_role;
create table if not exists public.sanji_creator_recommendations (
 owner uuid not null references auth.users(id) on delete cascade, creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 day date not null,created timestamptz not null default now(),primary key(owner,creator_id)
);
create table if not exists public.sanji_creator_meta_queries (
 owner uuid not null references auth.users(id) on delete cascade, tag text not null, query_type text not null default 'hashtag' check(query_type in ('hashtag','profile')), queried_at timestamptz not null default now()
);
create index if not exists creator_meta_queries_owner_date on public.sanji_creator_meta_queries(owner,queried_at);
alter table public.sanji_creator_meta_queries enable row level security;
revoke all on public.sanji_creator_meta_queries from public,anon,authenticated;
grant all on public.sanji_creator_meta_queries to service_role;
create or replace function public.sanji_creator_meta_claim(p_owner uuid,p_tag text,p_kind text default 'hashtag') returns void language plpgsql security definer set search_path='' as $$
declare cap integer;daily integer;unique_tags integer;exists_tag boolean;
begin
 if p_tag !~ '^[a-z0-9_가-힣]{1,30}$' or p_kind not in ('hashtag','profile') or not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid query';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,726));
 select daily_lookup_limit into cap from public.sanji_creator_recovery_config where owner=p_owner;
 if coalesce(cap,0)=0 then raise exception '일일 공식 API 조회 상한이 0입니다.';end if;
 select count(*) into daily from public.sanji_creator_meta_queries where owner=p_owner and (queried_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date;
 if daily>=cap then raise exception '오늘 공식 API 조회 상한에 도달했습니다.';end if;
 select count(distinct tag),coalesce(bool_or(tag=p_tag),false) into unique_tags,exists_tag from public.sanji_creator_meta_queries where owner=p_owner and query_type='hashtag' and queried_at>now()-interval '7 days';
 if p_kind='hashtag' and unique_tags>=30 and not exists_tag then raise exception 'Meta의 7일 고유 해시태그 30개 제한입니다.';end if;
 insert into public.sanji_creator_meta_queries(owner,tag,query_type) values(p_owner,p_tag,p_kind);
end $$;
revoke all on function public.sanji_creator_meta_claim(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sanji_creator_meta_claim(uuid,text,text) to service_role;
create index if not exists creator_recovery_selection on public.sanji_creator_recovery(owner,assessment,status,created);
create index if not exists creator_recovery_day on public.sanji_creator_recommendations(owner,day);
alter table public.sanji_creator_recovery_config enable row level security;
alter table public.sanji_creator_recovery enable row level security;
alter table public.sanji_creator_recommendations enable row level security;
revoke all on public.sanji_creator_recovery_config,public.sanji_creator_recovery,public.sanji_creator_recommendations from public,anon,authenticated;
grant all on public.sanji_creator_recovery_config,public.sanji_creator_recovery,public.sanji_creator_recommendations to service_role;
create or replace function public.sanji_creator_pool_counts(p_owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('priority',count(*) filter(where c.assessment='candidate' and c.status='new'),'explore',count(*) filter(where c.assessment='explore' and c.status='new'),'review',count(*) filter(where c.assessment='review' and c.status='new'),'unverified_links',count(*) filter(where c.link_status<>'source_confirmed')) from public.sanji_creator_recovery c where c.owner=p_owner and exists(select 1 from public.sanji_members where user_id=p_owner) and not exists(select 1 from public.sanji_creator_recommendations r where r.owner=p_owner and r.creator_id=c.id) and not exists(select 1 from public.sanji_creator_prospects p where p.owner=p_owner and lower(ltrim(p.handle,'@'))=c.handle) and not exists(select 1 from public.sanji_records x where x.owner=p_owner and x.kind='candidate' and x.data->>'kind'='크리에이터' and lower(ltrim(coalesce(x.data->>'handle',''),'@'))=c.handle);
$$;
revoke all on function public.sanji_creator_pool_counts(uuid) from public,anon,authenticated;
grant execute on function public.sanji_creator_pool_counts(uuid) to service_role;
create or replace function public.sanji_creator_preview(p_owner uuid,p_target integer) returns setof public.sanji_creator_recovery language sql stable security definer set search_path='' as $$
 with eligible as (
  select c.*,row_number() over(partition by c.assessment order by c.priority_score desc,c.created,c.id) as choice_rank,
  coalesce((select explore_percent from public.sanji_creator_recovery_config where owner=p_owner),20) as explore_share
  from public.sanji_creator_recovery c where c.owner=p_owner and c.assessment in ('candidate','explore') and c.status='new' and p_target between 1 and 500
  and exists(select 1 from public.sanji_members where user_id=p_owner)
  and not exists(select 1 from public.sanji_creator_recommendations r where r.owner=p_owner and r.creator_id=c.id)
  and not exists(select 1 from public.sanji_creator_prospects p where p.owner=p_owner and lower(ltrim(p.handle,'@'))=c.handle)
  and not exists(select 1 from public.sanji_records x where x.owner=p_owner and x.kind='candidate' and x.data->>'kind'='크리에이터' and lower(ltrim(coalesce(x.data->>'handle',''),'@'))=c.handle)
 ), ranked as (
  select id,row_number() over(order by case when assessment='candidate' and choice_rank<=p_target-floor(p_target*explore_share/100.0) then 0 when assessment='explore' and choice_rank<=floor(p_target*explore_share/100.0) then 0 else 1 end,choice_rank,priority_score desc,id) as final_rank from eligible
 ) select c.* from public.sanji_creator_recovery c join ranked r on r.id=c.id order by r.final_rank limit greatest(0,least(p_target,500));
$$;
revoke all on function public.sanji_creator_preview(uuid,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_preview(uuid,integer) to service_role;
create or replace function public.sanji_creator_recommend(p_owner uuid,p_day date,p_target integer) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; already integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_target not between 1 and 500 then raise exception 'invalid owner or target';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select count(*) into already from public.sanji_creator_recommendations r join public.sanji_creator_recovery c on c.id=r.creator_id and c.owner=r.owner where r.owner=p_owner and r.day=p_day and c.status='new';
 with choices as (select id from public.sanji_creator_preview(p_owner,greatest(0,p_target-already))),
 inserted as (insert into public.sanji_creator_recommendations(owner,creator_id,day) select p_owner,id,p_day from choices on conflict do nothing returning 1) select count(*) into n from inserted;
 return n;
end $$;
revoke all on function public.sanji_creator_recommend(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.sanji_creator_recommend(uuid,date,integer) to service_role;
commit;
