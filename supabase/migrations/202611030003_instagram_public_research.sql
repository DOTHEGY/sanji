-- Candidate only: public observations are data, never instructions.
begin;
create table public.sanji_instagram_public_research (
 owner uuid not null references auth.users(id),account_id text not null,peer_id text not null,handle text not null,
 profile_url text not null,observed_at timestamptz not null,topics jsonb not null,sources jsonb not null,capture_sha256 text not null,attested_by uuid not null references auth.users(id),received_at timestamptz not null default now(),
 primary key(owner,account_id,peer_id,observed_at)
);
alter table public.sanji_instagram_public_research enable row level security;
revoke all on public.sanji_instagram_public_research from public,anon,authenticated,service_role;
grant select on public.sanji_instagram_public_research to service_role;
create function public.sanji_instagram_research_import(p_owner uuid,p_account text,p_peer text,p_profile_url text,p_observed timestamptz,p_topics jsonb,p_sources jsonb,p_capture_sha256 text,p_attested boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare h text; t text; v jsonb;
begin
 if p_attested is distinct from true or p_account !~ '^[0-9]{1,100}$' or p_peer !~ '^[0-9]{1,100}$' or p_peer=p_account or not exists(select 1 from public.sanji_members where user_id=p_owner) or not exists(select 1 from public.sanji_connections where owner=p_owner and provider='instagram:'||p_account and summary->>'accountId'=p_account and lower(summary->>'username')='valu_est' and summary->'connected'='true'::jsonb and summary->'apiVerified'='true'::jsonb) or not exists(select 1 from public.sanji_instagram_inbound where owner=p_owner and account_id=p_account and peer_id=p_peer) then raise exception 'invalid research request';end if;
 select lower(username) into h from public.sanji_instagram_peer_profiles where owner=p_owner and account_id=p_account and peer_id=p_peer and username_observed_at between now()-interval '7 days' and now()+interval '5 minutes';
 if h is null or h !~ '^[a-z0-9._]{1,30}$' or h in ('.','..','valu_est') or p_profile_url not in ('https://instagram.com/'||h,'https://instagram.com/'||h||'/','https://www.instagram.com/'||h,'https://www.instagram.com/'||h||'/') or p_observed not between now()-interval '7 days' and now()+interval '5 minutes' or jsonb_typeof(p_topics) is distinct from 'array' or jsonb_array_length(p_topics) not between 1 and 10 or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 10 or coalesce(p_capture_sha256,'') !~ '^[a-f0-9]{64}$' then raise exception 'invalid research provenance';end if;
 for v in select value from jsonb_array_elements(p_topics) loop
  if jsonb_typeof(v)<>'string' then raise exception 'invalid public topic';end if; t:=v #>> '{}';
  if t not in ('travel','drone_photography','travel_sponsorships','packaged_vegetable_drink','parenting','household_bath','food_easy_meals','restaurants','home_interior','home_cafe','dining','household_lifestyle','beauty','fashion','fitness','pets','outdoors','baking','coffee','food','lifestyle','photography') then raise exception 'invalid public topic';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(v)<>'string' then raise exception 'invalid public source'; end if; t:=v #>> '{}';
  if left(t,length('https://www.instagram.com/'||h||'/'))<>'https://www.instagram.com/'||h||'/' or substring(t from length('https://www.instagram.com/'||h||'/')+1) !~ '^(p|reel)/[A-Za-z0-9_-]{1,100}/?$' then raise exception 'invalid public source';end if;
 end loop;
 insert into public.sanji_instagram_public_research(owner,account_id,peer_id,handle,profile_url,observed_at,topics,sources,capture_sha256,attested_by) values(p_owner,p_account,p_peer,h,p_profile_url,p_observed,p_topics,p_sources,p_capture_sha256,p_owner) on conflict do nothing;
 if found then return true;end if;
 if exists(select 1 from public.sanji_instagram_public_research where owner=p_owner and account_id=p_account and peer_id=p_peer and observed_at=p_observed and handle=h and profile_url=p_profile_url and topics=p_topics and sources=p_sources and capture_sha256=p_capture_sha256) then return false;end if;
 raise exception 'research observation collision';
end $$;
revoke all on function public.sanji_instagram_research_import(uuid,text,text,text,timestamptz,jsonb,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.sanji_instagram_research_import(uuid,text,text,text,timestamptz,jsonb,jsonb,text,boolean) to service_role;
commit;
