export function renderLeadText(text:string,brand:string,product:string,intro=""){
 let body=String(text||"").replace(/\{\{(브랜드명|회사명|제품명)\}\}/g,(_,key)=>key==="제품명"?product:brand);
 return body.includes("{{개인화}}")?body.split("{{개인화}}").join(intro):(intro?intro+"\n\n":"")+body;
}
export function leadOutreach(template:any,lead:any,time=new Date().toISOString()){
 const old=lead.outreach||{},brand=old.brandName||lead.name||lead.company||"업체",product=old.productName||lead.product||"공동구매 협의 가능한 상품",intro=old.intro||"";
 return {...old,brandName:brand,companyName:brand,productName:product,intro,subject:renderLeadText(template.data.subject,brand,product),body:renderLeadText(template.data.body,brand,product,intro),signature:renderLeadText(template.data.signature,brand,product),templateId:template.id,templateVersion:template.version,templateUpdated:template.updated,approved:false,needsPersonalization:!intro,updated:time};
}
