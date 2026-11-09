// Qualification and copy rendering. Public contact evidence is not permission to send.
export const DAILY_OUTREACH = Object.freeze({campaign:'mara-jjamppong-bread',label:'마라쫀득빵·짬뽕쫀득빵',youtubeTarget:50,instagramTarget:10,audienceBounds:Object.freeze({youtube:Object.freeze({minimum:30000,maximum:200000}),instagram:Object.freeze({minimum:30000,maximum:500000})}),targetUnit:'distinct_verified_business_email',maxEmailsPerCreator:1,dedupeScope:'cross_platform',activityDays:90,evidenceDays:30,timezone:'Asia/Seoul',sendingEnabled:false,schedulerEnabled:false});
export const audienceBounds=platform=>DAILY_OUTREACH.audienceBounds[platform]||null;
export const RECIPIENT_CRITERIA=Object.freeze({version:1,audienceBounds:DAILY_OUTREACH.audienceBounds,targets:Object.freeze({youtube:DAILY_OUTREACH.youtubeTarget,instagram:DAILY_OUTREACH.instagramTarget}),targetUnit:DAILY_OUTREACH.targetUnit,maxEmailsPerCreator:DAILY_OUTREACH.maxEmailsPerCreator,dedupeScope:DAILY_OUTREACH.dedupeScope});
export function hasCurrentRecipientGoal(value){return Boolean(value&&value.targetUnit===DAILY_OUTREACH.targetUnit&&value.maxEmailsPerCreator===1&&value.dedupeScope===DAILY_OUTREACH.dedupeScope&&['youtube','instagram'].every(platform=>value.audienceBounds?.[platform]?.minimum===audienceBounds(platform).minimum&&value.audienceBounds?.[platform]?.maximum===audienceBounds(platform).maximum));}
const DAY=86400000;
const clean=v=>typeof v==='string'?v.trim():'';
export class OutreachError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
export function outreachDay(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:DAILY_OUTREACH.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function fresh(value,now,days=30){const at=Date.parse(value);return Number.isFinite(at)&&at<=now&&at>=now-days*DAY;}
export function sourceUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)&&!/^\d+(\.\d+){3}$/.test(u.hostname)?u.href:null;}catch{return null;}}
export function emailIdentity(value){
 const address=clean(value).toLowerCase(),parts=address.split('@');if(parts.length!==2||address.length>254)return null;
 const [local,domain]=parts;
 if(!local||local.length>64||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!domain.includes('.')||domain.split('.').some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||!/[.][a-z]{2,}$/.test(domain))return null;
 if(['gmail.com','googlemail.com'].includes(domain)){const account=local.split('+')[0];return /^[a-z0-9.]+$/.test(account)&&account.replaceAll('.','')?account.replaceAll('.','')+'@gmail.com':null;}
 return address;
}
export function profileMatches(row,value){
 const url=sourceUrl(value);if(!url)return false;const u=new URL(url);if(u.search)return false;
 return row.platform==='youtube'?['youtube.com','www.youtube.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'')==='/channel/'+row.externalId:row.platform==='instagram'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'').toLowerCase()==='/'+clean(row.externalId).toLowerCase();
}
export function creatorIdentity(row){if(row?.platform==='youtube'&&/^UC[A-Za-z0-9_-]{22}$/.test(row.externalId))return 'youtube:'+row.externalId;if(row?.platform==='instagram'&&/^[a-z0-9._]{1,30}$/.test(clean(row.externalId).toLowerCase()))return 'instagram:'+clean(row.externalId).toLowerCase();return null;}
function contactEvidence(row,now){
 const evidence=Array.isArray(row.contactEvidence)?row.contactEvidence:[];
 // A newer observation, including removal/ambiguity, supersedes an older email.
 const items=evidence.filter(e=>e&&e.creatorKey===creatorIdentity(row));
 if(!items.length)return {reason:'public_email_evidence_required'};
 if(items.some(e=>!Number.isFinite(Date.parse(e.checkedAt))||Date.parse(e.checkedAt)>now))return {reason:'contact_observation_time_invalid'};
 items.sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
 if(!fresh(items[0].checkedAt,now)||!sourceUrl(items[0].sourceUrl))return {reason:'public_email_evidence_required'};
 if(items.some(e=>Date.parse(e.checkedAt)===Date.parse(items[0].checkedAt)&&JSON.stringify(e)!==JSON.stringify(items[0])))return {reason:'ambiguous_contact_observation'};
 const e=items[0],email=clean(e.address).toLowerCase(),key=emailIdentity(email),url=sourceUrl(e.sourceUrl);
 if(e.verified!==true||e.purpose!=='business_collaboration'||e.accessMethod!=='public_source_review'||!['official_website','instagram_public_bio','provided_by_creator'].includes(e.sourceKind))return {reason:'contact_source_review_required'};
 if(row.platform==='youtube'&&(e.sourceKind==='instagram_public_bio'||/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname)))return {reason:'youtube_contact_harvesting_not_supported'};
 if(e.sourceKind==='instagram_public_bio'&&!profileMatches(row,url))return {reason:'contact_creator_affiliation_required'};
 const affiliation=e.affiliation;
 if(e.sourceKind!=='instagram_public_bio'&&(!affiliation||affiliation.verified!==true||affiliation.creatorKey!==creatorIdentity(row)||!sourceUrl(affiliation.sourceUrl)||!clean(affiliation.sourceText)||!fresh(affiliation.checkedAt,now)))return {reason:'contact_creator_affiliation_required'};
 if(!key||typeof e.sourceText!=='string'||e.sourceText.length>4000||!e.sourceText.toLowerCase().includes(email)||e.ambiguous===true)return {reason:'published_email_not_verified'};
 const found=[...new Set((e.sourceText.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(x=>x.toLowerCase()))];
 if(found.length!==1||found[0]!==email)return {reason:'ambiguous_public_email'};
 const purposeText=e.sourceText.toLowerCase().replaceAll(email,'');
 if(!/협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor/i.test(purposeText)||/개인정보|채용|입사|고객\s*(?:센터|지원)|팬\s*(?:레터|메일)|privacy|recruit|career|support|customer|fan\s*mail|not\s+(?:for\s+)?(?:business|commercial|advertis|collab)|no\s+(?:business|commercial|advertis|collab)|(?:협업|광고|사업|제휴).{0,30}(?:거절|금지|받지|불가|아닙|아님|제외)/i.test(purposeText))return {reason:'collaboration_purpose_unverified'};
 if(/(?:privacy|abuse|noreply|no-reply|support|careers|recruit|legal)@/.test(email))return {reason:'non_collaboration_address'};
 return {address:email,key,sourceUrl:url,sourceText:e.sourceText,sourceKind:e.sourceKind,checkedAt:e.checkedAt,purpose:e.purpose,verified:true,accessMethod:e.accessMethod,affiliation:e.sourceKind==='instagram_public_bio'?null:affiliation};
}
export function qualifyOutreachCandidate(row,now=Date.now()){
 const creatorKey=creatorIdentity(row),reasons=[];
 if(!creatorKey)return {eligible:false,reasons:['creator_identity_required']};
 const audience=row.audience,bounds=audienceBounds(row.platform);
 if(!Number.isSafeInteger(audience)||!bounds||audience<bounds.minimum||audience>bounds.maximum)reasons.push('audience_out_of_range_or_unknown');
 if(!sourceUrl(row.audienceSource)||!fresh(row.audienceCheckedAt,now))reasons.push('fresh_audience_evidence_required');
 if(!sourceUrl(row.activitySource)||!fresh(row.activityCheckedAt,now)||!fresh(row.lastActiveAt,now,DAILY_OUTREACH.activityDays))reasons.push('recent_activity_unverified');
 if(row.mukbang?.verified!==true||!sourceUrl(row.mukbang?.sourceUrl)||!fresh(row.mukbang?.checkedAt,now)||(!clean(row.mukbang?.sourceText)||clean(row.mukbang?.sourceText).length>2000))reasons.push('mukbang_evidence_required');
 if(row.displayNameReviewRequired===true)reasons.push('manual_display_name_review_required');
 if(row.platform==='instagram'&&row.existingDatabaseRecord!==true)reasons.push('existing_instagram_record_required');
 if(row.excluded===true||row.priorContact===true||row.suppressed===true)reasons.push('existing_contact_or_suppression');
 const contact=contactEvidence(row,now);
 let supplyReview=null;
 if(row.supplyReview!==undefined){const r=row.supplyReview;
  if(row.platform!=='instagram'||r.source!=='existing_instagram_database'||r.sourceRecordUpdated!==row.sourceRecordUpdated||!fresh(r.reviewedAt,now,29)||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=now||Date.parse(r.expiresAt)>Date.parse(r.reviewedAt)+29*DAY)reasons.push('instagram_source_review_invalid_or_expired');
  else supplyReview={source:r.source,sourceRecordUpdated:r.sourceRecordUpdated,reviewedAt:r.reviewedAt,expiresAt:r.expiresAt};
 }
 const api=row.apiSnapshot;let apiSnapshot=null,displayNameEvidence=null;
 if(api!==undefined){
  const fields=['creatorKey','externalId','profileUrl','name','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt'];
  if(row.platform!=='youtube'||api.channelId!==row.externalId||!fresh(api.observedAt,now,29)||!Number.isFinite(Date.parse(api.expiresAt))||Date.parse(api.expiresAt)<=now||Date.parse(api.expiresAt)>Date.parse(api.observedAt)+29*DAY||!Array.isArray(api.fieldNames)||api.fieldNames.some(k=>!fields.includes(k))||typeof api.titleFromApi!=='boolean')reasons.push('api_snapshot_invalid_or_expired');
  else apiSnapshot={channelId:api.channelId,observedAt:api.observedAt,expiresAt:api.expiresAt,fieldNames:[...api.fieldNames],titleFromApi:api.titleFromApi};
 }
 const e=row.displayNameEvidence,url=sourceUrl(e?.sourceUrl);
 if(e&&e.verified===true&&e.name===clean(row.name)&&['official_website','provided_by_creator'].includes(e.kind)&&url&&!/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname)&&clean(e.sourceText).includes(e.name)&&fresh(e.checkedAt,now,29)){
  displayNameEvidence={name:e.name,sourceUrl:url,sourceText:e.sourceText,checkedAt:e.checkedAt,verified:true,kind:e.kind,...(e.creatorKey?{creatorKey:e.creatorKey}:{}),...(e.profileUrl?{profileUrl:e.profileUrl}:{})};
 }
 // A new API identity must have an independent creator-owned source before it
 // enters a durable outreach audit. A saved CRM record alone never upgrades it.
 if(apiSnapshot?.fieldNames.some(k=>['creatorKey','externalId','profileUrl'].includes(k))&&(!displayNameEvidence||displayNameEvidence.creatorKey!==creatorKey||displayNameEvidence.profileUrl!==row.profileUrl||!displayNameEvidence.sourceText.includes(row.externalId)))reasons.push('independent_creator_identity_required');
 if(apiSnapshot?.titleFromApi===true&&!displayNameEvidence)reasons.push('manual_display_name_required');
 const candidate={creatorKey,platform:row.platform,externalId:row.externalId,name:clean(row.name).slice(0,200),profileUrl:sourceUrl(row.profileUrl),sourceRecordId:row.sourceRecordId||null,audience,audienceSource:sourceUrl(row.audienceSource),audienceCheckedAt:row.audienceCheckedAt,lastActiveAt:row.lastActiveAt,activitySource:sourceUrl(row.activitySource),activityCheckedAt:row.activityCheckedAt,mukbang:{sourceUrl:sourceUrl(row.mukbang?.sourceUrl),sourceText:clean(row.mukbang?.sourceText),checkedAt:row.mukbang?.checkedAt},contact:contact.address?contact:null,...(apiSnapshot?{apiSnapshot}:{}),...(displayNameEvidence?{displayNameEvidence}:{}),...(supplyReview?{supplyReview}:{})};
 if(!candidate.name||!profileMatches(row,candidate.profileUrl))reasons.push('creator_profile_required');
 return {eligible:reasons.length===0,reasons,contactReason:contact.reason||null,candidate};
}
export function buildDailyOutreachBatch({candidates,history,now=Date.now()}){
 if(!Array.isArray(candidates)||candidates.length>5000)throw new OutreachError('SOURCE_INVALID','후보 원본을 확인하지 못했습니다.',503);
 if(!history||history.complete!==true||!Array.isArray(history.creatorKeys)||!Array.isArray(history.emailKeys))throw new OutreachError('HISTORY_INCOMPLETE','전체 발송·중복 이력을 확인하지 못해 준비를 중단했습니다.',503);
 const creatorKeys=new Set(history.creatorKeys),emailKeys=new Set(history.emailKeys.map(emailIdentity).filter(Boolean));
 const selected=[],held=[],counts={youtube:0,instagram:0},seen=new Set();
 const sourceCounts=new Map();for(const row of candidates){const key=creatorIdentity(row);if(key)sourceCounts.set(key,(sourceCounts.get(key)||0)+1);}
 const candidatesQualified=candidates.map(row=>qualifyOutreachCandidate(row,now));
 // Deterministic order; no inferred gender, appearance scoring or quota padding.
 candidatesQualified.sort((a,b)=>Number(Boolean(b.candidate?.contact))-Number(Boolean(a.candidate?.contact))||String(a.candidate?.creatorKey).localeCompare(String(b.candidate?.creatorKey)));
 for(const q of candidatesQualified){const c=q.candidate;if(!c){held.push({creatorKey:null,reasons:q.reasons});continue;}if(seen.has(c.creatorKey))continue;seen.add(c.creatorKey);
  const reasons=[...q.reasons];if(sourceCounts.get(c.creatorKey)>1)reasons.push('duplicate_source_records_require_review');if(creatorKeys.has(c.creatorKey))reasons.push('duplicate_creator');if(c.contact&&emailKeys.has(c.contact.key))reasons.push('duplicate_email');if(q.contactReason)reasons.push(q.contactReason);
  if(reasons.length){held.push({creatorKey:c.creatorKey,platform:c.platform,reasons});continue;}
  const target=c.platform==='youtube'?DAILY_OUTREACH.youtubeTarget:DAILY_OUTREACH.instagramTarget;
  if(counts[c.platform]>=target)continue;
  selected.push({...c,status:'awaiting_dispatch_review',expiresAt:new Date(Math.min(...[c.contact.checkedAt,c.audienceCheckedAt,c.activityCheckedAt,c.mukbang.checkedAt,...(c.contact.affiliation?[c.contact.affiliation.checkedAt]:[])].map(at=>Date.parse(at)+30*DAY),Date.parse(c.lastActiveAt)+90*DAY,c.apiSnapshot?Date.parse(c.apiSnapshot.expiresAt):Infinity,c.displayNameEvidence?Date.parse(c.displayNameEvidence.checkedAt)+29*DAY:Infinity,c.supplyReview?Date.parse(c.supplyReview.expiresAt):Infinity)).toISOString()});counts[c.platform]++;creatorKeys.add(c.creatorKey);emailKeys.add(c.contact.key);
 }
 const holdReasons={};for(const h of held)for(const reason of new Set(h.reasons))holdReasons[reason]=(holdReasons[reason]||0)+1;
 return {holdReasons,campaign:DAILY_OUTREACH.campaign,day:outreachDay(now),timezone:DAILY_OUTREACH.timezone,preparedAt:new Date(now).toISOString(),targetUnit:DAILY_OUTREACH.targetUnit,maxEmailsPerCreator:DAILY_OUTREACH.maxEmailsPerCreator,dedupeScope:DAILY_OUTREACH.dedupeScope,audienceBounds:DAILY_OUTREACH.audienceBounds,targets:{youtube:50,instagram:10},selected,held:held.slice(0,5000),counts,shortfall:{youtube:50-counts.youtube,instagram:10-counts.instagram},sendingEnabled:false,schedulerEnabled:false,copyStatus:'private_template_required',note:'플랫폼 간 중복을 제외한 검증된 공개 업무 이메일 주소 수입니다. 크리에이터당 한 주소만 선택합니다. 발송·수신 동의·전달 성공을 의미하지 않습니다.'};
}
export function renderOutreachCopy({template,channelName,signature,attachments=[],inlineImages=[]}){
 const name=clean(channelName);
 if(!name||name.length>150||/[\u0000-\u001f\u007f]/.test(name))throw new OutreachError('CHANNEL_NAME_INVALID','실제 채널명을 확인하세요.');
 if(template?.approved!==true||!clean(template.approvalSource)||typeof template.subject!=='string'||typeof template.body!=='string'||!template.subject||!template.body||template.subject.length>200||template.body.length>20000||/[\r\n]/.test(template.subject))throw new OutreachError('COPY_REVIEW_REQUIRED','사용자 승인 제목·본문이 필요합니다.');
 if(signature?.verified!==true||signature.source!=='existing_gmail_signature'||!clean(signature.senderEmail)||!emailIdentity(signature.senderEmail)||!clean(signature.text)||!clean(signature.html))throw new OutreachError('SIGNATURE_REQUIRED','기존 Gmail 서명을 확인해야 합니다.');
 const subject=template.subject.replaceAll('[채널명]',()=>name),body=template.body.replaceAll('[채널명]',()=>name);
 if(/\[채널명\]/.test(subject+body))throw new OutreachError('PLACEHOLDER_UNRESOLVED','채널명 치환을 확인하세요.');
 // Do not rewrite the approved closing, facts, fan statement, or offer terms.
 const occurrences=body.split(signature.text).length-1;
 if(occurrences>1)throw new OutreachError('SIGNATURE_DUPLICATE','본문의 서명 중복을 검토하세요.');
 const inlineIds=template.requiredInlineImageIds;
 if(inlineIds!==undefined){
  if(occurrences!==0)throw new OutreachError('SIGNATURE_ALREADY_IN_COPY','승인 본문에 이미 서명이 있어 본문 사진 위치와 서명 중복을 검토해야 합니다.');
  if(!Array.isArray(inlineIds)||inlineIds.length!==2||new Set(inlineIds).size!==2||inlineIds.some(id=>typeof id!=='string'||!id)||!clean(template.owner)||!Array.isArray(inlineImages)||inlineImages.length!==2)throw new OutreachError('INLINE_IMAGES_REQUIRED','사용자가 지정한 본문 사진 두 장을 확인해야 합니다.');
  if(inlineIds.some(id=>!inlineImages.some(image=>image.id===id&&image.owner===template.owner&&image.verified===true&&image.sharingApproved===true&&image.sha256?.match(/^[a-f0-9]{64}$/)&&Number.isSafeInteger(image.bytes)&&image.bytes>0)))throw new OutreachError('INLINE_IMAGES_UNVERIFIED','본문 사진의 원본·계정·공유 범위를 확인해야 합니다.');
  if(attachments.length)throw new OutreachError('UNEXPECTED_ATTACHMENTS','일반 첨부 대신 본문 사진 두 장만 사용합니다.');
  return {subject,body,senderEmail:signature.senderEmail,signatureHtml:signature.html,signatureText:signature.text,inlineImages:inlineIds.map(id=>inlineImages.find(image=>image.id===id)),attachments:[],templateRevision:template.revision,approvalSource:template.approvalSource,sendingEnabled:false};
 }
 const ids=template.requiredAttachmentIds;
 if(!Array.isArray(ids)||ids.length<1||ids.some(id=>typeof id!=='string'||!id))throw new OutreachError('PRODUCT_ATTACHMENTS_REQUIRED','본문에 명시한 제품 자료를 지정해야 합니다.');
 if(new Set(ids).size!==ids.length||!Array.isArray(attachments)||ids.some(id=>!attachments.some(a=>a.id===id&&a.verified===true&&a.sharingApproved===true&&a.sha256?.match(/^[a-f0-9]{64}$/)&&Number.isSafeInteger(a.bytes)&&a.bytes>0)))throw new OutreachError('PRODUCT_ATTACHMENTS_UNVERIFIED','승인된 제품 첨부파일을 확인해야 합니다.');
 return {subject,senderEmail:signature.senderEmail,body:occurrences===1?body:body+'\n\n'+signature.text,signatureHtml:occurrences===1?'':signature.html,signatureText:occurrences===1?'':signature.text,attachments:ids.map(id=>attachments.find(a=>a.id===id)),templateRevision:template.revision,approvalSource:template.approvalSource,sendingEnabled:false};
}
