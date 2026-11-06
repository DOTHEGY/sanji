import {assessMailLead,editorialSource,officialOrigins,realProductName,productDetailUrl} from './mail-integrity.ts';
import {companyIdentity} from './discovery.ts';

export const brandQualificationRevision=1;
export const foodEvidence=/식품|식료품|식재료|음료|유산균|비타민|단백질|프로틴|올리브|발사믹|견과|유제품|우유|두유|선식|홍삼|오메가|콜라겐|효소|커피|차류|오트밀|요거트|꿀|즙|쌍화|그래놀라|프로폴리스|\b(?:food|grocery|honey|coffee|tea|protein|probiotic|vitamin|nutrition|supplement|olive|balsamic|juice|milk|granola)\b/i;
const nonFood=/의료기기|안마기|마사지기|저주파|화장품|샴푸|세럼|토너|선크림|바디로션|마스크팩|텀블러|머그|컵세트|컵받침|커피머신|커피메이커|커피기구|드리퍼|필터|그라인더|주전자|보관용기|식기|수저|도마|프라이팬|\b(?:cosmetics|serum|shampoo|massager|tumbler|mug|coffee maker|coffee machine|grinder|dripper|kettle|tableware)\b/i;
const accessory=/텀블러|머그|컵세트|컵받침|커피머신|커피메이커|커피기구|드리퍼|필터|그라인더|주전자|보관용기|식기|수저|도마|프라이팬|키링|스티커|휴대폰\s*케이스|가방|보관함|\b(?:tumbler|mug|coffee maker|coffee machine|grinder|dripper|kettle|tableware|keychain|sticker|phone case|bag|storage case)\b/i;
const pouch=/파우치|\bpouch(?:es)?\b/i;
const pouchFood=/쉐이크|셰이크|프로틴|즙|젤리|\b(?:shake|protein|juice|jelly)\b/i;
const storagePouch=/(?:보관|수납|휴대)(?:용)?\s*(?:파우치|pouch)|빈\s*파우치|(?:파우치|pouch).{0,25}(?:수납|보관용)|\b(?:storage|carrying|empty|reusable|organizer)\b/i;
// A shake/juice pouch can be edible packaging. A storage pouch is still an accessory;
// generic food-site/category copy cannot establish the exception for an unnamed SKU.
const productAccessory=(text:string,name:string)=>accessory.test(text)||(pouch.test(text)&&(!pouchFood.test(name)||storagePouch.test(text)));
const medicalOrIndustrial=/의료기기|의료용|병원용|수술|주사|필러|산업용|기계용|자동차용|차량용|엔진\s*오일|윤활유|윤활제|저주파|전기자극|치료기|진단기|\b(?:medical|clinical device|surgical|injection|filler|industrial|automotive|engine oil|motor oil|lubricant|diagnostic|electrostimulation|TENS|CPAP)\b/i;
const medicalClaim=/치료|예방|항암|완치|질병|혈당|혈압|면역력|체지방|키\s*성장|성기능|발기|불면증|통증|염증|\b(?:treat(?:s|ment)?|cur(?:e|es|ing)|prevent(?:s|ion)?|disease|cancer|insomnia|pain relief|blood (?:sugar|pressure)|inflammation|boost(?:s|ing)? immunity)\b/i;
const sleepType=/안대|베개|침구|이불|매트리스|귀마개|\b(?:sleep mask|eye mask|pillow|bedding|blanket|mattress|earplugs?)\b/i;
const sleepPurpose=/수면|숙면|잠자리|취침|차광|\b(?:sleep|bedtime|sleeping|blackout)\b/i;
const fitnessType=/요가\s*매트|운동\s*매트|요가\s*블록|폼\s*롤러|마사지\s*볼|스트레칭\s*밴드|저항\s*밴드|운동\s*밴드|덤벨|아령|케틀벨|\b(?:yoga mat|exercise mat|yoga block|foam roller|massage ball|resistance band|exercise band|dumbbell|kettlebell)s?\b/i;
const fitnessPurpose=/운동|요가|필라테스|스트레칭|홈트|근육\s*이완|운동\s*후|\b(?:exercise|yoga|pilates|stretching|workout|fitness|muscle relaxation|post-workout)\b/i;
const careType=/화장품|샴푸|컨디셔너|세럼|토너|선크림|선스크린|바디\s*로션|로션|보습\s*크림|나이트\s*크림|마스크팩|클렌저|비누|바디\s*워시|배스\s*솔트|입욕제|치약|칫솔|치실|\b(?:cosmetics|shampoo|conditioner|serum|toner|sunscreen|lotion|moisturi[sz]er|night cream|face mask|cleanser|soap|body wash|bath salts?|toothpaste|toothbrush|dental floss)\b/i;
const carePurpose=/피부\s*(?:관리|보습|세정)|스킨\s*케어|바디\s*케어|헤어\s*케어|두피\s*(?:관리|세정)|보습|세정|목욕|입욕|구강\s*(?:관리|위생)|\b(?:skin\s*care|body\s*care|hair\s*care|moisturi[sz](?:ing|ation)|cleansing|bathing|oral (?:care|hygiene)|dental hygiene)\b/i;
export type WellnessCategory='food'|'sleep_rest'|'fitness_recovery'|'personal_care';
const categoryLabels:Record<WellnessCategory,string>={food:'식품·음료·영양',sleep_rest:'수면·휴식',fitness_recovery:'운동·일상 회복',personal_care:'개인 위생·셀프케어'};
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
const current=(value:any,at:number)=>Number.isFinite(Date.parse(value||''))&&Date.parse(value)<=at+60000&&Date.parse(value)>=at-30*86400000;
const concrete=(s:any)=>realProductName(s)&&!/제품군|완제품|협의 가능한|공식몰|쇼핑몰|라이프 솔루션|^SHOP$|가을맞이|Big 세일|브랜드 페스타/i.test(String(s||''));

