import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPartyumPostgres} from './partyum-postgres.mjs';
import {createPartyumMail,partyumCopyDigest,PROJECT} from './partyum-mail.mjs';
import {createPartyumDueExecutor} from './partyum-runner.mjs';
import {readPartyumHoldingLegacyEvidence} from './partyum-holding-evidence.mjs';
import {createPartyumStagingRuntime} from './runtime.mjs';

const owner='00000000-0000-0000-0000-000000000010', copyId='00000000-0000-0000-0000-000000000020';
const ids=['a','b','c'].map(x=>'UC'+x.repeat(22));
const day='2026-11-22';
const copy={id:copyId,version:1,subject:'Synthetic title',body:'Synthetic body'};
const setup=`
create role anon;create role authenticated;create role service_role bypassrls;
create table public.sanji_members(user_id uuid primary key);
create table public.sanji_private_wedding_projects(owner uuid primary key);
create table public.sanji_private_wedding_shortlist(owner uuid,channel_id text,project_day date, primary key(owner,channel_id));
create table public.sanji_private_wedding_contacts(owner uuid,channel_id text,email text,source_kind text,source_url text,verified_at timestamptz,expires_at timestamptz,revoked_at timestamptz,affiliation_status text,affiliation_source_url text,affiliation_checked_at timestamptz,primary key(owner,channel_id));
create table public.sanji_template_library(id uuid primary key,owner uuid,version integer,data jsonb,archived boolean);
create table public.sanji_suppression(owner uuid,identity text);
create table public.sanji_youtube_manual_batches(owner uuid,review jsonb);
create table public.sanji_drafts(owner uuid,data jsonb);
create table public.sanji_outbox(owner uuid,channel text,data jsonb);
create table public.sanji_records(owner uuid,kind text,data jsonb);
grant usage on schema public to service_role;
grant select,update on all tables in schema public to service_role;
revoke all on public.sanji_private_wedding_contacts from service_role;
`;
const key=()=>crypto.randomUUID();
const base=(s={})=>({projectId:PROJECT,day,mode:'now',channelIdsExcluded:[],...s});
const plan=(x,s={})=>x.mail(owner,{action:'plan',...base(s)});
const submit=(x,p,s={},idempotencyKey=key())=>x.mail(owner,{action:'submit',...base(s),planId:p.planId,
 expectedRecipientCount:p.recipientCount,expectedRunAt:p.runAt,idempotencyKey});
