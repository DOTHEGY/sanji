-- Applied through the Supabase migration service after explicit user approval.
-- Preserve the existing function owner, grants, security mode and search path.
-- Refuse to replace a function changed since the read-only diagnostic.
do $tracking_patch$
declare definition text;
begin
 select pg_get_functiondef('public.sanji_email_tracking_report(uuid,timestamptz,timestamptz,uuid,boolean,uuid)'::regprocedure) into definition;
 if position('with report_threads as materialized' in definition)>0 then return;end if;
 if md5(definition)<>'cb23686fb2821a9306c9cfc0d10f9601' then
  raise exception 'Tracking report changed after review; inspect the current definition before applying';
 end if;
 definition:=replace(definition,$old$ with rows as ($old$,$new$ with report_threads as materialized (
  select owner,data,data->>'target' report_target,data->>'channel' report_channel
  from public.sanji_records
  where owner=p_owner and kind='thread' and data->>'channel' in('email','sms','phone','manual')
 ), rows as ($new$);
 definition:=replace(definition,$old$from public.sanji_records r where r.owner=o.owner and r.kind='thread' and r.data->>'channel' in('email','sms','phone','manual') and r.data->>'target'=o.target::text$old$,$new$from report_threads r where r.owner=o.owner and r.report_target=o.target::text$new$);
 execute definition;
end $tracking_patch$;

