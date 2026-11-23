import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumDueExecutor} from './partyum-runner.mjs';
import {PROJECT} from './partyum-mail.mjs';
import {PARTYUM_WORK_POLICY as p} from './worker-policy.mjs';

test('a 50-recipient cohort starts at due only, drains with latency and one throttled attempt, no automatic resend',async()=>{
 const base=Date.parse('2026-11-24T01:00:00Z');
 let time=base-60000,coolUntil=0,calls=0;
 const rows=Array.from({length:50},(_,i)=>({actor:'fixture-owner',projectId:PROJECT,day:'2026-11-23',
  channelId:'fixture-channel-'+i,batchId:'fixture-batch',attemptId:'attempt-'+i,claimId:'claim-'+i,
  runAt:new Date(base).toISOString(),snapshotDigest:'snapshot',copyDigest:'copy',senderRef:'sender',
  email:i+'@example.test',subject:'Synthetic subject',body:'Synthetic body',state:'queued'}));
 const byId=new Map(rows.map(r=>[r.attemptId,r])),completedAt=new Map(),known=new Set();
 const poke=createPartyumDueExecutor({parallelism:p.parallelism,now:()=>time,
  claimDue:async({limit})=>time<base||time<coolUntil||time-base>p.dispatchWindowMs?[]:rows.filter(r=>r.state==='queued').slice(0,limit).map(r=>{r.state='claimed';return r;}),
  reverify:async x=>({...byId.get(x.attemptId),verified:true,duplicatesComplete:true,recipientAvailable:true}),
  startDispatch:async x=>{
   const r=byId.get(x.attemptId);
   if(time<coolUntil){r.state='queued';return null;}
   r.state='dispatching';
   return {committed:true,attemptId:x.attemptId,id:'intent-'+x.attemptId};
  },
  deliver:async x=>{
   calls++;assert.ok(!known.has(x.intentId));known.add(x.intentId);
   if(calls===10)throw Object.assign(Error('Synthetic 429'),{code:'GMAIL_RATE_LIMIT',retryAfterSeconds:90});
   return {kind:'accepted',intentId:x.intentId,at:new Date(time).toISOString(),providerId:'receipt-'+x.intentId};
  },
  cooldown:async seconds=>{coolUntil=time+seconds*1000;},
  finalize:async x=>{
   byId.get(x.attemptId).state=x.state;
   // Worst of two 3-wide waves; this models 24s/provider item without sleeping.
   completedAt.set(x.attemptId,time+Math.ceil(p.nativeBatch/p.parallelism)*24000);
  },
 });
 assert.deepEqual(await poke({limit:p.nativeBatch}),[]);assert.equal(calls,0);
 for(time=base;time<base+p.dispatchWindowMs;time+=60000)await poke({limit:p.nativeBatch});
 assert.equal(calls,50);
 assert.equal(rows.filter(r=>r.state==='accepted').length,49);
 assert.equal(rows.filter(r=>r.state==='unknown').length,1);
 assert.ok([...completedAt.values()].every(at=>at<base+p.dispatchWindowMs));
});
