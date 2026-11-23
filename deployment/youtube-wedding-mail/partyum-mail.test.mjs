import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumMail,partyumCopyDigest,PROJECT,recomputePartyumEligibility} from './partyum-mail.mjs';
import {createPartyumMailHandler} from './handler.mjs';

const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const A='UC'+'a'.repeat(22), B='UC'+'b'.repeat(22), C='UC'+'c'.repeat(22);
const key1='00000000-0000-4000-8000-000000000003', key2='00000000-0000-4000-8000-000000000004';
const day='2026-11-22';
const scope={projectId:PROJECT,day,mode:'tomorrow',channelIdsExcluded:[]};
const fail=code=>Object.assign(Error(code),{code});
async function fixture(){
 let clock=Date.parse('2026-11-23T13:00:00Z'), n=0, queue=Promise.resolve();
 const done=new Map(), used=new Set();
 const copy={actor:owner,projectId:PROJECT,active:true,version:5,purpose:'youtube_project_copy_wedding',id:'fixture-copy',subject:'Fixture title',body:'Synthetic copy'};
 copy.factualityReviewedDigest=await partyumCopyDigest(copy);
 const r=(channelId,email,extra={})=>({channelId,email,actor:owner,projectId:PROJECT,day,affiliation:'independent',contactVerified:true,recipientAvailable:true,completeForCandidate:true,
  outreachState:'found_only',verifiedAt:'2026-11-22T00:00:00Z',expiresAt:'2026-12-01T00:00:00Z',contactRevision:'r1',...extra});
 let state={actor:owner,projectId:PROJECT,day,complete:true,duplicatesComplete:true,mailerReady:true,copy,
    rows:[r(A,'a@example.test'),r(B,'b@example.test'),r(C,'c@example.test',{affiliation:'agency'})]};
 const replay=({actor,projectId,idempotencyKey,fingerprint})=>{
  const old=done.get(actor+projectId+idempotencyKey);if(old&&old.fingerprint!==fingerprint)throw fail('KEY_REUSED');return old?.result;
 };
 const prepare=createPartyumMail({secret:new Uint8Array(32).fill(88),now:()=>clock,loadSnapshot:async()=>structuredClone(state),readReplay:async x=>replay(x),admitAtomic(x){
  // Synthetic locked admission: all socket delivery is deliberately absent.
  const run=queue.then(async()=>{
   const old=replay(x);if(old)return old;
   if(Date.parse(x.expiresAt)<=clock)throw fail('PLAN_STALE');
   const again=await recomputePartyumEligibility(state,x,clock);
   if(again.digest!==x.snapshotDigest)throw fail('PLAN_STALE');
   if(x.recipients.some(r=>used.has(x.actor+'|'+r.email)))throw fail('DUPLICATE');
   for(const r of x.recipients)used.add(x.actor+'|'+r.email);
   n++;
   const result={actor:x.actor,projectId:x.projectId,day:x.day,mode:x.mode,runAt:x.runAt,recipientCount:x.recipients.length,batchId:'fixture-batch-'+n,state:x.mode==='now'?'queued':'scheduled'};
   done.set(x.actor+x.projectId+x.idempotencyKey,{fingerprint:x.fingerprint,result});
   return result;
  });
  queue=run.catch(()=>{});return run;
 }});
 return {state,setTime:v=>{clock=Date.parse(v);},count:()=>n,prepare,used};
}
const plan=(x,s={})=>x.prepare(owner,{...scope,...s,action:'plan'});
const submit=(x,p,s={},idempotencyKey=key1)=>x.prepare(owner,{...scope,...s,action:'submit',
 planId:p.planId,expectedRunAt:p.runAt,expectedRecipientCount:p.recipientCount,idempotencyKey});

