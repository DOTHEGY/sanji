import {createHash} from 'node:crypto';
// Manual YouTube dispatch orchestration. Repository methods must be implemented
// by atomic, owner-scoped transactions before this module can be deployed.
// This module does not register a route, scheduler, or provider.
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function youtubeManualDispatch({repository,provider,now=Date.now}){
 if(!repository||!provider)fail('DEPENDENCIES_REQUIRED');
 async function prepare({owner,selection,snapshotRevision}){
  if(typeof owner!=='string'||!owner||!Array.isArray(selection)||!selection.length||selection.length>100||!Number.isSafeInteger(snapshotRevision))fail('INVALID_SELECTION');
  const ids=new Set();
  for(const row of selection){if(!row||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||typeof row.email!=='string'||!row.email.trim()||ids.has(row.id))fail('INVALID_SELECTION');ids.add(row.id);}
  return repository.prepare({owner,selection:selection.map(({id,version,email})=>({id,version,email:email.trim().toLowerCase()})),snapshotRevision});
 }
 async function dispatchOne({owner,batchId,approvalHash}){
  if(!owner||!batchId||!approvalHash)fail('APPROVAL_REQUIRED');
  // claim is an atomic, permanent one-use transition; it must recheck consent,
  // owner, source revisions, sender, suppression and the task-scoped ledger.
  const claim=await repository.claim({owner,batchId,approvalHash,now:new Date(now()).toISOString()});
  if(!claim)return {status:'complete_or_held'};
  if(claim.owner!==owner||claim.batchId!==batchId||!claim.id||!claim.token||!claim.payload||typeof claim.payload.raw!=='string'||!/^[a-f0-9]{64}$/.test(claim.payloadHash||'')||createHash('sha256').update(claim.payload.raw).digest('hex')!==claim.payloadHash)fail('INVALID_CLAIM');
  let session;try{session=await provider.prepare({owner,senderEmail:claim.payload.senderEmail});if(typeof session?.session!=='string'||!session.session)throw Error('session unavailable');}
  catch{try{await repository.finish({owner,batchId,id:claim.id,token:claim.token,status:'held'});return {status:'held',id:claim.id};}catch{return {status:'outcome_unknown',id:claim.id};}}
  // Re-read current owner-scoped refusals immediately before invoking Gmail.
  // The check and the remote provider request are separate operations.
  let checked;try{checked=await repository.recheck({owner,batchId,id:claim.id,token:claim.token});}catch{checked=null;}
  const checkedMs=Date.parse(checked?.checkedAt),elapsed=now()-checkedMs;
  if(!checked||checked.allowed!==true||!Number.isFinite(checkedMs)||elapsed<0||elapsed>5000){
   try{await repository.finish({owner,batchId,id:claim.id,token:claim.token,status:'held'});}
   catch{return {status:'outcome_unknown',id:claim.id};}
   return {status:'held',id:claim.id};
  }
  let grant;try{grant=await repository.consume({owner,batchId,id:claim.id,token:claim.token,payloadHash:claim.payloadHash});}catch{return {status:'outcome_unknown',id:claim.id};}
  if(grant?.ready===false)return {status:'held',id:claim.id};
  if(grant?.ready!==true||grant.payloadHash!==claim.payloadHash||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now()||Date.parse(grant.expiresAt)>now()+5000)return {status:'outcome_unknown',id:claim.id};
  let result;
  try{result=await provider.send({...claim.payload,owner,session:session.session,rawHash:claim.payloadHash,grant});}catch{
   // A transport exception cannot prove that Gmail did not accept the message.
   try{await repository.finish({owner,batchId,id:claim.id,token:claim.token,status:'outcome_unknown'});}catch{}
   return {status:'outcome_unknown',id:claim.id};
  }
  const status=result?.accepted===true&&/^[A-Za-z0-9_-]{1,200}$/.test(result.providerId||'')&&/^[A-Za-z0-9_-]{1,200}$/.test(result.providerThread||'')?'accepted':'outcome_unknown';
  try{await repository.finish({owner,batchId,id:claim.id,token:claim.token,status,providerId:status==='accepted'?result.providerId:undefined,providerThread:status==='accepted'?result.providerThread:undefined});}
  catch{return {status:'outcome_unknown',id:claim.id};}
  return {status,id:claim.id};
 }
 return {prepare,dispatchOne};
}
