import {PROJECT} from './partyum-mail.mjs';
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const ID=/^[a-z0-9:_-]{1,128}$/i;
const equal=(a,b)=>typeof a==='string'&&a.length>0&&a===b;

// Detached integration boundary. No activation, time loop, Gmail SDK or production credentials.
// An adapter must commit a durable dispatch intent before provider I/O and never reissue
// that intent after a timeout/restart without independently resolving its provider receipt.
export function createPartyumDueExecutor({claimDue,reverify,startDispatch,finalize,deliver,cooldown=async()=>{},now=Date.now,parallelism=1}){
 return async ({limit=1}={})=>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('Invalid claim bound');
  const claims=await claimDue({projectId:PROJECT,at:new Date(now()).toISOString(),limit});
  if(!Array.isArray(claims)||claims.length>limit)throw Error('Invalid claims');
  for(const claim of claims){
   if(claim?.projectId!==PROJECT||!iso(claim.runAt)||Date.parse(claim.runAt)>now()||
      !ID.test(claim.attemptId??'')||!ID.test(claim.batchId??'')||!ID.test(claim.claimId??''))throw Error('Invalid claim');
  }
  if(new Set(claims.map(c=>c.attemptId)).size!==claims.length)throw Error('Duplicate claim');
  if(!Number.isSafeInteger(parallelism)||parallelism<1||parallelism>3)throw Error('Invalid dispatch concurrency');
  const dispatch=async c=>{
   const binding={actor:c.actor,projectId:PROJECT,day:c.day,channelId:c.channelId,batchId:c.batchId,attemptId:c.attemptId,claimId:c.claimId};
   let check;
   try{check=await reverify(binding);}catch{}
   if(check?.verified!==true||!equal(check.actor,c.actor)||check.projectId!==PROJECT||
     !equal(check.day,c.day)||!equal(check.channelId,c.channelId)||!equal(check.snapshotDigest,c.snapshotDigest)||
     !equal(check.copyDigest,c.copyDigest)||!equal(check.email,c.email)||!equal(check.senderRef,c.senderRef)||
     check.duplicatesComplete!==true||check.recipientAvailable!==true||typeof check.subject!=='string'||!check.subject||typeof check.body!=='string'||!check.body){
    await finalize({...binding,state:'review_required'});return 'review_required';
   }
   const intent=await startDispatch({...binding,snapshotDigest:c.snapshotDigest});
   if(!intent?.committed||!ID.test(intent.id??'')||!equal(intent.attemptId,c.attemptId)){
    return 'not_started';
   }
   let proof;
   try{proof=await deliver({actor:c.actor,projectId:PROJECT,from:c.senderRef,to:c.email,subject:check.subject,body:check.body,intentId:intent.id});}
   catch(e){if(e?.code==='GMAIL_RATE_LIMIT'){try{await cooldown(e.retryAfterSeconds);}catch{}}}
   // For any ambiguous outcome record a hold; do not automatically retry.
   const accepted=proof?.kind==='accepted'&&ID.test(proof.providerId??'')&&iso(proof.at)&&
     Math.abs(Date.parse(proof.at)-now())<300000&&equal(proof.intentId,intent.id);
   const failure=proof?.kind==='rejected_before_acceptance'&&equal(proof.intentId,intent.id);
   const state=accepted?'accepted':failure?'failed':'unknown';
   await finalize({...binding,intentId:intent.id,state,...(accepted?{providerId:proof.providerId,at:proof.at}:{})});
   return state;
  };
  const results=[];
  for(let i=0;i<claims.length;i+=parallelism)results.push(...await Promise.all(claims.slice(i,i+parallelism).map(dispatch)));
  return results;
 };
}
