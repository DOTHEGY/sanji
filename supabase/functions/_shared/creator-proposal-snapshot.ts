// Validate the stored, operator-reviewed creator proposal before creating a draft.
// No writes, queue creation, token issuance or external messages happen here.
export function assertCreatorProposalSnapshot(owner:string,candidate:any,review:any,creator:any,input:any){
 if(!owner||!review||review.owner!==owner||!creator||creator.owner!==owner||review.creator_id!==creator.id||review.version!==input.creatorReviewVersion||candidate.kind!=='크리에이터'||candidate.channel==='manual_dm')throw Error('크리에이터 검토 소유자 또는 버전이 일치하지 않습니다.');
 if(String(candidate.handle||'').replace(/^@/,'').toLowerCase()!==String(creator.handle||'').toLowerCase())throw Error('크리에이터 계정이 일치하지 않습니다.');
 const e=review.data?.email||{},address=String(e.address||'').toLowerCase();if(input.channel!=='email'||!address||address!==String(candidate.contact?.email||'').toLowerCase()||!candidate.contact?.verified||!creator.profile_url||e.sourceUrl!==creator.profile_url)throw Error('공개 이메일과 출처가 일치하지 않습니다.');
 if(input.subject!==e.subject||input.body!==e.body||input.signature||input.templateId||input.replyTo||input.recipientMode!=='primary')throw Error('승인된 제목 또는 본문이 변경됐습니다.');
 if(['scheduled','sent','unknown'].includes(e.observation?.status))throw Error('이미 외부 예약·발송됐거나 확인이 필요합니다.');
 if(!Array.isArray(input.dealIds)||input.dealIds.length<1||input.dealIds.length>3||new Set(input.dealIds).size!==input.dealIds.length)throw Error('제안 상품 1~3개를 확인하세요.');
 return {creatorReviewId:creator.id,creatorReviewVersion:review.version,proposalType:'creator_product_proposal'};
}
