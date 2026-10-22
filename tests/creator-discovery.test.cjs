const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sanji-creator-test-')),file=path.join(dir,'creator.cjs');
esbuild.buildSync({entryPoints:['supabase/functions/_shared/creator-discovery.ts'],bundle:true,platform:'node',format:'cjs',outfile:file});
const {instagramSearchCandidates:parse,renderCreatorCopy,creatorDiscoveryService}=require(file);
test('public profile candidates deduplicate handles, exclude posts and sensitive health assumptions',()=>{
 const html='<a href="https://www.instagram.com/food_one/">푸드 레시피 공동구매</a><div>푸드 협업</div><a href="https://www.instagram.com/food_one/">레시피 공동구매</a><a href="https://www.instagram.com/p/abc/">공동구매</a><a href="https://www.instagram.com/patient/">제가 당뇨 환자 공동구매 레시피</a>';
 const rows=parse(html,'https://www.google.com/search?q=test',['레시피']);
 assert.equal(rows.filter(x=>x.handle==='food_one').length,1);assert.ok(!rows.some(x=>['p','patient'].includes(x.handle)));assert.ok(rows[0].uncertainties.length);assert.equal(rows[0].followers,undefined);
});
test('copy only replaces explicit creator variables and never adds claims',()=>assert.equal(renderCreatorCopy('안녕하세요 {{아이디}}님\n제안\n서명','food_one'),'안녕하세요 food_one님\n제안\n서명'));
test('cold DM activation is rejected before any database write or external send',async()=>{
 let writes=0;const chain={select(){return this},eq(){return this},maybeSingle(){return Promise.resolve(null)},upsert(){writes++;return this}};
 const service=creatorDiscoveryService({sb:{from:()=>chain},query:x=>x,audit:async()=>{},env:()=>''});
 await assert.rejects(()=>service.handle('/creator-discovery/settings','POST','owner',async()=>({target:500,keywords:['레시피'],dmCopy:'협업 제안',senderHandle:'own_account',autoSend:true,approved:true})),/선제 DM/);assert.equal(writes,0);
});
test('search disabled by default: no network or DB insert',async()=>{
 const chain={select(){return this},eq(){return this},maybeSingle(){return Promise.resolve(null)}};
 const service=creatorDiscoveryService({sb:{from:()=>chain},query:x=>x,audit:async()=>{},env:()=>''});
 assert.deepEqual(await service.collect('owner'),{status:'disabled'});
});
test('creator screen renders evidence, counts, saved copy and explicit non-sending state',async()=>{
 const {chromium}=require('@playwright/test');const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.setContent('<main id="app"></main>');
 const source=fs.readFileSync('private/ui/app.js','utf8'),start=source.indexOf('async function creatorDiscoveryPage(){'),end=source.indexOf('\nfunction candidatesPage(',start);
 await page.addScriptTag({content:`const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),head=(a,b)=>'<h1>'+a+'</h1><p>'+b+'</p>',button=(a,b)=>'<button data-action="'+b+'">'+a+'</button>',field=(n,l,v,t)=>'<label>'+l+'<textarea name="'+n+'">'+esc(v)+'</textarea></label>',data={candidates:[]};const api=async()=>({config:{enabled:true,target:500,keywords:['공동구매 레시피'],sender_handle:'own',dm_copy:'제안',runtime:{status:'found',sources:[]}},counts:{today:12,yesterday:8},prospects:[{handle:'public_creator',status:'new',excerpt:'공개 레시피',reasons:['공개 주제'],uncertainties:['활동 미검증'],profile:'https://www.instagram.com/public_creator/',source_url:'https://www.google.com/search?q=test',checked:new Date().toISOString(),body:'안녕하세요 public_creator님'}]});`+source.slice(start,end)+';creatorDiscoveryPage();'});
 await page.getByText('오늘 12명 · 어제 8명',{exact:false}).waitFor();assert.match(await page.locator('#app').innerText(),/DM을 보내지 않습니다/);await page.getByText('@public_creator',{exact:false}).click();assert.equal(await page.locator('pre').innerText(),'안녕하세요 public_creator님');assert.equal(await page.locator('input[type=password]').count(),0);
 }finally{await browser.close();}
});
test('topic search can retain a profile with an unavailable snippet without claiming content fit',()=>{
 const rows=parse('<a href="https://www.instagram.com/public_recipe/">@public_recipe Instagram</a>robots.txt로 인해 정보를 수집할 수 없습니다.','https://search.naver.com/search.naver?query='+encodeURIComponent('site:instagram.com 공동구매 레시피'),['공동구매 레시피']);
 assert.equal(rows.length,1);assert.match(rows[0].reasons[0],/적합성은 미확인/);assert.equal(rows[0].engagement,undefined);
});
