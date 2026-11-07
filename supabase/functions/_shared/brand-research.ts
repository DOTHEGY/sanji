import {productWellnessCategory,officialBrandPages,verifiedWellnessProducts,normalizeBrandProductName,assessBrandQualification} from "./brand-qualification.ts";
import {realProductName,productDetailUrl,dedupeProposal} from "./mail-integrity.ts";
import { companyIdentity } from "./discovery.ts";
import { leadOutreach } from "./mail-template.ts";
export const concreteProductName=(s:any)=>{const t=String(s||"").trim();return realProductName(t)&&!/제품군|완제품|협의 가능한|제안 가능|공식몰|쇼핑몰|헬스케어몰|라이프 솔루션|^SHOP$|^공식몰 특가$|가을맞이|Big 세일|브랜드 페스타|최근.*상품|진심을 담은 커피/i.test(t);};
const unsafe=/치료|예방|항암|완치|혈당|혈압|면역력|체지방|다이어트|키성장|키 성장|통증|개선|효능|효과|질병|성기능|발기/;
const clean=normalizeBrandProductName;
export function researchBrand(lead:any,template:any,checked=new Date().toISOString()){
 const at=Number.isFinite(Date.parse(checked))?Date.parse(checked):Date.now(),pages=officialBrandPages(lead,at),old=lead.outreach||{};
 const home=pages.find((p:any)=>{try{return new URL(p.url).hostname.replace(/^www\./,"")===new URL(lead.website).hostname.replace(/^www\./,"");}catch{return false;}});
 let product:any=verifiedWellnessProducts(lead,at).find(p=>concreteProductName(p.name)&&p.name.length<=95&&!unsafe.test(p.name)&&!/(로그인|쿠폰|배송비|판매가|공식몰|쇼핑몰|헬스케어몰)/.test(p.name));
 if(!product){
  const external=(lead.marketProductEvidence||[]).find((p:any)=>p.sourceType==="marketplace_product_page"&&p.url&&p.checked&&Date.parse(p.checked)<=at+60000&&Date.parse(p.checked)>=at-30*86400000&&productDetailUrl(p.url)&&concreteProductName(p.name)&&productWellnessCategory(p,{})&&!unsafe.test(p.name));
  if(external)product={...external,category:productWellnessCategory(external,{}),external:true};
 }
 const oldName=String(lead.name||"");let brand=(lead.research?.method==="official_page_evidence"?oldName:old.brandName)||oldName;
 if(old.needsPersonalization&&home?.title&&/공식.*(?:몰|쇼핑몰)/.test(home.title)&&!old.sendBlockedReason&&!companyIdentity(home.title+" "+home.description).includes(companyIdentity(brand)))brand=clean(home.title.split(/\s+-\s+|\s*[|｜]\s*/)[0]).replace(/\s*공식.*$/,"");
 if(/새\s*창\s*열림|›|https?:|\.(?:co\.kr|com)\b/.test(brand)&&home?.title)brand=clean(home.title.split(/\s+-\s+|\s*[|｜]\s*/)[0]).replace(/\s*공식.*$/,"");
 const identities=Array.from(new Set([brand,old.brandName,lead.name].filter(Boolean).flatMap(s=>String(s).split(/[·|｜]/)).map(s=>companyIdentity(s).replace(/(?:건강식품|공식몰|건강몰)$/, "")).filter(s=>s.length>=2)));
 const matches=(text:string)=>identities.some(s=>companyIdentity(text).includes(s));
 const sameName=!!home&&matches([home.title,home.description,home.excerpt].join(" "));
 const contactEvidence=(lead.contacts||[]).map((c:any)=>{
  const p=pages.find((p:any)=>{try{return new URL(p.url).href===new URL(c.source).href;}catch{return false;}});
  // A link to another legal entity alone is insufficient. Require the target brand on the actual email source.
  const sameOrigin=!!p&&!!home&&new URL(p.url).origin===new URL(home.url).origin;
  const sameSource=!!p&&(matches([p.title,p.description].join(" "))||(sameOrigin&&String(p.excerpt||"").toLowerCase().includes(String(c.email||"").toLowerCase())));
  return {email:c.email,source:c.source,supported:sameName&&sameSource,checked};
 });
 const ownershipSupported=contactEvidence.length>0&&contactEvidence.every((c:any)=>c.supported);
 const research:any={checked,method:"official_page_evidence",ownership:ownershipSupported?"source_supported":"research_pending",contactEvidence,product:product?.name||"",productSource:product?.url||"",reason:!product?"공식 페이지에서 웰니스와 관련된 실제 상품·판매 근거를 추가 확인 중입니다.":product.external?"외부 판매처 상품명 확인 · 공식 상품·공급 관계 추가 확인 필요":!ownershipSupported?"제안 브랜드와 이메일이 게시된 회사의 연결 근거를 추가 조사 중입니다.":"공식 페이지의 브랜드·상품·이메일 게시 출처 대조 완료"};
 if(assessBrandQualification({...lead,research},[],at).eligible&&old.productSourceType!=="marketplace_search_index"&&(!old.productName||realProductName(old.productName))&&old.draftMode!=="brand_first"&&old.intro&&!old.needsPersonalization&&!old.sendBlockedReason&&(!old.productName||concreteProductName(old.productName))){
 const kept={...old};if(old.personalizationRevision===3&&old.brandName&&old.brandName!==brand){for(const k of ["subject","body","signature"])if(typeof kept[k]==="string")kept[k]=kept[k].split(old.brandName).join(brand);kept.brandName=brand;kept.companyName=brand;}
 return {research,outreach:kept};
 }
 if(!product){
  const draft=template?leadOutreach(template,{...lead,outreach:{...old,productName:"",intro:""},product:""},checked):old;
  return {research,outreach:{...draft,needsPersonalization:!draft.body,researchStatus:"pending",researchReason:research.reason,draftMode:"brand_first"}};
 }
 let idea="상품 구성과 사용 방법을 직접 보여주는 푸드·라이프스타일 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 if(product.category==='sleep_rest')idea="라이프스타일 크리에이터가 잠자리 준비와 일상 속 사용 방법, 상품 구성을 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(product.category==='fitness_recovery')idea="운동·웰니스 크리에이터가 일상 운동에서의 사용 방법과 상품 구성을 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(product.category==='personal_care')idea="라이프스타일 크리에이터가 일상적인 셀프케어 과정과 상품 구성을 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(/견과|넛츠|넛트/.test(product.name))idea="베이킹 크리에이터가 실제 레시피에서 견과를 활용하고, 구성별 차이를 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(/단백질|쉐이크|프로틴/.test(product.name))idea="운동·웰니스 크리에이터가 실제 조리·섭취 준비 과정과 제품별 구성을 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(/오일|올리브/.test(product.name))idea="푸드 크리에이터의 실제 요리에서 활용 장면과 제품 구성을 함께 보여주는 방식으로 공동구매를 제안드리고 싶습니다.";
 else if(/커피|디카페인/.test(product.name))idea="라이프스타일 크리에이터가 직접 커피를 준비하는 일상 콘텐츠에 제품 구성과 활용 장면을 담는 공동구매를 제안드리고 싶습니다.";
 const intro=(product.external?(product.sourceType==="marketplace_search_index"?"공개 판매 페이지 검색 결과에 ‘"+product.name+"’이 게시되어 있어 공동구매 협업을 검토하고 싶습니다.":"공개 판매 페이지에서 ‘"+product.name+"’ 상품명을 확인했습니다."):"공식몰에서 ‘"+product.name+"’"+(product.name.endsWith("제품군")?"을 확인했습니다.":"의 상품 구성을 확인했습니다."))+"\n"+idea;
 const updated={...lead,name:brand,outreach:{...old,brandName:brand,companyName:brand,productName:product.name,intro,evidence:[{url:product.url,description:product.external?"외부 판매처 상품명 · "+product.uncertainty:"공식 상품명·구성",quote:product.quote,checked:product.checked}],draftMode:"product",productSourceType:product.external?product.sourceType:"official",uncertainty:product.external?product.uncertainty:old.uncertainty||"",personalizationRevision:3,personalizationUpdated:checked,personalizationMethod:"공개 근거 기반 자동 작성",needsPersonalization:false,researchStatus:ownershipSupported&&!product.external?"completed":"pending",researchReason:research.reason}};
 const outreach=template?leadOutreach(template,updated,checked):updated.outreach;
 outreach.body=dedupeProposal(outreach.body);
 return {research,outreach};
}
