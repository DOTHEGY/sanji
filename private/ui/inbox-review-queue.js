/* Owner-reported task state only. No message dispatch, provider sync, or local persistence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SanjiInboxReview=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const label=state=>state==='reported_sent'?'직접 보냈다고 표시 · 사용자 보고':'확인함 · 사용자 보고';
 function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value??null);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
 async function fingerprint(value){const bytes=new TextEncoder().encode(canonical(value));return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function create(opt){
  const owner=opt.getOwner();let active=true,ready=false,busy=false,settings=null,error='',epoch=0,items=[],descriptors=new Map(),unsubscribe=()=>{};
  const live=()=>active&&opt.getOwner()===owner&&(!opt.isActive||opt.isActive());
  const changed=()=>{if(live())opt.onChange?.();};
  function destroy(){active=false;epoch++;ready=false;settings=null;items=[];descriptors.clear();unsubscribe();}
  async function load(){if(!live()||busy)return;const generation=++epoch;ready=false;error='확인·숨김 상태를 읽는 중입니다.';changed();try{const r=await opt.api('read',null,owner,()=>live()&&generation===epoch);if(!live()||generation!==epoch)return;settings=r;items=r.inboxReviewQueue?.items||[];ready=true;error='';}catch(e){if(live()&&generation===epoch)error='확인·숨김 상태를 읽지 못했습니다. 목록을 숨기지 않았습니다. 다시 읽어 주세요.';}finally{if(live()&&generation===epoch)changed();}}
  function replace(scope,rows){
   if(!live())return;const keys=new Set(rows.map(r=>r.key));let updated=false;
   for(const [key,d]of descriptors)if(d.scope===scope&&!keys.has(key)){descriptors.delete(key);updated=true;}
   for(const row of rows){const canonicalValue=canonical({owner,key:row.key,value:row.value}),previous=descriptors.get(row.key);if(previous?.scope===scope&&previous.canonicalValue===canonicalValue&&previous.allowed===row.allowed&&previous.label===row.label)continue;
    const d={...row,scope,canonicalValue,fingerprint:null};descriptors.set(row.key,d);updated=true;
    fingerprint({owner,key:row.key,value:row.value}).then(hash=>{if(live()&&descriptors.get(row.key)===d){d.fingerprint=hash;changed();}}).catch(()=>{if(live()&&descriptors.get(row.key)===d){d.allowed=false;error='기록 버전을 확인하지 못해 숨기지 않았습니다.';changed();}});
   }
   if(updated)changed();
  }

  const entry=key=>items.find(x=>x.key===key);
  const hidden=key=>{const d=descriptors.get(key),e=entry(key);return !!(live()&&ready&&d?.fingerprint&&d.allowed!==false&&e&&e.fingerprint===d.fingerprint);};
  const controls=key=>{const d=descriptors.get(key);if(!d||hidden(key))return '';const disabled=!ready||busy||!d.fingerprint||d.allowed===false;return '<div class="actions inbox-review-actions" data-inbox-review-key="'+esc(key)+'"><button type="button" data-inbox-review-action="reviewed" data-review-key="'+esc(key)+'" '+(disabled?'disabled':'')+'>확인함</button><button type="button" data-inbox-review-action="reported_sent" data-review-key="'+esc(key)+'" '+(disabled?'disabled':'')+'>직접 보냈다고 표시</button></div><p class="fine">'+(d.allowed===false?'정정 연결·상대 정보가 불명확해 숨김을 보류합니다. 기록을 먼저 확인하세요.':'이 버튼은 현재 불러온 기록만 확인·숨김 처리합니다. 메시지를 보내거나 실제 발송 근거를 만들지 않습니다. 새 기록을 읽으면 다시 나타납니다.')+'</p>';};
  function markup(){if(!live())return '';const hiddenEntries=ready?items:[];return '<section class="panel inbox-review-queue"><h2>확인·숨김 기록 <span class="tag">'+hiddenEntries.length+'개</span></h2><p class="fine">계정에 저장되는 사용자 보고입니다. 실제 발송·전달·열람 상태가 아니며 원문·초안·정정 이력은 삭제하지 않습니다. 과거 메모와 기존 수신 대화는 출처가 달라 각각 처리합니다. 이 변경은 기존 이메일 승인 검토를 다시 요구할 수 있습니다.</p><p role="status" data-inbox-review-status>'+esc(error)+'</p><button type="button" data-inbox-review-action="reload" '+(busy?'disabled':'')+'>확인·숨김 상태 다시 읽기</button><details data-inbox-reviewed-list><summary>확인·숨김 목록 '+hiddenEntries.length+'개 · 되돌리기</summary>'+hiddenEntries.map(e=>{const d=descriptors.get(e.key);return '<article data-inbox-reviewed-key="'+esc(e.key)+'"><strong>'+esc(e.label)+'</strong><p>'+esc(label(e.state))+' · '+esc(e.reportedAt)+'</p><p class="fine">'+(hidden(e.key)?'현재 불러온 같은 기록을 활성 목록에서 숨김':d?'새 정보 또는 미확인 연결이 있어 활성 목록에 다시 표시':'해당 출처의 기록을 아직 불러오지 않음 · 현재 목록과 일치 여부 미확인')+'</p><button type="button" data-inbox-review-action="restore" data-review-key="'+esc(e.key)+'" '+(busy?'disabled':'')+'>되돌리기</button></article>';}).join('')+'</details></section>';}
  async function act(action,key){
   if(!live()||busy)return;if(action==='reload')return load();if(!ready||!settings)return;
   const d=descriptors.get(key),e=entry(key);if(!['reviewed','reported_sent','restore'].includes(action)||(action==='restore'?!e:!d?.fingerprint||d.allowed===false))return;
   if(opt.beforeAction?.()===false)return;
   const expected=action==='restore'?e.fingerprint:d.fingerprint,generation=epoch,descriptor=d;
   busy=true;error='현재 기록의 확인·숨김 상태를 저장하는 중입니다.';changed();
   const valid=()=>live()&&generation===epoch&&(action==='restore'?entry(key)?.fingerprint===expected:descriptors.get(key)===descriptor&&descriptor.fingerprint===expected);
   try{
    const r=await opt.api(action,{settingsId:settings.id,version:settings.version,key,fingerprint:expected,...(action==='restore'?{}:{label:d.label})},owner,valid);
    if(!valid())return;settings=r;items=r.inboxReviewQueue?.items||[];error=action==='restore'?'확인·숨김 표시를 되돌렸습니다.':label(action)+'로 저장했습니다. 실제 발송 상태는 바뀌지 않았습니다.';
   }catch(e){if(live()){ready=false;error='저장 여부를 확인하지 못했습니다. 재시도 전에 확인·숨김 상태를 다시 읽어 주세요. 활성 목록은 유지합니다.';}}
   finally{busy=false;changed();}
  }
  function handle(event){const b=event.target.closest?.('[data-inbox-review-action]');if(!b)return;event.preventDefault?.();event.stopPropagation?.();return act(b.dataset.inboxReviewAction,b.dataset.reviewKey);}
  unsubscribe=opt.subscribeSession?.(()=>{if(opt.getOwner()!==owner){destroy();opt.onChange?.();}})||(()=>{});if(!active)unsubscribe();
  return {load,destroy,replace,hidden,controls,markup,act,handle,hasWork:()=>busy};
 }
 return {canonical,fingerprint,create};
});
