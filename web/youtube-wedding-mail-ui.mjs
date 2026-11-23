const projectId = 'private-wedding-research';
const channelRE = /^UC[A-Za-z0-9_-]{22}$/;
const tokenRE = /^[A-Za-z0-9_-]{12,240}$/;
const planRE = /^[A-Za-z0-9_-]{12,1500}\.[A-Za-z0-9_-]{43}$/;
const requestKeyRE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoRE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
const kstDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const kstTime = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});
const disallowed = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const weddingMailProject = projectId;
function instant(s){return typeof s==='string'&&isoRE.test(s)&&Number.isFinite(Date.parse(s));}
function date(s){return typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function tomorrowTenKst(now=Date.now()){
 const day=kstDay.format(new Date(now));
 const tomorrow=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return tomorrow+'T01:00:00.000Z';
}
export function weddingMailPlanInput(day,mode,excluded){
 if(!date(day)||!['now','tomorrow'].includes(mode)||!(excluded instanceof Set)||excluded.size>100||[...excluded].some(x=>!channelRE.test(x)))throw Error('invalid wedding mail scope');
 return {action:'plan',projectId,day,mode,channelIdsExcluded:[...excluded].sort()};
}
function sameScope(value,requested){
 return value?.projectId===projectId&&value.day===requested.day&&value.mode===requested.mode;
}
function copySummary(copy){
 if(!copy||typeof copy.subject!=='string'||typeof copy.body!=='string'||!copy.subject.trim()||!copy.body.trim()||
    copy.subject.length>200||copy.body.length>15000||/[\r\n]/.test(copy.subject)||disallowed.test(copy.subject+copy.body))return null;
 return {subject:copy.subject,body:copy.body,version:copy.version};
}
export function validateWeddingMailPlan(value,requested,now=Date.now()){
 if(!sameScope(value,requested)||!Number.isSafeInteger(value.recipientCount)||value.recipientCount<0||value.recipientCount>100||
    typeof value.planId!=='string'||!planRE.test(value.planId)||!instant(value.runAt)||!instant(value.expiresAt)||!Number.isSafeInteger(value.copyVersion)||value.copyVersion<1)throw Error('invalid plan');
 const expiry=Date.parse(value.expiresAt), run=Date.parse(value.runAt);
 if(expiry<=now||expiry>now+3600000)throw Error('invalid plan expiry');
 if(requested.mode==='tomorrow'&&run!==Date.parse(tomorrowTenKst(now)))throw Error('invalid planned reservation');
 if(requested.mode==='now'&&(run<now-300000||run>now+300000))throw Error('invalid immediate plan');
 return {planId:value.planId,recipientCount:value.recipientCount,runAt:value.runAt,expiresAt:value.expiresAt,copyVersion:value.copyVersion};
}
export function validateWeddingMailSubmit(value,requested,plan){
 if(!sameScope(value,requested)||value.recipientCount!==plan.recipientCount||!instant(value.runAt)||Date.parse(value.runAt)!==Date.parse(plan.runAt)||
    typeof value.batchId!=='string'||!tokenRE.test(value.batchId)||value.state!==(requested.mode==='tomorrow'?'scheduled':'queued'))throw Error('unverified result');
 return {state:value.state,batchId:value.batchId};
}
export function createWeddingMailUi({owner,day,storage,request,readCopy,sessionActive,refreshStatus,now=Date.now,id=()=>crypto.randomUUID()}){
 const key='sanji:partyum:submit:v1:'+owner+':'+day;
 const model={excluded:new Set(),pending:null,view:null,plan:null,prepareVersion:0,locked:false,message:'',options:null};
 if(storage){try{model.locked=storage.getItem(key)!==null;}catch{storage=null;}}
 if(model.locked)model.message='이 날짜의 기존 요청을 먼저 확인해야 합니다. 발송·예약 상태를 확인하고 관리자에게 문의해 주세요.';
 function sync(){
  const v=model.view;if(!v)return;
  v.summary.textContent=model.plan?model.planText:'';
  v.notice.textContent=model.message;
  const hasPlan=!!model.plan;
  v.confirm.hidden=!hasPlan;
  v.confirm.disabled=model.locked||!!model.pending||!hasPlan||model.plan?.recipientCount===0;
  v.confirm.textContent=model.options?.mode==='tomorrow'?'표시된 인원 예약 확정':'표시된 인원 지금 발송 확정';
  v.controls.forEach(b=>{b.disabled=model.locked||!!model.pending||!storage;});
  v.exclusions.forEach(([box,channel])=>{box.checked=model.excluded.has(channel);box.disabled=!!model.pending||model.locked||!storage;});
  v.copyTitle.textContent=model.visibleCopy?.subject??'';
  v.copyBody.textContent=model.visibleCopy?.body??'';
  v.copy.hidden=!model.visibleCopy;
 }
 function invalidate(){
  model.prepareVersion++;
  model.plan=null;model.options=null;model.visibleCopy=null;model.planText='';
 }
 async function prepare(mode){
  if(model.locked||model.pending||!storage||!sessionActive())return;
  invalidate();
  const revision=model.prepareVersion;
  let options;
  try{options=weddingMailPlanInput(day,mode,model.excluded);}catch{model.message='선택 범위를 확인할 수 없습니다. 제외한 후보 수를 확인해 주세요.';sync();return;}
  model.pending='plan';model.message='대상과 카피 확인 중…';sync();
  try{
   const raw=await request({body:options,stillActive:()=>sessionActive()&&model.prepareVersion===revision});
   if(!sessionActive()||revision!==model.prepareVersion)return;
   const plan=validateWeddingMailPlan(raw,options,now());
   if(plan.recipientCount===0){model.message='발송할 수 있는 대상이 없습니다.';return;}
   const visible=copySummary(await readCopy?.(()=>sessionActive()&&model.prepareVersion===revision));
   if(!sessionActive()||revision!==model.prepareVersion)return;
   if(!visible||plan.copyVersion!==visible.version)throw Error('copy mismatch');
   if(Date.parse(plan.expiresAt)<=now())throw Error('expired');
   model.plan=plan;model.options=options;model.visibleCopy=visible;
   model.planText=day+' 발굴 · 대상 '+plan.recipientCount+'명 · '+(mode==='now'?'지금 발송':'예약')+' · '+kstTime.format(new Date(plan.runAt))+' (한국시간)';
   model.message='아래 내용과 대상 수를 확인한 뒤 확정하세요.';
  }catch{if(sessionActive()&&revision===model.prepareVersion)model.message='대상, 날짜 또는 적용 카피를 확인하지 못했습니다. 아직 요청하지 않았습니다.';}
  finally{model.pending=null;sync();}
 }
 async function submit(){
  const plan=model.plan,options=model.options;
  if(!plan||!options||model.pending||model.locked||!storage||!sessionActive()||plan.recipientCount<1)return;
  if(Date.parse(plan.expiresAt)<=now()||(options.mode==='tomorrow'&&Date.parse(plan.runAt)!==Date.parse(tomorrowTenKst(now())))){
   invalidate();model.message='확인 내용이 만료되었거나 한국 날짜가 바뀌었습니다. 다시 대상 수를 확인해 주세요.';sync();return;
  }
  let idempotencyKey;
  try{
   // This is a conservative same-tab guard; the server must also enforce idempotency and recipient claims across sessions/devices.
   if(storage.getItem(key)!==null)throw Error('pending');
   idempotencyKey=id();if(!requestKeyRE.test(idempotencyKey))throw Error('id');
   storage.setItem(key,idempotencyKey);
  }catch{
   model.locked=true;model.message='기존 요청 여부를 확인할 수 없어 추가 요청하지 않았습니다. 목록과 계정을 확인하세요.';sync();return;
  }
  model.pending='submit';model.locked=true;model.message='확정 요청 중…';sync();
  try{
   const result=await request({body:{...options,action:'submit',planId:plan.planId,expectedRecipientCount:plan.recipientCount,expectedRunAt:plan.runAt,idempotencyKey},stillActive:sessionActive});
   if(!sessionActive())return;
   const verified=validateWeddingMailSubmit(result,options,plan);
   invalidate();
   model.message=verified.state==='scheduled'?'예약 요청을 접수했습니다. 확인된 예약·발송 상태는 목록에 표시됩니다.':'발송 대기열에 요청을 접수했습니다. 발송 완료는 목록에서 확인하세요.';
   refreshStatus?.();
  }catch{
   if(!sessionActive())return;
   invalidate();model.message='요청 결과를 확인하지 못했습니다. 중복을 막기 위해 잠갔습니다. 다시 요청하지 말고 상태를 확인하세요.';refreshStatus?.();
  }finally{model.pending=null;sync();}
 }
 return {
  bind({host,exclusions,eligibleCount,document}){
   const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
   const makeButton=(text,fn)=>{const b=make('button',text);b.type='button';b.addEventListener('click',fn);return b;};
   const legend=make('p','이 날짜만 적용됩니다. 체크한 사람은 제외됩니다.');
   const empty=make('p','현재 발송할 수 있는 공개 이메일 대상이 없습니다.');
   const nowBtn=makeButton('지금 발송 대상 확인',()=>void prepare('now')), tomorrowBtn=makeButton('내일 오전 10시 예약 대상 확인',()=>void prepare('tomorrow'));
   const summary=make('p',''),notice=make('p',storage?'':'이 브라우저에서 중복 방지를 확인할 수 없어 발송 기능이 잠겼습니다.');
   notice.setAttribute('role','status');
   const confirm=makeButton('확정',()=>void submit());
   const copy=make('section',''),copyTitle=make('strong',''),copyBody=make('p','');
   copy.className='wedding-mail-copy';copy.append(make('h5','이 요청에 적용할 카피'),copyTitle,copyBody);
   host.append(legend);
   if(eligibleCount)host.append(nowBtn,tomorrowBtn);else host.append(empty);
   host.append(summary,copy,confirm,notice);
   model.view={summary,notice,confirm,copy,copyTitle,copyBody,controls:[nowBtn,tomorrowBtn],exclusions};
   if(!storage&&!model.message)model.message='이 브라우저에서 중복 방지를 확인할 수 없어 발송 기능이 잠겼습니다.';
   for(const [box,channel] of exclusions){
    box.addEventListener('change',()=>{
     if(model.pending||model.locked){sync();return;}
     if(box.checked)model.excluded.add(channel);else model.excluded.delete(channel);
     invalidate();model.message='대상 제외가 바뀌었습니다. 대상 수를 다시 확인해 주세요.';sync();
    });
   }
   sync();
  },
  refreshed(){if(!model.locked){invalidate();model.message='';sync();}},
  revoke(){invalidate();model.view=null;}
 };
}
