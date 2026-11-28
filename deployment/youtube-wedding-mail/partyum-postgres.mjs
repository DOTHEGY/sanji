import {validWeddingScheduleAt} from '../../web/youtube-wedding-schedule.mjs';
import {PROJECT,recomputePartyumEligibility,partyumCopyDigest,partyumRecipientKey} from './partyum-mail.mjs';
import {partyumPhase} from './partyum-plan-diagnostic.mjs';
import {PARTYUM_WORK_POLICY as POLICY} from './worker-policy.mjs';
const fail=code=>Object.assign(Error(code),{code});
const iso=v=>new Date(v).toISOString();
const clearTime=v=>v==null?null:iso(v);
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const sched=mode=>mode==='now'?'queued':'scheduled';
const tables='sanji_partyum_internal.';
const str=(x)=>typeof x==='string'&&x.length>0&&x.length<=256;
const pgtime=async q=>new Date((await q.query('select clock_timestamp() as now')).rows[0].now).getTime();
const channel=/^UC[A-Za-z0-9_-]{22}$/;
const makeResult=r=>({actor:r.owner,projectId:r.project_id,day:r.day,mode:r.mode,runAt:iso(r.run_at),recipientCount:r.recipient_count,batchId:r.id,state:sched(r.mode)});
const allowed=(r)=>r&&r.projectId===PROJECT&&typeof r.actor==='string';
const sinceSql="checked_at > clock_timestamp()-interval '90 seconds'";
const lockOwner=(q,owner)=>q.query("select pg_advisory_xact_lock(hashtextextended('sanji-partyum-mail:'||$1::text,0))",[owner]);
function identitiesFor(channelId,email){
 const key=partyumRecipientKey(email);
 return [email,'email:'+email,key,'email:'+key,channelId.toLowerCase(),'youtube:'+channelId.toLowerCase()].filter(x=>x&&x!=='email:');
}
function suppression(identities,channelId,email){return identitiesFor(channelId,email).some(x=>identities.has(x));}
function contactRevision(r){
 return JSON.stringify([r.channel_id,norm(r.email),clearTime(r.verified_at),clearTime(r.expires_at),clearTime(r.affiliation_checked_at),r.source_kind,r.source_url,r.affiliation_source_url]);
}
function trustedContact(r,t){
 return !!r&&!r.revoked_at&&r.affiliation_status==='reviewed_no_agency_found'&&
  ['official_channel','official_website','official_video'].includes(r.source_kind)&&
  typeof r.source_url==='string'&&r.source_url.startsWith('https://')&&typeof r.affiliation_source_url==='string'&&r.affiliation_source_url.startsWith('https://')&&
  Date.parse(r.affiliation_checked_at)<=t&&Date.parse(r.verified_at)<=t&&Date.parse(r.expires_at)>t;
}

/**
 * PostgreSQL service-only adapter. The receiving process supplies its authorized pool,
 * existing current-sender verification, and server-side factuality attestation check.
 * Do not substitute a browser client, a generic service key passed by a requester,
 * or route this into the paused / separate Chewy runner.
 */
