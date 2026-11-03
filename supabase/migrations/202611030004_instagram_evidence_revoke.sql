-- Candidate only: preserve original evidence and record a reversible visibility change.
begin;
alter table public.sanji_tagby_sent_evidence add column revoked_at timestamptz, add column revoked_by uuid references auth.users(id), add column revocation_reason text check(revocation_reason in ('wrong_source','wrong_identity','other'));
alter table public.sanji_instagram_public_research add column revoked_at timestamptz, add column revoked_by uuid references auth.users(id), add column revocation_reason text check(revocation_reason in ('wrong_source','wrong_identity','other'));
create function public.sanji_instagram_evidence_revoke(p_owner uuid,p_account text,p_kind text,p_key jsonb,p_reason text) returns text
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or coalesce(p_account,'') !~ '^[0-9]{1,100}$' or p_reason is null or p_reason not in ('wrong_source','wrong_identity','other') or jsonb_typeof(p_key) is distinct from 'object' or not exists(select 1 from public.sanji_connections where owner=p_owner and provider='instagram:'||p_account and summary->>'accountId'=p_account and lower(summary->>'username')='valu_est' and summary->'connected'='true'::jsonb and summary->'apiVerified'='true'::jsonb) then raise exception 'invalid evidence request';end if;
 if p_kind='tagby' then
  if (select count(*) from jsonb_object_keys(p_key))<>5 or coalesce(p_key->>'peer_id','') !~ '^[0-9]{1,100}$' or coalesce(p_key->>'handle','') !~ '^[a-z0-9._]{1,30}$' or coalesce(p_key->>'campaign_id','') !~ '^[0-9]{1,12}$' or coalesce(p_key->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_key->>'sheet_row','') !~ '^[1-9][0-9]{0,6}$' then raise exception 'invalid evidence key';end if;
  update public.sanji_tagby_sent_evidence set revoked_at=now(),revoked_by=p_owner,revocation_reason=p_reason where owner=p_owner and account_id=p_account and peer_id=p_key->>'peer_id' and handle=p_key->>'handle' and campaign_id=(p_key->>'campaign_id')::bigint and evidence_sha256=p_key->>'evidence_sha256' and sheet_row=(p_key->>'sheet_row')::integer and revoked_at is null;
 elsif p_kind='research' then
  if (select count(*) from jsonb_object_keys(p_key))<>3 or coalesce(p_key->>'peer_id','') !~ '^[0-9]{1,100}$' or coalesce(p_key->>'capture_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_key->>'observed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'invalid evidence key';end if;
  update public.sanji_instagram_public_research set revoked_at=now(),revoked_by=p_owner,revocation_reason=p_reason where owner=p_owner and account_id=p_account and peer_id=p_key->>'peer_id' and capture_sha256=p_key->>'capture_sha256' and observed_at=(p_key->>'observed_at')::timestamptz and revoked_at is null;
 else raise exception 'invalid evidence kind'; end if;
 get diagnostics affected=row_count;
 return case when affected=1 then 'revoked' else 'not_found_or_already_revoked' end;
end $$;
revoke all on function public.sanji_instagram_evidence_revoke(uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_instagram_evidence_revoke(uuid,text,text,jsonb,text) to service_role;
create or replace function public.sanji_tagby_evidence_for_peers(p_owner uuid,p_account text,p_peers text[]) returns table(peer_id text,handle text)
language sql stable security definer set search_path='' as $$
 select distinct p.peer_id,lower(p.username) from public.sanji_instagram_peer_profiles p
 join public.sanji_tagby_sent_evidence e on e.owner=p.owner and e.account_id=p.account_id and e.peer_id=p.peer_id and e.handle=lower(p.username)
 where e.revoked_at is null and p.owner=p_owner and p.account_id=p_account and p.peer_id=any(p_peers) and cardinality(p_peers)<=500
 and p.username_observed_at<=now()+interval '5 minutes' and p.username_observed_at>=now()-interval '7 days'
 and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
 and exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb)
 and exists(select 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p.peer_id)
 and (select count(*) from public.sanji_creator_recovery x where x.owner=p_owner and lower(x.handle)=lower(p.username))=1
 and exists(select 1 from public.sanji_creator_recovery x join public.sanji_creator_recommendations y on y.owner=x.owner and y.creator_id=x.id where x.owner=p_owner and lower(x.handle)=lower(p.username));
$$;
revoke all on function public.sanji_tagby_evidence_for_peers(uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.sanji_tagby_evidence_for_peers(uuid,text,text[]) to service_role;
commit;
