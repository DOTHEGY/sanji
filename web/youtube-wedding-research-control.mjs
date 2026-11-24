const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const runText='승인된 작업 실행';
const pending='공식 YouTube 기준을 확인하는 중입니다.';
const ambiguous='작업 결과를 확인하지 못했습니다. 목록을 새로고침해 결과를 확인하고, 같은 ID를 다시 실행하지 마세요.';

function accepted(r){
 if(r.mode==='refresh_day')return `공식 구독자 정보 ${r.updated}팀을 갱신했습니다. 메일은 발송하지 않았습니다.`;
 if(r.mode==='dry_run')return `검증만 완료: ${r.qualified}팀 통과 · ${r.held}팀 보류. 신규 등록과 메일 발송은 하지 않았습니다.`;
 return `신규 등록 ${r.enrolled}팀 · 보류 ${r.held}팀 · 기존 또는 중복 ${r.already}팀 · 일일 한도 ${r.dailyCap}팀. 메일은 발송하지 않았습니다.`;
}

/** UI-only: receipt ID is ephemeral and never put in URL, storage or output.
 * Owner/membership verification is performed both by mount and existing client. */
export function mountWeddingResearchControl(host,{submit,context,onSuccess}={}){
 if(!host||typeof submit!=='function'||typeof context!=='function')return {revoke(){},busy:()=>false};
 const doc=host.ownerDocument;
 const make=(tag,content)=>{const el=doc.createElement(tag);if(content)el.textContent=content;return el;};
 const details=make('details'),summary=make('summary','승인된 후보 검증·등록'),help=make('p','관리자가 검증한 후보에 대해 발급한 일회용 작업 ID만 사용할 수 있습니다. 이 작업은 이메일을 보내거나 예약하지 않습니다.');
 const form=make('form'), label=make('label','승인 작업 ID'), input=make('input'), send=make('button',runText), status=make('p');
 form.setAttribute('autocomplete','off');
 input.setAttribute('aria-label','승인 작업 ID');
 input.setAttribute('autocomplete','off');
 input.setAttribute('autocapitalize','none');
 input.setAttribute('spellcheck','false');
 input.setAttribute('maxlength','36');
 input.setAttribute('required','');
 send.setAttribute('type','submit');
 status.setAttribute('role','status');
 label.append(input);form.append(label,send);details.append(summary,help,form,status);host.append(details);
 let generation=0,running=false;
 const observed=new Set();
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(running||host.hidden||!host.isConnected)return;
  const op=input.value.trim().toLowerCase();
  if(!UUID.test(op)){status.textContent='올바른 작업 ID를 입력하세요.';return;}
  if(observed.has(op)){input.value='';status.textContent='이미 실행한 작업 ID입니다. 목록에서 결과를 확인하세요.';return;}
  const ctx=context();
  if(!ctx?.owner||typeof ctx.stillActive!=='function'||!ctx.stillActive())return;
  const ticket=++generation;
  const stillActive=()=>generation===ticket&&!host.hidden&&host.isConnected&&ctx.stillActive();
  observed.add(op);running=true;input.value='';input.disabled=true;send.disabled=true;status.textContent=pending;
  try{
   const result=await submit({owner:ctx.owner,operationId:op,stillActive});
   if(!stillActive())return;
   status.textContent=accepted(result);
   if(result.enrolled>0||result.updated>0)queueMicrotask(()=>{if(stillActive())void onSuccess?.(ctx,result);});
  }catch{
   if(stillActive())status.textContent=ambiguous;
  }finally{
   if(generation===ticket){running=false;input.disabled=false;send.disabled=false;}
  }
 });
 return {busy:()=>running,revoke(){
   ++generation;observed.clear();running=false;input.value='';input.disabled=false;send.disabled=false;status.textContent='';details.open=false;
 }};
}
