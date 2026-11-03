-- Candidate design only; not applied to production.
begin;
create table public.sanji_creator_one_click_templates (
 owner uuid not null references auth.users(id), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 subject text not null, body text not null, active boolean not null default true, approved_at timestamptz not null default now(),
 primary key(owner,sha256)
);
create unique index sanji_creator_one_click_one_active_template on public.sanji_creator_one_click_templates(owner) where active;
create table public.sanji_creator_one_click_runs (
 owner uuid not null references auth.users(id), id uuid not null, day date not null, run_kind text not null default 'recommend' check(run_kind in ('recommend','existing')),
 target integer not null check(target between 1 and 500), template_sha256 text not null check(template_sha256 ~ '^[a-f0-9]{64}$'), paused boolean not null default false, created timestamptz not null default now(),
 primary key(owner,id)
);
create table public.sanji_creator_one_click_items (
 owner uuid not null, run_id uuid not null, creator_id uuid not null,
 status text not null default 'pending' check(status in ('pending','skipped','submitting','outcome_unknown','queued')),
 reason text, job_id uuid, draft_id uuid, draft_hash text, run_at timestamptz, connection_fingerprint text, created timestamptz not null default now(),
 primary key(owner,run_id,creator_id), unique(owner,creator_id),
 foreign key(owner,run_id) references public.sanji_creator_one_click_runs(owner,id),
 foreign key(creator_id) references public.sanji_creator_recovery(id)
);
create index sanji_creator_one_click_items_draft on public.sanji_creator_one_click_items(owner,draft_id) where draft_id is not null;
alter table public.sanji_creator_one_click_runs enable row level security;
alter table public.sanji_creator_one_click_items enable row level security;
alter table public.sanji_creator_one_click_templates enable row level security;
revoke all on public.sanji_creator_one_click_runs,public.sanji_creator_one_click_items,public.sanji_creator_one_click_templates from public,anon,authenticated,service_role;
grant select on public.sanji_creator_one_click_runs,public.sanji_creator_one_click_items,public.sanji_creator_one_click_templates to service_role;
create function public.sanji_creator_one_click_template(p_owner uuid,p_subject text,p_body text,p_approved boolean) returns text
language plpgsql security definer set search_path='' as $$
declare h text;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_approved is distinct from true or p_subject is distinct from '도합 300만 크리에이터와 함께 일하는 남준혁 변리사입니다' or p_body is null or length(p_body) not between 1 and 15000 or position('{{아이디}}' in p_body)=0 or position('{{상품명}}' in p_body)=0 or replace(replace(p_body,'{{아이디}}',''),'{{상품명}}','') ~ '\{\{[^{}]+\}\}' then raise exception 'invalid template';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,726));
 h:=encode(sha256(convert_to(p_subject||chr(10)||p_body,'UTF8')),'hex');
 update public.sanji_creator_one_click_templates set active=false where owner=p_owner and sha256<>h and active;
 insert into public.sanji_creator_one_click_templates(owner,sha256,subject,body) values(p_owner,h,p_subject,p_body) on conflict(owner,sha256) do update set active=true,approved_at=now();
 return h;
