const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sanji-product-search-'));esbuild.buildSync({entryPoints:['supabase/functions/_shared/product-search.ts'],bundle:true,platform:'node',format:'cjs',outfile:dir+'/product.cjs'});const {marketProductLinks,searchProduct}=require(dir+'/product.cjs');
test('marketplace product links require actual detail URL, matching brand and food product title',()=>{
 const html='<a href="https://www.coupang.com/vp/products/123">브랜드 비타민 30정 | 쿠팡</a><a href="https://www.coupang.com/vp/products/124">다른회사 비타민</a><a href="https://www.coupang.com/">브랜드 비타민</a><a href="https://brand.naver.com/mybrand/products/345">브랜드 유산균 30포</a><a href="https://evil.example/vp/products/123">브랜드 비타민</a>';
 const rows=marketProductLinks(html,'https://www.google.com/search?q=brand','브랜드');assert.equal(rows.length,2);assert.ok(rows.every(x=>!x.url.includes('evil')));assert.equal(rows[0].name,'브랜드 비타민 30정');
});
test('search-index fallback remains explicitly unverified when robots prevents product-page inspection',async()=>{
 let productPageRequests=0;const r=await searchProduct('브랜드',async(url)=>{if(url.endsWith('/robots.txt'))return {text:'User-agent: *\nDisallow: /'};if(url.includes('/vp/products')){productPageRequests++;throw Error('should not fetch');}return {text:'<a href="https://www.coupang.com/vp/products/123">브랜드 비타민 30정</a>',url};});
 assert.equal(r.products[0].sourceType,'marketplace_search_index');assert.match(r.products[0].uncertainty,/미확인/);assert.equal(productPageRequests,0);assert.equal(r.contacts,undefined);
});
test('external product replaces a generic draft without fabricating official-source ownership',()=>{
 esbuild.buildSync({entryPoints:['supabase/functions/_shared/brand-research.ts'],bundle:true,platform:'node',format:'cjs',outfile:dir+'/brand.cjs'});const {researchBrand}=require(dir+'/brand.cjs');
 const r=researchBrand({name:'브랜드',outreach:{draftMode:'brand_first',intro:'기존 일반 소개',productName:'공동구매 협의 가능한 상품',needsPersonalization:false},marketProductEvidence:[{name:'브랜드 비타민 30정',url:'https://www.coupang.com/vp/products/123',checked:new Date().toISOString(),sourceType:'marketplace_product_page',uncertainty:'판매자 권한·공급 여부 미확인'}]}, {id:'t',data:{copyFlow:'product_interest_v1',subject:'제안',body:'{{개인화}}\n내 카피',signature:'서명'}});
 assert.equal(r.outreach.draftMode,'product');assert.match(r.outreach.body,/비타민 30정/);assert.match(r.outreach.body,/내 카피/);assert.equal(r.research.ownership,'research_pending');assert.match(r.outreach.evidence[0].description,/외부 판매처/);assert.equal(r.outreach.signature,'서명');
});
