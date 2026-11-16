CREATE OR REPLACE FUNCTION public.sanji_blocked(p_owner uuid, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select coalesce(p_data->>'status' in ('거절','수신 거부'),false) or exists(select 1 from public.sanji_suppression where owner=p_owner and identity=any(public.sanji_identities(p_data)))$function$
;
CREATE OR REPLACE FUNCTION public.sanji_youtube_manual_batch_current(p_owner uuid, p_batch uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.sanji_youtube_manual_email_key(v text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare a text:=lower(trim(v)); l text; d text;
begin
 if length(a)>254 or a !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then return null;end if;
 l:=split_part(a,'@',1);d:=split_part(a,'@',2);
 if length(l)>64 or l like '.%' or l like '%.' or l like '%..%' or d like '.%' or d like '%..%' or d like '%.' then return null;end if;
 if d in ('gmail.com','googlemail.com') then l:=split_part(l,'+',1);if l !~ '^[a-z0-9.]+$' then return null;end if;l:=replace(l,'.','');d:='gmail.com';end if;
 return l||'@'||d;
end $function$
;
CREATE OR REPLACE FUNCTION public.sanji_youtube_manual_refused(p_owner uuid, p_email_key text, p_candidate uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.sanji_suppression s where s.owner=p_owner and public.sanji_youtube_manual_email_key(regexp_replace(s.identity,'^email:','','i'))=p_email_key)
 or exists(select 1 from public.sanji_records t where t.owner=p_owner and t.kind='thread' and t.data->>'target'=p_candidate::text and (t.data->>'classification' in ('거절','수신 거부') or t.data->>'conversationStatus' in ('상대방 거절','우리 측 거절')))
 or exists(select 1 from public.sanji_records t cross join lateral jsonb_array_elements(case when jsonb_typeof(t.data->'messages')='array' then t.data->'messages' else '[]'::jsonb end) m cross join lateral jsonb_array_elements(case when jsonb_typeof(m->'bounceFailures')='array' then m->'bounceFailures' else '[]'::jsonb end) f where t.owner=p_owner and t.kind='thread' and f->>'kind'='permanent' and f->>'source'='delivery_status' and coalesce(f->>'status','') ~ '^5\.' and public.sanji_youtube_manual_email_key(f->>'email')=p_email_key)
$function$
;