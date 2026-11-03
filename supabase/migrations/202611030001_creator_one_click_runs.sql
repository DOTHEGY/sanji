-- Candidate design only; not applied to production.
begin;
create table public.sanji_creator_one_click_runs (
 owner uuid not null references auth.users(id), id uuid not null, day date not null,
 target integer not null check(target between 1 and 500), template_sha256 text not null check(template_sha256 ~ '^[a-f0-9]{64}$'), created timestamptz not null default now(),
 primary key(owner,id)
);
create table public.sanji_creator_one_click_items (
 owner uuid not null, run_id uuid not null, creator_id uuid not null,
 status text not null default 'pending' check(status in ('pending','skipped','queued')),
 reason text, job_id uuid, created timestamptz not null default now(),
 primary key(owner,run_id,creator_id), unique(owner,creator_id),
 foreign key(owner,run_id) references public.sanji_creator_one_click_runs(owner,id),
 foreign key(creator_id) references public.sanji_creator_recovery(id)
);
alter table public.sanji_creator_one_click_runs enable row level security;
alter table public.sanji_creator_one_click_items enable row level security;
revoke all on public.sanji_creator_one_click_runs,public.sanji_creator_one_click_items from public,anon,authenticated,service_role;
grant select on public.sanji_creator_one_click_runs,public.sanji_creator_one_click_items to service_role;
create function public.sanji_creator_one_click_start(p_owner uuid,p_run uuid,p_day date,p_target integer,p_template_sha256 text) returns integer
language plpgsql security definer set search_path='' as $$
declare prior uuid[]; added integer; frozen integer; existing public.sanji_creator_one_click_runs;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_run is null or p_day is distinct from (now() at time zone 'Asia/Seoul')::date or p_target is null or p_target not between 1 and 500 or p_template_sha256 is null or p_template_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,725));
 select * into existing from public.sanji_creator_one_click_runs where owner=p_owner and id=p_run;
 if found then if existing.day<>p_day or existing.target<>p_target or existing.template_sha256<>p_template_sha256 then raise exception 'run parameters mismatch';end if;return (select count(*)::int from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run);end if;
 select coalesce(array_agg(creator_id),'{}'::uuid[]) into prior from public.sanji_creator_recommendations where owner=p_owner and day=p_day;
 added:=public.sanji_creator_recommend(p_owner,p_day,p_target);
 insert into public.sanji_creator_one_click_runs(owner,id,day,target,template_sha256) values(p_owner,p_run,p_day,p_target,p_template_sha256);
 insert into public.sanji_creator_one_click_items(owner,run_id,creator_id) select p_owner,p_run,creator_id from public.sanji_creator_recommendations where owner=p_owner and day=p_day and not (creator_id=any(prior));
 get diagnostics frozen=row_count;if frozen<>added then raise exception 'recommendation snapshot mismatch';end if;
 return frozen;
end $$;
create function public.sanji_creator_one_click_skip(p_owner uuid,p_run uuid,p_creator uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_reason is null or p_reason not in ('identity_unverified','email_unverified','product_evidence_missing','draft_unavailable') then raise exception 'invalid skip';end if;
 update public.sanji_creator_one_click_items set status='skipped',reason=p_reason where owner=p_owner and run_id=p_run and creator_id=p_creator and status='pending';
 return found;
end $$;
create function public.sanji_creator_one_click_enqueue(p_owner uuid,p_run uuid,p_creator uuid,p_draft uuid,p_hash text,p_run_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.sanji_creator_one_click_items; draft jsonb; job public.sanji_jobs;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 -- Same owner lock as the existing Sanji scheduling RPC, across all channels.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into item from public.sanji_creator_one_click_items where owner=p_owner and run_id=p_run and creator_id=p_creator for update;
 if not found then raise exception 'unknown frozen recommendation';end if;
 if item.status='queued' then
  if not exists(select 1 from public.sanji_jobs where owner=p_owner and id=item.job_id and draft_id=p_draft and preview_hash=p_hash) then raise exception 'queued request mismatch';end if;
  return item.job_id;
 end if;
 if item.status<>'pending' then raise exception 'item not eligible';end if;
 select data into draft from public.sanji_drafts where owner=p_owner and id=p_draft;
 if not found or draft->>'proposalType' is distinct from 'creator_product_proposal' or draft->>'creatorReviewId' is distinct from p_creator::text then raise exception 'draft does not match frozen creator';end if;
 -- This existing RPC performs full owner-scoped history, suppression, version and hash checks.
 job:=public.sanji_schedule_dispatch(p_owner,p_draft,p_hash,p_run_at);
 update public.sanji_creator_one_click_items set status='queued',job_id=job.id where owner=p_owner and run_id=p_run and creator_id=p_creator;
 return job.id;
end $$;
revoke all on function public.sanji_creator_one_click_start(uuid,uuid,date,integer,text),public.sanji_creator_one_click_skip(uuid,uuid,uuid,text),public.sanji_creator_one_click_enqueue(uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.sanji_creator_one_click_start(uuid,uuid,date,integer,text),public.sanji_creator_one_click_skip(uuid,uuid,uuid,text),public.sanji_creator_one_click_enqueue(uuid,uuid,uuid,uuid,text,timestamptz) to service_role;
commit;
