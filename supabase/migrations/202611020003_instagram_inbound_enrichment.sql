-- Additive record of later provider-confirmed text; the original inbound row is never updated.
begin;
create table public.sanji_instagram_inbound_enrichment (
 owner uuid not null,
 account_id text not null,
 message_id text not null,
 body text not null check (length(body) between 1 and 10000 and length(btrim(body)) > 0 and body <> '본문 없음 또는 조회 불가 · Instagram에서 확인 필요'),
 observed_at timestamptz not null default now(),
 primary key(owner,account_id,message_id),
 foreign key(owner,account_id,message_id) references public.sanji_instagram_inbound(owner,account_id,message_id)
);
alter table public.sanji_instagram_inbound_enrichment enable row level security;
revoke all on public.sanji_instagram_inbound_enrichment from public, anon, authenticated, service_role;
grant select on public.sanji_instagram_inbound_enrichment to service_role;
create function public.sanji_instagram_enrich_inbound(p_owner uuid,p_account text,p_peer text,p_mid text,p_at timestamptz,p_body text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'apiVerified'='true'::jsonb and c.summary->'connected'='true'::jsonb) then raise exception 'account mismatch'; end if;
 if p_body is null or length(p_body) not between 1 and 10000 or length(btrim(p_body))=0 or p_body='본문 없음 또는 조회 불가 · Instagram에서 확인 필요' then return false; end if;
 perform 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p_peer and i.message_id=p_mid and i.received_at=p_at and i.body='본문 없음 또는 조회 불가 · Instagram에서 확인 필요' for update;
 if not found then return false; end if;
 insert into public.sanji_instagram_inbound_enrichment(owner,account_id,message_id,body) values(p_owner,p_account,p_mid,p_body) on conflict do nothing;
 get diagnostics n=row_count;return n=1;
end $$;
revoke all on function public.sanji_instagram_enrich_inbound(uuid,text,text,text,timestamptz,text) from public, anon, authenticated, service_role;
grant execute on function public.sanji_instagram_enrich_inbound(uuid,text,text,text,timestamptz,text) to service_role;
commit;
