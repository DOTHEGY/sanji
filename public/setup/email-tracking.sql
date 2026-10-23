begin;
create table if not exists public.sanji_tracking_policy (
 owner uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false, version integer not null default 1,
 retention_days integer not null default 30 check(retention_days between 7 and 90),
 updated timestamptz not null default now()
);
create table if not exists public.sanji_email_campaigns (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 120), scope text not null check(scope in('brand','creator')),
 enabled boolean not null default false, external_tracking boolean not null default false,
 disclosure text not null default '', basis_note text not null default '', version integer not null default 1,
 created timestamptz not null default now(), updated timestamptz not null default now(), unique(owner,id)
);
create table if not exists public.sanji_email_tracking (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 outbox_id uuid not null unique references public.sanji_outbox(id) on delete cascade,
 campaign_id uuid not null, token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 mode text not null check(mode in('individual','shared')), recipient_count integer not null check(recipient_count>0),
 is_test boolean not null default false, created timestamptz not null default now(), expires timestamptz not null,
 foreign key(owner,campaign_id) references public.sanji_email_campaigns(owner,id)
);
create table if not exists public.sanji_email_image_events (
 id uuid primary key default gen_random_uuid(), tracking_id uuid not null references public.sanji_email_tracking(id) on delete cascade,
 requested timestamptz not null default now(), classification text not null check(classification in('unknown','suspected_automated')),
 reason text not null check(reason in('none','image_proxy','prefetch_header','scanner_user_agent')),
 source text not null default 'pixel' check(source='pixel')
);
create index if not exists email_image_events_tracking_time on public.sanji_email_image_events(tracking_id,requested);
create index if not exists email_tracking_owner_time on public.sanji_email_tracking(owner,created);
create index if not exists email_tracking_expiry on public.sanji_email_tracking(expires);
-- No IP, raw User-Agent, cookies, device ID, referrer or location columns are collected.
do $$declare t text;begin
 foreach t in array array['sanji_tracking_policy','sanji_email_campaigns','sanji_email_tracking','sanji_email_image_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- All statistics are accessed via authenticated Edge routes, not public table reads.
create or replace function public.sanji_record_image_request(p_hash text,p_classification text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare t public.sanji_email_tracking;
begin
 select * into t from public.sanji_email_tracking where token_hash=p_hash and expires>now() for update;
 if not found then return;end if;
 -- A stopped service/campaign stops collection for already sent pixels too.
 if not exists(select 1 from public.sanji_tracking_policy where owner=t.owner and enabled) or not exists(select 1 from public.sanji_email_campaigns where id=t.campaign_id and owner=t.owner and enabled and not external_tracking) then return;end if;
 if not exists(select 1 from public.sanji_outbox where id=t.outbox_id and status in('accepted','submitting','outcome_unknown')) then return;end if;
 -- Bound storage abuse. Counts are recorded requests, capped at 1,000 per message per UTC day.
 if (select count(*) from public.sanji_email_image_events where tracking_id=t.id and requested>=date_trunc('day',now()))>=1000 then return;end if;
 insert into public.sanji_email_image_events(tracking_id,classification,reason) values(t.id,case when p_classification='suspected_automated' then p_classification else 'unknown' end,case when p_reason in('image_proxy','prefetch_header','scanner_user_agent') then p_reason else 'none' end);
end $$;
create or replace function public.sanji_register_email_tracking(p_owner uuid,p_outbox uuid,p_hash text,p_campaign uuid,p_policy_version integer,p_campaign_version integer,p_sender text,p_test boolean default false,p_test_only boolean default true) returns public.sanji_email_tracking language plpgsql security definer set search_path='' as $$
declare o public.sanji_outbox;p public.sanji_tracking_policy;c public.sanji_email_campaigns;r public.sanji_email_tracking;n integer;is_self boolean;recipients jsonb;
begin
 select * into o from public.sanji_outbox where id=p_outbox and owner=p_owner and channel='email' and status='submitting';
 if not found then return null;end if;
 select * into p from public.sanji_tracking_policy where owner=p_owner and enabled and version=p_policy_version;
 if not found then return null;end if;
 select * into c from public.sanji_email_campaigns where id=p_campaign and owner=p_owner and enabled and not external_tracking and version=p_campaign_version and length(disclosure)>=20 and length(basis_note)>=5;
 if not found or o.data#>>'{tracking,eligible}'<>'true' or o.data#>>'{tracking,campaignId}'<>p_campaign::text then return null;end if;
 if position(c.disclosure in coalesce(o.data->>'body',''))=0 then return null;end if;
 recipients:=case when jsonb_typeof(o.data->'emails')='array' and jsonb_array_length(o.data->'emails')>0 then o.data->'emails' else jsonb_build_array(o.data->>'email') end;
 n:=jsonb_array_length(recipients);
 is_self:=exists(select 1 from jsonb_array_elements_text(recipients) e where lower(e)=lower(p_sender) or exists(select 1 from auth.users a where a.id=p_owner and lower(a.email)=lower(e)));
 if p_test_only and exists(select 1 from jsonb_array_elements_text(recipients) e where lower(e)<>lower(p_sender) and not exists(select 1 from auth.users a where a.id=p_owner and lower(a.email)=lower(e))) then return null;end if;
 insert into public.sanji_email_tracking(owner,outbox_id,campaign_id,token_hash,mode,recipient_count,is_test,expires)
 values(p_owner,p_outbox,p_campaign,p_hash,case when n>1 then 'shared' else 'individual' end,n,p_test or is_self,now()+make_interval(days=>p.retention_days)) returning * into r;
 update public.sanji_outbox set data=jsonb_set(data,'{trackingResult}',jsonb_build_object('applied',true,'campaignId',p_campaign,'mode',r.mode,'recipientCount',n,'isTest',r.is_test,'expires',r.expires)) where id=p_outbox and owner=p_owner;
 return r;
end $$;
create or replace function public.sanji_purge_email_tracking() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from public.sanji_email_tracking where expires<=now();get diagnostics n=row_count;
 -- Outbox keeps an applied/expired flag only; token mapping and image events cascade-delete.
 return n;
end $$;
create or replace function public.sanji_email_tracking_report(p_owner uuid,p_from timestamptz,p_to timestamptz,p_campaign uuid default null,p_include_automated boolean default false,p_target uuid default null) returns jsonb language sql security definer set search_path='' as $$
 with rows as (
 select o.id,o.target,o.status,o.created,o.data->>'subject' subject,o.data->>'email' email,o.data->'emails' emails,
 o.data->'trackingResult' tracking_result,coalesce(t.campaign_id::text,o.data#>>'{tracking,campaignId}') campaign_id,
 c.name campaign_name,c.scope,t.id tracking_id,t.mode,coalesce(t.is_test,(o.data#>>'{trackingResult,isTest}')::boolean,(o.data->>'trackingInternalTest')::boolean,false) is_test,t.expires,
 e.requests,e.suspected,e.first_request,e.last_request,e.first_included,e.last_included,e.reasons,
 coalesce(reply.conversation,false) conversation_reply,coalesce(reply.human,false) human_reply,coalesce(reply.positive,false) positive_reply
 from public.sanji_outbox o
 left join public.sanji_email_tracking t on t.outbox_id=o.id and t.owner=o.owner
 left join public.sanji_email_campaigns c on c.owner=o.owner and c.id::text=coalesce(t.campaign_id::text,o.data#>>'{tracking,campaignId}')
 left join lateral (
  select count(*)::integer requests,count(*) filter(where classification='suspected_automated')::integer suspected,
  min(requested) first_request,max(requested) last_request,
  min(requested) filter(where p_include_automated or classification='unknown') first_included,
  max(requested) filter(where p_include_automated or classification='unknown') last_included,
  coalesce(jsonb_agg(distinct reason) filter(where classification='suspected_automated'),'[]'::jsonb) reasons
  from public.sanji_email_image_events where tracking_id=t.id
 ) e on true
 left join lateral (
  select bool_or(exists(select 1 from jsonb_array_elements(coalesce(r.data->'messages','[]')) m where m->>'out'='false' and coalesce(m->>'automatic','false')<>'true' and (m->>'at')::timestamptz>=o.created)) conversation,
  bool_or(r.data->>'classification' in('관심 회신','수락','공동구매 확정') and exists(select 1 from jsonb_array_elements(coalesce(r.data->'messages','[]')) m where m->>'out'='false' and coalesce(m->>'automatic','false')<>'true' and (m->>'at')::timestamptz>=o.created)) positive,
  bool_or(exists(select 1 from jsonb_array_elements(coalesce(r.data->'messages','[]')) m where m->>'out'='false' and coalesce(m->>'automatic','false')<>'true' and m->>'inReplyTo'='<'||(o.data->>'messageId')||'@sanji.local>' and (m->>'at')::timestamptz>=o.created)) human
  from public.sanji_records r where r.owner=o.owner and r.kind='thread' and r.data->>'channel'='email' and r.data->>'target'=o.target::text
  and (r.data->>'providerId'=o.data->>'providerThread' or exists(select 1 from jsonb_array_elements(coalesce(r.data->'messages','[]')) sent where sent->>'messageId'='<'||(o.data->>'messageId')||'@sanji.local>'))
 ) reply on true
 where o.owner=p_owner and o.channel='email' and o.created>=p_from and o.created<p_to
 and (p_campaign is null or coalesce(t.campaign_id::text,o.data#>>'{tracking,campaignId}')=p_campaign::text)
 and (p_target is null or o.target=p_target)
 ), aggregate as (
 select count(*) filter(where status='accepted') sent,
 count(distinct target) filter(where status='accepted') sent_targets,
 count(distinct target) filter(where status='accepted' and conversation_reply) replied_targets,
 count(distinct target) filter(where status='accepted' and conversation_reply and positive_reply) positive_targets,
 count(*) filter(where status='accepted' and human_reply) human_replied,
 count(*) filter(where status='accepted' and human_reply and positive_reply) positive_replied,
 count(*) filter(where status='accepted' and tracking_id is not null and not is_test and expires>now()) tracked,
 count(*) filter(where status='accepted' and tracking_id is not null and not is_test and expires>now() and first_included is not null) estimated,
 count(*) filter(where tracking_result->>'applied'='true' and (tracking_id is null or expires<=now())) expired
 from rows where not is_test
 )
 select jsonb_build_object('from',p_from,'to',p_to,'includeAutomated',p_include_automated,'summary',(select to_jsonb(a) from aggregate a),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by created desc) from rows r),'[]'::jsonb))
$$;
do $$declare f text;begin
 foreach f in array array['public.sanji_record_image_request(text,text,text)','public.sanji_register_email_tracking(uuid,uuid,text,uuid,integer,integer,text,boolean,boolean)','public.sanji_purge_email_tracking()','public.sanji_email_tracking_report(uuid,timestamptz,timestamptz,uuid,boolean,uuid)'] loop
 execute 'revoke all on function '||f||' from public,anon,authenticated';execute 'grant execute on function '||f||' to service_role';end loop;
end $$;
commit;
