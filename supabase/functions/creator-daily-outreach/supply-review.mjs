import {OutreachError,sourceUrl,creatorIdentity,profileMatches,fresh,qualifyOutreachCandidate} from './domain.mjs';
const DAY=86400000;
const clean=v=>typeof v==='string'?v.trim():'';
const fail=(code='SUPPLY_REVIEW_INVALID')=>{throw new OutreachError(code,'크리에이터·독립 출처·먹방·공개 연락처 근거를 확인하세요.',400);};
const nonIndependent=url=>/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname);
// Owner-reviewed evidence is a separate source, never an API classification.
export function validateSupplyReview(owner,input,snapshot,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['creatorKey','snapshotObservedAt','mukbang','displayNameEvidence','contactEvidence'].includes(k))||JSON.stringify(input).length>16000)fail();
 const row={platform:'youtube',externalId:snapshot.channelId},key=creatorIdentity(row),profile='https://www.youtube.com/channel/'+snapshot.channelId;
 if(!key||input.creatorKey!==key||input.snapshotObservedAt!==snapshot.observedAt||Date.parse(snapshot.expiresAt)<=now)fail('SUPPLY_REVIEW_STALE');
 const d=input.displayNameEvidence,m=input.mukbang;
 if(!d||d.verified!==true||!['official_website','provided_by_creator'].includes(d.kind)||d.creatorKey!==key||d.profileUrl!==profile||!profileMatches(row,d.profileUrl)||!clean(d.name)||d.name.length>150||/[\r\n<>\[\]{}]/.test(d.name)||!sourceUrl(d.sourceUrl)||nonIndependent(sourceUrl(d.sourceUrl))||!clean(d.sourceText)||d.sourceText.length>4000||!d.sourceText.includes(clean(d.name))||!(d.sourceText.includes(profile)||d.sourceText.includes(snapshot.channelId))||!fresh(d.checkedAt,now,29))fail('SUPPLY_INDEPENDENT_IDENTITY_REQUIRED');
 if(!m||m.verified!==true||!sourceUrl(m.sourceUrl)||!clean(m.sourceText)||m.sourceText.length>2000||!fresh(m.checkedAt,now,29))fail('SUPPLY_MUKBANG_REVIEW_REQUIRED');
 if(input.contactEvidence!==undefined&&(!Array.isArray(input.contactEvidence)||input.contactEvidence.length>5))fail();
 const contactEvidence=input.contactEvidence||[];
 // Canonicalize the same evidence ultimately used by preparation; copied About
 // text, unverified purpose/affiliation and ambiguous contacts cannot be approved.
 const q=qualifyOutreachCandidate({...row,name:clean(d.name),profileUrl:profile,audience:snapshot.subscriberCount,audienceSource:profile,audienceCheckedAt:snapshot.observedAt,lastActiveAt:snapshot.lastActiveAt,activitySource:snapshot.lastActivityUrl,activityCheckedAt:snapshot.observedAt,mukbang:m,contactEvidence},now);
 if(q.reasons.includes('audience_out_of_range_or_unknown'))fail('SUPPLY_REVIEW_AUDIENCE_REQUIRED');
 if(contactEvidence.length&&q.contactReason)fail('SUPPLY_CONTACT_REVIEW_REQUIRED');
 const times=[Date.parse(d.checkedAt),Date.parse(m.checkedAt),...contactEvidence.flatMap(e=>[Date.parse(e.checkedAt),...(e.affiliation?[Date.parse(e.affiliation.checkedAt)]:[])])];
 if(times.some(t=>!Number.isFinite(t)||t>now))fail();
 const expiresAt=new Date(Math.min(Date.parse(snapshot.expiresAt),...times.map(t=>t+29*DAY))).toISOString();
 if(Date.parse(expiresAt)<=now)fail('SUPPLY_REVIEW_STALE');
 return {creatorKey:key,snapshotObservedAt:snapshot.observedAt,displayNameEvidence:{name:clean(d.name),sourceUrl:sourceUrl(d.sourceUrl),sourceText:d.sourceText,checkedAt:d.checkedAt,verified:true,kind:d.kind,creatorKey:key,profileUrl:profile},independentlyReviewed:true,mukbang:{verified:true,sourceUrl:sourceUrl(m.sourceUrl),sourceText:m.sourceText,checkedAt:m.checkedAt,independentlyReviewed:true,independentSource:!nonIndependent(sourceUrl(m.sourceUrl))},contactEvidence,reviewedBy:owner,reviewedAt:new Date(now).toISOString(),expiresAt};
}
export function applySupplyReview(candidate,review,now=Date.now()){
 if(!review||review.snapshotObservedAt!==candidate.apiSnapshot?.observedAt||review.creatorKey!==creatorIdentity(candidate)||!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=now)return candidate;
 const d=review.displayNameEvidence;
 if(d?.verified!==true||review.independentlyReviewed!==true||d.creatorKey!==creatorIdentity(candidate)||d.profileUrl!==candidate.profileUrl)return candidate;
 return {...candidate,name:d.name,displayNameEvidence:d,independentIdentityEvidence:d,mukbang:review.mukbang,contactEvidence:review.contactEvidence,reviewRequired:[],apiSnapshot:{...candidate.apiSnapshot,titleFromApi:true,nameIndependentlySourced:true,identityIndependentlySourced:true,fieldNames:candidate.apiSnapshot.fieldNames.filter(k=>!['name','creatorKey','externalId','profileUrl'].includes(k))}};
}