export const normalizeBrandProductName=(s:any)=>String(s||"").replace(/\[[^\]]*\]|★[^★]*★|[★☆]/g,"").replace(/단독구매상품[\s\S]*$|상품옵션[\s\S]*$/g,"").replace(/\s+/g," ").trim();
function productExcerpt(product:any,page:any){
 const name=String(product.name||''),text=String(page.excerpt||''),start=text.indexOf(name);if(start<0||!name)return '';
 let end=Math.min(text.length,start+name.length+240);
 for(const other of page.products||[]){if(other.name===name||!other.name)continue;const next=text.indexOf(String(other.name),start+name.length);if(next>=0)end=Math.min(end,next);}
 // Stop before navigation, related products and company copy, even on a product page.
 return text.slice(start+name.length,end).split(/관련\s*상품|추천\s*상품|함께\s*(?:본|구매)|고객센터|회사\s*소개|브랜드\s*소개|이용약관|개인정보|\b(?:related products|you may also like|about us|customer service|privacy policy)\b/i)[0];
}
const nonFoodType=(type:string,name:string)=>nonFood.test(type)||productAccessory(type,name)||medicalOrIndustrial.test(type)||sleepType.test(type)||fitnessType.test(type)||careType.test(type)||/에센셜\s*오일|\bessential oil\b/i.test(type);
export function productFoodEvidence(product:any,page:any){
 const name=String(product.name||''),type=[name,product.category,product.description].filter(Boolean).join(' '),excerpt=productExcerpt(product,page);if(nonFoodType(type,name)||pouch.test(type)&&storagePouch.test(excerpt))return false;
 if(foodEvidence.test(type)||pouch.test(name)&&pouchFood.test(name))return true;
 // Catalog names can be brand-specific (e.g. Limone). Only use the text immediately
 // attached to this exact SKU, bounded before the next named product, never sitewide copy.
 return !nonFoodType(excerpt,name)&&foodEvidence.test(excerpt);
}

// Relevance is evidence about this SKU, not a site's sector or a legal/health claim.
// Non-food requires a concrete consumer-product type AND a separately stated use/category.
export function productWellnessCategory(product:any,page:any):WellnessCategory|null{
 const name=String(product.name||''),details=[product.category,product.description].filter(Boolean).join(' ');
 const excerpt=productExcerpt(product,page),own=[name,details].join(' '),text=[own,excerpt].join(' ');
 if(!concrete(name)||productAccessory(own,name)||pouch.test(own)&&storagePouch.test(excerpt)||medicalOrIndustrial.test(text)||medicalClaim.test(text))return null;
 if(productFoodEvidence(product,page))return 'food';
 // Catalog snippets can mix multiple SKUs. Only detail-page snippets or structured
 // product fields establish the non-food purpose; page titles/descriptions never do.
 const purpose=[details,productDetailUrl(page.url)?excerpt:''].filter(Boolean).join(' ');
 const type=own+' '+purpose;
 if(sleepType.test(type)&&sleepPurpose.test(purpose))return 'sleep_rest';
 if(fitnessType.test(type)&&fitnessPurpose.test(purpose))return 'fitness_recovery';
 if(careType.test(type)&&carePurpose.test(purpose))return 'personal_care';
 return null;
}
export const productWellnessEvidence=(product:any,page:any)=>!!productWellnessCategory(product,page);

export function officialBrandPages(lead:any,at=Date.now()){
 const d=lead?.data||lead||{},trusted=officialOrigins(d);
 return (d.publicEvidence||[]).filter((p:any)=>trusted.has(host(p.url))&&current(p.checked,at)&&!editorialSource(p.url,d.publicEvidence||[]));
}

