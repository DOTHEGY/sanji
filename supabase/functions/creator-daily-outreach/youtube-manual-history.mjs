// Fail-closed normalization contract for separately fetched history.
// Gmail metadata cannot prove the absence of a refusal in message bodies.
import {emailIdentity} from './domain.mjs';
const fail=()=>{throw Object.assign(new Error('HISTORY_INCOMPLETE'),{code:'HISTORY_INCOMPLETE'});};
export function verifiedManualHistory({owner,ledger,suppression,refusals,identities}){
 if(typeof owner!=='string'||!owner)fail();
 for(const source of [ledger,suppression,refusals,identities])if(!source||source.owner!==owner||source.complete!==true||!Array.isArray(source.rows))fail();
 const records=ledger.rows.map(r=>{
  if(r.owner!==owner||r.scope!=='manual_creator_email'||typeof r.creatorKey!=='string'||!r.creatorKey||!emailIdentity(r.email)||!['reserved','queued','processing','accepted','sent','outcome_unknown'].includes(r.status)||!Number.isFinite(Date.parse(r.createdAt)))fail();
  return {owner,scope:r.scope,creatorKey:r.creatorKey,email:r.email,status:r.status,createdAt:r.createdAt,...(r.attribution==='unverified_prior_work'?{attribution:r.attribution}:{}),...(typeof r.id==='string'?{id:r.id}:{}),...(typeof r.batchId==='string'?{batchId:r.batchId}:{})};
 });
 const normalize=rows=>[...new Set(rows.map(r=>{if(!r||r.owner!==owner||!emailIdentity(r.email))fail();return emailIdentity(r.email);} ))];
 const suppressedKeys=normalize(suppression.rows),refusedKeys=normalize(refusals.rows);
 const creators=new Map(),emails=new Map();for(const row of identities.rows){if(row?.owner!==owner||typeof row.creatorKey!=='string'||!/^youtube:UC[A-Za-z0-9_-]{22}$/.test(row.creatorKey)||!Array.isArray(row.emailKeys)||row.emailKeys.some(e=>emailIdentity(e)!==e))fail();creators.set(row.creatorKey,(creators.get(row.creatorKey)||0)+1);for(const e of new Set(row.emailKeys)){const keys=emails.get(e)||new Set();keys.add(row.creatorKey);emails.set(e,keys);}}const duplicateCreatorKeys=[...creators].filter(([,n])=>n>1).map(([k])=>k),sharedEmailKeys=[...emails].filter(([,v])=>v.size>1).map(([k])=>k);
 return {duplicateCreatorKeys,sharedEmailKeys,owner,complete:true,scope:'manual_youtube_task',refusalsComplete:true,records,suppressedKeys,refusedKeys:[...new Set(refusedKeys)]};
}
