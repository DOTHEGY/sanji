begin;
alter table public.sanji_discovery_config add column if not exists search_state jsonb not null default '{}';
-- Separate, atomic lease: keep replenishing below the email-company target, without overlapping queries.
create or replace function public.sanji_claim_search_sources(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sanji_discovery_config;s jsonb;d text:=(now() at time zone 'Asia/Seoul')::date::text;c integer;
begin
 select * into r from public.sanji_discovery_config where owner=p_owner and enabled for update;
 if not found then return null;end if;
 if exists(select 1 from public.sanji_discovery_usage where owner=p_owner and day=d::date and companies>=r.target) then return null;end if;
 if (select count(*) from public.sanji_discovery_leads where owner=p_owner and status='new')>=8 then return null;end if;
 s:=r.search_state;
 if s->>'day'=d then
  if coalesce((s->>'leaseUntil')::timestamptz,now()-interval '1 day')>now() or coalesce((s->>'checked')::timestamptz,now()-interval '1 day')>now()-interval '15 minutes' then return null;end if;
  c:=coalesce((s->>'queries')::integer,0);if c>=64 then return null;end if;
 else c:=0;end if;
 s:=jsonb_build_object('day',d,'queries',c+2,'cursor',c,'status','searching','checked',now(),'leaseUntil',now()+interval '3 minutes');
 update public.sanji_discovery_config set search_state=s where owner=p_owner;
 return s;
end $$;
revoke all on function public.sanji_claim_search_sources(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_search_sources(uuid) to service_role;
commit;
