begin;
do $$ declare definition text;section_start integer;section_end integer;settings_block text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='sanji_save_record' and pronamespace='public'::regnamespace;
 if definition is null then raise exception 'Workspace schema missing';end if;
 if position('p_kind=''settings'' and old.id is not null then v:=old.data||v' in definition)=0 then
  definition=replace(definition,'v:=v-''id''-''version''-''updated''-''history'';', 'if p_kind=''settings'' and old.id is not null then v:=old.data||v;end if; v:=v-''id''-''version''-''updated''-''history'';');
 end if;
 section_start=position('elsif p_kind=''settings'' then' in definition);section_end=position('elsif p_kind=''template'' then' in definition);
 if section_start=0 or section_end<=section_start then raise exception 'Settings save boundaries missing';end if;
 settings_block=substring(definition from section_start for section_end-section_start);
 settings_block=replace(settings_block,'v:=jsonb_build_object','v:=v||jsonb_build_object');
 definition=substring(definition from 1 for section_start-1)||settings_block||substring(definition from section_end);
 execute definition;
end $$;
commit;
