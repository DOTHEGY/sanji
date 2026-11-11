// LOCAL REVIEW CANDIDATE. The caller must obtain every input from authenticated,
// owner-scoped server reads and an existing verified private snapshot.
import {createHash} from 'node:crypto';
import {emailIdentity} from './domain.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
export const manualReviewHash=s=>createHash('sha256').update(stable(s)).digest('hex');
export function buildManualReview({owner,sender,snapshotHash,settingsId,settingsVersion,mailPolicy,rows,scope}){
 if(typeof owner!=='string'||!owner||!emailIdentity(sender)||!/^[a-f0-9]{64}$/.test(snapshotHash||'')||typeof settingsId!=='string'||!settingsId||!Number.isSafeInteger(settingsVersion)||settingsVersion<1||!mailPolicy||typeof mailPolicy.classification!=='string'||typeof mailPolicy.classificationSource!=='string'||!mailPolicy.classificationSource||typeof mailPolicy.authorizationSource!=='string'||!mailPolicy.authorizationSource||!Array.isArray(rows)||!rows.length||rows.length>100)fail('REVIEW_INCOMPLETE');
 const ids=new Set(),emails=new Set(),channels=new Set();
 const entries=rows.map(row=>{
  const key=emailIdentity(row?.email),channel=String(row?.channel||'');
  if(!row||row.owner!==owner||typeof row.name!=='string'||!row.name||typeof row.profileUrl!=='string'||!row.profileUrl||typeof row.sourceUrl!=='string'||!row.sourceUrl||typeof row.sourceCheckedAt!=='string'||!row.sourceCheckedAt||!Array.isArray(row.sources)||!row.sources.length||row.sources.length>5||row.sources.some(x=>!x||typeof x.url!=='string'||typeof x.checkedAt!=='string')||!/^[a-f0-9]{64}$/.test(row.sourceFingerprint||'')||row.reviewVersion!=='manual_source_review_v1'||!Number.isSafeInteger(row.audience)||typeof row.metricsSource!=='string'||typeof row.metricsCheckedAt!=='string'||typeof row.activitySource!=='string'||typeof row.activityCheckedAt!=='string'||typeof row.mukbangReason!=='string'||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||!/^UC[A-Za-z0-9_-]{22}$/.test(channel)||!key||typeof row.subject!=='string'||!row.subject.trim()||typeof row.body!=='string'||!row.body.trim()||ids.has(row.id)||emails.has(key)||channels.has(channel))fail('REVIEW_RECIPIENT_INVALID');
  ids.add(row.id);emails.add(key);channels.add(channel);
  return {id:row.id,version:row.version,channel,email:row.email.trim().toLowerCase(),emailKey:key,name:row.name,profileUrl:row.profileUrl,sourceUrl:row.sourceUrl,sourceCheckedAt:row.sourceCheckedAt,sources:row.sources,sourceFingerprint:row.sourceFingerprint,reviewVersion:row.reviewVersion,audience:row.audience,metricsSource:row.metricsSource,metricsCheckedAt:row.metricsCheckedAt,activitySource:row.activitySource,activityCheckedAt:row.activityCheckedAt,mukbangReason:row.mukbangReason,subject:row.subject,body:row.body};
 });
 const review={owner,sender:sender.trim().toLowerCase(),snapshotHash,settingsId,settingsVersion,mailPolicy,entries,...(scope?{scope}:{})};
 return {review,approvalHash:manualReviewHash(review)};
}
export function confirmManualReview(current,approvedHash){
 const result=buildManualReview(current);
 if(!/^[a-f0-9]{64}$/.test(approvedHash||'')||result.approvalHash!==approvedHash)fail('REVIEW_CHANGED');
 return result.review;
}
