import {audienceBounds,OutreachError,sourceUrl,creatorIdentity,profileMatches,fresh,qualifyOutreachCandidate} from './domain.mjs';
const DAY=86400000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fields=['creatorKey','sourceRecordId','sourceRecordUpdated','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt','mukbang','contactEvidence'];
const fail=(code='INSTAGRAM_REVIEW_INVALID')=>{throw new OutreachError(code,'기존 Instagram 원본과 최신 팔로워·활동·먹방·공개 연락처 근거를 확인하세요.',400);};
export function instagramReviewState(row,review,now=Date.now(),guard=false){
 if(row.excluded===true||row.priorContact===true||row.suppressed===true||row.assessment==='excluded')return 'excluded';
 if(!review)return guard?'stale':'pending';
 if(row.existingDatabaseRecord!==true||row.platform!=='instagram'||review.creatorKey!==creatorIdentity(row)||review.sourceRecordId!==row.sourceRecordId||review.sourceRecordUpdated!==row.sourceRecordUpdated||!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=now)return 'stale';
 return 'reviewed';
}
export function validateInstagramReview(owner,input,row,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||JSON.stringify(input).length>16000)fail();
 if(row?.platform!=='instagram'||row.existingDatabaseRecord!==true||!UUID.test(row.sourceRecordId||'')||!Number.isFinite(Date.parse(row.sourceRecordUpdated))||input.creatorKey!==creatorIdentity(row)||input.sourceRecordId!==row.sourceRecordId||input.sourceRecordUpdated!==row.sourceRecordUpdated||!profileMatches(row,row.profileUrl))fail('INSTAGRAM_REVIEW_SOURCE_CHANGED');
 if(instagramReviewState(row,null,now)==='excluded')fail('INSTAGRAM_REVIEW_NATIVE_EXCLUDED');
 if(!Number.isSafeInteger(input.audience)||input.audience<audienceBounds('instagram').minimum||input.audience>audienceBounds('instagram').maximum||!sourceUrl(input.audienceSource)||!fresh(input.audienceCheckedAt,now,29))fail('INSTAGRAM_REVIEW_AUDIENCE_REQUIRED');
 if(!sourceUrl(input.activitySource)||!fresh(input.activityCheckedAt,now,29)||!fresh(input.lastActiveAt,now,90))fail('INSTAGRAM_REVIEW_ACTIVITY_REQUIRED');
 const m=input.mukbang;
 if(!m||m.verified!==true||!sourceUrl(m.sourceUrl)||typeof m.sourceText!=='string'||!m.sourceText.trim()||m.sourceText.length>2000||!fresh(m.checkedAt,now,29))fail('INSTAGRAM_REVIEW_MUKBANG_REQUIRED');
 if(input.contactEvidence!==undefined&&(!Array.isArray(input.contactEvidence)||input.contactEvidence.length>5))fail();
 const contactEvidence=input.contactEvidence||[];
 const evidence={audience:input.audience,audienceSource:sourceUrl(input.audienceSource),audienceCheckedAt:input.audienceCheckedAt,lastActiveAt:input.lastActiveAt,activitySource:sourceUrl(input.activitySource),activityCheckedAt:input.activityCheckedAt,mukbang:{verified:true,sourceUrl:sourceUrl(m.sourceUrl),sourceText:m.sourceText,checkedAt:m.checkedAt},contactEvidence};
 const qualified=qualifyOutreachCandidate({...row,...evidence},now);
 if(!qualified.eligible)fail('INSTAGRAM_REVIEW_EVIDENCE_REQUIRED');
 if(contactEvidence.length&&qualified.contactReason)fail('INSTAGRAM_REVIEW_CONTACT_REQUIRED');
 const times=[input.audienceCheckedAt,input.activityCheckedAt,m.checkedAt,...contactEvidence.flatMap(e=>[e.checkedAt,...(e.affiliation?[e.affiliation.checkedAt]:[])])].map(Date.parse);
 if(times.some(t=>!Number.isFinite(t)||t>now))fail();
 const expiry=Math.min(...times.map(t=>t+29*DAY),Date.parse(input.lastActiveAt)+90*DAY);
 if(!Number.isFinite(expiry)||expiry<=now)fail('INSTAGRAM_REVIEW_EXPIRED');
 return {creatorKey:creatorIdentity(row),sourceRecordId:row.sourceRecordId,sourceRecordUpdated:row.sourceRecordUpdated,...evidence,reviewedBy:owner,reviewedAt:new Date(now).toISOString(),expiresAt:new Date(expiry).toISOString()};
}
export function applyInstagramReview(row,review,now=Date.now(),guard=false){
 const state=instagramReviewState(row,review,now,guard);
 if(state==='stale')return {...row,excluded:true,reviewRequired:[...(row.reviewRequired||[]),'instagram_review_required']};
 if(state!=='reviewed')return {...row};
 // Preserve authoritative identity, native version and every exclusion flag.
 // No mutation of sanji_creator_recovery or historical/manual source records.
 return {...row,audience:review.audience,audienceSource:review.audienceSource,audienceCheckedAt:review.audienceCheckedAt,lastActiveAt:review.lastActiveAt,activitySource:review.activitySource,activityCheckedAt:review.activityCheckedAt,mukbang:review.mukbang,contactEvidence:review.contactEvidence,supplyReview:{source:'existing_instagram_database',sourceRecordUpdated:review.sourceRecordUpdated,reviewedAt:review.reviewedAt,expiresAt:review.expiresAt}};
}
