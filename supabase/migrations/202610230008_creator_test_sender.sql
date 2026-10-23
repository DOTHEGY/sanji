begin;
alter table public.sanji_creator_config add column if not exists server_test_sender text;
do $$ declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='sanji_creator_server_test_claim' and pronamespace='public'::regnamespace;
 if definition is null then raise exception 'Apply creator_server_test migration first';end if;
 definition=replace(definition,'p_sender<>''valu_est''','c.server_test_sender is distinct from p_sender');
 execute definition;
end $$;
commit;
