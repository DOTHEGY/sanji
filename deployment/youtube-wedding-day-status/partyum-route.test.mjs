import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumStatusReaders} from './partyum-source.mjs';
import {createPartyumDayStatusHandler} from './partyum-handler.mjs';

const actor='00000000-0000-4000-8000-000000000001';
const wrong='00000000-0000-4000-8000-000000000009';
const projectId='private-wedding-research',day='2026-11-23';
const channelId='UC'+'a'.repeat(22);
const body={projectId,day,channelIds:[channelId]};
const stamp='2026-11-24T01:00:00Z';
const find=(r,key)=>key.split(/->>?/).reduce((v,k)=>v?.[k],r)??null;
function fixture(extra={}){
 const rows={sanji_members:[{user_id:actor}],sanji_private_wedding_shortlist:[{owner:actor,project_day:day,channel_id:channelId}],...extra};
 const requests=[];
 const client={auth:{async getUser(token){return token==='fixture'?{data:{user:{id:actor}}}:{error:true};}},from(table){
  const request={table,filters:[],options:{},columns:''};requests.push(request);
  const q={select(cols,opts={}){request.columns=cols;request.options=opts;return q;},
    eq(k,v){request.filters.push([k,[v]]);return q;},in(k,v){request.filters.push([k,v]);return q;},is(k,v){request.filters.push([k,[v]]);return q;},limit(n){request.limit=n;return q;},
    maybeSingle(){return Promise.resolve({data:get()[0]??null});},
    then(resolve,reject){const all=get();const result=request.options.head?{count:all.length}:{data:all.slice(0,request.limit).map(row=>Object.fromEntries(request.columns.split(',').map(f=>{const [alias,expr]=f.includes(':')?f.split(':'):[f,f];return [alias,find(row,expr)];})))};return Promise.resolve(result).then(resolve,reject);}};
  function get(){return (rows[table]??[]).filter(r=>request.filters.every(([k,v])=>v.includes(find(r,k))));}
  return q;
 }};
 return {requests,handler:createPartyumDayStatusHandler({...createPartyumStatusReaders(client),now:()=>Date.parse('2026-11-23T01:00:00Z')})};
}
const go=(x,opts={})=>x.handler(new Request('https://edge.example.test/functions/v1/youtube-wedding-day-status',{method:'POST',headers:{authorization:'Bearer fixture',origin:'https://dothegy.github.io',...opts.headers},body:JSON.stringify(opts.body??body)}));
test('route admits current owner only and runs owner-scoped, read-only, bounded queries',async()=>{
 const x=fixture();const r=await go(x);
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{projectId,day,items:[{channelId,status:'found_only',at:null,completeForCandidate:true}]});
 assert.equal(x.requests[1].table,'sanji_private_wedding_shortlist');
 assert.ok(x.requests.slice(1).every(q=>q.filters.some(f=>f[0]==='owner'&&f[1][0]===actor)));
 assert.ok(x.requests.slice(2).filter(q=>q.options.head).every(q=>q.columns==='id'));
 assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('an unmatched project-tagged draft never turns into a false zero',async()=>{
 const x=fixture({sanji_drafts:[{id:'x',owner:actor,data:{scope:{projectId},recipient:'private@example.test'}}]});
 assert.equal((await (await go(x)).json()).items[0].status,'unknown');
});
test('wrong project, foreign owner, and invalid membership do not hit status sources',async()=>{
 const x=fixture();
 assert.equal((await go(x,{body:{...body,projectId:'chewy'}})).status,400);
 assert.equal((await go(x,{body:{...body,owner:wrong}})).status,400);
 assert.equal(x.requests.some(x=>x.table==='sanji_outbox'),false);
 const y=fixture({sanji_members:[]});
 assert.equal((await go(y)).status,401);
 const z=fixture({sanji_private_wedding_shortlist:[{owner:wrong,project_day:day,channel_id:channelId}]});
 assert.equal((await go(z)).status,400);
 assert.equal(z.requests.length,2);
});
const batch='00000000-0000-4000-8000-000000000002';
const ledger='00000000-0000-4000-8000-000000000003';
const candidate='00000000-0000-4000-8000-000000000004';
const native={
 sanji_youtube_manual_batches:[{owner:actor,id:batch,approval_hash:'h',confirmed_at:'2026-11-23T00:00:00Z',review:{scope:{projectId,day},entries:[{id:candidate,channel:channelId}]}}],
 sanji_youtube_manual_ledger:[{owner:actor,id:ledger,batch_id:batch,candidate_id:candidate,channel:channelId,approval_hash:'h',state:'reserved'}],
 sanji_youtube_manual_schedule:[{owner:actor,batch_id:batch,approval_hash:'h',state:'scheduled',run_at:stamp}],
};
test('only current reservation with exact batch/channel/revision is shown as scheduled',async()=>{
 const good=await (await go(fixture(native))).json();
 assert.equal(good.items[0].status,'scheduled');
 assert.equal(good.items[0].at,'2026-11-24T01:00:00.000Z');
 const bad=fixture({...native,sanji_youtube_manual_schedule:[{...native.sanji_youtube_manual_schedule[0],approval_hash:'wrong'}]});
 assert.equal((await (await go(bad)).json()).items[0].status,'unknown');
});
test('foreign origin and oversized request are rejected without status reads',async()=>{
 const x=fixture();
 assert.equal((await go(x,{headers:{origin:'https://example.org'}})).status,403);
 assert.equal((await go(x,{body:{extra:'x'.repeat(12500)}})).status,413);
 assert.equal(x.requests.length,1);
});

test('Gmail acceptance requires a matching durable receipt and unrelated other channels do not mask proof',async()=>{
 const outbox='00000000-0000-4000-8000-000000000005';
 const thread='00000000-0000-4000-8000-000000000006';
 const providerId='gmail_receipt_1',creatorKey='youtube:'+channelId;
 const mark={projectId,creatorKey,providerId,manualBatchId:batch,proposalType:'youtube_manual_campaign'};
 const accepted='2026-11-23T00:30:00Z';
 const d={...native,
  sanji_youtube_manual_ledger:[{...native.sanji_youtube_manual_ledger[0],state:'accepted',provider_id:providerId,outbox_id:outbox,thread_id:thread}],
  sanji_outbox:[{owner:actor,id:outbox,target:candidate,channel:'email',status:'accepted',created:accepted,data:mark},
    {owner:actor,id:'00000000-0000-4000-8000-000000000099',channel:'email',data:{projectId,creatorKey:'youtube:UC'+'b'.repeat(22)}}],
  sanji_records:[{owner:actor,id:thread,kind:'thread',data:{projectId,creatorKey,target:candidate,messages:[{id:providerId,outboxId:outbox,out:true,status:'accepted',at:accepted}]}}],
 };
 let proof=(await (await go(fixture(d))).json()).items[0];assert.equal(proof.status,'sent');assert.equal(proof.at,'2026-11-23T00:30:00.000Z');assert.equal(proof.providerId,undefined);
 d.sanji_records[0].data.messages[0].out=false;
 proof=(await (await go(fixture(d))).json()).items[0];assert.equal(proof.status,'unknown');
});