end $$;
create function public.sanji_creator_one_click_start(p_owner uuid,p_run uuid,p_day date,p_target integer,p_template_sha256 text) returns integer
language plpgsql security definer set search_path='' as $$
declare prior uuid[]; added integer; frozen integer; existing public.sanji_creator_one_click_runs;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_run is null or p_day is distinct from (now() at time zone 'Asia/Seoul')::date or p_target is null or p_target not between 1 and 500 or p_template_sha256 is null or p_template_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid request'; end if;
 if not exists(select 1 from public.sanji_creator_one_click_templates where owner=p_owner and sha256=p_template_sha256 and active) then raise exception 'approved template unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select * into existing from public.sanji_creator_one_click_runs where owner=p_owner and id=p_run;
 if found then if existing.day<>p_day or existing.target<>p_target or existing.template_sha256<>p_template_sha256 or existing.run_kind<>'recommend' then raise exception 'run parameters mismatch';end if;return (select count(*)::int from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run);end if;
 if exists(select 1 from public.sanji_creator_one_click_items i join public.sanji_creator_one_click_runs r on r.owner=i.owner and r.id=i.run_id left join public.sanji_jobs j on j.owner=i.owner and j.id=i.job_id where i.owner=p_owner and ((i.status='pending' and r.day=p_day) or i.status in ('submitting','outcome_unknown') or (i.status='queued' and (j.id is null or j.status is null or j.status not in ('queued','processing','completed'))))) then raise exception 'previous run requires attention';end if;
 select coalesce(array_agg(creator_id),'{}'::uuid[]) into prior from public.sanji_creator_recommendations where owner=p_owner and day=p_day;
 added:=public.sanji_creator_recommend(p_owner,p_day,p_target);
 insert into public.sanji_creator_one_click_runs(owner,id,day,target,template_sha256) values(p_owner,p_run,p_day,p_target,p_template_sha256);
 insert into public.sanji_creator_one_click_items(owner,run_id,creator_id) select p_owner,p_run,creator_id from public.sanji_creator_recommendations where owner=p_owner and day=p_day and not (creator_id=any(prior));
 get diagnostics frozen=row_count;if frozen<>added then raise exception 'recommendation snapshot mismatch';end if;
 return frozen;
