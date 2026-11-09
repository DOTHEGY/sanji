import {emailIdentity} from '../supabase/functions/creator-daily-outreach/domain.mjs';
// Presentation contracts only. Eligibility and cross-platform mailbox identity stay
// on the authenticated server; a saved lead never becomes a verified recipient here.
export const EMAIL_TARGETS=Object.freeze({youtube:50,instagram:10});
export function inAudienceRange(value,platform='youtube'){
 return Number.isSafeInteger(value)&&value>=30000&&value<=(platform==='instagram'?500000:200000);
}
export function matchesRecipientCriteria(value){
 return value?.targetUnit==='distinct_verified_business_email'&&value.maxEmailsPerCreator===1&&value.dedupeScope==='cross_platform'&&value.audienceBounds?.youtube?.minimum===30000&&value.audienceBounds?.youtube?.maximum===200000&&value.audienceBounds?.instagram?.minimum===30000&&value.audienceBounds?.instagram?.maximum===500000;
}
export function verifiedMailboxSummary(value){
 if(!matchesRecipientCriteria(value))return null;
 for(const platform of ['youtube','instagram'])if(!Number.isSafeInteger(value.counts?.[platform])||value.counts[platform]<0||value.counts[platform]>EMAIL_TARGETS[platform]||!Number.isSafeInteger(value.shortfall?.[platform])||value.shortfall[platform]<0||value.counts[platform]+value.shortfall[platform]!==EMAIL_TARGETS[platform])return null;
 return value;
}
export function savedEmailDisplay(data){
 const leads=[data?.contact,...(Array.isArray(data?.youtubeResearch?.businessContacts)?data.youtubeResearch.businessContacts:[])];
 const emails=[...new Set(leads.map(x=>typeof x?.email==='string'?x.email.trim().toLowerCase():'').filter(x=>x.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))];
 return {email:emails[0]||null,otherCount:Math.max(0,emails.length-1),label:emails.length?'공개 주소 후보 · 검토 필요':'공개 이메일 미확인'};
}
export function previewEnvelope(raw,{creatorKey,snapshotId,policyRevision}){
 if(!raw||raw.previewOnly!==true||raw.sendingEnabled!==false||raw.creatorKey!==creatorKey||raw.snapshotId!==snapshotId||raw.policyRevision!==policyRevision||raw.imageCount!==2||typeof raw.channelName!=='string'||!raw.channelName.trim()||raw.channelName.length>200||typeof raw.subject!=='string'||!raw.subject.trim()||raw.subject.length>300||/[\r\n]/.test(raw.subject)||typeof raw.html!=='string'||raw.html.length>15*1024*1024||!raw.html.trim()||!Number.isSafeInteger(raw.templateRevision)||raw.templateRevision<1||!/^[a-f0-9]{64}$/.test(raw.scopeHash||'')||raw.recipient!==null&&(typeof raw.recipient!=='string'||raw.recipient.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw.recipient))||!Array.isArray(raw.warnings)||raw.warnings.some(x=>typeof x!=='string'||x.length>2000))throw Error('개별 카피 응답을 확인하지 못했습니다. 설정을 새로고침하세요.');
 return raw;
}
export function privatePreviewDocument(html){
 // CSP comes before untrusted HTML and cannot be relaxed by later meta tags.
 // The empty iframe sandbox also denies navigation, forms, scripts and same-origin.
 return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\';"><style>body{font:15px/1.7 Arial,sans-serif;padding:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{pointer-events:none}</style>'+html;
}
export function previewWarning(code){
 const labels={preview_is_not_send_authorization:'카피 미리보기는 수신 동의나 발송 승인을 뜻하지 않습니다.',signature_remote_images_hidden_in_preview:'서명 외부 이미지는 미리보기에서 숨겼습니다.',historical_recipient_criteria:'이전 수신자 기준의 설정입니다. 현재 기준을 다시 확인하세요.',public_email_evidence_required:'공개 업무 이메일 원문 확인이 필요합니다.',contact_observation_time_invalid:'연락처 확인 시각을 다시 검토해야 합니다.',ambiguous_contact_observation:'연락처 확인 기록이 서로 달라 재검토가 필요합니다.',contact_source_review_required:'연락처 공개 출처와 업무 용도 검토가 필요합니다.',youtube_contact_harvesting_not_supported:'YouTube 연락처 자동 수집은 지원하지 않습니다.',contact_creator_affiliation_required:'주소와 크리에이터의 소속 관계를 확인해야 합니다.',published_email_not_verified:'공개 이메일 원문 확인이 완료되지 않았습니다.',ambiguous_public_email:'공개 주소가 여러 개여서 수신자 선택 검토가 필요합니다.',collaboration_purpose_unverified:'협업 문의용으로 공개된 주소인지 확인해야 합니다.',non_collaboration_address:'협업 문의용 주소로 확인되지 않았습니다.',audience_out_of_range_or_unknown:'현재 구독자·팔로워 기준 밖이거나 규모 미확인입니다.',fresh_audience_evidence_required:'최신 구독자·팔로워 수 근거가 필요합니다.',recent_activity_unverified:'최근 활동 확인이 필요합니다.',mukbang_evidence_required:'먹방 콘텐츠 근거 확인이 필요합니다.',manual_display_name_review_required:'채널명 원문 확인이 필요합니다.',manual_display_name_required:'채널명 원문 확인이 필요합니다.',existing_instagram_record_required:'기존 Instagram 원본 확인이 필요합니다.',existing_contact_or_suppression:'기존 연락·제외 기록이 있어 발송 대상 검토가 필요합니다.',instagram_source_review_invalid_or_expired:'Instagram 원문 검토가 만료되었거나 다시 확인해야 합니다.',api_snapshot_invalid_or_expired:'검색 근거가 만료되었거나 다시 확인해야 합니다.',independent_creator_identity_required:'독립 출처의 채널 연결 근거가 필요합니다.',creator_profile_required:'크리에이터 프로필 확인이 필요합니다.'};
 return labels[code]||(/^[a-z_]+$/.test(code)?'추가 원문 근거 확인이 필요합니다.':code);
}

