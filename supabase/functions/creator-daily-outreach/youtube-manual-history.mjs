// Fail-closed normalization contract for separately fetched history.
// Gmail metadata cannot prove the absence of a refusal in message bodies.
import {emailIdentity} from './domain.mjs';
const fail=()=>{throw Object.assign(new Error('HISTORY_INCOMPLETE'),{code:'HISTORY_INCOMPLETE'});};
export function verifiedManualHistory({owner,ledger,suppression,refusals,identities,gmailReview,now=Date.now()}){
 if(typeof owner!=='string'||!owner)fail();
 for(const source of [ledger,suppression,refusals,identities,gmailReview])if(!source||source.owner!==owner||source.complete!==true||!Array.isArray(source.rows))fail();
 const records=ledger.rows.map(r=>{
  if(r.owner!==owner||r.scope!=='manual_creator_email'||typeof r.creatorKey!=='string'||!r.creatorKey||!emailIdentity(r.email)||!['reserved','queued','processing','accepted','sent','outcome_unknown'].includes(r.status)||!Number.isFinite(Date.parse(r.createdAt)))fail();
  return {owner,scope:r.scope,creatorKey:r.creatorKey,email:r.email,status:r.status,createdAt:r.createdAt,...(r.attribution==='unverified_prior_work'?{attribution:r.attribution}:{}),...(typeof r.id==='string'?{id:r.id}:{}),...(typeof r.batchId==='string'?{batchId:r.batchId}:{})};
 });
 const normalize=rows=>[...new Set(rows.map(r=>{if(!r||r.owner!==owner||!emailIdentity(r.email))fail();return emailIdentity(r.email);} ))];
 const suppressedKeys=normalize(suppression.rows),refusedKeys=normalize(refusals.rows),proof=new Map();
 for(const row of gmailReview.rows){const key=emailIdentity(row?.email);const t=Date.parse(row?.checkedAt);if(row?.owner!==owner||!key||!['no_refusal_confirmed','refusal','unknown'].includes(row.status)||!Number.isFinite(t)||t>now||now-t>60000||!['provider_empty_history','provider_existing_history','provider_unavailable','owner_reviewed'].includes(row.source)||(row.status==='no_refusal_confirmed'&&['provider_existing_history','provider_unavailable'].includes(row.source))||proof.has(key))fail();proof.set(key,row.status);if(row.status==='refusal')refusedKeys.push(key);}
 const creators=new Map(),emails=new Map();for(const row of identities.rows){if(row?.owner!==owner||typeof row.creatorKey!=='string'||!/^youtube:UC[A-Za-z0-9_-]{22}$/.test(row.creatorKey)||!Array.isArray(row.emailKeys)||row.emailKeys.some(e=>emailIdentity(e)!==e))fail();creators.set(row.creatorKey,(creators.get(row.creatorKey)||0)+1);for(const e of new Set(row.emailKeys)){const keys=emails.get(e)||new Set();keys.add(row.creatorKey);emails.set(e,keys);}}const duplicateCreatorKeys=[...creators].filter(([,n])=>n>1).map(([k])=>k),sharedEmailKeys=[...emails].filter(([,v])=>v.size>1).map(([k])=>k);
 return {duplicateCreatorKeys,sharedEmailKeys,owner,complete:true,scope:'manual_youtube_since_2026_11_10',refusalsComplete:true,records,suppressedKeys,refusedKeys:[...new Set(refusedKeys)],gmailReviewByKey:proof};
}
export function gmailRefusalReviewed(history,email){const key=emailIdentity(email);return Boolean(key&&history?.gmailReviewByKey instanceof Map&&history.gmailReviewByKey.get(key)==='no_refusal_confirmed');}
