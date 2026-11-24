const PROJECT='private-wedding-research';
const messageType='SEND_ORIGINAL_RESERVATIONS';
const address=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/;
const scope='canonical_gmail_and_sanji_ledger';
const token=/^[A-Za-z0-9_-]{16,1400}\.[A-Za-z0-9_-]{43}$/;
const available=x=>x?.available===true&&Number.isSafeInteger(x.recipientCount)&&x.recipientCount>0&&x.recipientCount<=100&&
 address.test(x.expectedMailbox??'');
/** Shows one optional owner action only on an authenticated server signal. */
export function createWeddingRecoveryUi({host,document,request,active,afterQueued=()=>{},now=Date.now}){
 let disposed=false,running=false,attempted=false,expected=null;
 const current=()=>!disposed&&active();
 const text=(tag,body)=>{const n=document.createElement(tag);n.textContent=body;return n;};
 let button,status;
 const call=(action,body={})=>request({body:{action,projectId:PROJECT,...body},stillActive:current});
 async function start(){
  if(!current()||running||attempted||!expected)return;
  running=true;button.disabled=true;
  status.textContent='기존 예약과 보낸메일함을 대조하고 있습니다…';
  try{
   const p=await call('recovery_prepare',{expectedMailbox:expected.expectedMailbox});
   if(!current())return;
   if(p?.state!=='incident_preview'||p.recipientCount!==expected.recipientCount||p.sender!==expected.expectedMailbox||
      p.historyScope!==scope||!token.test(p.planToken??'')||!Number.isFinite(Date.parse(p.expiresAt))||
      Date.parse(p.expiresAt)<=now()||Date.parse(p.expiresAt)>now()+120000)throw Error('Changed recovery scope');
   // This is the same explicit click the user just made. The server never
   // receives a recipient list or a different copy from the browser.
   attempted=true;
   const ack=await call('recovery_submit',{expectedMailbox:expected.expectedMailbox,planToken:p.planToken,confirm:messageType});
   if(!current())return;
   if(ack?.state!=='incident_admitted'||ack.recipientCount!==expected.recipientCount||!Number.isFinite(Date.parse(ack.runAt)))throw Error('Unknown recovery outcome');
   button.hidden=true;
   status.textContent=`${ack.recipientCount}건을 발송 대기열에 넣었습니다. 발송 완료 여부는 메일 상태에 표시됩니다.`;
   afterQueued();
  }catch{
   if(!current())return;
   status.textContent=attempted?'발송 요청 결과가 확실하지 않습니다. 중복 요청하지 말고 발송 상태를 확인해 주세요.':'기존 예약을 확인하지 못했습니다. 발송은 요청하지 않았습니다.';
  }finally{
   if(current()){running=false;button.disabled=attempted;}
  }
 }
 async function load(){
  if(!current())return;
  let result;
  try{result=await call('recovery_availability');}catch{return;}
  if(!current()||!available(result))return;
  expected=Object.freeze({recipientCount:result.recipientCount,expectedMailbox:result.expectedMailbox});
  button=text('button',`기존 예약 메일 ${expected.recipientCount}건 다시 보내기`);
  button.type='button';button.addEventListener('click',()=>{void start();});
  status=text('p','발신 계정: '+expected.expectedMailbox);status.setAttribute('role','status');
  host.replaceChildren(button,status);host.hidden=false;
 }
 function revoke(){disposed=true;expected=null;host.hidden=true;host.replaceChildren();}
 return {load,revoke};
}
