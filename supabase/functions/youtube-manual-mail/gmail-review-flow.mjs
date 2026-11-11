import {emailIdentity} from '../creator-daily-outreach/domain.mjs';
import {manualYoutubeTarget} from './target.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
// The owner inspects Gmail originals. The server records an attestation, not a
// provider-certified statement about the content. No mail body is stored.
export function youtubeGmailReviewFlow({repository,provider,now=Date.now}){
 async function inspect(owner,input){
  if(!owner||!input||Object.keys(input).some(k=>!['id','version','email'].includes(k))||typeof input.id!=='string'||!Number.isSafeInteger(input.version)||input.version<1||typeof input.email!=='string'||input.email!==input.email.trim().toLowerCase()||!emailIdentity(input.email))fail('INVALID_REVIEW');
  const [resolved,connection]=await Promise.all([repository.currentRecipient(owner,input.id),repository.currentConnection(owner)]);
  if(resolved?.owner!==owner||resolved.id!==input.id||resolved.version!==input.version||resolved.complete!==true||connection?.owner!==owner||connection.summary?.reauthRequired===true||!emailIdentity(connection.summary?.email))fail('REVIEW_SOURCE_CHANGED');
  const target=manualYoutubeTarget(resolved,owner,input.email,now());
  const sender=connection.summary.email.trim().toLowerCase(),proof=await provider.historyFingerprint({owner,address:input.email,senderEmail:sender});
  const t=Date.parse(proof?.checkedAt);if(!proof||proof.emailKey!==emailIdentity(input.email)||proof.senderEmail!==sender||!/^[a-f0-9]{64}$/.test(proof.fingerprint||'')||!Array.isArray(proof.messageIds)||proof.messageIds.length>100||proof.messageIds.some(id=>!/^[A-Za-z0-9_-]{1,200}$/.test(id))||!Number.isFinite(t)||t>now()||now()-t>15000)fail('GMAIL_HISTORY_UNAVAILABLE');
  return {sender,proof,name:target.name};
 }
 return {
  async prepare(owner,input){const {sender,proof,name}=await inspect(owner,input);return {name,email:input.email,fingerprint:proof.fingerprint,count:proof.messageIds.length,links:proof.messageIds.map(id=>'https://mail.google.com/mail/?authuser='+encodeURIComponent(sender)+'#all/'+encodeURIComponent(id)),note:'원본을 열어 모두 확인하세요. 이 기록은 사용자가 확인한 사실이며 Gmail이 거절 부재를 보증하는 것은 아닙니다.'};},
  async confirm(owner,input){if(!input||Object.keys(input).some(k=>!['id','version','email','fingerprint','acknowledged'].includes(k))||input.acknowledged!==true||!/^[a-f0-9]{64}$/.test(input.fingerprint||''))fail('INVALID_REVIEW');const selected={id:input.id,version:input.version,email:input.email},current=await inspect(owner,selected);if(current.proof.fingerprint!==input.fingerprint||!current.proof.messageIds.length)fail('GMAIL_HISTORY_CHANGED');const id=await repository.recordGmailReview({owner,candidateId:input.id,version:input.version,email:input.email,sender:current.sender,fingerprint:input.fingerprint,count:current.proof.messageIds.length});if(typeof id!=='string'||!id)fail('REVIEW_SAVE_UNCERTAIN');return {status:'recorded',scope:'owner_attested',count:current.proof.messageIds.length};}
 };
}
