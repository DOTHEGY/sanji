begin;
-- Completed search enqueue outcomes only: no directory/manual imports, email counts,
-- mutable qualifications, or reserved-but-unfinished query slots enter the baseline.
create or replace function public.sanji_discovery_search_history(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with owned as (
  select a.* from public.sanji_audit a where a.owner=p_owner
  and a.action in ('discovery_search_refilled','discovery_search_reserved')
  and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
 ), completed as (
  select coalesce(case when data->>'searchDay' ~ '^\d{4}-\d{2}-\d{2}$' then data->>'searchDay' end,
   ((created at time zone 'Asia/Seoul')::date)::text) as day,
   case when data->>'queries'='2' and data->>'added' ~ '^\d{1,8}$' then 2 else -100000 end as queries,
   case when data->>'added' ~ '^\d{1,8}$' then (data->>'added')::integer else 0 end as added
  from owned where action='discovery_search_refilled' and created>=now()-interval '60 days'
 ), days as (
  select day,sum(queries)::integer as queries,sum(added)::integer as added from completed group by day
 ), used as (
  select distinct trim(s->>'query') as query from owned a
  cross join lateral jsonb_array_elements(case
   when a.action='discovery_search_reserved' and jsonb_typeof(a.data->'selections')='array' then a.data->'selections'
   when a.action='discovery_search_refilled' and jsonb_typeof(a.data->'sources')='array' then a.data->'sources'
   else '[]'::jsonb end) s
  where length(trim(s->>'query')) between 1 and 200
 ) select jsonb_build_object(
  'history',coalesce((select jsonb_agg(jsonb_build_object('day',day,'completedQueries',queries,'added',added,'metric','unique_homepage_candidates') order by day) from days),'[]'::jsonb),
  'usedQueries',coalesce((select jsonb_agg(query order by query) from used),'[]'::jsonb))
$$;
revoke all on function public.sanji_discovery_search_history(uuid) from public,anon,authenticated;
grant execute on function public.sanji_discovery_search_history(uuid) to service_role;

-- Atomic plan compare-and-set + ordinary two-query lease. Store reservations before
-- fetching so a crash cannot silently recycle their phrases. No daily-counter reset.
create or replace function public.sanji_claim_adaptive_search_sources(
 p_owner uuid,p_expected jsonb,p_adaptive jsonb,p_selections jsonb,p_next_cursor bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.sanji_discovery_config;lease jsonb;pending jsonb;
begin
 select * into cfg from public.sanji_discovery_config where owner=p_owner and enabled for update;
 if not found or not exists(select 1 from public.sanji_members where user_id=p_owner) then return null;end if;
 if nullif(cfg.search_state->'adaptive','null'::jsonb) is distinct from nullif(p_expected,'null'::jsonb) then return null;end if;
 if jsonb_typeof(p_adaptive) is distinct from 'object' or octet_length(p_adaptive::text)>600000 then raise exception 'Invalid adaptive plan';end if;
 if jsonb_typeof(p_selections) is distinct from 'array' or jsonb_array_length(p_selections) not in (0,2) then raise exception 'Exactly two query slots required';end if;
 if exists(select 1 from jsonb_array_elements(p_selections) s where coalesce(length(s->>'query'),0) not between 2 and 200 or s->>'query' ~ E'[\\r\\n]') then raise exception 'Invalid query';end if;
 update public.sanji_discovery_config set search_state=jsonb_set(coalesce(search_state,'{}'::jsonb),'{adaptive}',p_adaptive,true) where owner=p_owner;
 if jsonb_array_length(p_selections)=0 then return null;end if;
 lease:=public.sanji_claim_qualified_search_sources(p_owner);
 if lease is null then return null;end if;
 if p_next_cursor is not null and (p_next_cursor<(lease->>'nextCursor')::bigint or p_next_cursor>9007199254740991) then raise exception 'Invalid next search cursor';end if;
 select coalesce(jsonb_agg(q),'[]'::jsonb) into pending from jsonb_array_elements(coalesce(p_adaptive->'pendingQueries','[]'::jsonb)) q
 where not exists(select 1 from jsonb_array_elements(p_selections) s where s->>'query'=q->>'query');
 lease:=lease||jsonb_build_object('adaptive',p_adaptive||jsonb_build_object('pendingQueries',pending),'selections',p_selections,'nextCursor',coalesce(p_next_cursor,(lease->>'nextCursor')::bigint));
 update public.sanji_discovery_config set search_state=lease where owner=p_owner;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'discovery_search_reserved',jsonb_build_object('day',lease->>'day','cursor',lease->'cursor','checked',lease->'checked','selections',p_selections));
 return lease;
end $$;
revoke all on function public.sanji_claim_adaptive_search_sources(uuid,jsonb,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sanji_claim_adaptive_search_sources(uuid,jsonb,jsonb,jsonb,bigint) to service_role;
commit;
