-- Candidate only: operator-attested handle may precede the first incoming message.
begin;
alter table public.sanji_tagby_sent_evidence alter column peer_id drop not null;
create or replace function public.sanji_tagby_evidence_import(p_owner uuid,p_account text,p_rows jsonb,p_attested boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare r jsonb; h text; c bigint; n integer:=0; inserted integer; peer_count integer; matched_peer text;
begin
 if p_attested is distinct from true or not exists(select 1 from public.sanji_members where user_id=p_owner) or p_account !~ '^[0-9]{1,100}$' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 or not exists(select 1 from public.sanji_connections where owner=p_owner and provider='instagram:'||p_account and summary->>'accountId'=p_account and lower(summary->>'username')='valu_est' and summary->'connected'='true'::jsonb and summary->'apiVerified'='true'::jsonb) then raise exception 'invalid evidence request';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>10 then raise exception 'invalid evidence row';end if;
  h:=lower(r->>'handle');
  if h !~ '^[a-z0-9._]{1,30}$' or h in ('.','..','valu_est') or r->>'sender' is distinct from 'valu_est' or r->>'provider_status' is distinct from 'SUCCESS' or coalesce(r->>'campaign_id','') !~ '^[0-9]{1,12}$' or coalesce(r->>'sheet_row','') !~ '^[1-9][0-9]{0,6}$' or coalesce(r->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(r->>'sent_at_display','') !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\. (오전|오후) [0-9]{1,2}:[0-9]{2}$' or r->>'sent_at_display' ~ '[[:cntrl:]]' or coalesce(r->>'observed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'invalid evidence row';end if;
  if (r->>'observed_at')::timestamptz>now()+interval '5 minutes' or (r->>'observed_at')::timestamptz<'2000-01-01'::timestamptz then raise exception 'invalid evidence observation'; end if;
  c:=(r->>'campaign_id')::bigint;
  if r->>'campaign_url' is distinct from 'https://tagby.io/tools/instagram/dm/'||c::text or r->>'sheet' is distinct from '발송 내역' then raise exception 'invalid provider source';end if;
  if (select count(*) from public.sanji_creator_recovery x where x.owner=p_owner and lower(x.handle)=h)<>1 or not exists(select 1 from public.sanji_creator_recovery x join public.sanji_creator_recommendations y on y.owner=x.owner and y.creator_id=x.id where x.owner=p_owner and lower(x.handle)=h) then raise exception 'recommendation not verified';end if;
  select count(distinct p.peer_id),min(p.peer_id) into peer_count,matched_peer from public.sanji_instagram_peer_profiles p where p.owner=p_owner and p.account_id=p_account and lower(p.username)=h and p.username_observed_at between now()-interval '7 days' and now()+interval '5 minutes' and exists(select 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p.peer_id);
  if peer_count>1 then raise exception 'ambiguous received peer';end if;
  insert into public.sanji_tagby_sent_evidence(owner,account_id,peer_id,handle,campaign_id,campaign_url,sheet,evidence_sha256,sheet_row,sender,provider_status,attested_by,sent_at_display,observed_at) values(p_owner,p_account,matched_peer,h,c,r->>'campaign_url',r->>'sheet',r->>'evidence_sha256',(r->>'sheet_row')::int,'valu_est','SUCCESS',p_owner,r->>'sent_at_display',(r->>'observed_at')::timestamptz) on conflict do nothing;
  get diagnostics inserted=row_count; if inserted=0 and not exists(select 1 from public.sanji_tagby_sent_evidence where owner=p_owner and account_id=p_account and peer_id is not distinct from matched_peer and handle=h and campaign_id=c and evidence_sha256=r->>'evidence_sha256' and sheet_row=(r->>'sheet_row')::int and sent_at_display=r->>'sent_at_display') then raise exception 'evidence collision'; end if; n:=n+inserted;
 end loop;
 return n;
end $$;
create or replace function public.sanji_instagram_evidence_revoke(p_owner uuid,p_account text,p_kind text,p_key jsonb,p_reason text) returns text
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not exists(select 1 from public.sanji_members where user_id=p_owner) or coalesce(p_account,'') !~ '^[0-9]{1,100}$' or p_reason is null or p_reason not in ('wrong_source','wrong_identity','other') or jsonb_typeof(p_key) is distinct from 'object' or not exists(select 1 from public.sanji_connections where owner=p_owner and provider='instagram:'||p_account and summary->>'accountId'=p_account and lower(summary->>'username')='valu_est' and summary->'connected'='true'::jsonb and summary->'apiVerified'='true'::jsonb) then raise exception 'invalid evidence request';end if;
 if p_kind='tagby' then
  if (select count(*) from jsonb_object_keys(p_key))<>5 or (not (p_key ? 'peer_id') or (p_key->>'peer_id' is not null and p_key->>'peer_id' !~ '^[0-9]{1,100}$')) or coalesce(p_key->>'handle','') !~ '^[a-z0-9._]{1,30}$' or coalesce(p_key->>'campaign_id','') !~ '^[0-9]{1,12}$' or coalesce(p_key->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_key->>'sheet_row','') !~ '^[1-9][0-9]{0,6}$' then raise exception 'invalid evidence key';end if;
  update public.sanji_tagby_sent_evidence set revoked_at=now(),revoked_by=p_owner,revocation_reason=p_reason where owner=p_owner and account_id=p_account and peer_id is not distinct from p_key->>'peer_id' and handle=p_key->>'handle' and campaign_id=(p_key->>'campaign_id')::bigint and evidence_sha256=p_key->>'evidence_sha256' and sheet_row=(p_key->>'sheet_row')::integer and revoked_at is null;
 elsif p_kind='research' then
  if (select count(*) from jsonb_object_keys(p_key))<>3 or coalesce(p_key->>'peer_id','') !~ '^[0-9]{1,100}$' or coalesce(p_key->>'capture_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_key->>'observed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'invalid evidence key';end if;
  update public.sanji_instagram_public_research set revoked_at=now(),revoked_by=p_owner,revocation_reason=p_reason where owner=p_owner and account_id=p_account and peer_id=p_key->>'peer_id' and capture_sha256=p_key->>'capture_sha256' and observed_at=(p_key->>'observed_at')::timestamptz and revoked_at is null;
 else raise exception 'invalid evidence kind'; end if;
 get diagnostics affected=row_count;
 return case when affected=1 then 'revoked' else 'not_found_or_already_revoked' end;
end $$;
create function public.sanji_tagby_bootstrap_allowed(p_owner uuid,p_account text,p_peer text,p_handle text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_peer,'') ~ '^[0-9]{1,100}$' and coalesce(p_handle,'') ~ '^[a-z0-9._]{1,30}$' and p_handle not in ('.','..','valu_est')
 and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
 and exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb)
 and (select count(*) from public.sanji_creator_recovery x where x.owner=p_owner and lower(x.handle)=p_handle)=1
 and exists(select 1 from public.sanji_creator_recovery x join public.sanji_creator_recommendations y on y.owner=x.owner and y.creator_id=x.id where x.owner=p_owner and lower(x.handle)=p_handle)
 and exists(select 1 from public.sanji_tagby_sent_evidence e where e.owner=p_owner and e.account_id=p_account and e.handle=p_handle and e.revoked_at is null and (e.peer_id is null or e.peer_id=p_peer))
 and not exists(select 1 from public.sanji_instagram_peer_profiles p where p.owner=p_owner and p.account_id=p_account and ((lower(p.username)=p_handle and p.peer_id<>p_peer) or (p.peer_id=p_peer and lower(p.username)<>p_handle)) and p.username_observed_at between now()-interval '7 days' and now()+interval '5 minutes');
$$;
create function public.sanji_tagby_bind_peer(p_owner uuid,p_account text,p_peer text,p_handle text) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if not public.sanji_tagby_bootstrap_allowed(p_owner,p_account,p_peer,p_handle) or not exists(select 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p_peer) or not exists(select 1 from public.sanji_instagram_peer_profiles p where p.owner=p_owner and p.account_id=p_account and p.peer_id=p_peer and lower(p.username)=p_handle and p.username_observed_at between now()-interval '7 days' and now()+interval '5 minutes') then return 0;end if;
 update public.sanji_tagby_sent_evidence set peer_id=p_peer where owner=p_owner and account_id=p_account and handle=p_handle and peer_id is null and revoked_at is null;get diagnostics n=row_count;return n;
end $$;
revoke all on function public.sanji_tagby_bootstrap_allowed(uuid,text,text,text),public.sanji_tagby_bind_peer(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sanji_tagby_bootstrap_allowed(uuid,text,text,text),public.sanji_tagby_bind_peer(uuid,text,text,text) to service_role;
commit;
