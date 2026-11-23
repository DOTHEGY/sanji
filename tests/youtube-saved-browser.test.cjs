const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const esbuild=require('esbuild');const {chromium}=require('@playwright/test');
let browser,server,base;
test.before(async()=>{const bundle=(await esbuild.build({stdin:{contents:`import {mountYoutubeSaved} from './web/youtube-saved.mjs';window.mountYoutubeSaved=mountYoutubeSaved;`,resolveDir:path.resolve(__dirname,'..')},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/app.js'?bundle:'<div id="saved"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
test.after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function page(){const p=await browser.newPage();await p.goto(base);await p.evaluate(()=>{
window.owner='owner-a';window.rows=[];window.reads=0;window.saves=0;window.changes=0;window.selectionChanges=0;window.reviews=[];window.gate=null;window.saveGate=null;
const client={auth:{getSession:async()=>({data:{session:{user:{id:window.owner},access_token:'fixture-token'}}})},from:table=>{if(table!=='sanji_records')throw Error('Wrong table');let requested;const q={select:()=>q,eq:(k,v)=>{if(k==='owner')requested=v;return q;},order:()=>q,limit:()=>q,setHeader:()=>q,gt:()=>q,then:async(resolve,reject)=>{window.reads++;const captured=window.rows.filter(r=>r.owner===requested);if(window.gate)await window.gate;resolve({data:captured});}};return q;},rpc:(name,args)=>({setHeader:()=>({then:async(resolve)=>{window.saves++;if(window.saveGate)await window.saveGate;if(window.rows.some(r=>r.owner===window.owner&&r.data.companyKey===args.p_data.companyKey)){resolve({error:{code:'23505'}});return;}window.rows.push({id:'00000000-0000-0000-0000-000000000001',owner:window.owner,version:1,updated:'2026-11-09T00:00:00Z',kind:'candidate',data:args.p_data});resolve({data:window.rows.at(-1)});}})})};
window.controller=window.mountYoutubeSaved({container:document.querySelector('#saved'),client,getOwner:()=>window.owner,isCurrent:o=>window.owner===o,onChange:()=>window.changes++,onSelectionChange:()=>window.selectionChanges++,onReview:(rows,runAt,scope)=>window.reviews.push({rows,runAt,scope}),readDayStatus:(scope,context)=>window.mailEvidence?.(scope,context)??Promise.resolve(null)});
});return p;}
const profile='https://www.youtube.com/channel/UC'+'a'.repeat(22);
test('saved reads are owner bound and a late former-owner result never appears',async()=>{const p=await page();try{await p.evaluate(profile=>{window.rows=[{id:'00000000-0000-0000-0000-000000000001',owner:'owner-a',version:1,updated:'2026-11-09T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'OLD PRIVATE',profile}}];window.gate=new Promise(r=>window.release=r);window.loading=window.controller.load();},profile);await p.waitForFunction(()=>window.reads>0);await p.evaluate(()=>{window.owner='owner-b';window.controller.clear();window.release();window.gate=null;});await p.evaluate(()=>window.loading);assert.equal(await p.getByText('OLD PRIVATE').count(),0);await p.evaluate(()=>window.controller.load());assert.match(await p.locator('#saved').textContent(),/산지 저장 0명/);}finally{await p.close();}});
test('manual saves dedup by canonical ID, single-flight and notify search badges',async()=>{const p=await page();try{await p.evaluate(()=>window.controller.load());await p.locator('.saved-management > summary').click();await p.getByText('직접 찾은 먹방 채널 기록',{exact:true}).click();await p.locator('[name=name]').fill('먹방 후보');await p.locator('[name=profile]').fill(profile);await p.locator('[name=source]').fill(profile);await p.locator('[name=reason]').fill('최근 먹방 콘텐츠 원문 확인');await p.locator('[data-role=manual-candidate] input[type=checkbox]').check();await p.evaluate(()=>{window.saveGate=new Promise(r=>window.releaseSave=r);document.querySelector('[data-role=manual-candidate]').dispatchEvent(new Event('submit',{cancelable:true}));document.querySelector('[data-role=manual-candidate]').dispatchEvent(new Event('submit',{cancelable:true}));});await p.waitForFunction(()=>window.saves===1);assert.equal(await p.getByRole('button',{name:'저장한 후보 새로고침'}).isDisabled(),true);await p.evaluate(()=>document.querySelector('#saved > button').dispatchEvent(new Event('click')));await p.locator('[name=name]').fill('다음 채널 작성 중');await p.evaluate(()=>window.releaseSave());await p.getByText(/산지 저장 1명 · 표시 1명 · 공개 주소/).waitFor();assert.equal(await p.locator('[name=name]').inputValue(),'다음 채널 작성 중');assert.equal(await p.evaluate(()=>window.controller.hasChannelId('UC'+'a'.repeat(22))),true);assert.equal(await p.evaluate(()=>window.controller.hasChannelId('UC'+'A'.repeat(22))),false);assert.ok(await p.evaluate(()=>window.changes)>=2);for(const [k,v] of Object.entries({name:'별명 변경',profile,source:profile,reason:'다시 확인'}))await p.locator(`[name=${k}]`).fill(v);await p.locator('[data-role=manual-candidate] input[type=checkbox]').check();await p.getByRole('button',{name:'산지 후보로 저장'}).click();await p.getByText('이미 저장된 채널입니다. 기존 기록을 덮어쓰지 않았습니다.',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.saves),1);await p.evaluate(()=>window.controller.clear());assert.equal(await p.evaluate(()=>window.controller.getSavedIds().size),0);}finally{await p.close();}});
test('shared agency addresses remain unverified source evidence and dates are retrieval dates',async()=>{const p=await page();try{await p.evaluate(profile=>{window.rows=[{id:'00000000-0000-0000-0000-000000000001',owner:'owner-a',version:1,updated:'2026-11-09T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'출처 확인 후보',profile,followers:30000,metricsChecked:'2026-11-09',metricsSource:profile,contact:{email:''},youtubeResearch:{collections:['먹방'],businessContacts:[{email:'agency@example.test',sourceUrl:'https://agency.example.test/contact',checked:'2026-11-09',purpose:'업무 문의'}]}}}];return window.controller.load();},profile);await p.locator('.creator-detail > summary').click();assert.match(await p.locator('.saved-youtube-list').textContent(),/출처 확인일 2026-11-09/);assert.match(await p.locator('.saved-youtube-list').textContent(),/agency@example.test.*연락 동의 미확인/);assert.equal(await p.getByText('공개 업무 이메일 미확인 · 이메일 개수가 아닌 후보 수로 집계합니다.',{exact:true}).count(),0);assert.equal(await p.getByRole('link',{name:'업무 연락처 확인 출처'}).getAttribute('href'),'https://agency.example.test/contact');}finally{await p.close();}});
test('date and keyword filters preserve exclusions without sending or saving',async()=>{const p=await page();try{await p.setViewportSize({width:390,height:844});await p.evaluate(profile=>{window.rows=[{id:'00000000-0000-0000-0000-000000000001',owner:'owner-a',version:1,updated:'2026-11-10T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'첫 채널',profile,followers:40000,reason:'음식 탐방',contact:{email:'one@example.test'},youtubeResearch:{observedAt:'2026-11-09T01:00:00Z',collections:['먹방']}}},{id:'00000000-0000-0000-0000-000000000002',owner:'owner-a',version:1,updated:'2026-11-10T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'둘째 채널',profile:profile.replace(/a{22}/,'b'.repeat(22)),followers:40000,reason:'음식 리뷰',contact:{email:'two@example.test'},youtubeResearch:{collections:['먹방']}}}];return window.controller.load();},profile);await p.getByRole('checkbox',{name:'첫 채널 예약에서 제외'}).check();await p.getByLabel('조사 확인일 시작').fill('2026-11-09');await p.getByLabel('조사 확인일 끝').fill('2026-11-09');assert.equal(await p.getByRole('checkbox',{name:'둘째 채널 예약에서 제외'}).count(),0);await p.getByLabel('저장한 YouTube 후보 검색').fill('음식');await p.getByRole('button',{name:'제외한 사람 빼고 예약 준비'}).click();assert.match(await p.getByLabel('예약 대상 준비').textContent(),/프로젝트의 날짜 버튼/);assert.equal(await p.evaluate(()=>window.saves),0);await p.getByRole('button',{name:'검색 조건 지우기'}).click();assert.equal(await p.getByRole('checkbox',{name:'첫 채널 예약에서 제외'}).isChecked(),true);assert.equal(await p.getByRole('checkbox',{name:'둘째 채널 예약에서 제외'}).count(),1);}finally{await p.close();}});
test('project date grouping exposes candidate profile, subscriber count, email and copy control',async()=>{const p=await page();try{await p.evaluate(profile=>{window.rows=[{id:'00000000-0000-0000-0000-000000000001',owner:'owner-a',version:2,updated:'2026-11-11T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'테스트 채널',profile,followers:77300,reason:'먹방',contact:{email:'creator@example.test',source:'https://example.test/contact',checked:'2026-11-09'},youtubeResearch:{collections:['먹방'],projects:[{id:'gs-bbangteojineunjip-chewy-bread',addedAt:'2026-11-11T00:00:00Z',assignedDay:'2026-11-12'}]}}}];return window.controller.load();},profile);await p.getByRole('button',{name:'2026-11-12 · 이메일 1명'}).click();await p.getByRole('link',{name:'테스트 채널'}).waitFor();assert.equal(await p.getByRole('link',{name:'테스트 채널'}).getAttribute('href'),profile);assert.match(await p.locator('.saved-youtube-list').textContent(),/77,300/);assert.match(await p.locator('.saved-youtube-list').textContent(),/creator@example.test/);assert.equal(await p.getByRole('button',{name:'테스트 채널 개별 카피 보기'}).isEnabled(),true);assert.equal(await p.evaluate(()=>window.saves),0);}finally{await p.close();}});
test('excluded status and managed contacts stay visible in history with disabled controls and zero eligible counts',async()=>{const p=await page();try{
const pageErrors=[];p.on('pageerror',error=>pageErrors.push(error.message));
await p.evaluate(profile=>{window.rows=['제외','검토 중'].map((status,i)=>({id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),owner:'owner-a',version:2,updated:'2026-11-14T00:00:00Z',kind:'candidate',data:{kind:'크리에이터',name:'제외 후보 '+i,status,profile:i?profile.replace(/a{22}/,'b'.repeat(22)):profile,followers:50000,contact:{email:'creator@sandbox.co.kr',sourceUrl:i?profile.replace(/a{22}/,'b'.repeat(22)):profile,checked:'2026-11-14',context:'광고 문의 creator@sandbox.co.kr',publicSourceVerified:true,directCreatorSourceVerified:true},youtubeResearch:{collections:['먹방'],projects:[{id:'gs-bbangteojineunjip-chewy-bread',addedAt:'2026-11-14T00:00:00Z',assignedDay:'2026-11-14'}]}}}));return window.controller.load();},profile);
assert.equal(await p.evaluate(()=>window.controller.getSavedIds().size),2);
assert.deepEqual(pageErrors,[]);
const rendered=await p.locator('#saved').innerText(),buttons=await p.getByRole('button').allTextContents();
assert.match(rendered,/2026-11-14 · 이메일 0명/);
assert.ok(buttons.includes('2026-11-14 · 이메일 0명'),JSON.stringify({buttons,rendered}));
await p.getByRole('button',{name:'2026-11-14 · 이메일 0명'}).click();
await p.locator('.creator-history > summary').click();
assert.equal(await p.getByRole('checkbox',{name:'제외 후보 0 예약에서 제외'}).isDisabled(),true);
assert.equal(await p.getByRole('checkbox',{name:'제외 후보 1 예약에서 제외'}).isDisabled(),true);
assert.match(await p.locator('.saved-youtube-list').textContent(),/MCN 관리 연락처 확인/);
assert.deepEqual(await p.evaluate(()=>window.controller.getSelectedRecipients()),[]);
await p.getByRole('button',{name:'제외한 사람 빼고 예약 준비'}).click();
assert.match(await p.getByLabel('예약 대상 준비').textContent(),/예약할 대상이 없습니다/);
assert.equal(await p.evaluate(()=>window.saves),0);
}finally{await p.close();}});
test('refresh and clear invalidate an already prepared selection before resetting exclusions',async()=>{const p=await page();try{await p.evaluate(()=>window.controller.load());assert.equal(await p.evaluate(()=>window.selectionChanges),1);await p.evaluate(()=>window.controller.load());assert.equal(await p.evaluate(()=>window.selectionChanges),2);await p.evaluate(()=>window.controller.clear());assert.equal(await p.evaluate(()=>window.selectionChanges),3);}finally{await p.close();}});
test('per-row campaign mail statuses keep discovery dates, recorded send and reservation times separate',async()=>{
 const p=await page();
 try{
  await p.evaluate(profile=>{
    const projectId='gs-bbangteojineunjip-chewy-bread';
    const statuses=['sent','scheduled','found_only','unknown'];
    const dayFor=i=>i<3?'2026-11-15':'2026-11-16';
    window.rows=statuses.map((_,i)=>({id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),owner:window.owner,version:1,kind:'candidate',updated:'2026-11-15T00:00:00Z',
    data:{kind:'크리에이터',name:'합성 후보 '+i,profile:profile.replace(/a{22}/,String.fromCharCode(97+i).repeat(22)),contact:{email:'fixture-'+i+'@example.test'},youtubeResearch:{projects:[{id:projectId,addedAt:'2026-11-15T01:00:00Z',assignedDay:dayFor(i)}]}}}));
    window.statusCalls=[];
    window.mailEvidence=async scope=>{
     window.statusCalls.push(scope);
     return {...scope,items:scope.ids.map(id=>{const i=Number(id.slice(-2))-1;return {candidateId:id,state:statuses[i],at:['2026-11-15T16:00:00Z','2026-11-16T01:00:00Z'][i],completeForCandidate:i===2};})};
    };
    return window.controller.load();
  },profile);
  await p.getByRole('heading',{name:'2026-11-15 · 프로젝트 분류일 (KST)'}).waitFor();
  const sections=p.locator('.creator-project-day');
  assert.equal(await sections.count(),2);
  const before=sections.filter({hasText:'2026-11-15 · 프로젝트 분류일'});
  await before.getByText('발송 완료',{exact:true}).waitFor();
  const total=await before.innerText();
  assert.match(total,/Gmail 접수 기록.*11.*16.*1:00/);
  assert.match(total,/예약 시각.*11.*16.*10:00/);
  assert.match(total,/찾기만 함/);
  assert.match(await sections.filter({hasText:'2026-11-16 · 프로젝트 분류일'}).innerText(),/확인 필요/);
  assert.equal(await p.evaluate(()=>window.statusCalls.length),2);
  assert.equal(await p.evaluate(()=>window.saves),0);
 }finally{await p.close();}
});

test('Chewy daily review verifies counts and exclusions without scheduling on desktop or mobile',async()=>{
 for(const width of [390,1280]){
  const p=await page();try{
   await p.setViewportSize({width,height:880});
   await p.evaluate(profile=>{
    const projectId='gs-bbangteojineunjip-chewy-bread',day='2026-11-15';
    const states=['found_only','found_only','scheduled','sent','unknown','found_only'];
    window.rows=states.map((_,i)=>({id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),owner:window.owner,version:1,kind:'candidate',updated:'2026-11-15T00:00:00Z',
     data:{kind:'크리에이터',name:'예약 가상 '+i,followers:32000,profile:profile.replace(/a{22}/,String.fromCharCode(97+i).repeat(22)),
      contact:{email:'fixture-'+i+'@example.test'},youtubeResearch:{projects:[{id:projectId,addedAt:day+'T01:00:00Z',assignedDay:i===5?'2026-11-16':day}]}}}));
    window.mailEvidence=async scope=>({...scope,items:scope.ids.map(id=>{const i=Number(id.slice(-2))-1;return {candidateId:id,state:states[i],
      at:i===2||i===3?'2026-11-16T01:00:00Z':null,completeForCandidate:states[i]==='found_only'};})});
    return window.controller.load();
   },profile);
   const quick=p.getByRole('button',{name:'2026-11-15 내일 오전 10시 예약 대상 확인'});
   const box=p.getByRole('checkbox',{name:'예약 가상 0 예약에서 제외'});
   const group=p.locator('.creator-project-day').filter({hasText:'2026-11-15 · 프로젝트 분류일'});
   await group.getByText('찾기만 함 2명 · 발송 예약 1명 · 발송 완료 1명 · 발송 실패 0명 · 확인 필요 1명').waitFor();
   await box.check();
   await group.getByText('예약 대상 확인 가능 1명 · 선택 제외 1명').waitFor();
   await quick.click();
   const got=await p.evaluate(()=>({reviews:window.reviews,saves:window.saves}));
   assert.deepEqual(got.reviews[0].rows.map(r=>r.email),['fixture-1@example.test']);
   assert.deepEqual(got.reviews[0].scope,{projectId:'gs-bbangteojineunjip-chewy-bread',day:'2026-11-15'});
   assert.match(got.reviews[0].runAt,/T01:00:00\.000Z$/);
   assert.match(await p.getByLabel('예약 대상 준비').textContent(),/아직 예약하지 않았습니다/);
   await p.getByRole('button',{name:'2026-11-15 예약·발송 상태 새로고침'}).click();
   assert.equal(await box.isChecked(),true);
   assert.equal(got.saves,0);
  }finally{await p.close();}
 }
});
