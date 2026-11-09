begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- PREPARATION ONLY. Pending review, not a migration or activation script.
-- No provider, outbox, jobs, policy, credentials or cron mutation.
create table public.sanji_daily_outreach_runs (
 owner uuid not null references auth.users(id) on delete cascade,
 day date not null, campaign text not null check(campaign='mara-jjamppong-bread'),
 summary jsonb not null check(jsonb_typeof(summary)='object'), created timestamptz not null default now(),
 primary key(owner,day)
);
create table public.sanji_daily_outreach_candidates (
 owner uuid not null references auth.users(id) on delete cascade,
 creator_key text not null, email_key text not null, recipient text not null,
 platform text not null check(platform in('youtube','instagram')), day date not null,
 state text not null default 'awaiting_dispatch_review' check(state='awaiting_dispatch_review'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 expires_at timestamptz not null, created timestamptz not null default now(),
 primary key(owner,creator_key), unique(owner,email_key),
 foreign key(owner,day) references public.sanji_daily_outreach_runs(owner,day)
);
alter table public.sanji_daily_outreach_runs enable row level security;
alter table public.sanji_daily_outreach_candidates enable row level security;
revoke all on public.sanji_daily_outreach_runs,public.sanji_daily_outreach_candidates from public,anon,authenticated,service_role;
grant select,insert on public.sanji_daily_outreach_runs,public.sanji_daily_outreach_candidates to service_role;
create function public.sanji_daily_outreach_email_key(value text) returns text language sql immutable security invoker set search_path='' as $$
 select case when lower(split_part(btrim(value),'@',2)) in ('gmail.com','googlemail.com') then replace(split_part(split_part(lower(btrim(value)),'@',1),'+',1),'.','')||'@gmail.com' else lower(btrim(value)) end
$$;
-- Saved Sanji history only. Gmail provider history is a separate, still-disabled
-- dispatch preflight. Missing prerequisite tables must fail activation closed.
create function public.sanji_daily_outreach_saved_history(p_owner uuid) returns table(entry jsonb)
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
 select e.entry||jsonb_build_object('resolvedHandle',c.handle,'resolvedTarget',r.data)
 from identifiers e left join public.sanji_creator_recovery c on c.owner=p_owner and c.id::text=e.creator_id
 left join public.sanji_records r on r.owner=p_owner and r.kind='candidate' and r.id::text=e.target
$$;
create function public.sanji_daily_outreach_prepare(p_owner uuid,p_day date,p_plan jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior jsonb; c jsonb; counts jsonb; result jsonb; recipient text; recipient_key text; y integer:=0; i integer:=0; skipped integer:=0; holds jsonb; history_row jsonb; history_entries jsonb; duplicate_found boolean;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_day is distinct from (now() at time zone 'Asia/Seoul')::date then raise exception 'invalid owner or day'; end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'campaign' is distinct from 'mara-jjamppong-bread' or p_plan->>'day' is distinct from p_day::text or p_plan->'sendingEnabled' is distinct from 'false'::jsonb or p_plan->'schedulerEnabled' is distinct from 'false'::jsonb or jsonb_typeof(p_plan->'selected') is distinct from 'array' or jsonb_array_length(p_plan->'selected')>60 then raise exception 'invalid preparation';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select summary into prior from public.sanji_daily_outreach_runs where owner=p_owner and day=p_day;
 if found then
  select count(*) filter(where platform='youtube'),count(*) filter(where platform='instagram') into y,i from public.sanji_daily_outreach_candidates where owner=p_owner and day=p_day and expires_at>now() and jsonb_typeof(snapshot->'audience')='number' and (snapshot->>'audience')::numeric between 30000 and (case when platform='youtube' then 200000 else 500000 end);
  if y>=50 and i>=10 and prior->>'targetUnit'='distinct_verified_business_email' and prior->'maxEmailsPerCreator'='1'::jsonb and prior->>'dedupeScope'='cross_platform' and prior->'audienceBounds'='{"youtube":{"minimum":30000,"maximum":200000},"instagram":{"minimum":30000,"maximum":500000}}'::jsonb then return prior||'{"duplicate":true}'::jsonb;end if;
 end if;
 if exists(select 1 from public.sanji_jobs j left join public.sanji_drafts d on d.owner=j.owner and d.id=j.draft_id where j.owner=p_owner and d.id is null) then raise exception 'incomplete saved history';end if;
 select coalesce(jsonb_agg(entry),'[]'::jsonb) into history_entries from public.sanji_daily_outreach_saved_history(p_owner);
 if exists(select 1 from jsonb_array_elements(p_plan->'selected') x where coalesce(x->>'platform','') not in ('youtube','instagram') or x->>'creatorKey' is null) then raise exception 'invalid candidate';end if;
 if (select count(*) from jsonb_array_elements(p_plan->'selected') x where x->>'platform'='youtube')>50 or (select count(*) from jsonb_array_elements(p_plan->'selected') x where x->>'platform'='instagram')>10 then raise exception 'daily target exceeded';end if;
 -- Insert parent first; any later failure rolls back the entire preparation.
 insert into public.sanji_daily_outreach_runs(owner,day,campaign,summary) values(p_owner,p_day,'mara-jjamppong-bread','{}') on conflict(owner,day) do nothing;
 for c in select value from jsonb_array_elements(p_plan->'selected') loop
  if c->>'platform'='youtube' and y>=50 or c->>'platform'='instagram' and i>=10 then continue;end if;
  recipient:=lower(btrim(c#>>'{contact,address}'));recipient_key:=public.sanji_daily_outreach_email_key(recipient);
  if coalesce(recipient,'')!~'^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' or c#>>'{contact,key}' is distinct from recipient_key or length(recipient)>254 or length(split_part(recipient,'@',1))>64 or split_part(recipient,'@',1)~'(^\.|\.$|\.\.)' or split_part(recipient,'@',2)~'(^[-.]|[-.]$|\.\.|\.-|-\.)' or recipient_key='@gmail.com' or c->>'creatorKey'!~'^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$' or split_part(c->>'creatorKey',':',1) is distinct from c->>'platform' then raise exception 'invalid identity';end if;
  if jsonb_typeof(c->'audience') is distinct from 'number' or (c->>'audience')::numeric<>trunc((c->>'audience')::numeric) or (c->>'audience')::numeric not between 30000 and (case when c->>'platform'='youtube' then 200000 else 500000 end) or (c->>'audienceCheckedAt')::timestamptz not between now()-interval '30 days' and now() or (c->>'lastActiveAt')::timestamptz not between now()-interval '90 days' and now() or (c->>'activityCheckedAt')::timestamptz not between now()-interval '30 days' and now() or (c#>>'{mukbang,checkedAt}')::timestamptz not between now()-interval '30 days' and now() or (c#>>'{contact,checkedAt}')::timestamptz not between now()-interval '30 days' and now() then raise exception 'stale evidence';end if;
  if jsonb_typeof(c->'audience') is distinct from 'number' or c->>'audience'!~'^[0-9]+$' then raise exception 'invalid audience';end if;
  if c->>'audience' is null or c->>'audienceCheckedAt' is null or c->>'lastActiveAt' is null or c->>'activityCheckedAt' is null or c#>>'{mukbang,checkedAt}' is null or c#>>'{contact,checkedAt}' is null or coalesce(btrim(c#>>'{mukbang,sourceText}'),'')='' or coalesce(btrim(c->>'name'),'')='' or c->>'profileUrl' is null or c->>'status' is distinct from 'awaiting_dispatch_review' or c#>>'{contact,purpose}' is distinct from 'business_collaboration' or position(recipient in lower(coalesce(c#>>'{contact,sourceText}','')))=0 then raise exception 'missing evidence';end if;
  if c#>'{contact,verified}' is distinct from 'true'::jsonb or c#>>'{contact,accessMethod}' is distinct from 'public_source_review' or coalesce(c#>>'{contact,sourceKind}','') not in ('official_website','instagram_public_bio','provided_by_creator') then raise exception 'unverified contact source';end if;
  if c->>'platform'='youtube' and (rtrim(c->>'profileUrl','/') not in ('https://youtube.com/channel/'||split_part(c->>'creatorKey',':',2),'https://www.youtube.com/channel/'||split_part(c->>'creatorKey',':',2)) or c#>>'{contact,sourceKind}'='instagram_public_bio' or c#>>'{contact,sourceUrl}'~*'^https://([^/]+\.)?(youtube\.com|youtu\.be|googleapis\.com)(/|$)') then raise exception 'invalid youtube source';end if;
  if c->>'platform'='instagram' and lower(rtrim(c->>'profileUrl','/')) not in ('https://instagram.com/'||split_part(c->>'creatorKey',':',2),'https://www.instagram.com/'||split_part(c->>'creatorKey',':',2)) then raise exception 'invalid instagram profile';end if;
  if c#>>'{contact,sourceKind}'='instagram_public_bio' and lower(rtrim(c#>>'{contact,sourceUrl}','/')) is distinct from lower(rtrim(c->>'profileUrl','/')) then raise exception 'unrelated instagram bio';end if;
  if c#>>'{contact,sourceKind}'<>'instagram_public_bio' and (c#>'{contact,affiliation,verified}' is distinct from 'true'::jsonb or c#>>'{contact,affiliation,creatorKey}' is distinct from c->>'creatorKey' or coalesce(btrim(c#>>'{contact,affiliation,sourceText}'),'')='' or c#>>'{contact,affiliation,checkedAt}' is null or (c#>>'{contact,affiliation,checkedAt}')::timestamptz not between now()-interval '30 days' and now() or coalesce(c#>>'{contact,affiliation,sourceUrl}','')!~'^https://[^/@[:space:]]+\.[^/@[:space:]]+/') then raise exception 'missing creator affiliation';end if;
  if (select array_agg(distinct lower(m[1])) from regexp_matches(c#>>'{contact,sourceText}','[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}','gi') m) is distinct from array[recipient] or length(c#>>'{contact,sourceText}')>4000 then raise exception 'ambiguous email publication';end if;
  if replace(lower(c#>>'{contact,sourceText}'),recipient,'')!~'(협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor)' or c#>>'{contact,sourceText}'~*'(개인정보|채용|입사|privacy|recruit|career|support|customer|fan[[:space:]]*mail|no[[:space:]]+(business|collab)|not[[:space:]]+(for[[:space:]]+)?(business|collab)|(협업|광고|사업|제휴).{0,30}(거절|금지|받지|불가|아닙|아님|제외))' then raise exception 'non-collaboration contact';end if;
  if exists(select 1 from jsonb_each_text(jsonb_build_object('audience',c->>'audienceSource','activity',c->>'activitySource','mukbang',c#>>'{mukbang,sourceUrl}','contact',c#>>'{contact,sourceUrl}','profile',c->>'profileUrl','affiliation',case when c#>>'{contact,sourceKind}'='instagram_public_bio' then c->>'profileUrl' else c#>>'{contact,affiliation,sourceUrl}' end)) x where coalesce(x.value,'')!~'^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}([/?][^#[:space:]]*)?$' or x.value~'^https://([^/]+\.)?(localhost|local|internal|test|invalid)(/|$)') then raise exception 'invalid evidence source';end if;
  if c ? 'supplyReview' then
   if c->>'platform' is distinct from 'instagram' or c#>>'{supplyReview,source}' is distinct from 'existing_instagram_database' or c#>>'{supplyReview,sourceRecordUpdated}' is null or c#>>'{supplyReview,reviewedAt}' is null or c#>>'{supplyReview,expiresAt}' is null or (c#>>'{supplyReview,reviewedAt}')::timestamptz not between now()-interval '29 days' and now() or (c#>>'{supplyReview,expiresAt}')::timestamptz<=now() or (c#>>'{supplyReview,expiresAt}')::timestamptz>(c#>>'{supplyReview,reviewedAt}')::timestamptz+interval '29 days' then raise exception 'invalid Instagram source review';end if;
  end if;
  if c ? 'apiSnapshot' then
   if c->>'platform' is distinct from 'youtube' or c#>>'{apiSnapshot,channelId}' is distinct from split_part(c->>'creatorKey',':',2) or jsonb_typeof(c#>'{apiSnapshot,fieldNames}') is distinct from 'array' or c#>>'{apiSnapshot,observedAt}' is null or c#>>'{apiSnapshot,expiresAt}' is null or (c#>>'{apiSnapshot,observedAt}')::timestamptz not between now()-interval '29 days' and now() or (c#>>'{apiSnapshot,expiresAt}')::timestamptz<=now() or (c#>>'{apiSnapshot,expiresAt}')::timestamptz>(c#>>'{apiSnapshot,observedAt}')::timestamptz+interval '29 days' or jsonb_typeof(c#>'{apiSnapshot,titleFromApi}') is distinct from 'boolean' or exists(select 1 from jsonb_array_elements_text(c#>'{apiSnapshot,fieldNames}') f where f not in('creatorKey','externalId','profileUrl','name','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt')) then raise exception 'invalid api snapshot provenance';end if;
   if (c#>'{apiSnapshot,fieldNames}') ?| array['creatorKey','externalId','profileUrl'] or c#>'{apiSnapshot,titleFromApi}'='true'::jsonb then
    if c#>'{displayNameEvidence,verified}' is distinct from 'true'::jsonb or c#>>'{displayNameEvidence,kind}' not in('official_website','provided_by_creator') or c#>>'{displayNameEvidence,name}' is distinct from c->>'name' or c#>>'{displayNameEvidence,creatorKey}' is distinct from c->>'creatorKey' or c#>>'{displayNameEvidence,profileUrl}' is distinct from c->>'profileUrl' or coalesce(c#>>'{displayNameEvidence,sourceUrl}','')!~'^https://[^/@[:space:]]+\.[^/@[:space:]]+/' or c#>>'{displayNameEvidence,sourceUrl}'~*'^https://([^/]+\.)?(youtube\.com|youtu\.be|googleapis\.com)(/|$)' or position(c->>'name' in coalesce(c#>>'{displayNameEvidence,sourceText}',''))=0 or position(split_part(c->>'creatorKey',':',2) in coalesce(c#>>'{displayNameEvidence,sourceText}',''))=0 or c#>>'{displayNameEvidence,checkedAt}' is null or (c#>>'{displayNameEvidence,checkedAt}')::timestamptz not between now()-interval '29 days' and now() then raise exception 'independent creator identity required';end if;
   end if;
  end if;
  duplicate_found:=exists(select 1 from public.sanji_daily_outreach_candidates where owner=p_owner and (creator_key=c->>'creatorKey' or email_key=recipient_key));
  for history_row in select value from jsonb_array_elements(history_entries) loop
   if duplicate_found then exit;end if;
   duplicate_found:=position(to_jsonb(c->>'creatorKey')::text in history_row::text)>0
    or (coalesce(c->>'sourceRecordId','')<>'' and position(to_jsonb(c->>'sourceRecordId')::text in history_row::text)>0)
    or (c->>'platform'='youtube' and position('/channel/'||split_part(c->>'creatorKey',':',2) in history_row::text)>0)
    or (c->>'platform'='instagram' and (lower(history_row->>'resolvedHandle')=split_part(c->>'creatorKey',':',2) or lower(history_row->>'username')=split_part(c->>'creatorKey',':',2) or lower(history_row->>'handle')=split_part(c->>'creatorKey',':',2) or lower(history_row#>>'{resolvedTarget,handle}')=split_part(c->>'creatorKey',':',2)))
    or exists(select 1 from regexp_matches(lower(history_row::text),'[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}','g') m where public.sanji_daily_outreach_email_key(m[1])=recipient_key);
  end loop;
  if coalesce(duplicate_found,false) then skipped:=skipped+1;continue;end if;
  insert into public.sanji_daily_outreach_candidates(owner,creator_key,email_key,recipient,platform,day,snapshot,expires_at) values(p_owner,c->>'creatorKey',recipient_key,recipient,c->>'platform',p_day,c,least((c#>>'{contact,checkedAt}')::timestamptz+interval '30 days',(c->>'audienceCheckedAt')::timestamptz+interval '30 days',(c->>'activityCheckedAt')::timestamptz+interval '30 days',(c#>>'{mukbang,checkedAt}')::timestamptz+interval '30 days',(c->>'lastActiveAt')::timestamptz+interval '90 days',coalesce((c#>>'{contact,affiliation,checkedAt}')::timestamptz+interval '30 days','infinity'::timestamptz),coalesce((c#>>'{apiSnapshot,expiresAt}')::timestamptz,'infinity'::timestamptz),coalesce((c#>>'{displayNameEvidence,checkedAt}')::timestamptz+interval '29 days','infinity'::timestamptz),coalesce((c#>>'{supplyReview,expiresAt}')::timestamptz,'infinity'::timestamptz)));
  if c->>'platform'='youtube' then y:=y+1;else i:=i+1;end if;
 end loop;
 select coalesce(jsonb_object_agg(reason,n),'{}'::jsonb) into holds from (select r.reason,count(*) n from jsonb_array_elements(case when jsonb_typeof(p_plan->'held')='array' then p_plan->'held' else '[]'::jsonb end) h cross join lateral jsonb_array_elements_text(case when jsonb_typeof(h->'reasons')='array' then h->'reasons' else '[]'::jsonb end) r(reason) where r.reason~'^[a-z_]{1,80}$' group by r.reason) reasons;
 result:=jsonb_build_object('duplicate',prior is not null and y=coalesce((prior#>>'{counts,youtube}')::integer,0) and i=coalesce((prior#>>'{counts,instagram}')::integer,0),'holdReasons',holds,'historyScope','saved_sanji_history','gmailProviderHistoryChecked',false,'targetUnit','distinct_verified_business_email','maxEmailsPerCreator',1,'dedupeScope','cross_platform','audienceBounds','{"youtube":{"minimum":30000,"maximum":200000},"instagram":{"minimum":30000,"maximum":500000}}'::jsonb,'targets',jsonb_build_object('youtube',50,'instagram',10),'campaign','mara-jjamppong-bread','day',p_day,'counts',jsonb_build_object('youtube',y,'instagram',i),'shortfall',jsonb_build_object('youtube',50-y,'instagram',10-i),'duplicateSkippedAtSave',skipped,'sendingEnabled',false,'schedulerEnabled',false,'state','awaiting_dispatch_review','heldCount',case when jsonb_typeof(p_plan->'held')='array' then jsonb_array_length(p_plan->'held') else 0 end,'preparedAt',now());
 update public.sanji_daily_outreach_runs set summary=result where owner=p_owner and day=p_day;
 return result;
end $$;
-- UPDATE only for the summary finalization. No update/delete privilege on candidates.
grant update(summary) on public.sanji_daily_outreach_runs to service_role;
revoke all on function public.sanji_daily_outreach_email_key(text),public.sanji_daily_outreach_saved_history(uuid),public.sanji_daily_outreach_prepare(uuid,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sanji_daily_outreach_email_key(text),public.sanji_daily_outreach_saved_history(uuid),public.sanji_daily_outreach_prepare(uuid,date,jsonb) to service_role;
commit;
