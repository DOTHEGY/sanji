const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sanji-fast-draft-'));esbuild.buildSync({entryPoints:['supabase/functions/_shared/brand-research.ts'],bundle:true,platform:'node',format:'cjs',outfile:dir+'/research.cjs'});const {researchBrand}=require(dir+'/research.cjs');
test('missing product evidence saves a brand-first draft immediately without inventing a product or claims',()=>{
 const template={id:'t',version:2,data:{subject:'제안',body:'안녕하세요 {{브랜드명}}님\n{{개인화}}\n내가 작성한 본문 https://example.com',signature:'내 서명',copyFlow:'product_interest_v1'}};
 const result=researchBrand({name:'테스트브랜드',contacts:[],outreach:{needsPersonalization:true}},template);
 assert.equal(result.outreach.needsPersonalization,false);assert.equal(result.outreach.draftMode,'brand_first');assert.match(result.outreach.body,/안녕하세요 테스트브랜드님/);assert.match(result.outreach.body,/담당자분/);assert.match(result.outreach.body,/내가 작성한 본문 https:\/\/example.com/);assert.equal(result.outreach.signature,'내 서명');assert.ok(!/확인했습니다|효능|치료/.test(result.outreach.intro));assert.equal(result.research.ownership,'research_pending');
});