// Both research selection and qualification use the same provenance/currentness gate.
export function verifiedWellnessProducts(lead:any,at=Date.now()){
 const d=lead?.data||lead||{},trusted=officialOrigins(d),found:any[]=[];
 for(const page of officialBrandPages(d,at)){
  const candidates=[...(page.products||[])];
  if(productDetailUrl(page.url)){
   for(const m of String(page.excerpt||'').matchAll(/상품명\s*:\s*(.{3,140}?)(?=상품요약정보|소비자가|판매가|상품명|타임세일|$)/g))candidates.push({name:normalizeBrandProductName(m[1]),url:page.url,evidenceType:'product_detail_label'});
   // An exact title plus buying details is a fallback, never a catalog-wide name match.
   candidates.push({name:normalizeBrandProductName(String(page.title||'').split(/\s+-\s+|\s*[|｜]\s*/)[0]),url:page.url,evidenceType:'official_product_detail'});
  }
  for(const product of candidates){
   const name=normalizeBrandProductName(product.name),url=product.url||page.url;
   // A less descriptive duplicate/title fallback must not bypass conflicting SKU data.
   const matching=candidates.filter(p=>normalizeBrandProductName(p.name)===name);
   const bound={...product,description:matching.map(p=>p.description).filter(Boolean).join(' '),category:matching.map(p=>p.category).filter(Boolean).join(' ')};
   const category=productWellnessCategory(bound,page);
   if(!category||!concrete(name)||!trusted.has(host(url))||!productDetailUrl(url))continue;
   const detail=productDetailUrl(page.url)&&url===page.url;
   const selling=/판매가|소비자가|장바구니|구매하기|add to cart|buy now|price/i.test([page.title,page.excerpt].join(' '));
   const provenance=product.evidenceType==='structured_product'&&product.hasOffers===true||product.evidenceType==='product_detail_label'&&detail||product.evidenceType==='official_product_detail'&&detail&&selling;
   if(provenance&&!found.some(p=>p.name===name&&p.url===url))found.push({name,url,source:page.url,checked:page.checked,type:product.evidenceType,category,quote:product.quote||product.name});
  }
 }
 return found;
}

// A mailbox is necessary, not proof that its owner sells a relevant consumer product.
// No legal classification, distribution licence, consent or supplier terms are inferred here.
export function assessBrandQualification(lead:any,failures:string[]=[],at=Date.now()){
 const d=lead?.data||lead||{},o=d.outreach||{},review=assessMailLead(d,failures),reasons=[...review.reasons];
 const pages=officialBrandPages(d,at);
 if(!review.contacts.length||review.contacts.some((c:any)=>!current(c.checked,at)||!pages.some((p:any)=>p.url===c.source)))reasons.push('현재 공식 페이지의 연락처 게시 근거 재확인 필요');
 const home=pages.filter((p:any)=>host(p.url)===host(d.website));
 const identity=[d.name,o.brandName,...home.map((p:any)=>p.title)].join(' ');
 if(/협회|학회|연구원|진흥원|기업가정신|인터넷신문|언론사|뉴스미디어|\b(?:association|society|newsroom|newspaper)\b/i.test(identity)||editorialSource(d.website,d.publicEvidence||[]))reasons.push('협회·기관·언론사는 상품 제안 대상이 아닙니다.');
 if(lead?.status==='blocked'||d.duplicateNote)reasons.push('중복 또는 차단된 업체');
 const productName=String(o.productName||''),productKey=companyIdentity(normalizeBrandProductName(productName));
 const evidence=concrete(productName)&&o.productSourceType!=='marketplace_search_index'?verifiedWellnessProducts(d,at).find(p=>companyIdentity(p.name)===productKey)||null:null;
 if(!evidence)reasons.push('공식 브랜드·유통사 사이트의 실제 웰니스 관련 상품·판매 근거 확인 필요');
 if(o.draftMode!=='product'||o.researchStatus!=='completed'||o.needsPersonalization||o.sendBlockedReason)reasons.push('상품별 제안 조사·초안 완료 전');
 if(d.research?.ownership!=='source_supported')reasons.push('브랜드·유통사와 연락처의 게시 관계 추가 확인 필요');
 const unique=[...new Set(reasons)],eligible=unique.length===0;
 return {revision:brandQualificationRevision,eligible,reasons:unique,checked:new Date(at).toISOString(),product:evidence,category:evidence?categoryLabels[evidence.category as WellnessCategory]+' (법적 분류 별도 확인)':'미확인',businessType:evidence&&/유통|수입|총판|distribut|import/i.test(pages.map((p:any)=>[p.title,p.description,p.excerpt].join(' ')).join(' '))?'brand_or_distributor':'brand',contactCount:review.contacts.length};
}

export function recordBrandQualification(lead:any,failures:string[]=[],at=Date.now()){
 const d=lead?.data||lead||{},review=assessBrandQualification(lead,failures,at);
 const firstQualifiedAt=d.qualification?.firstQualifiedAt||(review.eligible?new Date(at).toISOString():null);
 return {...review,firstQualifiedAt,qualifiedDay:firstQualifiedAt?new Date(firstQualifiedAt).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}):null};
}
