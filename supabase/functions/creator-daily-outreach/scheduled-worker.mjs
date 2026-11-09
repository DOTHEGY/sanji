import {DAILY_OUTREACH,OutreachError,outreachDay} from './domain.mjs';
export const SCHEDULE_CONTRACT=Object.freeze({enabledByDefault:false,timezone:'Asia/Seoul',suggestedLocalTime:'09:00',provisionalTime:true,catchUp:false,overlap:'durable_owner_campaign_day_lease',recipientSource:'server_configuration_only',maintenanceFrequency:'daily',automaticSending:false});
// No timer, cron registration, credentials or sender is created by this module.
// The same run can be invoked by an approved scheduler or the manual prepare path.
export function createScheduledWorker({enabled=false,owner,campaign=DAILY_OUTREACH.campaign,supply,prepare,dispatch,dispatchEnabled=false,now=()=>Date.now()}){
 const status=()=>({...SCHEDULE_CONTRACT,enabled,campaign,dispatchEnabled});
 async function run(){
  if(!enabled)return {state:'stopped',schedulerEnabled:false,sendingEnabled:false};
  if(!/^[a-f0-9-]{36}$/i.test(owner||'')||campaign!==DAILY_OUTREACH.campaign||!supply||typeof prepare!=='function')throw new OutreachError('SCHEDULE_NOT_CONFIGURED','서버의 실행 계정·캠페인·준비 연결을 확인하세요.',503);
  // Maintenance is executable independently of discovery and runs first. A
  // stopped discovery schedule still needs its separately approved expiry job.
  const maintenance=await supply.sweepExpired();
  const collected=await supply.run(owner);
  if(collected.state==='busy')return {state:'busy',day:outreachDay(now()),maintenance,collected,sendingEnabled:false};
  if(collected.state!=='completed')return {state:'blocked',day:outreachDay(now()),maintenance,collected,sendingEnabled:false};
  if(collected.newlyCollected===true)return {state:'collected',day:outreachDay(now()),maintenance,collected,sendingEnabled:false};
  const prepared=await prepare(owner);
  if(!dispatchEnabled)return {state:'prepared',day:outreachDay(now()),maintenance,collected,prepared,sendingEnabled:false};
  if(typeof dispatch!=='function')throw new OutreachError('DISPATCH_NOT_CONFIGURED','발송은 아직 연결되지 않았습니다.',503);
  // Parent dispatcher must independently enforce approved content/recipient basis,
  // signature/images, fresh evidence, durable claims and Gmail preflight. This
  // callback is unreachable by default and accepts no caller-supplied recipients.
  const dispatched=await dispatch(owner);
  return {state:'processed',day:outreachDay(now()),maintenance,collected,prepared,dispatched};
 }
 return {run,status,async maintain(){return supply.sweepExpired();}};
}
// Authentication belongs to the deployed environment's EXISTING credential or
// verified invocation system. There is intentionally no standalone Deno.serve.
export function scheduledWorkerHandler({worker,authenticate}){
 return async req=>{
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
  if(typeof authenticate!=='function'||await authenticate(req)!==true)return json({code:'SCHEDULER_AUTH_REQUIRED'},401);
  // The schedule owns owner/campaign/day; external callers cannot choose them.
  const reader=req.body?.getReader();let body='',bytes=0;
  if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32){await reader.cancel();return json({code:'INVALID_SCHEDULE_INPUT'},400);}body+=new TextDecoder().decode(value);}}finally{reader.releaseLock();}}
  if(body.trim()&&body.trim()!=='{}')return json({code:'INVALID_SCHEDULE_INPUT'},400);
  try{return json(await worker.run());}catch(error){return json({code:error instanceof OutreachError?error.code:'SCHEDULE_UNAVAILABLE'},503);}
 };
}
