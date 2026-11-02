-- Provider-observed counterpart identities, separate from messages and account connections.
begin;
create table public.sanji_instagram_peer_profiles (
 owner uuid not null references auth.users(id),
 account_id text not null check (account_id ~ '^[0-9]+$'),
 peer_id text not null check (peer_id ~ '^[0-9]+$' and peer_id<>account_id),
 username text check (username is null or (username ~ '^[A-Za-z0-9._]{1,30}$' and username not in ('.','..'))),
 username_observed_at timestamptz,
 display_name text check (display_name is null or (length(display_name) between 1 and 100 and length(btrim(display_name))>0 and display_name !~ '[[:cntrl:]]')),
 display_name_observed_at timestamptz,
 primary key(owner,account_id,peer_id),
 check(username is not null or display_name is not null)
);
alter table public.sanji_instagram_peer_profiles enable row level security;
revoke all on public.sanji_instagram_peer_profiles from public, anon, authenticated, service_role;
grant select on public.sanji_instagram_peer_profiles to service_role;
create function public.sanji_instagram_observe_peer(p_owner uuid,p_account text,p_peer text,p_mid text,p_username text,p_name text,p_observed_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'apiVerified'='true'::jsonb and c.summary->'connected'='true'::jsonb) then raise exception 'account mismatch'; end if;
 if p_peer !~ '^[0-9]+$' or p_peer=p_account or p_observed_at is null or p_observed_at>now()+interval '5 minutes' or p_observed_at<now()-interval '1 day' then return false; end if;
 if p_username is not null and (p_username !~ '^[A-Za-z0-9._]{1,30}$' or p_username in ('.','..') or lower(p_username)='valu_est') then return false; end if;
 if p_name is not null and (length(p_name) not between 1 and 100 or length(btrim(p_name))=0 or p_name ~ '[[:cntrl:]]') then return false; end if;
 if p_username is null and p_name is null then return false; end if;
 if not exists(select 1 from public.sanji_instagram_inbound i where i.owner=p_owner and i.account_id=p_account and i.peer_id=p_peer and i.message_id=p_mid) then return false; end if;
 insert into public.sanji_instagram_peer_profiles(owner,account_id,peer_id,username,username_observed_at,display_name,display_name_observed_at)
 values(p_owner,p_account,p_peer,p_username,case when p_username is not null then p_observed_at end,p_name,case when p_name is not null then p_observed_at end)
 on conflict(owner,account_id,peer_id) do update set
 username=case when excluded.username_observed_at is not null and (sanji_instagram_peer_profiles.username_observed_at is null or excluded.username_observed_at>sanji_instagram_peer_profiles.username_observed_at) then excluded.username else sanji_instagram_peer_profiles.username end,
 username_observed_at=case when excluded.username_observed_at is not null and (sanji_instagram_peer_profiles.username_observed_at is null or excluded.username_observed_at>sanji_instagram_peer_profiles.username_observed_at) then excluded.username_observed_at else sanji_instagram_peer_profiles.username_observed_at end,
 display_name=case when excluded.display_name_observed_at is not null and (sanji_instagram_peer_profiles.display_name_observed_at is null or excluded.display_name_observed_at>sanji_instagram_peer_profiles.display_name_observed_at) then excluded.display_name else sanji_instagram_peer_profiles.display_name end,
 display_name_observed_at=case when excluded.display_name_observed_at is not null and (sanji_instagram_peer_profiles.display_name_observed_at is null or excluded.display_name_observed_at>sanji_instagram_peer_profiles.display_name_observed_at) then excluded.display_name_observed_at else sanji_instagram_peer_profiles.display_name_observed_at end
 where (excluded.username_observed_at is not null and (sanji_instagram_peer_profiles.username_observed_at is null or excluded.username_observed_at>sanji_instagram_peer_profiles.username_observed_at)) or (excluded.display_name_observed_at is not null and (sanji_instagram_peer_profiles.display_name_observed_at is null or excluded.display_name_observed_at>sanji_instagram_peer_profiles.display_name_observed_at));
 get diagnostics n=row_count;return n=1;
end $$;
revoke all on function public.sanji_instagram_observe_peer(uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.sanji_instagram_observe_peer(uuid,text,text,text,text,text,timestamptz) to service_role;
commit;
