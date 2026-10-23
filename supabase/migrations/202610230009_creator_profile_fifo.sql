begin;
do $$ declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='sanji_claim_local_creator' and pronamespace='public'::regnamespace;
 if definition is null then raise exception 'Apply creator local migrations first';end if;
 definition=replace(definition,'order by checked desc for update skip locked limit 1;', 'order by (profile_preview->>''checked'' is not null), checked asc for update skip locked limit 1;');
 execute definition;
end $$;
commit;
