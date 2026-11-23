import test from 'node:test';
import assert from 'node:assert/strict';
import {readPartyumDayStatus} from './partyum-day-status.mjs';

const actor='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const projectId='private-wedding-research';
const day='2026-11-23';
const [a,b,c]=['a','b','c'].map(x=>'UC'+x.repeat(22));
const row=(channelId,extra={})=>({owner:actor,projectId,day,channelId,...extra});
const ev=(channelId,status,source,at,extra={})=>row(channelId,{status,source,at,proofId:'receipt_'+channelId,...extra});
const sent = '2026-11-23T00:01:00Z', scheduled='2026-11-24T01:00:00Z';
function fixture(events,{ids=[a,b,c],entries}={}){
 return {actor,input:{projectId,day,channelIds:ids},now:()=>Date.parse('2026-11-23T01:00:00Z'),
  readShortlist:async()=>ids.map(id=>row(id)),
  readSnapshot:async()=>({owner:actor,projectId,day,entries:entries??ids.map((id,i)=>row(id,{exhaustive:true,events:events[i]??[]}))})};
}

test('only exact, established project receipts populate dates, with no other data disclosed',async()=>{
 const out = await readPartyumDayStatus(fixture([
  [ev(a,'sent','accepted-provider-receipt',sent,{email:'fixture@example.test',body:'private'})],
  [ev(b,'scheduled','confirmed-current-reservation',scheduled)],
  [],
 ]));
 assert.deepEqual(out,{projectId,day,items:[
  {channelId:a,status:'sent',at:sent,completeForCandidate:true},
  {channelId:b,status:'scheduled',at:scheduled,completeForCandidate:true},
  {channelId:c,status:'found_only',at:null,completeForCandidate:true},
 ]});
});
test('missing adapter or incomplete scan does not turn absence into zero',async()=>{
 const f=fixture([]);delete f.readSnapshot;
 assert.ok((await readPartyumDayStatus(f)).items.every(x=>x.status==='unknown'));
 const g=fixture([],{entries:[row(a,{exhaustive:false,events:[]}),row(b,{events:[]})]});
 assert.ok((await readPartyumDayStatus(g)).items.every(x=>x.status==='unknown'));
});
test('proof from another project, owner or day is never reused',async()=>{
 const out=await readPartyumDayStatus(fixture([
  [ev(a,'sent','accepted-provider-receipt',sent,{projectId:'chewy'})],
  [ev(b,'sent','accepted-provider-receipt',sent,{owner:other})],
  [ev(c,'sent','accepted-provider-receipt',sent,{day:'2026-11-22'})],
 ]));
 assert.ok(out.items.every(x=>x.status==='unknown'));
});
test('wrong or ambiguous proof and expired reservation stay unknown',async()=>{
 const out=await readPartyumDayStatus(fixture([
  [ev(a,'sent','generic-client-label',sent)],
  [ev(b,'scheduled','confirmed-current-reservation',sent)],
  [ev(c,'sent','accepted-provider-receipt',sent),ev(c,'failed','recorded-terminal-failure',sent)],
 ]));
 assert.ok(out.items.every(x=>x.status==='unknown'));
});
test('exact shortlist membership checked before the provider is ever read',async()=>{
 const f=fixture([]);f.readShortlist=async()=>[row(a),row(b)];
 f.readSnapshot=async()=>{assert.fail('provider must not be queried')};
 await assert.rejects(()=>readPartyumDayStatus(f),{code:'SCOPE'});
 f.readShortlist=async()=>[row(a),row(b),row(c,{owner:other})];
 await assert.rejects(()=>readPartyumDayStatus(f),{code:'READ'});
});
test('spoofed caller fields, Chewy, invalid date and duplicate IDs are rejected',async()=>{
 for(const change of [{owner:other},{projectId:'chewy'},{day:'2026-02-30'},{channelIds:[a,a]},{channelIds:[42]}]){
  const f=fixture([]);Object.assign(f.input,change);
  await assert.rejects(()=>readPartyumDayStatus(f),{code:'SCOPE'});
 }
 const f=fixture([]);f.actor=null;
 await assert.rejects(()=>readPartyumDayStatus(f),{code:'AUTH'});
});

test('a reused receipt or normalized invalid 24:00 timestamp does not establish a status',async()=>{
 const out=await readPartyumDayStatus(fixture([
  [ev(a,'sent','accepted-provider-receipt',sent,{proofId:'shared'})],
  [ev(b,'sent','accepted-provider-receipt',sent,{proofId:'shared'})],
  [ev(c,'scheduled','confirmed-current-reservation','2026-11-24T24:00:00Z')],
 ]));
 assert.ok(out.items.every(x=>x.status==='unknown'));
});
