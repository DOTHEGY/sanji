begin;
create table public.sanji_instagram_inbound (
 owner uuid not null references auth.users(id), account_id text not null, peer_id text not null,
 message_id text not null, received_at timestamptz not null, body text not null,
 created_at timestamptz not null default now(), primary key(owner,account_id,message_id),
 check(account_id ~ '^[0-9]+$' and peer_id ~ '^[0-9]+$' and account_id<>peer_id),
 check(length(message_id) between 1 and 500 and length(body) between 1 and 10000)
);
create table public.sanji_instagram_reply_attempts (
 owner uuid not null references auth.users(id), account_id text not null, peer_id text not null,
 inbound_id text not null, request_id uuid not null, body text not null,
 status text not null check(status in ('pending','accepted','outcome_unknown')),
 provider_message_id text, created_at timestamptz not null default now(),
 primary key(owner,request_id), unique(owner,account_id,inbound_id),
 foreign key(owner,account_id,inbound_id) references public.sanji_instagram_inbound(owner,account_id,message_id)
);
alter table public.sanji_instagram_inbound enable row level security;
alter table public.sanji_instagram_reply_attempts enable row level security;
revoke all on public.sanji_instagram_inbound,public.sanji_instagram_reply_attempts from public,anon,authenticated;
grant select on public.sanji_instagram_inbound to service_role;
grant select on public.sanji_instagram_reply_attempts to service_role;
create function public.sanji_instagram_capture(p_owner uuid,p_account text,p_peer text,p_mid text,p_at timestamptz,p_body text) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'apiVerified'='true'::jsonb and c.summary->'connected'='true'::jsonb) then raise exception 'account mismatch'; end if;
 if p_at is null or p_at>clock_timestamp()+interval '5 minutes' or p_at<clock_timestamp()-interval '90 days' then raise exception 'invalid timestamp'; end if;
 insert into public.sanji_instagram_inbound(owner,account_id,peer_id,message_id,received_at,body) values(p_owner,p_account,p_peer,p_mid,p_at,p_body) on conflict do nothing;
 get diagnostics n=row_count;return n=1;
end $$;
create function public.sanji_instagram_reserve_reply(p_owner uuid,p_account text,p_mid text,p_request uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.sanji_instagram_inbound; old public.sanji_instagram_reply_attempts;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_account,729));
 select * into old from public.sanji_instagram_reply_attempts where owner=p_owner and (request_id=p_request or (account_id=p_account and inbound_id=p_mid)) limit 1;
 if found then return jsonb_build_object('reserved',false,'status',old.status,'sameRequest',old.request_id=p_request and old.account_id=p_account and old.inbound_id=p_mid and old.body=p_body);end if;
 if not exists(select 1 from public.sanji_connections c where c.owner=p_owner and c.provider='instagram:'||p_account and c.summary->>'accountId'=p_account and lower(c.summary->>'username')='valu_est' and c.summary->'apiVerified'='true'::jsonb and c.summary->'connected'='true'::jsonb) then raise exception 'account mismatch';end if;
 select * into m from public.sanji_instagram_inbound where owner=p_owner and account_id=p_account and message_id=p_mid for update;
 if not found or m.received_at>clock_timestamp() or m.received_at<=clock_timestamp()-interval '24 hours' or coalesce(length(trim(p_body)),0)=0 or length(p_body)>1000 then raise exception 'reply not eligible';end if;
 if exists(select 1 from public.sanji_instagram_reply_attempts a where a.owner=p_owner and a.account_id=p_account and a.peer_id=m.peer_id and a.status in ('pending','outcome_unknown')) then raise exception 'previous outcome unknown';end if;
 insert into public.sanji_instagram_reply_attempts(owner,account_id,peer_id,inbound_id,request_id,body,status) values(p_owner,p_account,m.peer_id,p_mid,p_request,p_body,'pending');
 return jsonb_build_object('reserved',true,'peerId',m.peer_id);
end $$;
create function public.sanji_instagram_finish_reply(p_owner uuid,p_request uuid,p_status text,p_provider_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('accepted','outcome_unknown') then raise exception 'invalid status';end if;
 update public.sanji_instagram_reply_attempts set status=p_status,provider_message_id=case when p_status='accepted' then p_provider_id else null end where owner=p_owner and request_id=p_request and status='pending';
end $$;
revoke all on function public.sanji_instagram_capture(uuid,text,text,text,timestamptz,text),public.sanji_instagram_reserve_reply(uuid,text,text,uuid,text),public.sanji_instagram_finish_reply(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sanji_instagram_capture(uuid,text,text,text,timestamptz,text),public.sanji_instagram_reserve_reply(uuid,text,text,uuid,text),public.sanji_instagram_finish_reply(uuid,uuid,text,text) to service_role;
commit;
