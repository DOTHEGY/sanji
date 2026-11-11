const KEYS=Object.freeze({sanji_youtube_manual_ledger:'id',sanji_youtube_manual_gmail_reviews:'id',sanji_daily_campaign_queue:'creator_key',sanji_outbox:'id',sanji_suppression:'identity',sanji_records:'id'});
const fail=()=>{throw Object.assign(new Error('HISTORY_INCOMPLETE'),{code:'HISTORY_INCOMPLETE'});};
// Stable, owner-scoped, bounded keyset scan: any changed, capped or unavailable
// source fails closed. The returned records remain server-side.
export function youtubeHistorySnapshotReader(sb){
 async function tableOnce(owner,table){const key=KEYS[table];if(!key)fail();let rows=[],cursor=null,total=null;
  for(let page=0;page<100;page++){
   let q=sb.from(table).select('*',{count:'exact'}).eq('owner',owner).order(key,{ascending:true}).limit(500);if(cursor)q=q.gt(key,cursor);
   let r;try{r=await q;}catch{fail();}if(r.error||!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count<0||r.data.length>500)fail();
   if(total===null)total=r.count;if(total>10000||rows.length+r.count!==total)fail();
   for(const row of r.data){if(row.owner!==owner||typeof row[key]!=='string'||!row[key]||(cursor&&row[key]<=cursor))fail();cursor=row[key];rows.push(row);}
   if(rows.length===total)return rows;if(!r.data.length)fail();
  }fail();
 }
 return async(owner,tables)=>{
  if(typeof owner!=='string'||!owner||!Array.isArray(tables)||tables.length!==Object.keys(KEYS).length||new Set(tables).size!==tables.length||tables.some(t=>!KEYS[t]))fail();
  const read=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,await tableOnce(owner,name)])));
  const first=await read(),second=await read();if(JSON.stringify(first)!==JSON.stringify(second))fail();return {owner,complete:true,tables:first};
 };
}