export function createPartyumPostgres({
 pool,resolveSender,reviewedCopyDigest,readHoldingLegacyEvidence,initTx=async()=>{},
}){
 if(!pool?.connect||typeof resolveSender!=='function'||typeof reviewedCopyDigest!=='function'||
    typeof readHoldingLegacyEvidence!=='function')throw fail('NOT_CONFIGURED');
 async function tx(fn,serializable=true){
  const q=await pool.connect();
  try{
   await q.query(serializable?'begin isolation level serializable':'begin isolation level read committed');
   await initTx(q);
   const result=await fn(q);
   await q.query('commit');
   return result;
  }catch(e){
   try{await q.query('rollback');}catch{}
   if(e?.code==='40001')throw fail('PLAN_STALE');
   if(e?.code==='23505')throw fail('DUPLICATE');
   throw e;
  }finally{q.release();}
 }
 async function members(q,owner){
  const {rows}=await q.query('select user_id from public.sanji_members where user_id=$1 for share',[owner]);
  if(rows.length!==1||rows[0].user_id!==owner)throw fail('AUTH');
 }
 async function sender(q,scope){
  const proof=await resolveSender(q,scope.actor);
  return proof?.verified===true&&proof.owner===scope.actor&&str(proof.senderRef)?proof.senderRef:null;
 }
 async function activeCopy(q,scope){
  const {rows}=await q.query(`select id, owner, version, data->>'purpose' as purpose,
   data->>'subject' as subject,data->>'body' as body from public.sanji_template_library
   where owner=$1 and not archived and data->>'purpose'='youtube_project_copy_wedding' limit 2 for share`,[scope.actor]);
  if(rows.length!==1)return null;
  const x=rows[0],copy={id:x.id,actor:x.owner,projectId:PROJECT,active:true,version:x.version,purpose:x.purpose,subject:x.subject,body:x.body};
  const digest=await partyumCopyDigest(copy);
  copy.factualityReviewedDigest=await partyumPhase('snapshot_attestation',()=>reviewedCopyDigest(q,scope.actor,digest));
  return copy;
 }
 async function verifiedContacts(q,{actor,day},ids){
  if(!ids.length)return [];
  return (await q.query(`select channel_id,email,source_kind,source_url,verified_at,expires_at,revoked_at,
    affiliation_status,affiliation_source_url,affiliation_checked_at
    from ${tables}read_partyum_verified_contacts($1,$2,$3::date,$4::text[])`,[PROJECT,actor,day,ids])).rows;
 }
 async function readLocked(q,scope,t){
  if(!allowed(scope))throw fail('SCOPE');
  await partyumPhase('snapshot_member',()=>members(q,scope.actor));
  const {rows:people}=await partyumPhase('snapshot_shortlist',()=>q.query(`select channel_id from public.sanji_private_wedding_shortlist
       where owner=$1 and project_day=$2::date order by channel_id limit 101 for share`,[scope.actor,scope.day]));
  if(people.length>100)throw fail('SOURCE_UNVERIFIED');
  const ids=people.map(x=>x.channel_id);
  if(!ids.every(x=>channel.test(x)))throw fail('SOURCE_UNVERIFIED');
  const records=await partyumPhase('snapshot_contacts',()=>verifiedContacts(q,scope,ids));
  const contacts=new Map(records.map(x=>[x.channel_id,x]));
  const addresses=records.map(x=>partyumRecipientKey(x.email)).filter(Boolean);
  const {rows:prior}=await partyumPhase('snapshot_prior',()=>q.query(`select channel_id,recipient_key,state from ${tables}attempts
       where owner=$1 and project_id=$2 and (channel_id=any($3::text[]) or recipient_key=any($4::text[]))`,[scope.actor,PROJECT,ids,addresses]));
  const allKeys=[...new Set(ids.flatMap(id=>identitiesFor(id,norm(contacts.get(id)?.email))))];
  const {rows:holds}=await partyumPhase('snapshot_suppression',()=>q.query(`select identity from public.sanji_suppression where owner=$1 and lower(identity)=any($2::text[]) for share`,[scope.actor,allKeys]));
  const holdSet=new Set(holds.map(x=>x.identity.toLowerCase()));
  const legacy=await partyumPhase('snapshot_legacy',()=>readHoldingLegacyEvidence(q,{...scope,channelIds:ids}));
  if(legacy?.complete!==true||!Array.isArray(legacy.channels)||!legacy.channels.every(x=>ids.includes(x)))throw Object.assign(fail('SOURCE_UNVERIFIED'),{partyumStage:'snapshot_legacy'});
  const legacyIds=new Set(legacy.channels);
  const [copy,senderRef]=[await partyumPhase('snapshot_copy',()=>activeCopy(q,scope)),await partyumPhase('snapshot_sender',()=>sender(q,scope))];
  const wakeOk=!!(await partyumPhase('snapshot_heartbeat',()=>q.query(`select 1 from ${tables}worker_health where project_id=$1 and wake_ready and ${sinceSql}`,[PROJECT]))).rows.length;
  return {scope,copy,actor:scope.actor,projectId:PROJECT,day:scope.day,complete:true,duplicatesComplete:true,mailerReady:!!senderRef&&wakeOk,mailerUnreadyStage:!senderRef?'snapshot_sender':!wakeOk?'snapshot_heartbeat':null,senderRef,
   rows:people.map(({channel_id:channelId})=>{
    const c=contacts.get(channelId),email=norm(c?.email),verified=trustedContact(c,t);
    const used=legacyIds.has(channelId)||prior.some(x=>x.channel_id===channelId||x.recipient_key===partyumRecipientKey(email));
    return {actor:scope.actor,projectId:PROJECT,day:scope.day,channelId,email,affiliation:verified?'independent':'unknown',
      contactVerified:verified,completeForCandidate:true,outreachState:used?'unknown':'found_only',recipientAvailable:!used&&!suppression(holdSet,channelId,email),
      verifiedAt:clearTime(c?.verified_at),expiresAt:clearTime(c?.expires_at),contactRevision:c?contactRevision(c):null};
   })};
 }
 async function replay(q,x){
  if(!allowed(x))throw fail('SCOPE');
  const {rows}=await q.query(`select *,day::text as day from ${tables}batches
   where owner=$1 and project_id=$2 and idempotency_key=$3`,[x.actor,PROJECT,x.idempotencyKey]);
  const r=rows[0];if(!r)return null;if(r.fingerprint!==x.fingerprint)throw fail('KEY_REUSED');
  return makeResult(r);
 }
 async function assertWorker(q,ready){
  await q.query(`insert into ${tables}worker_health(project_id,wake_ready,checked_at) values($1,$2,clock_timestamp())
   on conflict(project_id) do update set wake_ready=excluded.wake_ready,checked_at=excluded.checked_at`,[PROJECT,ready]);
 }
 const joined=(q,ids,lock=false)=>q.query(`select a.*,a.day::text as day,b.run_at,b.copy_id,b.copy_version,b.copy_digest,b.sender_ref,b.selection_digest
  from ${tables}attempts a join ${tables}batches b on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
  where a.id=any($1::uuid[]) and a.project_id=$2${lock?' for update of a':''}`,[ids,PROJECT]);
 const sameClaim=(r,x)=>r&&r.owner===x.actor&&r.project_id===x.projectId&&r.day===x.day&&r.channel_id===x.channelId&&r.batch_id===x.batchId&&r.claim_id===x.claimId&&r.id===x.attemptId;
 function viewClaim(r,copy){
  return {actor:r.owner,projectId:PROJECT,day:r.day,channelId:r.channel_id,batchId:r.batch_id,attemptId:r.id,claimId:r.claim_id,runAt:iso(r.run_at),
   snapshotDigest:r.selection_digest,copyDigest:r.copy_digest,senderRef:r.sender_ref,email:r.recipient,subject:copy?.subject,body:copy?.body};
 }
 async function validateDispatch(q,r){
  try{await members(q,r.owner);}catch{return null;}
  const t=await pgtime(q);
  if(!r.claim_expires_at||Date.parse(r.claim_expires_at)<=t||Date.parse(r.run_at)>t||
      // Avoid surprise blasts after multi-hour outages. Requires manual disposition.
      t-Date.parse(r.run_at)>POLICY.dispatchWindowMs)return null;
  const x={actor:r.owner,projectId:PROJECT,day:r.day};
  const {rows:member}=await q.query("select 1 from public.sanji_private_wedding_shortlist where owner=$1 and channel_id=$2 and project_day=$3::date for share",[r.owner,r.channel_id,r.day]);
  if(member.length!==1)return null;
  const rows=await verifiedContacts(q,x,[r.channel_id]);
  const c=rows[0];
  if(!trustedContact(c,t)||contactRevision(c)!==r.contact_revision||norm(c.email)!==r.recipient)return null;
  const suppress=identitiesFor(r.channel_id,r.recipient);
  if((await q.query("select 1 from public.sanji_suppression where owner=$1 and lower(identity)=any($2::text[]) limit 1 for share",[r.owner,suppress])).rows.length)return null;
  const legacy=await readHoldingLegacyEvidence(q,{...x,channelIds:[r.channel_id]});
  if(legacy?.complete!==true||!Array.isArray(legacy.channels)||legacy.channels.length)return null;
  const cpy=await activeCopy(q,x);
  if(!cpy||cpy.id!==r.copy_id||cpy.version!==r.copy_version||cpy.factualityReviewedDigest!==r.copy_digest||
     await partyumCopyDigest(cpy)!==r.copy_digest||await sender(q,x)!==r.sender_ref)return null;
  return cpy;
 }
 return {
  heartbeat:({ready=true}={})=>tx(q=>assertWorker(q,ready===true)),
  loadSnapshot:(scope)=>tx(async q=>readLocked(q,scope,await pgtime(q))),
  readReplay:x=>tx(async q=>{await members(q,x.actor);return replay(q,x);}),
  admitAtomic:x=>tx(async q=>{
   if(!allowed(x))throw fail('SCOPE');
   await lockOwner(q,x.actor);await members(q,x.actor);
   const prior=await replay(q,x);if(prior)return prior;
   const t=await pgtime(q);
   if(Date.parse(x.expiresAt)<=t)throw fail('PLAN_STALE');
   if(x.mode==='tomorrow'){
    const next=await q.query("select (((clock_timestamp() at time zone 'Asia/Seoul')::date+1+time '10:00') at time zone 'Asia/Seoul') as due");
    if(iso(next.rows[0].due)!==x.runAt)throw fail('PLAN_STALE');
   }
   if(x.mode==='scheduled'&&(x.runAt!==x.scheduleAt||!validWeddingScheduleAt(x.runAt,t)))throw fail('PLAN_STALE');
   const again=await recomputePartyumEligibility(await readLocked(q,x,t),x,t);
   if(again.digest!==x.snapshotDigest||again.recipients.length!==x.recipients.length||again.senderRef!==x.senderRef)throw fail('PLAN_STALE');
   const id=crypto.randomUUID();
   const {rows}=await q.query(`insert into ${tables}batches(id,owner,project_id,day,mode,run_at,recipient_count,selection_digest,copy_id,copy_version,copy_digest,sender_ref,idempotency_key,fingerprint)
    values($1,$2,$3,$4::date,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14) returning *,day::text as day`,
    [id,x.actor,PROJECT,x.day,x.mode,x.runAt,again.recipients.length,again.digest,again.copy.id,again.copy.version,again.copy.digest,again.senderRef,x.idempotencyKey,x.fingerprint]);
   for(const r of again.recipients)await q.query(`insert into ${tables}attempts(id,owner,project_id,day,batch_id,channel_id,recipient,recipient_key,contact_revision,state)
    values($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,[crypto.randomUUID(),x.actor,PROJECT,x.day,id,r.channelId,r.email,r.recipientKey,r.contactRevision,sched(x.mode)]);
   if(x.mode==='now')await q.query("select pg_notify('sanji_partyum_due',$1)",[id]); // notifications fire only after commit
   return makeResult(rows[0]);
  }),
  async claimDue({projectId,limit}){
   if(projectId!==PROJECT||!Number.isSafeInteger(limit)||limit<1||limit>10)throw fail('SCOPE');
   return tx(async q=>{
    if((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`,[PROJECT])).rows.length)return [];
    const {rows:due}=await q.query(`select a.id from ${tables}attempts a join ${tables}batches b
     on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
     where a.project_id=$1 and b.run_at<=clock_timestamp()
     and (a.state in ('queued','scheduled') or (a.state='claimed' and a.intent_id is null and a.claim_expires_at<clock_timestamp()))
     order by b.run_at, a.id limit $2 for update of a skip locked`,[PROJECT,limit]);
    if(!due.length)return [];
    for(const {id} of due)await q.query(`update ${tables}attempts set state='claimed',claim_id=$1,claim_expires_at=clock_timestamp()+interval '90 seconds',
     state_at=clock_timestamp() where id=$2 and project_id=$3`,[crypto.randomUUID(),id,PROJECT]);
    const {rows}=await joined(q,due.map(x=>x.id));
    return Promise.all(rows.map(async r=>viewClaim(r,await validateDispatch(q,r))));
   });
  },
  reverify:x=>tx(async q=>{
   const r=(await joined(q,[x.attemptId])).rows[0];
   if(!sameClaim(r,x)||r.state!=='claimed')return {verified:false};
   const copy=await validateDispatch(q,r);if(!copy)return {verified:false};
   return {...viewClaim(r,copy),verified:true,duplicatesComplete:true,recipientAvailable:true};
  }),
  startDispatch:async x=>{
   // Independent short rate reservation; a stale hold can consume a slot but can
   // never increase the scope. The lock serializes the READ COMMITTED ledger.
   const admittedRate=await tx(async q=>{
    await q.query("select pg_advisory_xact_lock(hashtextextended('sanji-partyum-dispatch-rate',0))");
    if((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`,[PROJECT])).rows.length)return false;
    await q.query(`delete from ${tables}dispatch_rate_slots where project_id=$1 and started_at<clock_timestamp()-interval '2 minutes'`,[PROJECT]);
    const recent=await q.query(`select count(*)::int as n from ${tables}dispatch_rate_slots where project_id=$1 and started_at>clock_timestamp()-interval '1 minute'`,[PROJECT]);
    if(recent.rows[0]?.n>=POLICY.dispatchRateMax)return false;
    await q.query(`insert into ${tables}dispatch_rate_slots(project_id,id,started_at) values($1,$2,clock_timestamp())`,[PROJECT,crypto.randomUUID()]);
    return true;
   },false);
   if(!admittedRate)return null;
   return tx(async q=>{
    const r=(await joined(q,[x.attemptId],true)).rows[0];
    if(!sameClaim(r,x)||r.state!=='claimed'||r.intent_id||x.snapshotDigest!==r.selection_digest||!await validateDispatch(q,r))return null;
    if((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`,[PROJECT])).rows.length)return null;
    const id=crypto.randomUUID();
    const y=await q.query(`update ${tables}attempts set state='dispatching',intent_id=$1,dispatch_started_at=clock_timestamp(),state_at=clock_timestamp()
     where id=$2 and project_id=$3 and owner=$4 and claim_id=$5 and state='claimed' returning id`,[id,r.id,PROJECT,r.owner,x.claimId]);
    return y.rows.length?{committed:true,id,attemptId:r.id}:null;
   }).catch(e=>{if(e.code==='PLAN_STALE')return null;throw e;});
  },
  cooldown:seconds=>tx(async q=>{
   const safe=Number.isFinite(seconds)?Math.max(30,Math.min(300,Math.floor(seconds))):60;
   await q.query(`update ${tables}worker_health set cooldown_until=greatest(coalesce(cooldown_until,clock_timestamp()),clock_timestamp()+make_interval(secs=>$2::int))
    where project_id=$1`,[PROJECT,safe]);
  }),
  finalize:x=>tx(async q=>{
   const r=(await joined(q,[x.attemptId],true)).rows[0];
   if(!sameClaim(r,x))throw fail('ADMISSION_UNVERIFIED');
   const review=x.state==='review_required'&&r.state==='claimed'&&!r.intent_id&&!x.intentId;
   const dispatched=['accepted','failed','unknown'].includes(x.state)&&r.state==='dispatching'&&x.intentId&&x.intentId===r.intent_id;
   if(!review&&!dispatched)throw fail('ADMISSION_UNVERIFIED');
   const provider=x.state==='accepted'?x.providerId:null,acceptedAt=x.state==='accepted'?x.at:null;
   await q.query(`update ${tables}attempts set state=$1,provider_id=$2,provider_accepted_at=$3,state_at=clock_timestamp()
    where id=$4 and project_id=$5 and owner=$6 and claim_id=$7`,[x.state,provider,acceptedAt,r.id,PROJECT,r.owner,r.claim_id]);
  }),
  readStatusEvidence:x=>tx(async q=>{
   if(!allowed(x)||!Array.isArray(x.channelIds)||x.channelIds.length<1||x.channelIds.length>100||
      !x.channelIds.every(id=>typeof id==='string'&&channel.test(id)))throw fail('SCOPE');
   await members(q,x.actor);
   const {rows:short}=await q.query("select channel_id from public.sanji_private_wedding_shortlist where owner=$1 and project_day=$2::date and channel_id=any($3::text[])",[x.actor,x.day,x.channelIds]);
   if(short.length!==x.channelIds.length)throw fail('SCOPE');
   const {rows}=await q.query(`select a.channel_id,a.state,a.state_at,a.intent_id,a.provider_id,a.provider_accepted_at,b.run_at
     from ${tables}attempts a join ${tables}batches b on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
     where a.owner=$1 and a.project_id=$2 and a.day=$3::date and a.channel_id=any($4::text[])`,[x.actor,PROJECT,x.day,x.channelIds]);
   const t=await pgtime(q);
   return new Map(rows.map(r=>{
    if(r.state==='accepted'&&r.intent_id&&r.provider_id&&r.provider_accepted_at)return [r.channel_id,{status:'sent',at:iso(r.provider_accepted_at),completeForCandidate:true}];
    if(r.state==='scheduled'&&Date.parse(r.run_at)>t)return [r.channel_id,{status:'scheduled',at:iso(r.run_at),completeForCandidate:true}];
    if(r.state==='failed'&&r.intent_id)return [r.channel_id,{status:'failed',at:iso(r.state_at),completeForCandidate:true}];
    // A queued/held/unknown attempt is not an available discovery-only recipient.
    return [r.channel_id,{status:'unknown',at:null,completeForCandidate:false}];
   }));
  }),
 };
}
