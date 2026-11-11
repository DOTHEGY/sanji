import {youtubeManualDispatch} from '../creator-daily-outreach/youtube-manual-dispatch.mjs';
import {classifyManualRecipient} from '../creator-daily-outreach/manual-email-cutoff.mjs';
import {validateProjectScope} from './project-scope.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
// Server-only orchestration. No caller-supplied content, raw MIME or grant.
export function youtubeManualSendFlow({repository,payloadBuilder,providerFactory,env=()=>''}){
 const gate=()=>{if(env('YOUTUBE_MANUAL_SEND_ENABLED')!=='true'||env('EMAIL_SENDING_ENABLED')!=='true')fail('SENDING_DISABLED');};
 async function currentBatch(owner,input){
  if(!input||Object.keys(input).some(k=>!['batchId','approvalHash'].includes(k))||typeof input.batchId!=='string'||!/^[a-f0-9]{64}$/.test(input.approvalHash||''))fail('INVALID_SEND_REQUEST');
  const b=await repository.batch(owner,input.batchId);if(!b||b.owner!==owner||!b.confirmedAt||b.approvalHash!==input.approvalHash||!Array.isArray(b.review?.entries)||!b.review.entries.length||b.review.entries.length>100)fail('CONFIRM_REQUIRED');return b;
 }
 async function checkedHistory(owner,batch,entry,provided){
  const history=provided||await repository.manualHistory(owner,[entry.email]);
  const emailKey=entry.emailKey;if(typeof emailKey!=='string'||!Array.isArray(history.duplicateCreatorKeys)||!Array.isArray(history.sharedEmailKeys))fail('BATCH_CHANGED');if(history.duplicateCreatorKeys.includes('youtube:'+entry.channel)||history.sharedEmailKeys.includes(emailKey))fail('IDENTITY_AMBIGUOUS');
  const check=classifyManualRecipient({owner,creatorKey:'youtube:'+entry.channel,email:entry.email,records:history.records.filter(r=>r.batchId!==batch.id),suppressed:history.suppressedKeys.includes(emailKey),explicitRefusal:history.refusedKeys.includes(emailKey),complete:history.complete===true&&history.refusalsComplete===true});
  if(!check.eligible)fail('RECIPIENT_BLOCKED');return history;
 }
 async function reserve(owner,input){
  gate();const batch=await currentBatch(owner,input),items=[],history=await repository.manualHistory(owner,batch.review.entries.map(e=>e.email));
  // Reconstruct every selected MIME from the immutable reviewed snapshot.
  for(const entry of batch.review.entries){await checkedHistory(owner,batch,entry,history);const payload=await payloadBuilder(owner,batch,entry.id);items.push({id:entry.id,version:entry.version,email:entry.email,payloadHash:payload.rawHash,messageId:payload.messageId});}
  return {rows:await repository.reserveBatch({owner,batchId:batch.id,approvalHash:batch.approvalHash,items})};
 }
 async function schedule(owner,input){
  if(!input||Object.keys(input).some(k=>!['batchId','approvalHash','expectedRunAt'].includes(k))||typeof input.expectedRunAt!=='string'||!Number.isFinite(Date.parse(input.expectedRunAt)))fail('INVALID_SEND_REQUEST');
  gate();if(env('YOUTUBE_MANUAL_SCHEDULER_ENABLED')!=='true'||env('YOUTUBE_MANUAL_SCHEDULER_TRIGGER_VERIFIED')!=='true')fail('SCHEDULER_UNAVAILABLE');const batch=await currentBatch(owner,{batchId:input.batchId,approvalHash:input.approvalHash});validateProjectScope(batch.review.scope);const items=[],history=await repository.manualHistory(owner,batch.review.entries.map(e=>e.email));
  const prepared=typeof payloadBuilder.prepareBatch==='function'?await payloadBuilder.prepareBatch(owner,batch):null;
  for(const entry of batch.review.entries){await checkedHistory(owner,batch,entry,history);const payload=prepared?await prepared.hash(entry.id):await payloadBuilder(owner,batch,entry.id);items.push({id:entry.id,version:entry.version,email:entry.email,payloadHash:payload.rawHash,messageId:payload.messageId});}
  // Recheck mutable policy, settings, sender and immutable snapshot before the
  // atomic database reservation. Dispatch still rebuilds every payload afresh.
  if(prepared)await prepared.recheck();
  if(typeof repository.scheduleBatch!=='function')fail('SCHEDULER_UNAVAILABLE');
  const result=await repository.scheduleBatch({owner,batchId:batch.id,approvalHash:batch.approvalHash,items,expectedRunAt:input.expectedRunAt});
  if(!result||result.state!=='scheduled'||Date.parse(result.runAt)!==Date.parse(input.expectedRunAt)||!Array.isArray(result.rows)||result.rows.length!==items.length)fail('SCHEDULE_UNCERTAIN');
  return result;
 }
 async function next(owner,input,schedulerToken){
  gate();const batch=await currentBatch(owner,input),rows=await repository.batchRows(owner,batch.id);
  if(rows.length!==batch.review.entries.length)fail('BATCH_INCOMPLETE');
  // Uncertain, already consumed or currently running rows are never retried.
  const row=rows.find(r=>r.state==='reserved');if(!row)return {status:'complete_or_held',counts:rows.reduce((x,r)=>(x[r.state]=(x[r.state]||0)+1,x),{})};
  const entry=batch.review.entries.find(e=>e.id===row.candidate_id);if(!entry||entry.version!==row.candidate_version||entry.email!==row.email)fail('BATCH_CHANGED');
  const payload=await payloadBuilder(owner,batch,entry.id);if(payload.rawHash!==row.payload_hash)fail('CONTENT_CHANGED');
  const isolated=providerFactory();let claimed=false;
  const bound={
   async claim(){if(claimed)return null;claimed=true;const args={owner,id:row.id,approvalHash:batch.approvalHash,payloadHash:payload.rawHash};const token=schedulerToken?await repository.claimScheduledRow({...args,schedulerToken}):await repository.claimRow(args);if(!token)return null;return {owner,batchId:batch.id,id:row.id,token,payload,payloadHash:payload.rawHash};},
   async recheck(args){
    // Both the persisted suppression snapshot and external reviewed source
    // must be available; an absent source always blocks the provider call.
    try{await checkedHistory(owner,batch,entry);}catch{return {allowed:false,checkedAt:new Date().toISOString()};}
    return repository.recheck(args);
   },
   consume:args=>repository.consume(args),finish:args=>repository.finish(args)
  };
  try{const result=await youtubeManualDispatch({repository:bound,provider:isolated}).dispatchOne({owner,batchId:batch.id,approvalHash:batch.approvalHash});if(result?.status==='complete_or_held'&&!result.counts){const latest=await repository.batchRows(owner,batch.id);if(latest.length!==batch.review.entries.length)fail('BATCH_INCOMPLETE');return {status:'complete_or_held',counts:latest.reduce((x,r)=>(x[r.state]=(x[r.state]||0)+1,x),{})};}return result;}finally{isolated.clear?.();}
 }
 async function cancel(owner,input){if(!input||Object.keys(input).some(k=>k!=='batchId')||typeof input.batchId!=='string')fail('INVALID_REQUEST');const count=await repository.cancelPending({owner,batchId:input.batchId});if(!Number.isSafeInteger(count)||count<0)fail('CANCEL_UNCERTAIN');return {cancelled:count};}
 async function status(owner,input){const batch=await currentBatch(owner,input),rows=await repository.batchRows(owner,batch.id);if(rows.some(r=>!batch.review.entries.some(e=>e.id===r.candidate_id)))fail('BATCH_CHANGED');return {rows:rows.map(r=>{const entry=batch.review.entries.find(e=>e.id===r.candidate_id);const status=['sending','granted'].includes(r.state)?'outcome_unknown':r.state;const sender=batch.review.sender;const searchUrl=status==='outcome_unknown'&&/^[A-Za-z0-9_-]{1,100}$/.test(r.message_id||'')&&typeof sender==='string'?'https://mail.google.com/mail/?authuser='+encodeURIComponent(sender)+'#search/'+encodeURIComponent('rfc822msgid:<'+r.message_id+'@sanji.local>'):null;return {candidateId:r.candidate_id,channel:entry.channel,email:entry.email,status,...(searchUrl?{searchUrl}:{})};})};}
 async function recent(owner,input){if(!input||Object.keys(input).some(k=>k!=='offset')||!Number.isSafeInteger(input.offset)||input.offset<0||input.offset>10000)fail('INVALID_REQUEST');const batches=await repository.recentBatches(owner,input.offset),rows=[];for(const b of batches.rows){const result=await status(owner,{batchId:b.id,approvalHash:b.approvalHash});let schedule=null;try{if(typeof repository.scheduleStatus==='function')schedule=await repository.scheduleStatus(owner,b.id);}catch{}rows.push({batchId:b.id,createdAt:b.createdAt,rows:result.rows,schedule});}return {rows,more:batches.more,offset:batches.offset};}
 return {reserve,schedule,next,status,recent,cancel};
}
