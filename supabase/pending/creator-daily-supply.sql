begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- PENDING LOCAL REVIEW ONLY. No migration, production DDL, cron or credentials.
-- New worker budget only: 20 search + 500 ordinary units per Google project/PT
-- day leaves headroom for existing consumers but cannot observe their usage.
create table public.sanji_daily_supply_runs (
 owner uuid not null references auth.users(id) on delete cascade,
 campaign text not null check(campaign='mara-jjamppong-bread'), day date not null,
 state text not null check(state in ('running','completed','failed')),
 lease_token uuid not null, lease_expires_at timestamptz not null,
 search_calls integer not null default 0 check(search_calls between 0 and 4),
 read_calls integer not null default 0 check(read_calls between 0 and 112),
 cursor_state jsonb, cursor_expires_at timestamptz,
 summary jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner,campaign,day),
 check(cursor_state is null or (jsonb_typeof(cursor_state)='object' and cursor_expires_at is not null and cursor_expires_at<=created_at+interval '29 days'))
);
create table public.sanji_daily_supply_snapshots (
 owner uuid not null references auth.users(id) on delete cascade,
 campaign text not null check(campaign='mara-jjamppong-bread'),
 channel_id text not null check(channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 observed_at timestamptz not null, expires_at timestamptz not null,
 primary key(owner,campaign,channel_id),
 check(expires_at>observed_at and expires_at<=observed_at+interval '29 days')
);
create index sanji_daily_supply_expiry on public.sanji_daily_supply_snapshots(expires_at);
-- Human-reviewed independent identity/contact evidence, separate from API facts.
create table public.sanji_daily_supply_reviews (
 owner uuid not null references auth.users(id) on delete cascade,
 campaign text not null check(campaign='mara-jjamppong-bread'),
 creator_key text not null check(creator_key ~ '^youtube:UC[A-Za-z0-9_-]{22}$'),
 review jsonb not null check(jsonb_typeof(review)='object'),
 reviewed_at timestamptz not null, expires_at timestamptz not null,
 primary key(owner,campaign,creator_key),
 check(expires_at>reviewed_at and expires_at<=reviewed_at+interval '29 days')
);
create index sanji_daily_supply_review_expiry on public.sanji_daily_supply_reviews(expires_at);
alter table public.sanji_daily_supply_reviews enable row level security;
revoke all on public.sanji_daily_supply_reviews from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.sanji_daily_supply_reviews to service_role;

create table public.sanji_daily_supply_quota (
 project_id text not null check(project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
 pt_day date not null, search_reserved integer not null default 0 check(search_reserved between 0 and 20), read_reserved integer not null default 0 check(read_reserved between 0 and 500),
 primary key(project_id,pt_day)
);
create table public.sanji_daily_supply_reservations (
 request_id uuid primary key, project_id text not null, pt_day date not null,
 owner uuid not null, campaign text not null, day date not null, lease_token uuid not null,
 kind text not null check(kind in('search','read')), created_at timestamptz not null default now(),
 foreign key(project_id,pt_day) references public.sanji_daily_supply_quota(project_id,pt_day),
 foreign key(owner,campaign,day) references public.sanji_daily_supply_runs(owner,campaign,day)
);
alter table public.sanji_daily_supply_runs enable row level security;
alter table public.sanji_daily_supply_snapshots enable row level security;
alter table public.sanji_daily_supply_quota enable row level security;
alter table public.sanji_daily_supply_reservations enable row level security;
revoke all on public.sanji_daily_supply_runs,public.sanji_daily_supply_snapshots,public.sanji_daily_supply_quota,public.sanji_daily_supply_reservations from public,anon,authenticated,service_role;
grant select,insert,update on public.sanji_daily_supply_runs,public.sanji_daily_supply_snapshots,public.sanji_daily_supply_quota to service_role;
grant select,insert on public.sanji_daily_supply_reservations to service_role;
grant delete on public.sanji_daily_supply_snapshots to service_role;

create function public.sanji_daily_supply_claim(p_owner uuid,p_campaign text,p_day date,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.sanji_daily_supply_runs; prior jsonb;
begin
 if p_owner is null or p_token is null or p_campaign is distinct from 'mara-jjamppong-bread' or p_day is distinct from (clock_timestamp() at time zone 'Asia/Seoul')::date or not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid supply owner or day';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-supply:'||p_owner::text||':'||p_campaign,0));
 select * into r from public.sanji_daily_supply_runs where owner=p_owner and campaign=p_campaign and day=p_day for update;
 if found then
  if r.state in ('completed','failed') then return jsonb_build_object('state',r.state,'summary',r.summary);end if;
  if r.lease_expires_at>clock_timestamp() then return '{"state":"busy"}'::jsonb;end if;
  update public.sanji_daily_supply_runs set lease_token=p_token,lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where owner=p_owner and campaign=p_campaign and day=p_day;
  return jsonb_build_object('state','claimed','cursor',case when r.cursor_expires_at>clock_timestamp() then r.cursor_state else null end,'searchCalls',r.search_calls,'readCalls',r.read_calls);
 end if;
 select cursor_state into prior from public.sanji_daily_supply_runs where owner=p_owner and campaign=p_campaign and day<p_day and state='completed' and cursor_expires_at>clock_timestamp() order by day desc limit 1;
 insert into public.sanji_daily_supply_runs(owner,campaign,day,state,lease_token,lease_expires_at) values(p_owner,p_campaign,p_day,'running',p_token,clock_timestamp()+interval '5 minutes');
 return jsonb_build_object('state','claimed','cursor',prior,'searchCalls',0,'readCalls',0);
end $$;

create function public.sanji_daily_supply_reserve(p_owner uuid,p_campaign text,p_day date,p_token uuid,p_project text,p_kind text,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.sanji_daily_supply_runs; q public.sanji_daily_supply_quota; pt date:=(clock_timestamp() at time zone 'America/Los_Angeles')::date;
begin
 if p_project is null or p_project !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$' or p_kind is null or p_kind not in('search','read') or p_request is null then raise exception 'invalid quota reservation';end if;
 select * into r from public.sanji_daily_supply_runs where owner=p_owner and campaign=p_campaign and day=p_day for update;
 if not found or r.state<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() or p_day is distinct from (clock_timestamp() at time zone 'Asia/Seoul')::date then return '{"granted":false,"code":"lease_lost"}'::jsonb;end if;
 -- Every attempt needs a fresh key. Reusing a reservation after a lost response
 -- cannot authorize a second network call. Invalid provider requests cost too.
 if exists(select 1 from public.sanji_daily_supply_reservations where request_id=p_request) then return '{"granted":false,"code":"already_reserved"}'::jsonb;end if;
 if (p_kind='search' and r.search_calls>=4) or (p_kind='read' and r.read_calls>=112) then return '{"granted":false,"code":"run_limit"}'::jsonb;end if;
 insert into public.sanji_daily_supply_quota(project_id,pt_day) values(p_project,pt) on conflict do nothing;
 select * into q from public.sanji_daily_supply_quota where project_id=p_project and pt_day=pt for update;
 if (p_kind='search' and q.search_reserved>=20) or (p_kind='read' and q.read_reserved>=500) then return '{"granted":false,"code":"project_limit"}'::jsonb;end if;
 insert into public.sanji_daily_supply_reservations(request_id,project_id,pt_day,owner,campaign,day,lease_token,kind) values(p_request,p_project,pt,p_owner,p_campaign,p_day,p_token,p_kind);
 update public.sanji_daily_supply_quota set search_reserved=search_reserved+case when p_kind='search' then 1 else 0 end,read_reserved=read_reserved+case when p_kind='read' then 1 else 0 end where project_id=p_project and pt_day=pt;
 update public.sanji_daily_supply_runs set search_calls=search_calls+case when p_kind='search' then 1 else 0 end,read_calls=read_calls+case when p_kind='read' then 1 else 0 end,updated_at=clock_timestamp() where owner=p_owner and campaign=p_campaign and day=p_day;
 return jsonb_build_object('granted',true,'ptDay',pt,'scope','daily_supply_worker_only');
end $$;

create function public.sanji_daily_supply_finish(p_owner uuid,p_campaign text,p_day date,p_token uuid,p_cursor jsonb,p_snapshots jsonb,p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.sanji_daily_supply_runs; c jsonb; observed timestamptz; expiry timestamptz; result jsonb; cursor_expiry timestamptz;
begin
 select * into r from public.sanji_daily_supply_runs where owner=p_owner and campaign=p_campaign and day=p_day for update;
 if not found or r.state<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() or p_day is distinct from (clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception 'supply lease lost';end if;
 if jsonb_typeof(p_snapshots) is distinct from 'array' or jsonb_array_length(p_snapshots)>100 or jsonb_typeof(p_cursor) is distinct from 'object' or jsonb_typeof(p_summary) is distinct from 'object' or p_summary->>'state' is distinct from 'completed' or p_summary->'sendingEnabled' is distinct from 'false'::jsonb or p_summary->'schedulerEnabled' is distinct from 'false'::jsonb then raise exception 'invalid supply completion';end if;
 cursor_expiry:=(p_cursor->>'expiresAt')::timestamptz;
 if (p_cursor->>'anchor') is null or cursor_expiry is null or cursor_expiry<=clock_timestamp() or cursor_expiry>clock_timestamp()+interval '7 days' or (p_cursor->>'anchor')::timestamptz>clock_timestamp() or length(p_cursor::text)>20000 then raise exception 'invalid cursor expiry';end if;
 for c in select value from jsonb_array_elements(p_snapshots) loop
  observed:=(c->>'observedAt')::timestamptz;expiry:=(c->>'expiresAt')::timestamptz;
  if c->>'channelId' is null or c->>'channelId' !~ '^UC[A-Za-z0-9_-]{22}$' or c->>'source' is distinct from 'youtube_data_api' or c->'reviewRequired' is distinct from 'true'::jsonb or c->>'url' is distinct from 'https://www.youtube.com/channel/'||(c->>'channelId') or c->'subscriberCount' is null or jsonb_typeof(c->'subscriberCount') is distinct from 'number' or (c->>'subscriberCount')::numeric not between 30000 and 200000 or (c->>'subscriberCount')::numeric<>trunc((c->>'subscriberCount')::numeric) or observed is null or observed>clock_timestamp() or observed<clock_timestamp()-interval '10 minutes' or expiry is null or expiry>observed+interval '29 days' or expiry<=clock_timestamp() or (c->>'lastActiveAt') is null or (c->>'lastActiveAt')::timestamptz<clock_timestamp()-interval '90 days' or (c->>'lastActiveAt')::timestamptz>clock_timestamp() or jsonb_typeof(c->'recentVideos') is distinct from 'array' or jsonb_array_length(c->'recentVideos')>5 or jsonb_array_length(c->'recentVideos')<1 or length(c::text)>12000 or c ?| array['contactEvidence','email','description','mukbang','gender'] then raise exception 'invalid supply snapshot';end if;
  insert into public.sanji_daily_supply_snapshots(owner,campaign,channel_id,snapshot,observed_at,expires_at) values(p_owner,p_campaign,c->>'channelId',c,observed,expiry) on conflict(owner,campaign,channel_id) do update set snapshot=excluded.snapshot,observed_at=excluded.observed_at,expires_at=excluded.expires_at;
 end loop;
 -- Persist counts only; never copy API material into permanent summaries.
 result:=jsonb_build_object('state','completed','day',p_day,'campaign',p_campaign,'stagedYoutube',jsonb_array_length(p_snapshots),'examined',coalesce((p_summary->>'examined')::integer,0),'skippedExisting',coalesce((p_summary->>'skippedExisting')::integer,0),'excludedBounds',coalesce((p_summary->>'excludedBounds')::integer,0),'unverifiedActivity',coalesce((p_summary->>'unverifiedActivity')::integer,0),'targets',jsonb_build_object('youtube',50,'instagram',10),'youtubeResearchShortfall',greatest(0,50-jsonb_array_length(p_snapshots)),'contactReadyGuaranteed',false,'quota',jsonb_build_object('searchCalls',r.search_calls,'readCalls',r.read_calls),'quotaScope','daily_supply_worker_only','recentActivityDays',90,'provisionalActivityWindow',true,'stopCode',null,'sendingEnabled',false,'schedulerEnabled',false);
 update public.sanji_daily_supply_runs set state='completed',cursor_state=p_cursor,cursor_expires_at=cursor_expiry,summary=result,lease_expires_at=clock_timestamp(),updated_at=clock_timestamp() where owner=p_owner and campaign=p_campaign and day=p_day;
 return result;
end $$;

create function public.sanji_daily_supply_fail(p_owner uuid,p_campaign text,p_day date,p_token uuid,p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; r public.sanji_daily_supply_runs;
begin
 select * into r from public.sanji_daily_supply_runs where owner=p_owner and campaign=p_campaign and day=p_day for update;
 if not found or r.state<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() then raise exception 'supply lease lost';end if;
 result:=jsonb_build_object('state','failed','day',p_day,'campaign',p_campaign,'stopCode',case when p_summary->>'stopCode' ~ '^SUPPLY_[A-Z_]{1,60}$' then p_summary->>'stopCode' else 'SUPPLY_UNAVAILABLE' end,'quota',jsonb_build_object('searchCalls',r.search_calls,'readCalls',r.read_calls),'sendingEnabled',false,'schedulerEnabled',false);
 update public.sanji_daily_supply_runs set state='failed',summary=result,lease_expires_at=clock_timestamp(),updated_at=clock_timestamp() where owner=p_owner and campaign=p_campaign and day=p_day;
 return result;
end $$;


create function public.sanji_daily_supply_review(p_owner uuid,p_campaign text,p_review jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.sanji_daily_supply_snapshots; d jsonb:=p_review->'displayNameEvidence'; m jsonb:=p_review->'mukbang'; expiry timestamptz; reviewed timestamptz; key text:=p_review->>'creatorKey';
begin
 if p_campaign is distinct from 'mara-jjamppong-bread' or not exists(select 1 from public.sanji_members where user_id=p_owner) or jsonb_typeof(p_review) is distinct from 'object' or key is null or key !~ '^youtube:UC[A-Za-z0-9_-]{22}$' or p_review->>'reviewedBy' is distinct from p_owner::text or p_review->'independentlyReviewed' is distinct from 'true'::jsonb or length(p_review::text)>20000 or p_review ?| array['audience','subscriberCount','title','gender','description'] then raise exception 'invalid supply review owner or input';end if;
 select * into c from public.sanji_daily_supply_snapshots where owner=p_owner and campaign=p_campaign and channel_id=substring(key from 9) for update;
 if not found or c.expires_at<=clock_timestamp() or (p_review->>'snapshotObservedAt')::timestamptz is distinct from c.observed_at then raise exception 'stale supply review';end if;
 reviewed:=(p_review->>'reviewedAt')::timestamptz;expiry:=(p_review->>'expiresAt')::timestamptz;
 if reviewed is null or reviewed>clock_timestamp() or reviewed<clock_timestamp()-interval '10 minutes' or expiry is null or expiry<=clock_timestamp() or expiry>reviewed+interval '29 days' or expiry>c.expires_at then raise exception 'invalid review expiry';end if;
 if jsonb_typeof(d) is distinct from 'object' or d->'verified' is distinct from 'true'::jsonb or coalesce(d->>'kind','') not in('official_website','provided_by_creator') or d->>'creatorKey' is distinct from key or d->>'profileUrl' is distinct from 'https://www.youtube.com/channel/'||c.channel_id or coalesce(d->>'name','')='' or length(d->>'name')>150 or coalesce(d->>'sourceUrl','') !~ '^https://[^/@#]+[.][^/@#]+(/|$)' or lower(d->>'sourceUrl') ~ '^https://([^/]+[.])?(youtube[.]com|youtu[.]be|googleapis[.]com)(/|$)' or position(c.channel_id in coalesce(d->>'sourceText',''))=0 or position(d->>'name' in coalesce(d->>'sourceText',''))=0 or length(d->>'sourceText')>4000 or (d->>'checkedAt') is null or (d->>'checkedAt')::timestamptz>clock_timestamp() or (d->>'checkedAt')::timestamptz+interval '29 days'<expiry then raise exception 'independent identity evidence required';end if;
 if jsonb_typeof(m) is distinct from 'object' or m->'verified' is distinct from 'true'::jsonb or coalesce(m->>'sourceUrl','') !~ '^https://[^/@#]+[.][^/@#]+(/|$)' or coalesce(m->>'sourceText','')='' or length(m->>'sourceText')>2000 or (m->>'checkedAt') is null or (m->>'checkedAt')::timestamptz>clock_timestamp() or (m->>'checkedAt')::timestamptz+interval '29 days'<expiry or jsonb_typeof(p_review->'contactEvidence') is distinct from 'array' or jsonb_array_length(p_review->'contactEvidence')>5 then raise exception 'manual mukbang or contact evidence required';end if;
 insert into public.sanji_daily_supply_reviews(owner,campaign,creator_key,review,reviewed_at,expires_at) values(p_owner,p_campaign,key,p_review,reviewed,expiry) on conflict(owner,campaign,creator_key) do update set review=excluded.review,reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at;
 return jsonb_build_object('saved',true,'creatorKey',key,'expiresAt',expiry,'sendingEnabled',false);
end $$;
revoke all on function public.sanji_daily_supply_review(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_daily_supply_review(uuid,text,jsonb) to service_role;

create function public.sanji_daily_supply_sweep() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare snapshots_deleted integer; cursors_deleted integer; reviews_deleted integer;
begin
 -- Physical deletion, not only an expires_at filter. 29-day snapshots leave a
 -- full day of scheduler margin below the 30-calendar-day policy maximum.
 delete from public.sanji_daily_supply_snapshots where expires_at<=clock_timestamp();get diagnostics snapshots_deleted=row_count;
 delete from public.sanji_daily_supply_reviews where expires_at<=clock_timestamp();get diagnostics reviews_deleted=row_count;
 update public.sanji_daily_supply_runs set cursor_state=null,cursor_expires_at=null where cursor_expires_at<=clock_timestamp();get diagnostics cursors_deleted=row_count;
 return jsonb_build_object('snapshotsDeleted',snapshots_deleted,'cursorsDeleted',cursors_deleted,'reviewsDeleted',reviews_deleted);
end $$;
revoke all on function public.sanji_daily_supply_claim(uuid,text,date,uuid),public.sanji_daily_supply_reserve(uuid,text,date,uuid,text,text,uuid),public.sanji_daily_supply_finish(uuid,text,date,uuid,jsonb,jsonb,jsonb),public.sanji_daily_supply_fail(uuid,text,date,uuid,jsonb),public.sanji_daily_supply_sweep() from public,anon,authenticated;
grant execute on function public.sanji_daily_supply_claim(uuid,text,date,uuid),public.sanji_daily_supply_reserve(uuid,text,date,uuid,text,text,uuid),public.sanji_daily_supply_finish(uuid,text,date,uuid,jsonb,jsonb,jsonb),public.sanji_daily_supply_fail(uuid,text,date,uuid,jsonb),public.sanji_daily_supply_sweep() to service_role;
commit;
