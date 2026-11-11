-- LOCAL REVIEW CANDIDATE ONLY. Deployment is blocked until prior-work
-- provenance, send grant handling and production concurrency are verified.
-- A suppression committed after the claim statement cannot cancel a provider request.
-- This candidate does not alter existing brand tables, triggers, or write paths.
begin;
-- Owner-attested Gmail review: only metadata fingerprint is stored, never mail
-- bodies. It proves what the operator recorded, not message contents or consent.
create table public.sanji_youtube_manual_gmail_reviews (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id),
 candidate_id uuid not null references public.sanji_records(id),candidate_version integer not null,
 email_key text not null,sender_email text not null,fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 message_count integer not null check(message_count between 1 and 100),reviewed_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '48 hours')
);
create index sanji_youtube_manual_gmail_reviews_lookup on public.sanji_youtube_manual_gmail_reviews(owner,email_key,sender_email,created_at desc);
alter table public.sanji_youtube_manual_gmail_reviews enable row level security;
revoke all on public.sanji_youtube_manual_gmail_reviews from public,anon,authenticated,service_role;
grant select on public.sanji_youtube_manual_gmail_reviews to service_role;
-- Immutable server-reconstructed preview; authenticated owner confirmation is
-- separately recorded by a server-only function. No client gets direct access.
create table public.sanji_youtube_manual_batches (
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id),
 snapshot_id uuid not null,snapshot_hash text not null check(snapshot_hash ~ '^[0-9a-f]{64}$'),
 settings_version integer not null check(settings_version>0),policy_revision integer not null check(policy_revision>0),approval_hash text not null check(approval_hash ~ '^[0-9a-f]{64}$'),
 review jsonb not null check(jsonb_typeof(review)='object' and octet_length(review::text)<=3000000),
 confirmed_at timestamptz,confirmed_by uuid references auth.users(id),confirmation_version text,created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),unique(owner,id)
);
alter table public.sanji_youtube_manual_batches enable row level security;
revoke all on public.sanji_youtube_manual_batches from public,anon,authenticated,service_role;
grant select on public.sanji_youtube_manual_batches to service_role;
create function public.sanji_youtube_manual_create_batch(p_owner uuid,p_snapshot uuid,p_snapshot_hash text,p_settings_version integer,p_policy_revision integer,p_approval_hash text,p_review jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or p_review->>'owner' is distinct from p_owner::text or p_review->>'snapshotHash' is distinct from p_snapshot_hash or (p_review->>'settingsVersion')::integer is distinct from p_settings_version or jsonb_typeof(p_review->'entries') is distinct from 'array' or jsonb_array_length(p_review->'entries') not between 1 and 100 or exists(select 1 from jsonb_array_elements(p_review->'entries') x where x->>'reviewVersion' is distinct from 'manual_source_review_v1') then raise exception 'invalid review';end if;
 insert into public.sanji_youtube_manual_batches(owner,snapshot_id,snapshot_hash,settings_version,policy_revision,approval_hash,review) values(p_owner,p_snapshot,p_snapshot_hash,p_settings_version,p_policy_revision,p_approval_hash,p_review) returning id into result;return result;
end $$;
revoke all on function public.sanji_youtube_manual_create_batch(uuid,uuid,text,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_create_batch(uuid,uuid,text,integer,integer,text,jsonb) to service_role;
-- Read current policy, immutable snapshot, account and signature metadata each
-- time; the server must also reconstruct and compare full content/MIME.
create function public.sanji_youtube_manual_batch_current(p_owner uuid,p_batch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sanji_youtube_manual_batches b
 join public.sanji_daily_campaign_policy p on p.owner=b.owner and p.revision=b.policy_revision and p.snapshot_id=b.snapshot_id
 join public.sanji_daily_campaign_snapshots snap on snap.owner=b.owner and snap.id=b.snapshot_id and snap.sha256=b.snapshot_hash
 join public.sanji_records settings on settings.owner=b.owner and settings.kind='settings' and settings.version=b.settings_version and settings.id::text=b.review->>'settingsId' and settings.id::text=snap.data#>>'{signature,settingsId}'
 join public.sanji_connections conn on conn.owner=b.owner and conn.provider='gmail'
 where b.owner=p_owner and b.id=p_batch and b.expires_at>clock_timestamp()
 and p.data->>'classification' in ('solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal') and p.data->>'classification'=b.review#>>'{mailPolicy,classification}' and nullif(btrim(p.data->>'classificationSource'),'') is not null and p.data->>'classificationSource'=b.review#>>'{mailPolicy,classificationSource}' and nullif(btrim(p.data->>'authorizationSource'),'') is not null and p.data->>'authorizationSource'=b.review#>>'{mailPolicy,authorizationSource}'
 and snap.data#>>'{signature,settingsVersion}'=b.settings_version::text and settings.data->>'signatureSource'='gmail' and coalesce(settings.data->>'gmailSignatureNeedsConsent','false')<>'true'
 and lower(settings.data->>'gmailSignatureEmail')=lower(b.review->>'sender')
 and lower(conn.summary->>'email')=lower(b.review->>'sender') and coalesce(conn.summary->>'reauthRequired','false')<>'true')
$$;
revoke all on function public.sanji_youtube_manual_batch_current(uuid,uuid) from public,anon,authenticated,service_role;
create function public.sanji_youtube_manual_confirm_batch(p_owner uuid,p_batch uuid,p_approval_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'membership required';end if;
 update public.sanji_youtube_manual_batches set confirmed_at=clock_timestamp(),confirmed_by=p_owner,confirmation_version='manual_source_review_v1' where owner=p_owner and id=p_batch and approval_hash=p_approval_hash and confirmed_at is null and expires_at>clock_timestamp() and public.sanji_youtube_manual_batch_current(p_owner,id);
 if found then return true;end if;
 -- Idempotent confirmation is only valid for this still-live, identical review.
 return exists(select 1 from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch and approval_hash=p_approval_hash and confirmed_at is not null and confirmed_by=p_owner and confirmation_version='manual_source_review_v1' and expires_at>clock_timestamp() and public.sanji_youtube_manual_batch_current(p_owner,id));
end $$;
revoke all on function public.sanji_youtube_manual_confirm_batch(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_confirm_batch(uuid,uuid,text) to service_role;
create table public.sanji_youtube_manual_ledger (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references auth.users(id),
 batch_id uuid not null,
 candidate_id uuid not null references public.sanji_records(id),
 candidate_version integer not null check(candidate_version>0),
 channel text not null, email text not null, email_key text not null,
 approval_hash text not null check(approval_hash ~ '^[0-9a-f]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 state text not null default 'reserved' check(state in ('reserved','sending','granted','accepted','outcome_unknown','held','cancelled')),
 claim_token uuid, provider_id text, provider_thread text, outbox_id uuid, thread_id uuid, message_id text not null check(message_id ~ '^[A-Za-z0-9_-]{1,100}$'), refusal_checked_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(owner,batch_id) references public.sanji_youtube_manual_batches(owner,id)
);
create unique index sanji_youtube_manual_active_channel on public.sanji_youtube_manual_ledger(owner,channel) where state<>'cancelled';
create unique index sanji_youtube_manual_active_email on public.sanji_youtube_manual_ledger(owner,email_key) where state<>'cancelled';
alter table public.sanji_youtube_manual_ledger enable row level security;
revoke all on public.sanji_youtube_manual_ledger from public,anon,authenticated,service_role;
grant select on public.sanji_youtube_manual_ledger to service_role;
create function public.sanji_youtube_manual_email_key(v text) returns text
language plpgsql immutable set search_path='' as $$
declare a text:=lower(trim(v)); l text; d text;
begin
 if length(a)>254 or a !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then return null;end if;
 l:=split_part(a,'@',1);d:=split_part(a,'@',2);
 if length(l)>64 or l like '.%' or l like '%.' or l like '%..%' or d like '.%' or d like '%..%' or d like '%.' then return null;end if;
 if d in ('gmail.com','googlemail.com') then l:=split_part(l,'+',1);if l !~ '^[a-z0-9.]+$' then return null;end if;l:=replace(l,'.','');d:='gmail.com';end if;
 return l||'@'||d;
end $$;
revoke all on function public.sanji_youtube_manual_email_key(text) from public,anon,authenticated,service_role;
-- All-time explicit refusal and recorded permanent DSN are separate from the
-- campaign-specific duplicate cutoff. No legacy records are modified.
create function public.sanji_youtube_manual_refused(p_owner uuid,p_email_key text,p_candidate uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sanji_suppression s where s.owner=p_owner and public.sanji_youtube_manual_email_key(regexp_replace(s.identity,'^email:','','i'))=p_email_key)
 or exists(select 1 from public.sanji_records t where t.owner=p_owner and t.kind='thread' and t.data->>'target'=p_candidate::text and (t.data->>'classification' in ('거절','수신 거부') or t.data->>'conversationStatus' in ('상대방 거절','우리 측 거절')))
 or exists(select 1 from public.sanji_records t cross join lateral jsonb_array_elements(case when jsonb_typeof(t.data->'messages')='array' then t.data->'messages' else '[]'::jsonb end) m cross join lateral jsonb_array_elements(case when jsonb_typeof(m->'bounceFailures')='array' then m->'bounceFailures' else '[]'::jsonb end) f where t.owner=p_owner and t.kind='thread' and f->>'kind'='permanent' and f->>'source'='delivery_status' and coalesce(f->>'status','') ~ '^5\.' and public.sanji_youtube_manual_email_key(f->>'email')=p_email_key)
$$;
revoke all on function public.sanji_youtube_manual_refused(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.sanji_youtube_manual_record_gmail_review(p_owner uuid,p_candidate uuid,p_version integer,p_email text,p_sender text,p_fingerprint text,p_count integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.sanji_records;k text;v uuid;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'membership required';end if;
 select * into c from public.sanji_records where id=p_candidate and owner=p_owner and kind='candidate' for update nowait;
 k:=public.sanji_youtube_manual_email_key(p_email);
 if c.id is null or c.version is distinct from p_version or c.data->>'kind' is distinct from '크리에이터' or c.data->>'channels' is distinct from 'YouTube' or k is null or not (lower(coalesce(c.data#>>'{contact,email}',''))=lower(trim(p_email)) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.data#>'{youtubeResearch,businessContacts}')='array' then c.data#>'{youtubeResearch,businessContacts}' else '[]'::jsonb end) x where lower(x->>'email')=lower(trim(p_email)))) or public.sanji_blocked(p_owner,c.data) or not exists(select 1 from public.sanji_connections where owner=p_owner and provider='gmail' and lower(summary->>'email')=lower(p_sender) and coalesce(summary->>'reauthRequired','false')<>'true') then raise exception 'review source invalid';end if;
 insert into public.sanji_youtube_manual_gmail_reviews(owner,candidate_id,candidate_version,email_key,sender_email,fingerprint,message_count,reviewed_by) values(p_owner,p_candidate,p_version,k,lower(p_sender),p_fingerprint,p_count,p_owner) returning id into v;return v;
end $$;
revoke all on function public.sanji_youtube_manual_record_gmail_review(uuid,uuid,integer,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_record_gmail_review(uuid,uuid,integer,text,text,text,integer) to service_role;
create function public.sanji_youtube_manual_reserve(p_owner uuid,p_batch uuid,p_candidate uuid,p_version integer,p_email text,p_approval text,p_payload text,p_message_id text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.sanji_records; b public.sanji_youtube_manual_batches; k text; ch text; result uuid;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'membership required';end if;
 if clock_timestamp() < '2026-11-09T15:00:00Z'::timestamptz then raise exception 'campaign not started';end if;
 select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch and confirmed_at is not null and confirmed_by=p_owner and confirmation_version='manual_source_review_v1' and approval_hash=p_approval and expires_at>clock_timestamp() for update;
 if not found or not public.sanji_youtube_manual_batch_current(p_owner,p_batch) or not exists(select 1 from jsonb_array_elements(b.review->'entries') x where x->>'id'=p_candidate::text and (x->>'version')::integer=p_version and lower(x->>'email')=lower(trim(p_email))) then raise exception 'review confirmation required';end if;
 select * into c from public.sanji_records where id=p_candidate and owner=p_owner and kind='candidate' for update nowait;
  if c.id is null or c.version is distinct from p_version or c.data->>'kind' is distinct from '크리에이터' or coalesce(c.data->>'profile','') !~ '^https://(www\.)?youtube\.com/channel/UC[A-Za-z0-9_-]{22}/?$' then raise exception 'candidate verification failed';end if;
 k:=public.sanji_youtube_manual_email_key(p_email);if k is null then raise exception 'invalid email';end if;
 if not (lower(coalesce(c.data#>>'{contact,email}',''))=lower(trim(p_email)) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.data#>'{youtubeResearch,businessContacts}')='array' then c.data#>'{youtubeResearch,businessContacts}' else '[]'::jsonb end) x where lower(x->>'email')=lower(trim(p_email)))) then raise exception 'email not in candidate';end if;
 if coalesce(c.data->>'status','') in ('상대방 거절','우리 측 거절','제외') or public.sanji_blocked(p_owner,c.data) or public.sanji_youtube_manual_refused(p_owner,k,c.id) then raise exception 'recipient blocked';end if;
 ch:=regexp_replace(c.data->>'profile','^https://(www\.)?youtube\.com/channel/(UC[A-Za-z0-9_-]{22})/?$','\2');
 insert into public.sanji_youtube_manual_ledger(owner,batch_id,candidate_id,candidate_version,channel,email,email_key,approval_hash,payload_hash,message_id) values(p_owner,p_batch,p_candidate,p_version,ch,lower(trim(p_email)),k,p_approval,p_payload,p_message_id) returning id into result;
 return result;
end $$;
revoke all on function public.sanji_youtube_manual_reserve(uuid,uuid,uuid,integer,text,text,text,text) from public,anon,authenticated,service_role;
-- reserve is only callable inside the atomic reserve_batch function.
-- A confirmed selection is reserved in a single transaction. Replaying the
-- identical batch returns existing IDs; an unknown or granted row is never
-- made claimable again. Raw MIME is not accepted or persisted here.
create function public.sanji_youtube_manual_reserve_batch(p_owner uuid,p_batch uuid,p_approval text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.sanji_youtube_manual_batches;x jsonb;r public.sanji_youtube_manual_ledger;result jsonb:='[]'::jsonb;item_id uuid;ids uuid[]:='{}';
begin
 select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch and confirmed_at is not null and confirmed_by=p_owner and confirmation_version='manual_source_review_v1' and approval_hash=p_approval and expires_at>clock_timestamp() for update;
 if not found or not public.sanji_youtube_manual_batch_current(p_owner,p_batch) or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>jsonb_array_length(b.review->'entries') or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid batch';end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) k where k not in('id','version','email','payloadHash','messageId')) or coalesce(x->>'id','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(x->>'payloadHash','') !~ '^[a-f0-9]{64}$' or coalesce(x->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'invalid batch item';end if;
  item_id:=(x->>'id')::uuid;if item_id=any(ids) then raise exception 'duplicate batch item';end if;ids:=array_append(ids,item_id);
  select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and batch_id=p_batch and candidate_id=item_id;
  if found then
   if r.candidate_version is distinct from (x->>'version')::integer or r.email is distinct from lower(trim(x->>'email')) or r.approval_hash is distinct from p_approval or r.payload_hash is distinct from x->>'payloadHash' or r.message_id is distinct from x->>'messageId' then raise exception 'batch item changed';end if;
  else
   item_id:=public.sanji_youtube_manual_reserve(p_owner,p_batch,item_id,(x->>'version')::integer,x->>'email',p_approval,x->>'payloadHash',x->>'messageId');
   select * into r from public.sanji_youtube_manual_ledger where id=item_id;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'candidateId',r.candidate_id,'state',r.state));
 end loop;
 return result;
end $$;
revoke all on function public.sanji_youtube_manual_reserve_batch(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_reserve_batch(uuid,uuid,text,jsonb) to service_role;
create function public.sanji_youtube_manual_claim(p_owner uuid,p_id uuid,p_approval text,p_payload text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.sanji_youtube_manual_ledger;c public.sanji_records; token uuid;
begin
 select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and id=p_id for update;
 if not found or r.state<>'reserved' or r.approval_hash<>p_approval or r.payload_hash<>p_payload then raise exception 'not claimable';end if;
 select * into c from public.sanji_records where owner=p_owner and id=r.candidate_id and kind='candidate' for update nowait;
  if c.id is null or c.version is distinct from r.candidate_version or not public.sanji_youtube_manual_batch_current(p_owner,r.batch_id) or not exists(select 1 from public.sanji_members where user_id=p_owner) or coalesce(c.data->>'status','') in ('상대방 거절','우리 측 거절','제외') or public.sanji_blocked(p_owner,c.data) or public.sanji_youtube_manual_refused(p_owner,r.email_key,r.candidate_id) then update public.sanji_youtube_manual_ledger set state='held',updated_at=clock_timestamp() where id=r.id;return null;end if;
 token:=gen_random_uuid();update public.sanji_youtube_manual_ledger set state='sending',claim_token=token,refusal_checked_at=null,updated_at=clock_timestamp() where id=r.id;return token;
end $$;
revoke all on function public.sanji_youtube_manual_claim(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_claim(uuid,uuid,text,text) to service_role;
-- Explicit cancellation touches only unsent reserved/held rows. Granted,
-- accepted or unknown outcomes remain permanently protected from retry.
create function public.sanji_youtube_manual_cancel_pending(p_owner uuid,p_batch uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or not exists(select 1 from public.sanji_youtube_manual_batches where owner=p_owner and id=p_batch and confirmed_at is not null and confirmed_by=p_owner) then raise exception 'batch unavailable';end if;
 update public.sanji_youtube_manual_ledger set state='cancelled',updated_at=clock_timestamp() where owner=p_owner and batch_id=p_batch and (state='reserved' or (state='held' and claim_token is null and provider_id is null));get diagnostics n=row_count;return n;
end $$;
revoke all on function public.sanji_youtube_manual_cancel_pending(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_cancel_pending(uuid,uuid) to service_role;
-- Last database read before the external request. This records only the
-- boundary of the check: a later refusal cannot retract a Gmail request.
create function public.sanji_youtube_manual_recheck(p_owner uuid,p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.sanji_youtube_manual_ledger;c public.sanji_records; t timestamptz:=clock_timestamp();ok boolean;
begin
 select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and id=p_id and state='sending' and claim_token=p_token for update;
 if not found then raise exception 'invalid claim';end if;
 select * into c from public.sanji_records where owner=p_owner and id=r.candidate_id and kind='candidate' for update nowait;
 ok:=c.id is not null and c.version is not distinct from r.candidate_version and public.sanji_youtube_manual_batch_current(p_owner,r.batch_id) and exists(select 1 from public.sanji_members where user_id=p_owner) and coalesce(c.data->>'status','') not in ('상대방 거절','우리 측 거절','제외') and not public.sanji_blocked(p_owner,c.data) and not public.sanji_youtube_manual_refused(p_owner,r.email_key,r.candidate_id);
 update public.sanji_youtube_manual_ledger set refusal_checked_at=t,updated_at=t where id=r.id;
 return jsonb_build_object('allowed',coalesce(ok,false),'checkedAt',t);
end $$;
revoke all on function public.sanji_youtube_manual_recheck(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_recheck(uuid,uuid,uuid) to service_role;
-- Only one worker can consume a claim. A grant without a recorded provider
-- result is intentionally never retried; reconcile it as outcome_unknown.
create function public.sanji_youtube_manual_consume(p_owner uuid,p_id uuid,p_token uuid,p_payload text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.sanji_youtube_manual_ledger;c public.sanji_records;t timestamptz:=clock_timestamp();
begin
 select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and id=p_id and state='sending' and claim_token=p_token for update;
 if not found or r.payload_hash is distinct from p_payload or r.refusal_checked_at is null or r.refusal_checked_at>t or r.refusal_checked_at<t-interval '5 seconds' then raise exception 'claim not consumable';end if;
 select * into c from public.sanji_records where owner=p_owner and id=r.candidate_id and kind='candidate' for update nowait;
 if c.id is null or c.version is distinct from r.candidate_version or not public.sanji_youtube_manual_batch_current(p_owner,r.batch_id) or not exists(select 1 from public.sanji_members where user_id=p_owner) or coalesce(c.data->>'status','') in ('상대방 거절','우리 측 거절','제외') or public.sanji_blocked(p_owner,c.data) or public.sanji_youtube_manual_refused(p_owner,r.email_key,r.candidate_id) then update public.sanji_youtube_manual_ledger set state='held',claim_token=null,updated_at=t where id=r.id;return jsonb_build_object('ready',false);end if;
 update public.sanji_youtube_manual_ledger set state='granted',refusal_checked_at=t,updated_at=t where id=r.id;
 return jsonb_build_object('ready',true,'payloadHash',r.payload_hash,'checkedAt',t,'expiresAt',t+interval '5 seconds');
end $$;
revoke all on function public.sanji_youtube_manual_consume(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_consume(uuid,uuid,uuid,text) to service_role;
-- On verified Gmail acceptance append only new YouTube outbox/thread records.
-- Existing brand records and legacy functions are never updated or replaced.
create function public.sanji_youtube_manual_finish(p_owner uuid,p_id uuid,p_token uuid,p_result text,p_provider_id text default null,p_provider_thread text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.sanji_youtube_manual_ledger;b public.sanji_youtube_manual_batches;snap public.sanji_daily_campaign_snapshots;entry jsonb;d jsonb;o uuid;t uuid;
begin
 if p_result not in ('accepted','outcome_unknown','held') or (p_result='accepted' and (coalesce(p_provider_id,'') !~ '^[A-Za-z0-9_-]{1,200}$' or coalesce(p_provider_thread,'') !~ '^[A-Za-z0-9_-]{1,200}$')) then raise exception 'invalid outcome';end if;
 select * into r from public.sanji_youtube_manual_ledger where owner=p_owner and id=p_id and claim_token=p_token and ((state='sending' and p_result='held') or (state='granted' and p_result in ('accepted','outcome_unknown'))) for update;
 if not found then raise exception 'invalid claim';end if;
 if p_result='accepted' then
  select * into b from public.sanji_youtube_manual_batches where owner=p_owner and id=r.batch_id;
  select * into snap from public.sanji_daily_campaign_snapshots where owner=p_owner and id=b.snapshot_id and sha256=b.snapshot_hash;
  select value into entry from jsonb_array_elements(b.review->'entries') where value->>'id'=r.candidate_id::text and value->>'email'=r.email;
  if b.id is null or snap.id is null or entry is null or entry->>'channel' is distinct from r.channel then raise exception 'receipt source missing';end if;
  d:=jsonb_build_object('channel','email','proposalType','youtube_manual_campaign','target',r.candidate_id,'platform','youtube','creatorKey','youtube:'||r.channel,'email',r.email,'emails',jsonb_build_array(r.email),'subject',entry->>'subject','body',entry->>'body','signatureText',snap.data#>>'{signature,text}','signatureHtml',snap.data#>>'{signature,html}','senderName',snap.data#>>'{signature,senderName}','senderEmail',b.review->>'sender','messageId',r.message_id,'marketing',false,'tracking',jsonb_build_object('enabled',false),'attachments','[]'::jsonb,'rawHash',r.payload_hash,'providerId',p_provider_id,'providerThread',p_provider_thread,'manualBatchId',b.id);
  insert into public.sanji_outbox(owner,target,channel,fingerprint,status,data) values(p_owner,r.candidate_id,'email',p_owner::text||':youtube-manual:'||r.channel,'accepted',d) returning id into o;
  insert into public.sanji_records(owner,kind,data) values(p_owner,'thread',jsonb_build_object('target',r.candidate_id,'platform','youtube','creatorKey','youtube:'||r.channel,'channel','email','subject',entry->>'subject','providerId',p_provider_thread,'next','회신 대기','classification','미분류','messages',jsonb_build_array(jsonb_build_object('id',p_provider_id,'messageId','<'||r.message_id||'@sanji.local>','outboxId',o,'out',true,'text',entry->>'body','at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'status','accepted')))) returning id into t;
 end if;
 update public.sanji_youtube_manual_ledger set state=p_result,provider_id=case when p_result='accepted' then p_provider_id else null end,provider_thread=case when p_result='accepted' then p_provider_thread else null end,outbox_id=o,thread_id=t,claim_token=null,updated_at=clock_timestamp() where id=r.id;
end $$;
revoke all on function public.sanji_youtube_manual_finish(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_youtube_manual_finish(uuid,uuid,uuid,text,text,text) to service_role;

commit;
