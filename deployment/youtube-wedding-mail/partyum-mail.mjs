export const PROJECT='private-wedding-research';
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UC=/^UC[A-Za-z0-9_-]{22}$/;
const ADDRESS=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const enc=new TextEncoder();
const dec=new TextDecoder('utf-8',{fatal:true});
const FAIL=(code)=>Object.assign(new Error(code),{code});
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().startsWith(x);
const iso=v=>new Date(v).toISOString();
const maxRows=100;
const ttl=120000;
const canonical=b=>JSON.stringify(b);
const dayAt=(t)=>iso(t+9*3600000).slice(0,10);
const runAtFor=(mode,t)=>mode==='now'?iso(t):iso(Date.parse(dayAt(t)+'T01:00:00Z')+86400000);
const b64=a=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const bytes=x=>typeof x==='string'?enc.encode(x):x;
const isDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const tokenRE=/^[A-Za-z0-9_-]{12,1500}\.[A-Za-z0-9_-]{43}$/;
const normal=x=>typeof x==='string'?x.trim().toLowerCase():'';
export function partyumRecipientKey(value){
 const email=normal(value);
 if(!ADDRESS.test(email)||email.length>254)return '';
 const [local,domain]=email.split('@');
 if(!['gmail.com','googlemail.com'].includes(domain))return email;
 const base=local.split('+')[0].replaceAll('.','');
 return base?base+'@gmail.com':'';
}
const hash=async(x)=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(canonical(x)))));
const exact=(obj,keys)=>obj&&Object.getPrototypeOf(obj)===Object.prototype&&Object.keys(obj).sort().join(',')===[...keys].sort().join(',');
function inputScope(v,action,now){
 const keys=['action','projectId','day','channelIdsExcluded','mode'];
 const submit=['planId','expectedRecipientCount','expectedRunAt','idempotencyKey'];
 if(!exact(v,action==='submit'?[...keys,...submit]:keys)||v.action!==action||v.projectId!==PROJECT||
    !['now','tomorrow'].includes(v.mode)||!validDay(v.day)||v.day>dayAt(now)||
    !Array.isArray(v.channelIdsExcluded)||v.channelIdsExcluded.length>maxRows||
    !v.channelIdsExcluded.every(x=>typeof x==='string'&&UC.test(x))||
    new Set(v.channelIdsExcluded).size!==v.channelIdsExcluded.length)throw FAIL('SCOPE');
 if(action==='submit'&&(!KEY.test(v.idempotencyKey)||!tokenRE.test(v.planId)||
     !Number.isSafeInteger(v.expectedRecipientCount)||v.expectedRecipientCount<1||v.expectedRecipientCount>maxRows||
     !isDate(v.expectedRunAt)))throw FAIL('SCOPE');
 return {projectId:PROJECT,day:v.day,mode:v.mode,channelIdsExcluded:[...v.channelIdsExcluded].sort()};
}
function auth(actor){
 if(typeof actor!=='string'||!OWNER.test(actor))throw FAIL('AUTH');
 return actor;
}
export async function recomputePartyumEligibility(snapshot,scope,now){
 const {actor,projectId,day,channelIdsExcluded}=scope;
 if(!snapshot||snapshot.actor!==actor||snapshot.projectId!==projectId||snapshot.day!==day||
    snapshot.complete!==true||snapshot.duplicatesComplete!==true||!Array.isArray(snapshot.rows)||
    snapshot.rows.length>maxRows||snapshot.mailerReady!==true)throw FAIL('SOURCE_UNVERIFIED');
 const c=snapshot.copy;
 if(!c||c.actor!==actor||c.projectId!==projectId||c.purpose!=='youtube_project_copy_wedding'||
    c.active!==true||!Number.isSafeInteger(c.version)||c.version<1||typeof c.id!=='string'||!c.id||
    typeof c.subject!=='string'||!c.subject.trim()||c.subject.length>200||/[\r\n]/.test(c.subject)||
    typeof c.body!=='string'||!c.body.trim()||c.body.length>20000)throw FAIL('COPY_UNAVAILABLE');
 // No rewritten/fabricated familiarity. Policy approval is server-bound to the exact copy digest.
 const copyDigest=await hash([c.id,c.version,c.subject,c.body]);
 if(c.factualityReviewedDigest!==copyDigest)throw FAIL('COPY_REVIEW_REQUIRED');
 const all=new Map();
 const byAddress=new Map();
 for(const r of snapshot.rows){
  if(!r||r.actor!==actor||r.projectId!==projectId||r.day!==day||typeof r.channelId!=='string'||
    !UC.test(r.channelId)||all.has(r.channelId))throw FAIL('SOURCE_UNVERIFIED');
  all.set(r.channelId,r);
  const address=partyumRecipientKey(r.email);
  if(address){
   const matching=byAddress.get(address)??[];
   matching.push(r.channelId);byAddress.set(address,matching);
  }
 }
 if(channelIdsExcluded.some(id=>!all.has(id)))throw FAIL('INVALID_EXCLUSION');
 const skip=new Set(channelIdsExcluded);
 const recipients=[];
 for(const [channelId,r] of all){
  if(skip.has(channelId))continue;
  const email=normal(r.email),recipientKey=partyumRecipientKey(email);
  if(r.affiliation!=='independent'||r.contactVerified!==true||r.outreachState!=='found_only'||
     r.completeForCandidate!==true||r.recipientAvailable!==true||
     !recipientKey||byAddress.get(recipientKey)?.length!==1||
     !isDate(r.verifiedAt)||Date.parse(r.verifiedAt)>now||
     !isDate(r.expiresAt)||Date.parse(r.expiresAt)<=now||typeof r.contactRevision!=='string'||!r.contactRevision)continue;
  recipients.push({channelId,email,recipientKey,contactRevision:r.contactRevision});
 }
 recipients.sort((a,b)=>a.channelId.localeCompare(b.channelId,'en'));
 const senderRef=snapshot.senderRef??'';
 const digest=await hash([actor,day,channelIdsExcluded,copyDigest,senderRef,recipients]);
 return {recipients,digest,senderRef,copy:{id:c.id,version:c.version,digest:copyDigest,subject:c.subject,body:c.body}};
}
export async function partyumCopyDigest(c){ return hash([c.id,c.version,c.subject,c.body]); }
export function createPartyumMail({secret,loadSnapshot,admitAtomic,readReplay,now=Date.now}){
 const keyBytes=bytes(secret);
 if(!(keyBytes instanceof Uint8Array)||keyBytes.byteLength<32)throw FAIL('NOT_CONFIGURED');
 // Keys are scoped to this Edge. The signer never uses user material or exposes addresses/copy in the token.
 let keyPromise;
 const key=()=>keyPromise??=(crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']));
 async function sign(claim){
  const p=b64(enc.encode(canonical(claim)));
  return p+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(),enc.encode(p))));
 }
 async function verified(token){
  try{
   const [p,s]=token.split('.');
   if(!await crypto.subtle.verify('HMAC',await key(),unb64(s),enc.encode(p)))throw FAIL('INVALID_PLAN');
   return JSON.parse(dec.decode(unb64(p)));
  }catch{throw FAIL('INVALID_PLAN');}
 }
 const runScope=(actor,input,current)=>({...inputScope(input,input?.action,current),actor});
 return async (actor,input)=>{
  auth(actor);
  if(!['plan','submit'].includes(input?.action))throw FAIL('SCOPE');
  const t=now();
  const scope=runScope(actor,input,t),scopeDigest=await hash(scope);
  if(input.action==='plan'){
   const e=await recomputePartyumEligibility(await loadSnapshot(scope),scope,t);
   const runAt=runAtFor(scope.mode,t),expiresAt=iso(t+ttl),recipientCount=e.recipients.length;
   const planId=await sign({scopeDigest,runAt,expiresAt,recipientCount,digest:e.digest});
   return {projectId:PROJECT,day:scope.day,mode:scope.mode,recipientCount,runAt,expiresAt,copyVersion:e.copy.version,planId};
  }
  const claim=await verified(input.planId);
  if(claim.scopeDigest!==scopeDigest||claim.runAt!==input.expectedRunAt||
     claim.recipientCount!==input.expectedRecipientCount)throw FAIL('INVALID_PLAN');
  const fingerprint=await hash([scopeDigest,claim.digest,claim.runAt,claim.recipientCount]);
  // Only a previously admitted replay may return after plan expiry. Key reuse never creates a new outbox.
  const previous=await readReplay({actor,projectId:PROJECT,idempotencyKey:input.idempotencyKey,fingerprint});
  if(previous)return projectResult(previous,scope,claim);
  if(!isDate(claim.expiresAt)||Date.parse(claim.expiresAt)<=t||
     (scope.mode==='tomorrow'&&claim.runAt!==runAtFor(scope.mode,t)))throw FAIL('PLAN_STALE');
  const e=await recomputePartyumEligibility(await loadSnapshot(scope),scope,t);
  if(e.digest!==claim.digest||e.recipients.length!==claim.recipientCount)throw FAIL('PLAN_STALE');
  // Final adapter MUST recompute in one serializable transaction with dedup ledger and bind proof.
  // Never wire to a send function or an unchecked write. The adapter returns only durable admission.
  const result=await admitAtomic({...scope,runAt:claim.runAt,expiresAt:claim.expiresAt,
   fingerprint,idempotencyKey:input.idempotencyKey,snapshotDigest:e.digest,
   copy:e.copy,senderRef:e.senderRef,recipients:e.recipients});
  return projectResult(result,scope,claim);
 };
}
function projectResult(r,scope,claim){
 if(!r||r.actor!==scope.actor||r.projectId!==PROJECT||r.day!==scope.day||r.mode!==scope.mode||
    r.runAt!==claim.runAt||r.recipientCount!==claim.recipientCount||typeof r.batchId!=='string'||!r.batchId||
    (scope.mode==='now'?r.state!=='queued':r.state!=='scheduled'))throw FAIL('ADMISSION_UNVERIFIED');
 return {projectId:PROJECT,day:r.day,mode:r.mode,recipientCount:r.recipientCount,runAt:r.runAt,batchId:r.batchId,state:r.state};
}
