begin;
-- New metrics are additive. Historical companies/emails and all jobs/drafts stay unchanged.
create or replace function public.sanji_discovery_qualified_count(p_owner uuid,p_day date)
returns integer language sql stable security invoker set search_path='' as $$
 select count(*)::integer from public.sanji_discovery_leads l
 where l.owner=p_owner and l.status<>'blocked'
 and l.data#>>'{qualification,revision}'='1'
 and l.data#>>'{qualification,eligible}'='true'
 and l.data#>>'{qualification,qualifiedDay}'=p_day::text
 and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
$$;
revoke all on function public.sanji_discovery_qualified_count(uuid,date) from public,anon,authenticated;
grant execute on function public.sanji_discovery_qualified_count(uuid,date) to service_role;

-- Apply eligibility BEFORE LIMIT. Old exhausted rows cannot hide newer work.
-- Background work does not rewrite imported historical batches or any queued/sent candidate.
create or replace function public.sanji_next_brand_research(p_owner uuid,p_product boolean default false,p_requested uuid default null)
returns setof public.sanji_discovery_leads language sql stable security invoker set search_path='' as $$
 select l.* from public.sanji_discovery_leads l
 where l.owner=p_owner and l.status='review'
 and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
 and (p_requested is null or l.id=p_requested)
 and case when jsonb_typeof(l.data->'contacts')='array' then jsonb_array_length(l.data->'contacts')>0 else false end
 and nullif(l.data->>'candidateId','') is null
 and (l.data->'research' is null or l.data->'research'='null'::jsonb
   or l.data#>>'{outreach,needsPersonalization}'='true'
   or coalesce(l.data#>>'{outreach,sendBlockedReason}','')<>''
   or l.data#>>'{research,ownership}'='research_pending'
   or l.data#>>'{outreach,draftMode}'='brand_first'
   or l.data#>>'{qualification,eligible}'='false')
 and (p_product or case when coalesce(l.data#>>'{research,attempts}','0') ~ '^\d+$' then coalesce(l.data#>>'{research,attempts}','0')::int else 0 end < 3)
 and (not p_product or (l.data#>>'{outreach,draftMode}'='brand_first'
   and case when coalesce(l.data#>>'{productLookup,attempts}','0') ~ '^\d+$' then coalesce(l.data#>>'{productLookup,attempts}','0')::int else 0 end < 3))
 and (p_requested is not null or coalesce(l.data#>>'{research,attempts}','0')='0'
   or nullif(l.data#>>'{research,checked}','') is null
   or case when pg_catalog.pg_input_is_valid(l.data#>>'{research,checked}','timestamp with time zone') then (l.data#>>'{research,checked}')::timestamptz < now()-case when p_product then interval '15 minutes' else interval '6 hours' end else false end)
 order by l.updated,l.id limit 1
$$;
revoke all on function public.sanji_next_brand_research(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.sanji_next_brand_research(uuid,boolean,uuid) to service_role;
create or replace function public.sanji_claim_qualified_discovery_notification(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.sanji_discovery_config;u public.sanji_discovery_usage;d date:=(now() at time zone 'Asia/Seoul')::date;recipient text;s jsonb;n integer;qualified integer;
begin
 select * into cfg from public.sanji_discovery_config where owner=p_owner and enabled and notify_completion;
 if not found or not exists(select 1 from public.sanji_members where user_id=p_owner) then return null;end if;
 select * into u from public.sanji_discovery_usage where owner=p_owner and day=d;
 qualified:=public.sanji_discovery_qualified_count(p_owner,d);
 if not found or qualified<cfg.target then return null;end if;
 select email into recipient from auth.users where id=p_owner;
 if recipient is null or recipient!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null;end if;
 s:=jsonb_build_object('day',d,'recipient',recipient,'target',cfg.target,'companies',u.companies,'qualified',qualified,'emails',u.emails,'processed',u.processed);
 insert into public.sanji_discovery_notifications(owner,day,snapshot) values(p_owner,d,s) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return null;end if;
 return s;
end $$;
revoke all on function public.sanji_claim_qualified_discovery_notification(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_qualified_discovery_notification(uuid) to service_role;
commit;