export function preparedRecipients(raw,day){
 const invalid=()=>{throw Error('오늘 준비한 수신 주소를 확인하지 못했습니다. 목록을 새로고침하세요.');};
 if(!raw||raw.scope!=='current_day_prepared_recipients'||raw.day!==day||raw.preparationOnly!==true||raw.sendingEnabled!==false||raw.gmailHistoryChecked!==false||!Array.isArray(raw.items)||raw.items.length>60||!raw.counts)return invalid();
 const counts={youtube:0,instagram:0},creators=new Set(),mailboxes=new Set();
 for(const row of raw.items){
  if(!row||!['youtube','instagram'].includes(row.platform)||typeof row.name!=='string'||!row.name.trim()||row.name.length>200||typeof row.email!=='string'||row.email!==row.email.trim().toLowerCase()||!inAudienceRange(row.audience,row.platform))return invalid();
  const key=emailIdentity(row.email),validCreator=row.platform==='youtube'?/^youtube:UC[A-Za-z0-9_-]{22}$/.test(row.creatorKey||''):/^instagram:[a-z0-9._]{1,30}$/.test(row.creatorKey||'');
  if(!key||!validCreator||creators.has(row.creatorKey)||mailboxes.has(key))return invalid();
  creators.add(row.creatorKey);mailboxes.add(key);counts[row.platform]++;
 }
 for(const platform of ['youtube','instagram'])if(!Number.isSafeInteger(raw.counts[platform])||raw.counts[platform]!==counts[platform]||counts[platform]>EMAIL_TARGETS[platform])return invalid();
 return raw;
}
