begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- PENDING LOCAL ONLY. Existing IG records are read, never changed/imported.
create table public.sanji_daily_supply_instagram_reviews (
 owner uuid not null references auth.users(id) on delete cascade,
 campaign text not null check(campaign='mara-jjamppong-bread'),
 creator_id uuid not null, source_updated timestamptz not null,
 creator_key text not null check(creator_key ~ '^instagram:[a-z0-9._]{1,30}$'),
 review jsonb not null check(jsonb_typeof(review)='object'),
 reviewed_at timestamptz not null, expires_at timestamptz not null,
 primary key(owner,campaign,creator_id),
 foreign key(creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade,
 check(expires_at>reviewed_at and expires_at<=reviewed_at+interval '29 days')
);
create index sanji_daily_instagram_review_expiry on public.sanji_daily_supply_instagram_reviews(expires_at);
-- No source text, contacts or metrics. This native CRM ID marker prevents older
-- evidence reviving after a supplemental review expires and is physically deleted.
create table public.sanji_daily_supply_instagram_review_guards (
 owner uuid not null references auth.users(id) on delete cascade,
 campaign text not null check(campaign='mara-jjamppong-bread'), creator_id uuid not null,
 last_reviewed_at timestamptz not null,
 primary key(owner,campaign,creator_id),
 foreign key(creator_id,owner) references public.sanji_creator_recovery(id,owner) on delete cascade
);
alter table public.sanji_daily_supply_instagram_reviews enable row level security;
alter table public.sanji_daily_supply_instagram_review_guards enable row level security;
revoke all on public.sanji_daily_supply_instagram_reviews,public.sanji_daily_supply_instagram_review_guards from public,anon,authenticated,service_role;
grant select,insert,update on public.sanji_daily_supply_instagram_reviews,public.sanji_daily_supply_instagram_review_guards to service_role;
grant delete on public.sanji_daily_supply_instagram_reviews to service_role;

create function public.sanji_daily_supply_instagram_review(p_owner uuid,p_campaign text,p_review jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare native public.sanji_creator_recovery; creator uuid; expires timestamptz; reviewed timestamptz; last_review timestamptz; m jsonb:=p_review->'mukbang'; contact jsonb; at_time timestamptz; prop text;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_campaign is distinct from 'mara-jjamppong-bread' or jsonb_typeof(p_review) is distinct from 'object' or p_review->>'reviewedBy' is distinct from p_owner::text or length(p_review::text)>20000 then raise exception 'invalid Instagram review owner';end if;
 if exists(select 1 from jsonb_object_keys(p_review) k where k not in('creatorKey','sourceRecordId','sourceRecordUpdated','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt','mukbang','contactEvidence','reviewedBy','reviewedAt','expiresAt')) then raise exception 'unexpected Instagram review input';end if;
 creator:=(p_review->>'sourceRecordId')::uuid;
 select * into native from public.sanji_creator_recovery where id=creator and owner=p_owner for update;
 if not found or p_review->>'creatorKey' is distinct from 'instagram:'||native.handle or (p_review->>'sourceRecordUpdated')::timestamptz is distinct from native.updated then raise exception 'Instagram source changed';end if;
 if native.status is distinct from 'new' or native.assessment='excluded' or native.entity_type='noncreator_suspected' or native.link_status is distinct from 'source_confirmed' then raise exception 'Instagram native exclusion';end if;
 if lower(rtrim(native.profile_url,'/')) not in('https://www.instagram.com/'||native.handle,'https://instagram.com/'||native.handle) then raise exception 'Instagram native profile invalid';end if;
 expires:=(p_review->>'expiresAt')::timestamptz;reviewed:=(p_review->>'reviewedAt')::timestamptz;
 if reviewed is null or reviewed>clock_timestamp() or reviewed<clock_timestamp()-interval '10 minutes' or expires is null or expires<=clock_timestamp() or expires>reviewed+interval '29 days' then raise exception 'Instagram review expiry invalid';end if;
 select last_reviewed_at into last_review from public.sanji_daily_supply_instagram_review_guards where owner=p_owner and campaign=p_campaign and creator_id=creator for update;
 if last_review is not null and reviewed<=last_review then raise exception 'Instagram review superseded';end if;
 if jsonb_typeof(p_review->'audience') is distinct from 'number' or (p_review->>'audience')::numeric not between 30000 and 500000 or (p_review->>'audience')::numeric<>trunc((p_review->>'audience')::numeric) then raise exception 'Instagram audience evidence required';end if;
 foreach prop in array array['audienceSource','activitySource'] loop
  if coalesce(p_review->>prop,'') !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}(/[^[:space:]#]*)?$' then raise exception 'Instagram source URL invalid';end if;
 end loop;
 foreach prop in array array['audienceCheckedAt','activityCheckedAt'] loop
  at_time:=(p_review->>prop)::timestamptz;
  if at_time is null or at_time>clock_timestamp() or at_time+interval '29 days'<expires then raise exception 'Instagram evidence time invalid';end if;
 end loop;
 at_time:=(p_review->>'lastActiveAt')::timestamptz;
 if at_time is null or at_time>clock_timestamp() or at_time<clock_timestamp()-interval '90 days' or expires>at_time+interval '90 days' then raise exception 'Instagram recent activity required';end if;
 if jsonb_typeof(m) is distinct from 'object' or m->'verified' is distinct from 'true'::jsonb or coalesce(m->>'sourceText','')='' or length(m->>'sourceText')>2000 or coalesce(m->>'sourceUrl','') !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}(/[^[:space:]#]*)?$' or m->>'checkedAt' is null or (m->>'checkedAt')::timestamptz>clock_timestamp() or (m->>'checkedAt')::timestamptz+interval '29 days'<expires then raise exception 'Instagram mukbang review required';end if;
 if jsonb_typeof(p_review->'contactEvidence') is distinct from 'array' or jsonb_array_length(p_review->'contactEvidence')>5 then raise exception 'Instagram contact evidence invalid';end if;
 for contact in select value from jsonb_array_elements(p_review->'contactEvidence') loop
  at_time:=(contact->>'checkedAt')::timestamptz;
  if contact->>'creatorKey' is distinct from 'instagram:'||native.handle or at_time is null or at_time>clock_timestamp() or at_time+interval '29 days'<expires then raise exception 'Instagram contact time invalid';end if;
  if contact ? 'affiliation' and contact->'affiliation'<>'null'::jsonb then
   at_time:=(contact#>>'{affiliation,checkedAt}')::timestamptz;
   if at_time is null or at_time>clock_timestamp() or at_time+interval '29 days'<expires then raise exception 'Instagram contact affiliation time invalid';end if;
  end if;
 end loop;
 insert into public.sanji_daily_supply_instagram_reviews(owner,campaign,creator_id,source_updated,creator_key,review,reviewed_at,expires_at)
 values(p_owner,p_campaign,creator,native.updated,'instagram:'||native.handle,p_review,reviewed,expires)
 on conflict(owner,campaign,creator_id) do update set source_updated=excluded.source_updated,creator_key=excluded.creator_key,review=excluded.review,reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at;
 insert into public.sanji_daily_supply_instagram_review_guards(owner,campaign,creator_id,last_reviewed_at) values(p_owner,p_campaign,creator,reviewed)
 on conflict(owner,campaign,creator_id) do update set last_reviewed_at=excluded.last_reviewed_at;
 return jsonb_build_object('saved',true,'creatorKey','instagram:'||native.handle,'sourceRecordId',creator,'sourceRecordUpdated',native.updated,'expiresAt',expires,'sendingEnabled',false);
end $$;
create function public.sanji_daily_supply_instagram_sweep() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare deleted integer;
begin
 delete from public.sanji_daily_supply_instagram_reviews where expires_at<=clock_timestamp();get diagnostics deleted=row_count;
 return jsonb_build_object('instagramReviewsDeleted',deleted);
end $$;
revoke all on function public.sanji_daily_supply_instagram_review(uuid,text,jsonb),public.sanji_daily_supply_instagram_sweep() from public,anon,authenticated;
grant execute on function public.sanji_daily_supply_instagram_review(uuid,text,jsonb),public.sanji_daily_supply_instagram_sweep() to service_role;
commit;