end $$;
-- Explicitly approved current-day confirmed IDs only; never infers old targets.
create function public.sanji_creator_one_click_adopt(p_owner uuid,p_run uuid,p_day date,p_ids uuid[],p_template_sha256 text,p_approved boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer; existing public.sanji_creator_one_click_runs;
begin
 n:=coalesce(cardinality(p_ids),0);
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_approved is distinct from true or p_run is null or p_day is distinct from (now() at time zone 'Asia/Seoul')::date or n not between 1 and 500 or array_position(p_ids,null) is not null or n<>(select count(distinct v)::int from unnest(p_ids) v) or not exists(select 1 from public.sanji_creator_one_click_templates where owner=p_owner and sha256=p_template_sha256 and active) then raise exception 'invalid adoption';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select * into existing from public.sanji_creator_one_click_runs where owner=p_owner and id=p_run;
 if found then
  if existing.run_kind<>'existing' or existing.day<>p_day or existing.target<>n or existing.template_sha256<>p_template_sha256 or exists(select 1 from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run and not (creator_id=any(p_ids))) or (select count(*) from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run)<>n then raise exception 'run parameters mismatch';end if;
  return n;
 end if;
 if exists(select 1 from public.sanji_creator_one_click_items i join public.sanji_creator_one_click_runs r on r.owner=i.owner and r.id=i.run_id left join public.sanji_jobs j on j.owner=i.owner and j.id=i.job_id where i.owner=p_owner and ((i.status='pending' and r.day=p_day) or i.status in ('submitting','outcome_unknown') or (i.status='queued' and (j.id is null or j.status is null or j.status not in ('queued','processing','completed'))))) then raise exception 'previous run requires attention';end if;
 if (select count(*) from public.sanji_creator_recommendations where owner=p_owner and day=p_day and creator_id=any(p_ids))<>n then raise exception 'recommendation manifest mismatch';end if;
 insert into public.sanji_creator_one_click_runs(owner,id,day,target,template_sha256,run_kind) values(p_owner,p_run,p_day,n,p_template_sha256,'existing');
 insert into public.sanji_creator_one_click_items(owner,run_id,creator_id) select p_owner,p_run,v from unnest(p_ids) v;
 return n;
end $$;
create function public.sanji_creator_one_click_skip(p_owner uuid,p_run uuid,p_creator uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_reason is null or p_reason not in ('identity_unverified','contact_status','email_unverified','product_evidence_missing','draft_unavailable','review_existing','address_conflict','signature_unavailable','tracking_notice_unavailable','external_contact') then raise exception 'invalid skip';end if;
 update public.sanji_creator_one_click_items set status='skipped',reason=p_reason where owner=p_owner and run_id=p_run and creator_id=p_creator and status='pending';
 return found;
end $$;
create function public.sanji_creator_one_click_pause(p_owner uuid,p_run uuid,p_paused boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_paused is null then raise exception 'invalid pause';end if;
 update public.sanji_creator_one_click_runs set paused=p_paused where owner=p_owner and id=p_run;
 return found;
end $$;
create function public.sanji_creator_one_click_claim(p_owner uuid,p_run uuid,p_creator uuid,p_draft uuid,p_hash text,p_run_at timestamptz,p_connection_fingerprint text) returns text
language plpgsql security definer set search_path='' as $$
declare item public.sanji_creator_one_click_items; draft jsonb; template public.sanji_creator_one_click_templates; creator_handle text; creator_category text; product_name text; product_data jsonb; expected text;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 -- Same owner lock as the existing Sanji scheduling RPC, across all channels.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 perform 1 from public.sanji_creator_one_click_runs where owner=p_owner and id=p_run and paused=false for update;
 if not found then raise exception 'run paused or unavailable';end if;
 select * into item from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run and creator_id=p_creator for update;
 if not found then raise exception 'unknown frozen recommendation';end if;
 if item.status in ('queued','submitting','outcome_unknown') then
  if item.draft_id is distinct from p_draft or item.draft_hash is distinct from p_hash or item.run_at is distinct from p_run_at or item.connection_fingerprint is distinct from p_connection_fingerprint then raise exception 'claimed request mismatch';end if;
  return item.status;
 end if;
 if item.status<>'pending' or p_draft is null or p_hash is null or p_run_at is null or p_run_at<=now() or p_connection_fingerprint is null or p_connection_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'item not eligible';end if;
 select data into draft from public.sanji_drafts where owner=p_owner and id=p_draft;
 if not found or draft->>'proposalType' is distinct from 'creator_product_proposal' or draft->>'creatorReviewId' is distinct from p_creator::text or coalesce(draft->>'messageId','') !~ '^[0-9a-f-]{36}$' then raise exception 'draft does not match frozen creator';end if;
 if not exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='gmail' and lower(coalesce(c.summary->>'email',''))='valuest24@gmail.com' and coalesce(c.encrypted,'')<>'' and encode(sha256(convert_to(c.encrypted,'UTF8')),'hex')=p_connection_fingerprint) then raise exception 'verified Gmail connection changed';end if;
 select t.* into template from public.sanji_creator_one_click_runs r join public.sanji_creator_one_click_templates t on t.owner=r.owner and t.sha256=r.template_sha256 and t.active where r.owner=p_owner and r.id=p_run for share of t;
 if not found or draft->>'subject' is distinct from template.subject or draft->'marketing' is distinct from 'false'::jsonb or jsonb_typeof(draft->'dealVersions') is distinct from 'array' or jsonb_array_length(draft->'dealVersions')<>1 then raise exception 'approved template or product mismatch';end if;
 select handle,category into creator_handle,creator_category from public.sanji_creator_recovery where owner=p_owner and id=p_creator;
 select data into product_data from public.sanji_records where owner=p_owner and kind='deal' and id=(draft->'dealVersions'->0->>'id')::uuid;
 product_name:=product_data->>'name';
 if creator_handle is null or product_name is null or product_name='' or product_data->'soldOut'='true'::jsonb or product_data->>'availability'='sold_out' or product_data->'stock'='0'::jsonb or position('품절' in coalesce(product_data->>'sourceNote','')||' '||coalesce(product_data->>'note',''))>0 then raise exception 'creator or product unavailable';end if;
 if not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(product_data->'topics')='array' then product_data->'topics' else '[]'::jsonb end) topic(value) join regexp_split_to_table(coalesce(creator_category,''),'[,·/]') category(value) on lower(btrim(topic.value))=lower(btrim(category.value)) where length(btrim(topic.value)) between 2 and 40 and topic.value !~ '(질병|질환|치료|진단|환자|복용|임신|불임|우울증)') then raise exception 'product evidence unavailable';end if;
 expected:=replace(replace(template.body,'{{아이디}}',creator_handle),'{{상품명}}',product_name);
 if draft->>'proposalReviewBody' is distinct from expected then raise exception 'approved template body mismatch';end if;
 -- Claim alone never sends or creates a job. The service must call the existing
 -- authenticated /schedule route, which performs Gmail and sending-gate checks.
 update public.sanji_creator_one_click_items set status='submitting',draft_id=p_draft,draft_hash=p_hash,run_at=p_run_at,connection_fingerprint=p_connection_fingerprint where owner=p_owner and run_id=p_run and creator_id=p_creator;
 return 'claimed';
