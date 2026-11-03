-- Candidate only. A submitted row is an operator attestation of an inspected
-- provider export; its hash is provenance, not a provider signature.
begin;
create table public.sanji_tagby_sent_evidence (
 owner uuid not null references auth.users(id), account_id text not null, peer_id text not null, handle text not null,
 campaign_id bigint not null, campaign_url text not null, sheet text not null, evidence_sha256 text not null, sheet_row integer not null,
 sent_at_display text not null, observed_at timestamptz not null, attested_at timestamptz not null default now(),
 primary key(owner,account_id,handle,campaign_id,evidence_sha256,sheet_row)
);
alter table public.sanji_tagby_sent_evidence enable row level security;
revoke all on public.sanji_tagby_sent_evidence from public,anon,authenticated,service_role;
grant select on public.sanji_tagby_sent_evidence to service_role;
create function public.sanji_tagby_evidence_import(p_owner uuid,p_account text,p_rows jsonb,p_attested boolean) returns integer
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
  if peer_count<>1 then raise exception 'current received peer not verified';end if;
  insert into public.sanji_tagby_sent_evidence(owner,account_id,peer_id,handle,campaign_id,campaign_url,sheet,evidence_sha256,sheet_row,sent_at_display,observed_at) values(p_owner,p_account,matched_peer,h,c,r->>'campaign_url',r->>'sheet',r->>'evidence_sha256',(r->>'sheet_row')::int,r->>'sent_at_display',(r->>'observed_at')::timestamptz) on conflict do nothing;
  get diagnostics inserted=row_count; if inserted=0 and not exists(select 1 from public.sanji_tagby_sent_evidence where owner=p_owner and account_id=p_account and peer_id=matched_peer and handle=h and campaign_id=c and evidence_sha256=r->>'evidence_sha256' and sheet_row=(r->>'sheet_row')::int and sent_at_display=r->>'sent_at_display') then raise exception 'evidence collision'; end if; n:=n+inserted;
 end loop;
 return n;
end $$;
create function public.sanji_tagby_evidence_for_peers(p_owner uuid,p_account text,p_peers text[]) returns table(peer_id text,handle text)
language sql stable security definer set search_path='' as $$
 select distinct p.peer_id,lower(p.username) from public.sanji_instagram_peer_profiles p
 join public.sanji_tagby_sent_evidence e on e.owner=p.owner and e.account_id=p.account_id and e.peer_id=p.peer_id and e.handle=lower(p.username)
 where p.owner=p_owner and p.account_id=p_account and p.peer_id=any(p_peers) and cardinality(p_peers)<=500
 and p.username_observed_at<=now()+interval '5 minutes' and p.username_observed_at>=now()-interval '7 days'
 and exists(select 1 from public.sanji_members m where m.user_id=p_owner)
 and exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'connected'='true'::jsonb and c.summary->'apiVerified'='true'::jsonb)
 and exists(select 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p.peer_id)
 and (select count(*) from public.sanji_creator_recovery x where x.owner=p_owner and lower(x.handle)=lower(p.username))=1
 and exists(select 1 from public.sanji_creator_recovery x join public.sanji_creator_recommendations y on y.owner=x.owner and y.creator_id=x.id where x.owner=p_owner and lower(x.handle)=lower(p.username));
$$;
revoke all on function public.sanji_tagby_evidence_import(uuid,text,jsonb,boolean),public.sanji_tagby_evidence_for_peers(uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.sanji_tagby_evidence_import(uuid,text,jsonb,boolean),public.sanji_tagby_evidence_for_peers(uuid,text,text[]) to service_role;
commit;
