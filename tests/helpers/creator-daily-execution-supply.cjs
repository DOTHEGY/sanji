const assert=require('node:assert/strict');
const NOW=Date.parse('2026-11-09T01:00:00.000Z'),OWNER='11111111-1111-4111-8111-111111111111',CID=n=>'UC'+String(n).padStart(22,'0'),VID=n=>String(n).padStart(11,'0');
const mod=()=>import('../supabase/functions/creator-daily-outreach/supply.mjs');
function harness({channelCount=2,counts={},lastActive=NOW-1000,source=[],history=[],fetchFailure=false,reserveFailure=false,claimState='claimed',finishFailure=false}={}){
 const calls=[],reservations=[],saved=[],events=[],store={summary:null};
 const repository={latest:async()=>store.summary,sweepExpired:async()=>{events.push('sweep');return {snapshotsDeleted:0};},claim:async()=>{events.push('claim');return store.summary?{state:'completed',summary:store.summary}:{state:claimState};},snapshots:async()=>saved, reserve:async c=>{events.push('reserve');reservations.push(c);return {granted:!reserveFailure};},finish:async c=>{events.push('finish');if(finishFailure)throw Object.assign(new Error('uncertain'),{code:'SUPPLY_SAVE_UNCERTAIN'});saved.push(...c.snapshots);store.summary=c.summary;store.cursor=c.cursor;return c.summary;},fail:async c=>{events.push('fail');store.failed=c.summary;}};
 const sourceRepository={candidates:async()=>({complete:true,candidates:source}),history:async()=>({complete:true,creatorKeys:history,emailKeys:[]})};
 const fetchImpl=async(url,options)=>{
  assert.equal(events.at(-1),'reserve');events.push('fetch');calls.push({url:new URL(url),options});if(fetchFailure)throw Error('network');
  const kind=url.pathname.split('/').at(-1),ids=(url.searchParams.get('id')||'').split(',');let items=[],nextPageToken;
  if(kind==='search')items=Array.from({length:channelCount},(_,i)=>({id:{videoId:VID(i+1)},snippet:{channelId:CID(i+1)}}));
  if(kind==='channels')items=ids.map(id=>({id,snippet:{title:'Official creator'},statistics:{subscriberCount:String(counts[id]??50000),hiddenSubscriberCount:counts[id]===null},contentDetails:{relatedPlaylists:{uploads:'UU'+id.slice(2)}}}));
  if(kind==='playlistItems')items=[{contentDetails:{videoId:VID(Number(url.searchParams.get('playlistId').slice(2)))}}];
  if(kind==='videos')items=ids.map(id=>({id,snippet:{channelId:CID(Number(id)),title:'먹방 business@example.com',publishedAt:new Date(lastActive).toISOString()}}));
  return {ok:true,status:200,json:async()=>({items,nextPageToken})};
 };
 return {repository,sourceRepository,fetchImpl,now:()=>NOW,apiKey:'test-key-do-not-log',projectId:'existing-project',enabled:true,calls,reservations,saved,events,store};
}
module.exports={harness,NOW,OWNER,CID};
