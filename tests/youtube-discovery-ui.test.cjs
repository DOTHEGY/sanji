const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const session = { user:{ id:'owner-a' }, access_token:'test-only-token' };
let browser, server, base, bundle;
test.before(async () => {
 const result = await esbuild.build({entryPoints:[path.join(root,'web/youtube-discovery.js')],bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'mock-auth',setup(build){build.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'mock-auth',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export function createClient(){let s=${JSON.stringify(session)},cb;window.testAuth=(v)=>{s=v;cb('SIGNED_OUT',s)};return{auth:{getSession:async()=>({data:{session:s}}),onAuthStateChange:(f)=>{cb=f}}}}`,loader:'js'}));}}]});
 bundle=result.outputFiles[0].text;
 server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.includes('app.js')?'text/javascript':req.url.includes('style.css')?'text/css':'text/html');res.end(req.url.includes('app.js')?bundle:fs.readFileSync(path.join(root,'private/youtube-discovery',req.url.includes('style.css')?'style.css':'index.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
const result={queries:['생활'],channels:[{channelId:'UCabcdefghijk',title:'<img src=x onerror="window.XSS=1">',description:'콘텐츠',url:'javascript:alert(1)',videos:[{videoId:'video123',title:'실제 영상',url:'https://www.youtube.com/watch?v=video123'}],reviewRequired:['직접 검토 필요']}],warnings:['검토 필요'],quota:{searchCalls:1,readCalls:1}};
async function open(handler){const page=await browser.newPage();await page.route('**/functions/v1/youtube-discovery/**',async route=>{ if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'*'}});return;} const fulfill=route.fulfill.bind(route); route.fulfill=options=>fulfill({...options,headers:{'access-control-allow-origin':'*',...options.headers}});await handler(route); });await page.goto(base+'/workspace/youtube/');await page.waitForSelector('#workspace:not([hidden])');return page;}
async function search(page){await page.locator('#brief').fill('생활용품 협업');await page.locator('#search').click();}
test('search is single-flight, safe text, manual purpose confirmation and editable draft; no contact endpoint',async()=>{
 let calls=0,body;
 const page=await open(async route=>{calls++;assert.ok(route.request().url().endsWith('/search'));body=route.request().postDataJSON();await new Promise(r=>setTimeout(r,120));await route.fulfill({json:result});});
 try {
 await page.locator('#queries').fill('생활\n건강');await search(page);
 await page.locator('#search-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
 await page.waitForSelector('.card');assert.equal(calls,1);assert.deepEqual(body.queries,['생활','건강']);
 assert.equal(await page.locator('.card img').count(),0);assert.equal(await page.locator('a[href^="javascript:"]').count(),0);assert.equal(await page.evaluate(()=>window.XSS),undefined);
 const choose=page.getByRole('button',{name:'입력한 주소로 초안 작성'});assert.equal(await choose.isDisabled(),true);
 await page.getByLabel('협업 문의용 이메일',{exact:true}).fill('creator@example.test');await page.getByLabel('연락처 확인 출처 URL',{exact:true}).fill('https://www.youtube.com/@creator');
 await page.locator('.contact input[type=checkbox]').check();assert.equal(await choose.isDisabled(),true);
 await page.getByLabel('공개 용도·확인 메모',{exact:true}).fill('공식 채널에 광고·비즈니스 문의용으로 공개');
 assert.equal(await page.locator('.contact input[type=checkbox]').isChecked(),false);
 await page.locator('.contact input[type=checkbox]').check();await choose.click();
 assert.match(await page.locator('#recipient').textContent(),/creator@example.test/);assert.equal(await page.locator('#open-mail').isDisabled(),true);
 await page.locator('#confirm').check();assert.equal(await page.locator('#open-mail').isEnabled(),true);
 await page.locator('#body').fill('수정한 내용');assert.equal(await page.locator('#confirm').isChecked(),false);assert.equal(await page.locator('#open-mail').isDisabled(),true);
 await page.locator('.contact input[type=checkbox]').uncheck();assert.equal(await page.locator('#draft').isHidden(),true);assert.equal(calls,1);
 } finally {await page.close();}
});
test('error and empty states permit retry',async()=>{let calls=0;const page=await open(async route=>{calls++;await route.fulfill(calls===1?{status:503,json:{error:'YouTube API key is missing'}}:{json:{...result,channels:[]}});});try{await search(page);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('key is missing'));assert.equal(await page.locator('#search').isEnabled(),true);await search(page);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('찾지 못했습니다'));assert.equal(calls,2);}finally{await page.close();}});
test('logout aborts in-flight search and removes private content',async()=>{let release,started;const gate=new Promise(r=>release=r);const start=new Promise(r=>started=r);const page=await open(async route=>{started();await gate;await route.fulfill({json:result}).catch(()=>{});});try{await search(page);await start;await page.evaluate(()=>window.testAuth(null));release();await page.waitForTimeout(150);assert.equal(await page.locator('#workspace').isHidden(),true);assert.equal(await page.locator('.card').count(),0);assert.equal(await page.locator('#brief').inputValue(),'');assert.equal(await page.locator('#body').inputValue(),'');}finally{release();await page.close();}});
test('account switching clears results and draft; pagehide clears private form data',async()=>{const page=await open(route=>route.fulfill({json:result}));try{await search(page);await page.waitForSelector('.card');await page.evaluate(()=>window.testAuth({user:{id:'owner-b'},access_token:'other-test-token'}));assert.equal(await page.locator('.card').count(),0);assert.equal(await page.locator('#brief').inputValue(),'');await page.locator('#brief').fill('private');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#brief').inputValue(),'');assert.equal(await page.locator('#workspace').isHidden(),true);}finally{await page.close();}});

test('at most two editable queries; official policy links',async()=>{let calls=0;const page=await open(route=>{calls++;return route.fulfill({json:result});});try{await page.locator('#queries').fill('하나\n둘\n셋');await search(page);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('최대 2개'));assert.equal(calls,0);assert.equal(await page.locator('footer a[href="https://www.youtube.com/t/terms"]').count(),1);assert.equal(await page.locator('footer a[href="https://policies.google.com/privacy"]').count(),1);}finally{await page.close();}});

test('business lookup is explicit and sends only channel/source; unknown site stays manual',async()=>{
 let lookups=0, payload;
 const page=await open(async route=>{if(route.request().url().endsWith('/search'))return route.fulfill({json:result});lookups++;payload=route.request().postDataJSON();await new Promise(r=>setTimeout(r,100));return route.fulfill({json:{status:'manual_required',candidates:[],reason:'미승인 사이트: 직접 확인',sourceUrl:payload.sourceUrl}});});
 try{await search(page);await page.waitForSelector('.card');await page.getByLabel('협업 문의용 이메일',{exact:true}).fill('private@example.test');await page.getByLabel('공개 용도·확인 메모',{exact:true}).fill('private note');await page.getByLabel('연락처 확인 출처 URL',{exact:true}).fill('https://example.test/contact');assert.equal(lookups,0);const button=page.getByRole('button',{name:'공식 사이트 업무 연락처 확인'});await button.click();await button.evaluate(b=>b.dispatchEvent(new Event('click')));await page.getByText('미승인 사이트: 직접 확인',{exact:true}).waitFor();assert.equal(lookups,1);assert.deepEqual(payload,{channelId:result.channels[0].channelId,sourceUrl:'https://example.test/contact'});assert.equal(await page.getByLabel('협업 문의용 이메일',{exact:true}).inputValue(),'private@example.test');assert.equal(await page.locator('.business-evidence a').getAttribute('href'),'https://example.test/contact');}finally{await page.close();}
});
test('approved fixture candidate fills only after explicit selection and resets review',async()=>{
 const candidate={email:'business@example.test',sourceUrl:'https://agency.example.test/contact',purpose:'광고·비즈니스 문의',observedAt:'2026-11-06',recipientType:'agency_business_inbox',agencyName:'Fixture Agency',affiliation:{url:'https://agency.example.test/creator',excerpt:'Fixture creator affiliation',reviewedAt:'2026-11-05'},reviewRequired:true};
 const page=await open(route=>route.fulfill({json:route.request().url().endsWith('/search')?result:{status:'review_required',candidates:[candidate],reason:'직접 검토 필요'}}));
 try{await search(page);await page.waitForSelector('.card');await page.getByLabel('연락처 확인 출처 URL',{exact:true}).fill(candidate.sourceUrl);await page.getByRole('button',{name:'공식 사이트 업무 연락처 확인'}).click();await page.getByRole('button',{name:'검토용으로 입력'}).waitFor();assert.equal(await page.getByLabel('협업 문의용 이메일',{exact:true}).inputValue(),'');assert.match(await page.locator('.business-evidence').textContent(),/크리에이터 개인 주소 아님/);assert.match(await page.locator('.business-evidence').textContent(),/2026-11-05/);await page.getByRole('button',{name:'검토용으로 입력'}).click();assert.equal(await page.getByLabel('협업 문의용 이메일',{exact:true}).inputValue(),candidate.email);assert.equal(await page.locator('.contact input[type=checkbox]').isChecked(),false);assert.equal(await page.getByRole('button',{name:'입력한 주소로 초안 작성'}).isDisabled(),true);assert.equal(await page.locator('#draft').isHidden(),true);}finally{await page.close();}
});
test('source edit invalidates pending business evidence without discarding search card',async()=>{
 let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);
 const page=await open(async route=>{if(route.request().url().endsWith('/search'))return route.fulfill({json:result});started();await gate;return route.fulfill({json:{status:'manual_required',candidates:[],reason:'STALE SOURCE REASON'}});});
 try{await search(page);await page.waitForSelector('.card');const source=page.getByLabel('연락처 확인 출처 URL',{exact:true});await source.fill('https://old.example.test/');await page.getByRole('button',{name:'공식 사이트 업무 연락처 확인'}).click();await start;await source.fill('https://new.example.test/');release();await page.waitForTimeout(150);assert.equal(await page.locator('.card').count(),1);assert.equal(await page.locator('.business-evidence').textContent(),'');assert.equal(await page.getByRole('button',{name:'공식 사이트 업무 연락처 확인'}).isEnabled(),true);}finally{release();await page.close();}
});
