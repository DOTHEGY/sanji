-- Temporary, exact-scope manual trigger. Existing scheduled claims are unchanged.
create or replace function public.sanji_youtube_manual_claim_approved_20261112()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  approved_owner constant uuid := 'e59d9463-c111-40b2-b267-a0100f8ab05b';
  approved_batch constant uuid := 'f8e70802-9223-487e-adf5-02fdc088301a';
  approved_hash constant text := '6e79abe7c0f21ea6a2e50da3b7e9b990a038504fc9452c4d243c87d88be6a8a4';
  approved_ledger constant text := 'd44690587be25bfbce556da534e06f0b25e9657fb6ac622ec772b4882cc878c0';
  b public.sanji_youtube_manual_batches;
  s public.sanji_youtube_manual_schedule;
  row_count bigint; row_hash text; t uuid;
begin
  if clock_timestamp() >= timestamptz '2026-11-12T09:00:00Z' then raise exception 'manual authorization expired';end if;
  select * into b from public.sanji_youtube_manual_batches where owner=approved_owner and id=approved_batch for update nowait;
  if not found or b.approval_hash is distinct from approved_hash or b.confirmed_by is distinct from approved_owner or b.confirmed_at is null or jsonb_typeof(b.review->'entries') is distinct from 'array' or jsonb_array_length(b.review->'entries')<>54 or not public.sanji_youtube_manual_batch_current(approved_owner,approved_batch) or not exists(select 1 from public.sanji_members where user_id=approved_owner) then raise exception 'approved batch changed';end if;
  select * into s from public.sanji_youtube_manual_schedule where owner=approved_owner and batch_id=approved_batch for update nowait;
  if not found or s.approval_hash is distinct from approved_hash or s.run_at is distinct from timestamptz '2026-11-12T06:00:00Z' or s.run_at>clock_timestamp() or s.state not in ('scheduled','complete') then raise exception 'approved schedule not claimable';end if;
  -- Lock and fingerprint all immutable row identities/content bindings before
  -- changing schedule state. No sending/held/unknown/cancelled row is revived.
  perform 1 from public.sanji_youtube_manual_ledger where owner=approved_owner and batch_id=approved_batch order by id for update nowait;
  select count(*),encode(sha256(convert_to(jsonb_agg(jsonb_build_array(id,owner,batch_id,candidate_id,candidate_version,channel,email,email_key,approval_hash,payload_hash,message_id) order by id)::text,'UTF8')),'hex') into row_count,row_hash from public.sanji_youtube_manual_ledger where owner=approved_owner and batch_id=approved_batch;
  if row_count<>54 or row_hash is distinct from approved_ledger or exists(select 1 from public.sanji_youtube_manual_ledger where owner=approved_owner and batch_id=approved_batch and (state not in ('reserved','accepted') or (state='reserved' and (claim_token is not null or provider_id is not null or provider_thread is not null or outbox_id is not null or thread_id is not null)) or (state='accepted' and (claim_token is not null or coalesce(provider_id,'') !~ '^[A-Za-z0-9_-]{1,200}$' or coalesce(provider_thread,'') !~ '^[A-Za-z0-9_-]{1,200}$' or outbox_id is null or thread_id is null)))) then raise exception 'approved ledger changed or uncertain';end if;
  if s.state='complete' then
    if exists(select 1 from public.sanji_youtube_manual_ledger where owner=approved_owner and batch_id=approved_batch and state<>'accepted') then raise exception 'completion inconsistent';end if;
    return null;
  end if;
  if s.claim_token is not null then raise exception 'claim unavailable';end if;
  if clock_timestamp() >= timestamptz '2026-11-12T09:00:00Z' then raise exception 'manual authorization expired';end if;
  t:=gen_random_uuid();
  update public.sanji_youtube_manual_schedule set state='processing',claim_token=t,updated_at=clock_timestamp() where owner=approved_owner and batch_id=approved_batch and state='scheduled' and claim_token is null;
  if not found then raise exception 'claim unavailable';end if;
  return jsonb_build_object('owner',s.owner,'batchId',s.batch_id,'approvalHash',s.approval_hash,'runAt',s.run_at,'token',t);
end $function$;
revoke all on function public.sanji_youtube_manual_claim_approved_20261112() from public,anon,authenticated;
grant execute on function public.sanji_youtube_manual_claim_approved_20261112() to service_role;
