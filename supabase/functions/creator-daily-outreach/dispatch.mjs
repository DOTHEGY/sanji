import {randomUUID} from 'node:crypto';
import {OutreachError,emailIdentity,outreachDay,qualifyOutreachCandidate,renderOutreachCopy,sourceUrl} from './domain.mjs';
import {composeInlineOutreach} from './inline-mail.mjs';
import {CAMPAIGN_CLASSIFICATIONS,createPrivateSnapshot,verifyPrivateSnapshot,requireRecipientCriteria,campaignPolicy,recipientBasis,settingsSignature,stableJSON,hashValue} from './private-config.mjs';
const fail=(code,status=409)=>{throw new OutreachError(code,'캠페인 설정과 발송 전 검토가 필요합니다.',status);};
const exactKeys=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('INVALID_CAMPAIGN_REQUEST',400);};
const revision=input=>{if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('CAMPAIGN_REVISION_REQUIRED',400);return input.expectedRevision;};
const terminal=new Set(['accepted','rejected','outcome_unknown','cancelled']);
const enabled=(env,name)=>env(name)==='true';
const readReason=error=>/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(error?.code||error?.message||'')?(error.code||error.message).toLowerCase():'preflight_failed';

export function freshHistory(proof,{address,senderEmail,now}){
 const at=Date.parse(proof?.checkedAt);
 if(!proof||proof.clear!==true||proof.address!==address||proof.emailKey!==emailIdentity(address)||proof.senderEmail!==senderEmail||!Number.isFinite(at)||at>now||at<now-60000)fail('GMAIL_HISTORY_UNVERIFIED');
 return proof;
}
export function campaignDue(schedule,now=Date.now()){
 if(schedule?.confirmed!==true||schedule.timezone!=='Asia/Seoul')return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
 const hour=Number(parts.find(p=>p.type==='hour').value),minute=Number(parts.find(p=>p.type==='minute').value);
 return hour*60+minute>=schedule.hour*60+schedule.minute;
}

