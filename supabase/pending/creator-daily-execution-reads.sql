begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- LOCAL REVIEW ONLY. Apply after six base schemas and recipient-criteria upgrade.
-- No dependency on supply-kick, cron, net or Vault. No worker,
-- credential, cron, provider, send-policy or native CRM mutation. Existing service
-- role only; no authenticated/anonymous endpoint gains table or function access.
create function public.sanji_daily_source_youtube_key(data jsonb) returns text
language sql immutable security invoker set search_path='' as $$
 select case when coalesce(data#>>'{youtubeResearch,channelId}',substring(data->>'profile' from '/channel/(UC[A-Za-z0-9_-]{22})/?$')) ~ '^UC[A-Za-z0-9_-]{22}$'
 then 'youtube:'||coalesce(data#>>'{youtubeResearch,channelId}',substring(data->>'profile' from '/channel/(UC[A-Za-z0-9_-]{22})/?$')) end
$$;
create index sanji_daily_source_youtube_identity on public.sanji_records(owner,public.sanji_daily_source_youtube_key(data),id) where kind='candidate' and data->>'channels'='YouTube';
create index sanji_daily_source_instagram_page on public.sanji_creator_recovery(owner,lower(handle),id);
create index sanji_daily_source_latest_evidence on public.sanji_creator_evidence(owner,creator_id,seen_at desc) where source_kind='daily_outreach_review';
create index sanji_daily_history_outbox_owner on public.sanji_outbox(owner,id);
create index sanji_daily_history_jobs_owner on public.sanji_jobs(owner,draft_id);
create index sanji_daily_history_drafts_owner on public.sanji_drafts(owner,id);

-- Exact recursive extraction, matching the JS history rules. Channel IDs remain
-- case-sensitive; Instagram and Gmail/Googlemail dot/+ aliases are canonicalized.
-- References at ANY nesting level resolve through the current owner's directory.
create function public.sanji_daily_identity_tokens(p_value jsonb) returns table(kind text,value text)
language sql immutable security invoker set search_path='' as $$
 with recursive nodes(k,v) as (
  select ''::text,p_value
  union all
  select child.k,child.v from nodes n cross join lateral (
   select e.key k,e.value v from jsonb_each(case when jsonb_typeof(n.v)='object' then n.v else '{}'::jsonb end) e
   union all select n.k,a.value from jsonb_array_elements(case when jsonb_typeof(n.v)='array' then n.v else '[]'::jsonb end) a
  ) child
 ), strings as (select k,v#>>'{}' s from nodes where jsonb_typeof(v)='string')
 select distinct t.kind,t.value from strings s cross join lateral (
  select 'email'::text kind,public.sanji_daily_outreach_email_key(m[1]) value from regexp_matches(s.s,'[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}','g') m
  union all select 'reference',s.s where s.k in('target','sourceRecordId','creator_id','creatorId','creatorReviewId') and s.s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all select 'creator','youtube:'||s.s where s.k in('channelId','channel_id') and s.s ~ '^UC[A-Za-z0-9_-]{22}$'
  union all select 'creator','youtube:'||m[1] from regexp_matches(s.s,'(?:youtube:|youtube[.]com/channel/)(UC[A-Za-z0-9_-]{22})(?:$|[/?#[:space:]])','g') m
  union all select 'creator',s.s where s.k in('creator_key','creatorKey') and s.s ~ '^youtube:UC[A-Za-z0-9_-]{22}$'
  union all select 'creator',lower(s.s) where s.k in('identity','creator_key','creatorKey') and s.s ~* '^instagram:[a-z0-9._]{1,30}$'
  union all select 'creator','instagram:'||lower(regexp_replace(s.s,'^@','')) where s.k in('handle','username','resolvedHandle') and regexp_replace(s.s,'^@','') ~* '^[a-z0-9._]{1,30}$'
  union all select 'creator','instagram:'||lower(m[1]) from regexp_matches(s.s,'instagram[.]com/([a-z0-9._]{1,30})(?:/|$)','gi') m
 ) t where t.value is not null
$$;

-- Extend the existing authoritative prepare/reserve/begin-send history function.
-- All old fields and conservative blockers remain; exact recursive creator keys
-- add missing nested/case/reference forms without duplicating send authority.
create or replace function public.sanji_daily_outreach_saved_history(p_owner uuid) returns table(entry jsonb)
language sql stable security invoker set search_path='' as $$
 with events(entry) as (
  select to_jsonb(x) from public.sanji_outbox x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_records x where x.owner=p_owner and x.kind='thread'
  union all select to_jsonb(x) from public.sanji_suppression x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_daily_outreach_candidates x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_creator_contact_review x where x.owner=p_owner
  union all select to_jsonb(j)||jsonb_build_object('draft',d.data) from public.sanji_jobs j left join public.sanji_drafts d on d.owner=j.owner and d.id=j.draft_id where j.owner=p_owner
  union all select to_jsonb(x) from public.sanji_creator_inbound_messages x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_creator_manual_notes x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_ig_manual_conversations x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_creator_email_isolated_queue x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_instagram_inbound x where x.owner=p_owner
  union all select to_jsonb(x) from public.sanji_instagram_reply_attempts x where x.owner=p_owner
 ), identifiers as (
  select e.entry, coalesce(e.entry->>'creator_id',e.entry#>>'{data,creatorReviewId}',e.entry#>>'{draft,creatorReviewId}') creator_id,
   coalesce(e.entry->>'target',e.entry#>>'{data,target}',e.entry#>>'{draft,target}') target from events e
 )
 select e.entry||jsonb_build_object('resolvedHandle',c.handle,'resolvedTarget',r.data,'dailyExactCreatorKeys',coalesce((
  select jsonb_agg(distinct v) from (
   select t.value v from public.sanji_daily_identity_tokens(e.entry) t where t.kind='creator'
   union all select 'instagram:'||lower(c2.handle) from public.sanji_daily_identity_tokens(e.entry) t join public.sanji_creator_recovery c2 on c2.owner=p_owner and c2.id=(case when t.kind='reference' then t.value::uuid end) where t.kind='reference'
   union all select case when r2.data->>'channels'='YouTube' then public.sanji_daily_source_youtube_key(r2.data) else 'instagram:'||lower(r2.data->>'handle') end from public.sanji_daily_identity_tokens(e.entry) t join public.sanji_records r2 on r2.owner=p_owner and r2.kind='candidate' and r2.id=(case when t.kind='reference' then t.value::uuid end) where t.kind='reference'
  ) resolved where v is not null),'[]'))
 from identifiers e left join public.sanji_creator_recovery c on c.owner=p_owner and c.id=(case when e.creator_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.creator_id::uuid end)
 left join public.sanji_records r on r.owner=p_owner and r.kind='candidate' and r.id=(case when e.target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.target::uuid end)
$$;
-- A bounded response, not a bounded history scope. No source-history branch is
-- truncated. A DB timeout/missing table/dangling job fails the whole RPC closed.
create function public.sanji_daily_execution_identities(p_owner uuid,p_inputs jsonb,p_include_saved boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)>100 or octet_length(p_inputs::text)>655360 or exists(select 1 from jsonb_array_elements(p_inputs) x where coalesce(x->>'creatorKey','') !~ '^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$' or jsonb_typeof(x->'emailKeys') is distinct from 'array' or jsonb_array_length(x->'emailKeys')>10) then raise exception 'invalid identity lookup';end if;
 if exists(select 1 from public.sanji_jobs j left join public.sanji_drafts d on d.owner=j.owner and d.id=j.draft_id where j.owner=p_owner and d.id is null) then raise exception 'incomplete saved history';end if;
 with raw as materialized (select t.* from public.sanji_daily_outreach_saved_history(p_owner) h cross join lateral public.sanji_daily_identity_tokens(h.entry) t),
 tokens as materialized (
  select kind,value from raw
  union select 'creator','instagram:'||lower(c.handle) from raw t join public.sanji_creator_recovery c on c.owner=p_owner and c.id=(case when t.kind='reference' then t.value::uuid end) where t.kind='reference'
  union select 'creator',case when r.data->>'channels'='YouTube' then public.sanji_daily_source_youtube_key(r.data) else 'instagram:'||lower(r.data->>'handle') end from raw t join public.sanji_records r on r.owner=p_owner and r.id=(case when t.kind='reference' then t.value::uuid end) and r.kind='candidate' where t.kind='reference'
 ), inputs as (select value x from jsonb_array_elements(p_inputs))
 select coalesce(jsonb_agg(jsonb_build_object('creatorKey',x->>'creatorKey',
  'duplicateCreator',exists(select 1 from tokens where kind='creator' and value=x->>'creatorKey') or exists(select 1 from tokens where kind='reference' and value=x->>'sourceRecordId'),
  'emailKeys',(select coalesce(jsonb_agg(distinct value),'[]'::jsonb) from tokens where kind='email' and value in(select public.sanji_daily_outreach_email_key(e) from jsonb_array_elements_text(x->'emailKeys') e)),
  'sourceCount',case when x->>'creatorKey' like 'youtube:%' then (select count(*) from public.sanji_records r where r.owner=p_owner and r.kind='candidate' and r.data->>'channels'='YouTube' and public.sanji_daily_source_youtube_key(r.data)=x->>'creatorKey') else (select count(*) from public.sanji_creator_recovery c where c.owner=p_owner and lower(c.handle)=split_part(x->>'creatorKey',':',2)) end,
  'saved',p_include_saved and (exists(select 1 from public.sanji_records r where r.owner=p_owner and r.kind='candidate' and (public.sanji_daily_source_youtube_key(r.data)=x->>'creatorKey' or r.data->>'creatorKey'=x->>'creatorKey' or r.data->>'profile'='https://www.youtube.com/channel/'||split_part(x->>'creatorKey',':',2))) or exists(select 1 from public.sanji_daily_supply_snapshots s where s.owner=p_owner and 'youtube:'||s.channel_id=x->>'creatorKey'))
 ) order by x->>'creatorKey'),'[]'::jsonb) into result from inputs;
 return jsonb_build_object('complete',true,'scope','all_saved_sanji_history','gmailProviderHistoryChecked',false,'matches',result);
end $$;

-- Digest uses source/evidence CONTENT, not just counts or max timestamps, so
-- same-count changes, deletions and edits behind a cursor invalidate the pass.
-- Only digests/counts leave PostgreSQL. API facts are never copied to a new table.
create function public.sanji_daily_execution_snapshot(p_owner uuid,p_platform text) returns text
language sql stable security invoker set search_path='' as $$
 with hashes as (
  select 'record:'||id::text k,md5(to_jsonb(r)::text) h from public.sanji_records r where owner=p_owner and kind='candidate' and case when p_platform='youtube' then data->>'channels'='YouTube' else data->>'channels' is distinct from 'YouTube' end
  union all select 'instagram:'||id::text,md5(to_jsonb(r)::text) from public.sanji_creator_recovery r where owner=p_owner and p_platform='instagram'
  union all select 'evidence:'||creator_id::text||':'||source_url||':'||source_ref||':'||observation_key,md5(to_jsonb(r)::text) from public.sanji_creator_evidence r where owner=p_owner and source_kind='daily_outreach_review' and p_platform='instagram'
  union all select 'snapshot:'||channel_id,md5(to_jsonb(r)::text) from public.sanji_daily_supply_snapshots r where owner=p_owner and p_platform='youtube'
  union all select 'review:'||creator_key,md5(to_jsonb(r)::text) from public.sanji_daily_supply_reviews r where owner=p_owner and p_platform='youtube'
  union all select 'igreview:'||creator_id::text,md5(to_jsonb(r)::text) from public.sanji_daily_supply_instagram_reviews r where owner=p_owner and p_platform='instagram'
  union all select 'igguard:'||creator_id::text,md5(to_jsonb(r)::text) from public.sanji_daily_supply_instagram_review_guards r where owner=p_owner and p_platform='instagram'
  union all select 'source:'||source_id::text||':'||revision::text,md5(to_jsonb(r)::text) from public.sanji_contact_source_versions r where owner=p_owner and split_part(creator_key,':',1)=p_platform
 ) select md5('execution-v2-c-collation:youtube30000-200000:instagram30000-500000:'||coalesce(string_agg(k||':'||h,E'\n' order by k,h),'')) from hashes
$$;

-- Candidate references are deliberately broader than fully eligible recipients.
-- Every saved YT, every IG with any daily evidence/review/guard, and all current
-- private API snapshots are checked by the SAME JS qualification afterwards.
-- Unreviewed IG rows are counted explicitly rather than pretended to be eligible.
create function public.sanji_daily_execution_refs(p_owner uuid,p_at timestamptz) returns table(page_key text,creator_key text,source_kind text,source_id text)
language sql stable security invoker set search_path='' as $$
 select public.sanji_daily_source_youtube_key(r.data)||':'||r.id::text,public.sanji_daily_source_youtube_key(r.data),'youtube',r.id::text from public.sanji_records r where r.owner=p_owner and r.kind='candidate' and r.data->>'channels'='YouTube' and public.sanji_daily_source_youtube_key(r.data) is not null
 union all
 select 'instagram:'||lower(r.handle)||':'||r.id::text,'instagram:'||lower(r.handle),'instagram',r.id::text from public.sanji_creator_recovery r where r.owner=p_owner and (exists(select 1 from public.sanji_creator_evidence e where e.owner=p_owner and e.creator_id=r.id and e.source_kind='daily_outreach_review') or exists(select 1 from public.sanji_daily_supply_instagram_reviews e where e.owner=p_owner and e.creator_id=r.id) or exists(select 1 from public.sanji_daily_supply_instagram_review_guards e where e.owner=p_owner and e.creator_id=r.id))
 union all
 select 'youtube:'||s.channel_id||':api','youtube:'||s.channel_id,'api',s.channel_id from public.sanji_daily_supply_snapshots s where s.owner=p_owner and s.campaign='mara-jjamppong-bread' and s.expires_at>p_at and not exists(select 1 from public.sanji_records r where r.owner=p_owner and r.kind='candidate' and r.data->>'channels'='YouTube' and public.sanji_daily_source_youtube_key(r.data)='youtube:'||s.channel_id)
$$;
create function public.sanji_daily_execution_envelope(p_owner uuid,p_kind text,p_id text,p_key text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare native jsonb; evidence jsonb:='[]'; latest timestamptz; api jsonb; review jsonb; ig_review jsonb; guard boolean:=false;
begin
 if p_kind='instagram' then
  select to_jsonb(r) into native from public.sanji_creator_recovery r where owner=p_owner and id=p_id::uuid;
  select max(seen_at) into latest from public.sanji_creator_evidence where owner=p_owner and creator_id=p_id::uuid and source_kind='daily_outreach_review';
  if (select count(distinct detail) from public.sanji_creator_evidence where owner=p_owner and creator_id=p_id::uuid and source_kind='daily_outreach_review' and seen_at=latest)>1 then raise exception 'ambiguous latest source evidence';end if;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]') into evidence from (select * from public.sanji_creator_evidence where owner=p_owner and creator_id=p_id::uuid and source_kind='daily_outreach_review' and seen_at=latest order by source_url,source_ref,observation_key limit 1) e;
  select r.review into ig_review from public.sanji_daily_supply_instagram_reviews r where owner=p_owner and campaign='mara-jjamppong-bread' and creator_id=p_id::uuid and expires_at>now();
  select exists(select 1 from public.sanji_daily_supply_instagram_review_guards where owner=p_owner and campaign='mara-jjamppong-bread' and creator_id=p_id::uuid) into guard;
 elsif p_kind='youtube' then select to_jsonb(r) into native from public.sanji_records r where owner=p_owner and kind='candidate' and id=p_id::uuid and data->>'channels'='YouTube';
 elsif p_kind<>'api' then raise exception 'invalid source kind';end if;
 if p_kind<>'api' and native is null then raise exception 'source missing';end if;
 if p_key like 'youtube:%' then
  select to_jsonb(r) into api from public.sanji_daily_supply_snapshots r where owner=p_owner and campaign='mara-jjamppong-bread' and channel_id=split_part(p_key,':',2) and expires_at>now();
  select r.review into review from public.sanji_daily_supply_reviews r where owner=p_owner and campaign='mara-jjamppong-bread' and creator_key=p_key and expires_at>now();
 end if;
 return jsonb_build_object('creatorKey',p_key,'kind',p_kind,'native',native,'evidence',evidence,'snapshot',api,'review',review,'instagramReview',ig_review,'instagramGuard',guard);
end $$;
create function public.sanji_daily_execution_page(p_owner uuid,p_resume jsonb default null,p_limits jsonb default '{"youtube":50,"instagram":10}',p_at timestamptz default null,p_restart boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare at_time timestamptz:=coalesce(p_at,now()); rows jsonb:='[]'; part jsonb; which_platform text; fingerprint text; after_key text; last_key text; total bigint; remaining bigint; cap integer; snapshots jsonb:='{}'; afters jsonb:='{}'; lasts jsonb:='{}'; totals jsonb:='{}'; more jsonb:='{}'; exhausted jsonb:='{}'; all_ig bigint; included_ig bigint; youtube_expiry timestamptz; prepared_count integer; counts jsonb:='{}'; actual_limits jsonb:='{}';
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_limits) is distinct from 'object' or coalesce((p_limits->>'youtube')::integer,-1) not between 0 and 50 or coalesce((p_limits->>'instagram')::integer,-1) not between 0 and 10 or at_time>now() or at_time<now()-interval '10 minutes' then raise exception 'invalid execution page';end if;
 select least(coalesce(min(expires_at),at_time+interval '29 days'),at_time+interval '29 days') into youtube_expiry from public.sanji_daily_supply_snapshots where owner=p_owner and expires_at>at_time;
 foreach which_platform in array array['youtube','instagram'] loop
  select count(*)::integer into prepared_count from public.sanji_daily_outreach_candidates where owner=p_owner and day=(now() at time zone 'Asia/Seoul')::date and sanji_daily_outreach_candidates.platform=which_platform and expires_at>now() and jsonb_typeof(snapshot->'audience')='number' and (snapshot->>'audience')::numeric between 30000 and (case when which_platform='youtube' then 200000 else 500000 end);
  cap:=least((p_limits->>which_platform)::integer,greatest(0,(case when which_platform='youtube' then 50 else 10 end)-prepared_count));counts:=counts||jsonb_build_object(which_platform,prepared_count);actual_limits:=actual_limits||jsonb_build_object(which_platform,cap);
  fingerprint:=public.sanji_daily_execution_snapshot(p_owner,which_platform);
  after_key:=coalesce(p_resume#>>array['after',which_platform],'');
  if length(after_key)>150 then raise exception 'invalid execution cursor';end if;
  if which_platform='youtube' and (p_resume->>'youtubeExpiresAt')::timestamptz<=at_time then after_key:='';end if;
  if p_resume#>>array['snapshot',which_platform] is distinct from fingerprint or p_restart and p_resume#>array['exhausted',which_platform]='true'::jsonb then after_key:='';end if;
  select count(*),count(*) filter(where page_key collate "C">after_key collate "C") into total,remaining from public.sanji_daily_execution_refs(p_owner,at_time) where split_part(creator_key,':',1)=which_platform;
  select coalesce(jsonb_agg(public.sanji_daily_execution_envelope(p_owner,source_kind,source_id,creator_key)||jsonb_build_object('pageKey',page_key) order by page_key collate "C"),'[]'),max(page_key collate "C") into part,last_key from (select * from public.sanji_daily_execution_refs(p_owner,at_time) where split_part(creator_key,':',1)=which_platform and page_key collate "C">after_key collate "C" order by page_key collate "C" limit cap) page;
  rows:=rows||part;snapshots:=snapshots||jsonb_build_object(which_platform,fingerprint);afters:=afters||jsonb_build_object(which_platform,after_key);lasts:=lasts||jsonb_build_object(which_platform,coalesce(last_key,after_key));totals:=totals||jsonb_build_object(which_platform,total);more:=more||jsonb_build_object(which_platform,cap>0 and remaining>jsonb_array_length(part));exhausted:=exhausted||jsonb_build_object(which_platform,remaining=jsonb_array_length(part));
 end loop;
 select count(*) into all_ig from public.sanji_creator_recovery where owner=p_owner;
 select count(*) into included_ig from public.sanji_daily_execution_refs(p_owner,at_time) where source_kind='instagram';
 if octet_length(rows::text)>4000000 then raise exception 'execution page payload too large';end if;
 return jsonb_build_object('complete',true,'scope','reviewable_sources','snapshot',snapshots,'at',at_time,'after',afters,'last',lasts,'total',totals,'hasMore',more,'exhausted',exhausted,'limits',actual_limits,'counts',counts,'unreviewedInstagram',all_ig-included_ig,'youtubeExpiresAt',youtube_expiry,'rows',rows);
end $$;
create function public.sanji_daily_execution_current(p_owner uuid,p_creator_key text,p_source_id text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; n bigint;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_creator_key !~ '^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$' then raise exception 'invalid current identity';end if;
 if p_creator_key like 'instagram:%' then
  select count(*) into n from public.sanji_creator_recovery where owner=p_owner and lower(handle)=split_part(p_creator_key,':',2);
  if n<>1 then raise exception 'current source ambiguous';end if;
  select public.sanji_daily_execution_envelope(p_owner,'instagram',id::text,p_creator_key) into result from public.sanji_creator_recovery where owner=p_owner and lower(handle)=split_part(p_creator_key,':',2) and (p_source_id is null or id::text=p_source_id);
 else
  select count(*) into n from public.sanji_records where owner=p_owner and kind='candidate' and data->>'channels'='YouTube' and public.sanji_daily_source_youtube_key(data)=p_creator_key;
  if n>1 then raise exception 'current source ambiguous';end if;
  if n=1 then select public.sanji_daily_execution_envelope(p_owner,'youtube',id::text,p_creator_key) into result from public.sanji_records where owner=p_owner and kind='candidate' and data->>'channels'='YouTube' and public.sanji_daily_source_youtube_key(data)=p_creator_key and (p_source_id is null or id::text=p_source_id);
  elsif p_source_id is null and exists(select 1 from public.sanji_daily_supply_snapshots where owner=p_owner and channel_id=split_part(p_creator_key,':',2) and expires_at>now()) then result:=public.sanji_daily_execution_envelope(p_owner,'api',split_part(p_creator_key,':',2),p_creator_key);end if;
 end if;
 if result is null then raise exception 'current source changed';end if;
 if octet_length(result::text)>1000000 then raise exception 'current source payload too large';end if;
 return jsonb_build_object('complete',true,'row',result);
end $$;

-- Raw native source is for human review renewal ONLY. It intentionally does not
-- load supplemental/legacy evidence or guards. Merged current() remains the only
-- execution/dispatch source path, including all stale-review fail-closed gates.
create function public.sanji_daily_execution_instagram_source(p_owner uuid,p_creator_key text,p_source_id text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare native jsonb;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or coalesce(p_creator_key,'') !~ '^instagram:[a-z0-9._]{1,30}$' or coalesce(p_source_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid native Instagram review identity';end if;
 if (select count(*) from public.sanji_creator_recovery where owner=p_owner and lower(handle)=split_part(p_creator_key,':',2))<>1 then raise exception 'native Instagram review source ambiguous';end if;
 select to_jsonb(r) into native from public.sanji_creator_recovery r where owner=p_owner and id=p_source_id::uuid and lower(handle)=split_part(p_creator_key,':',2);
 if native is null then raise exception 'native Instagram review source changed';end if;
 if octet_length(native::text)>1000000 then raise exception 'native Instagram review source payload too large';end if;
 return jsonb_build_object('complete',true,'source','native_instagram_review','creatorKey',p_creator_key,'native',native);
end $$;

-- One source page per invocation, with durable resume. The checkpoint and native
-- prepare commit together; an uncertain response must be reconciled by status.
-- Page snapshots are server recomputed; no browser may nominate recipients/cursor.
create function public.sanji_daily_execution_prepare_page(p_owner uuid,p_day date,p_plan jsonb,p_page jsonb,p_expected jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing jsonb;checked jsonb;result jsonb;progress jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select summary->'executionProgress' into existing from public.sanji_daily_outreach_runs where owner=p_owner and day=p_day;
 if existing is distinct from p_expected then raise exception 'execution checkpoint changed';end if;
 checked:=public.sanji_daily_execution_page(p_owner,jsonb_build_object('after',p_page->'after','snapshot',p_page->'snapshot'),p_page->'limits',(p_page->>'at')::timestamptz,false);
 if checked is distinct from p_page then raise exception 'execution page changed';end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'selected') c where not exists(select 1 from jsonb_array_elements(checked->'rows') r where r->>'creatorKey'=c->>'creatorKey' and (c->>'sourceRecordId') is not distinct from (r#>>'{native,id}'))) then raise exception 'candidate outside execution page';end if;
 result:=public.sanji_daily_outreach_prepare(p_owner,p_day,p_plan);
 progress:=jsonb_build_object('snapshot',checked->'snapshot','at',checked->>'at','after',checked->'last','total',checked->'total','hasMore',checked->'hasMore','exhausted',checked->'exhausted','unreviewedInstagram',checked->'unreviewedInstagram','checkedAt',now(),'youtubeExpiresAt',checked->'youtubeExpiresAt');
 result:=result||jsonb_build_object('executionProgress',progress,'morePreparationRequired',(coalesce((checked#>>'{hasMore,youtube}')::boolean,false) and coalesce((result#>>'{counts,youtube}')::integer,0)<50) or (coalesce((checked#>>'{hasMore,instagram}')::boolean,false) and coalesce((result#>>'{counts,instagram}')::integer,0)<10),'sourceScope','reviewable_sources');
 update public.sanji_daily_outreach_runs set summary=result where owner=p_owner and day=p_day;
 return result;
end $$;

create or replace function public.sanji_daily_outreach_sweep() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare changed integer; cursors integer;
begin
 -- API-derived identity/name may only enter this table with independent creator
 -- evidence. Those independent facts and send/dedup audit stay; raw API facts go.
 update public.sanji_daily_outreach_candidates set snapshot=(snapshot
  -array['audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt','apiSnapshot']::text[]
  -case when snapshot#>>'{mukbang,sourceUrl}'~*'^https://([^/]+\.)?(youtube\.com|youtu\.be|googleapis\.com)(/|$)' then array['mukbang']::text[] else '{}'::text[] end
  -case when snapshot#>'{apiSnapshot,titleFromApi}'='true'::jsonb and snapshot#>'{displayNameEvidence,verified}' is distinct from 'true'::jsonb then array['name']::text[] else '{}'::text[] end
 )||jsonb_build_object('apiDataRemovedAt',clock_timestamp())
 where snapshot ? 'apiSnapshot' and (snapshot#>>'{apiSnapshot,expiresAt}')::timestamptz<=clock_timestamp();
 get diagnostics changed=row_count;
 -- Execution cursors may contain private API channel IDs. Physically remove
 -- their YT cursor/digest on the EARLIEST underlying API expiry, never merely hide.
 update public.sanji_daily_outreach_runs set summary=jsonb_set(summary,'{executionProgress}',
  (summary->'executionProgress')||jsonb_build_object('after',(summary#>'{executionProgress,after}')||'{"youtube":""}'::jsonb,'snapshot',(summary#>'{executionProgress,snapshot}')||'{"youtube":""}'::jsonb,'youtubeExpiresAt',null))
 where (summary#>>'{executionProgress,youtubeExpiresAt}')::timestamptz<=clock_timestamp();
 get diagnostics cursors=row_count;
 return jsonb_build_object('preparedApiSnapshotsRemoved',changed,'executionApiCursorsRemoved',cursors);
end $$;

revoke all on function public.sanji_daily_source_youtube_key(jsonb),public.sanji_daily_identity_tokens(jsonb),public.sanji_daily_execution_identities(uuid,jsonb,boolean),public.sanji_daily_execution_snapshot(uuid,text),public.sanji_daily_execution_refs(uuid,timestamptz),public.sanji_daily_execution_envelope(uuid,text,text,text),public.sanji_daily_execution_page(uuid,jsonb,jsonb,timestamptz,boolean),public.sanji_daily_execution_current(uuid,text,text),public.sanji_daily_execution_instagram_source(uuid,text,text),public.sanji_daily_execution_prepare_page(uuid,date,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_daily_source_youtube_key(jsonb),public.sanji_daily_identity_tokens(jsonb),public.sanji_daily_execution_identities(uuid,jsonb,boolean),public.sanji_daily_execution_snapshot(uuid,text),public.sanji_daily_execution_refs(uuid,timestamptz),public.sanji_daily_execution_envelope(uuid,text,text,text),public.sanji_daily_execution_page(uuid,jsonb,jsonb,timestamptz,boolean),public.sanji_daily_execution_current(uuid,text,text),public.sanji_daily_execution_instagram_source(uuid,text,text),public.sanji_daily_execution_prepare_page(uuid,date,jsonb,jsonb,jsonb) to service_role;
commit;
