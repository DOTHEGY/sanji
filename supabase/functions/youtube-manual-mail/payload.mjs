import {createHash} from 'node:crypto';
import {renderOutreachCopy} from '../creator-daily-outreach/domain.mjs';
import {verifyPrivateSnapshot,settingsSignature,stableJSON} from '../creator-daily-outreach/private-config.mjs';
import {buildManualReview} from '../creator-daily-outreach/youtube-manual-review.mjs';
import {manualMailPolicy} from './policy.mjs';
import {manualYoutubeTarget} from './target.mjs';
import {composeInlineOutreach} from './inline-mail.mjs';
const fail=()=>{throw Object.assign(new Error('APPROVED_CONTENT_CHANGED'),{code:'APPROVED_CONTENT_CHANGED'});};
// Server-only; only authenticated batch IDs and selected candidate IDs enter.
export function youtubeManualPayloadBuilder({repository,now=Date.now}){
 return async function build(owner,batch,candidateId){
  if(!batch||batch.owner!==owner||!batch.confirmedAt||!Number.isFinite(Date.parse(batch.createdAt))||!Number.isFinite(Date.parse(batch.expiresAt))||Date.parse(batch.expiresAt)<=now()||!Array.isArray(batch.review?.entries))fail();
  const saved=batch.review;const rebuilt=buildManualReview({owner,sender:saved.sender,snapshotHash:saved.snapshotHash,settingsId:saved.settingsId,settingsVersion:saved.settingsVersion,mailPolicy:saved.mailPolicy,rows:saved.entries.map(e=>({...e,owner})),scope:saved.scope});
  if(rebuilt.approvalHash!==batch.approvalHash||stableJSON(rebuilt.review)!==stableJSON(saved))fail();
  const entries=saved.entries.filter(x=>x.id===candidateId);if(entries.length!==1)fail();const entry=entries[0];
  const [policy,stored,settings,connection,current]=await Promise.all([repository.policy(owner),repository.snapshot(owner,batch.snapshotId),repository.currentSettings(owner),repository.currentConnection(owner),repository.currentRecipient(owner,entry.id)]);
  if(policy?.owner!==owner||policy.revision!==batch.policyRevision||policy.snapshot_id!==batch.snapshotId||stored?.sha256!==batch.snapshotHash||saved.snapshotHash!==batch.snapshotHash||settings?.id!==saved.settingsId||settings?.version!==saved.settingsVersion||current?.owner!==owner||current.id!==entry.id||current.version!==entry.version||current.complete!==true)fail();
  if(stableJSON(manualMailPolicy(policy,owner,batch.policyRevision))!==stableJSON(saved.mailPolicy))fail();
  const snapshot=verifyPrivateSnapshot(stored,owner);if(stableJSON(settingsSignature(settings,connection))!==stableJSON(snapshot.signature)||snapshot.signature.senderEmail!==saved.sender)fail();
  if(snapshot.products.length){const products=await repository.currentProducts(owner,snapshot.products.map(p=>p.id));if(!Array.isArray(products)||stableJSON(products.map(({id,version,sha256})=>({id,version,sha256})).sort((a,b)=>a.id.localeCompare(b.id)))!==stableJSON([...snapshot.products].sort((a,b)=>a.id.localeCompare(b.id))))fail();}
  const target=manualYoutubeTarget(current,owner,entry.email,now());if(target.creatorKey!=='youtube:'+entry.channel||target.name!==entry.name||target.profileUrl!==entry.profileUrl||target.sourceUrl!==entry.sourceUrl||target.sourceCheckedAt!==entry.sourceCheckedAt||stableJSON(target.sources)!==stableJSON(entry.sources)||target.sourceFingerprint!==entry.sourceFingerprint||target.reviewVersion!==entry.reviewVersion||target.audience!==entry.audience||target.metricsSource!==entry.metricsSource||target.metricsCheckedAt!==entry.metricsCheckedAt||target.activitySource!==entry.activitySource||target.activityCheckedAt!==entry.activityCheckedAt||target.mukbangReason!==entry.mukbangReason)fail();
  const copy=renderOutreachCopy({template:snapshot.template,channelName:target.name,signature:snapshot.signature,inlineImages:snapshot.images});if(copy.subject!==entry.subject||copy.body!==entry.body)fail();
  const messageId=createHash('sha256').update(batch.id+'|'+entry.id).digest('hex');const mime=composeInlineOutreach({copy,images:snapshot.images,owner,requiredImageIds:snapshot.template.requiredInlineImageIds,from:saved.sender,to:entry.email,senderName:snapshot.signature.senderName,messageId,now:batch.createdAt});
  return {raw:mime.raw,rawHash:createHash('sha256').update(mime.raw).digest('hex'),senderEmail:saved.sender,messageId};
 };
}
