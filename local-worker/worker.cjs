'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const BASE='https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function';
const validHandle=s=>/^[a-z0-9._]{2,30}$/.test(s)&&!['accounts','direct','explore','reels','stories'].includes(s);
const stateDirectory=()=>path.join(os.homedir(),'.sanji-instagram');
async function api(token,route,body){const r=await fetch(BASE+'/creator-local/worker/'+route,{method:'POST',headers:{'Content-Type':'application/json','x-sanji-worker':token},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Error(data.error||'PC 연결 요청 실패');return data;}
async function identity(page,expected,navigate=true){
 if(!validHandle(expected))throw Error('발신 아이디 형식 오류');
 if(navigate)await page.goto('https://www.instagram.com/',{waitUntil:'domcontentloaded'});
 // Profile navigation labels vary between Instagram layouts and languages.
 for(let i=0;i<12;i++){
  const links=page.getByRole('link',{name:/^(프로필|Profile)(?:\s|$)/i});
  for(let n=0;n<await links.count();n++){const link=links.nth(n),href=await link.getAttribute('href');try{const u=new URL(href,'https://www.instagram.com');if(u.hostname==='www.instagram.com'&&u.pathname.toLowerCase()==='/'+expected+'/'&&await link.isVisible())return expected;}catch{}}
  const tagged=page.locator('a').filter({has:page.locator('svg[aria-label="프로필"],svg[aria-label="Profile"]')});
  for(let n=0;n<await tagged.count();n++){const link=tagged.nth(n),href=await link.getAttribute('href');if(href?.toLowerCase()==='/'+expected+'/'&&await link.isVisible())return expected;}
  await page.waitForTimeout(500);
 }
 if(navigate){
  // Viewing a profile is insufficient. Only its logged-in owner sees Edit profile.
  await page.goto('https://www.instagram.com/'+expected+'/',{waitUntil:'domcontentloaded'});
  const edit=page.getByRole('link',{name:/^(프로필 편집|프로필 수정|Edit profile)$/i}).or(page.getByRole('button',{name:/^(프로필 편집|프로필 수정|Edit profile)$/i}));
  for(let i=0;i<20;i++){
   const u=new URL(page.url());
   if(u.hostname==='www.instagram.com'&&u.pathname.replace(/\/$/,'').toLowerCase()==='/'+expected&&await edit.first().isVisible().catch(()=>false))return expected;
   if(/\/accounts\/login|\/challenge|\/checkpoint/.test(u.pathname))break;
   await page.waitForTimeout(500);
  }
 }
 throw Error('로그인 계정을 확인하지 못했습니다. @'+expected+' 프로필에서 「프로필 편집」이 보이는지 확인하세요. 다른 계정·확인 불가 상태에서는 진행하지 않습니다.');
}

async function openProfile(page,handle){if(!validHandle(handle))throw Error('올바르지 않은 수신자');await page.goto('https://www.instagram.com/'+handle+'/',{waitUntil:'domcontentloaded'});await page.locator('main').waitFor({timeout:12000});const u=new URL(page.url());if(u.hostname!=='www.instagram.com'||u.pathname.replace(/\/$/,'').toLowerCase()!=='/'+handle)throw Error('대상 프로필 대신 로그인·다른 페이지로 이동됨');const text=await page.locator('main').innerText();if(/확인해 주세요|계정이 제한|Try Again Later|Action Blocked|일시적으로 차단|Suspicious|challenge|잠시 후 다시/i.test(text))throw Error('제한 또는 인증 확인 화면 · 실행 중지');return text;}
async function profile(page,job){
 try{const text=await openProfile(page,job.handle);if(/비공개 계정|This account is private|페이지를 사용할 수 없|Sorry, this page/i.test(text))return {status:'unavailable',reason:'비공개·접근 제한 계정 · 공개 정보 미수집'};
 const header=page.locator('main header').first();await header.waitFor({timeout:8000});
 const stat=async name=>{const a=header.locator('a[href$="/'+name+'/"]').first();return await a.innerText({timeout:1500}).catch(()=>'');};
 const headerText=await header.innerText();const posts=headerText.match(/(?:게시물\s*[\d,.만천억KMB]+|[\d,.KMB]+\s+posts)/i)?.[0]||'';
 const displayName=await header.locator('h1').innerText({timeout:1000}).catch(()=>''),bio=headerText.slice(0,1000);
 const box=await header.boundingBox();let image='';if(box&&box.height>0&&box.width>0){const shot=await page.screenshot({clip:{x:Math.max(0,box.x),y:Math.max(0,box.y),width:Math.min(box.width,1100),height:Math.min(box.height,650)}});if(shot.length<=400000)image=shot.toString('base64');}
 return {status:'checked',displayName,bio,followersText:await stat('followers'),followingText:await stat('following'),postsText:posts,image};
 }catch(e){return {status:'unavailable',reason:e.message.slice(0,200),halt:true};}
}
async function conversationRecipient(editor,expected,inDirect){
 return await editor.evaluate((el,{expected,inDirect})=>{
  const dialog=el.closest('[role="dialog"]');
  const scope=dialog||(inDirect?el.closest('main,[role="main"]'):null);if(!scope)return false;
  const box=scope.getBoundingClientRect(),input=el.getBoundingClientRect(),handles=new Set();
  for(const a of scope.querySelectorAll('a[href]')){
   const rect=a.getBoundingClientRect();if(!rect.width||!rect.height||rect.top<box.top||rect.top>box.top+160)continue;
   if(!dialog&&rect.right<input.left-50)continue;
   try{const u=new URL(a.getAttribute('href'),location.href);if(!['www.instagram.com','instagram.com'].includes(u.hostname))continue;const match=/^\/([a-z0-9._]+)\/?$/i.exec(u.pathname);if(match&&!['accounts','direct','explore','reels'].includes(match[1]))handles.add(match[1].toLowerCase());}catch{}
  }
  return handles.size===1&&handles.has(expected);
 },{expected,inDirect});
}
async function sendApproved(page,job,check,beforeClick){
 if(!job.body?.trim()||!validHandle(job.handle))return {status:'failed',note:'대상·카피 미확인 · 전송 안 함'};
 let clicked=false;
 try{
  const profileText=await openProfile(page,job.handle);
  if(/비공개 계정|This account is private/i.test(profileText))return {status:'failed',note:'비공개 계정 · 전송하지 않음'};
  const message=page.getByRole('button',{name:/^(메시지|메시지 보내기|Message|Send message)$/i}).first();
  if(!await message.isVisible().catch(()=>false))return {status:'failed',note:'메시지 버튼 없음 · 팔로우하지 않고 중단'};
  await message.click();
  const editor=page.locator('div[role="textbox"][contenteditable="true"],textarea[placeholder="Message..."],textarea[placeholder="메시지 입력..."]').last();await editor.waitFor({timeout:12000});
  // Instagram may open a chat dialog without changing the profile URL.
  if(!await conversationRecipient(editor,job.handle,/\/direct\//.test(new URL(page.url()).pathname)))return {status:'failed',note:'대화 수신자 확인 불가 · 전송 안 함'};
  const beforeCount=await page.locator('body').getByText(job.body,{exact:true}).count();
  await editor.fill(job.body);
  if((await editor.innerText().catch(()=>''))!==job.body) return {status:'failed',note:'입력된 카피 불일치 · 전송 안 함'};
  const send=page.getByRole('button',{name:/^(보내기|Send)$/i}).last();await send.waitFor({timeout:5000});
  await check();await beforeClick();clicked=true;await send.click();
  await page.waitForTimeout(1500);
  const text=await page.locator('body').innerText();
  if(/Action Blocked|일시적으로 차단|나중에 다시 시도|Try Again Later|too many/i.test(text))return {status:'unknown',note:'전송 클릭 후 제한 화면 · 결과 미확인, 재시도 안 함',halt:true};
  const bubble=page.locator('body').getByText(job.body,{exact:true}).first();
  if((await editor.innerText().catch(()=>job.body)).trim()===''&&await page.locator('body').getByText(job.body,{exact:true}).count()>beforeCount&&await bubble.isVisible().catch(()=>false))return {status:'sent',note:'대화 화면에 발신 문구 표시 확인 · 전달·열람 미확인'};
  return {status:'unknown',note:'전송 버튼 클릭 후 발신 표시 미확인 · 재시도 안 함',halt:true};
 }catch(e){return {status:clicked?'unknown':'failed',note:(clicked?'클릭 후 결과 미확인: ':'전송 전 중단: ')+e.message.slice(0,180),halt:true};}
}
function instagramOnlyState(state){return {cookies:state.cookies.filter(c=>['instagram.com','.instagram.com','www.instagram.com'].includes(c.domain)),origins:(state.origins||[]).filter(o=>o.origin==='https://www.instagram.com')};}
async function run(){
 const readline=require('node:readline/promises'),io=readline.createInterface({input:process.stdin,output:process.stdout});let context;
 try{
  console.log('산지 PC 실행기 · 로그인 세션은 DB 백업 설정에 따라 암호화 보관합니다. 종료: Ctrl+C');
  const token=(await io.question('산지 화면에서 발급한 PC 연결 키: ')).trim();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('연결 키 형식 오류');
  const sender=(await io.question('로그인할 발신 아이디 (@ 제외): ')).trim().replace(/^@/,'').toLowerCase();if(!validHandle(sender))throw Error('아이디 형식 오류');
  const live=process.argv.includes('--send-approved');if(live&&(await io.question('웹에서 승인한 DM을 실제 전송합니다. 실행하려면 SEND 입력: ')).trim()!=='SEND')throw Error('발송 모드 취소');
  const dir=stateDirectory();fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const {chromium}=require('playwright');context=await chromium.launchPersistentContext(path.join(dir,'browser-'+sender),{headless:false,viewport:{width:1280,height:900},locale:'ko-KR',timezoneId:'Asia/Seoul'});
  const request=(route,data={})=>api(token,route,{...data,sender,live});
  const page=await context.newPage();let restored=false;
  const saved=await request('session/load');
  if(saved.state){
   await context.clearCookies({domain:/instagram\.com$/});await context.addCookies(saved.state.cookies);
   if(saved.state.origins?.length){await page.goto('https://www.instagram.com/',{waitUntil:'domcontentloaded'});await page.evaluate(entries=>{for(const x of entries)localStorage.setItem(x.name,x.value);},saved.state.origins[0].localStorage);}
   try{await identity(page,sender);restored=true;console.log('DB의 암호화된 로그인 세션을 복원·확인했습니다.');}catch{console.log('저장된 세션이 만료됐거나 추가 인증이 필요합니다. 직접 로그인해 주세요.');}
  }
  if(!restored){await page.goto('https://www.instagram.com/accounts/login/',{waitUntil:'domcontentloaded'});await io.question('열린 Instagram 창에서 직접 로그인·2단계 인증을 마치고 Enter: ');await identity(page,sender);}
  if(!saved.disabled){const state=await context.storageState();await request('session/save',{state:instagramOnlyState(state)});console.log('로그인 세션을 DB에 암호화해 백업했습니다. 보관기간: 7일.');}else console.log('DB 세션 백업 꺼짐 · 이 PC의 로그인 상태만 사용합니다.');
  await request('heartbeat');
  const journalFile=path.join(dir,'pending-'+sender+'.json');
  if(fs.existsSync(journalFile)){const j=JSON.parse(fs.readFileSync(journalFile,'utf8'));await request('result',{...j,status:'unknown',note:'이전 실행이 전송 도중 종료됨 · 자동 재시도 안 함'});fs.unlinkSync(journalFile);}
  console.log(live?'승인된 DM만 처리합니다. 새 대상·카피는 웹에서 승인하세요.':'프로필 미리보기 모드입니다. DM을 보내지 않습니다.');
  let profilesChecked=0;
  while(true){
   if(profilesChecked>=5){console.log('이번 실행에서 프로필 5개를 확인했습니다. 자동으로 더 조회하지 않고 종료합니다.');break;}
   const {job}=await request('next');if(!job){console.log('처리할 작업 없음 · 30초 후 확인');await new Promise(r=>setTimeout(r,30000));continue;}
   if(job.type==='profile'){profilesChecked++;console.log('@'+job.handle+' 공개 프로필 확인');const p=await profile(page,job);await request('profile',{id:job.id,profile:p});if(p.halt){console.log(p.reason+' · 추가 조회 없이 종료합니다.');break;}}
   else if(job.type==='dm'){
    if(!live)throw Error('미리보기 모드에서 전송 작업이 반환됨 · 중단');
    console.log('수신자 @'+job.handle+'\n발신자 @'+sender+'\n최종 본문:\n'+job.body);
    if((await io.question('이 1건을 실제 전송하려면 수신자 아이디 '+job.handle+' 입력 (그 외 입력은 취소): ')).trim()!==job.handle){await request('result',{id:job.id,approvedHash:job.approvedHash,status:'failed',note:'PC 최종 확인에서 취소 · 전송 안 함'});break;}
    const result=await sendApproved(page,job,async()=>{const accountPage=await context.newPage();try{await identity(accountPage,sender);}finally{await accountPage.close();}await request('check',{id:job.id,approvedHash:job.approvedHash});},async()=>fs.writeFileSync(journalFile,JSON.stringify({id:job.id,approvedHash:job.approvedHash}),{mode:0o600}));
    await request('result',{id:job.id,approvedHash:job.approvedHash,...result});if(fs.existsSync(journalFile))fs.unlinkSync(journalFile);console.log(result.note);break;
   }
   await new Promise(r=>setTimeout(r,30000));
  }
 }finally{io.close();await context?.close();}
}
module.exports={conversationRecipient,instagramOnlyState,validHandle,identity,openProfile,profile,sendApproved,stateDirectory};
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
