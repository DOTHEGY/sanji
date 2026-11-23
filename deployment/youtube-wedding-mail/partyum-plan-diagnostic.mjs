// Logged fields use fixed allowlists only. Never log raw exception, cause,
// request/response, attempt/owner IDs, email/copy, query, or connection details.
const stages=new Set([
 'owner_project','product_control','control_connect','control_query','plan_signing',
 'snapshot','snapshot_member','snapshot_shortlist','snapshot_contacts','snapshot_prior',
 'snapshot_suppression','snapshot_legacy','snapshot_copy','snapshot_attestation',
 'snapshot_sender','snapshot_heartbeat','snapshot_eligibility','complete',
]);
const codes=new Set([
 'OK','AUTH','SCOPE','SOURCE_UNVERIFIED','COPY_UNAVAILABLE','COPY_REVIEW_REQUIRED',
 'INVALID_EXCLUSION','GLOBAL_EMAIL_DISABLED','PARTYUM_DISABLED','PARTYUM_CONTROL_UNAVAILABLE',
 'NOT_CONFIGURED','TYPE_ERROR','RANGE_ERROR',
 '42501','42703','42P01','42883','22P02','40001','57014','53300','57P01','08001','08006',
 'ECONNREFUSED','ECONNRESET','ENETUNREACH','ETIMEDOUT','ENOTFOUND','EAI_AGAIN',
 'UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT',
 'ERR_TLS_CERT_ALTNAME_INVALID',
]);
export function safePlanCode(err){
 if(codes.has(err?.code))return err.code;
 if(err instanceof TypeError)return 'TYPE_ERROR';
 if(err instanceof RangeError)return 'RANGE_ERROR';
 return 'OTHER';
}
export function logPlanDiagnostic(logger,stage,err){
 const phase=stages.has(err?.partyumStage)?err.partyumStage:stages.has(stage)?stage:'snapshot';
 const code=err?safePlanCode(err):'OK';
 try{logger(JSON.stringify({event:'partyum_plan_diagnostic',phase,code}));}catch{}
}
export async function partyumPhase(phase,run){
 try{return await run();}catch(e){
  if(stages.has(e?.partyumStage))throw e;
  // Preserve only original status code and sanitized cause class for handler/log.
  const out=Object.assign(new Error('Partyum operation did not complete'),{code:e?.code,partyumStage:phase});
  if(e instanceof TypeError&&!e.code)out.code='TYPE_ERROR';
  if(e instanceof RangeError&&!e.code)out.code='RANGE_ERROR';
  throw out;
 }
}

// Only called on authenticated owner plan while the specific product is ON.
// Do not log lengths or any part of the values. Gmail still enforces its own gates.
export function logPlanGmailEnv(logger,env){
 const present=n=>{const v=env(n);return typeof v==='string'&&v.trim().length>0;};
 try{logger(JSON.stringify({event:'partyum_plan_gmail_env',
  tokenKeyPresent:present('TOKEN_ENCRYPTION_KEY'),
  googleClientIdPresent:present('GOOGLE_CLIENT_ID'),
  googleClientSecretPresent:present('GOOGLE_CLIENT_SECRET'),
 }));}catch{}
}
