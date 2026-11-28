-- Development first; apply before publishing the custom-date Edge entrypoint.
begin;
alter table sanji_partyum_internal.batches
  drop constraint batches_mode_check,
  add constraint batches_mode_check check (mode in ('now','tomorrow','scheduled'));
commit;
