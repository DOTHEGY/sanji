const {test}=require('node:test');
const assert=require('node:assert/strict');
const main=async()=>import('../web/youtube-wedding-day-groups.mjs');
const projectId='private-wedding-research',owner='owner-fixture';
const make=(i,projectDay,other={})=>({channelID:'UC'+String(i).padStart(22,'0'),projectDay,projectId,owner,...other});
const proof=(row,status,more={})=>({owner,projectId,channelID:row.channelID,day:row.projectDay,status,...more});
test('projects are separated, groups are chronological KST dates, and missing data is unknown',async()=>{
 const {weddingDayGroups}=await main();
 const a=make(1,'2026-11-21'), b=make(2,'2026-11-23'), c=make(3,'2026-11-23',{owner:'other'}), q=make(4,'2026-11-23',{projectId:'gs-chewy'});
 const rows=[a,b,c,q];
 const result=weddingDayGroups({owner,rows,verified:[b,c,q],statusByDay:new Map()});
 assert.deepEqual(result.map(x=>x.day),['2026-11-23','2026-11-21']);
 assert.equal(result[0].active.length,0);
 assert.equal(result[0].cutoffCounts.unknown,1);
 assert.equal(result[1].history.length,1);
 assert.equal(result[0].counts.unknown,1);
});
test('the same labels and Seoul-time details require exact project, date, and coherent evidence',async()=>{
 const {weddingDayGroups}=await main();
 const day='2026-11-23', list=[1,2,3,4,5,6].map(i=>make(i,day));
 const rows = new Map(list.map((x,i)=>[x.channelID,[
  proof(x,'sent',{at:'2026-11-24T01:00:00Z'}),
  proof(x,'scheduled',{at:'2026-11-24T01:00:00Z'}),
  proof(x,'found_only',{completeForCandidate:true}),
  proof(x,'sent',{projectId:'other',at:'2026-11-24T01:00:00Z'}),
  proof(x,'scheduled'),
  proof(x,'found_only'),
 ][i]]));
 for(const p of rows.values())Object.assign(p,{subscriberEligibility:'eligible',subscriberCount:50000});
 const [g]=weddingDayGroups({owner,rows:list,verified:list,statusByDay:new Map([[day,rows]])});
 assert.deepEqual(g.counts,{found_only:1,scheduled:1,sent:1,failed:0,unknown:3});
 assert.equal(g.active.find(x=>x.row===list[0]).status.label,'발송 완료');
 assert.match(g.active.find(x=>x.row===list[1]).status.detail,/오전 10:00.*KST/);
});

test('only scoped official subscriber proof at or above cutoff is eligible; archive preserves real status',async()=>{
 const {weddingDayGroups}=await main();
 const {decodeWeddingStatus}=await import('../web/youtube-wedding-status-client.mjs');
 const day='2026-11-23', list=[1,2,3,4,5,6,7,8].map(i=>make(i,day));
 const items=list.map((r,i)=>({channelId:r.channelID,status:i===1?'sent':'found_only',at:i===1?'2026-11-24T01:00:00Z':null,completeForCandidate:true,
    subscriberEligibility:i===1?'below_minimum':'eligible',subscriberCount:[50000,49900,49999,'50000',null,50100,50000,70000][i]}));
 items.push(items[6]); // duplicate fails closed
 const proof=decodeWeddingStatus({projectId,day,items},{owner,day,channelIds:[...list.map(x=>x.channelID),make(9,day).channelID]});
 proof.get(list[7].channelID).owner='different-actor';
 const [g]=weddingDayGroups({owner,rows:list,verified:list.filter(x=>x!==list[5]),statusByDay:new Map([[day,proof]])});
 assert.deepEqual(g.active.map(x=>x.row.channelID),[list[0].channelID]);
 assert.deepEqual(g.cutoffCounts,{eligible:2,below_minimum:1,unknown:5});
 assert.equal(g.history.find(x=>x.row===list[1]).status.state,'sent');
 assert.equal(g.counts.sent,1);
});

test('subscriber refresh only trusts coherent authoritative evidence aggregates',async()=>{
 const {decodeWeddingSubscriberRefresh,subscriberRefreshError}=await import('../web/youtube-wedding-status-client.mjs');
 const receipt={projectId,subscriberMinimum:50000,total:2,eligible:1,belowMinimum:0,unknown:1,materialized:2};
 assert.deepEqual(decodeWeddingSubscriberRefresh(receipt),{total:2,eligible:1,belowMinimum:0,unknown:1,materialized:2});
 for(const bad of [{projectId:'chewy'},{subscriberMinimum:1000},{materialized:1},{unknown:0},{eligible:'1'}])
   assert.equal(decodeWeddingSubscriberRefresh({...receipt,...bad}),null);
 assert.match(subscriberRefreshError('YOUTUBE_NOT_CONFIGURED'),/기존 확인 기록/);
 assert.doesNotMatch(subscriberRefreshError('raw secret string'),/raw secret/);
});
