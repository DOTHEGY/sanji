// Pure policy candidate only. Not wired into the existing queue or dispatch.
// An adapter must supply a complete, owner-scoped ledger from this campaign.
import {emailIdentity} from './domain.mjs';
const normalizeEmail=x=>emailIdentity(x)||'';
const acceptedStatus=new Set(['reserved','queued','processing','accepted','sent','outcome_unknown']);
export function classifyManualRecipient({owner,creatorKey,email,records,suppressed,explicitRefusal,complete}){
 if(typeof owner!=='string'||!owner||typeof creatorKey!=='string'||!creatorKey||!normalizeEmail(email)||complete!==true||!Array.isArray(records)||typeof suppressed!=='boolean'||typeof explicitRefusal!=='boolean')return {eligible:false,reason:'verification_incomplete'};
 if(suppressed||explicitRefusal)return {eligible:false,reason:'refusal_or_suppression'};
 for(const r of records){
  if(!r||r.owner!==owner||r.scope!=='manual_creator_email'||typeof r.creatorKey!=='string'||!normalizeEmail(r.email)||!acceptedStatus.has(r.status)||!Number.isFinite(Date.parse(r.createdAt)))return {eligible:false,reason:'ledger_invalid'};
  if(r.creatorKey===creatorKey||normalizeEmail(r.email)===normalizeEmail(email))return {eligible:false,reason:r.attribution==='unverified_prior_work'?'history_origin_unverified':'already_sent_or_pending'};
 }
 return {eligible:true,reason:'ready_for_review'};
}
