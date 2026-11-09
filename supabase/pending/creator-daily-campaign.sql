begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Dependencies: creator-daily-outreach.sql and creator-daily-supply.sql (including
-- sanji_daily_supply_reviews), creator-daily-instagram-review.sql and
-- creator-contact-enrichment.sql must precede use. Apply only in a reviewed deployment.
-- LOCAL REVIEW ONLY. Additive campaign adapter; no existing validator replacement,
-- provider calls, activation, cron, credentials, storage publication or backfill.
create table public.sanji_daily_campaign_snapshots (
 owner uuid not null references auth.users(id) on delete cascade,id uuid not null default gen_random_uuid(),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),data jsonb not null check(jsonb_typeof(data)='object'),
 created timestamptz not null default clock_timestamp(),primary key(owner,id)
);
create table public.sanji_daily_campaign_policy (
 owner uuid primary key references auth.users(id) on delete cascade,revision integer not null check(revision>0),
 enabled boolean not null default false,send_enabled boolean not null default false,cutover_at timestamptz,
 snapshot_id uuid not null,data jsonb not null,updated timestamptz not null default clock_timestamp(),
 foreign key(owner,snapshot_id) references public.sanji_daily_campaign_snapshots(owner,id) on delete cascade
);
create table public.sanji_daily_campaign_basis (
 owner uuid not null references auth.users(id) on delete cascade,creator_key text not null,recipient text not null,
 status text not null check(status in('approved','revoked')),kind text not null,classification text not null,
 classification_source text not null,source_url text not null,source_text text not null,
 verified_at timestamptz not null,expires_at timestamptz not null,approved_by uuid not null references auth.users(id) on delete cascade,
 approval_source text not null,policy_revision integer not null,snapshot_id uuid not null,snapshot_hash text not null,updated timestamptz not null default clock_timestamp(),
 primary key(owner,creator_key,recipient),foreign key(owner,snapshot_id) references public.sanji_daily_campaign_snapshots(owner,id) on delete cascade
);
create table public.sanji_daily_campaign_queue (
 owner uuid not null references auth.users(id) on delete cascade,creator_key text not null,email_key text not null,recipient text not null,
 platform text not null check(platform in('youtube','instagram')),day date not null,
 status text not null default 'queued' check(status in('queued','processing','held','reserved','accepted','rejected','outcome_unknown','cancelled')),
 policy_revision integer not null,snapshot_id uuid not null,lease_token uuid,lease_until timestamptz,reservation_token uuid,
 outbox_id uuid,send_started_at timestamptz,payload jsonb not null default '{}',reason text not null default '',
 created timestamptz not null default clock_timestamp(),updated timestamptz not null default clock_timestamp(),
 primary key(owner,creator_key),unique(owner,email_key),foreign key(owner,snapshot_id) references public.sanji_daily_campaign_snapshots(owner,id) on delete cascade
);
alter table public.sanji_daily_campaign_snapshots enable row level security;
alter table public.sanji_daily_campaign_policy enable row level security;
alter table public.sanji_daily_campaign_basis enable row level security;
alter table public.sanji_daily_campaign_queue enable row level security;
revoke all on public.sanji_daily_campaign_snapshots,public.sanji_daily_campaign_policy,public.sanji_daily_campaign_basis,public.sanji_daily_campaign_queue from public,anon,authenticated,service_role;
grant select,insert on public.sanji_daily_campaign_snapshots to service_role;
grant select,insert,update on public.sanji_daily_campaign_policy,public.sanji_daily_campaign_basis,public.sanji_daily_campaign_queue to service_role;
create function public.sanji_daily_campaign_immutable() returns trigger language plpgsql security invoker set search_path='' as $$ begin if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.owner) then return old;end if;raise exception 'campaign snapshot immutable';end $$;
create trigger sanji_daily_campaign_immutable before update or delete on public.sanji_daily_campaign_snapshots for each row execute function public.sanji_daily_campaign_immutable();
-- Same JSON canonicalization used by the JS worker (object keys sorted; arrays ordered).
create function public.sanji_daily_campaign_canonical(v jsonb) returns text language plpgsql immutable security invoker set search_path='' as $$
declare result text;
begin
 if jsonb_typeof(v)='object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.sanji_daily_campaign_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
 elsif jsonb_typeof(v)='array' then select '['||coalesce(string_agg(public.sanji_daily_campaign_canonical(value),',' order by ord),'')||']' into result from jsonb_array_elements(v) with ordinality x(value,ord);
 else result:=v::text;end if;return result;
