-- LOCAL CANDIDATE ONLY. No production execution. Empty manifest intentionally blocks all recovery.
-- Populate the two incident manifests only after independent provenance/executor checks and deployment approval.
BEGIN;
CREATE TABLE public.sanji_youtube_held_recovery_manifest (
 incident_id uuid PRIMARY KEY,
 owner uuid NOT NULL,
 batch_id uuid NOT NULL,
 ledger_id uuid NOT NULL UNIQUE,
 expected_ledger_updated_at timestamptz NOT NULL,
 expected_schedule_updated_at timestamptz NOT NULL,
 approval_hash text NOT NULL CHECK (approval_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
 message_id text NOT NULL,
 candidate_version integer NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 executor_receipt_sha256 text NOT NULL CHECK(executor_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 source_receipts jsonb NOT NULL CHECK(jsonb_typeof(source_receipts)='array' AND jsonb_array_length(source_receipts)>=2),
 verified_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL CHECK(valid_until>verified_at AND valid_until<=verified_at+interval '60 seconds'),
 transition text NOT NULL CHECK(transition='sending_to_held_before_grant'),
 CHECK(owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
 CHECK((ledger_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid AND batch_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid)
 OR (ledger_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid AND batch_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid))
);
CREATE TABLE public.sanji_youtube_held_recovery_audit (
 incident_id uuid PRIMARY KEY REFERENCES public.sanji_youtube_held_recovery_manifest(incident_id),
 owner uuid NOT NULL,ledger_id uuid NOT NULL UNIQUE,batch_id uuid NOT NULL,
 recovered_at timestamptz NOT NULL,old_ledger_updated_at timestamptz NOT NULL,
 old_schedule_updated_at timestamptz NOT NULL,payload_hash text NOT NULL,approval_hash text NOT NULL,
 evidence_sha256 text NOT NULL,executor_receipt_sha256 text NOT NULL,
 result jsonb NOT NULL
);
ALTER TABLE public.sanji_youtube_held_recovery_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanji_youtube_held_recovery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sanji_youtube_held_recovery_manifest,public.sanji_youtube_held_recovery_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sanji_youtube_held_recovery_audit TO service_role;
-- No manifest registration API, no service-role manifest writes, no generic reset capability.
CREATE FUNCTION public.sanji_youtube_manual_recover_incident(p_owner uuid,p_incident uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE m public.sanji_youtube_held_recovery_manifest;a public.sanji_youtube_held_recovery_audit;
 s public.sanji_youtube_manual_schedule;b public.sanji_youtube_manual_batches;
 r public.sanji_youtube_manual_ledger;c public.sanji_records; t timestamptz; result jsonb;
BEGIN
 -- Recovery-only write fence; affects every owner's writes for this short transaction.
 -- ROW SHARE readers may still run; every subsequent row lock stays NOWAIT.
 -- Never catch lock errors or proceed after a failed lock. External execution proof remains required.
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'read committed recovery required'; END IF;
 LOCK TABLE public.sanji_youtube_manual_schedule IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.sanji_youtube_manual_ledger IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 -- ACL is the role boundary. Do not authorize from user-controlled metadata.
 SELECT * INTO m FROM public.sanji_youtube_held_recovery_manifest WHERE incident_id=p_incident AND owner=p_owner FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery manifest unavailable'; END IF;
 SELECT * INTO a FROM public.sanji_youtube_held_recovery_audit WHERE incident_id=p_incident AND owner=p_owner;
 IF FOUND THEN RETURN a.result; END IF; -- receipt only: never repeat mutation
 t:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(m.source_receipts) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(e->>'id','')='' OR coalesce(e->>'sha256','') !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'invalid source receipt';END IF;
 IF m.verified_at>t OR m.valid_until<=t OR NOT EXISTS(SELECT 1 FROM public.sanji_members WHERE user_id=p_owner) THEN RAISE EXCEPTION 'recovery evidence expired';END IF;
 -- Existing worker locks schedule first; use NOWAIT to fail instead of creating a lock cycle.
 SELECT * INTO s FROM public.sanji_youtube_manual_schedule WHERE owner=p_owner AND batch_id=m.batch_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR s.state<>'held' OR s.updated_at IS DISTINCT FROM m.expected_schedule_updated_at OR s.approval_hash IS DISTINCT FROM m.approval_hash OR s.run_at>t THEN RAISE EXCEPTION 'schedule changed';END IF;
 SELECT * INTO b FROM public.sanji_youtube_manual_batches WHERE owner=p_owner AND id=m.batch_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR b.confirmed_by IS DISTINCT FROM p_owner OR b.confirmed_at IS NULL OR b.approval_hash IS DISTINCT FROM m.approval_hash OR b.expires_at<=t OR public.sanji_youtube_manual_batch_current(p_owner,b.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'approval changed or expired';END IF;
 IF EXISTS(SELECT 1 FROM public.sanji_youtube_manual_schedule WHERE owner=p_owner AND state='processing') OR EXISTS(SELECT 1 FROM public.sanji_youtube_manual_ledger WHERE owner=p_owner AND state IN ('sending','granted')) THEN RAISE EXCEPTION 'active executor';END IF;
 PERFORM id FROM public.sanji_youtube_manual_ledger WHERE owner=p_owner AND batch_id=m.batch_id ORDER BY id FOR UPDATE NOWAIT;
 SELECT * INTO r FROM public.sanji_youtube_manual_ledger WHERE owner=p_owner AND id=m.ledger_id;
 IF NOT FOUND OR r.batch_id IS DISTINCT FROM m.batch_id OR r.state<>'held' OR r.updated_at IS DISTINCT FROM m.expected_ledger_updated_at OR r.claim_token IS NOT NULL OR r.refusal_checked_at IS NOT NULL OR r.provider_id IS NOT NULL OR r.provider_thread IS NOT NULL OR r.outbox_id IS NOT NULL OR r.thread_id IS NOT NULL OR r.payload_hash IS DISTINCT FROM m.payload_hash OR r.approval_hash IS DISTINCT FROM m.approval_hash OR r.message_id IS DISTINCT FROM m.message_id OR r.candidate_version IS DISTINCT FROM m.candidate_version THEN RAISE EXCEPTION 'incident row changed';END IF;
 IF EXISTS(SELECT 1 FROM public.sanji_youtube_manual_ledger WHERE owner=p_owner AND batch_id=m.batch_id AND id<>r.id AND state NOT IN ('accepted','cancelled','reserved')) THEN RAISE EXCEPTION 'other unresolved row';END IF;
 IF EXISTS(SELECT 1 FROM public.sanji_youtube_manual_ledger WHERE owner=p_owner AND id<>r.id AND state<>'cancelled' AND (channel=r.channel OR email_key=r.email_key)) THEN RAISE EXCEPTION 'duplicate or pending recipient';END IF;
 SELECT * INTO c FROM public.sanji_records WHERE owner=p_owner AND id=r.candidate_id AND kind='candidate' FOR UPDATE NOWAIT;
 IF NOT FOUND OR c.version IS DISTINCT FROM r.candidate_version OR coalesce(c.data->>'status','') IN ('거절','수신 거부','상대방 거절','우리 측 거절','제외') OR public.sanji_blocked(p_owner,c.data) IS DISTINCT FROM false OR public.sanji_youtube_manual_refused(p_owner,r.email_key,r.candidate_id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'recipient blocked or changed';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(b.review->'entries') e WHERE e->>'id'=r.candidate_id::text AND e->>'channel'=r.channel AND e->>'email'=r.email AND (e->>'version')::integer=r.candidate_version)<>1 THEN RAISE EXCEPTION 'approved recipient changed';END IF;
 -- Reject duplicate channel and cross-channel email identities in current candidate records.
 IF EXISTS(SELECT 1 FROM public.sanji_records x WHERE x.owner=p_owner AND x.kind='candidate' AND x.id<>c.id AND x.data->>'channels'='YouTube' AND
  (regexp_replace(coalesce(x.data->>'profile',''),'/$','')=regexp_replace(coalesce(c.data->>'profile',''),'/$','') OR
   public.sanji_youtube_manual_email_key(x.data#>>'{contact,email}')=r.email_key OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.data#>'{youtubeResearch,businessContacts}')='array' THEN x.data#>'{youtubeResearch,businessContacts}' ELSE '[]'::jsonb END) e WHERE public.sanji_youtube_manual_email_key(e->>'email')=r.email_key))) THEN RAISE EXCEPTION 'recipient identity ambiguous';END IF;
 t:=clock_timestamp();
 IF m.valid_until<=t OR b.expires_at<=t THEN RAISE EXCEPTION 'recovery evidence or approval expired during checks'; END IF;
 -- All existing payload reconstruction, recheck and consume protections run again at actual dispatch.
 UPDATE public.sanji_youtube_manual_ledger SET state='reserved',refusal_checked_at=NULL,updated_at=t WHERE id=r.id AND owner=p_owner AND state='held' AND updated_at=m.expected_ledger_updated_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'ledger CAS conflict';END IF;
 UPDATE public.sanji_youtube_manual_schedule SET state='scheduled',claim_token=NULL,updated_at=t WHERE owner=p_owner AND batch_id=m.batch_id AND state='held' AND updated_at=m.expected_schedule_updated_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'schedule CAS conflict';END IF;
 result:=jsonb_build_object('incidentId',m.incident_id,'ledgerId',r.id,'batchId',r.batch_id,'state','reserved','scheduleState','scheduled','recoveredAt',t);
 INSERT INTO public.sanji_youtube_held_recovery_audit VALUES(m.incident_id,p_owner,r.id,r.batch_id,t,r.updated_at,s.updated_at,r.payload_hash,r.approval_hash,m.evidence_sha256,m.executor_receipt_sha256,result);
 RETURN result;
END $body$;
REVOKE ALL ON FUNCTION public.sanji_youtube_manual_recover_incident(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sanji_youtube_manual_recover_incident(uuid,uuid) TO service_role;
COMMIT;
