begin;
-- Keep the query sequence independent of the daily budget. A failed/blocked query
-- still consumes its reservation; no CAPTCHA bypass, extra provider calls or paid search.
create or replace function public.sanji_claim_qualified_search_sources(p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r public.sanji_discovery_config;
 s jsonb;
 d text:=(now() at time zone 'Asia/Seoul')::date::text;
 c integer;
 next_cursor bigint;
begin
 select * into r from public.sanji_discovery_config where owner=p_owner and enabled for update;
 if not found then return null;end if;
 -- Raw emails/companies are not qualified brands. The shared quality predicate
 -- counts only this owner's eligible brands first qualified on this Korean day.
 if public.sanji_discovery_qualified_count(p_owner,d::date)>=r.target then return null;end if;
 if (select count(*) from public.sanji_discovery_leads where owner=p_owner and status='new')>=8 then return null;end if;
 s:=r.search_state;
 -- Also respect a live lease or cooldown that straddles Korean midnight.
 if coalesce((s->>'leaseUntil')::timestamptz,now()-interval '1 day')>now()
  or coalesce((s->>'checked')::timestamptz,now()-interval '1 day')>now()-interval '15 minutes' then return null;end if;
 if s->>'day'=d then c:=greatest(0,coalesce((s->>'queries')::integer,0));else c:=0;end if;
 -- Two queries per lease. Fail closed for an odd legacy counter rather than exceed 64.
 if c>62 then return null;end if;
 -- Existing deployments have cursor = first query of the last two-query lease.
 -- Resume after it on rollout, including when its day has already ended.
 next_cursor:=greatest(0,coalesce((s->>'nextCursor')::bigint,(s->>'cursor')::bigint+2,(s->>'queries')::bigint,0));
 s:=jsonb_build_object('day',d,'queries',c+2,'cursor',next_cursor,'nextCursor',next_cursor+2,
  'status','searching','checked',now(),'leaseUntil',now()+interval '3 minutes','adaptive',s->'adaptive');
 update public.sanji_discovery_config set search_state=s where owner=p_owner;
 return s;
end $$;
-- Retain the existing internal-only RPC boundary and owner-scoped row lock.
revoke all on function public.sanji_claim_qualified_search_sources(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_qualified_search_sources(uuid) to service_role;
commit;
