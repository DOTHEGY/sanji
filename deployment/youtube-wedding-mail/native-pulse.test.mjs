import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {makePartyumPulseConsumer,createPartyumProductionRuntime} from './production-runtime.mjs';

test('native Cron creates a non-secret no-input hint and one service-only private minute grant',async t=>{
 if(!process.env.PARTYUM_PGLITE){t.skip('set PARTYUM_PGLITE path');return;}
 const {PGlite}=await import(pathToFileURL(process.env.PARTYUM_PGLITE));
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema net;
 create table net.http_request_queue(headers jsonb,body jsonb,budget integer);
 create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint
 language sql as $$ insert into net.http_request_queue values(headers,body,timeout_milliseconds) returning 1::bigint $$;
 grant usage on schema net to public;
 grant select on net.http_request_queue to public;`);
 for(const file of ['0001_partyum_ledger.unapplied.sql','0002_partyum_native_scheduler.unapplied.sql','0003_partyum_runtime_control.unapplied.sql']){
  await db.exec(await fs.readFile(new URL(file,import.meta.url),'utf8'));
 }
 const endpoint='https://abcdefghijklmnopqrst.supabase.co/functions/v1/youtube-wedding-mail-worker';
 const fixtureKey='sb_publishable_fixture123';
 const enqueue=(url=endpoint,key=fixtureKey)=>db.query('select sanji_partyum_internal.enqueue_worker_hint($1,$2)',[url,key]);
 await assert.rejects(()=>enqueue('http://abcdefghijklmnopqrst.supabase.co/functions/v1/youtube-wedding-mail-worker'),/invalid Partyum worker destination/);
 const delay=(60000-Date.now()%60000);
 if(delay<3000)await new Promise(r=>setTimeout(r,delay+50));
 await assert.rejects(()=>enqueue(endpoint,'sb_secret_fixture'),/public Partyum gateway key/);
 const jwt=(o)=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(o)).toString('base64url')+'.fixture';
 await assert.rejects(()=>enqueue(endpoint,jwt({role:'service_role',iss:'supabase',ref:'abcdefghijklmnopqrst',exp:Math.floor(Date.now()/1000)+3600})),/not public anon/);
 await enqueue();await enqueue();
 assert.equal((await db.query('select count(*)::integer as n from sanji_partyum_internal.worker_pulses')).rows[0].n,1);
 await db.exec('set role anon');
 await assert.rejects(()=>enqueue(),/permission denied/);
 const q=await db.query("select headers,body,budget from net.http_request_queue");
 assert.deepEqual(q.rows,[{headers:{'Content-Type':'application/json','X-Sanji-Partyum-Wake':'native-v1',apikey:fixtureKey},body:{},budget:10000}]);
 await assert.rejects(()=>db.query('select * from sanji_partyum_internal.worker_pulses'),/permission denied/);
 await db.exec('set role service_role');
 await assert.rejects(()=>enqueue(),/permission denied/);
 const consume=makePartyumPulseConsumer({pool:{connect:async()=>({query:db.query.bind(db),release(){}})}});
 assert.equal(await consume(),true);
 assert.equal(await consume(),false);
 await db.exec('reset role');
 await db.exec('delete from sanji_partyum_internal.worker_pulses');
 await enqueue();
 await db.exec("update sanji_partyum_internal.worker_pulses set expires_at=clock_timestamp()-interval '1 second'");
 assert.equal(await consume(),false);
 // No browser/owner admission and no existing queue: a legitimate Cron grant
 // may update health; even repeated/fabricated wake hints cannot call the provider.
 await db.exec('delete from sanji_partyum_internal.worker_pulses; delete from sanji_partyum_internal.worker_health; update sanji_partyum_internal.partyum_runtime_controls set send_enabled=true');
 let externalCalls=0;const registered=[];
 const runtime=await createPartyumProductionRuntime({
  pool:{connect:async()=>({query:db.query.bind(db),release(){}})},
  sb:{auth:{getUser:async()=>({error:true})}},
  env:k=>k==='EMAIL_SENDING_ENABLED'?'true':'',
  waitUntil:p=>{registered.push(p);},
  request:async()=>{externalCalls++;throw Error('not expected');},
 });
 const hint=(body={},headers={})=>new Request(endpoint,{method:'POST',
  headers:{'X-Sanji-Partyum-Wake':'native-v1',...headers},body:JSON.stringify(body)});
 assert.equal((await runtime.handleWorker(hint())).status,202);
 assert.equal((await db.query('select * from sanji_partyum_internal.worker_health')).rows.length,0);
 await enqueue();
 assert.equal((await runtime.handleWorker(hint({recipient:'not allowed'}))).status,400);
 assert.equal((await runtime.handleWorker(hint({}, {origin:'https://example.test'}))).status,405);
 const checked=await runtime.handleWorker(hint());
 assert.equal(checked.status,202);assert.equal(await checked.text(),'');
 assert.equal((await runtime.handleWorker(hint())).status,202);
 assert.equal((await db.query('select * from sanji_partyum_internal.worker_health')).rows.length,1);
 assert.equal(registered.length,1);await Promise.all(registered);
 assert.equal(externalCalls,0);
});
