'use strict';
const {randomUUID}=require('node:crypto');
const {chromium}=require('../local-worker/node_modules/playwright');
const {failureKind,identity,profile,sendApproved,instagramOnlyState,validHandle}=require('../local-worker/worker.cjs');
const BASE='https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/creator-server/worker/';
function apiFailure(status,message=''){
 if(/다른 서버/.test(message))return 'lease_busy';
 if(/서버 키가 해제|키가 필요/.test(message))return 'key_invalid';
 if(/서버 연결 키 만료/.test(message))return 'key_expired';
 if(/발신 아이디 불일치/.test(message))return 'sender_mismatch';
 if(status===401)return 'function_auth';if(status===404)return 'function_missing';return 'api_error';
}
const failureMessage=code=>({key_invalid:'Render SANJI_SERVER_KEY가 현재 산지 서버 키와 일치하지 않습니다. PC 키가 아닌 Render 전용 키를 확인하세요.',key_expired:'Render 서버 키가 만료됐습니다. 새 서버 키로 갱신하세요.',sender_mismatch:'Render SANJI_SENDER_HANDLE이 산지의 발신 계정과 다릅니다.',function_auth:'Edge Function 인증 설정으로 요청이 거절됐습니다.',function_missing:'서버 함수 주소를 찾지 못했습니다.',reauth:'Instagram 로그인·계정 확인이 필요합니다.',api_error:'서버 API 요청 실패 · 연결 상태를 확인하세요.'}[code]||'서버 실행 오류 · 산지 상태를 확인하세요.');
async function run({key=process.env.SANJI_SERVER_KEY,sender=process.env.SANJI_SENDER_HANDLE,launch=()=>chromium.launch({headless:true}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),request,verify=identity,inspect=profile,send=sendApproved,log=console.log}={}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!validHandle(sender||''))throw Error('Render 서버 연결 키·발신 아이디 설정이 필요합니다.');
 const instance=randomUUID();let browser,blockedRevision=-1,activeRevision=-1,stopped=false,nextDiscovery=0,recoveryCount=0,recoveryWindow=Date.now();
 const api=request|| (async(route,data={})=>{const r=await fetch(BASE+route,{method:'POST',headers:{'content-type':'application/json','x-sanji-server':key},body:JSON.stringify({...data,sender,instance}),signal:AbortSignal.timeout(25000)});const response=await r.json();if(!r.ok)throw Error(apiFailure(r.status,response.error||''));return response;});
 const close=async()=>{await browser?.close().catch(()=>{});browser=null;};
 const stop=()=>{stopped=true;void close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{while(!stopped){
  let revision=activeRevision;
  try{
   const control=await api('control');revision=control.revision;
   if(!control.enabled||blockedRevision===revision){await close();await sleep(30000);continue;}
   if(!browser||activeRevision!==revision){
    await close();activeRevision=revision;
    const saved=await api('session');if(!saved.state)throw Error('reauth');
    browser=await launch();const context=await browser.newContext({storageState:instagramOnlyState(saved.state),viewport:{width:1100,height:1000}});
    const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
    try{await verify(page,sender);}catch(e){throw Error(failureKind(e,page.url?.()||''));}
    browser.sanjiPage=page;await api('status',{status:'ready',sessionChecked:saved.checked,workerVersion:'server-background-v5'});log('DB 세션·발신 계정 확인 완료 · 프로필 확인 실행 · 별도 승인된 내부 테스트 1건만 DM 허용');
   }
   if(control.testAllowed){const {job:test}=await api('test-next',{workerVersion:'server-background-v5'});if(test){
    const result=await send(browser.sanjiPage,test,async()=>{const accountPage=await browser.sanjiPage.context().newPage();try{await verify(accountPage,sender);}finally{await accountPage.close();}await api('test-check',{id:test.id,approvedHash:test.approvedHash});},async()=>{await api('test-before-click',{id:test.id,approvedHash:test.approvedHash});});
    await api('test-result',{id:test.id,approvedHash:test.approvedHash,...result});log('내부 테스트 결과: '+result.status+' · '+result.note);if(result.halt)throw Error(/제한|인증|로그인/.test(result.note||'')?'reauth':'send_halt');await sleep(30000);continue;
   }}
   if(control.discoveryEnabled&&Date.now()>=nextDiscovery){nextDiscovery=Date.now()+300000;try{const search=await api('discover');log('자동 검색: '+String(search.status||'확인 완료')+' · 신규 '+Number(search.added||0)+'명');}catch{log('검색 요청 실패 · 5분 후 재확인, 프로필 작업은 유지');}}
   const {job,dailyLimit}=await api('next');
   if(job){if(job.type!=='profile')throw Error('unsupported');const p=await inspect(browser.sanjiPage,job);if(stopped)break;await api('profile',{id:job.id,profile:p});if(stopped)break;if(p.halt)throw Error(p.failureKind==='reauth'?'reauth':p.failureKind==='transient'?'transient':'profile_error');}
   else await api('status',{status:dailyLimit?'daily_limit':'idle',workerVersion:'server-background-v5'});
  }catch(e){if(stopped)break;if(e.message==='transient'){if(Date.now()-recoveryWindow>3600000){recoveryWindow=Date.now();recoveryCount=0;}await close();if(recoveryCount++<2){await api('status',{status:'recovering',workerVersion:'server-background-v5'}).catch(()=>{});log('브라우저 종료·일시 네트워크 오류 · 60초 후 저장 세션으로 최대 2회 복구');await sleep(60000);continue;}}if(e.message==='lease_busy'){await close();await sleep(30000);continue;}blockedRevision=revision;await close();await api('status',{status:e.message==='reauth'?'reauth_required':'error',workerVersion:'server-background-v5'}).catch(()=>{});log('작업 중지: '+failureMessage(e.message)+' 자동 로그인·DM 재시도 없음');}
  if(!stopped)await sleep(30000);
 }}finally{await close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
module.exports={run,apiFailure,failureMessage};
if(require.main===module)run().catch(()=>{console.error('서버 설정 오류 · 키와 발신 아이디를 Render에서 확인하세요.');process.exitCode=1;});
