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
const encode=new TextEncoder();
const HEAD={'Cache-Control':'no-store','Content-Type':'application/json'};
const exactOwner=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
const channel=/^UC[A-Za-z0-9_-]{22}$/;
const ORIGIN='https://dothegy.github.io';
const cors={...HEAD,Vary:'Origin','Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const ROLE='set local role service_role';
async function deriveKey(master){
 if(typeof master!=='string'||master.length<16)throw Error('Partyum signing unavailable');
 const base=await crypto.subtle.importKey('raw',encode.encode(master),'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',
 salt:encode.encode('sanji internal partyum v1'),info:encode.encode('ui plan authentication')},base,256));
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
  if(enabled()&&!deferPartyumWork(waitUntil,()=>runDue({limit:POLICY.nativeBatch}),markUnhealthy)){
   try{await markUnhealthy();}catch{}
   return json({error:'WORKER'},503);
  }
  return new Response(null,{status:202,headers:HEAD});
 };
}

/** Separate Partyum assembly; callers supply the standard server clients, not browser credentials. */
export async function createPartyumProductionRuntime({
 pool,sb,env,waitUntil,request=fetch,initTx=q=>q.query(ROLE),now=Date.now,
}){
 if(!pool?.connect||!sb?.auth?.getUser||typeof env!=='function')throw Error('Partyum service missing');
 const enabled=()=>env('PARTYUM_MAIL_ENABLED')==='true'&&env('EMAIL_SENDING_ENABLED')==='true';
 const legacy=createPartyumStatusReaders(sb);
 const authenticate=async token=>{
  const who=await legacy.authenticate(token);
  return exactOwner.test(who??'')?who:null;
 };
 const gmail=createPartyumGmail({env,request,now,readConnection:async(q,owner)=>{
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
   where owner=$1 and content_digest=$2 for share`,[owner,digest])).rows[0]?.content_digest??null,
 });
 const runDue=createPartyumDueExecutor({...db,now,deliver:gmail.deliver,parallelism:POLICY.parallelism});
 const consume=makePartyumPulseConsumer({pool,initTx});
 let signingKey;
 const mail=createPartyumMailHandler({authenticate,mail:async(actor,input)=>{
  if(!enabled())throw Object.assign(Error('NOT_ENABLED'),{code:'NOT_ENABLED'});
  signingKey??=deriveKey(env('TOKEN_ENCRYPTION_KEY'));
  const mail=createPartyumMail({secret:await signingKey,loadSnapshot:db.loadSnapshot,admitAtomic:db.admitAtomic,readReplay:db.readReplay,now});
  const answer=await mail(actor,input);
  // Queue already committed. Background execution cannot be reported as delivery.
  // The verified native minute polling worker covers interrupted background calls.
  if(answer.state==='queued'){
   deferPartyumWork(waitUntil,()=>runDue({limit:POLICY.immediateBatch}),()=>db.heartbeat({ready:false}));
  }
  return answer;
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
 const worker=createPartyumNativeWorkerHandler({consume,enabled,runDue,waitUntil,
  markUnhealthy:()=>db.heartbeat({ready:false}),
 });
 return {handleMail:mail,handleStatus:status,handleWorker:worker};
}