const evidence=(x,channelIds=ids)=>x.ad.readStatusEvidence({actor:owner,day,projectId:PROJECT,channelIds});
async function fixture(t){
 if(!process.env.PARTYUM_PGLITE){t.skip('Set PARTYUM_PGLITE to the local PGlite dist/index.js');return null;}
 const {PGlite}=await import(pathToFileURL(process.env.PARTYUM_PGLITE));
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(setup);
 for(const file of ['0001_partyum_ledger.unapplied.sql','0002_partyum_native_scheduler.unapplied.sql','0003_partyum_runtime_control.unapplied.sql','0004_partyum_verified_contact_reader.unapplied.sql','0006_partyum_custom_schedule.unapplied.sql']){
  await db.exec(await fs.readFile(new URL('./'+file,import.meta.url),'utf8'));
 }
 await db.exec('update sanji_partyum_internal.partyum_runtime_controls set send_enabled=true');
 await db.query('insert into public.sanji_members values($1)',[owner]);
 await db.query('insert into public.sanji_private_wedding_projects values($1)',[owner]);
 await db.query('insert into public.sanji_template_library values($1,$2,1,$3::jsonb,false)',[copyId,owner,JSON.stringify({...copy,purpose:'youtube_project_copy_wedding'})]);
 for(let i=0;i<ids.length;i++){
  await db.query('insert into public.sanji_private_wedding_shortlist values($1,$2,$3::date)',[owner,ids[i],day]);
  await db.query(`insert into public.sanji_private_wedding_contacts
   values($1,$2,$3,'official_channel','https://example.test/',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',null,'reviewed_no_agency_found','https://example.test/about',clock_timestamp()-interval '1 day')`,[owner,ids[i],String(i)+'@example.test']);
 }
 await db.query('insert into public.sanji_suppression values($1,$2)',[owner,'email:2@example.test']);
 const reviewed=await partyumCopyDigest(copy);
 await db.query("insert into sanji_partyum_internal.copy_attestations(owner,content_digest,decision_ref) values($1,$2,'fixture approval')",[owner,reviewed]);
 await db.exec('set role service_role;');
 let active=Promise.resolve();
 const pool={connect:async()=>{
  const prior=active;let release;
  active=new Promise(resolve=>{release=resolve;});await prior;
  return {query:db.query.bind(db),release};
 }};
 let senderRef='sender-v1';
 const ad=createPartyumPostgres({pool,resolveSender:async()=>({verified:true,owner,senderRef}),
   reviewedCopyDigest:async(q,actor,digest)=>(await q.query('select content_digest from sanji_partyum_internal.copy_attestations where owner=$1 and content_digest=$2',[actor,digest])).rows[0]?.content_digest,readHoldingLegacyEvidence:readPartyumHoldingLegacyEvidence});
 const mail=createPartyumMail({secret:new Uint8Array(32).fill(3),loadSnapshot:ad.loadSnapshot,admitAtomic:ad.admitAtomic,readReplay:ad.readReplay});
 return {db,pool,ad,mail,setSender:v=>{senderRef=v;}};
}
test('migration keeps the private ledger inaccessible to browser roles, then the worker handles each receipt exactly once',async t=>{
 const x=await fixture(t);if(!x)return;
 await x.db.exec('set role authenticated');
 await assert.rejects(()=>x.db.query('select 1 from sanji_partyum_internal.attempts'),/permission denied/);
 await x.db.exec('set role service_role');
 await assert.rejects(()=>plan(x),{code:'SOURCE_UNVERIFIED'});
 await x.ad.heartbeat();
 const s={channelIdsExcluded:[ids[1]]},p=await plan(x,s);
 assert.equal(p.recipientCount,1);
 const k=key(),b=await submit(x,p,s,k);
 assert.equal(b.state,'queued');
 assert.deepEqual(await submit(x,p,s,k),b);
 assert.equal((await evidence(x)).get(ids[0]).status,'unknown');
 let calls=0;
 const runner=createPartyumDueExecutor({...x.ad,deliver:async c=>{
  calls++;assert.equal(c.to,'0@example.test');assert.equal(c.body,copy.body);
  return {kind:'accepted',intentId:c.intentId,providerId:'fixture-receipt-1',at:new Date().toISOString()};
 }});
 assert.deepEqual(await runner(),['accepted']);
 assert.equal((await evidence(x)).get(ids[0]).status,'sent');
 assert.deepEqual(await runner(),[]);assert.equal(calls,1);
});
test('a scheduled submission is logged at tomorrow 10 Seoul, but source and sender changes hold future dispatch',async t=>{
 const x=await fixture(t);if(!x)return;
 await x.ad.heartbeat();
 const p=await plan(x,{mode:'tomorrow'});assert.equal(p.runAt.slice(11),'01:00:00.000Z');
 await submit(x,p,{mode:'tomorrow'});
 const status=await evidence(x);assert.equal(status.get(ids[0]).status,'scheduled');assert.equal(status.get(ids[0]).at,p.runAt);
 const res=await x.ad.claimDue({projectId:PROJECT,limit:10});assert.deepEqual(res,[]);
});
test('sender version drift after admission or provider timeout never automatically reopens work',async t=>{
 const x=await fixture(t);if(!x)return;
 await x.ad.heartbeat();const p=await plan(x);await submit(x,p);
 const runner=createPartyumDueExecutor({...x.ad,deliver:async ()=>{throw Error('simulated uncertain provider response')}});
 assert.deepEqual(await runner({limit:1}),['unknown']);
 x.setSender('sender-reconnected');
 assert.deepEqual(await runner({limit:1}),['review_required']);assert.deepEqual(await runner({limit:1}),[]);
 const status=await evidence(x);assert.equal(status.get(ids[0]).status,'unknown');assert.equal(status.get(ids[1]).status,'unknown');
});

