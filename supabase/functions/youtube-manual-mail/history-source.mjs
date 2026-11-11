import {emailIdentity} from '../creator-daily-outreach/domain.mjs';
const fail=()=>{throw Object.assign(new Error('HISTORY_INCOMPLETE'),{code:'HISTORY_INCOMPLETE'});};
const emailFrom=x=>emailIdentity(String(x||'').replace(/^email:/i,''));
// readSnapshot must return complete, consistent owner-scoped arrays of the
// specified tables. It must fail if any row/page is missing or source changes.
// This code deliberately treats un-attributed recent records as UNKNOWN.
export function youtubeManualHistorySource({readSnapshot,provider,connection,now=Date.now}){
 return async function read(owner,addresses){
  if(typeof readSnapshot!=='function'||!owner||!Array.isArray(addresses)||!addresses.length||addresses.length>100)fail();
  const result=await readSnapshot(owner,['sanji_youtube_manual_ledger','sanji_suppression','sanji_records']);
  const tables=result?.tables;if(result?.owner!==owner||result.complete!==true||!tables||Object.values(tables).some(rows=>!Array.isArray(rows)||rows.some(r=>r.owner!==owner)))fail();
  for(const table of ['sanji_youtube_manual_ledger','sanji_suppression','sanji_records'])if(!Array.isArray(tables[table]))fail();
  const ledger=[],candidateById=new Map(tables.sanji_records.filter(r=>r.kind==='candidate').map(r=>[r.id,r]));
  const add=(r,creatorKey,email,status,createdAt,attribution,batchId,id)=>{if(!emailIdentity(email)||typeof creatorKey!=='string'||!creatorKey||!Number.isFinite(Date.parse(createdAt)))fail();ledger.push({owner,scope:'manual_creator_email',creatorKey,email,status,createdAt,attribution,...(batchId?{batchId}:{}),...(id?{id}:{})});};
  for(const r of tables.sanji_youtube_manual_ledger){if(r.state==='cancelled')continue;const status=({reserved:'reserved',sending:'processing',granted:'processing',accepted:'accepted',outcome_unknown:'outcome_unknown',held:'reserved'})[r.state];if(!status||typeof r.channel!=='string'||!/^UC[A-Za-z0-9_-]{22}$/.test(r.channel))fail();add(r,'youtube:'+r.channel,r.email,status,r.created_at,'manual_youtube',r.batch_id,r.id);}
  const suppression=[];for(const r of tables.sanji_suppression){const e=emailFrom(r.identity);if(e)suppression.push({owner,email:e});}
  const refusals=[];const emailsFor=c=>[c?.data?.contact?.email,...(Array.isArray(c?.data?.youtubeResearch?.businessContacts)?c.data.youtubeResearch.businessContacts.map(x=>x.email):[])].filter(emailIdentity);
  for(const r of tables.sanji_records){if(r.kind==='thread'&&Array.isArray(r.data?.messages))for(const message of r.data.messages)for(const failure of (Array.isArray(message?.bounceFailures)?message.bounceFailures:[]))if(failure?.kind==='permanent'&&failure?.source==='delivery_status'&&/^5\./.test(String(failure?.status||''))){if(!emailIdentity(failure.email))fail();refusals.push({owner,email:failure.email});}let c=null;if(r.kind==='candidate'&&['거절','수신 거부','상대방 거절','우리 측 거절'].includes(r.data?.status))c=r;else if(r.kind==='thread'&&(['거절','수신 거부'].includes(r.data?.classification)||['상대방 거절','우리 측 거절'].includes(r.data?.conversationStatus))){c=candidateById.get(r.data?.target);if(!c)fail();}if(c)for(const email of emailsFor(c))refusals.push({owner,email});}
  const identities=[];for(const c of candidateById.values()){const m=String(c.data?.profile||'').match(/^https:\/\/(?:www\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/);if(!m||c.data?.channels!=='YouTube')continue;identities.push({owner,creatorKey:'youtube:'+m[1],emailKeys:[...new Set(emailsFor(c).map(emailIdentity).filter(Boolean))]});}
  const source=rows=>({owner,complete:true,rows});return {ledger:source(ledger),suppression:source(suppression),refusals:source(refusals),identities:source(identities)};
 };
}
