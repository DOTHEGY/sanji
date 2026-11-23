import {logPlanDiagnostic,logPlanGmailEnv,partyumPhase} from './partyum-plan-diagnostic.mjs';
import {createPartyumControls} from './partyum-controls.mjs';
import {PROJECT,createPartyumMail} from './partyum-mail.mjs';
import {createPartyumMailHandler} from './handler.mjs';
import {createPartyumPostgres} from './partyum-postgres.mjs';
import {createPartyumDueExecutor} from './partyum-runner.mjs';
import {createPartyumGmail} from './gmail-server.mjs';
import {readPartyumHoldingLegacyEvidence} from './partyum-holding-evidence.mjs';
import {createPartyumCombinedStatus} from './partyum-combined-status.mjs';
import {PARTYUM_WORK_POLICY as POLICY} from './worker-policy.mjs';
import {readPartyumDayStatus} from './legacy/partyum-day-status.mjs';
import {createPartyumStatusReaders} from './legacy/partyum-source.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD={'Cache-Control':'no-store','Content-Type':'application/json'};
const exactOwner=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
const channel=/^UC[A-Za-z0-9_-]{22}$/;
const ORIGIN='https://dothegy.github.io';
const cors={...HEAD,Vary:'Origin','Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const ROLE='set local role service_role';
// Only the verified owner mail route calls this, after global and product gates.
export async function readPartyumPlanKey({pool,initTx}){
 const q=await pool.connect();
 try{
  await q.query('begin read only');await initTx(q);
  await q.query("set local statement_timeout='3000ms'");
  const {rows}=await q.query('select material from sanji_partyum_internal.partyum_plan_key where project_id=$1',[PROJECT]);
  const material=rows.length===1?rows[0].material:null;
  if(!(material instanceof Uint8Array)||material.byteLength!==32)
   throw Object.assign(Error('Partyum signing unavailable'),{code:'NOT_CONFIGURED'});
  await q.query('commit');
  return material;
 }catch(e){try{await q.query('rollback');}catch{}throw e;}
 finally{q.release();}
}
export function makePartyumPulseConsumer({pool,initTx=q=>q.query(ROLE)}){
 return async ()=>{
  const q=await pool.connect();
  try{
   await q.query('begin');await initTx(q);await q.query("set local statement_timeout='3000ms'");
   const {rows}=await q.query(`with g as (
      select minute_bucket from sanji_partyum_internal.worker_pulses
       where project_id=$1 and minute_bucket=date_trunc('minute',clock_timestamp())
        and consumed_at is null and expires_at>clock_timestamp()
       limit 1 for update skip locked
     ), claimed as (
      update sanji_partyum_internal.worker_pulses p set consumed_at=clock_timestamp() from g
      where p.project_id=$1 and p.minute_bucket=g.minute_bucket returning p.project_id
     ) insert into sanji_partyum_internal.worker_health(project_id,wake_ready,checked_at)
       select project_id,true,clock_timestamp() from claimed
       on conflict(project_id) do update set wake_ready=true,checked_at=excluded.checked_at
       returning project_id`,[PROJECT]);
   const got=rows.length===1&&rows[0].project_id===PROJECT;
   await q.query('commit');
   return got;
  }catch{try{await q.query('rollback');}catch{}return false;}
  finally{q.release();}
 };
}
async function boundedRead(request){
 const len=Number(request.headers.get('content-length')||0);
 if(!Number.isSafeInteger(len)||len>12000)throw Error('REQUEST');
 const reader=request.body?.getReader();if(!reader)throw Error('REQUEST');
 let size=0,s='';const d=new TextDecoder('utf-8',{fatal:true});
 for(;;){
  const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;
  if(size>12000){void reader.cancel().catch(()=>{});throw Error('SIZE');}
  s+=d.decode(value,{stream:true});
 }
 return JSON.parse(s+d.decode());
}
function bearer(request){
 const a=request.headers.get('authorization')??'';
 return a.length<=8192?/^Bearer ([^\s,]+)$/i.exec(a)?.[1]:null;
}

/**
 * Register before launch. If the platform hook is absent or throws, the
 * promise resolves without starting any work; there is no detached attempt.
 */
export function deferPartyumWork(waitUntil,run,onError=async()=>{}){
 if(typeof waitUntil!=='function')return false;
 let launch;
 const tracked=new Promise(resolve=>{launch=resolve;}).then(go=>go?run():undefined)
  .catch(async e=>{try{await onError(e);}catch{}});
 try{waitUntil(tracked);}catch{launch(false);return false;}
 launch(true);return true;
}
export function createPartyumNativeWorkerHandler({consume,enabled,runDue,markUnhealthy,waitUntil}){
 return async request=>{
  const json=(body,code=200)=>Response.json(body,{headers:HEAD,status:code});
  const target=new URL(request.url);
  if(request.method!=='POST'||request.headers.has('origin')||target.search||!target.pathname.endsWith('/youtube-wedding-mail-worker')||
     request.headers.get('x-sanji-partyum-wake')!=='native-v1')return json({error:'METHOD'},405);
  let hint;
  try{hint=await boundedRead(request);}catch{return json({error:'REQUEST'},400);}
  if(!hint||Object.getPrototypeOf(hint)!==Object.prototype||Object.keys(hint).length!==0)return json({error:'REQUEST'},400);
  if(typeof waitUntil!=='function')return json({error:'WORKER'},503);
  // The native database grant, not the untrusted HTTP hint, is the authority.
  // Healthy heartbeat and consume commit together before provider work.
  try{if(!await consume())return new Response(null,{status:202,headers:HEAD});}
  catch{return json({error:'WORKER'},503);}
  if(await enabled()&&!deferPartyumWork(waitUntil,()=>runDue({limit:POLICY.nativeBatch}),markUnhealthy)){
   try{await markUnhealthy();}catch{}
   return json({error:'WORKER'},503);
  }
  return new Response(null,{status:202,headers:HEAD});
 };
}

/** Separate Partyum assembly; callers supply the standard server clients, not browser credentials. */
export async function createPartyumProductionRuntime({
 pool,sb,env,waitUntil,request=fetch,initTx=q=>q.query(ROLE),now=Date.now,planLog=line=>console.warn(line),
}){
 if(!pool?.connect||!sb?.auth?.getUser||typeof env!=='function')throw Error('Partyum service missing');
 const readControl=createPartyumControls({pool,initTx,env});
 const enabled=async q=>(await readControl(q)).allowed;
 const legacy=createPartyumStatusReaders(sb);
 const authenticate=async token=>{
  const who=await legacy.authenticate(token);
  return exactOwner.test(who??'')?who:null;
 };
 const gmail=createPartyumGmail({env,request,now,isEnabled:enabled,readConnection:async(q,owner)=>{
  if(!UUID.test(owner??''))return null;
  if(q){
   const {rows}=await q.query(`select owner,provider,encrypted,summary from public.sanji_connections
    where owner=$1 and provider='gmail' limit 2 for share`,[owner]);
   return rows.length===1?rows[0]:null;
  }
  const r=await sb.from('sanji_connections').select('owner,provider,encrypted,summary').eq('owner',owner).eq('provider','gmail').maybeSingle();
  return r.error?null:r.data;
 }});
 const db=createPartyumPostgres({pool,initTx,resolveSender:gmail.resolveSender,readHoldingLegacyEvidence:readPartyumHoldingLegacyEvidence,
  reviewedCopyDigest:async(q,owner,digest)=>(await q.query(`select content_digest from sanji_partyum_internal.copy_attestations
   where owner=$1 and content_digest=$2`,[owner,digest])).rows[0]?.content_digest??null,
 });
 const runDue=createPartyumDueExecutor({...db,now,deliver:gmail.deliver,parallelism:POLICY.parallelism});
 const consume=makePartyumPulseConsumer({pool,initTx});
 const mail=createPartyumMailHandler({authenticate,mail:async(actor,input)=>{
  // Non-owners receive no diagnostics. Logging, if configured, only runs for a verified owner's plan.
  const project=await sb.from('sanji_private_wedding_projects').select('owner').eq('owner',actor).maybeSingle();
  if(project.error||project.data?.owner!==actor)throw Object.assign(Error('AUTH'),{code:'AUTH'});
  const planning=input?.action==='plan';
  const say=(stage,e)=>{if(planning)logPlanDiagnostic(planLog,stage,e);};
  try{
   const decision=await readControl(null,say);
   if(!decision.allowed)throw Object.assign(Error(decision.code),{code:decision.code,partyumStage:'product_control'});
   if(planning)logPlanGmailEnv(planLog,env);
   const key=await partyumPhase('plan_signing',()=>readPartyumPlanKey({pool,initTx}));
   const mail=createPartyumMail({secret:key,loadSnapshot:db.loadSnapshot,admitAtomic:db.admitAtomic,readReplay:db.readReplay,now});
   const answer=await mail(actor,input);
   if(answer.state==='queued'){
    deferPartyumWork(waitUntil,async()=>{
     if(await enabled())await runDue({limit:POLICY.immediateBatch});
    },()=>db.heartbeat({ready:false}));
   }
   say('complete');
   return answer;
  }catch(e){say('snapshot',e);throw e;}
 }});
 const combined=createPartyumCombinedStatus({
  readLegacy:scope=>readPartyumDayStatus({actor:scope.actor,input:{projectId:scope.projectId,day:scope.day,channelIds:scope.channelIds},
   readShortlist:legacy.readShortlist,readSnapshot:legacy.readSnapshot,now}),
  readLedger:db.readStatusEvidence,
 });
 const status=async request=>{
  const json=(body,code=200)=>Response.json(body,{headers:cors,status:code});
  const origin=request.headers.get('origin');
  if(origin&&origin!==ORIGIN)return json({error:'ORIGIN'},403);
  if(request.method==='OPTIONS')return new Response(null,{headers:cors,status:204});
  if(request.method!=='POST')return json({error:'METHOD'},405);
  const token=bearer(request);if(!token)return json({error:'AUTH'},401);
  let actor,input;
  try{actor=await authenticate(token);}catch{}
  if(!actor)return json({error:'AUTH'},401);
  try{input=await boundedRead(request);}catch(e){return json({error:e?.message==='SIZE'?'SIZE':'REQUEST'},e?.message==='SIZE'?413:400);}
  if(!input||Object.keys(input).sort().join(',')!=='channelIds,day,projectId'||
     input.projectId!==PROJECT||typeof input.day!=='string'||!date.test(input.day)||
     !Array.isArray(input.channelIds)||input.channelIds.length<1||input.channelIds.length>100||
     !input.channelIds.every(x=>typeof x==='string'&&channel.test(x))||
     new Set(input.channelIds).size!==input.channelIds.length)return json({error:'SCOPE'},400);
  try{return json(await combined({actor,...input}));}catch{return json({error:'READ'},503);}
 };
 const worker=createPartyumNativeWorkerHandler({consume,enabled,waitUntil,runDue:async options=>{
   if(await enabled())return runDue(options);
  },
  markUnhealthy:()=>db.heartbeat({ready:false}),
 });
 return {handleMail:mail,handleStatus:status,handleWorker:worker};
}
