import {createPartyumMail,PROJECT} from './partyum-mail.mjs';
import {createPartyumMailHandler} from './handler.mjs';
import {createPartyumPostgres} from './partyum-postgres.mjs';
import {createPartyumDueExecutor} from './partyum-runner.mjs';
import {startPartyumWorker} from './partyum-worker-loop.mjs';
import {readPartyumHoldingLegacyEvidence} from './partyum-holding-evidence.mjs';
import {createPartyumCombinedStatus} from './partyum-combined-status.mjs';

const OWNER=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Explicit local/staging integration entrypoint. It has no lookup of process
 * environment, no embedded authorization or provider, and no production switch.
 * `sandbox` must be supplied by the explicitly created staging configuration.
 * An operator must not point injected adapters at production.
 */
export function createPartyumStagingRuntime({
 sandbox,secret,pool,authClient,resolveSender,reviewedCopyDigest,mockTransport,readLegacyStatus,listen,now,onError,
}={}){
 if(sandbox!==true)return {handleMail:createPartyumMailHandler({authenticate:async()=>null}),startWorker:async()=>()=>{}};
 if(typeof mockTransport!=='function'||typeof readLegacyStatus!=='function'||!authClient?.auth?.getUser)throw Error('Staging adapters are mandatory');
 const db=createPartyumPostgres({pool,resolveSender,reviewedCopyDigest,readHoldingLegacyEvidence:readPartyumHoldingLegacyEvidence});
 const authenticate=async token=>{
  const {data,error}=await authClient.auth.getUser(token);
  const owner=data?.user?.id;
  if(error||!OWNER.test(owner??''))return null;
  const q=await pool.connect();
  try{
   const r=await q.query('select user_id from public.sanji_members where user_id=$1',[owner]);
   return r.rows.length===1&&r.rows[0].user_id===owner?owner:null;
  }finally{q.release();}
 };
 const handleMail=createPartyumMailHandler({authenticate,mail:createPartyumMail({secret,
  loadSnapshot:db.loadSnapshot,admitAtomic:db.admitAtomic,readReplay:db.readReplay,now})});
 const runDue=createPartyumDueExecutor({...db,now,deliver:mockTransport});
 const readCombined=createPartyumCombinedStatus({readLegacy:readLegacyStatus,readLedger:db.readStatusEvidence});
 return {handleMail,startWorker:(signal)=>startPartyumWorker({enabled:true,db,runDue,listen,signal,onError}),
  async getStatus({token,projectId,day,channelIds}){
   const actor=await authenticate(token);
   if(!actor||projectId!==PROJECT)throw Error('Status scope mismatch');
   return readCombined({actor,projectId,day,channelIds});
  }};
}
