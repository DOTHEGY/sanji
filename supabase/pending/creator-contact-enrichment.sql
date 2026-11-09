begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- REVIEW ONLY. Never applied by build/cron. No mail, provider or existing-record writes.
-- Versioned trust registry; client registration always starts pending.
create table public.sanji_contact_source_versions (
 owner uuid not null references auth.users(id) on delete cascade, source_id uuid not null default gen_random_uuid(),
 revision integer not null check(revision>0), creator_key text not null check(creator_key~'^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$'),
 source_url text not null check(length(source_url) between 10 and 1000 and source_url~'^https://[^/@[:space:]?#]+/[^?#[:space:]]*$'),
 source_kind text not null check(source_kind in('official_website','instagram_public_bio')),
 state text not null check(state in('pending','reviewed','revoked')),
 stored_link jsonb, policy_review jsonb, affiliation jsonb, display_name_evidence jsonb, created_at timestamptz not null default now(),
 primary key(owner,source_id,revision),
 check(state<>'reviewed' or (jsonb_typeof(stored_link)='object' and jsonb_typeof(policy_review)='object' and jsonb_typeof(affiliation)='object' and stored_link is not null and policy_review is not null and affiliation is not null)),
 check(state<>'pending' or (stored_link is null and policy_review is null and affiliation is null and display_name_evidence is null))
);
create index sanji_contact_sources_creator on public.sanji_contact_source_versions(owner,creator_key,source_id,revision desc);
-- One append-only log contains fetch reservations and publication observations.
-- The reservation survives network failure/timeout so there is no same-day retry.
create table public.sanji_contact_observations (
 owner uuid not null references auth.users(id) on delete cascade, id uuid not null default gen_random_uuid(),
 creator_key text not null, kind text not null check(kind in('fetch_attempt','publication')),
 source_id uuid, source_revision integer, day date not null default (now() at time zone 'Asia/Seoul')::date,
 payload jsonb not null check(jsonb_typeof(payload)='object'), created_at timestamptz not null default now(),
 primary key(owner,id), foreign key(owner,source_id,source_revision) references public.sanji_contact_source_versions(owner,source_id,revision) on delete cascade,
 check((kind='fetch_attempt' and source_id is not null and source_revision is not null) or (kind='publication' and source_id is null and source_revision is null))
);
create unique index sanji_contact_fetch_daily on public.sanji_contact_observations(owner,source_id,day) where kind='fetch_attempt';
create unique index sanji_contact_url_daily on public.sanji_contact_observations(owner,(payload->>'sourceUrl'),day) where kind='fetch_attempt';
create index sanji_contact_publication_latest on public.sanji_contact_observations(owner,creator_key,created_at desc) where kind='publication';
alter table public.sanji_contact_source_versions enable row level security;
alter table public.sanji_contact_observations enable row level security;
revoke all on public.sanji_contact_source_versions,public.sanji_contact_observations from public,anon,authenticated,service_role;
grant select,insert on public.sanji_contact_source_versions,public.sanji_contact_observations to service_role;
-- Apply creator-daily-supply.sql first: a new API channel needs an owner-bound,
-- unexpired independent identity review before it can register a contact source.
create function public.sanji_contact_creator_anchor(p_owner uuid,p_creator_key text,p_record text default null)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.sanji_records r where r.owner=p_owner and r.kind='candidate' and r.data->>'channels'='YouTube' and (p_record is null or r.id::text=p_record) and p_creator_key='youtube:'||coalesce(r.data#>>'{youtubeResearch,channelId}',substring(r.data->>'profile' from '/channel/(UC[A-Za-z0-9_-]{22})/?$')))
 or exists(select 1 from public.sanji_creator_recovery c where c.owner=p_owner and (p_record is null or c.id::text=p_record) and p_creator_key='instagram:'||lower(c.handle))
 or exists(
  select 1 from public.sanji_daily_supply_snapshots s join public.sanji_daily_supply_reviews r on r.owner=s.owner and r.campaign=s.campaign and r.creator_key='youtube:'||s.channel_id
  where s.owner=p_owner and s.campaign='mara-jjamppong-bread' and r.creator_key=p_creator_key and (p_record is null or p_record=p_creator_key)
   and s.expires_at>now() and r.expires_at>now() and s.observed_at between now()-interval '29 days' and now()
   and (r.review->>'snapshotObservedAt')::timestamptz=s.observed_at and r.review->>'reviewedBy'=p_owner::text and r.review->'independentlyReviewed'='true'::jsonb
   and r.review#>'{displayNameEvidence,verified}'='true'::jsonb and r.review#>>'{displayNameEvidence,creatorKey}'=p_creator_key
   and r.review#>>'{displayNameEvidence,profileUrl}'='https://www.youtube.com/channel/'||s.channel_id
   and r.review#>>'{displayNameEvidence,kind}' in('official_website','provided_by_creator')
   and coalesce(btrim(r.review#>>'{displayNameEvidence,name}'),'')<>'' and length(r.review#>>'{displayNameEvidence,name}')<=150
   and r.review#>>'{displayNameEvidence,sourceUrl}'~'^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}(/[^#[:space:]]*)?$'
   and r.review#>>'{displayNameEvidence,sourceUrl}'!~*'^https://([^/]+[.])?(youtube[.]com|youtu[.]be|googleapis[.]com|localhost|local|internal|test|invalid)(/|$)'
   and position(r.review#>>'{displayNameEvidence,name}' in r.review#>>'{displayNameEvidence,sourceText}')>0
   and position(s.channel_id in r.review#>>'{displayNameEvidence,sourceText}')>0
   and (r.review#>>'{displayNameEvidence,checkedAt}')::timestamptz between now()-interval '29 days' and now()
 )
$$;
-- No update/delete/upsert grants: a reviewer appends a new version instead.
create function public.sanji_contact_source_version_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare prior public.sanji_contact_source_versions;
begin
 -- Same first lock as final dispatch; source additions/revocations serialize.
 perform pg_advisory_xact_lock(hashtextextended(new.owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=new.owner) then raise exception 'invalid owner';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner::text||new.source_id::text,0));
 select * into prior from public.sanji_contact_source_versions where owner=new.owner and source_id=new.source_id order by revision desc limit 1;
 if found then
  if new.revision<>prior.revision+1 or new.creator_key<>prior.creator_key or new.source_url<>prior.source_url or new.source_kind<>prior.source_kind then raise exception 'source revision or identity changed';end if;
 elsif new.revision<>1 or new.state<>'pending' then raise exception 'source must start pending';end if;
 if new.state='reviewed' then
  if not public.sanji_contact_creator_anchor(new.owner,new.creator_key,new.stored_link->>'sourceRecordId') then raise exception 'owner-bound saved link required';end if;
  if new.stored_link->>'creatorKey' is distinct from new.creator_key or new.stored_link->>'url' is distinct from new.source_url or coalesce(new.stored_link->>'sourceRecordId','')='' or coalesce(new.stored_link->>'reviewedBy','')='' or new.policy_review->>'exactUrl' is distinct from new.source_url or new.policy_review->>'decision' is distinct from (case when new.source_kind='official_website' then 'allow_public_get' else 'allow_existing_official_bio' end) or (new.policy_review->>'expiresAt')::timestamptz<=now() or (new.policy_review->>'reviewedAt')::timestamptz not between now()-interval '7 days' and now() or (new.policy_review->>'expiresAt')::timestamptz>(new.policy_review->>'reviewedAt')::timestamptz+interval '7 days' or new.affiliation->'verified' is distinct from 'true'::jsonb or new.affiliation->'independentlyVerified' is distinct from 'true'::jsonb or new.affiliation->>'creatorKey' is distinct from new.creator_key or new.affiliation->>'officialUrl' is distinct from new.source_url or coalesce(new.affiliation->>'reviewedBy','')='' then raise exception 'invalid source review';end if;
  if new.policy_review->>'reviewedAt' is null or new.policy_review->>'expiresAt' is null then raise exception 'missing review dates';end if;
 end if;
 return new;
end $$;
create trigger sanji_contact_source_append_guard before insert on public.sanji_contact_source_versions for each row execute function public.sanji_contact_source_version_guard();
create function public.sanji_contact_source_request(p_owner uuid,p_creator_key text,p_source_url text,p_source_kind text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.sanji_contact_source_versions; inserted public.sanji_contact_source_versions;
begin
 -- Same first lock as final dispatch; source additions/revocations serialize.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 -- Registration only for an existing, owner-bound saved creator.
 if not public.sanji_contact_creator_anchor(p_owner,p_creator_key,null) then raise exception 'saved creator required';end if;
 if p_source_kind='instagram_public_bio' and (split_part(p_creator_key,':',1)<>'instagram' or p_source_url not in('https://instagram.com/'||split_part(p_creator_key,':',2)||'/','https://www.instagram.com/'||split_part(p_creator_key,':',2)||'/')) then raise exception 'invalid bio profile';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_creator_key||p_source_url,0));
 select * into existing from public.sanji_contact_source_versions where owner=p_owner and creator_key=p_creator_key and source_url=p_source_url and source_kind=p_source_kind order by revision desc limit 1;
 if found then return jsonb_build_object('sourceId',existing.source_id,'revision',existing.revision,'state',existing.state,'created',false);end if;
 insert into public.sanji_contact_source_versions(owner,revision,creator_key,source_url,source_kind,state) values(p_owner,1,p_creator_key,p_source_url,p_source_kind,'pending') returning * into inserted;
 return jsonb_build_object('sourceId',inserted.source_id,'revision',1,'state','pending','created',true);
end $$;
create function public.sanji_contact_enrichment_load(p_owner uuid,p_creator_keys text[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare sources jsonb; observations jsonb; bios jsonb;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or cardinality(p_creator_keys)>5000 or p_creator_keys is null or exists(select 1 from unnest(p_creator_keys) k where k is null or k!~'^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$') then raise exception 'invalid input';end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into sources from (select distinct on(source_id) * from public.sanji_contact_source_versions where owner=p_owner and creator_key=any(p_creator_keys) order by source_id,revision desc) s;
 select coalesce(jsonb_agg(s.payload),'[]') into observations from (select distinct on(creator_key) payload from public.sanji_contact_observations where owner=p_owner and creator_key=any(p_creator_keys) and kind='publication' order by creator_key,created_at desc,id desc) s;
 -- Existing exact public-bio evidence only. No new Meta call, new account or scraping.
 -- Keep tied newest rows so the adapter can detect contradictory observations.
 select coalesce(jsonb_agg(jsonb_build_object('owner',e.owner,'creatorKey','instagram:'||lower(c.handle),'sourceUrl',e.source_url,'text',e.detail->>'bio','checkedAt',e.detail->>'bio_checked_at','contentAvailable',e.detail->'bio_content_available','sourceProvider',e.source_provider,'sourceRef',e.source_ref)),'[]') into bios from public.sanji_creator_evidence e join public.sanji_creator_recovery c on c.owner=e.owner and c.id=e.creator_id where e.owner=p_owner and 'instagram:'||lower(c.handle)=any(p_creator_keys) and e.source_kind='public_bio' and e.source_provider in('instagram_official','instagram_public') and e.source_url=c.profile_url and e.detail->>'bio_source_url'=c.profile_url and (e.detail->>'bio_checked_at')::timestamptz=(select max((x.detail->>'bio_checked_at')::timestamptz) from public.sanji_creator_evidence x where x.owner=e.owner and x.creator_id=e.creator_id and x.source_kind='public_bio' and x.source_url=e.source_url and x.source_provider in('instagram_official','instagram_public'));
 if jsonb_array_length(sources)>15000 or jsonb_array_length(bios)>20000 then raise exception 'source limit exceeded';end if;
 return jsonb_build_object('complete',true,'sources',sources,'observations',observations,'bios',bios);
end $$;
create function public.sanji_contact_enrichment_reserve(p_owner uuid,p_creator_key text,p_source_id uuid,p_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.sanji_contact_source_versions; n integer;
begin
 -- Same first lock as final dispatch; source additions/revocations serialize.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_source_id::text,0));
 select * into s from public.sanji_contact_source_versions where owner=p_owner and source_id=p_source_id order by revision desc limit 1;
 if not found or s.creator_key<>p_creator_key or s.revision<>p_revision or s.state<>'reviewed' or s.source_kind<>'official_website' or coalesce((s.policy_review->>'expiresAt')::timestamptz,'-infinity')<=now() or coalesce((s.policy_review->>'reviewedAt')::timestamptz,'-infinity')<now()-interval '7 days' then return '{"reserved":false,"reason":"source_changed"}';end if;
 insert into public.sanji_contact_observations(owner,creator_key,kind,source_id,source_revision,payload) values(p_owner,p_creator_key,'fetch_attempt',p_source_id,p_revision,jsonb_build_object('sourceUrl',s.source_url)) on conflict do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('reserved',n=1,'reason',case when n=1 then 'reserved' else 'source_daily_budget_used' end);
end $$;
create function public.sanji_contact_enrichment_observe(p_owner uuid,p_observation jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare refs jsonb; k text; evidence jsonb; ref jsonb;
begin
 -- Same first lock as final dispatch; source additions/revocations serialize.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_observation->>'owner' is distinct from p_owner::text or p_observation->'publicationEvidenceOnly' is distinct from 'true'::jsonb then raise exception 'invalid owner or observation';end if;
 k:=p_observation->>'creatorKey';evidence:=p_observation->'evidence';
 if k is null or k!~'^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$' or jsonb_typeof(evidence) is distinct from 'object' or evidence->>'creatorKey' is distinct from k or coalesce(p_observation->>'status','')!~'^[a-z_]{1,80}$' or (p_observation->>'recordedAt')::timestamptz not between now()-interval '5 minutes' and now()+interval '5 seconds' or p_observation->>'recordedAt' is null or p_observation->>'validUntil' is null then raise exception 'invalid publication';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||k,0));
 -- Same source locks as source version appends avoid a revocation/save race.
 for ref in select value from jsonb_array_elements(p_observation->'sourceVersions') order by value->>'sourceId' loop perform pg_advisory_xact_lock(hashtextextended(p_owner::text||(ref->>'sourceId'),0));end loop;
 select coalesce(jsonb_agg(jsonb_build_object('sourceId',s.source_id,'revision',s.revision) order by s.source_id),'[]') into refs from (select distinct on(source_id) source_id,revision from public.sanji_contact_source_versions where owner=p_owner and creator_key=k order by source_id,revision desc) s;
 if refs='[]'::jsonb or refs is distinct from p_observation->'sourceVersions' then raise exception 'source changed';end if;
 if (p_observation->>'status'='publication_verified') is distinct from (evidence->'verified'='true'::jsonb) then raise exception 'publication status mismatch';end if;
 insert into public.sanji_contact_observations(owner,creator_key,kind,payload) values(p_owner,k,'publication',p_observation);
 return '{"saved":true}';
end $$;
revoke all on function public.sanji_contact_creator_anchor(uuid,text,text),public.sanji_contact_source_version_guard(),public.sanji_contact_source_request(uuid,text,text,text),public.sanji_contact_enrichment_load(uuid,text[]),public.sanji_contact_enrichment_reserve(uuid,text,uuid,integer),public.sanji_contact_enrichment_observe(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sanji_contact_creator_anchor(uuid,text,text),public.sanji_contact_source_version_guard(),public.sanji_contact_source_request(uuid,text,text,text),public.sanji_contact_enrichment_load(uuid,text[]),public.sanji_contact_enrichment_reserve(uuid,text,uuid,integer),public.sanji_contact_enrichment_observe(uuid,jsonb) to service_role;
commit;
