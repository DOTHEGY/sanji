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
 assert.equal(result[0].active.length,1);
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
 const [g]=weddingDayGroups({owner,rows:list,verified:list,statusByDay:new Map([[day,rows]])});
 assert.deepEqual(g.counts,{found_only:1,scheduled:1,sent:1,failed:0,unknown:3});
 assert.equal(g.active[0].status.label,'발송 완료');
 assert.match(g.active[1].status.detail,/오전 10:00.*KST/);
});
