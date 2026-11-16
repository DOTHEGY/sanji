"""No network client, production URLs, secrets, mail, or dependencies.
Talks only to the explicitly supplied ephemeral GitHub Actions postgres container.
"""
import os, pathlib, subprocess, threading, queue, time, uuid, re, json
D=pathlib.Path(__file__).resolve().parent
container=os.environ.get('POSTGRES_TEST_CONTAINER','')
if not re.fullmatch(r'[a-f0-9]{12,64}',container): raise SystemExit('Require ephemeral service container ID')
class Session:
 def __init__(self,name):
  self.p=subprocess.Popen(['docker','exec','-i',container,'psql','-X','-qAt','-U','fixture','-d','held_recovery_test','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  self.q=queue.Queue()
  threading.Thread(target=self._read,daemon=True).start()
  self.run("SET application_name='held-ci-"+name+"'; SET statement_timeout='10s'; SET lock_timeout='5s';")
 def _read(self):
  for line in self.p.stdout:self.q.put(line.rstrip('\n'))
  self.q.put(None)
 def run(self,sql):
  marker='done_'+uuid.uuid4().hex
  self.p.stdin.write(sql+'\n\\echo '+marker+'\n');self.p.stdin.flush();out=[]
  while True:
   line=self.q.get(timeout=15)
   if line is None:raise AssertionError('psql exited: '+'\n'.join(out))
   if line==marker:return '\n'.join(out)
   out.append(line)
 def close(self):
  if self.p.poll() is None:self.p.stdin.write('ROLLBACK;\n\\q\n');self.p.stdin.flush()
  self.p.wait(timeout=5)
A=Session('a');B=Session('b');passed=[]
owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';incident='22222222-2222-4222-8222-222222222222'
call=f"select public.sanji_youtube_manual_recover_incident('{owner}','{incident}');"
claim='select public.sanji_youtube_manual_claim_due();'
try:
 for f in ['schema.sql','held-recovery.live-aux.sql','held-recovery.live-helpers.sql','held-recovery.proposal.sql']:A.run((D/f).read_text())
 assert A.run('select pg_backend_pid();') != B.run('select pg_backend_pid();'), 'independent backends required'
 tables=A.run("select string_agg(quote_ident(tablename),',') from pg_tables where schemaname='public';")
 def reset():
  A.run('TRUNCATE '+tables+' CASCADE;'+(D/'seed.sql').read_text())
 def state():return A.run("select json_build_object('ledger',(select state from sanji_youtube_manual_ledger),'schedule',(select state from sanji_youtube_manual_schedule),'audit',(select count(*) from sanji_youtube_held_recovery_audit),'payload',(select payload_hash from sanji_youtube_manual_ledger),'message',(select message_id from sanji_youtube_manual_ledger));")
 def expected_lock(s,sql):
  # Catch only the expected NOWAIT SQLSTATE. Any unexpected success/error fails CI.
  s.run("DO $test$ BEGIN BEGIN "+sql+" RAISE EXCEPTION 'unexpected lock success'; EXCEPTION WHEN lock_not_available THEN NULL; END; END $test$;")
 def async_run(s,sql):
  result=queue.Queue()
  def go():
   try:result.put((True,s.run(sql)))
   except Exception as e:result.put((False,str(e)))
  threading.Thread(target=go,daemon=True).start();return result
 def wait_blocked():
  deadline=time.monotonic()+4
  while time.monotonic()<deadline:
   if A.run("select count(*) from pg_stat_activity where application_name='held-ci-b' and wait_event_type='Lock';")=='1':return
   time.sleep(.02)
  raise AssertionError('second session did not observably block')
 def finish(q):
  ok,value=q.get(timeout=12)
  assert ok,value
  return value
 # Recovery fence held: claim selects a separate due row then waits before UPDATE/token return.
 reset();A.run("insert into sanji_youtube_manual_schedule values('"+owner+"','77777777-7777-4777-8777-777777777777',repeat('a',64),now()-interval '2 hours','scheduled',null,now());")
 A.run('BEGIN;'+call);q=async_run(B,claim);wait_blocked();assert q.empty();A.run('COMMIT;');assert '77777777' in finish(q);passed.append('recovery-first blocks actual claim_due until commit')
 # Actual claim first, processing committed: recovery rejects; not a retry or overwrite.
 reset();A.run("update sanji_youtube_manual_schedule set state='scheduled';")
 B.run('BEGIN;'+claim);before=state();expected_lock(A,'PERFORM public.sanji_youtube_manual_recover_incident(\''+owner+'\',\''+incident+'\');');assert state()==before;B.run('COMMIT;')
 A.run("DO $test$ BEGIN BEGIN PERFORM public.sanji_youtube_manual_recover_incident('"+owner+"','"+incident+"');RAISE EXCEPTION 'unexpected recovery';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'schedule changed' THEN RAISE; END IF; END;END $test$;")
 passed.append('claim-first NOWAIT no mutation; committed processing rejected')
 # Second fence conflicts: first fence released by failed statement/subtransaction.
 reset();before=state();B.run('BEGIN;LOCK TABLE sanji_youtube_manual_ledger IN ROW EXCLUSIVE MODE;');expected_lock(A,"PERFORM public.sanji_youtube_manual_recover_incident('"+owner+"','"+incident+"');");assert state()==before
 B.run('LOCK TABLE sanji_youtube_manual_schedule IN ROW EXCLUSIVE MODE NOWAIT;ROLLBACK;');passed.append('second-lock failure rolls back first fence without mutation')
 # Same incident competing connection fails NOWAIT; after commit returns the stored receipt.
 reset();A.run('BEGIN;SET LOCAL ROLE service_role;');first=A.run(call);expected_lock(B,"PERFORM public.sanji_youtube_manual_recover_incident('"+owner+"','"+incident+"');");A.run('COMMIT;');B.run('SET ROLE service_role;');second=B.run(call);B.run('RESET ROLE;');assert first==second
 observed=json.loads(state());assert observed['audit']==1 and observed['ledger']=='reserved' and observed['schedule']=='scheduled' and observed['message']=='unchanged-message' and observed['payload']=='b'*64
 passed.append('same incident audited once and exact receipt idempotency')
 # Explicit rollback releases both locks to another backend.
 reset();A.run('BEGIN;'+call);A.run('ROLLBACK;');B.run('BEGIN;LOCK TABLE sanji_youtube_manual_schedule,sanji_youtube_manual_ledger IN ROW EXCLUSIVE MODE NOWAIT;ROLLBACK;');assert json.loads(state())['audit']==0;passed.append('rollback releases both fences; no persisted audit')
 print(json.dumps({'passed':len(passed),'tests':passed,'scope':'ephemeral synthetic PostgreSQL two backends; no production or external sends'},indent=2))
finally:
 A.close();B.close()
