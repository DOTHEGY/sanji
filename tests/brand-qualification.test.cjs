const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('node:fs');
function load(path){const m={exports:{}};new Function('module','exports','require',esbuild.buildSync({entryPoints:[path],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(m,m.exports,require);return m.exports;}
const {assessBrandQualification,recordBrandQualification,productFoodEvidence,productWellnessEvidence,verifiedWellnessProducts}=load('supabase/functions/_shared/brand-qualification.ts');
const {planAutomaticBrand}=load('supabase/functions/_shared/brand-auto-plan.ts');
const {researchBrand}=load('supabase/functions/_shared/brand-research.ts');
const now=new Date(),iso=now.toISOString(),product='라부치리아 리모네 250ml',url='https://store.test/product/detail.html?product_no=24';
const template={id:'t',version:1,data:{purpose:'brand_proposal',channel:'이메일',subject:'제안',body:'안녕하세요 {{브랜드명}} 담당자님.\n{{개인화}}',signature:'서명'}};
function positive(){return {id:'eatsn-fixture',status:'review',data:{name:'잇츠앤 EATSN',website:'https://brand.test/',firstEmailAt:iso,officialVerified:false,classification:'미확인',contacts:[{email:'info@brand.test',source:'https://store.test/about',checked:iso,context:'대표 이메일 info@brand.test',purpose:'대표·일반 문의'}],sourceAttempts:[{status:'checked',url:'https://store.test/',linkedFrom:'https://brand.test/'}],publicEvidence:[{url:'https://brand.test/',checked:iso,title:'잇츠앤 EATSN 올리브오일 수입·유통',description:'올리브오일 전문',excerpt:'식품 유통',products:[{name:product,url,evidenceType:'structured_product',hasOffers:true,description:'시칠리아 올리브오일에 천연 레몬 향을 더한 식용 오일'}]},{url:'https://store.test/about',checked:iso,title:'잇츠앤 EATSN 공식몰',description:'식품 유통',excerpt:'대표 이메일 info@brand.test'}],research:{ownership:'source_supported'},outreach:{brandName:'잇츠앤 EATSN',productName:product,draftMode:'product',productSourceType:'official',researchStatus:'completed',intro:'상품 구성 확인',evidence:[{url,checked:iso}],needsPersonalization:false}}};}
function plan(l){return planAutomaticBrand({lead:l,template,enabledSince:new Date(now-1000).toISOString(),now});}
test('official product catalog and linked distributor contact pass without trusting legacy boolean flags',()=>{const l=positive(),q=assessBrandQualification(l);assert.equal(q.eligible,true);assert.equal(q.businessType,'brand_or_distributor');assert.equal(plan(l).eligible,true);assert.equal(q.product.source,'https://brand.test/');});
test('association and media may have published contacts but never auto qualify',()=>{for(const name of ['글로벌기업가정신협회','건강뉴스미디어']){const l=positive();l.data.name=name;l.data.outreach.brandName=name;l.data.publicEvidence=l.data.publicEvidence.map(p=>({...p,title:name+' 공식 홈페이지'}));assert.equal(assessBrandQualification(l).eligible,false);assert.equal(plan(l).eligible,false);}const l=positive();l.data.website='https://healthumer.com/';assert.equal(plan(l).eligible,false);});
test('email-only and generic pending copy cannot qualify or reserve',()=>{const l=positive();l.data.publicEvidence[0].products=[];l.data.outreach={...l.data.outreach,productName:'공동구매 협의 가능한 상품',draftMode:'brand_first',researchStatus:'pending'};l.data.research={ownership:'source_supported',reason:'공식 페이지의 브랜드·상품·이메일 게시 출처 대조 완료'};assert.equal(plan(l).eligible,false);assert.equal(assessBrandQualification(l).eligible,false);});
test('arbitrary evidence URLs, stale pages, non-food products and retailer-only evidence fail closed',()=>{for(const mutate of [l=>{l.data.publicEvidence[0].products=[];},l=>{l.data.publicEvidence[0].checked='2020-01-01';},l=>{l.data.publicEvidence[0].products[0].url='https://thirdparty.test/product/detail.html?product_no=24';},l=>{l.data.outreach.productName=l.data.publicEvidence[0].products[0].name='비타민 세럼 250ml';},l=>{l.data.outreach.productSourceType='marketplace_search_index';},l=>{l.data.research.ownership='research_pending';}]){const l=positive();mutate(l);assert.equal(plan(l).eligible,false);}});
test('explicit partnership contact is preferred without inventing or expanding recipients',()=>{const l=positive();l.data.contacts.push({...l.data.contacts[0],email:'partner@brand.test',purpose:'사업 제휴',context:'제휴 문의 partner@brand.test'});l.data.publicEvidence[1].excerpt+=' 제휴 문의 partner@brand.test';const p=plan(l);assert.equal(p.eligible,true);assert.deepEqual(p.emails,['partner@brand.test','info@brand.test']);});
test('qualification date is additive and stable; raw historical metrics are not rewritten',()=>{const l=positive();const q=recordBrandQualification(l,[],now.getTime());assert.equal(q.eligible,true);l.data.qualification=q;assert.equal(recordBrandQualification(l,[],now.getTime()+1000).firstQualifiedAt,q.firstQualifiedAt);l.data.outreach.researchStatus='pending';assert.equal(recordBrandQualification(l).eligible,false);assert.equal(q.revision,1);});
test('imweb explicit product ID is accepted and generic product lists are not',()=>{const l=positive();l.data.publicEvidence[0].products[0]={name:'요헤미티 단백질 쉐이크 데일리 7회분',url:'https://brand.test/product/?idx=98',evidenceType:'structured_product',hasOffers:true};l.data.outreach={brandName:l.data.name,draftMode:'brand_first',researchStatus:'pending',productName:'공동구매 협의 가능한 상품'};const result=researchBrand(l.data,template);assert.equal(result.outreach.draftMode,'product');assert.equal(result.outreach.productName,'요헤미티 단백질 쉐이크 데일리 7회분');assert.equal(assessBrandQualification({...l,data:{...l.data,...result}}).eligible,true);const {productDetailUrl}=load('supabase/functions/_shared/mail-integrity.ts');assert.equal(productDetailUrl('https://brand.test/product/?idx=list'),false);assert.equal(productDetailUrl('https://brand.test/product/list.html?idx=98'),false);});

test('mixed food catalogs do not turn accessories or coffee equipment into food products',()=>{for(const name of ['스테인리스 텀블러 500ml','라부치리아 머그컵 250ml','프리미엄 커피머신 1대','Coffee grinder 250g','정체 미확인 제품 250ml']){const l=positive();l.data.outreach.productName=name;l.data.publicEvidence[0].products=[{name,url,evidenceType:'structured_product',hasOffers:true}];assert.equal(assessBrandQualification(l).eligible,false,name);}});
test('structured product-specific food evidence supports Shopify and Makeshop detail URLs',()=>{for(const productUrl of ['https://store.test/products/olive-oil','https://store.test/shop/shopdetail.html?branduid=123']){const l=positive();l.data.outreach.productName='엑스트라버진 올리브오일 500ml';l.data.publicEvidence[0].products=[{name:l.data.outreach.productName,url:productUrl,evidenceType:'structured_product',hasOffers:true}];assert.equal(assessBrandQualification(l).eligible,true);const r=researchBrand(l.data,template);assert.equal(r.outreach.draftMode,'product');}});

test('research selects a verified food SKU instead of the first accessory in a mixed catalog',()=>{const l=positive();l.data.outreach={brandName:l.data.name,draftMode:'brand_first',researchStatus:'pending',productName:'공동구매 협의 가능한 상품'};l.data.publicEvidence[0].products=[{name:'스테인리스 텀블러 500ml',url:'https://store.test/products/tumbler',evidenceType:'structured_product',hasOffers:true},{name:'[신상품] 엑스트라버진 올리브오일 500ml',url:'https://store.test/products/olive-oil',evidenceType:'structured_product',hasOffers:true}];const r=researchBrand(l.data,template);assert.equal(r.outreach.productName,'엑스트라버진 올리브오일 500ml');assert.equal(assessBrandQualification({...l,data:{...l.data,...r}}).eligible,true);});

test('completed legacy accessory copy is replaced rather than preserved over a newly verified food SKU',()=>{const l=positive();l.data.outreach={...l.data.outreach,productName:'스테인리스 텀블러 500ml',intro:'텀블러 제안'};const r=researchBrand(l.data,template);assert.equal(r.outreach.productName,product);assert.equal(assessBrandQualification({...l,data:{...l.data,...r}}).eligible,true);});

function wellness(sku={name:'루나 차광 안대 1개',category:'수면용품',description:'취침 시 빛을 가리는 일상 수면용 안대'},business='brand'){
 const l=positive();l.data.name=l.data.outreach.brandName='루나 라이프';
 Object.assign(l.data.publicEvidence[0],{title:'루나 라이프 공식 홈페이지',description:business==='distributor'?'루나 라이프 생활용품 수입·유통':'루나 라이프 상품 안내',excerpt:'제품 안내',products:[{...sku,url,evidenceType:'structured_product',hasOffers:true}]});
 Object.assign(l.data.publicEvidence[1],{title:'루나 라이프 공식몰',description:'루나 라이프 고객센터'});
 l.data.outreach.productName=sku.name;return l;
}
const wellnessCases=[
 ['sleep_rest',{name:'루나 차광 안대 1개',category:'수면용품',description:'취침 시 빛을 가리는 일상 수면용 안대'}],
 ['sleep_rest',{name:'클라우드 02',category:'베개',description:'잠자리에서 사용하는 수면용 베개'}],
 ['fitness_recovery',{name:'루나 요가 매트 6mm',category:'홈트 운동용품',description:'요가와 스트레칭에 사용하는 매트'}],
 ['fitness_recovery',{name:'데일리 폼롤러 45cm',category:'운동용품',description:'운동 후 스트레칭에 사용하는 폼롤러'}],
 ['fitness_recovery',{name:'Resistance band set 3pc',category:'Fitness',description:'Resistance bands for everyday exercise'}],
 ['personal_care',{name:'데일리 비타민 세럼 30ml',category:'스킨케어',description:'일상 피부 보습용 세럼'}],
 ['personal_care',{name:'마일드 샴푸 300ml',category:'헤어케어',description:'두피 세정을 위한 샴푸'}],
 ['personal_care',{name:'Soft toothbrush 2pc',category:'Oral hygiene',description:'Toothbrush for daily oral care'}],
];
test('verified product-specific sleep, fitness and personal-care SKUs qualify for brands and distributors',()=>{
 for(const [category,sku] of wellnessCases)for(const business of ['brand','distributor']){
  const l=wellness(sku,business),q=assessBrandQualification(l);
  assert.equal(q.eligible,true,sku.name);assert.equal(q.product.category,category);assert.equal(q.businessType,business==='distributor'?'brand_or_distributor':'brand');
  assert.match(q.category,/법적 분류 별도 확인/);assert.equal(l.data.classification,'미확인');assert.equal(l.data.officialVerified,false);
  assert.equal(productFoodEvidence(sku,l.data.publicEvidence[0]),false,sku.name+' is not food');assert.equal(plan(l).eligible,true);
 }
});
test('research uses the same verified wellness SKU selection and writes no medical-benefit copy',()=>{
 for(const [category,sku] of wellnessCases){
  const l=wellness(sku);l.data.outreach={brandName:l.data.name,draftMode:'brand_first',researchStatus:'pending',productName:'공동구매 협의 가능한 상품'};
  const r=researchBrand(l.data,template);assert.equal(r.outreach.productName,sku.name);assert.equal(r.outreach.researchStatus,'completed');assert.equal(r.research.ownership,'source_supported');
  assert.equal(assessBrandQualification({...l,data:{...l.data,...r}}).eligible,true,sku.name);assert.doesNotMatch(r.outreach.intro,/치료|예방|효능|효과|개선|완치|섭취|실제 요리|푸드/);
  assert.match(r.outreach.intro,category==='sleep_rest'?/잠자리 준비/:category==='fitness_recovery'?/일상 운동/:/셀프케어/);
 }
});
test('generic wellness copy, product names alone and unrelated accessories do not qualify',()=>{
 const bad=[
  {name:'루나 라이프 01',category:'웰니스',description:'건강한 라이프스타일을 위한 상품'},
  {name:'루나 차광 안대 1개'},
  {name:'비타민 세럼 30ml',category:'화장품',description:'웰니스 브랜드의 상품'},
  {name:'루나 스테인리스 텀블러 500ml',category:'운동용품',description:'운동 전후 사용하는 텀블러'},
  {name:'수면 안대 파우치',category:'수면용품',description:'안대를 보관하는 파우치'},
  {name:'Premium coffee grinder',category:'wellness',description:'Coffee preparation accessory'},
  {name:'루나 라이프 02',category:'웰니스',description:'비타민 함유 세럼'},
 ];
 for(const sku of bad){const l=wellness(sku);l.data.publicEvidence[0].title+=' 수면 운동 스킨케어 식품';l.data.publicEvidence[0].description+=' 건강과 웰니스, 수면 및 피부 보습';l.data.publicEvidence[0].excerpt=sku.name+' 웰니스 제품 안내. 회사 소개 수면용품 피부 보습 요가 매트';assert.equal(assessBrandQualification(l).eligible,false,sku.name);assert.equal(plan(l).eligible,false);assert.equal(productWellnessEvidence(sku,l.data.publicEvidence[0]),false,sku.name);}
});
test('medical or industrial equipment and product medical claims never qualify as wellness',()=>{
 for(const sku of [
  {name:'의료용 수면 마스크',category:'수면용품',description:'수면 시 사용하는 의료기기'},
  {name:'CPAP sleep mask 01',category:'Sleep',description:'Sleep mask'},
  {name:'산업용 폼롤러 45cm',category:'운동용품',description:'산업용 롤러'},
  {name:'자동차용 비타민 윤활유 250ml',category:'생활용품',description:'웰니스 브랜드 차량용 윤활유'},
  {name:'Olive engine oil 500ml',category:'Automotive',description:'Premium motor lubricant'},
  {name:'산업용 올리브오일 1L',category:'기계용 윤활제',description:'산업용 오일'},
  {name:'데일리 폼롤러 45cm',category:'운동용품',description:'운동 후 통증 치료에 사용하는 폼롤러'},
  {name:'루나 수면 안대 1개',category:'수면용품',description:'불면증 치료 및 예방'},
  {name:'Soft serum 30ml',category:'Skin care',description:'Treats skin disease and reduces inflammation'},
  {name:'비타민 캡슐 30정',category:'영양제',description:'암 예방과 혈압 치료'},
 ]){const l=wellness(sku);assert.equal(assessBrandQualification(l).eligible,false,sku.name);assert.equal(researchBrand(l.data,template).outreach.researchStatus,'pending',sku.name);}
});
test('wellness expansion keeps current official SKU, contact, ownership and completed research gates',()=>{
 for(const mutate of [
  l=>{l.data.publicEvidence[0].checked='2020-01-01';},
  l=>{l.data.publicEvidence[0].checked=new Date(Date.now()+86400000).toISOString();},
  l=>{l.data.publicEvidence[0].products[0].hasOffers=false;},
  l=>{l.data.publicEvidence[0].products[0].evidenceType='catalog_link';},
  l=>{l.data.publicEvidence[0].products[0].url='https://thirdparty.test/products/sleep-mask';},
  l=>{l.data.sourceAttempts=[];},
  l=>{l.data.contacts=[];},
  l=>{l.data.contacts[0].checked='2020-01-01';},
  l=>{l.data.publicEvidence[1].checked='2020-01-01';},
  l=>{l.data.contacts[0].source='https://unrelated.test/contact';},
  l=>{l.data.research.ownership='research_pending';},
  l=>{l.data.outreach.researchStatus='pending';},
  l=>{l.data.outreach.productSourceType='marketplace_search_index';},
 ]){const l=wellness();mutate(l);assert.equal(assessBrandQualification(l).eligible,false,mutate.toString());assert.equal(plan(l).eligible,false,mutate.toString());}
 const unfinished=wellness();unfinished.data.outreach.needsPersonalization=true;assert.equal(assessBrandQualification(unfinished).eligible,false);
 for(const name of ['글로벌기업가정신협회 EPSA','건강뉴스미디어']){const l=wellness();l.data.name=l.data.outreach.brandName=name;l.data.publicEvidence[0].title=name;assert.equal(plan(l).eligible,false);}
 const media=wellness();media.data.website='https://healthumer.com/';assert.equal(plan(media).eligible,false);
});
test('research skips stale, untrusted or offerless candidates before selecting a valid wellness SKU',()=>{
 const l=wellness(),valid=l.data.publicEvidence[0].products[0];
 l.data.publicEvidence.unshift({...l.data.publicEvidence[0],checked:'2020-01-01',products:[{...valid,name:'오래된 수면 안대'}]},
  {...l.data.publicEvidence[0],url:'https://unrelated.test/',products:[{...valid,name:'외부 수면 안대',url:'https://unrelated.test/products/mask'}]});
 l.data.publicEvidence[2].products.unshift({...valid,name:'판매 미확인 수면 안대',hasOffers:false},{...valid,name:'제삼자 수면 안대',url:'https://other.test/products/mask'});
 l.data.outreach={brandName:l.data.name,draftMode:'brand_first',researchStatus:'pending'};
 const r=researchBrand(l.data,template);assert.equal(r.outreach.productName,valid.name);assert.equal(assessBrandQualification({...l,data:{...l.data,...r}}).eligible,true);
});
test('exact product detail context can verify wellness purpose without borrowing another SKU or footer text',()=>{
 const l=wellness(),sku=l.data.publicEvidence[0].products[0];
 l.data.publicEvidence[0].products=[];l.data.publicEvidence.push({url,checked:iso,title:sku.name+' - 루나 라이프',excerpt:'상품명 : '+sku.name+' 판매가 19000원 취침 시 사용하는 수면용 차광 안대',products:[{name:sku.name,url,evidenceType:'product_detail_label'}]});
 assert.equal(assessBrandQualification(l).eligible,true);assert.equal(researchBrand(l.data,template).outreach.productName,sku.name);
 l.data.publicEvidence[2].excerpt='상품명 : '+sku.name+' 판매가 19000원 회사 소개 수면·운동·보습 웰니스 기업';assert.equal(assessBrandQualification(l).eligible,false);
 l.data.publicEvidence[2].excerpt=sku.name+' 판매가 19000원 다음상품 베개 01 수면용 베개';l.data.publicEvidence[2].products.push({name:'다음상품 베개 01',url:'https://store.test/products/pillow',category:'수면용품',evidenceType:'catalog_link'});assert.equal(assessBrandQualification(l).eligible,false);
});
test('title and label fallbacks cannot bypass an explicitly medical product description',()=>{
 const l=wellness(),sku=l.data.publicEvidence[0].products[0];l.data.publicEvidence[0].products=[];
 l.data.publicEvidence.push({url,checked:iso,title:sku.name,excerpt:'상품명 : '+sku.name+' 판매가 19000원 취침 시 사용하는 차광 안대',products:[{...sku,description:'불면증을 치료하는 수면 안대'}]});
 assert.equal(verifiedWellnessProducts(l).length,0);assert.equal(assessBrandQualification(l).eligible,false);
 l.data.publicEvidence[2].products[0].url+='&variant=1';assert.equal(verifiedWellnessProducts(l).length,0,'canonical URL fallback must retain matching SKU warnings');
});
test('generic structured category does not hide an exact SKU detail sleep purpose',()=>{
 const sku={name:'모달 베개',category:'생활용품'},l=wellness(sku);l.data.publicEvidence[0].products=[];
 l.data.publicEvidence.push({url,checked:iso,title:'모달 베개 - 루나 라이프',excerpt:'상품명 : 모달 베개 판매가 29000원 취침과 수면을 위한 베개',products:[{...sku,url,evidenceType:'structured_product',hasOffers:true}]});
 assert.equal(assessBrandQualification(l).eligible,true);assert.equal(verifiedWellnessProducts(l)[0].category,'sleep_rest');
 l.data.publicEvidence[2].excerpt='모달 베개 판매가 29000원 회사 소개 수면 및 웰니스 기업';assert.equal(assessBrandQualification(l).eligible,false);
});
test('marketplace-only wellness evidence can create a review draft but never completed official research',()=>{
 const l=wellness(),sku=l.data.publicEvidence[0].products[0];l.data.publicEvidence[0].products=[];l.data.marketProductEvidence=[{...sku,url:'https://www.coupang.com/vp/products/123',checked:iso,sourceType:'marketplace_product_page',uncertainty:'판매자 권한·공급 여부 미확인'}];
 const r=researchBrand(l.data,template);assert.equal(r.outreach.draftMode,'product');assert.equal(r.outreach.researchStatus,'pending');assert.equal(r.research.ownership,'source_supported');assert.equal(assessBrandQualification({...l,data:{...l.data,...r}}).eligible,false);assert.match(r.research.reason,/공식 상품·공급 관계 추가 확인/);
});
test('one current contact cannot make a second stale-source recipient eligible',()=>{
 const l=wellness();l.data.contacts.push({...l.data.contacts[0],email:'partner@brand.test',source:'https://store.test/old-contact',context:'사업 제휴 partner@brand.test'});
 l.data.publicEvidence.push({url:'https://store.test/old-contact',checked:'2020-01-01',title:'루나 라이프',excerpt:'사업 제휴 partner@brand.test'});
 assert.equal(assessBrandQualification(l).eligible,false);assert.equal(plan(l).eligible,false);
});
test('food pouches remain edible SKUs while food-named storage pouches remain accessories',()=>{
 for(const name of ['브랜드 단백질 쉐이크 파우치 5종','데일리 프로틴 파우치 30g','사과즙 파우치 100ml','과일 젤리 파우치 5종','Protein shake pouch 30g','Apple juice pouches 6pc']){
  const l=positive();l.data.outreach.productName=name;l.data.publicEvidence[0].products=[{name,url,evidenceType:'structured_product',hasOffers:true}];
  assert.equal(productFoodEvidence(l.data.publicEvidence[0].products[0],l.data.publicEvidence[0]),true,name);
  assert.equal(assessBrandQualification(l).eligible,true,name);assert.equal(plan(l).eligible,true,name);
  l.data.outreach={brandName:l.data.name,draftMode:'brand_first',researchStatus:'pending'};const r=researchBrand(l.data,template);
  assert.equal(r.outreach.productName,name);assert.equal(r.outreach.researchStatus,'completed');
 }
 for(const sku of [{name:'단백질 쉐이크 보관 파우치'},{name:'프로틴 휴대용 파우치'},{name:'Protein shake storage pouch'},{name:'Empty juice pouch 10pc'},{name:'Reusable jelly pouches'},{name:'데일리 파우치',category:'식품',description:'프로틴 쉐이크 브랜드의 상품'},{name:'단백질 쉐이크 파우치 5종',description:'쉐이크를 담는 보관용 파우치'},{name:'단백질 쉐이크 텀블러'},{name:'Protein shake mug'}]){
  const l=positive();l.data.outreach.productName=sku.name;l.data.publicEvidence[0].products=[{...sku,url,evidenceType:'structured_product',hasOffers:true}];
  assert.equal(productFoodEvidence(l.data.publicEvidence[0].products[0],l.data.publicEvidence[0]),false,sku.name);
  assert.equal(assessBrandQualification(l).eligible,false,sku.name);assert.equal(plan(l).eligible,false,sku.name);
 }
});
