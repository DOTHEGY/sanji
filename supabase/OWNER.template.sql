-- Run after creating your admin in Authentication > Users. Replace the email.
insert into public.sanji_members(user_id)
select id from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL')
on conflict(user_id) do nothing;
-- Must show one administrator. Empty output means the Auth user is not yet created.
select u.email from auth.users u join public.sanji_members m on m.user_id=u.id;
