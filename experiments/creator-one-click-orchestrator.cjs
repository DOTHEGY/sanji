'use strict';
const {planCreator}=require('./creator-one-click-plan.cjs');
// Adapter contract is intentionally explicit: production adapters are NOT implemented here.
// enqueue must call the transactional DB wrapper, never Gmail directly.
async function runFrozenBatch({owner,runId,adapter,report=()=>{}}){
 if(!owner||!runId||!adapter)throw Error('run context required');
 const initial=await adapter.getRun(owner,runId);if(!initial||!Array.isArray(initial.items))throw Error('run unavailable');
 let queued=0,skipped=0;
 for(const frozen of initial.items){
  if(frozen.status==='queued'){queued++;continue}if(frozen.status==='skipped'){skipped++;continue}if(frozen.status!=='pending')return {queued,skipped,stopped:true,reason:'unknown state'};
  const current=await adapter.readCurrent(owner,runId,frozen.creator_id);if(!current)return {queued,skipped,stopped:true,reason:'current state unavailable'};
  const plan=planCreator(current.creator,current.deals);
  if(plan.status!=='ready_for_verification'){
   const reason=plan.reason==='공개 이메일 확인 필요'?'email_unverified':plan.reason==='상품 연관 근거 2개 이상 필요'?'product_evidence_missing':'identity_unverified';
   if(!await adapter.skip(owner,runId,frozen.creator_id,reason))return {queued,skipped,stopped:true,reason:'state changed'};skipped++;report({creatorId:frozen.creator_id,status:'skipped',reason});continue;
  }
  let prepared;try{prepared=await adapter.prepareVerifiedReviewAndDraft(owner,runId,plan)}catch{return {queued,skipped,stopped:true,reason:'preparation outcome unknown'}}
  if(!prepared||!prepared.draftId||!prepared.hash){if(!await adapter.skip(owner,runId,frozen.creator_id,'draft_unavailable'))return {queued,skipped,stopped:true,reason:'state changed'};skipped++;continue;}
  try{const job=await adapter.enqueue(owner,runId,frozen.creator_id,prepared);if(!job?.id)throw Error('missing receipt');queued++;report({creatorId:frozen.creator_id,status:'queued'});}
  catch{return {queued,skipped,stopped:true,reason:'reservation outcome unknown; inspect persisted state before resuming'}}
 }
 return {queued,skipped,stopped:false};
}
module.exports={runFrozenBatch};
