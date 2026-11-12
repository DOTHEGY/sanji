// Temporary authorization for the owner's already confirmed 54-row reservation.
// It does not accept a caller-selected owner, batch, recipients, or content.
export const MANUAL_EXACT = Object.freeze({
  owner: 'e59d9463-c111-40b2-b267-a0100f8ab05b',
  batchId: 'f8e70802-9223-487e-adf5-02fdc088301a',
  approvalHash: '6e79abe7c0f21ea6a2e50da3b7e9b990a038504fc9452c4d243c87d88be6a8a4',
  runAt: '2026-11-12T06:00:00.000Z',
  expiresAt: '2026-11-12T09:00:00.000Z'
});
export function exactManualWorker({repository,dispatch,env,workerFactory,now=Date.now}) {
  // The existing bounded worker is retained, but its first action is an atomic
  // exact-scope claim. It never claims unrelated due work and filters afterward.
  const scoped={...repository,claimDue:async()=>{
    if(now()>=Date.parse(MANUAL_EXACT.expiresAt))throw Error('MANUAL_AUTH_EXPIRED');
    const claim=await repository.claimExactApproved();
    if(claim!==null&&(claim.owner!==MANUAL_EXACT.owner||claim.batchId!==MANUAL_EXACT.batchId||claim.approvalHash!==MANUAL_EXACT.approvalHash||Date.parse(claim.runAt)!==Date.parse(MANUAL_EXACT.runAt)))throw Error('MANUAL_SCOPE_CHANGED');
    return claim;
  }};
  if(typeof workerFactory!=='function')throw Error('MANUAL_WORKER_REQUIRED');
  const worker=workerFactory({repository:scoped,dispatch:args=>now()>=Date.parse(MANUAL_EXACT.expiresAt)?Promise.resolve({status:'held'}):dispatch(args),now});
  return async()=>{
    if(env('YOUTUBE_MANUAL_SCHEDULER_ENABLED')!=='true')return {status:'disabled'};
    return worker.runOne();
  };
}
export function exactManualHandler({authorize,runOne,now=Date.now}) {
  return async request=>{
    const response=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')return response(404,{code:'NOT_FOUND'});
    try {
      if(now()>=Date.parse(MANUAL_EXACT.expiresAt))return response(403,{code:'MANUAL_AUTH_EXPIRED'});
      if(await authorize(request,'workflow_dispatch')!==true)return response(401,{code:'UNAUTHORIZED'});
      if(Number(request.headers.get('content-length')||0)>2)return response(400,{code:'INVALID_INPUT'});
      const reader=request.body?.getReader();let value='';
      if(reader)try{while(true){const chunk=await reader.read();if(chunk.done)break;for(const byte of chunk.value){if(value.length>=2){await reader.cancel();return response(400,{code:'INVALID_INPUT'});}value+=String.fromCharCode(byte);}}}finally{reader.releaseLock();}
      if(value!=='{}')return response(400,{code:'INVALID_INPUT'});
      if(now()>=Date.parse(MANUAL_EXACT.expiresAt))return response(403,{code:'MANUAL_AUTH_EXPIRED'});
      const result=await runOne();
      return response(200,{status:result?.status||'unknown'});
    } catch { return response(503,{code:'WORKER_UNAVAILABLE'}); }
  };
}
