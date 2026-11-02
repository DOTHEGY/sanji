-- Review-only additive ACL tightening. Apply only after checking existing objects and grants.
begin;
revoke all on public.sanji_instagram_inbound, public.sanji_instagram_reply_attempts from public, anon, authenticated, service_role;
grant select on public.sanji_instagram_inbound, public.sanji_instagram_reply_attempts to service_role;
revoke all on function public.sanji_instagram_capture(uuid,text,text,text,timestamptz,text), public.sanji_instagram_reserve_reply(uuid,text,text,uuid,text), public.sanji_instagram_finish_reply(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.sanji_instagram_capture(uuid,text,text,text,timestamptz,text), public.sanji_instagram_reserve_reply(uuid,text,text,uuid,text), public.sanji_instagram_finish_reply(uuid,uuid,text,text) to service_role;
commit;
