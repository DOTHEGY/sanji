begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Pending, disabled by default. Additive only: no legacy function replacement,
-- recommendation trigger, cron, credentials, policy activation or historical backfill.
create table public.sanji_creator_email_isolated_policy (
 owner uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default false,
 send_enabled boolean not null default false, enabled_at timestamptz,
 revision integer not null default 1 check(revision>0), authorization_source text not null default '',
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'), updated timestamptz not null default now(),
 check(not enabled or enabled_at is not null)
);
create table public.sanji_creator_email_isolated_queue (
 owner uuid not null references auth.users(id) on delete cascade, creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 recommendation_day date not null, recommendation_created timestamptz not null, policy_revision integer not null,
 status text not null default 'pending' check(status in ('pending','processing','held','reserved','accepted','rejected','outcome_unknown','cancelled')),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0, reason text not null default '',
 outbox_id uuid, reservation_token uuid, send_started_at timestamptz, snapshot jsonb not null default '{}', updated timestamptz not null default now(),
 primary key(owner,creator_id)
);
create table public.sanji_creator_email_isolated_basis (
 owner uuid not null references auth.users(id) on delete cascade, creator_id uuid not null references public.sanji_creator_recovery(id) on delete cascade,
 recipient text not null check(recipient=lower(btrim(recipient)) and recipient<>''),
 status text not null default 'pending' check(status in ('pending','approved','revoked')),
 kind text not null check(kind in ('solicited_proposal','explicit_consent')),
 classification text not null default '', classification_source text not null default '',
 source_url text not null default '', source_text text not null default '',
 verified_at timestamptz, expires_at timestamptz, approved_by uuid references auth.users(id) on delete set null,
 approval_source text not null default '', policy_revision integer not null, product_ids uuid[] not null default '{}',
 primary key(owner,creator_id,recipient)
);
alter table public.sanji_creator_email_isolated_policy enable row level security;
alter table public.sanji_creator_email_isolated_queue enable row level security;
alter table public.sanji_creator_email_isolated_basis enable row level security;
revoke all on public.sanji_creator_email_isolated_policy,public.sanji_creator_email_isolated_queue,public.sanji_creator_email_isolated_basis from public,anon,authenticated;
grant select,insert,update on public.sanji_creator_email_isolated_policy,public.sanji_creator_email_isolated_queue,public.sanji_creator_email_isolated_basis to service_role;
create index sanji_creator_email_isolated_pending on public.sanji_creator_email_isolated_queue(updated) where status in ('pending','processing');
create function public.sanji_creator_email_isolated_sync(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.sanji_creator_email_isolated_queue(owner,creator_id,recommendation_day,recommendation_created,policy_revision)
 select r.owner,r.creator_id,r.day,r.created,p.revision from public.sanji_creator_recommendations r
 join public.sanji_creator_email_isolated_policy p on p.owner=r.owner
 join public.sanji_creator_recovery c on c.owner=r.owner and c.id=r.creator_id
 where r.owner=p_owner and p.enabled and p.enabled_at is not null and p.enabled_at<=now() and r.created>=p.enabled_at and r.created<=now()
 and p.authorization_source<>'' and c.status='new' and exists(select 1 from public.sanji_members where user_id=p_owner)
 and not exists(select 1 from public.sanji_creator_email_isolated_queue existing where existing.owner=r.owner and existing.creator_id=r.creator_id)
 order by r.created,r.creator_id limit 500 on conflict do nothing;
 get diagnostics n=row_count;
 -- Resume only pre-reservation holds whose missing approval is now explicitly supplied.
 update public.sanji_creator_email_isolated_queue q set status='pending',reason='',updated=now()
 from public.sanji_creator_email_isolated_policy p
 where q.owner=p_owner and p.owner=q.owner and p.enabled and p.send_enabled and p.revision=q.policy_revision
 and p.enabled_at is not null and q.recommendation_created>=p.enabled_at
 and p.data->>'messageType'='non_marketing' and coalesce(p.data->>'classificationSource','')<>''
 and q.status='held' and q.outbox_id is null and q.reason in ('recipient_basis_required','sending_disabled','message_classification_required')
 and exists(select 1 from public.sanji_creator_email_isolated_basis b where b.owner=q.owner and b.creator_id=q.creator_id
 and b.recipient=lower(q.snapshot#>>'{email,address}') and b.status='approved' and b.kind='solicited_proposal'
 and b.classification='solicited_non_marketing_proposal' and b.classification_source<>'' and b.source_url ~* '^https://'  and b.source_text<>''
 and b.verified_at<=now() and b.verified_at>=now()-interval '30 days' and b.expires_at>now()
 and b.approved_by=p_owner and b.approval_source<>'' and b.policy_revision=p.revision and (q.snapshot#>>'{product,id}')::uuid=any(b.product_ids));
 return jsonb_build_object('queued',n);
end $$;
revoke all on function public.sanji_creator_email_isolated_sync(uuid) from public,anon,authenticated;
grant execute on function public.sanji_creator_email_isolated_sync(uuid) to service_role;
create function public.sanji_creator_email_isolated_claim(p_owner uuid) returns setof public.sanji_creator_email_isolated_queue language plpgsql security definer set search_path='' as $$
begin
 return query update public.sanji_creator_email_isolated_queue q set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=q.attempts+1,updated=now()
 where (q.owner,q.creator_id)=(select w.owner,w.creator_id from public.sanji_creator_email_isolated_queue w
 join public.sanji_creator_email_isolated_policy p on p.owner=w.owner and p.enabled and p.revision=w.policy_revision
 where w.owner=p_owner and (w.status='pending' or (w.status='processing' and w.lease_until<now()))
 order by w.updated,w.creator_id for update of w skip locked limit 1) returning q.*;
end $$;
revoke all on function public.sanji_creator_email_isolated_claim(uuid) from public,anon,authenticated;
grant execute on function public.sanji_creator_email_isolated_claim(uuid) to service_role;
create function public.sanji_creator_email_isolated_reserve(p_owner uuid,p_creator uuid,p_lease uuid,p_expected_updated timestamptz,p_review_version integer,p_plan jsonb,p_draft jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.sanji_creator_email_isolated_queue; p public.sanji_creator_email_isolated_policy; c public.sanji_creator_recovery;
 r public.sanji_creator_contact_review; s public.sanji_records; product public.sanji_records; candidate public.sanji_records;
 review_data jsonb; email_data jsonb; d jsonb; target uuid; draft_id uuid; h text; o public.sanji_outbox; basis public.sanji_creator_email_isolated_basis; token uuid; history_checked timestamptz; expected_body text; expected_subject text; recipient text; checked timestamptz; v integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_creator_email_isolated_queue where owner=p_owner and creator_id=p_creator for update;
 if not found then raise exception 'missing recommendation queue';end if;
 if q.outbox_id is not null then return jsonb_build_object('status',q.status,'outboxId',q.outbox_id,'duplicate',true);end if;
 if q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until is null or q.lease_until<now() then raise exception 'stale preparation lease';end if;
 select * into p from public.sanji_creator_email_isolated_policy where owner=p_owner for share;
 if not found or not p.enabled or not p.send_enabled or p.enabled_at is null or q.recommendation_created<p.enabled_at or p.revision<>q.policy_revision or p.authorization_source='' or p.data->'recipientClaimsConfirmed' is distinct from 'true'::jsonb or coalesce(p.data->>'claimsSource','')='' or coalesce(p.data->>'classificationSource','')='' then raise exception 'automation authorization changed';end if;
 if not exists(select 1 from public.sanji_creator_recommendations where owner=p_owner and creator_id=p_creator and day=q.recommendation_day and created=q.recommendation_created) then raise exception 'recommendation changed';end if;
 select * into c from public.sanji_creator_recovery where owner=p_owner and id=p_creator for update;
 if not found or c.updated is distinct from p_expected_updated or c.status is distinct from 'new' or c.entity_type='noncreator_suspected' or c.link_status is distinct from 'source_confirmed' or coalesce(c.profile_url,'') !~ '^https://(www\.)?instagram\.com/[a-z0-9._]+/?$' or lower(split_part(split_part(c.profile_url,'instagram.com/',2),'/',1)) is distinct from lower(c.handle) then raise exception 'creator changed or excluded';end if;
 recipient:=lower(p_plan#>>'{email,address}');checked:=(p_plan#>>'{email,checkedAt}')::timestamptz;
 if coalesce(recipient,'') !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or checked is null or checked<now()-interval '30 days' or checked>now()+interval '1 minute' or p_plan#>>'{email,sourceUrl}' is distinct from c.profile_url then raise exception 'email evidence missing';end if;
 select * into basis from public.sanji_creator_email_isolated_basis where owner=p_owner and creator_id=p_creator and sanji_creator_email_isolated_basis.recipient=lower(p_plan#>>'{email,address}') for share;
 if not found or basis.status<>'approved' or basis.kind<>'solicited_proposal' or basis.classification<>'solicited_non_marketing_proposal' or btrim(basis.classification_source)='' or basis.source_url !~* '^https://' or btrim(basis.source_text)='' or basis.verified_at is null or basis.verified_at>now() or basis.verified_at<now()-interval '30 days' or basis.expires_at is null or basis.expires_at<=now() or basis.approved_by is distinct from p_owner or btrim(basis.approval_source)='' or basis.policy_revision<>p.revision or not coalesce((p_plan#>>'{product,id}')::uuid=any(basis.product_ids),false) then raise exception 'recipient basis requires review';end if;
 history_checked:=(p_plan#>>'{gmailHistory,checkedAt}')::timestamptz;
 if p_plan#>'{gmailHistory,clear}' is distinct from 'true'::jsonb or lower(p_plan#>>'{gmailHistory,address}') is distinct from recipient or lower(p_plan#>>'{gmailHistory,senderEmail}') is distinct from lower(p.data->>'senderEmail') or history_checked is null or history_checked<clock_timestamp()-interval '60 seconds' or history_checked>clock_timestamp()+interval '5 seconds' then raise exception 'fresh Gmail history required';end if;
 perform 1 from public.sanji_creator_evidence e where e.owner=p_owner and e.creator_id=p_creator and e.source_kind='public_bio' and e.source_provider in ('instagram_public','instagram_official') and e.source_url=c.profile_url and e.detail->>'bio_source_url'=c.profile_url and e.detail->'bio_content_available'='true'::jsonb and e.detail->>'bio'=p_plan#>>'{email,bio}' and jsonb_typeof(e.detail->'emails')='array' and jsonb_array_length(e.detail->'emails')=1 and e.detail->'emails' ? recipient and (select array_agg(distinct lower(m[1])) from regexp_matches(coalesce(e.detail->>'bio',''),'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}','gi') m)=array[recipient] and (e.detail->>'bio_checked_at')::timestamptz=checked for share;
 if not found then raise exception 'email publication changed';end if;
 if exists(select 1 from public.sanji_creator_evidence e where e.owner=p_owner and e.creator_id=p_creator and e.source_kind='public_bio' and e.source_provider in ('instagram_public','instagram_official') and e.source_url=c.profile_url and e.detail->'bio_content_available'='true'::jsonb and (e.detail->>'bio_checked_at')::timestamptz>checked) then raise exception 'newer email publication requires recheck';end if;
 if exists(select 1 from public.sanji_suppression where owner=p_owner and identity in (recipient,'email:'||recipient,'instagram:'||lower(c.handle))) or exists(select 1 from public.sanji_creator_inbound_messages where owner=p_owner and (creator_id=p_creator or lower(data->>'replyAddress')=recipient)) then raise exception 'suppressed address or prior reply';end if;
 select * into s from public.sanji_records where owner=p_owner and kind='settings' order by id limit 1 for share;
 if not found or s.data->>'signatureSource' is distinct from 'gmail' or coalesce((s.data->>'gmailSignatureNeedsConsent')::boolean,false) or coalesce(p.data->>'signatureText','')='' or coalesce(p.data->>'signatureHtml','')='' or coalesce(s.data->>'senderName','')='' or coalesce(s.data->>'senderPhone','')='' or s.data->>'senderName' ~ E'[\\r\\n]' or lower(s.data->>'gmailSignatureEmail') is distinct from lower(p.data->>'senderEmail') or s.data->>'emailSignature' is distinct from p_plan->>'signatureText' or s.data->>'gmailSignatureHtml' is distinct from p_plan->>'signatureHtml' or p.data->>'signatureHtml' is distinct from p_plan->>'signatureHtml' or p.data->>'signatureText' is distinct from p_plan->>'signatureText' then raise exception 'approved signature changed';end if;
 if not exists(select 1 from public.sanji_connections where owner=p_owner and provider='gmail' and lower(summary->>'email')=lower(p.data->>'senderEmail') and coalesce((summary->>'reauthRequired')::boolean,false)=false) then raise exception 'Gmail account changed';end if;
 select * into product from public.sanji_records where owner=p_owner and id=(p_plan#>>'{product,id}')::uuid and kind='deal' for share;
 if not found or product.version is distinct from (p_plan#>>'{product,version}')::integer or coalesce(product.data->>'state','') not in ('확정','협의 중') or coalesce(product.data->>'productUrl','') !~ '^https://' then raise exception 'product changed';end if;
 expected_subject:=replace(replace(p.data->>'subject','[인플루언서명]',coalesce(nullif(btrim(c.nickname),''),c.handle)),'[상품명]',product.data->>'name');
 expected_body:=replace(replace(p.data->>'body','[인플루언서명]',coalesce(nullif(btrim(c.nickname),''),c.handle)),'[상품명]',product.data->>'name')||E'\n\n'||(p.data->>'signatureText');
 if p_plan->>'subject' is distinct from expected_subject or p_plan->>'body' is distinct from expected_body or p_draft->>'body' is distinct from expected_body or p_draft->>'subject' is distinct from p_plan->>'subject' or p_draft->>'email' is distinct from recipient or p_draft->>'channel' is distinct from 'email' or p_draft->>'proposalType' is distinct from 'creator_product_proposal' or coalesce(p_draft->>'replyTo','')<>'' then raise exception 'approved proposal changed';end if;
 if p.data->>'messageType' is distinct from 'non_marketing' or p_draft->'marketing' is distinct from 'false'::jsonb then raise exception 'marketing requires separately approved compliant copy';end if;
 select * into r from public.sanji_creator_contact_review where owner=p_owner and creator_id=p_creator for update;
 if coalesce(r.version,0)<>p_review_version then raise exception 'saved review changed';end if;
 if coalesce(r.data#>>'{email,status}','')='hold' or coalesce(r.data#>>'{email,observation,status}','') in ('scheduled','sent','unknown') or coalesce((r.data#>>'{email,observation,humanReply}')::boolean,false) then raise exception 'existing outreach or hold';end if;
 if coalesce(r.data#>>'{email,body}','')<>'' and (r.data#>>'{email,body}' is distinct from expected_body or r.data#>>'{email,subject}' is distinct from p_plan->>'subject' or lower(r.data#>>'{email,address}') is distinct from recipient or r.data#>'{email,productIds}' is distinct from jsonb_build_array(product.id)) then raise exception 'existing draft needs review';end if;
 update public.sanji_creator_recovery set bio=p_plan#>>'{email,bio}',emails=jsonb_build_array(recipient),bio_status='email_present',last_verified=checked,updated=now() where owner=p_owner and id=p_creator;
 v:=coalesce(r.version,0)+1;
 email_data:=jsonb_build_object('address',recipient,'sourceUrl',c.profile_url,'subject',p_plan->>'subject','body',expected_body,'productIds',jsonb_build_array(product.id),'signatureText',p_plan->>'signatureText','signatureHtml',p_plan->>'signatureHtml','status','reviewed','authorizationSource',p.authorization_source,'policyRevision',p.revision,'match',p_plan->'match');
 review_data:=coalesce(r.data,'{}'::jsonb)||jsonb_build_object('email',coalesce(r.data->'email','{}'::jsonb)||email_data);
 insert into public.sanji_creator_contact_review(owner,creator_id,data,version) values(p_owner,p_creator,review_data,v) on conflict(owner,creator_id) do update set data=excluded.data,version=excluded.version,updated=now();
 target:=public.sanji_creator_proposal_target(p_owner,p_creator,v);
 select * into candidate from public.sanji_records where owner=p_owner and id=target for share;
 -- Whitelist content: no unapproved extra recipients, attachments, reply headers or tracking.
 if coalesce(p_draft->>'messageId','') !~ '^[a-zA-Z0-9_-]{8,80}$' then raise exception 'invalid message identifier';end if;
 d:=jsonb_build_object('channel','email','proposalType','creator_product_proposal','subject',expected_subject,'body',expected_body,'signature','',
 'signatureText',p.data->>'signatureText','signatureHtml',p.data->>'signatureHtml','attachments','[]'::jsonb,'attachmentSummary','[]'::jsonb,
 'dealIds',jsonb_build_array(product.id),'recipientMode','primary','marketing',false,'email',recipient,'emails',jsonb_build_array(recipient),
 'senderName',s.data->>'senderName','targetName',coalesce(nullif(btrim(c.nickname),''),c.handle),'messageId',p_draft->>'messageId',
 'replyRecipientNeedsReview',false,'trackingRequested',false,'tracking',jsonb_build_object('enabled',false,'reason','exact_approved_template'),
 'target',target,'targetVersion',candidate.version,'creatorReviewId',p_creator,'creatorReviewVersion',v,'proposalReviewBody',expected_body,
 'dealVersions',jsonb_build_array(jsonb_build_object('id',product.id,'version',product.version)),
 'creatorIsolated',jsonb_build_object('policyRevision',p.revision,'recommendationDay',q.recommendation_day,'senderEmail',p.data->>'senderEmail','settingsVersion',s.version,'creatorUpdated',now(),'evidenceCheckedAt',checked,'evidenceBio',p_plan#>>'{email,bio}','profileUrl',c.profile_url,'handle',c.handle,'basisProductIds',to_jsonb(basis.product_ids),'basisKind',basis.kind,'basisClassification',basis.classification,'basisApprovalSource',basis.approval_source,'basisSourceUrl',basis.source_url,'basisVerifiedAt',basis.verified_at,'gmailHistoryCheckedAt',history_checked));
 h:=encode(sha256(convert_to(d::text,'UTF8')),'hex');
 insert into public.sanji_drafts(owner,data,hash,expires) values(p_owner,d,h,now()+interval '15 minutes') returning id into draft_id;
 -- Existing draft and outbox contract reused without replacing any existing function.
 -- The draft is created and consumed atomically: no legacy worker ever sees it usable.
 if history_checked<clock_timestamp()-interval '60 seconds' or q.lease_until<clock_timestamp() or basis.expires_at<=clock_timestamp() or basis.verified_at<clock_timestamp()-interval '30 days' or checked<clock_timestamp()-interval '30 days' then raise exception 'fresh Gmail history, source, basis or lease expired';end if;
 select * into o from public.sanji_reserve_dispatch(p_owner,draft_id,h,encode(sha256(convert_to(p_owner::text||'|'||target::text||'|email|'||expected_subject||'|'||expected_body,'UTF8')),'hex'));
 token:=gen_random_uuid();
 update public.sanji_creator_email_isolated_queue set status='reserved',outbox_id=o.id,reservation_token=token,snapshot=d,reason='',lease_token=null,lease_until=null,updated=now() where owner=p_owner and creator_id=p_creator;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'creator_isolated_email_reserved',jsonb_build_object('creator',p_creator,'outbox',o.id,'policyRevision',p.revision,'authorizationSource',p.authorization_source));
 return jsonb_build_object('status','reserved','outbox',to_jsonb(o),'draft',d,'reservationToken',token,'duplicate',false);
end $$;
revoke all on function public.sanji_creator_email_isolated_reserve(uuid,uuid,uuid,timestamptz,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_email_isolated_reserve(uuid,uuid,uuid,timestamptz,integer,jsonb,jsonb) to service_role;

-- A separate one-use final grant after the worker's last Gmail read. Recovered
-- or repeated grants never permit sending. No existing dispatcher is replaced.
create function public.sanji_creator_email_isolated_begin_send(p_owner uuid,p_creator uuid,p_reservation uuid,p_gmail_history jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.sanji_creator_email_isolated_queue; p public.sanji_creator_email_isolated_policy;
 c public.sanji_creator_recovery; r public.sanji_creator_contact_review; s public.sanji_records;
 product public.sanji_records; candidate public.sanji_records; basis public.sanji_creator_email_isolated_basis;
 o public.sanji_outbox; d jsonb; recipient text; checked timestamptz; history_checked timestamptz; expected_subject text; expected_body text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_creator_email_isolated_queue where owner=p_owner and creator_id=p_creator for update;
 if not found or p_reservation is null or q.reservation_token is distinct from p_reservation or q.status<>'reserved' or q.outbox_id is null then raise exception 'reservation mismatch';end if;
 if q.send_started_at is not null then return jsonb_build_object('ready',false,'duplicate',true);end if;
 d:=q.snapshot;recipient:=lower(d->>'email');checked:=(d#>>'{creatorIsolated,evidenceCheckedAt}')::timestamptz;
 select * into o from public.sanji_outbox where owner=p_owner and id=q.outbox_id for update;
 if not found or o.status<>'submitting' or o.target is distinct from (d->>'target')::uuid or o.data->>'email' is distinct from recipient or o.data->>'body' is distinct from d->>'body' or o.data->>'subject' is distinct from d->>'subject' then raise exception 'outbox changed';end if;
 select * into p from public.sanji_creator_email_isolated_policy where owner=p_owner for share;
 if not found or not p.enabled or not p.send_enabled or p.revision is distinct from q.policy_revision or p.revision is distinct from (d#>>'{creatorIsolated,policyRevision}')::integer or p.enabled_at is null or q.recommendation_created<p.enabled_at or p.authorization_source='' or p.data->'recipientClaimsConfirmed' is distinct from 'true'::jsonb or coalesce(p.data->>'claimsSource','')='' or coalesce(p.data->>'classificationSource','')='' or p.data->>'messageType' is distinct from 'non_marketing' then raise exception 'automation authorization changed';end if;
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or not exists(select 1 from public.sanji_creator_recommendations where owner=p_owner and creator_id=p_creator and day=q.recommendation_day and created=q.recommendation_created) then raise exception 'recommendation or membership changed';end if;
 select * into c from public.sanji_creator_recovery where owner=p_owner and id=p_creator for share;
 if not found or c.status is distinct from 'new' or c.link_status is distinct from 'source_confirmed' or c.entity_type='noncreator_suspected' or c.updated is distinct from (d#>>'{creatorIsolated,creatorUpdated}')::timestamptz or c.profile_url is distinct from d#>>'{creatorIsolated,profileUrl}' or c.handle is distinct from d#>>'{creatorIsolated,handle}' or c.bio is distinct from d#>>'{creatorIsolated,evidenceBio}' or c.last_verified is distinct from checked or c.emails is distinct from jsonb_build_array(recipient) then raise exception 'creator changed';end if;
 perform 1 from public.sanji_creator_evidence e where e.owner=p_owner and e.creator_id=p_creator and e.source_kind='public_bio' and e.source_provider in ('instagram_public','instagram_official') and e.source_url=c.profile_url and e.detail->>'bio_source_url'=c.profile_url and e.detail->'bio_content_available'='true'::jsonb and e.detail->>'bio'=c.bio and jsonb_typeof(e.detail->'emails')='array' and jsonb_array_length(e.detail->'emails')=1 and e.detail->'emails' ? recipient and (select array_agg(distinct lower(m[1])) from regexp_matches(coalesce(e.detail->>'bio',''),'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}','gi') m)=array[recipient] and (e.detail->>'bio_checked_at')::timestamptz=checked for share;
 if not found then raise exception 'email publication changed';end if;
 if exists(select 1 from public.sanji_creator_evidence e where e.owner=p_owner and e.creator_id=p_creator and e.source_kind='public_bio' and e.source_provider in ('instagram_public','instagram_official') and e.source_url=c.profile_url and e.detail->'bio_content_available'='true'::jsonb and (e.detail->>'bio_checked_at')::timestamptz>checked) then raise exception 'newer email publication requires recheck';end if;
 select * into basis from public.sanji_creator_email_isolated_basis b where b.owner=p_owner and b.creator_id=p_creator and b.recipient=lower(d->>'email') for share;
 if not found or basis.status<>'approved' or basis.kind<>'solicited_proposal' or basis.classification<>'solicited_non_marketing_proposal' or btrim(basis.classification_source)='' or basis.source_url !~* '^https://' or btrim(basis.source_text)='' or basis.verified_at is null or basis.verified_at>clock_timestamp() or basis.expires_at is null or basis.approved_by is distinct from p_owner or btrim(basis.approval_source)='' or basis.policy_revision<>p.revision or not coalesce((d#>>'{dealVersions,0,id}')::uuid=any(basis.product_ids),false) then raise exception 'recipient basis requires review';end if;
 select * into s from public.sanji_records where owner=p_owner and kind='settings' order by id limit 1 for share;
 if not found or s.version is distinct from (d#>>'{creatorIsolated,settingsVersion}')::integer or s.data->>'signatureSource' is distinct from 'gmail' or coalesce((s.data->>'gmailSignatureNeedsConsent')::boolean,false) or s.data->>'emailSignature' is distinct from d->>'signatureText' or s.data->>'gmailSignatureHtml' is distinct from d->>'signatureHtml' or p.data->>'signatureText' is distinct from d->>'signatureText' or p.data->>'signatureHtml' is distinct from d->>'signatureHtml' or s.data->>'senderName' is distinct from d->>'senderName' or lower(s.data->>'gmailSignatureEmail') is distinct from lower(p.data->>'senderEmail') or lower(d#>>'{creatorIsolated,senderEmail}') is distinct from lower(p.data->>'senderEmail') then raise exception 'approved signature or sender changed';end if;
 if not exists(select 1 from public.sanji_connections where owner=p_owner and provider='gmail' and lower(summary->>'email')=lower(p.data->>'senderEmail') and coalesce((summary->>'reauthRequired')::boolean,false)=false) then raise exception 'Gmail account changed';end if;
 select * into product from public.sanji_records where owner=p_owner and id=(d#>>'{dealVersions,0,id}')::uuid and kind='deal' for share;
 if not found or product.version is distinct from (d#>>'{dealVersions,0,version}')::integer or coalesce(product.data->>'state','') not in ('확정','협의 중') or coalesce(product.data->>'productUrl','') !~ '^https://' then raise exception 'product changed';end if;
 expected_subject:=replace(replace(p.data->>'subject','[인플루언서명]',coalesce(nullif(btrim(c.nickname),''),c.handle)),'[상품명]',product.data->>'name');
 expected_body:=replace(replace(p.data->>'body','[인플루언서명]',coalesce(nullif(btrim(c.nickname),''),c.handle)),'[상품명]',product.data->>'name')||E'\n\n'||(p.data->>'signatureText');
 if d->>'subject' is distinct from expected_subject or d->>'body' is distinct from expected_body or d->'marketing' is distinct from 'false'::jsonb then raise exception 'approved proposal changed';end if;
 select * into r from public.sanji_creator_contact_review where owner=p_owner and creator_id=p_creator for share;
 if not found or r.version is distinct from (d->>'creatorReviewVersion')::integer or r.data#>>'{email,subject}' is distinct from expected_subject or r.data#>>'{email,body}' is distinct from expected_body or lower(r.data#>>'{email,address}') is distinct from recipient or r.data#>'{email,productIds}' is distinct from jsonb_build_array(product.id) or r.data#>>'{email,status}'='hold' or coalesce(r.data#>>'{email,observation,status}','') in ('scheduled','sent','unknown') or coalesce((r.data#>>'{email,observation,humanReply}')::boolean,false) then raise exception 'saved review changed';end if;
 select * into candidate from public.sanji_records where owner=p_owner and kind='candidate' and id=(d->>'target')::uuid for share;
 if not found or candidate.version is distinct from (d->>'targetVersion')::integer or public.sanji_blocked(p_owner,candidate.data) or lower(candidate.data#>>'{contact,email}') is distinct from recipient then raise exception 'candidate changed';end if;
 if exists(select 1 from public.sanji_suppression where owner=p_owner and identity in (recipient,'email:'||recipient,'instagram:'||lower(c.handle))) or exists(select 1 from public.sanji_creator_inbound_messages where owner=p_owner and (creator_id=p_creator or lower(data->>'replyAddress')=recipient)) then raise exception 'suppressed address or prior reply';end if;
 if exists(select 1 from public.sanji_creator_contact_review other where other.owner=p_owner and lower(other.data#>>'{email,observation,recipient}')=recipient and other.data#>>'{email,observation,status}' in ('scheduled','sent','unknown')) then raise exception 'existing external contact';end if;
 if exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and data->>'target'=d->>'target') then raise exception 'existing conversation';end if;
 if exists(select 1 from public.sanji_outbox other where other.owner=p_owner and other.id<>q.outbox_id and other.channel='email' and (lower(other.data->>'email')=recipient or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(other.data->'emails')='array' then other.data->'emails' else '[]'::jsonb end) a where lower(a)=recipient))) then raise exception 'existing outbound contact';end if;
 if exists(select 1 from public.sanji_jobs j join public.sanji_drafts jd on jd.id=j.draft_id and jd.owner=j.owner where j.owner=p_owner and j.status in ('queued','processing') and jd.data->>'channel'='email' and (lower(jd.data->>'email')=recipient or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(jd.data->'emails')='array' then jd.data->'emails' else '[]'::jsonb end) a where lower(a)=recipient))) then raise exception 'existing scheduled contact';end if;
 history_checked:=(p_gmail_history->>'checkedAt')::timestamptz;
 if p_gmail_history->'clear' is distinct from 'true'::jsonb or lower(p_gmail_history->>'address') is distinct from recipient or lower(p_gmail_history->>'senderEmail') is distinct from lower(p.data->>'senderEmail') or history_checked is null or history_checked<clock_timestamp()-interval '60 seconds' or history_checked>clock_timestamp()+interval '5 seconds' or checked is null or checked<clock_timestamp()-interval '30 days' or basis.verified_at<clock_timestamp()-interval '30 days' or basis.expires_at<=clock_timestamp() then raise exception 'fresh Gmail history, source or basis required';end if;
 update public.sanji_creator_email_isolated_queue set send_started_at=clock_timestamp(),updated=now() where owner=p_owner and creator_id=p_creator;
 return jsonb_build_object('ready',true,'expiresAt',clock_timestamp()+interval '15 seconds');
end $$;
revoke all on function public.sanji_creator_email_isolated_begin_send(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_email_isolated_begin_send(uuid,uuid,uuid,jsonb) to service_role;

-- Terminal, idempotent result recording only. No retry permission is ever returned.
create function public.sanji_creator_email_isolated_finalize(p_owner uuid,p_creator uuid,p_reservation uuid,p_status text,p_provider jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.sanji_creator_email_isolated_queue; o public.sanji_outbox; d jsonb; thread_id uuid; final_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_creator_email_isolated_queue where owner=p_owner and creator_id=p_creator for update;
 if not found or p_reservation is null or q.reservation_token is distinct from p_reservation or q.outbox_id is null then raise exception 'reservation mismatch';end if;
 if p_status is null or p_status not in ('accepted','rejected','outcome_unknown','cancelled') then raise exception 'invalid outcome';end if;
 if q.status<>'reserved' then
  if q.status=p_status then return jsonb_build_object('status',q.status,'duplicate',true);end if;
  raise exception 'terminal outcome requires manual reconciliation';
 end if;
 if p_status in ('accepted','rejected') and q.send_started_at is null then raise exception 'send grant required';end if;
 if p_status='accepted' and (jsonb_typeof(p_provider->'id') is distinct from 'string' or jsonb_typeof(p_provider->'threadId') is distinct from 'string' or btrim(coalesce(p_provider->>'id',''))='' or btrim(coalesce(p_provider->>'threadId',''))='' or length(p_provider->>'id')>200 or length(p_provider->>'threadId')>200) then raise exception 'provider acceptance unverified';end if;
 select * into o from public.sanji_outbox where owner=p_owner and id=q.outbox_id for update;
 if not found or o.status<>'submitting' then raise exception 'outbox changed';end if;
 d:=q.snapshot;final_status:=case p_status when 'rejected' then 'provider_rejected' else p_status end;
 update public.sanji_outbox set status=final_status,data=data||jsonb_build_object('providerId',p_provider->>'id','providerThread',p_provider->>'threadId','retries',0) where owner=p_owner and id=o.id;
 if p_status='accepted' then
  -- Never overwrite an existing conversation or concurrent candidate edit.
  if not exists(select 1 from public.sanji_records where owner=p_owner and kind='thread' and (data->>'target'=d->>'target' or data->>'providerId'=p_provider->>'threadId')) then
   insert into public.sanji_records(owner,kind,data) values(p_owner,'thread',jsonb_build_object('target',d->>'target','channel','email','subject',d->>'subject','providerId',p_provider->>'threadId','owner','','next','회신 대기','due','','classification','미분류','messages',jsonb_build_array(jsonb_build_object('id',p_provider->>'id','messageId','<'||(d->>'messageId')||'@sanji.local>','outboxId',o.id,'out',true,'text',d->>'body','at',extract(epoch from now())*1000,'status','accepted')))) returning id into thread_id;
  end if;
  update public.sanji_records set data=jsonb_set(data,'{status}','"발송"'),version=version+1,updated=now() where owner=p_owner and id=(d->>'target')::uuid and kind='candidate' and version=(d->>'targetVersion')::integer;
 end if;
 update public.sanji_creator_email_isolated_queue set status=p_status,reason=case p_status when 'accepted' then '' when 'rejected' then 'provider_rejected' when 'cancelled' then 'preflight_changed_no_send' else 'outcome_unknown_no_retry' end,updated=now() where owner=p_owner and creator_id=p_creator;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'creator_isolated_email_outcome',jsonb_build_object('creator',p_creator,'outbox',o.id,'status',p_status));
 return jsonb_build_object('status',p_status,'duplicate',false,'thread',thread_id);
end $$;
revoke all on function public.sanji_creator_email_isolated_finalize(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sanji_creator_email_isolated_finalize(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
