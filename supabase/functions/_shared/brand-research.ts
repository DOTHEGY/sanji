import { companyIdentity } from "./discovery.ts";
import { leadOutreach } from "./mail-template.ts";
const unsafe=/치료|예방|항암|완치|혈당|혈압|면역력|체지방|다이어트|키성장|키 성장|통증|개선|효능|효과|질병|성기능|발기/;
const clean=(s:any)=>String(s||"").replace(/\[[^\]]*\]|★[^★]*★|[★☆]/g,"").replace(/단독구매상품[\s\S]*$|상품옵션[\s\S]*$/g,"").replace(/\s+/g," ").trim();
export function researchBrand(lead:any,template:any,checked=new Date().toISOString()){
 const pages=(lead.publicEvidence||[]).filter((p:any)=>p.url&&p.checked),old=lead.outreach||{};
 const home=pages.find((p:any)=>{try{return new URL(p.url).origin===new URL(lead.website).origin;}catch{return false;}});
 const pageText=pages.map((p:any)=>[p.title,p.description,p.excerpt].join(" ")).join(" ");
 const food=/건강기능식품|건강식품|견과|유산균|비타민|단백질|올리브|우유|유제품|선식|홍삼|오메가|콜라겐|효소|커피|차류|오트밀/.test(pageText);
 const device=/저주파|의료기기|안마기|마사지기|전기자극/.test(pageText)&&!/건강기능식품|유산균|비타민|견과/.test(pageText);
 const candidates:any[]=[];
 for(const p of pages){
  for(const product of p.products||[])candidates.push({name:clean(product.name),quote:product.quote||product.name,url:p.url});
  for(const m of String(p.excerpt||"").matchAll(/상품명\s*:\s*(.{3,140}?)(?=상품요약정보|소비자가|판매가|상품명|타임세일|$)/g))candidates.push({name:clean(m[1]),quote:m[0],url:p.url});
  if(/\/product\/(?:detail|[^/]+)|[?&](?:product_no|goodsNo)=/i.test(p.url))candidates.push({name:clean(String(p.title||"").split(/\s+-\s+/)[0]),quote:p.title,url:p.url});
 }
 let product=candidates.find(p=>p.name.length>=4&&p.name.length<=95&&!unsafe.test(p.name)&&!/(로그인|쿠폰|배송비|판매가)/.test(p.name));
 if(!product){for(const p of pages){const text=[p.title,p.description,p.excerpt].join(" ");const group=["락토핏","아임비타","프로메가","아이클리어","올리브오일","단백질 쉐이크","유산균","프로폴리스","마누카꿀","스피루리나","초유","비타민","오메가3","견과","멸균우유","유제품","홍삼","콜라겐","효소","오트밀","디카페인 커피"].find(k=>text.includes(k));if(group){product={name:group+" 제품군",quote:text.slice(Math.max(0,text.indexOf(group)-30),text.indexOf(group)+90),url:p.url};break;}}}
 const oldName=String(lead.name||"");let brand=(lead.research?.method==="official_page_evidence"?oldName:old.brandName)||oldName;
 if(old.needsPersonalization&&home?.title&&/공식.*(?:몰|쇼핑몰)/.test(home.title)&&!old.sendBlockedReason&&!companyIdentity(home.title+" "+home.description).includes(companyIdentity(brand)))brand=clean(home.title.split(/\s+-\s+|\s*[|｜]\s*/)[0]).replace(/\s*공식.*$/,"");
 if(/새\s*창\s*열림|›|https?:|\.(?:co\.kr|com)\b/.test(brand)&&home?.title)brand=clean(home.title.split(/\s+-\s+|\s*[|｜]\s*/)[0]).replace(/\s*공식.*$/,"");
 const identity=companyIdentity(brand).replace(/(?:건강식품|공식몰|건강몰)$/, ""),sameName=!!identity&&!!home&&companyIdentity([home.title,home.description,home.excerpt].join(" ")).includes(identity);
 const contactEvidence=(lead.contacts||[]).map((c:any)=>{
  const p=pages.find((p:any)=>p.url===c.source);
  // A link to another legal entity alone is insufficient. Require the target brand on the actual email source.
  const sameOrigin=!!p&&!!home&&new URL(p.url).origin===new URL(home.url).origin;
  const sameSource=!!p&&(companyIdentity([p.title,p.description].join(" ")).includes(identity)||(sameOrigin&&String(p.excerpt||"").toLowerCase().includes(String(c.email||"").toLowerCase())));
  return {email:c.email,source:c.source,supported:sameName&&sameSource&&!device&&food,checked};
 });
 const ownershipSupported=contactEvidence.length>0&&contactEvidence.every((c:any)=>c.supported);
 const research:any={checked,method:"official_page_evidence",ownership:ownershipSupported?"source_supported":"research_pending",contactEvidence,product:product?.name||"",productSource:product?.url||"",reason:device?"확인된 사이트는 식품이 아닌 기기 업체입니다. 동명 식품 브랜드를 자동 재검색합니다.":!food?"공식 페이지에서 식품 상품 근거를 찾지 못했습니다.":!product?"공식 페이지에서 특정 상품명을 추가 확인 중입니다.":!ownershipSupported?"제안 브랜드와 이메일이 게시된 회사의 연결 근거를 추가 조사 중입니다.":"공식 페이지의 브랜드·상품·이메일 게시 출처 대조 완료"};
 if(old.intro&&!old.needsPersonalization&&!old.sendBlockedReason){
 const kept={...old};if(old.personalizationRevision===3&&old.brandName&&old.brandName!==brand){for(const k of ["subject","body","signature"])if(typeof kept[k]==="string")kept[k]=kept[k].split(old.brandName).join(brand);kept.brandName=brand;kept.companyName=brand;}
 return {research,outreach:kept};
 }
 if(!product||!food||device)return {research,outreach:{...(template?leadOutreach(template,lead,checked):old),needsPersonalization:!old.intro,researchStatus:"pending",researchReason:research.reason}};
 let idea="상품 구성과 사용 방법을 직접 보여주는 푸드·라이프스타일 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 if(/견과|넛츠|넛트/.test(product.name))idea="베이킹 크리에이터가 실제 레시피에서 견과를 활용하고, 구성별 차이를 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(/단백질|쉐이크|프로틴/.test(product.name))idea="운동·웰니스 크리에이터가 실제 조리·섭취 준비 과정과 제품별 구성을 보여주는 콘텐츠로 공동구매를 제안드리고 싶습니다.";
 else if(/오일|올리브/.test(product.name))idea="푸드 크리에이터의 실제 요리에서 활용 장면과 제품 구성을 함께 보여주는 방식으로 공동구매를 제안드리고 싶습니다.";
 else if(/커피|디카페인/.test(product.name))idea="라이프스타일 크리에이터가 직접 커피를 준비하는 일상 콘텐츠에 제품 구성과 활용 장면을 담는 공동구매를 제안드리고 싶습니다.";
 const intro="공식몰에서 ‘"+product.name+"’"+(product.name.endsWith("제품군")?"을 확인했습니다.":"의 상품 구성을 확인했습니다.")+"\n"+idea;
 const updated={...lead,name:brand,outreach:{...old,brandName:brand,companyName:brand,productName:product.name,intro,evidence:[{url:product.url,description:"공식 상품명·구성",quote:product.quote,checked}],personalizationRevision:3,personalizationUpdated:checked,personalizationMethod:"공개 근거 기반 자동 작성",needsPersonalization:false,researchStatus:ownershipSupported?"completed":"pending",researchReason:research.reason}};
 const outreach=template?leadOutreach(template,updated,checked):updated.outreach;
 return {research,outreach};
}
