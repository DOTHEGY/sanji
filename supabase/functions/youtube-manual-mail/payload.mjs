import {createHash} from 'node:crypto';
import {renderYoutubeOutreachCopy} from '../creator-daily-outreach/youtube-greeting.mjs';
import {verifyPrivateSnapshot,settingsSignature,stableJSON} from '../creator-daily-outreach/private-config.mjs';
import {buildManualReview} from '../creator-daily-outreach/youtube-manual-review.mjs';
import {manualMailPolicy} from './policy.mjs';
import {manualYoutubeTarget} from './target.mjs';
import {createSharedInlineComposer} from './inline-mail.mjs';
const fail=()=>{throw Object.assign(new Error('APPROVED_CONTENT_CHANGED'),{code:'APPROVED_CONTENT_CHANGED'});};
// Server-only; only authenticated batch IDs and selected candidate IDs enter.
export function youtubeManualPayloadBuilder({repository,now=Date.now}){
 async function prepareBatch(owner,batch){
  // Do not retain a cache across requests or accept shared state from callers.
  batch=structuredClone(batch);
  if(!batch||batch.owner!==owner||!batch.confirmedAt||!Number.isFinite(Date.parse(batch.createdAt))||!Number.isFinite(Date.parse(batch.expiresAt))||Date.parse(batch.expiresAt)<=now()||!Array.isArray(batch.review?.entries))fail();
  const saved=batch.review;const rebuilt=buildManualReview({owner,sender:saved.sender,snapshotHash:saved.snapshotHash,settingsId:saved.settingsId,settingsVersion:saved.settingsVersion,mailPolicy:saved.mailPolicy,rows:saved.entries.map(e=>({...e,owner})),scope:saved.scope});
  if(rebuilt.approvalHash!==batch.approvalHash||stableJSON(rebuilt.review)!==stableJSON(saved))fail();
  async function shared(){
  if(Date.parse(batch.expiresAt)<=now())fail();
  const [policy,stored,settings,connection]=await Promise.all([repository.policy(owner),repository.snapshot(owner,batch.snapshotId),repository.currentSettings(owner),repository.currentConnection(owner)]);
  if(policy?.owner!==owner||policy.revision!==batch.policyRevision||policy.snapshot_id!==batch.snapshotId||stored?.sha256!==batch.snapshotHash||saved.snapshotHash!==batch.snapshotHash||settings?.id!==saved.settingsId||settings?.version!==saved.settingsVersion)fail();
  if(stableJSON(manualMailPolicy(policy,owner,batch.policyRevision))!==stableJSON(saved.mailPolicy))fail();
  const snapshot=verifyPrivateSnapshot(stored,owner);if(stableJSON(settingsSignature(settings,connection))!==stableJSON(snapshot.signature)||snapshot.signature.senderEmail!==saved.sender)fail();
  if(snapshot.products.length){const products=await repository.currentProducts(owner,snapshot.products.map(p=>p.id));if(!Array.isArray(products)||stableJSON(products.map(({id,version,sha256})=>({id,version,sha256})).sort((a,b)=>a.id.localeCompare(b.id)))!==stableJSON([...snapshot.products].sort((a,b)=>a.id.localeCompare(b.id))))fail();}
  return snapshot;
  }
  const snapshot=await shared(),compose=createSharedInlineComposer({images:snapshot.images,owner,requiredImageIds:snapshot.template.requiredInlineImageIds});
  async function build(candidateId,hashOnly=false){
  if(Date.parse(batch.expiresAt)<=now())fail();
  const entries=saved.entries.filter(x=>x.id===candidateId);if(entries.length!==1)fail();const entry=entries[0];
  const current=await repository.currentRecipient(owner,entry.id);
  if(current?.owner!==owner||current.id!==entry.id||current.version!==entry.version||current.complete!==true)fail();
  const target=manualYoutubeTarget(current,owner,entry.email,now());if(target.creatorKey!=='youtube:'+entry.channel||target.name!==entry.name||target.profileUrl!==entry.profileUrl||target.sourceUrl!==entry.sourceUrl||target.sourceCheckedAt!==entry.sourceCheckedAt||stableJSON(target.sources)!==stableJSON(entry.sources)||target.sourceFingerprint!==entry.sourceFingerprint||target.reviewVersion!==entry.reviewVersion||target.audience!==entry.audience||target.metricsSource!==entry.metricsSource||target.metricsCheckedAt!==entry.metricsCheckedAt||target.activitySource!==entry.activitySource||target.activityCheckedAt!==entry.activityCheckedAt||target.mukbangReason!==entry.mukbangReason)fail();
  const copy=renderYoutubeOutreachCopy({template:snapshot.template,channelName:target.name,signature:snapshot.signature,inlineImages:snapshot.images});if(copy.subject!==entry.subject||copy.body!==entry.body)fail();
  const messageId=createHash('sha256').update(batch.id+'|'+entry.id).digest('hex');const mime=(hashOnly?compose.hash:compose)({copy,from:saved.sender,to:entry.email,senderName:snapshot.signature.senderName,messageId,now:batch.createdAt});
  return {...(hashOnly?{rawHash:mime.rawHash}:{raw:mime.raw,rawHash:createHash('sha256').update(mime.raw).digest('hex')}),senderEmail:saved.sender,messageId};
  }
  return {build,hash:candidateId=>build(candidateId,true),recheck:shared};
 }
 const build=async(owner,batch,candidateId)=>(await prepareBatch(owner,batch)).build(candidateId);
 build.prepareBatch=prepareBatch;
 return build;
}
