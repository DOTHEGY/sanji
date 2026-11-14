const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('@playwright/test'),buildFixture=require('./helpers/youtube-direct-bulk-browser-fixture.cjs');
test('actual browser direct-bulk flow:201 recipients, single authorization, holds, failure, owner invalidation and safe split',async()=>{
 const {bundle,html}=buildFixture();let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='https://bulk.test')return route.abort();return route.fulfill({contentType:url.pathname==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8',body:url.pathname==='/app.js'?bundle:html});});
  await page.goto('https://bulk.test/');await page.getByRole('button',{name:'Run browser assertions'}).click();await page.waitForFunction(()=>document.querySelector('#report').textContent.startsWith('6 / 6 PASS')||document.querySelector('#report').textContent.startsWith('FAIL'));
  assert.match(await page.locator('#report').innerText(),/^6 \/ 6 PASS/);assert.deepEqual(errors,[]);assert.equal(await page.locator('#daily-outreach input[type=checkbox]').count(),0);assert.match(await page.locator('#daily-outreach').innerText(),/전체 201명 · 시스템 처리 3묶음/);
 }finally{await browser?.close();}
});
