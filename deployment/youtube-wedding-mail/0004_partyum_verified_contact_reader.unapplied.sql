-- Explicit approval required: narrow, read-only service-role EXECUTE. No table grants changed.
begin;
create function sanji_partyum_internal.read_partyum_verified_contacts(
 p_project text,p_owner uuid,p_day date,p_channel_ids text[]
)
returns table (
 channel_id text,email text,source_kind text,source_url text,
 verified_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
 affiliation_status text, affiliation_source_url text, affiliation_checked_at timestamptz
)
language plpgsql stable security definer set search_path=''
as $$
declare
 ts timestamptz := pg_catalog.statement_timestamp();
begin
 if p_project is distinct from 'private-wedding-research' or p_owner is null or p_day is null
   or not pg_catalog.isfinite(p_day) or p_day < date '2005-01-01' or p_day > (ts at time zone 'Asia/Seoul')::date
   or pg_catalog.cardinality(p_channel_ids) is null or pg_catalog.cardinality(p_channel_ids) not between 1 and 100
   or exists(select 1 from pg_catalog.unnest(p_channel_ids) as x(id) where x.id is null or x.id !~ '^UC[A-Za-z0-9_-]{22}$')
   or (select count(distinct x.id) from pg_catalog.unnest(p_channel_ids) as x(id)) <> pg_catalog.cardinality(p_channel_ids)
   or not exists(select 1 from sanji_partyum_internal.partyum_runtime_controls c where c.project_id=p_project and c.send_enabled)
   or not exists(select 1 from public.sanji_members m where m.user_id=p_owner)
   or not exists(select 1 from public.sanji_private_wedding_projects p where p.owner=p_owner)
   or not exists(select 1 from sanji_partyum_internal.copy_attestations a where a.owner=p_owner)
   or (select count(*) from public.sanji_private_wedding_shortlist s
        where s.owner=p_owner and s.project_day=p_day and s.channel_id=any(p_channel_ids)) <> pg_catalog.cardinality(p_channel_ids)
 then
  raise exception using errcode='42501',message='Partyum contact scope unavailable';
 end if;

 return query
 select c.channel_id,c.email,c.source_kind,c.source_url,c.verified_at,c.expires_at,c.revoked_at,
        c.affiliation_status,c.affiliation_source_url,c.affiliation_checked_at
   from public.sanji_private_wedding_contacts c
   join public.sanji_private_wedding_shortlist s on s.owner=c.owner and s.channel_id=c.channel_id
  where c.owner=p_owner and s.project_day=p_day and c.channel_id=any(p_channel_ids)
    and c.revoked_at is null and c.verified_at<=ts and c.affiliation_checked_at<=ts and c.expires_at>ts
    and c.affiliation_status='reviewed_no_agency_found'
    and c.source_kind in ('official_channel','official_website','official_video')
  order by c.channel_id;
end;
$$;
revoke all on function sanji_partyum_internal.read_partyum_verified_contacts(text,uuid,date,text[]) from public,anon,authenticated,service_role;
grant execute on function sanji_partyum_internal.read_partyum_verified_contacts(text,uuid,date,text[]) to service_role;
commit;
