import {planCreator} from './plan.mjs';
import {renderApprovedTemplate} from './template.mjs';
// All mutations use existing owner-authenticated Sanji review/draft/mail routes.
// Only one frozen target is processed per invocation; no Gmail/DM provider calls here.
async function processOne({owner,runId,creatorId,loadRun,loadContext,loadTemplate,callExisting,queue,markSkip,now=()=>Date.now()}){
 const run=await loadRun(owner,runId),item=run?.items?.find(x=>x.creator_id===creatorId);
 if(!item)return {status:'unavailable'};
 if(run.paused===true)return {status:'paused'};
 if(item.status!=='pending')return {status:item.status,job:item.job||null};
 const ctx=await loadContext(owner,runId,creatorId);if(!ctx||ctx.complete!==true)return {status:'stopped',reason:'상품 전체 목록 확인 필요'};
 const plan=planCreator(ctx.creator,ctx.deals);
 if(plan.status!=='ready_for_verification'){
  const reason=plan.reason==='공개 이메일 확인 필요'?'email_unverified':plan.reason==='적합한 상품 연관 근거 필요'?'product_evidence_missing':plan.reason==='연락 상태 확인 필요'?'contact_status':'identity_unverified';
  const saved=await markSkip(owner,runId,creatorId,reason);return {status:saved?'skipped':'stopped',reason};
 }
 const settings=ctx.settings||{},signature=String(settings.emailSignature||'').trim(),mailbox=String(ctx.gmail?.email||'').toLowerCase();
 if(settings.signatureSource!=='gmail'||!signature||!settings.gmailSignatureHtml||mailbox!=='valuest24@gmail.com'||String(settings.gmailSignatureEmail||'').toLowerCase()!==mailbox){const saved=await markSkip(owner,runId,creatorId,'signature_unavailable');return {status:saved?'skipped':'stopped',reason:'Gmail 서명 확인 필요'};}
 const template=await loadTemplate(owner,run.templateSha256);let proposal;try{proposal=renderApprovedTemplate(template,plan)}catch{return {status:'stopped',reason:'승인 템플릿 확인 필요'}}
 const prior=ctx.review,prev=prior?.data||{},old=prev.email||{};
 // Existing written or held reviews are never overwritten or interpreted as consent.
 if(prior&&(old.status&&old.status!=='not_prepared'||old.subject||old.body||(old.productIds||[]).length||old.observation)){const saved=await markSkip(owner,runId,creatorId,'review_existing');return {status:saved?'skipped':'stopped',reason:'기존 검토 자료 확인 필요'};}
 if(old.address&&String(old.address).toLowerCase()!==plan.email.toLowerCase()){const saved=await markSkip(owner,runId,creatorId,'address_conflict');return {status:saved?'skipped':'stopped',reason:'기존 주소 확인 필요'};}
 const reviewData={...prev,email:{...old,address:plan.email,sourceUrl:plan.sourceUrl,productIds:[plan.products[0].id],subject:proposal.subject,body:proposal.body,status:'reviewed'},dm:prev.dm||{}};
 let saved;try{saved=await callExisting('/creator-contact-review',{creatorId,version:prior?.version||0,data:reviewData})}catch{return {status:'stopped',reason:'검토 저장 결과 확인 필요'}}
 if(!Number.isInteger(saved?.version)||saved.version<1)return {status:'stopped',reason:'검토 저장 결과 확인 필요'};
 let target,preview;try{
  target=await callExisting('/creator-proposal/target',{creatorId,version:saved.version});if(!target?.target)throw Error('target unavailable');
  preview=await callExisting('/drafts',{target:target.target,proposalType:'creator_product_proposal',creatorReviewId:creatorId,creatorReviewVersion:saved.version,dealIds:[plan.products[0].id],channel:'email',subject:proposal.subject,body:proposal.body,signature:'',attachments:[],recipientMode:'primary',marketing:false});
 }catch{return {status:'stopped',reason:'초안 준비 결과 확인 필요'}}
 if(!preview?.id||!preview?.hash||String(preview.email||'').toLowerCase()!==plan.email.toLowerCase()||preview.subject!==proposal.subject||!preview.body)return {status:'stopped',reason:'초안 검증 필요'};
 const count=(text,part)=>part?text.split(part).length-1:0,disclosure=String(preview.tracking?.disclosure||'');
 if(count(preview.body,signature)!==1||preview.tracking?.eligible!==true||!disclosure||count(preview.body,disclosure)!==1){const saved=await markSkip(owner,runId,creatorId,'tracking_notice_unavailable');return {status:saved?'skipped':'stopped',reason:'서명 또는 추적 안내 확인 필요'};}
 // The existing queue processes due jobs; the small future margin avoids a past timestamp.
 const runAt=new Date(now()+120000).toISOString();try{return await queue(owner,runId,creatorId,preview.id,preview.hash,runAt)}catch{return {status:'outcome_unknown',reason:'예약 결과 확인 필요 · 재시도 금지'}}
}
export {processOne};
