import {createHash} from 'node:crypto';
const SUBJECT='도합 300만 크리에이터와 함께 일하는 남준혁 변리사입니다';
// Template must come from a trusted, versioned approval record; no default text.
function renderApprovedTemplate(template,plan){
 if(!template||template.userApproved!==true||template.subject!==SUBJECT||typeof template.body!=='string'||!/^[a-f0-9]{64}$/.test(template.sha256||''))throw Error('사용자가 승인한 템플릿 확인 필요');
 const digest=createHash('sha256').update(template.subject+'\n'+template.body,'utf8').digest('hex');
 if(digest!==template.sha256)throw Error('템플릿 버전 불일치');
 if(!plan?.handle||plan?.products?.length!==1)throw Error('계정과 상품 1개 확인 필요');
 const body=template.body;if(!body.includes('{{아이디}}')||!body.includes('{{상품명}}'))throw Error('템플릿 변수 확인 필요');
 if(/\{\{(?!아이디\}\}|상품명\}\})[^{}]+\}\}/.test(body))throw Error('미지원 템플릿 변수');
 return {subject:SUBJECT,body:body.replaceAll('{{아이디}}',()=>plan.handle).replaceAll('{{상품명}}',()=>plan.products[0].name),templateSha256:digest};
}
export {renderApprovedTemplate,SUBJECT};