test('local entrypoint performs actual Postgres wake and combined UI state with synthetic provider',async t=>{
 const x=await fixture(t);if(!x)return;
 let notified=0,sent=0;
 const sender=async()=>({verified:true,owner,senderRef:'sender-staging'});
 const ownCopy=await partyumCopyDigest(copy);
 const runtime=createPartyumStagingRuntime({sandbox:true,pool:x.pool,secret:new Uint8Array(32).fill(5),
  resolveSender:sender,reviewedCopyDigest:async()=>ownCopy,
  authClient:{auth:{getUser:async token=>token==='fixture'?{data:{user:{id:owner}}}:{error:true}}},
  readLegacyStatus:async s=>({projectId:s.projectId,day:s.day,items:s.channelIds.map(channelId=>({channelId,status:'found_only',at:null,completeForCandidate:true}))}),
  listen:(channel,cb)=>x.db.listen(channel,p=>{notified++;cb(p);}),
  mockTransport:async p=>{sent++;return {kind:'accepted',intentId:p.intentId,providerId:'fixture-staging-receipt',at:new Date().toISOString()};},
 });
 const stop=await runtime.startWorker();
 try{
  const get=async body=>runtime.handleMail(new Request('https://fixture.example.test',{method:'POST',body:JSON.stringify(body),headers:{Authorization:'Bearer fixture'}}));
  const body={...base({channelIdsExcluded:[ids[1]]}),action:'plan'};
  const isReady=async()=>{const r=await get(body),v=await r.json();return r.ok?v:null;};
  let draft;const deadline=Date.now()+2500;
  do{draft=await isReady();if(!draft)await new Promise(r=>setTimeout(r,25));}while(!draft&&Date.now()<deadline);
  assert.ok(draft);
  const submit=await get({...body,action:'submit',planId:draft.planId,expectedRecipientCount:draft.recipientCount,expectedRunAt:draft.runAt,idempotencyKey:key()});
  assert.equal(submit.status,200);assert.equal((await submit.json()).state,'queued');
  const completeBy=Date.now()+2500;
  const getStatus=()=>runtime.getStatus({token:'fixture',projectId:PROJECT,day,channelIds:[ids[0]]});
  let result;
  do{result=(await getStatus()).items[0].status;if(result!=='sent')await new Promise(r=>setTimeout(r,20));}while(result!=='sent'&&Date.now()<completeBy);
  assert.equal(result,'sent');assert.equal(notified,1);assert.equal(sent,1);
 }finally{stop();await new Promise(r=>setTimeout(r,50));}
});

test('narrow contact reader matches actual restrictive role graph and exact whitelisted cohort',async t=>{
 const x=await fixture(t);if(!x)return;
 const read=(project=PROJECT,actor=owner,date=day,channels=[ids[0]])=>x.db.query('select channel_id from sanji_partyum_internal.read_partyum_verified_contacts($1,$2,$3::date,$4::text[])',[project,actor,date,channels]);
 await assert.rejects(()=>x.db.query('select channel_id from public.sanji_private_wedding_contacts'),/permission denied/);
 await assert.rejects(()=>x.db.query('select content_digest from sanji_partyum_internal.copy_attestations for share'),/permission denied/);
 assert.equal((await read()).rows[0].channel_id,ids[0]);
 for(const [project,actor,date,channels] of [
   ['chewy',owner,day,[ids[0]]], [PROJECT,'00000000-0000-0000-0000-000000000031',day,[ids[0]]],
   [PROJECT,owner,'2026-11-21',[ids[0]]], [PROJECT,owner,day,[ids[0],ids[0]]],[PROJECT,owner,day,['UC'+'z'.repeat(22)]],
 ])await assert.rejects(()=>read(project,actor,date,channels),/contact scope unavailable/);
 await x.db.exec('set role authenticated');await assert.rejects(()=>read(),/permission denied/);await x.db.exec('reset role');
 await x.db.exec("update public.sanji_private_wedding_contacts set revoked_at=clock_timestamp() where channel_id='"+ids[0]+"'");
 await x.db.exec('set role service_role');assert.equal((await read()).rows.length,0);
 await x.db.exec('reset role');await x.db.exec('update sanji_partyum_internal.partyum_runtime_controls set send_enabled=false');
 await x.db.exec('set role service_role');await assert.rejects(()=>read(),/contact scope unavailable/);
});

test('two separately selected discovery days can share a custom due time without dispatch or cross-day exclusions',async t=>{
 const x=await fixture(t);if(!x)return;
 const otherDay='2026-11-23';
 await x.db.exec('reset role');
 await x.db.query('update public.sanji_private_wedding_shortlist set project_day=$1 where channel_id=$2',[otherDay,ids[1]]);
 await x.db.exec('set role service_role');
 await x.ad.heartbeat();
 const scheduleAt=new Date(Math.floor((Date.now()+2*86400000)/60000)*60000).toISOString();
 const a={mode:'scheduled',scheduleAt},b={...a,day:otherDay};
 const [pa,pb]=await Promise.all([plan(x,a),plan(x,b)]);
 assert.equal(pa.recipientCount,1);assert.equal(pb.recipientCount,1);
 assert.equal(pa.runAt,scheduleAt);assert.equal(pb.runAt,scheduleAt);
 const first=await submit(x,pa,a),second=await submit(x,pb,b);
 assert.equal(first.state,'scheduled');assert.equal(second.state,'scheduled');
 assert.notEqual(first.batchId,second.batchId);
 assert.equal((await evidence(x,[ids[0]])).get(ids[0]).at,scheduleAt);
 assert.equal((await x.ad.readStatusEvidence({actor:owner,day:otherDay,projectId:PROJECT,channelIds:[ids[1]]})).get(ids[1]).at,scheduleAt);
 assert.deepEqual(await x.ad.claimDue({projectId:PROJECT,limit:6}),[]);
});
