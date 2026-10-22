begin;
alter table public.sanji_discovery_config alter column target set default 40;
alter table public.sanji_discovery_config add column if not exists source_state jsonb not null default '{}';
alter table public.sanji_discovery_usage add column if not exists companies integer not null default 0;

-- Template changes update unsent lead copies, retaining their researched introduction.
-- Approved previews and queued jobs are invalidated; sent or in-flight mail is immutable.
create or replace function public.sanji_render_lead_copy(p_text text,p_brand text,p_product text,p_intro text) returns text language plpgsql immutable set search_path='' as $$
declare r text:=coalesce(p_text,'');
begin
 r:=replace(replace(replace(r,'{{브랜드명}}',p_brand),'{{회사명}}',p_brand),'{{제품명}}',p_product);
 if position('{{개인화}}' in r)>0 then r:=replace(r,'{{개인화}}',p_intro);
 elsif coalesce(p_intro,'')<>'' then r:=p_intro||E'\n\n'||r;end if;
 return r;
end $$;
create or replace function public.sanji_refresh_template_leads(p_template uuid) returns integer language plpgsql security definer set search_path='' as $$
declare t public.sanji_records;l public.sanji_discovery_leads;o jsonb;b text;p text;i text;n integer:=0;
begin
 select * into t from public.sanji_records where id=p_template and kind='template' and data->>'channel'='이메일';
 if not found then return 0;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.owner::text,0));
 for l in select * from public.sanji_discovery_leads where owner=t.owner and status<>'blocked' and jsonb_array_length(coalesce(data->'contacts','[]'::jsonb))>0 for update loop
  o:=coalesce(l.data->'outreach','{}'::jsonb);
  if coalesce(o->>'templateId',p_template::text)<>p_template::text then continue;end if;
  if exists(select 1 from public.sanji_outbox x where x.owner=t.owner and (x.target::text=l.data->>'candidateId' or exists(select 1 from jsonb_array_elements(coalesce(l.data->'contacts','[]'::jsonb)) c where lower(c->>'email')=lower(x.data->>'email'))) and x.status in('accepted','submitting','outcome_unknown')) then continue;end if;
  if exists(select 1 from public.sanji_jobs j join public.sanji_drafts d on d.id=j.draft_id where j.owner=t.owner and j.status='processing' and d.data->>'target'=l.data->>'candidateId') then continue;end if;
  b:=coalesce(nullif(o->>'brandName',''),nullif(l.data->>'name',''),l.data->>'company','업체');
  p:=coalesce(nullif(o->>'productName',''),nullif(l.data->>'product',''),'공동구매 협의 가능한 상품');
  i:=coalesce(o->>'intro','');
  update public.sanji_jobs j set status='cancelled',result=jsonb_build_object('reason','템플릿 변경 · 최신 내용 재승인 필요') from public.sanji_drafts d where j.draft_id=d.id and j.owner=t.owner and j.status='queued' and d.data->>'target'=l.data->>'candidateId';
  update public.sanji_drafts set expires=now()-interval '1 second' where owner=t.owner and not used and data->>'target'=l.data->>'candidateId';
  o:=o||jsonb_build_object('subject',public.sanji_render_lead_copy(t.data->>'subject',b,p,''),'body',public.sanji_render_lead_copy(t.data->>'body',b,p,i),'signature',public.sanji_render_lead_copy(t.data->>'signature',b,p,''),'brandName',b,'companyName',b,'productName',p,'templateId',t.id,'templateVersion',t.version,'templateUpdated',t.updated,'approved',false,'needsPersonalization',i='','updated',now());
  update public.sanji_discovery_leads set data=jsonb_set(data,'{outreach}',o),updated=now() where id=l.id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.sanji_refresh_template_leads(uuid) from public,anon,authenticated;
grant execute on function public.sanji_refresh_template_leads(uuid) to service_role;
create or replace function public.sanji_template_refresh_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='template' and new.data->>'channel'='이메일' then perform public.sanji_refresh_template_leads(new.id);end if;return new;
end $$;
drop trigger if exists sanji_template_lead_copies on public.sanji_records;
create trigger sanji_template_lead_copies after insert or update of data on public.sanji_records for each row execute function public.sanji_template_refresh_trigger();

-- Daily refresh is leased independently from the per-company crawl.
create or replace function public.sanji_claim_daily_sources(p_owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.sanji_discovery_config;d text:=(now() at time zone 'Asia/Seoul')::date::text;
begin
 select * into r from public.sanji_discovery_config where owner=p_owner and enabled for update;
 if not found then return false;end if;
 if r.source_state->>'day'=d and (r.source_state->>'status'='completed' or coalesce((r.source_state->>'attempts')::integer,0)>=3 or coalesce((r.source_state->>'leaseUntil')::timestamptz,now()-interval '1 day')>now() or coalesce((r.source_state->>'checked')::timestamptz,now()-interval '1 day')>now()-interval '6 hours') then return false;end if;
 update public.sanji_discovery_config set source_state=jsonb_build_object('day',d,'status','running','attempts',case when r.source_state->>'day'=d then coalesce((r.source_state->>'attempts')::integer,0)+1 else 1 end,'leaseUntil',now()+interval '3 minutes'),updated=now() where owner=p_owner;
 return true;
end $$;
revoke all on function public.sanji_claim_daily_sources(uuid) from public,anon,authenticated;
grant execute on function public.sanji_claim_daily_sources(uuid) to service_role;

create or replace function public.sanji_discovery_claim(p_owner uuid) returns public.sanji_discovery_usage language plpgsql security definer set search_path='' as $$
declare r public.sanji_discovery_usage; d date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '관리자 권한이 필요합니다.';end if;
 insert into public.sanji_discovery_usage(owner,day) values(p_owner,d) on conflict do nothing;
 update public.sanji_discovery_usage set calls=calls+1,lease_until=now()+interval '2 minutes' where owner=p_owner and day=d and (lease_until is null or lease_until<now()) and calls<240 returning * into r;
 return r;
end $$;
revoke all on function public.sanji_discovery_claim(uuid) from public,anon,authenticated;
grant execute on function public.sanji_discovery_claim(uuid) to service_role;


-- Enforce source deduplication against the full history, not a paginated UI list.
create or replace function public.sanji_enqueue_discovery_sources(p_owner uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare x jsonb;h text;n integer:=0;k integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception '관리자 권한이 필요합니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 for x in select value from jsonb_array_elements(p_rows) limit 200 loop
  h:=lower(regexp_replace(split_part(regexp_replace(x#>>'{data,website}','^https?://','','i'),'/',1),'^www\.',''));
  if coalesce(x->>'identity','')='' or coalesce(x#>>'{data,website}','')!~'^https://' or h='' then continue;end if;
  if exists(select 1 from public.sanji_discovery_leads l where l.owner=p_owner and (l.identity=x->>'identity' or lower(regexp_replace(split_part(regexp_replace(l.data->>'website','^https?://','','i'),'/',1),'^www\.',''))=h or (coalesce(x#>>'{data,sourceEntity}','')<>'' and l.data->>'sourceEntity'=x#>>'{data,sourceEntity}'))) then continue;end if;
  insert into public.sanji_discovery_leads(owner,identity,data) values(p_owner,x->>'identity',x->'data') on conflict(owner,identity) do nothing;
  get diagnostics k=row_count;n:=n+k;
 end loop;return n;
end $$;
revoke all on function public.sanji_enqueue_discovery_sources(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_enqueue_discovery_sources(uuid,jsonb) to service_role;

commit;
