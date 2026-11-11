// Local proposal: the repository must implement owner-bound, atomic due claims.
// No HTTP endpoint, cron, token, or production scheduler is registered here.
export function nextTenSeoul(now){
 const t=typeof now==='number'?now:Date.parse(now);if(!Number.isFinite(t))throw Error('INVALID_TIME');
 const kst=new Date(t+9*3600000);return new Date(Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate()+1,1)).toISOString();
}
export function scheduledYoutubeWorker({repository,dispatch,now=Date.now}){
 if(typeof repository?.claimDue!=='function'||typeof repository?.finishClaim!=='function'||typeof repository?.continueClaim!=='function'||typeof dispatch!=='function')throw Error('SCHEDULER_DEPENDENCIES_REQUIRED');
 return {async runOne(){
  const claim=await repository.claimDue(new Date(now()).toISOString());
  if(claim===null)return {status:'idle'};
  const due=Date.parse(claim?.runAt),current=now();
  if(!claim||typeof claim.owner!=='string'||!claim.owner||typeof claim.batchId!=='string'||!claim.batchId||typeof claim.token!=='string'||!claim.token||!/^[a-f0-9]{64}$/.test(claim.approvalHash||'')||!Number.isFinite(due)||due>current){
   if(claim?.token)await repository.finishClaim({token:claim.token,result:'held'});return {status:'held'};
  }
  // A claimed request is single-use. Unexpected errors are uncertain, never retried.
  try{const started=now();for(let i=0;i<5;i++){if(i>0&&now()-started>=15000)break;const result=await dispatch({owner:claim.owner,batchId:claim.batchId,approvalHash:claim.approvalHash,token:claim.token});if(result?.status==='accepted')continue;const status=result?.status==='complete_or_held'?(Object.entries(result.counts||{}).every(([key,count])=>['accepted','cancelled'].includes(key)||count===0)?'complete':'held'):result?.status==='held'?'held':'outcome_unknown';await repository.finishClaim({token:claim.token,result:status});return {status};}const status=await repository.continueClaim({token:claim.token});if(!['scheduled','complete'].includes(status))throw Error('CONTINUE_UNCERTAIN');return {status};}
  catch{await repository.finishClaim({token:claim.token,result:'outcome_unknown'});return {status:'outcome_unknown'};}
 }};
}
