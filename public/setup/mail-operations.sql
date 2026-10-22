begin;
-- Remove the app's daily cap; approval, suppression, idempotency and Gmail quotas remain.
do $change$
declare definition text;
begin
 select pg_get_functiondef('public.sanji_save_record(text,jsonb,uuid,integer)'::regprocedure) into definition;
 definition:=replace(definition,$old$if (v->>'dailyLimit')::integer not between 1 and 100 then raise exception '일일 제한은 1~100입니다.';end if;$old$,'');
 definition:=replace(definition,$old$'dailyLimit',(v->>'dailyLimit')::integer,$old$,'');
 if position('일일 제한은 1~100입니다.' in definition)>0 then raise exception 'Settings cap migration did not match';end if;
 execute definition;
 select pg_get_functiondef('public.sanji_reserve_dispatch(uuid,uuid,text,text)'::regprocedure) into definition;
 definition:=replace(definition,$old$select * into s from public.sanji_records where owner=p_owner and kind='settings';lim:=coalesce((s.data->>'dailyLimit')::integer,20);$old$,'');
 definition:=replace(definition,$old$if (select count(*) from public.sanji_outbox where owner=p_owner and created>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=lim then raise exception '일일 제한 초과';end if;$old$,'');
 if position('일일 제한 초과' in definition)>0 then raise exception 'Dispatch cap migration did not match';end if;
 execute definition;
end $change$;
update public.sanji_records set data=data-'dailyLimit',version=version+1,updated=now() where kind='settings' and data?'dailyLimit';

-- Preserve the first day an email was acquired, separately from candidate creation.
create or replace function public.sanji_discovered_at(p_checked text,p_created timestamptz) returns timestamptz language plpgsql stable set search_path='' as $$
declare t timestamptz;
begin
 begin t:=nullif(p_checked,'')::timestamptz;exception when others then t:=p_created;end;
 return least(now(),greatest(coalesce(t,p_created),p_created));
end $$;
update public.sanji_discovery_leads l set data=data||jsonb_build_object('firstEmailAt',coalesce((select min(public.sanji_discovered_at(c->>'checked',l.created)) from jsonb_array_elements(coalesce(l.data->'contacts','[]')) c),l.created))
where jsonb_array_length(coalesce(data->'contacts','[]'))>0 and not(data?'firstEmailAt');

create or replace function public.sanji_discovery_history(p_owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with days as(select ((now() at time zone 'Asia/Seoul')::date-i)::date as day from generate_series(0,29) i),
 leads as(select l.*,(public.sanji_discovered_at(coalesce(data->>'firstEmailAt',data->>'checked'),created) at time zone 'Asia/Seoul')::date first_day from public.sanji_discovery_leads l where owner=p_owner and status<>'blocked' and jsonb_array_length(coalesce(data->'contacts','[]'))>0),
 emails as(select lower(c->>'email') email,min(public.sanji_discovered_at(c->>'checked',l.created)) first_at from leads l cross join lateral jsonb_array_elements(l.data->'contacts') c where coalesce(c->>'email','')<>'' group by lower(c->>'email'))
 select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'companies',(select count(*) from leads l where l.first_day=d.day),'publicCompanies',(select count(*) from leads l where l.first_day=d.day and exists(select 1 from jsonb_array_elements(l.data->'contacts') c where c->>'discoveryMethod'='public_page')),'emails',(select count(*) from emails e where (e.first_at at time zone 'Asia/Seoul')::date=d.day),'candidates',(select count(*) from public.sanji_discovery_leads l where l.owner=p_owner and (l.created at time zone 'Asia/Seoul')::date=d.day)) order by d.day desc),'[]'::jsonb) from days d
$$;
revoke all on function public.sanji_discovery_history(uuid) from public,anon,authenticated;
grant execute on function public.sanji_discovery_history(uuid) to service_role;
commit;