// Server-only campaign adapter. The legacy solicited Instagram worker and all
// legacy validators remain untouched. This is not an arbitrary-send endpoint.
export function createDailyDispatch({repository,provider,env=()=>'',now=Date.now,uuid=randomUUID,recurringTriggerVerified=()=>false}){
 const flags=()=>({configurationEnabled:enabled(env,'CREATOR_DAILY_CONFIGURATION_ENABLED'),dispatchEnabled:enabled(env,'CREATOR_DAILY_DISPATCH_ENABLED'),schedulerDeploymentEnabled:enabled(env,'CREATOR_DAILY_SCHEDULER_ENABLED'),mailDeploymentEnabled:enabled(env,'EMAIL_SENDING_ENABLED')});
 function policyBlockers(p){const b=[],f=flags();if(!f.configurationEnabled)b.push('private_configuration_disabled');if(!p?.snapshot_id)b.push('private_template_required');if(!CAMPAIGN_CLASSIFICATIONS.includes(p?.data?.classification))b.push(p?.data?.classification==='marketing'?'marketing_adapter_review_required':'message_classification_required');if(!p?.data?.classificationSource)b.push('classification_source_required');if(!p?.data?.authorizationSource)b.push('authorization_source_required');if(p?.data?.schedule?.confirmed!==true)b.push('schedule_time_review_required');if(!f.dispatchEnabled)b.push('dispatch_deployment_disabled');if(!f.schedulerDeploymentEnabled)b.push('scheduler_deployment_disabled');if(!f.mailDeploymentEnabled)b.push('email_sending_disabled');return b;}
 async function configuration(owner){
  const p=await repository.policy(owner),f=flags(),blockers=policyBlockers(p);
  let savedConnection=null;try{savedConnection=await repository.currentConnection(owner);}catch{}
  const gmailConnectionStatus=savedConnection?.summary?.reauthRequired===true?'reauth_required':emailIdentity(savedConnection?.summary?.email)?'connected':'unavailable';
  const gmailConnected=gmailConnectionStatus==='connected';
  let productMode='unconfigured';
  if(p?.snapshot_id){try{const row=await repository.snapshot(owner,p.snapshot_id),s=verifyPrivateSnapshot(row,owner);productMode=s.productMode||'catalog';requireRecipientCriteria(s);if(s.productMode!=='approved_campaign_assets'&&s.products.length!==2)blockers.push('product_scope_missing');const [settings,connection,products]=await Promise.all([repository.currentSettings(owner),Promise.resolve(savedConnection),s.products.length?repository.currentProducts(owner,s.products.map(p=>p.id)):Promise.resolve([])]);if(stableJSON(settingsSignature(settings,connection))!==stableJSON(s.signature))blockers.push('current_gmail_signature_changed');if(stableJSON(products.map(({id,version,sha256})=>({id,version,sha256})).sort((a,b)=>a.id.localeCompare(b.id)))!==stableJSON([...s.products].sort((a,b)=>a.id.localeCompare(b.id))))blockers.push('product_scope_changed');}catch(error){blockers.push(readReason(error));}}
  const ready=blockers.length===0,triggerVerified=await recurringTriggerVerified(owner)===true;
  return {state:p?.enabled&&p?.send_enabled&&ready?(triggerVerified?'active':'dispatch_ready_without_trigger'):p?.snapshot_id?'paused_or_blocked':'unconfigured',...f,revision:p?.revision||0,snapshotId:p?.snapshot_id||null,productMode,configured:Boolean(p?.snapshot_id),gmailConnected,gmailConnectionStatus,gmailConnectionCheck:'saved_connection_summary',gmailLiveVerified:false,classification:p?.data?.classification||'pending_review',schedule:p?.data?.schedule||{timezone:'Asia/Seoul',hour:9,minute:0,confirmed:false},cutoverAt:p?.cutover_at||null,enabled:p?.enabled===true,sendEnabled:p?.send_enabled===true,policyEnabled:p?.enabled===true,recurringTriggerVerified:triggerVerified,schedulerEnabled:p?.enabled===true&&ready&&triggerVerified,sendingEnabled:p?.enabled===true&&p?.send_enabled===true&&ready,recipientReviewRequired:true,blockers:[...new Set(blockers)],noHistoricalBackfill:true};
 }
 async function configure(owner,input){
  exactKeys(input,['expectedRevision','snapshot','policy']);revision(input);if(!flags().configurationEnabled)fail('PRIVATE_CONFIGURATION_DISABLED',503);
  const ids=input.snapshot?.products?.map(p=>p.id);if(!Array.isArray(ids)||![0,2].includes(ids.length))fail('PRODUCT_SCOPE_REQUIRED');
  const [settings,connection,products]=await Promise.all([repository.currentSettings(owner),repository.currentConnection(owner),ids.length?repository.currentProducts(owner,ids):Promise.resolve([])]);
  const snapshot=createPrivateSnapshot(input.snapshot,{owner,settings,connection,products}),policy=campaignPolicy(input.policy);
  await repository.configure(owner,input.expectedRevision,{id:uuid(),data:snapshot},policy);
  return configuration(owner);
 }
 async function schedule(owner,input){
  exactKeys(input,['expectedRevision']);revision(input);const c=await configuration(owner);if(c.revision!==input.expectedRevision)fail('CAMPAIGN_REVISION_CHANGED');if(c.blockers.length)fail(c.blockers[0].toUpperCase());
  await repository.schedule(owner,input.expectedRevision);return configuration(owner);
 }
 async function pause(owner,input){exactKeys(input,['expectedRevision']);revision(input);await repository.pause(owner,input.expectedRevision);return configuration(owner);}
 async function reviewRecipient(owner,input){
  exactKeys(input,['expectedRevision','creatorKey','recipient','kind','classification','classificationSource','sourceUrl','sourceText','verifiedAt','expiresAt','approvalSource','status']);revision(input);
  if(!flags().configurationEnabled)fail('PRIVATE_CONFIGURATION_DISABLED',503);
  if(!/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(input.creatorKey||'')||!emailIdentity(input.recipient)||input.recipient!==input.recipient.trim().toLowerCase()||!['approved','revoked'].includes(input.status))fail('RECIPIENT_REVIEW_REQUIRED');
  const p=await repository.policy(owner);if(p?.revision!==input.expectedRevision||!p.snapshot_id)fail('CAMPAIGN_REVISION_CHANGED');
  if(input.status==='approved'){
   const expectedKind=p.data?.classification==='solicited_non_marketing_proposal'?'solicited_proposal':'documented_business_proposal';
   if(!CAMPAIGN_CLASSIFICATIONS.includes(input.classification)||input.classification!==p.data?.classification||input.kind!==expectedKind||!sourceUrl(input.sourceUrl)||!['sourceText','classificationSource','approvalSource'].every(k=>typeof input[k]==='string'&&input[k].trim()&&input[k].length<=4000)||!Number.isFinite(Date.parse(input.verifiedAt))||Date.parse(input.verifiedAt)>now()||Date.parse(input.verifiedAt)<now()-30*86400000||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=now())fail('RECIPIENT_BASIS_REQUIRED');
  }
  const {expectedRevision,...review}=input;await repository.reviewBasis(owner,expectedRevision,review);return {status:input.status,creatorKey:input.creatorKey,revision:expectedRevision};
 }
 async function finish(owner,job,reservation,status,receipt){
  try{return await repository.finalize(owner,job,reservation,status,receipt);}catch{
   try{const current=await repository.current(owner,job.creator_key);if(terminal.has(current?.status))return {status:current.status,reconciled:true};}catch{}
   return {status:'outcome_unknown',reason:'receipt_reconciliation_required'};
  }
 }
 async function processOne(owner){
  // All deployment gates precede claim/provider access. Test fixtures enable
  // flags explicitly and inject mocks; no production defaults can send.
  const f=flags();if(!f.dispatchEnabled||!f.schedulerDeploymentEnabled||!f.mailDeploymentEnabled||!f.configurationEnabled)return {status:'disabled'};
  const job=await repository.claim(owner);if(!job)return {status:'idle'};
  let reservation=null,sendInvoked=false,grantReturned=false;
  const hold=reason=>repository.hold(owner,job,reason);
  try{
   if(job.owner!==owner)fail('QUEUE_OWNER_MISMATCH');
   const p=await repository.policy(owner);if(!p?.enabled||!p.send_enabled||p.revision!==job.policy_revision||p.snapshot_id!==job.snapshot_id||policyBlockers(p).length)return await hold('authorization_changed');
   const c=await repository.candidate(owner,job.creator_key);
   if(!c||c.owner!==owner||c.creator_key!==job.creator_key||c.day!==outreachDay(now())||c.day!==job.day||!Number.isFinite(Date.parse(c.created))||!Number.isFinite(Date.parse(p.cutover_at))||Date.parse(c.created)<Date.parse(p.cutover_at)||Date.parse(c.created)>now()||!Number.isFinite(Date.parse(c.expires_at))||Date.parse(c.expires_at)<=now()||c.recipient!==job.recipient)return await hold('candidate_cutover_or_expiry');
   if(c.snapshot?.apiSnapshot){
    if(!Number.isFinite(Date.parse(c.snapshot.apiSnapshot.expiresAt))||Date.parse(c.snapshot.apiSnapshot.expiresAt)<=now())return await hold('api_snapshot_expired');
    if(c.snapshot.apiSnapshot.titleFromApi===true){const e=c.snapshot.displayNameEvidence,url=sourceUrl(e?.sourceUrl);if(!e||e.name!==c.snapshot.name||e.verified!==true||!['official_website','provided_by_creator'].includes(e.kind)||!url||/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname)||typeof e.sourceText!=='string'||!e.sourceText.includes(e.name)||!Number.isFinite(Date.parse(e.checkedAt))||Date.parse(e.checkedAt)>now()||Date.parse(e.checkedAt)<now()-30*86400000||!c.snapshot.contact?.affiliation?.verified||c.snapshot.contact.affiliation.creatorKey!==c.creator_key)return await hold('manual_display_name_required');}
   }
   const snapshot=await repository.snapshot(owner,job.snapshot_id),s=verifyPrivateSnapshot(snapshot,owner);requireRecipientCriteria(s);if(s.productMode!=='approved_campaign_assets'&&s.products.length!==2)return await hold('product_scope_missing');
   const [current,basis,settings,connection,products]=await Promise.all([repository.currentCandidate(owner,c),repository.basis(owner,c.creator_key,c.recipient),repository.currentSettings(owner),repository.currentConnection(owner),s.products.length?repository.currentProducts(owner,s.products.map(p=>p.id)):Promise.resolve([])]);
   const q=current?.candidate&&qualifyOutreachCandidate(current.candidate,now());
   const {status:ignored,expiresAt:ignoredExpiry,...prepared}=c.snapshot;
   if(!q?.eligible||q.contactReason||stableJSON(q.candidate)!==stableJSON(prepared))return await hold('current_candidate_evidence_changed');
   if(!recipientBasis(basis,{owner,candidate:c,policy:p,snapshot,now:now()}))return await hold('recipient_basis_required');
   if(stableJSON(settingsSignature(settings,connection))!==stableJSON(s.signature))return await hold('current_gmail_signature_changed');
   if(stableJSON(products.map(({id,version,sha256})=>({id,version,sha256})).sort((a,b)=>a.id.localeCompare(b.id)))!==stableJSON([...s.products].sort((a,b)=>a.id.localeCompare(b.id))))return await hold('product_scope_changed');
   const copy=renderOutreachCopy({template:s.template,channelName:c.snapshot.name,signature:s.signature,inlineImages:s.images}),messageId=uuid();
   const mime=composeInlineOutreach({copy,images:s.images,owner,requiredImageIds:s.template.requiredInlineImageIds,from:s.signature.senderEmail,to:c.recipient,senderName:s.signature.senderName,messageId,now:now()});
   const rawHash=hashValue(mime.raw);
   const first=await provider.history({owner,address:c.recipient,senderEmail:s.signature.senderEmail});freshHistory(first.proof,{address:c.recipient,senderEmail:s.signature.senderEmail,now:now()});
   const plan={recipientCriteria:s.recipientCriteria,snapshotId:snapshot.id,snapshotHash:snapshot.sha256,scopeHash:s.scopeHash,subject:copy.subject,body:copy.body,signatureText:s.signature.text,signatureHtml:s.signature.html,senderEmail:s.signature.senderEmail,senderName:s.signature.senderName,settingsId:s.signature.settingsId,settingsVersion:s.signature.settingsVersion,products:s.products,...(s.productMode!==undefined?{productMode:s.productMode}:{}),...(s.productMode==='approved_campaign_assets'?{campaignProducts:s.campaignProducts}:{}),inlineImages:s.template.requiredInlineImageIds.map(id=>{const x=s.images.find(i=>i.id===id);return {id,sha256:x.sha256,bytes:x.bytes};}),messageId,rawHash,gmailHistory:first.proof,...(current.version?{candidateVersion:current.version}:{}),...(current.updated?{sourceUpdated:current.updated}:{})};
   reservation=await repository.reserve(owner,job,plan);
   if(reservation?.duplicate||reservation?.status!=='reserved'||!reservation?.outbox?.id||!reservation?.reservationToken)return {status:'outcome_unknown',reason:'reservation_reconciliation_required'};
   let latest,grant,grantRequested=false;
   try{
    latest=await provider.history({owner,address:c.recipient,senderEmail:s.signature.senderEmail});freshHistory(latest.proof,{address:c.recipient,senderEmail:s.signature.senderEmail,now:now()});
    if(Date.parse(basis.expires_at)<=now())fail('RECIPIENT_BASIS_EXPIRED');
    grantRequested=true;grant=await repository.beginSend(owner,job,reservation,latest.proof,rawHash);grantReturned=true;
    if(grant?.ready!==true||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now()||Date.parse(grant.expiresAt)>now()+16000)fail('SEND_GRANT_EXPIRED');
    freshHistory(latest.proof,{address:c.recipient,senderEmail:s.signature.senderEmail,now:now()});
   }catch{
    // An uncertain begin-send result is NOT a recoverable send permission.
    // A non-ready duplicate grant must never downgrade an in-flight attempt.
    return await finish(owner,job,reservation,!grantRequested?'cancelled':'outcome_unknown',{reason:'preflight_changed_no_send'});
   }
   try{
    if(hashValue(mime.raw)!==rawHash||Date.parse(grant.expiresAt)<=now())fail('SEND_GRANT_EXPIRED');
    sendInvoked=true;
    const receipt=await provider.send({owner,raw:mime.raw,rawHash,senderEmail:s.signature.senderEmail,address:c.recipient,session:latest.session,grant});
    if(!receipt||!['id','threadId'].every(k=>typeof receipt[k]==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(receipt[k])))throw Error('provider_receipt_missing');
    return await finish(owner,job,reservation,'accepted',{id:receipt.id,threadId:receipt.threadId});
   }catch(error){return await finish(owner,job,reservation,sendInvoked&&[400,401,403,404,429].includes(error?.status)?'rejected':'outcome_unknown',{reason:sendInvoked?'provider_outcome_unknown':'grant_issued_without_provider_receipt'});}
  }catch(error){
   // reserve() may have committed even if its response never arrived. No
   // recovered reservation is sent and no uncertain operation is retried.
   try{const current=await repository.current(owner,job.creator_key);if(terminal.has(current?.status))return {status:current.status,reconciled:true};if(current?.outbox_id||current?.status==='reserved')return {status:'outcome_unknown',reason:'reservation_reconciliation_required'};}catch{return {status:'outcome_unknown',reason:'queue_reconciliation_required'};}
   return await hold(readReason(error));
  }
 }
 async function run(owner,{maxItems=2,budgetMs=20000}={}){
  if(!Number.isInteger(maxItems)||maxItems<1||maxItems>60||!Number.isFinite(budgetMs)||budgetMs<1||budgetMs>45000)fail('INVALID_WORKER_BUDGET',400);
  const p=await repository.policy(owner),f=flags();if(!f.configurationEnabled||!f.dispatchEnabled||!f.schedulerDeploymentEnabled||!f.mailDeploymentEnabled||!p?.enabled||!p.send_enabled)return {processed:0,accepted:0,held:0,uncertain:0,status:'disabled'};
  if(!campaignDue(p.data?.schedule,now()))return {processed:0,accepted:0,held:0,uncertain:0,status:'not_due'};
  await repository.sync(owner);const started=now(),results=[];
  while(results.length<maxItems&&now()-started<budgetMs){const r=await processOne(owner);if(['idle','disabled'].includes(r.status))break;results.push(r);}
  return {processed:results.length,accepted:results.filter(r=>r.status==='accepted').length,held:results.filter(r=>['held','cancelled'].includes(r.status)).length,uncertain:results.filter(r=>r.status==='outcome_unknown').length,status:'completed_pass'};
 }
 return {configuration,configure,schedule,pause,reviewRecipient,recipientReviews:owner=>repository.recipientReviews(owner),runs:owner=>repository.runs(owner),processOne,run};
}