end $$;
-- Existing mail engine uses the Gmail token before reserving outbox. Bind only
-- one-click drafts to the exact verified encrypted connection at reservation.
create function public.sanji_creator_one_click_sender_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare expected text;
begin
 if new.channel<>'email' or coalesce(new.data->>'messageId','')='' then return new;end if;
 select i.connection_fingerprint into expected from public.sanji_creator_one_click_items i join public.sanji_drafts d on d.owner=i.owner and d.id=i.draft_id where i.owner=new.owner and i.status in ('submitting','outcome_unknown','queued') and d.data->>'messageId'=new.data->>'messageId' limit 1;
 if found and (expected is null or not exists(select 1 from public.sanji_connections c where c.owner=new.owner and c.provider='gmail' and lower(coalesce(c.summary->>'email',''))='valuest24@gmail.com' and coalesce(c.encrypted,'')<>'' and encode(sha256(convert_to(c.encrypted,'UTF8')),'hex')=expected)) then raise exception 'verified Gmail connection changed';end if;
 return new;
end $$;
create trigger sanji_creator_one_click_sender_guard before insert on public.sanji_outbox for each row execute function public.sanji_creator_one_click_sender_guard();
create function public.sanji_creator_one_click_reconcile(p_owner uuid,p_run uuid,p_creator uuid) returns text
language plpgsql security definer set search_path='' as $$
declare item public.sanji_creator_one_click_items; found_job uuid;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 select * into item from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run and creator_id=p_creator for update;
 if not found then raise exception 'unknown item';end if;
 if item.status='queued' then return 'queued';end if;
 if item.status not in ('submitting','outcome_unknown') then raise exception 'item not submitted';end if;
 select id into found_job from public.sanji_jobs where owner=p_owner and draft_id=item.draft_id and preview_hash=item.draft_hash;
 if found_job is not null then
  update public.sanji_creator_one_click_items set status='queued',job_id=found_job where owner=p_owner and run_id=p_run and creator_id=p_creator;return 'queued';
 end if;
 -- Absence is not proof of failure while a network call may still be in flight.
 update public.sanji_creator_one_click_items set status='outcome_unknown',reason='schedule_outcome_unknown' where owner=p_owner and run_id=p_run and creator_id=p_creator;return 'outcome_unknown';
end $$;
revoke all on function public.sanji_creator_one_click_template(uuid,text,text,boolean),public.sanji_creator_one_click_start(uuid,uuid,date,integer,text),public.sanji_creator_one_click_adopt(uuid,uuid,date,uuid[],text,boolean),public.sanji_creator_one_click_skip(uuid,uuid,uuid,text),public.sanji_creator_one_click_pause(uuid,uuid,boolean),public.sanji_creator_one_click_claim(uuid,uuid,uuid,uuid,text,timestamptz,text),public.sanji_creator_one_click_reconcile(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_creator_one_click_template(uuid,text,text,boolean),public.sanji_creator_one_click_start(uuid,uuid,date,integer,text),public.sanji_creator_one_click_adopt(uuid,uuid,date,uuid[],text,boolean),public.sanji_creator_one_click_skip(uuid,uuid,uuid,text),public.sanji_creator_one_click_pause(uuid,uuid,boolean),public.sanji_creator_one_click_claim(uuid,uuid,uuid,uuid,text,timestamptz,text),public.sanji_creator_one_click_reconcile(uuid,uuid,uuid) to service_role;
revoke all on function public.sanji_creator_one_click_sender_guard() from public,anon,authenticated,service_role;
commit;
