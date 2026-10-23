begin;
create or replace function public.sanji_template_refresh_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='template' and new.data->>'channel'='이메일' and coalesce(new.data->>'purpose','') not in ('brand_reply','creator_proposal') then perform public.sanji_refresh_template_leads(new.id);end if;return new;
end $$;
commit;
