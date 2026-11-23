import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumDueExecutor} from './partyum-runner.mjs';
import {PROJECT} from './partyum-mail.mjs';
const now=()=>Date.parse('2026-11-24T01:01:00Z');
const c={projectId:PROJECT,actor:'fixture-owner',day:'2026-11-22',channelId:'fixture-channel',
 batchId:'batch',attemptId:'attempt',claimId:'claim',runAt:'2026-11-24T01:00:00Z',
 snapshotDigest:'snapshot',copyDigest:'fixture-copy-digest',email:'sample@example.test',senderRef:'fixture-sender',
 subject:'Synthetic title',body:'Synthetic content'};
const attested={verified:true,actor:c.actor,projectId:PROJECT,day:c.day,channelId:c.channelId,
 snapshotDigest:c.snapshotDigest,copyDigest:c.copyDigest,email:c.email,senderRef:c.senderRef,subject:c.subject,body:c.body,duplicatesComplete:true,recipientAvailable:true};
function stub(changes={}){
 const writes=[];
 const call=createPartyumDueExecutor({now,claimDue:async()=>[c],reverify:async()=>attested,
  startDispatch:async()=>{writes.push('intent');return {committed:true,id:'intent',attemptId:'attempt'};},
  finalize:async x=>{writes.push(x.state);},
  deliver:async()=>{writes.push('mock_delivery');return {kind:'accepted',intentId:'intent',providerId:'fixture_receipt',at:'2026-11-24T01:00:58Z'};},...changes});
 return {call,writes};
}
test('only durable intent before delivery; authenticated acceptance follows provider proof',async()=>{
 const x=stub();assert.deepEqual(await x.call(),['accepted']);
 assert.deepEqual(x.writes,['intent','mock_delivery','accepted']);
});
test('changed copy/recipient confirmations hold before provider I/O',async()=>{
 const x=stub({reverify:async()=>({...attested,copyDigest:'changed'})});
 assert.deepEqual(await x.call(),['review_required']);assert.deepEqual(x.writes,['review_required']);
});
test('ambiguous delivery enters unknown once and no automatic retry is attempted',async()=>{
 let attempts=0;const x=stub({deliver:async()=>{attempts++;throw Error('timeout');}});
 assert.deepEqual(await x.call(),['unknown']);assert.equal(attempts,1);
 assert.deepEqual(x.writes,['intent','unknown']);
});
test('wrong project/duplicate claims are rejected before any dispatch intent',async()=>{
 const x=stub({claimDue:async()=>[{...c,projectId:'chewy'}]});await assert.rejects(()=>x.call(),/Invalid claim/);assert.deepEqual(x.writes,[]);
 const y=stub({claimDue:async()=>[c,c]});await assert.rejects(()=>y.call({limit:2}),/Duplicate claim/);assert.deepEqual(y.writes,[]);
});