end $$;
create function public.sanji_daily_campaign_hash(v jsonb) returns text language sql immutable security invoker set search_path='' as $$ select encode(sha256(convert_to(public.sanji_daily_campaign_canonical(v),'UTF8')),'hex') $$;
create function public.sanji_daily_campaign_policy_ok(v jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(v->>'classification' in('solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal') and btrim(v->>'classificationSource')<>'' and btrim(v->>'authorizationSource')<>'' and v#>>'{schedule,timezone}'='Asia/Seoul' and v#>'{schedule,confirmed}'='true'::jsonb and (v#>>'{schedule,hour}')::integer between 0 and 23 and (v#>>'{schedule,minute}')::integer between 0 and 59,false)
$$;
create function public.sanji_daily_campaign_snapshot_check(p_owner uuid,v jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare s public.sanji_records; im jsonb; pr jsonb; product public.sanji_records; image_bytes bytea; scope jsonb;
begin
 if v->>'owner' is distinct from p_owner::text or v->'version' is distinct from '1'::jsonb or v#>>'{template,owner}' is distinct from p_owner::text or v#>'{template,approved}' is distinct from 'true'::jsonb or coalesce(btrim(v#>>'{template,approvalSource}'),'')='' or coalesce(v#>>'{template,subject}','')='' or coalesce(v#>>'{template,body}','')='' or coalesce((v#>>'{template,revision}')::int,0)<1 or coalesce(v->>'contentHash','')!~'^[a-f0-9]{64}$' or v->>'contentHash' is distinct from public.sanji_daily_campaign_hash(v-'contentHash') then raise exception 'invalid approved snapshot';end if;
 if exists(select 1 from jsonb_object_keys(v) k where k not in('version','owner','template','signature','images','products','scopeHash','contentHash','productMode','campaignProducts')) then raise exception 'unexpected private snapshot fields';end if;
 scope:=jsonb_build_object('templateRevision',v#>'{template,revision}','templateHash',public.sanji_daily_campaign_hash(v->'template'),'signatureHash',public.sanji_daily_campaign_hash(v->'signature'),'products',v->'products','images',(select jsonb_agg(jsonb_build_object('id',x.image->>'id','sha256',x.image->>'sha256','bytes',x.image->'bytes') order by ord) from jsonb_array_elements_text(v#>'{template,requiredInlineImageIds}') with ordinality ids(id,ord) join lateral jsonb_array_elements(v->'images') x(image) on x.image->>'id'=ids.id));
 if v->>'productMode'='approved_campaign_assets' then
  if v->'products' is distinct from '[]'::jsonb or jsonb_typeof(v->'campaignProducts') is distinct from 'array' or jsonb_array_length(v->'campaignProducts')<>2 or (select count(distinct value->>'name') from jsonb_array_elements(v->'campaignProducts'))<>2 then raise exception 'exact approved campaign assets required';end if;
  for pr in select value from jsonb_array_elements(v->'campaignProducts') loop
   if exists(select 1 from jsonb_object_keys(pr) k where k not in('name','approvalSource')) or coalesce(pr->>'name','') not in('마라쫀득빵','짬뽕쫀득빵') or coalesce(length(btrim(pr->>'approvalSource')),0) not between 1 and 4000 then raise exception 'approved campaign asset binding changed';end if;
  end loop;
  scope:=scope||jsonb_build_object('productMode',v->'productMode','campaignProducts',v->'campaignProducts');
 elsif (v ? 'productMode' and v->>'productMode' is distinct from 'catalog') or v ? 'campaignProducts' then raise exception 'unsupported campaign product mode';end if;
 if v->>'scopeHash' is distinct from public.sanji_daily_campaign_hash(scope) then raise exception 'snapshot scope hash mismatch';end if;
 if v#>'{signature,verified}' is distinct from 'true'::jsonb or v#>>'{signature,source}' is distinct from 'existing_gmail_signature' then raise exception 'verified Gmail signature required';end if;
 select * into s from public.sanji_records where owner=p_owner and kind='settings' and id=(v#>>'{signature,settingsId}')::uuid for share;
 if not found or s.version is distinct from (v#>>'{signature,settingsVersion}')::int or s.data->>'signatureSource' is distinct from 'gmail' or coalesce((s.data->>'gmailSignatureNeedsConsent')::boolean,false) or s.data->>'emailSignature' is distinct from v#>>'{signature,text}' or s.data->>'gmailSignatureHtml' is distinct from v#>>'{signature,html}' or coalesce(v#>>'{signature,text}','')='' or coalesce(v#>>'{signature,html}','')='' or s.data->>'senderName' is distinct from v#>>'{signature,senderName}' or lower(s.data->>'gmailSignatureEmail') is distinct from lower(v#>>'{signature,senderEmail}') then raise exception 'current signature changed';end if;
 if not exists(select 1 from public.sanji_connections where owner=p_owner and provider='gmail' and lower(summary->>'email')=lower(v#>>'{signature,senderEmail}') and coalesce((summary->>'reauthRequired')::boolean,false)=false) then raise exception 'current Gmail account changed';end if;
 if jsonb_typeof(v->'images') is distinct from 'array' or jsonb_array_length(v->'images')<>2 or jsonb_typeof(v#>'{template,requiredInlineImageIds}') is distinct from 'array' or jsonb_array_length(v#>'{template,requiredInlineImageIds}')<>2 or (select count(distinct value->>'id') from jsonb_array_elements(v->'images'))<>2 or (select count(distinct value->>'sha256') from jsonb_array_elements(v->'images'))<>2 or (select sum((value->>'bytes')::bigint) from jsonb_array_elements(v->'images'))>10485760 then raise exception 'two exact inline images required';end if;
 for im in select value from jsonb_array_elements(v->'images') loop
  if im->>'owner' is distinct from p_owner::text or im->'verified' is distinct from 'true'::jsonb or im->'sharingApproved' is distinct from 'true'::jsonb or im->>'mimeType' is distinct from 'image/png' or coalesce(im->>'id','')='' or not(v#>'{template,requiredInlineImageIds}' ? (im->>'id')) or coalesce((im->>'width')::int,0)<32 or coalesce((im->>'height')::int,0)<32 or (im->>'width')::bigint*(im->>'height')::bigint>20000000 or coalesce((im->>'bytes')::int,0) not between 45 and 5242880 or octet_length(decode(im->>'content','base64')) is distinct from (im->>'bytes')::int or encode(sha256(decode(im->>'content','base64')),'hex') is distinct from im->>'sha256' or substring(decode(im->>'content','base64') from 1 for 8)<>decode('89504e470d0a1a0a','hex') then raise exception 'inline image integrity failed';end if;
  image_bytes:=decode(im->>'content','base64');
  if substring(image_bytes from 9 for 8)<>decode('0000000d49484452','hex') or substring(image_bytes from octet_length(image_bytes)-11 for 12)<>decode('0000000049454e44ae426082','hex') or get_byte(image_bytes,16)::bigint*16777216+get_byte(image_bytes,17)*65536+get_byte(image_bytes,18)*256+get_byte(image_bytes,19)<>(im->>'width')::bigint or get_byte(image_bytes,20)::bigint*16777216+get_byte(image_bytes,21)*65536+get_byte(image_bytes,22)*256+get_byte(image_bytes,23)<>(im->>'height')::bigint then raise exception 'PNG dimensions or chunk structure invalid';end if;
 end loop;
 if jsonb_typeof(v->'products') is distinct from 'array' or jsonb_array_length(v->'products') not in(0,2) or (select count(distinct value->>'id') from jsonb_array_elements(v->'products'))<>jsonb_array_length(v->'products') then raise exception 'zero or two reviewed products required';end if;
 for pr in select value from jsonb_array_elements(v->'products') loop
  select * into product from public.sanji_records where owner=p_owner and kind='deal' and id=(pr->>'id')::uuid for share;
  if not found or product.version is distinct from (pr->>'version')::int or public.sanji_daily_campaign_hash(product.data) is distinct from pr->>'sha256' or coalesce(product.data->>'state','') not in('확정','협의 중') or coalesce(product.data->>'productUrl','')!~'^https://' then raise exception 'current product changed';end if;
 end loop;
end $$;
create function public.sanji_daily_campaign_configure(p_owner uuid,p_expected_revision integer,p_snapshot jsonb,p_policy jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.sanji_daily_campaign_policy; sid uuid; h text; p public.sanji_daily_campaign_policy;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.sanji_members where user_id=p_owner) then raise exception 'invalid owner';end if;
 select * into old from public.sanji_daily_campaign_policy where owner=p_owner for update;
 if coalesce(old.revision,0) is distinct from p_expected_revision then raise exception 'policy revision changed';end if;
 if jsonb_typeof(p_policy) is distinct from 'object' then raise exception 'invalid policy';end if;
 perform public.sanji_daily_campaign_snapshot_check(p_owner,p_snapshot->'data');
 sid:=coalesce((p_snapshot->>'id')::uuid,gen_random_uuid());h:=public.sanji_daily_campaign_hash(p_snapshot->'data');
 insert into public.sanji_daily_campaign_snapshots(owner,id,sha256,data) values(p_owner,sid,h,p_snapshot->'data');
 insert into public.sanji_daily_campaign_policy(owner,revision,snapshot_id,data) values(p_owner,p_expected_revision+1,sid,p_policy)
 on conflict(owner) do update set revision=excluded.revision,snapshot_id=excluded.snapshot_id,data=excluded.data,enabled=false,send_enabled=false,cutover_at=null,updated=clock_timestamp() returning * into p;
 update public.sanji_daily_campaign_queue set status='cancelled',reason='configuration_changed',updated=clock_timestamp() where owner=p_owner and status in('queued','processing','held');
 return to_jsonb(p)||jsonb_build_object('snapshot_sha256',h);
end $$;
create function public.sanji_daily_campaign_schedule(p_owner uuid,p_expected_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.sanji_daily_campaign_policy;s public.sanji_daily_campaign_snapshots;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into p from public.sanji_daily_campaign_policy where owner=p_owner for update;
 if not found or p.revision is distinct from p_expected_revision or not public.sanji_daily_campaign_policy_ok(p.data) then raise exception 'reviewed classification and confirmed schedule required';end if;
 select * into s from public.sanji_daily_campaign_snapshots where owner=p_owner and id=p.snapshot_id;
 if jsonb_array_length(s.data->'products') is distinct from 2 and s.data->>'productMode' is distinct from 'approved_campaign_assets' then raise exception 'product_scope_missing';end if;
 perform public.sanji_daily_campaign_snapshot_check(p_owner,s.data);
 if not p.enabled then update public.sanji_daily_campaign_policy set enabled=true,send_enabled=true,cutover_at=clock_timestamp(),updated=clock_timestamp() where owner=p_owner returning * into p;end if;
 return to_jsonb(p)||jsonb_build_object('snapshot_sha256',s.sha256);
end $$;
create function public.sanji_daily_campaign_pause(p_owner uuid,p_expected_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.sanji_daily_campaign_policy;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 update public.sanji_daily_campaign_policy set revision=revision+1,enabled=false,send_enabled=false,updated=clock_timestamp() where owner=p_owner and revision=p_expected_revision returning * into p;
 if not found then raise exception 'policy revision changed';end if;
 update public.sanji_daily_campaign_queue set status='cancelled',reason='paused',updated=clock_timestamp() where owner=p_owner and status in('queued','processing');
 return to_jsonb(p);
end $$;
create function public.sanji_daily_campaign_review_basis(p_owner uuid,p_expected_revision integer,p_review jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.sanji_daily_campaign_policy;s public.sanji_daily_campaign_snapshots;b public.sanji_daily_campaign_basis;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into p from public.sanji_daily_campaign_policy where owner=p_owner;
 select * into s from public.sanji_daily_campaign_snapshots where owner=p_owner and id=p.snapshot_id;
 if p.revision is distinct from p_expected_revision then raise exception 'basis policy changed';end if;
 if p_review->>'status'='revoked' then
  update public.sanji_daily_campaign_basis set status='revoked',updated=clock_timestamp() where owner=p_owner and creator_key=p_review->>'creatorKey' and recipient=lower(btrim(p_review->>'recipient')) returning * into b;
  if not found then raise exception 'missing owner recipient basis';end if;
  return jsonb_build_object('creatorKey',b.creator_key,'status',b.status,'policyRevision',b.policy_revision);
 end if;
 if p.revision is distinct from p_expected_revision or not exists(select 1 from public.sanji_daily_outreach_candidates where owner=p_owner and creator_key=p_review->>'creatorKey' and recipient=lower(btrim(p_review->>'recipient'))) then raise exception 'basis candidate or policy changed';end if;
 if coalesce(p_review->>'status','') not in('approved','revoked') or p_review->>'classification' is distinct from p.data->>'classification' or not ((p_review->>'kind'='solicited_proposal' and p_review->>'classification'='solicited_non_marketing_proposal') or (p_review->>'kind'='documented_business_proposal' and p_review->>'classification'='reviewed_non_marketing_business_proposal')) or coalesce(btrim(p_review->>'classificationSource'),'')='' or coalesce(btrim(p_review->>'approvalSource'),'')='' or coalesce(p_review->>'sourceUrl','')!~'^https://[^/@[:space:]]+/' or coalesce(length(btrim(p_review->>'sourceText')),0) not between 1 and 8000 or p_review->>'verifiedAt' is null or (p_review->>'verifiedAt')::timestamptz not between clock_timestamp()-interval '30 days' and clock_timestamp() or p_review->>'expiresAt' is null or (p_review->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'explicit recipient basis required';end if;
 insert into public.sanji_daily_campaign_basis(owner,creator_key,recipient,status,kind,classification,classification_source,source_url,source_text,verified_at,expires_at,approved_by,approval_source,policy_revision,snapshot_id,snapshot_hash) values(p_owner,p_review->>'creatorKey',lower(btrim(p_review->>'recipient')),p_review->>'status',p_review->>'kind',p_review->>'classification',p_review->>'classificationSource',p_review->>'sourceUrl',p_review->>'sourceText',(p_review->>'verifiedAt')::timestamptz,(p_review->>'expiresAt')::timestamptz,p_owner,p_review->>'approvalSource',p.revision,s.id,s.sha256)
 on conflict(owner,creator_key,recipient) do update set status=excluded.status,kind=excluded.kind,classification=excluded.classification,classification_source=excluded.classification_source,source_url=excluded.source_url,source_text=excluded.source_text,verified_at=excluded.verified_at,expires_at=excluded.expires_at,approved_by=excluded.approved_by,approval_source=excluded.approval_source,policy_revision=excluded.policy_revision,snapshot_id=excluded.snapshot_id,snapshot_hash=excluded.snapshot_hash,updated=clock_timestamp() returning * into b;
 -- Only an explicit new recipient approval releases the matching missing-basis
 -- hold. This is never automatic retry and cannot reclaim any reservation.
 update public.sanji_daily_campaign_queue q set status='queued',reason='',lease_token=null,lease_until=null,updated=clock_timestamp()
 from public.sanji_daily_outreach_candidates c where q.owner=p_owner and q.creator_key=b.creator_key and q.recipient=b.recipient and q.status='held' and q.reason='recipient_basis_required' and q.outbox_id is null and q.reservation_token is null and q.send_started_at is null and q.policy_revision=p.revision and q.snapshot_id=p.snapshot_id and p.enabled and p.send_enabled and q.day=(clock_timestamp() at time zone 'Asia/Seoul')::date and c.owner=q.owner and c.creator_key=q.creator_key and c.created>=p.cutover_at and c.expires_at>clock_timestamp();
 return jsonb_build_object('creatorKey',b.creator_key,'status',b.status,'policyRevision',b.policy_revision);
end $$;
create function public.sanji_daily_campaign_sync(p_owner uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 update public.sanji_daily_campaign_queue set status='held',reason='expired_without_retry',updated=clock_timestamp() where owner=p_owner and (status='processing' and lease_until<=clock_timestamp() or status='queued' and day<>(clock_timestamp() at time zone 'Asia/Seoul')::date);
 insert into public.sanji_daily_campaign_queue(owner,creator_key,email_key,recipient,platform,day,policy_revision,snapshot_id)
 select c.owner,c.creator_key,c.email_key,c.recipient,c.platform,c.day,p.revision,p.snapshot_id from (
 select a.*,row_number() over(partition by a.platform order by a.created,a.creator_key) rn from public.sanji_daily_outreach_candidates a where a.owner=p_owner and a.day=(clock_timestamp() at time zone 'Asia/Seoul')::date
 ) c join public.sanji_daily_campaign_policy p on p.owner=c.owner
 where p.enabled and p.send_enabled and public.sanji_daily_campaign_policy_ok(p.data) and c.created>=p.cutover_at and c.created<=clock_timestamp() and c.expires_at>clock_timestamp() and c.rn<=case c.platform when 'youtube' then 50 else 10 end
 on conflict do nothing;
 get diagnostics n=row_count;return jsonb_build_object('queued',n);
end $$;
create function public.sanji_daily_campaign_claim(p_owner uuid) returns setof public.sanji_daily_campaign_queue language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 update public.sanji_daily_campaign_queue set status='held',reason='expired_without_retry',updated=clock_timestamp() where owner=p_owner and status='processing' and lease_until<=clock_timestamp();
 return query update public.sanji_daily_campaign_queue q set status='processing',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',updated=clock_timestamp()
 where (q.owner,q.creator_key)=(select w.owner,w.creator_key from public.sanji_daily_campaign_queue w join public.sanji_daily_campaign_policy p on p.owner=w.owner join public.sanji_daily_outreach_candidates c on c.owner=w.owner and c.creator_key=w.creator_key where w.owner=p_owner and w.status='queued' and w.day=(clock_timestamp() at time zone 'Asia/Seoul')::date and c.expires_at>clock_timestamp() and c.created>=p.cutover_at and p.enabled and p.send_enabled and p.revision=w.policy_revision and p.snapshot_id=w.snapshot_id order by w.created,w.creator_key for update of w skip locked limit 1) returning q.*;
end $$;
create function public.sanji_daily_campaign_hold(p_owner uuid,p_creator_key text,p_lease uuid,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 update public.sanji_daily_campaign_queue set status='held',reason=left(p_reason,160),updated=clock_timestamp() where owner=p_owner and creator_key=p_creator_key and status='processing' and lease_token=p_lease and lease_until>clock_timestamp();
 if not found then raise exception 'stale preparation lease';end if;return '{"status":"held"}'::jsonb;
end $$;
-- Current publication evidence is separate from recipient consent/classification.
-- Source/observation writers share the native owner lock with this adapter.
create function public.sanji_daily_campaign_publication(p_owner uuid,p_creator_key text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.sanji_contact_observations;s public.sanji_contact_source_versions;refs jsonb;e jsonb;selected boolean:=false;policy_end timestamptz:='infinity';bio public.sanji_creator_evidence;bio_text text;published_text text;bio_checked timestamptz;
begin
 select * into o from public.sanji_contact_observations where owner=p_owner and creator_key=p_creator_key and kind='publication' order by created_at desc,id desc limit 1;
 if not found then return '{}'::jsonb;end if;
 e:=o.payload->'evidence';
 if o.payload->>'owner' is distinct from p_owner::text or o.payload->>'creatorKey' is distinct from p_creator_key or o.payload->'publicationEvidenceOnly' is distinct from 'true'::jsonb or o.payload->>'status' is distinct from 'publication_verified' or e->'verified' is distinct from 'true'::jsonb or e->>'creatorKey' is distinct from p_creator_key or e->>'accessMethod' is distinct from 'public_source_review' or e->>'purpose' is distinct from 'business_collaboration' or o.payload->>'recordedAt' is null or (o.payload->>'recordedAt')::timestamptz not between clock_timestamp()-interval '1 day' and clock_timestamp() or o.payload->>'validUntil' is null or (o.payload->>'validUntil')::timestamptz<=clock_timestamp() or o.payload->'blockedSources' is distinct from '[]'::jsonb then raise exception 'current publication is negative or expired';end if;
 select coalesce(jsonb_agg(jsonb_build_object('sourceId',x.source_id,'revision',x.revision) order by x.source_id),'[]') into refs from (select distinct on(source_id) source_id,revision from public.sanji_contact_source_versions where owner=p_owner and creator_key=p_creator_key order by source_id,revision desc) x;
 if refs='[]'::jsonb or refs is distinct from o.payload->'sourceVersions' or jsonb_array_length(refs)>3 then raise exception 'current publication source versions changed';end if;
 for s in select distinct on(source_id) * from public.sanji_contact_source_versions where owner=p_owner and creator_key=p_creator_key order by source_id,revision desc loop
  if s.state<>'reviewed' or s.source_kind not in('official_website','instagram_public_bio') or s.source_url!~'^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}/[^?#[:space:]]*$' or s.source_url~*'^https://([^/]+[.])?(youtube[.]com|youtu[.]be|googleapis[.]com|localhost|local|internal|test|invalid)(/|$)' then raise exception 'publication source not reviewed';end if;
  if s.source_kind='instagram_public_bio' and (split_part(p_creator_key,':',1)<>'instagram' or s.source_url not in('https://instagram.com/'||split_part(p_creator_key,':',2)||'/','https://www.instagram.com/'||split_part(p_creator_key,':',2)||'/')) then raise exception 'publication profile changed';end if;
  if s.stored_link->>'creatorKey' is distinct from p_creator_key or s.stored_link->>'url' is distinct from s.source_url or coalesce(s.stored_link->>'sourceRecordId','')='' or not public.sanji_contact_creator_anchor(p_owner,p_creator_key,s.stored_link->>'sourceRecordId') or coalesce(s.stored_link->>'sourceUrl','')!~'^https://' or coalesce(btrim(s.stored_link->>'sourceText'),'')='' or coalesce(btrim(s.stored_link->>'reviewedBy'),'')='' or s.stored_link->>'checkedAt' is null or (s.stored_link->>'checkedAt')::timestamptz not between clock_timestamp()-interval '30 days' and clock_timestamp() then raise exception 'publication saved source link changed';end if;
  if s.policy_review->>'exactUrl' is distinct from s.source_url or s.policy_review->>'decision' is distinct from (case s.source_kind when 'official_website' then 'allow_public_get' else 'allow_existing_official_bio' end) or coalesce(btrim(s.policy_review->>'reviewedBy'),'')='' or s.policy_review->>'reviewedAt' is null or (s.policy_review->>'reviewedAt')::timestamptz not between clock_timestamp()-interval '7 days' and clock_timestamp() or s.policy_review->>'expiresAt' is null or (s.policy_review->>'expiresAt')::timestamptz<=clock_timestamp() or (s.policy_review->>'expiresAt')::timestamptz>(s.policy_review->>'reviewedAt')::timestamptz+interval '7 days' or s.policy_review->'noLoginOrChallenge' is distinct from 'true'::jsonb or s.policy_review->'noAccessRestriction' is distinct from 'true'::jsonb or s.policy_review->'maxRequestsPerDay' is distinct from '1'::jsonb or coalesce(s.policy_review->>'termsUrl','')!~'^https://' or coalesce(btrim(s.policy_review->>'termsExcerpt'),'')='' or coalesce(s.policy_review->>'robotsUrl','')!~'^https://' or coalesce(btrim(s.policy_review->>'robotsExcerpt'),'')='' or coalesce(btrim(s.policy_review->>'accessRationale'),'')='' or (s.source_kind='official_website' and s.policy_review->>'robotsUrl' is distinct from substring(s.source_url from '^https://[^/]+')||'/robots.txt') then raise exception 'publication site policy expired or changed';end if;
  if s.affiliation->'verified' is distinct from 'true'::jsonb or s.affiliation->'independentlyVerified' is distinct from 'true'::jsonb or s.affiliation->>'creatorKey' is distinct from p_creator_key or s.affiliation->>'officialUrl' is distinct from s.source_url or s.affiliation->>'method' is distinct from 'manual_cross_reference' or coalesce(btrim(s.affiliation->>'reviewedBy'),'')='' or coalesce(s.affiliation->>'sourceUrl','')!~'^https://' or coalesce(position(split_part(p_creator_key,':',2) in s.affiliation->>'sourceText'),0)=0 or s.affiliation->>'checkedAt' is null or (s.affiliation->>'checkedAt')::timestamptz not between clock_timestamp()-interval '30 days' and clock_timestamp() then raise exception 'publication creator affiliation changed';end if;
  policy_end:=least(policy_end,(s.policy_review->>'expiresAt')::timestamptz);
  if e#>>'{enrichment,sourceId}'=s.source_id::text and e#>'{enrichment,revision}'=to_jsonb(s.revision) then
   if e->>'sourceUrl' is distinct from s.source_url or e->>'sourceKind' is distinct from s.source_kind or e#>>'{enrichment,status}' is distinct from 'publication_verified' or e#>'{enrichment,publicationEvidenceOnly}' is distinct from 'true'::jsonb or (s.source_kind='official_website' and e->'affiliation' is distinct from jsonb_build_object('verified',true,'creatorKey',p_creator_key,'sourceUrl',s.affiliation->>'sourceUrl','sourceText',s.affiliation->>'sourceText','checkedAt',s.affiliation->>'checkedAt')) then raise exception 'publication evidence binding changed';end if;
   if s.source_kind='instagram_public_bio' then
    -- Never reuse a cached positive publication after the authoritative bio was
    -- removed, changed, made unreadable, or replaced by a conflicting observation.
    if not exists(select 1 from public.sanji_creator_recovery where owner=p_owner and id=(s.stored_link->>'sourceRecordId')::uuid and profile_url=s.source_url and lower(handle)=split_part(p_creator_key,':',2)) then raise exception 'publication bio creator changed';end if;
    select * into bio from public.sanji_creator_evidence where owner=p_owner and creator_id=(s.stored_link->>'sourceRecordId')::uuid and source_kind='public_bio' and source_url=s.source_url order by (detail->>'bio_checked_at')::timestamptz desc nulls first,seen_at desc,source_provider,source_ref,observation_key limit 1 for share;
    if not found then raise exception 'current publication bio missing';end if;
    bio_checked:=(bio.detail->>'bio_checked_at')::timestamptz;
    if bio.source_provider not in('instagram_public','instagram_official') or bio.source_ref not in('business_discovery','manual_public_bio') or bio.detail->>'bio_source_url' is distinct from s.source_url or bio.detail->'bio_content_available' is distinct from 'true'::jsonb or jsonb_typeof(bio.detail->'bio') is distinct from 'string' or bio_checked is null or bio_checked not between clock_timestamp()-interval '7 days' and clock_timestamp() or bio_checked is distinct from (e->>'checkedAt')::timestamptz then raise exception 'current publication bio changed or expired';end if;
    if exists(select 1 from public.sanji_creator_evidence conflicting where conflicting.owner=p_owner and conflicting.creator_id=bio.creator_id and conflicting.source_kind='public_bio' and conflicting.source_url=s.source_url and (conflicting.detail->>'bio_checked_at')::timestamptz=bio_checked and (conflicting.detail->>'bio' is distinct from bio.detail->>'bio' or conflicting.detail->'bio_content_available' is distinct from bio.detail->'bio_content_available' or conflicting.detail->>'bio_source_url' is distinct from bio.detail->>'bio_source_url' or conflicting.source_provider not in('instagram_public','instagram_official') or conflicting.source_ref not in('business_discovery','manual_public_bio'))) then raise exception 'ambiguous current publication bio';end if;
    bio_text:=btrim(regexp_replace(bio.detail->>'bio','[[:space:]]+',' ','g'));published_text:=btrim(regexp_replace(e->>'sourceText','[[:space:]]+',' ','g'));
    if coalesce(published_text,'')='' or position(published_text in bio_text)=0 or position(lower(e->>'address') in lower(published_text))=0 or replace(lower(published_text),lower(e->>'address'),'')!~'(협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor)' or bio_text~*'(개인정보|개인[[:space:]]*연락|채용|입사|고객[[:space:]]*(센터|지원)|팬[[:space:]]*(레터|메일)|privacy|personal|recruit|career|support|customer|fan[[:space:]]*mail|data[[:space:]]*protection|not[[:space:]]+(for[[:space:]]+)?(business|commercial|advertis|collab)|no[[:space:]]+(business|commercial|advertis|collab)|(협업|광고|사업|제휴).{0,30}(거절|금지|받지|불가|아닙|아님|제외))' or (select array_agg(distinct lower(m[1])) from regexp_matches(bio_text,'[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+[.][a-z]{2,}','gi') m) is distinct from array[lower(e->>'address')] then raise exception 'current bio business publication changed';end if;
    policy_end:=least(policy_end,bio_checked+interval '7 days');
   end if;
   selected:=true;
  end if;
 end loop;
 if not selected or (o.payload->>'validUntil')::timestamptz>policy_end then raise exception 'publication scope changed';end if;
 return jsonb_build_object('evidence',e,'observationId',o.id,'observationHash',public.sanji_daily_campaign_hash(o.payload),'validUntil',o.payload->>'validUntil');
end $$;
-- Full validation is shared by reserve and the one-use provider grant. Original
-- source rows, latest evidence, settings, products, basis and ALL history are reread.
create function public.sanji_daily_campaign_validate(p_owner uuid,p_creator_key text,p_plan jsonb,p_history jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.sanji_daily_campaign_queue;p public.sanji_daily_campaign_policy;s public.sanji_daily_campaign_snapshots;
 c public.sanji_daily_outreach_candidates;b public.sanji_daily_campaign_basis;r public.sanji_records;ig public.sanji_creator_recovery;
 evidence jsonb;source jsonb;h jsonb;contact jsonb;im jsonb;planned jsonb;seen timestamptz; staged record; reviewed record; ig_review record; source_review_at timestamptz; source_review_hash text; publication jsonb;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_plan) k where k not in('snapshotId','snapshotHash','scopeHash','subject','body','signatureText','signatureHtml','senderEmail','senderName','settingsId','settingsVersion','products','inlineImages','messageId','rawHash','gmailHistory','candidateVersion','sourceUpdated','productMode','campaignProducts')) or exists(select 1 from jsonb_object_keys(p_plan->'gmailHistory') k where k not in('address','emailKey','senderEmail','checkedAt','clear')) or exists(select 1 from jsonb_array_elements(p_plan->'inlineImages') x cross join lateral jsonb_object_keys(x) k where k not in('id','sha256','bytes')) or exists(select 1 from jsonb_array_elements(p_plan->'products') x cross join lateral jsonb_object_keys(x) k where k not in('id','version','sha256')) then raise exception 'unexpected campaign plan fields';end if;
 select * into q from public.sanji_daily_campaign_queue where owner=p_owner and creator_key=p_creator_key for update;
 select * into p from public.sanji_daily_campaign_policy where owner=p_owner for share;
 select * into s from public.sanji_daily_campaign_snapshots where owner=p_owner and id=p.snapshot_id;
 select * into c from public.sanji_daily_outreach_candidates where owner=p_owner and creator_key=p_creator_key;
 if q.owner is null or p.owner is null or s.id is null or c.owner is null or not exists(select 1 from public.sanji_members where user_id=p_owner) or not p.enabled or not p.send_enabled or not public.sanji_daily_campaign_policy_ok(p.data) or p.revision<>q.policy_revision or p.snapshot_id<>q.snapshot_id or c.created<p.cutover_at or c.created>clock_timestamp() or c.expires_at<=clock_timestamp() or c.day<>(clock_timestamp() at time zone 'Asia/Seoul')::date or q.email_key is distinct from c.email_key or q.recipient is distinct from c.recipient or public.sanji_daily_outreach_email_key(c.recipient) is distinct from c.email_key then raise exception 'campaign policy or candidate expired';end if;
 if p_plan->>'snapshotId' is distinct from s.id::text or p_plan->>'snapshotHash' is distinct from s.sha256 or public.sanji_daily_campaign_hash(s.data)<>s.sha256 or coalesce(p_plan->>'scopeHash','')!~'^[a-f0-9]{64}$' or p_plan->>'scopeHash' is distinct from s.data->>'scopeHash' then raise exception 'snapshot scope changed';end if;
 if jsonb_array_length(s.data->'products') is distinct from 2 and s.data->>'productMode' is distinct from 'approved_campaign_assets' then raise exception 'product_scope_missing';end if;
 perform public.sanji_daily_campaign_snapshot_check(p_owner,s.data);
 if p_plan->'productMode' is distinct from s.data->'productMode' or p_plan->'campaignProducts' is distinct from s.data->'campaignProducts' or p_plan->'products' is distinct from s.data->'products' or p_plan->>'signatureText' is distinct from s.data#>>'{signature,text}' or p_plan->>'signatureHtml' is distinct from s.data#>>'{signature,html}' or p_plan->>'senderEmail' is distinct from s.data#>>'{signature,senderEmail}' or p_plan->>'senderName' is distinct from s.data#>>'{signature,senderName}' or p_plan->>'settingsId' is distinct from s.data#>>'{signature,settingsId}' or p_plan->'settingsVersion' is distinct from s.data#>'{signature,settingsVersion}' then raise exception 'approved sender or products changed';end if;
 if p_plan->>'subject' is distinct from replace(s.data#>>'{template,subject}','[채널명]',c.snapshot->>'name') or p_plan->>'body' is distinct from replace(s.data#>>'{template,body}','[채널명]',c.snapshot->>'name') or coalesce(p_plan->>'messageId','')!~'^[A-Za-z0-9_-]{8,80}$' or coalesce(p_plan->>'rawHash','')!~'^[a-f0-9]{64}$' then raise exception 'fixed copy or message changed';end if;
 if jsonb_typeof(p_plan->'inlineImages') is distinct from 'array' or jsonb_array_length(p_plan->'inlineImages')<>2 then raise exception 'inline image scope changed';end if;
 for im in select value from jsonb_array_elements(s.data->'images') loop
  select value into planned from jsonb_array_elements(p_plan->'inlineImages') where value->>'id'=im->>'id';
  if not found or planned->>'sha256' is distinct from im->>'sha256' or planned->'bytes' is distinct from im->'bytes' then raise exception 'inline image scope changed';end if;
 end loop;
 select * into b from public.sanji_daily_campaign_basis where owner=p_owner and creator_key=p_creator_key and recipient=c.recipient for share;
 if not found or b.status<>'approved' or b.classification<>p.data->>'classification' or not ((b.kind='solicited_proposal' and b.classification='solicited_non_marketing_proposal') or (b.kind='documented_business_proposal' and b.classification='reviewed_non_marketing_business_proposal')) or b.classification_source='' or b.source_url!~'^https://[^/@[:space:]]+/' or b.source_text='' or b.verified_at not between clock_timestamp()-interval '30 days' and clock_timestamp() or b.expires_at<=clock_timestamp() or b.approved_by<>p_owner or b.approval_source='' or b.policy_revision<>p.revision or b.snapshot_id<>s.id or b.snapshot_hash<>s.sha256 then raise exception 'explicit recipient basis required';end if;
 seen:=(p_history->>'checkedAt')::timestamptz;
 if p_history->'clear' is distinct from 'true'::jsonb or p_history->>'address' is distinct from c.recipient or p_history->>'emailKey' is distinct from c.email_key or p_history->>'senderEmail' is distinct from p_plan->>'senderEmail' or seen is null or seen<clock_timestamp()-interval '60 seconds' or seen>clock_timestamp()+interval '5 seconds' then raise exception 'fresh Gmail history required';end if;
 -- Never route a YouTube source ID through Instagram recovery/creator validators.
 if c.platform='youtube' and c.snapshot->>'sourceRecordId' is null then
  -- API observations are expiring staging only. Permanent target identity/name
  -- comes exclusively from independent owner-reviewed publication evidence.
  select * into staged from public.sanji_daily_supply_snapshots where owner=p_owner and campaign='mara-jjamppong-bread' and channel_id=split_part(c.creator_key,':',2) for share;
  if not found then raise exception 'staged YouTube snapshot missing';end if;
  select * into reviewed from public.sanji_daily_supply_reviews where owner=p_owner and campaign='mara-jjamppong-bread' and creator_key=c.creator_key for share;
  if not found or c.snapshot#>'{apiSnapshot,titleFromApi}' is distinct from 'true'::jsonb or staged.observed_at>clock_timestamp() or staged.observed_at<clock_timestamp()-interval '29 days' or reviewed.reviewed_at>clock_timestamp() or reviewed.reviewed_at<clock_timestamp()-interval '30 days' or staged.expires_at<=clock_timestamp() or reviewed.expires_at<=clock_timestamp() or reviewed.review->>'reviewedBy' is distinct from p_owner::text or (reviewed.review->>'snapshotObservedAt')::timestamptz is distinct from staged.observed_at or reviewed.review->>'creatorKey' is distinct from c.creator_key or (c.snapshot#>>'{apiSnapshot,observedAt}')::timestamptz is distinct from staged.observed_at or (c.snapshot#>>'{apiSnapshot,expiresAt}')::timestamptz is distinct from staged.expires_at or staged.snapshot->>'source' is distinct from 'youtube_data_api' or staged.snapshot->>'channelId' is distinct from split_part(c.creator_key,':',2) or staged.snapshot->>'url' is distinct from c.snapshot->>'profileUrl' or staged.snapshot->'subscriberCount' is distinct from c.snapshot->'audience' or c.snapshot->>'audienceSource' is distinct from staged.snapshot->>'url' or (c.snapshot->>'audienceCheckedAt')::timestamptz is distinct from staged.observed_at or c.snapshot->>'name' is distinct from reviewed.review#>>'{displayNameEvidence,name}' or reviewed.review#>>'{displayNameEvidence,creatorKey}' is distinct from c.creator_key or reviewed.review#>>'{displayNameEvidence,profileUrl}' is distinct from c.snapshot->>'profileUrl' or reviewed.review->'independentlyReviewed' is distinct from 'true'::jsonb or reviewed.review#>'{displayNameEvidence,verified}' is distinct from 'true'::jsonb or coalesce(position(split_part(c.creator_key,':',2) in reviewed.review#>>'{displayNameEvidence,sourceText}'),0)=0 then raise exception 'staged YouTube source or independent review changed';end if;
  if exists(select 1 from public.sanji_records existing where existing.owner=p_owner and existing.kind='candidate' and (existing.data->>'creatorKey'=c.creator_key or existing.data->>'companyKey'='youtube:channel-id-hex:'||encode(convert_to(split_part(c.creator_key,':',2),'UTF8'),'hex') or rtrim(existing.data->>'profile','/') in('https://youtube.com/channel/'||split_part(c.creator_key,':',2),'https://www.youtube.com/channel/'||split_part(c.creator_key,':',2))) and existing.id::text is distinct from q.payload#>>'{draft,target}') then raise exception 'staged identity has native source; reprepare';end if;
  source_review_at:=reviewed.reviewed_at;source_review_hash:=public.sanji_daily_campaign_hash(jsonb_build_object('displayNameEvidence',reviewed.review->'displayNameEvidence','contactEvidence',reviewed.review->'contactEvidence','mukbang',reviewed.review->'mukbang'));
  evidence:=reviewed.review||jsonb_build_object('lastActiveAt',staged.snapshot->>'lastActiveAt','activitySource',staged.snapshot->>'lastActivityUrl','activityCheckedAt',staged.observed_at);
 elsif c.platform='youtube' then
  select * into r from public.sanji_records where owner=p_owner and id=(c.snapshot->>'sourceRecordId')::uuid and kind='candidate' for share;
  if not found or r.data->>'channels' is distinct from 'YouTube' or coalesce(r.data->>'status','') in('거절','수신 거부','제외','발송') or public.sanji_blocked(p_owner,r.data) or c.creator_key is distinct from 'youtube:'||coalesce(r.data#>>'{youtubeResearch,channelId}',substring(r.data->>'profile' from '/channel/(UC[A-Za-z0-9_-]{22})/?$')) or c.snapshot->>'name' is distinct from r.data->>'name' or c.snapshot->>'profileUrl' is distinct from r.data->>'profile' then raise exception 'current YouTube source changed or excluded';end if;
  if p_plan->>'candidateVersion' is not null and (p_plan->>'candidateVersion')::int is distinct from r.version then raise exception 'source version changed';end if;
  evidence:=r.data->'dailyOutreachEvidence';
  if c.snapshot ? 'apiSnapshot' then
   select * into staged from public.sanji_daily_supply_snapshots where owner=p_owner and campaign='mara-jjamppong-bread' and channel_id=split_part(c.creator_key,':',2) for share;
   if not found or staged.expires_at<=clock_timestamp() or staged.observed_at>clock_timestamp() or staged.observed_at<clock_timestamp()-interval '29 days' or (c.snapshot#>>'{apiSnapshot,observedAt}')::timestamptz is distinct from staged.observed_at or (c.snapshot#>>'{apiSnapshot,expiresAt}')::timestamptz is distinct from staged.expires_at or staged.snapshot->>'source' is distinct from 'youtube_data_api' or staged.snapshot->>'channelId' is distinct from split_part(c.creator_key,':',2) or rtrim(staged.snapshot->>'url','/') not in('https://youtube.com/channel/'||split_part(c.creator_key,':',2),'https://www.youtube.com/channel/'||split_part(c.creator_key,':',2)) or staged.snapshot->'subscriberCount' is distinct from c.snapshot->'audience' or c.snapshot->>'audienceSource' is distinct from staged.snapshot->>'url' or (c.snapshot->>'audienceCheckedAt')::timestamptz is distinct from staged.observed_at then raise exception 'current native YouTube API overlay changed';end if;
   evidence:=evidence||jsonb_build_object('lastActiveAt',staged.snapshot->>'lastActiveAt','activitySource',staged.snapshot->>'lastActivityUrl','activityCheckedAt',staged.observed_at);
  elsif c.snapshot->'audience' is distinct from r.data->'followers' or c.snapshot->>'audienceSource' is distinct from r.data->>'metricsSource' or (c.snapshot->>'audienceCheckedAt')::timestamptz is distinct from coalesce((evidence->>'audienceCheckedAt')::timestamptz,(r.data#>>'{youtubeResearch,subscriberObservationDate}')::timestamptz) then raise exception 'audience evidence changed';end if;
 else
  select * into ig from public.sanji_creator_recovery where owner=p_owner and id=(c.snapshot->>'sourceRecordId')::uuid for share;
  if not found or ig.status<>'new' or ig.assessment='excluded' or ig.entity_type='noncreator_suspected' or ig.link_status is distinct from 'source_confirmed' or c.creator_key is distinct from 'instagram:'||lower(ig.handle) or c.snapshot->>'name' is distinct from coalesce(nullif(ig.nickname,''),ig.handle) or c.snapshot->>'profileUrl' is distinct from ig.profile_url then raise exception 'current Instagram source changed or excluded';end if;
  if p_plan->>'sourceUpdated' is not null and (p_plan->>'sourceUpdated')::timestamptz is distinct from ig.updated then raise exception 'source version changed';end if;
  select * into ig_review from public.sanji_daily_supply_instagram_reviews where owner=p_owner and campaign='mara-jjamppong-bread' and creator_id=ig.id for share;
  if found then
   if ig_review.creator_key is distinct from c.creator_key or ig_review.source_updated is distinct from ig.updated or ig_review.reviewed_at not between clock_timestamp()-interval '29 days' and clock_timestamp() or ig_review.expires_at<=clock_timestamp() or ig_review.review->>'reviewedBy' is distinct from p_owner::text or ig_review.review->>'creatorKey' is distinct from c.creator_key or ig_review.review->>'sourceRecordId' is distinct from ig.id::text or (ig_review.review->>'sourceRecordUpdated')::timestamptz is distinct from ig.updated or c.snapshot->'audience' is distinct from ig_review.review->'audience' or c.snapshot->>'audienceSource' is distinct from ig_review.review->>'audienceSource' or (c.snapshot->>'audienceCheckedAt')::timestamptz is distinct from (ig_review.review->>'audienceCheckedAt')::timestamptz then raise exception 'current Instagram campaign review changed';end if;
   evidence:=ig_review.review;source_review_at:=ig_review.reviewed_at;source_review_hash:=public.sanji_daily_campaign_hash(evidence-'reviewedAt'-'expiresAt');
  else
   if exists(select 1 from public.sanji_daily_supply_instagram_review_guards where owner=p_owner and campaign='mara-jjamppong-bread' and creator_id=ig.id) then raise exception 'Instagram campaign review expired; no native fallback';end if;
   if c.snapshot->'audience' is distinct from to_jsonb(ig.followers) or c.snapshot->>'audienceSource' is distinct from ig.followers_source or (c.snapshot->>'audienceCheckedAt')::timestamptz is distinct from ig.followers_checked then raise exception 'current Instagram audience changed';end if;
   if (select count(distinct detail) from public.sanji_creator_evidence where owner=p_owner and creator_id=ig.id and source_kind='daily_outreach_review' and seen_at=(select max(seen_at) from public.sanji_creator_evidence where owner=p_owner and creator_id=ig.id and source_kind='daily_outreach_review'))>1 then raise exception 'ambiguous latest creator evidence';end if;
   select detail into evidence from public.sanji_creator_evidence where owner=p_owner and creator_id=ig.id and source_kind='daily_outreach_review' order by seen_at desc,source_url,source_ref,observation_key limit 1 for share;
  end if;
 end if;
 if evidence is null or (c.snapshot->>'lastActiveAt')::timestamptz is distinct from coalesce((evidence->>'lastActiveAt')::timestamptz,(r.data#>>'{youtubeResearch,observedActivity,last_activity_date}')::timestamptz) or c.snapshot->>'activitySource' is distinct from coalesce(evidence->>'activitySource',r.data#>>'{youtubeResearch,observedActivity,last_activity_url}') or (c.snapshot->>'activityCheckedAt')::timestamptz is distinct from (evidence->>'activityCheckedAt')::timestamptz or c.snapshot#>>'{mukbang,sourceUrl}' is distinct from evidence#>>'{mukbang,sourceUrl}' or c.snapshot#>>'{mukbang,sourceText}' is distinct from btrim(evidence#>>'{mukbang,sourceText}') or (c.snapshot#>>'{mukbang,checkedAt}')::timestamptz is distinct from (evidence#>>'{mukbang,checkedAt}')::timestamptz or evidence#>'{mukbang,verified}' is distinct from 'true'::jsonb then raise exception 'current activity or mukbang evidence changed';end if;
 if c.snapshot->'apiSnapshot' is not null and c.snapshot->'apiSnapshot'<>'null'::jsonb then
  if c.snapshot#>>'{apiSnapshot,expiresAt}' is null or (c.snapshot#>>'{apiSnapshot,expiresAt}')::timestamptz<=clock_timestamp() then raise exception 'API evidence expired';end if;
  if c.snapshot#>'{apiSnapshot,titleFromApi}'='true'::jsonb and (c.snapshot->'displayNameEvidence' is distinct from evidence->'displayNameEvidence' or c.snapshot#>'{displayNameEvidence,verified}' is distinct from 'true'::jsonb or c.snapshot#>>'{displayNameEvidence,name}' is distinct from c.snapshot->>'name' or coalesce(c.snapshot#>>'{displayNameEvidence,kind}','') not in('official_website','provided_by_creator') or coalesce(c.snapshot#>>'{displayNameEvidence,sourceUrl}','')!~'^https://[^/@[:space:]]+/' or c.snapshot#>>'{displayNameEvidence,sourceUrl}'~*'^https://([^/]+\.)?(youtube\.com|youtu\.be|googleapis\.com)(/|$)' or coalesce(position(c.snapshot->>'name' in c.snapshot#>>'{displayNameEvidence,sourceText}'),0)=0 or c.snapshot#>>'{displayNameEvidence,checkedAt}' is null or (c.snapshot#>>'{displayNameEvidence,checkedAt}')::timestamptz not between clock_timestamp()-interval '30 days' and clock_timestamp() or c.snapshot#>>'{contact,affiliation,creatorKey}' is distinct from c.creator_key or c.snapshot#>'{contact,affiliation,verified}' is distinct from 'true'::jsonb) then raise exception 'independent name evidence required';end if;
 end if;
 publication:=public.sanji_daily_campaign_publication(p_owner,p_creator_key);
 if publication ? 'evidence' then evidence:=jsonb_set(evidence,'{contactEvidence}',coalesce(evidence->'contactEvidence','[]'::jsonb)||jsonb_build_array(publication->'evidence'));end if;
 contact:=c.snapshot->'contact';
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(evidence->'contactEvidence')='array' then evidence->'contactEvidence' else '[]'::jsonb end) e where lower(btrim(e->>'address'))=c.recipient and e->>'creatorKey'=c.creator_key and e->'verified'='true'::jsonb and e->>'accessMethod'='public_source_review' and e->>'purpose'='business_collaboration' and e->>'sourceUrl'=contact->>'sourceUrl' and btrim(e->>'sourceText')=contact->>'sourceText' and e->>'sourceKind'=contact->>'sourceKind' and (e->>'checkedAt')::timestamptz=(contact->>'checkedAt')::timestamptz and (contact->>'sourceKind'='instagram_public_bio' or e->'affiliation' is not distinct from contact->'affiliation')) then raise exception 'current contact evidence changed';end if;
 if exists(select 1 from jsonb_array_elements(evidence->'contactEvidence') e where e->>'creatorKey'=c.creator_key and ((e->>'checkedAt') is null or (e->>'checkedAt')::timestamptz>(contact->>'checkedAt')::timestamptz or ((e->>'checkedAt')::timestamptz=(contact->>'checkedAt')::timestamptz and (lower(btrim(e->>'address')) is distinct from c.recipient or e->'verified' is distinct from 'true'::jsonb or e->>'sourceText' is distinct from contact->>'sourceText' or e->'ambiguous'='true'::jsonb)))) then raise exception 'newer or ambiguous contact evidence';end if;
 if (select count(distinct e) from jsonb_array_elements(evidence->'contactEvidence') e where e->>'creatorKey'=c.creator_key and (e->>'checkedAt')::timestamptz=(contact->>'checkedAt')::timestamptz)>1 then raise exception 'ambiguous latest contact evidence';end if;
 if exists(select 1 from public.sanji_suppression where owner=p_owner and (identity=c.creator_key or identity=c.snapshot->>'profileUrl' or (c.platform='instagram' and lower(identity)=split_part(c.creator_key,':',2)))) then raise exception 'suppressed creator';end if;
 if exists(select 1 from public.sanji_records excluded where excluded.owner=p_owner and excluded.kind='candidate' and (excluded.data->>'status' in('거절','수신 거부','제외') or public.sanji_blocked(p_owner,excluded.data)) and (excluded.id::text=c.snapshot->>'sourceRecordId' or excluded.data->>'creatorKey'=c.creator_key or excluded.data->>'profile'=c.snapshot->>'profileUrl' or (c.platform='instagram' and lower(replace(excluded.data->>'handle','@',''))=split_part(c.creator_key,':',2)) or public.sanji_daily_outreach_email_key(excluded.data#>>'{contact,email}')=c.email_key)) then raise exception 'excluded creator';end if;
 if exists(select 1 from public.sanji_jobs j left join public.sanji_drafts d on d.owner=j.owner and d.id=j.draft_id where j.owner=p_owner and d.id is null) then raise exception 'incomplete saved history';end if;
 for h in select entry from public.sanji_daily_outreach_saved_history(p_owner) loop
  -- Exclude only our immutable prepared row and our exact reservation. All other
  -- statuses, old queues, reviews, replies and manual notes remain conservative blockers.
  if h->>'creator_key'=c.creator_key and h->>'state'='awaiting_dispatch_review' and h->>'owner'=p_owner::text then continue;end if;
  if q.outbox_id is not null and h->>'id'=q.outbox_id::text and h->>'owner'=p_owner::text and h->>'channel'='email' and h->>'fingerprint'=p_owner::text||':daily-campaign:'||c.creator_key then continue;end if;
  if position(to_jsonb(c.creator_key)::text in h::text)>0 or position(to_jsonb(c.snapshot->>'sourceRecordId')::text in h::text)>0 or position(c.snapshot->>'profileUrl' in h::text)>0 or (c.platform='instagram' and (lower(h->>'resolvedHandle')=split_part(c.creator_key,':',2) or lower(h->>'username')=split_part(c.creator_key,':',2) or lower(h->>'handle')=split_part(c.creator_key,':',2))) or exists(select 1 from regexp_matches(lower(h::text),'[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}','g') m where public.sanji_daily_outreach_email_key(m[1])=c.email_key) then raise exception 'saved contact history or suppression';end if;
 end loop;
 if exists(select 1 from public.sanji_daily_campaign_queue other where other.owner=p_owner and other.creator_key<>c.creator_key and other.email_key=c.email_key) then raise exception 'cross-platform duplicate';end if;
 return jsonb_build_object('sourceRecordId',c.snapshot->>'sourceRecordId','candidateVersion',r.version,'sourceUpdated',ig.updated,'name',c.snapshot->>'name','platform',c.platform,'recipient',c.recipient)||case when source_review_at is not null then jsonb_build_object('sourceReviewAt',source_review_at,'sourceReviewHash',source_review_hash) else '{}'::jsonb end||case when publication ? 'observationId' then jsonb_build_object('contactObservationId',publication->>'observationId','contactObservationHash',publication->>'observationHash','contactValidUntil',publication->>'validUntil') else '{}'::jsonb end;
end $$;
create function public.sanji_daily_campaign_reserve(p_owner uuid,p_creator_key text,p_lease uuid,p_plan jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.sanji_daily_campaign_queue;v jsonb;d jsonb;target_id uuid;draft_id uuid;o public.sanji_outbox;token uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_daily_campaign_queue where owner=p_owner and creator_key=p_creator_key for update;
 if not found then raise exception 'missing campaign queue';end if;
 if q.outbox_id is not null then return jsonb_build_object('status',q.status,'outbox',jsonb_build_object('id',q.outbox_id),'duplicate',true);end if;
 if q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until is null or q.lease_until<=clock_timestamp() then raise exception 'stale preparation lease';end if;
 v:=public.sanji_daily_campaign_validate(p_owner,p_creator_key,p_plan,p_plan->'gmailHistory');
 if q.platform='youtube' and v->>'sourceRecordId' is not null then target_id:=(v->>'sourceRecordId')::uuid;
 elsif q.platform='youtube' then
  insert into public.sanji_records(owner,kind,data) values(p_owner,'candidate',jsonb_build_object('kind','크리에이터','name',v->>'name','platform','youtube','channels','YouTube','handle','','companyKey','youtube:channel-id-hex:'||encode(convert_to(split_part(p_creator_key,':',2),'UTF8'),'hex'),'creatorKey',p_creator_key,'profile','https://www.youtube.com/channel/'||split_part(p_creator_key,':',2),'campaignIsolated',true,'identitySource','independently_reviewed_publication','contact',jsonb_build_object('email',q.recipient),'status','미접촉')) returning id into target_id;
 else
  -- Isolated native representation only: never mutate recovery or existing candidates.
  insert into public.sanji_records(owner,kind,data) values(p_owner,'candidate',jsonb_build_object('kind','크리에이터','name',v->>'name','platform','instagram','creatorKey',p_creator_key,'sourceRecordId',v->>'sourceRecordId','campaignIsolated',true,'contact',jsonb_build_object('email',q.recipient),'status','미접촉')) returning id into target_id;
 end if;
 d:=jsonb_build_object('channel','email','proposalType','daily_creator_campaign','target',target_id,'platform',q.platform,'creatorKey',p_creator_key,'sourceRecordId',v->>'sourceRecordId','email',q.recipient,'emails',jsonb_build_array(q.recipient),'subject',p_plan->>'subject','body',p_plan->>'body','signatureText',p_plan->>'signatureText','signatureHtml',p_plan->>'signatureHtml','senderName',p_plan->>'senderName','senderEmail',p_plan->>'senderEmail','messageId',p_plan->>'messageId','marketing',false,'tracking',jsonb_build_object('enabled',false),'attachments','[]'::jsonb,'inlineImages',p_plan->'inlineImages','campaignPlan',p_plan);
 insert into public.sanji_drafts(owner,data,hash,expires,used) values(p_owner,d,public.sanji_daily_campaign_hash(d),clock_timestamp()+interval '15 minutes',true) returning id into draft_id;
 -- Campaign-specific native adapter: same owner lock, consumed drafts and native
  -- outbox contract, without weakening/replacing legacy reservation validators.
 insert into public.sanji_outbox(owner,target,channel,fingerprint,status,data) values(p_owner,target_id,'email',p_owner::text||':daily-campaign:'||p_creator_key,'submitting',d||jsonb_build_object('draftId',draft_id,'rawHash',p_plan->>'rawHash')) returning * into o;
 token:=gen_random_uuid();
 update public.sanji_daily_campaign_queue set status='reserved',outbox_id=o.id,reservation_token=token,payload=jsonb_build_object('plan',p_plan,'draft',d,'source',v),lease_token=null,lease_until=null,updated=clock_timestamp() where owner=p_owner and creator_key=p_creator_key;
 return jsonb_build_object('status','reserved','outbox',jsonb_build_object('id',o.id),'reservationToken',token,'duplicate',false);
end $$;
create function public.sanji_daily_campaign_begin_send(p_owner uuid,p_creator_key text,p_reservation uuid,p_gmail_history jsonb,p_raw_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.sanji_daily_campaign_queue;o public.sanji_outbox;v jsonb;grant_expires timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_daily_campaign_queue where owner=p_owner and creator_key=p_creator_key for update;
 if not found or q.status<>'reserved' or p_reservation is null or q.reservation_token is distinct from p_reservation or q.send_started_at is not null or p_raw_hash is distinct from q.payload#>>'{plan,rawHash}' then raise exception 'one-use reservation mismatch';end if;
 select * into o from public.sanji_outbox where owner=p_owner and id=q.outbox_id for update;
 if not found or o.status<>'submitting' or o.data->'campaignPlan' is distinct from q.payload->'plan' or o.target::text is distinct from q.payload#>>'{draft,target}' or o.data->>'rawHash' is distinct from p_raw_hash or not exists(select 1 from public.sanji_drafts where owner=p_owner and id=(o.data->>'draftId')::uuid and used and data=q.payload->'draft' and hash=public.sanji_daily_campaign_hash(data)) then raise exception 'native reservation changed';end if;
 if (q.platform='instagram' or q.payload#>>'{source,sourceRecordId}' is null) and not exists(select 1 from public.sanji_records where owner=p_owner and id=o.target and kind='candidate' and data->'campaignIsolated'='true'::jsonb and version=1 and data->>'name'=q.payload#>>'{source,name}' and data->>'platform'=q.platform and data->>'creatorKey'=p_creator_key and data->>'sourceRecordId' is not distinct from q.payload#>>'{source,sourceRecordId}' and data#>>'{contact,email}'=q.recipient and data->>'status'='미접촉' and not public.sanji_blocked(p_owner,data)) then raise exception 'isolated candidate changed';end if;
 v:=public.sanji_daily_campaign_validate(p_owner,p_creator_key,q.payload->'plan',p_gmail_history);
 if v is distinct from q.payload->'source' then raise exception 'source changed after reservation';end if;
 select least(clock_timestamp()+interval '15 seconds',c.expires_at,b.expires_at,coalesce((v->>'contactValidUntil')::timestamptz,'infinity'::timestamptz),
  coalesce((select expires_at from public.sanji_daily_supply_instagram_reviews where owner=p_owner and campaign='mara-jjamppong-bread' and creator_key=p_creator_key and v ? 'sourceReviewAt'),'infinity'::timestamptz),
  coalesce((select expires_at from public.sanji_daily_supply_reviews where owner=p_owner and campaign='mara-jjamppong-bread' and creator_key=p_creator_key and v ? 'sourceReviewAt'),'infinity'::timestamptz))
 into grant_expires from public.sanji_daily_outreach_candidates c join public.sanji_daily_campaign_basis b on b.owner=c.owner and b.creator_key=c.creator_key and b.recipient=c.recipient where c.owner=p_owner and c.creator_key=p_creator_key;
 if grant_expires is null or grant_expires<=clock_timestamp() then raise exception 'recipient or source grant expired';end if;
 update public.sanji_daily_campaign_queue set send_started_at=clock_timestamp(),updated=clock_timestamp() where owner=p_owner and creator_key=p_creator_key;
 return jsonb_build_object('ready',true,'expiresAt',grant_expires);
end $$;
create function public.sanji_daily_campaign_finalize(p_owner uuid,p_creator_key text,p_reservation uuid,p_status text,p_provider jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.sanji_daily_campaign_queue;o public.sanji_outbox;tid uuid;d jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into q from public.sanji_daily_campaign_queue where owner=p_owner and creator_key=p_creator_key for update;
 if not found or p_reservation is null or q.reservation_token is distinct from p_reservation or q.outbox_id is null then raise exception 'reservation mismatch';end if;
 if p_status is null or p_status not in('accepted','rejected','outcome_unknown','cancelled') then raise exception 'invalid outcome';end if;
 if q.status=p_status then return jsonb_build_object('status',q.status,'duplicate',true);end if;
 -- A verified later receipt may reconcile unknown, but never grant/retry sending.
 if q.status<>'reserved' and not(q.status='outcome_unknown' and p_status='accepted') then raise exception 'terminal outcome requires reconciliation';end if;
 if p_status in('accepted','rejected') and q.send_started_at is null then raise exception 'send grant required';end if;
 if p_status='cancelled' and q.send_started_at is not null then raise exception 'grant issued; record unknown instead';end if;
 if p_status='accepted' and (coalesce(p_provider->>'id','')!~'^[A-Za-z0-9_-]{1,200}$' or coalesce(p_provider->>'threadId','')!~'^[A-Za-z0-9_-]{1,200}$') then raise exception 'provider acceptance unverified';end if;
 select * into o from public.sanji_outbox where owner=p_owner and id=q.outbox_id for update;
 if not found or o.status not in('submitting','outcome_unknown') then raise exception 'native outbox changed';end if;
 d:=q.payload->'draft';
 update public.sanji_outbox set status=case p_status when 'rejected' then 'provider_rejected' else p_status end,data=data||jsonb_build_object('providerId',p_provider->>'id','providerThread',p_provider->>'threadId','retries',0) where owner=p_owner and id=o.id;
 if p_status='accepted' then
  insert into public.sanji_records(owner,kind,data) values(p_owner,'thread',jsonb_build_object('target',o.target,'platform',q.platform,'creatorKey',p_creator_key,'sourceRecordId',d->>'sourceRecordId','channel','email','subject',d->>'subject','providerId',p_provider->>'threadId','next','회신 대기','classification','미분류','messages',jsonb_build_array(jsonb_build_object('id',p_provider->>'id','messageId','<'||(d->>'messageId')||'@sanji.local>','outboxId',o.id,'out',true,'text',d->>'body','at',extract(epoch from clock_timestamp())*1000,'status','accepted')))) returning id into tid;
 end if;
 update public.sanji_daily_campaign_queue set status=p_status,reason=case p_status when 'accepted' then '' when 'outcome_unknown' then 'outcome_unknown_no_retry' else p_status end,updated=clock_timestamp() where owner=p_owner and creator_key=p_creator_key;
 insert into public.sanji_audit(owner,action,data) values(p_owner,'daily_campaign_outcome',jsonb_build_object('creatorKey',p_creator_key,'outbox',o.id,'status',p_status));
 return jsonb_build_object('status',p_status,'duplicate',false,'thread',tid);
end $$;
create function public.sanji_daily_campaign_products(p_owner uuid,p_product_ids uuid[]) returns table(id uuid,version integer,sha256 text) language sql stable security invoker set search_path='' as $$
 select r.id,r.version,public.sanji_daily_campaign_hash(r.data) from public.sanji_records r where r.owner=p_owner and r.kind='deal' and r.id=any(p_product_ids)
$$;
create function public.sanji_daily_campaign_runs(p_owner uuid,p_limit integer default 14) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by day desc),'[]'::jsonb) from (select day,max(updated) updated,jsonb_build_object('queued',count(*) filter(where status='queued'),'processing',count(*) filter(where status='processing'),'held',count(*) filter(where status='held'),'reserved',count(*) filter(where status='reserved'),'accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'outcome_unknown',count(*) filter(where status='outcome_unknown'),'cancelled',count(*) filter(where status='cancelled')) counts from public.sanji_daily_campaign_queue where owner=p_owner group by day order by day desc limit least(greatest(p_limit,1),90)) x
$$;
-- All routines, including internal helpers, are service-only SECURITY INVOKER.
-- No public storage objects or grants are created for template/signature/image data.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'sanji_daily_campaign_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