test('verified, independent, non-excluded cohort only; tomorrow is 10:00 Seoul; replay is not a second batch',async()=>{
 const x=await fixture(),s={channelIdsExcluded:[B]},p=await plan(x,s);
 assert.equal(p.recipientCount,1);assert.equal(p.runAt,'2026-11-24T01:00:00.000Z');assert.equal(p.copyVersion,5);
 const decoded=atob(p.planId.split('.')[0].replaceAll('-','+').replaceAll('_','/'));
 assert.doesNotMatch(decoded,/example|Synthetic|UCaaaa|00000000/);
 const [a,b]=await Promise.all([submit(x,p,s),submit(x,p,s)]);
 assert.deepEqual(a,b);assert.equal(a.state,'scheduled');assert.equal(x.count(),1);
});
test('now means durable queued, not provider accepted',async()=>{
 const x=await fixture(),s={mode:'now'},p=await plan(x,s);
 const b=await submit(x,p,s);
 assert.equal(b.state,'queued');assert.equal(b.recipientCount,2);
});
test('duplicate recipient races across different keys admit at most one batch',async()=>{
 const x=await fixture(),p=await plan(x);
 const calls=await Promise.allSettled([submit(x,p,{},key1),submit(x,p,{},key2)]);
 assert.equal(calls.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(calls.find(r=>r.status==='rejected').reason.code,'DUPLICATE');
 assert.equal(x.count(),1);
});
test('changing selected exclusions, scope, timing, count, actor, or token fails closed',async()=>{
 const x=await fixture(),p=await plan(x);
 await assert.rejects(()=>submit(x,p,{channelIdsExcluded:[B]}),{code:'INVALID_PLAN'});
 await assert.rejects(()=>submit(x,p,{mode:'now'}),{code:'INVALID_PLAN'});
 await assert.rejects(()=>submit(x,p,{day:'2026-11-21'}),{code:'INVALID_PLAN'});
 await assert.rejects(()=>submit(x,{...p,recipientCount:1}),{code:'INVALID_PLAN'});
 await assert.rejects(()=>submit(x,{...p,planId:'a'+p.planId}),{code:'INVALID_PLAN'});
 await assert.rejects(()=>x.prepare(other,{...scope,action:'submit',planId:p.planId,expectedRunAt:p.runAt,expectedRecipientCount:p.recipientCount,idempotencyKey:key1}),{code:'INVALID_PLAN'});
 assert.equal(x.count(),0);
});
test('even a same-size recipient change or copy change invalidates plan; old false claim blocks',async()=>{
 const x=await fixture(),p=await plan(x);
 x.state.rows[0].email='different@example.test';
 await assert.rejects(()=>submit(x,p),{code:'PLAN_STALE'});
 x.state.copy.body='A different factual text';
 await assert.rejects(()=>submit(x,p),{code:'COPY_REVIEW_REQUIRED'});
 x.state.copy.factualityReviewedDigest=await partyumCopyDigest(x.state.copy);
 await assert.rejects(()=>submit(x,p),{code:'PLAN_STALE'});
 assert.equal(x.count(),0);
});
test('unsafe, duplicate, expired, and unknown recipients do not count',async()=>{
 const x=await fixture();
 x.state.rows[1].email=x.state.rows[0].email;
 assert.equal((await plan(x)).recipientCount,0);
 x.state.rows[1].email='b@example.test';
 x.state.rows[0].outreachState='unknown';x.state.rows[1].expiresAt='2026-11-21T00:00:00Z';
 assert.equal((await plan(x)).recipientCount,0);
 x.state.duplicatesComplete=false;
 await assert.rejects(()=>plan(x),{code:'SOURCE_UNVERIFIED'});
});
test('expired approval and KST date rollover reject, existing admitted replay excludes a new write',async()=>{
 const x=await fixture();x.setTime('2026-11-23T14:59:42Z');const p=await plan(x);
 x.setTime('2026-11-23T15:00:01Z');await assert.rejects(()=>submit(x,p),{code:'PLAN_STALE'});
 const q=await plan(x);const old=await submit(x,q);
 x.setTime('2026-11-23T15:03:00Z');assert.deepEqual(await submit(x,q),old);
 assert.equal(x.count(),1);
});
test('foreign project, date, contact payload, and foreign exclusions never reach admission',async()=>{
 const x=await fixture();
 await assert.rejects(()=>plan(x,{projectId:'chewy'}),{code:'SCOPE'});
 await assert.rejects(()=>plan(x,{day:'2026-11-25'}),{code:'SCOPE'});
 await assert.rejects(()=>plan(x,{body:'injected copy'}),{code:'SCOPE'});
 await assert.rejects(()=>plan(x,{channelIdsExcluded:['UC'+'d'.repeat(22)]}),{code:'INVALID_EXCLUSION'});
 assert.equal(x.count(),0);
});
test('handler requires session and origin, and exposes no private diagnostic on failure',async()=>{
 const x=await fixture();const h=createPartyumMailHandler({authenticate:async t=>t==='fixture'?owner:null,mail:x.prepare});
 const request=(extra={},b={...scope,action:'plan'})=>new Request('https://fixture.example.test',{method:'POST',body:JSON.stringify(b),headers:{Authorization:'Bearer fixture',Origin:'https://dothegy.github.io',...extra}});
 assert.equal((await h(request({Authorization:'Bearer nope'}))).status,401);
 assert.equal((await h(request({Origin:'https://different.example.test'}))).status,403);
 const r=await h(request());assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 const bad=await h(request({}, {private:'a'.repeat(13000)}));assert.equal(bad.status,413);
 const off=createPartyumMailHandler({authenticate:async()=>owner});
 assert.deepEqual(await (await off(request())).json(),{error:'NOT_ENABLED'});
});

test('Gmail dot, tag and googlemail aliases normalize only inside Partyum recipient dedup',async()=>{
 const x=await fixture();
 x.state.rows[0].email='First.Last+label@gmail.com';
 x.state.rows[1].email='firstlast@googlemail.com';
 assert.equal((await plan(x)).recipientCount,0);
 x.state.rows[0].email='First.Last+label@example.test';
 x.state.rows[1].email='firstlast@example.test';
 assert.equal((await plan(x)).recipientCount,2);
});
