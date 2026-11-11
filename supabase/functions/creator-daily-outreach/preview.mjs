import {renderYoutubeOutreachCopy} from './youtube-greeting.mjs';
import {OutreachError,creatorIdentity,qualifyOutreachCandidate,renderOutreachCopy} from './domain.mjs';
import {verifyPrivateSnapshot,settingsSignature,stableJSON} from './private-config.mjs';
import {renderPrivateInlinePreview} from './inline-mail.mjs';
const fail=(code,status=409)=>{throw new OutreachError(code,'현재 후보와 저장된 문안·Gmail 서명을 확인해야 합니다.',status);};
const validKey=value=>/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value||'');
// Owner-authenticated preview only. Never calls a provider, creates a draft,
// changes a recipient review, claims a job or grants permission to send.
export function createPrivatePreview({repository,resolveTarget,now=Date.now}){
 return async function preview(owner,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['creatorKey','expectedRevision'].includes(k))||!validKey(input.creatorKey)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_PREVIEW_REQUEST',400);
  const policy=await repository.policy(owner);
  if(!policy||policy.owner!==owner||policy.revision!==input.expectedRevision)fail('CAMPAIGN_REVISION_CHANGED');
  if(!policy.snapshot_id)fail('PRIVATE_TEMPLATE_REQUIRED');
  const [row,current,settings,connection]=await Promise.all([repository.snapshot(owner,policy.snapshot_id),resolveTarget(owner,input.creatorKey),repository.currentSettings(owner),repository.currentConnection(owner)]);
  const snapshot=verifyPrivateSnapshot(row,owner);
  if(stableJSON(settingsSignature(settings,connection))!==stableJSON(snapshot.signature))fail('CURRENT_GMAIL_SIGNATURE_CHANGED');
  if(current?.complete!==true||!Array.isArray(current.candidates)||current.candidates.length!==1)fail('CURRENT_EVIDENCE_AMBIGUOUS');
  const target=current.candidates[0];if(creatorIdentity(target)!==input.creatorKey||typeof target.name!=='string'||!target.name.trim()||target.name.length>200)fail('PREVIEW_TARGET_CHANGED');
  const qualification=qualifyOutreachCandidate(target,now()),recipient=qualification.candidate?.contact?.address||null;
  const copy=(input.creatorKey.startsWith('youtube:')?renderYoutubeOutreachCopy:renderOutreachCopy)({template:snapshot.template,channelName:target.name,signature:snapshot.signature,inlineImages:snapshot.images});
  const content=renderPrivateInlinePreview({copy,images:snapshot.images,owner,requiredImageIds:snapshot.template.requiredInlineImageIds});
  // A stale response must not resurrect a preview of a replaced template.
  const latest=await repository.policy(owner);if(latest?.owner!==owner||latest.revision!==policy.revision||latest.snapshot_id!==policy.snapshot_id)fail('CAMPAIGN_REVISION_CHANGED');
  const warnings=[...new Set(['preview_is_not_send_authorization',...(content.remoteSignatureImagesHidden?['signature_remote_images_hidden_in_preview']:[]),...(snapshot.version===1?['historical_recipient_criteria']:[]),...qualification.reasons,...(qualification.contactReason?[qualification.contactReason]:[])])];
  return {previewOnly:true,sendingEnabled:false,creatorKey:input.creatorKey,channelName:target.name.trim(),recipient,subject:copy.subject,html:content.html,imageCount:content.imageCount,templateRevision:snapshot.template.revision,policyRevision:policy.revision,snapshotId:row.id,scopeHash:snapshot.scopeHash,warnings};
 };
}
