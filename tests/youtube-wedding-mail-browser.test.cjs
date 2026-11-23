const fs=require('node:fs'),assert=require('node:assert/strict'),{test}=require('node:test');
const {chromium}=require('@playwright/test');
const fixture=[
 fs.readFileSync('web/youtube-wedding-mail-errors.mjs','utf8'),
 fs.readFileSync('web/youtube-wedding-mail-ui.mjs','utf8'),
].join('\n').replace(/^import .*?;$/gm,'').replace(/^export /gm,'');
const run='2026-11-24T01:00:00.000Z', expiry='2026-11-23T12:00:00.000Z';
async function mount(page){
  await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><section id="one"></section><section id="two"></section>'}));
  await page.goto('https://fixture.invalid/');
  await page.addScriptTag({content:fixture});
  await page.evaluate(({run,expiry})=>{
    window.requests=[];window.refreshed=0;
    for(const [root,day,ch] of [['one','2026-11-23','A'],['two','2026-11-22','B']]){
      const host=document.getElementById(root),box=document.createElement('input');
      box.type='checkbox';box.setAttribute('aria-label','가상 후보 제외');host.append(box);
      createWeddingMailUi({owner:'example-owner',day,storage:localStorage,sessionActive:()=>true,
       now:()=>Date.parse('2026-11-23T11:58:00Z'),id:()=> 'be6ac50e-740f-447d-b837-676c3add849f',
       readCopy:async()=>({subject:'웨딩 예시 제목',body:'가상 본문 <img src=x>',version:1}),
       refreshStatus:()=>window.refreshed++,
       request:async({body})=>{
         window.requests.push(body);
         return {projectId:'private-wedding-research',day,mode:body.mode,recipientCount:1,runAt:run,
          ...(body.action==='plan'?{expiresAt:expiry,subscriberMinimum:50000,copyVersion:1,planId:'syntheticPlanFixture.'+'Z'.repeat(43)}:{batchId:'syntheticBatchFixture',state:'scheduled'})};
       }
      }).bind({host,exclusions:[[box,'UC'+ch.repeat(22)]],eligibleCount:1,document});
    }
  },{run,expiry});
}
test('synthetic Partyum-only mobile/desktop action and duplicate guard',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await mount(page);
   const one=page.locator('#one'),two=page.locator('#two');
   await one.getByRole('checkbox',{name:'가상 후보 제외'}).check();
   await one.getByRole('button',{name:'내일 오전 10시 예약 대상 확인'}).click();
   await one.getByText(/2026-11-23 발굴.*대상 1명.*10:00/).waitFor();
   await one.getByText('가상 본문 <img src=x>',{exact:true}).waitFor();
   assert.equal(await one.locator('img').count(),0);
   assert.equal(await two.getByRole('checkbox').isChecked(),false);
   assert.equal(await two.getByRole('button',{name:'표시된 인원 예약 확정'}).isVisible(),false);
   await one.getByRole('button',{name:'표시된 인원 예약 확정'}).click();
   await one.getByText(/예약 요청을 접수했습니다/).waitFor();
   const got=await page.evaluate(()=>({requests,refreshed,fit:document.documentElement.scrollWidth<=innerWidth}));
   assert.deepEqual(got.requests.map(x=>x.action),['plan','submit']);
   assert.deepEqual(got.requests[1].channelIdsExcluded,['UC'+'A'.repeat(22)]);
   assert.equal(got.requests[1].day,'2026-11-23');
   assert.equal(got.requests[1].expectedRunAt,run);
   assert.equal(got.refreshed,1);assert.equal(got.fit,true);
   assert.equal(await one.getByRole('button',{name:'내일 오전 10시 예약 대상 확인'}).isEnabled(),false);
   assert.equal(await two.getByRole('button',{name:'내일 오전 10시 예약 대상 확인'}).isEnabled(),true);
   await page.close();
  }
 }finally{await browser.close();}
});
