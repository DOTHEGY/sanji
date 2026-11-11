// Local-only preview candidate. The repository must be server-side and owner scoped.
// No route, storage mutation, Gmail access, or permission to send is provided here.
import {renderYoutubeOutreachCopy} from './youtube-greeting.mjs';
import {verifyPrivateSnapshot,settingsSignature,stableJSON} from './private-config.mjs';
import {createSharedInlinePreview} from '../youtube-manual-mail/inline-mail.mjs';
import {buildManualReview} from './youtube-manual-review.mjs';
import {classifyManualRecipient} from './manual-email-cutoff.mjs';
import {manualMailPolicy} from '../youtube-manual-mail/policy.mjs';
import {manualYoutubeTarget} from '../youtube-manual-mail/target.mjs';
import {validateProjectScope,belongsToProjectDay} from '../youtube-manual-mail/project-scope.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function createYoutubeManualPrepare({repository,now=Date.now}){
 return async function prepare(owner,input){
  if(typeof owner!=='string'||!owner||!input||Object.keys(input).some(k=>!['expectedRevision','recipients','scope'].includes(k))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Array.isArray(input.recipients)||!input.recipients.length||input.recipients.length>100)fail('INVALID_SELECTION');
  const scope=input.scope===undefined?undefined:validateProjectScope(input.scope);
  const ids=new Set();for(const r of input.recipients){if(!r||Object.keys(r).some(k=>!['id','version','email'].includes(k))||typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.version)||r.version<1||typeof r.email!=='string'||ids.has(r.id))fail('INVALID_SELECTION');ids.add(r.id);}
  const policy=await repository.policy(owner);if(policy?.owner!==owner||policy.revision!==input.expectedRevision||!policy.snapshot_id)fail('SNAPSHOT_CHANGED');const mailPolicy=manualMailPolicy(policy,owner,input.expectedRevision);
  const [stored,settings,connection,history]=await Promise.all([repository.snapshot(owner,policy.snapshot_id),repository.currentSettings(owner),repository.currentConnection(owner),repository.manualHistory(owner,input.recipients.map(r=>r.email.trim().toLowerCase()))]);
  const snapshot=verifyPrivateSnapshot(stored,owner);
  if(snapshot.products.length){const products=await repository.currentProducts(owner,snapshot.products.map(p=>p.id));if(!Array.isArray(products)||stableJSON(products.map(({id,version,sha256})=>({id,version,sha256})).sort((a,b)=>a.id.localeCompare(b.id)))!==stableJSON([...snapshot.products].sort((a,b)=>a.id.localeCompare(b.id))))fail('PRODUCT_SCOPE_CHANGED');}
  if(stableJSON(settingsSignature(settings,connection))!==stableJSON(snapshot.signature))fail('SENDER_CHANGED');
  if(!history||history.owner!==owner||history.complete!==true||history.scope!=='manual_youtube_task'||history.refusalsComplete!==true||!Array.isArray(history.records)||!Array.isArray(history.suppressedKeys)||!Array.isArray(history.refusedKeys)||!Array.isArray(history.duplicateCreatorKeys)||!Array.isArray(history.sharedEmailKeys))fail('HISTORY_INCOMPLETE');
  const rows=[],previews=[],shared=createSharedInlinePreview({images:snapshot.images,owner,requiredImageIds:snapshot.template.requiredInlineImageIds});
  for(const choice of input.recipients){
   const resolved=await repository.currentRecipient(owner,choice.id);
   if(resolved?.complete!==true||resolved.owner!==owner||resolved.id!==choice.id||resolved.version!==choice.version||resolved.candidate?.platform!=='youtube')fail('RECIPIENT_CHANGED');
   if(scope&&!belongsToProjectDay(resolved.native?.data,scope))fail('PROJECT_SCOPE_CHANGED');
   let target;try{target=manualYoutubeTarget(resolved,owner,choice.email.trim().toLowerCase(),now());}catch(error){error.candidateId=resolved.id;throw error;}const c=resolved.candidate,creatorKey=target.creatorKey;
   const email=target.contact.address,key=target.contact.key;if(history.duplicateCreatorKeys.includes(creatorKey)||history.sharedEmailKeys.includes(key)){const error=Object.assign(new Error('IDENTITY_AMBIGUOUS'),{code:'IDENTITY_AMBIGUOUS',candidateId:resolved.id});throw error;}
   const assessment=classifyManualRecipient({owner,creatorKey,email,records:history.records,suppressed:history.suppressedKeys.includes(key),explicitRefusal:history.refusedKeys.includes(key),complete:true});
   if(!assessment.eligible){const code=assessment.reason==='history_origin_unverified'?'HISTORY_ORIGIN_UNVERIFIED':assessment.reason==='already_sent_or_pending'?'WORK_ALREADY_SENT_OR_PENDING':'RECIPIENT_BLOCKED';throw Object.assign(new Error(code),{code,candidateId:resolved.id});}
   const copy=renderYoutubeOutreachCopy({template:snapshot.template,channelName:target.name,signature:snapshot.signature,inlineImages:snapshot.images});
   const rendered=shared.render(copy);
   rows.push({owner,id:resolved.id,version:resolved.version,channel:c.externalId,email,name:target.name,profileUrl:target.profileUrl,sourceUrl:target.sourceUrl,sourceCheckedAt:target.sourceCheckedAt,sources:target.sources,sourceFingerprint:target.sourceFingerprint,reviewVersion:target.reviewVersion,audience:target.audience,metricsSource:target.metricsSource,metricsCheckedAt:target.metricsCheckedAt,activitySource:target.activitySource,activityCheckedAt:target.activityCheckedAt,mukbangReason:target.mukbangReason,subject:copy.subject,body:copy.body});
   previews.push({id:resolved.id,channelName:target.name,profileUrl:target.profileUrl,sourceUrl:target.sourceUrl,sourceCheckedAt:target.sourceCheckedAt,sources:target.sources,audience:target.audience,metricsSource:target.metricsSource,metricsCheckedAt:target.metricsCheckedAt,activitySource:target.activitySource,activityCheckedAt:target.activityCheckedAt,mukbangReason:target.mukbangReason,recipient:email,subject:copy.subject,html:rendered.html});
  }
  const current=await repository.policy(owner);if(current?.owner!==owner||current.revision!==policy.revision||current.snapshot_id!==policy.snapshot_id)fail('SNAPSHOT_CHANGED');
  const {review,approvalHash}=buildManualReview({owner,sender:snapshot.signature.senderEmail,snapshotHash:stored.sha256,settingsId:settings.id,settingsVersion:settings.version,mailPolicy,rows,scope});
  return {previewOnly:true,sendingEnabled:false,policyRevision:policy.revision,snapshotId:stored.id,approvalHash,review,previews,sharedImages:shared.sharedImages,warning:'수신 거부 재확인 후 Gmail 요청 전 발생한 변경은 반영되지 않을 수 있습니다.'};
 };
}
