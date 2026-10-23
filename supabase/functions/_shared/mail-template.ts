import {dedupeProposal,realProductName} from "./mail-integrity.ts";
export function renderLeadText(text:string,brand:string,product:string,intro=""){
 let body=String(text||"").replace(/\{\{(브랜드명|회사명|제품명)\}\}/g,(_,key)=>key==="제품명"?product:brand);
 return body.includes("{{개인화}}")?body.split("{{개인화}}").join(intro):(intro?intro+"\n\n":"")+body;
}
export function leadOutreach(template:any,lead:any,time=new Date().toISOString()){
 const old=lead.outreach||{},brand=old.brandName||lead.name||lead.company||"업체",product=old.productName||lead.product||"공동구매 협의 가능한 상품",intro=template.data.copyFlow==="product_interest_v1"&&old.proposalType!=="manufacturer_supply"?productInterestIntro(product,old.intro||""):old.intro||"";
 const readyIntro=intro||"귀사의 브랜드와 크리에이터 공동구매 협업을 진행해보고 싶습니다. 공동구매 담당자분을 편하게 연결해주시면 감사하겠습니다. 저희가 적합한 크리에이터 후보와 채널 자료, 구체적인 진행안을 정리해 제안드리겠습니다.";
 return {...old,brandName:brand,companyName:brand,productName:product,intro:readyIntro,draftMode:intro?old.draftMode||"product":"brand_first",subject:renderLeadText(template.data.subject,brand,product),body:dedupeProposal(renderLeadText(template.data.body,brand,product,readyIntro)),signature:renderLeadText(template.data.signature,brand,product),templateId:template.id,templateVersion:template.version,templateUpdated:template.updated,approved:false,needsPersonalization:false,updated:time};
}

// Keep evidence-backed content ideas; combine product interest and the proposal once.
export function productInterestIntro(product:string,intro:string){
 const name=String(product||"").replace(/\s*\((?:단품|단일상품)\)\s*/g,"").trim();
 if(!realProductName(name)||name==="공동구매 협의 가능한 상품")return "";
 if(String(intro).startsWith("귀사의 ‘"))return intro;
 const lines=String(intro||"").split(/\n+/).map(s=>s.trim()).filter(Boolean);
 const idea=lines.filter(s=>!/^공식(?:몰| 제품| 홈페이지| 사이트)/.test(s)).join(" ")
  .replace(/푸드·라이프스타일/g,"라이프스타일")
  .replace(/공동구매를 제안드리고 싶습니다\./g,"공동구매를 진행해보고 싶습니다.");
 return "귀사의 ‘"+name+"’ 제품에 관심이 있어 크리에이터 공동구매를 제안드립니다."+(idea?"\n"+idea:"");
}
