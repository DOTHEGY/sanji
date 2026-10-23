'use strict';
const {randomUUID}=require('node:crypto');
const {chromium}=require('../local-worker/node_modules/playwright');
const {identity,profile,instagramOnlyState,validHandle}=require('../local-worker/worker.cjs');
const BASE='https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/creator-server/worker/';
async function run({key=process.env.SANJI_SERVER_KEY,sender=process.env.SANJI_SENDER_HANDLE,launch=()=>chromium.launch({headless:true}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),request,verify=identity,inspect=profile,log=console.log}={}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!validHandle(sender||''))throw Error('Render 서버 연결 키·발신 아이디 설정이 필요합니다.');
 const instance=randomUUID();let browser,blockedRevision=-1,activeRevision=-1,stopped=false;
 const api=request|| (async(route,data={})=>{const r=await fetch(BASE+route,{method:'POST',headers:{'content-type':'application/json','x-sanji-server':key},body:JSON.stringify({...data,sender,instance}),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('서버 요청 실패');return r.json();});
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
    browser=await launch();const context=await browser.newContext({storageState:instagramOnlyState(saved.state),viewport:{width:1100,height:800}});
    const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
    try{await verify(page,sender);}catch{throw Error('reauth');}
    browser.sanjiPage=page;await api('status',{status:'ready',sessionChecked:saved.checked});log('DB 세션·발신 계정 확인 완료 · 프로필 미리보기 전용, DM 발송 없음');
   }
   const {job,dailyLimit}=await api('next');
   if(job){if(job.type!=='profile')throw Error('unsupported');const p=await inspect(browser.sanjiPage,job);await api('profile',{id:job.id,profile:p});if(p.halt)throw Error('reauth');}
   else await api('status',{status:dailyLimit?'daily_limit':'idle'});
  }catch(e){blockedRevision=revision;await close();await api('status',{status:e.message==='reauth'?'reauth_required':'error'}).catch(()=>{});log('작업 중지 · 산지에서 상태 확인 후 수동 재개하세요. 자동 로그인·DM 재시도 없음');}
  if(!stopped)await sleep(30000);
 }}finally{await close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
module.exports={run};
if(require.main===module)run().catch(()=>{console.error('서버 설정 오류 · 키와 발신 아이디를 Render에서 확인하세요.');process.exitCode=1;});
