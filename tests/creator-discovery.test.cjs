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
test('creator screen shows recovery recommendations and does not offer automatic outreach',async()=>{
 const {chromium}=require('@playwright/test'),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.setContent('<main id="app"></main>');const source=fs.readFileSync('private/ui/app.js','utf8'),start=source.indexOf('let recoveryView=null'),end=source.indexOf('\nfunction creatorDirectory(',start);
 await page.addScriptTag({content:`const $=s=>document.querySelector(s),esc=v=>String(v??''),tag=v=>v,head=v=>'<h1>'+v+'</h1>',button=(s,a)=>'<button data-action="'+a+'">'+s+'</button>',api=async()=>({config:{enabled:false,target:2,run_time:'09:00',daily_lookup_limit:0,retry_limit:0,paid_limit_usd:0},recommendations:[{id:'1',handle:'public_creator',profile_url:'https://www.instagram.com/public_creator/',followers:0,status:'new',emails:[],email_status:'이메일 없음',reasons:['공개 주제']}],review:[],shortfall:1,shortfallReason:'후보 부족',sourceNotice:'과거 정보'});`+source.slice(start,end)+';creatorDiscoveryPage();'});
 await page.locator('[data-recovery-row]').waitFor();assert.equal(await page.locator('[data-recovery-row]').count(),1);assert.match(await page.locator('#app').innerText(),/이메일 없음/);assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.locator('[data-action=creator-server-key],[data-action=creator-dm-review],[data-action=creator-local-pair]').count(),0);
 }finally{await browser.close();}
});
test('topic search can retain a profile with an unavailable snippet without claiming content fit',()=>{
 const rows=parse('<a href="https://www.instagram.com/public_recipe/">@public_recipe Instagram</a>robots.txt로 인해 정보를 수집할 수 없습니다.','https://search.naver.com/search.naver?query='+encodeURIComponent('site:instagram.com 공동구매 레시피'),['공동구매 레시피']);
 assert.equal(rows.length,1);assert.match(rows[0].reasons[0],/적합성은 미확인/);assert.equal(rows[0].engagement,undefined);
});
test('creator migration is repeatable; public roles cannot inspect private prospects',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
 const sql=fs.readFileSync('supabase/migrations/202610220007_creator_outreach.sql','utf8');await db.exec(sql);await db.exec(sql);
 const owner='11111111-1111-4111-8111-111111111111';await db.query('insert into auth.users values($1)',[owner]);await db.query('insert into sanji_creator_config(owner) values($1)',[owner]);
 assert.equal((await db.query('select enabled,auto_send,target from sanji_creator_config')).rows[0].auto_send,false);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select * from sanji_creator_prospects'),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
