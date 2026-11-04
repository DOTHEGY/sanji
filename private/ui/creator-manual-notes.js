/* Historical operator notes only. No provider API, message dispatch or browser persistence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SanjiManualNotes=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
 const fields={handle:30,observedAt:40,sourceUrl:200,inboundWhen:500,summary:4000,draft:5000,intent:500,afterInboundOutbound:500,recorderType:30};
 const labels={handle:'Instagram 계정 (정확한 아이디)',observedAt:'직접 확인한 날짜 또는 시각',sourceUrl:'확인한 Instagram DM 원문 링크',inboundWhen:'상대 메시지 시점 · 모르면 미확인',summary:'확인한 내용 요약',draft:'미발송 참고 초안',intent:'상대 의도 · 추정은 구분해서 기록',afterInboundOutbound:'수신 이후 우리 측 발신 여부 · 모르면 미확인',recorderType:'기록 작성자 유형'};
 function normalize(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('메모 객체가 필요합니다.');
  const out={};for(const [key,max]of Object.entries(fields)){const v=raw[key]??'';if(typeof v!=='string'||v.length>max)throw Error(labels[key]+' 길이 또는 형식을 확인하세요.');out[key]=v;}
  out.handle=out.handle.trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9._]{1,30}$/.test(out.handle)||['.','..'].includes(out.handle))throw Error('정확한 계정 아이디를 입력하세요.');
  if(!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d))?$/.test(out.observedAt)||!Number.isFinite(Date.parse(out.observedAt)))throw Error('확인 날짜를 YYYY-MM-DD 또는 시간대가 있는 ISO 시각으로 입력하세요.');
  if(Number(out.observedAt.slice(0,4))<2000||Date.parse(out.observedAt)>Date.now()||(out.observedAt.length>10&&(Number(out.observedAt.slice(11,13))>23||Number(out.observedAt.slice(14,16))>59||Number(out.observedAt.slice(17,19))>59)))throw Error('2000년 이후 실제 확인한 과거 날짜 또는 시각을 입력하세요. 미래 시각은 기록할 수 없습니다.');
  const day=out.observedAt.slice(0,10);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('실제 확인 날짜를 입력하세요.');
  if(!/^https:\/\/(?:www\.)?instagram\.com\/direct\/t\/\d+\/?$/.test(out.sourceUrl))throw Error('Instagram DM 원문 링크만 입력하세요.');
  if(!out.summary.trim())throw Error('확인한 내용 요약을 입력하세요.');
  if(!['user','assistant','other_authorized_worker'].includes(out.recorderType))throw Error('기록 작성자 유형을 선택하세요.');
  return out;
 }
 function parseImport(text){if(typeof text!=='string'||text.length>200000)throw Error('JSON 파일은 200KB 이하여야 합니다.');const data=JSON.parse(text),items=Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[data];if(!items.length||items.length>20)throw Error('한 번에 1~20개 메모를 검토하세요.');return items.map(normalize);}
 function sameNote(note,payload){return !!note&&note.id===payload.noteId&&note.creatorId===payload.creatorId&&Object.keys(fields).every(k=>note[k]===payload[k])&&(note.supersedesId||null)===(payload.supersedesId||null)&&note.recordType==='manual_historical_note'&&note.latestVerified===false&&note.dispatchState==='not_sent'&&typeof note.recordedAt==='string';}
 // Group source calendar dates, not normalized instants. Never derive inbound time from observation/save time.
 function inboundChronology(raw){
  const text=typeof raw==='string'?raw.trim():'';
  if(/^(?:약 )?\d+(?:분|시간|일|주|개월|년) 전(?:, (?:정확한|세부) 시각 미확인)?(?:, Instagram 표시)?$/.test(text)||/^(?:오늘|어제|그제)(?:, (?:정확한|세부) 시각 미확인)?$/.test(text))return {kind:'relative'};
  const match=/^(\d{4}-\d\d-\d\d)(.*)$/.exec(text);
  if(!match)return {kind:'unknown'};
  const date=match[1],parsed=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return {kind:'unknown'};
  const rest=match[2].replace(/, Instagram 표시$/,'');
  const unpositioned={kind:'dated',date,basis:'unpositioned',label:'시각 미확인 · 이 날짜 안의 위치를 정하지 않음',clock:null};
  if(!rest||/^, (?:정확한|세부) 시각 미확인$/.test(rest))return unpositioned;
  let time=/^ (오전|오후) (\d{1,2}):(\d\d)$/.exec(rest);
  if(time&&+time[2]>=1&&+time[2]<=12&&+time[3]<60)return {kind:'dated',date,basis:'korean-minute',label:'한국어 표시 시각순 · 분 단위 · 시간대 미확인',clock:((+time[2]%12)+(time[1]==='오후'?12:0))*3600+(+time[3])*60};
  time=/^[ T](\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?(Z|[+-](\d\d):(\d\d))?$/.exec(rest);
  if(time&&+time[1]<24&&+time[2]<60&&(!time[3]||+time[3]<60)&&(!time[6]||(+time[6]<=14&&+time[7]<60&&(+time[6]!==14||+time[7]===0)))){
   const zone=time[5]||'',precision=time[4]?'소수 '+time[4].length+'자리':time[3]?'초':'분';
   return {kind:'dated',date,basis:'numeric:'+zone+':'+precision,label:'숫자 표시 시각순 · '+precision+' 단위 · '+(zone?'원문 시간대 '+zone:'시간대 미확인'),clock:+time[1]*3600+(+time[2])*60+(+(time[3]||0))+(time[4]?Number('0.'+time[4]):0)};
  }
  // A malformed/ambiguous clock may retain its explicit day, but a date range or uncertain date may not.
  if(/^(?: (?:오전|오후) |[ T])\d{1,2}:\d{1,2}/.test(rest)&&!/(?:\d{4}-\d\d-\d\d|날짜|또는|부터|까지|어제|오늘|[~～/])/.test(rest))return unpositioned;
  return {kind:'unknown'};
 }
 function chronologyGroups(notes){
  const dates=new Map(),relative=[],unknown=[];
  for(const note of notes){const c=inboundChronology(note.inboundWhen);if(c.kind!=='dated'){(c.kind==='relative'?relative:unknown).push(note);continue;}
   if(!dates.has(c.date))dates.set(c.date,new Map());const sections=dates.get(c.date);
   if(!sections.has(c.basis))sections.set(c.basis,{basis:c.basis,label:c.label,entries:[]});sections.get(c.basis).entries.push({note,clock:c.clock});
  }
  const groups=[...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,sections])=>({key:date,label:date+' · 원문 표시 날짜',sections:[...sections.values()].filter(s=>s.basis!=='unpositioned').concat(sections.has('unpositioned')?[sections.get('unpositioned')]:[]).map(s=>({basis:s.basis,label:s.label,items:s.entries.sort((a,b)=>s.basis==='unpositioned'?0:a.clock-b.clock).map(e=>e.note)}))}));
  if(relative.length)groups.push({key:'relative',label:'상대 시점 · 날짜 미확정',sections:[{basis:'unpositioned',label:'관찰 시각으로 날짜를 계산하지 않음 · 다른 날짜와의 앞뒤 순서 미확인',items:relative}]});
  if(unknown.length)groups.push({key:'unknown',label:'시점 미확인 · 날짜 분류 불가',sections:[{basis:'unpositioned',label:'날짜·형식이 불명확한 기록 · 수신 순서를 정하지 않음',items:unknown}]});
  return groups;
 }
 function reviewGroups(notes){
  const timed=[],unknown=[];
  for(const note of notes){
   const m=typeof note.recordedAt==='string'&&/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|([+-])(\d\d):(\d\d))$/.exec(note.recordedAt);
   const day=m&&new Date(m[1]+'T00:00:00Z');
   if(!m||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==m[1]||+m[2]>23||+m[3]>59||+m[4]>59||(m[8]&&(+m[8]>14||+m[9]>59||(+m[8]===14&&+m[9]!==0)))){unknown.push(note);continue;}
   // Keep sub-millisecond database precision so only genuine timestamp ties retain input order.
   const millis=Date.parse(m[1]+'T'+m[2]+':'+m[3]+':'+m[4]+m[6]);
   if(!Number.isFinite(millis)){unknown.push(note);continue;}
   timed.push({note,rank:BigInt(millis)*1000000n+BigInt((m[5]||'').padEnd(9,'0'))});
  }
  const groups=[];
  if(timed.length)groups.push({key:'review',label:'검수 순서 · 산지에 먼저 기록한 메모부터',sections:[{basis:'recorded',label:'산지 기록 시각 기준 · 실제 답장 순서 아님',items:timed.sort((a,b)=>a.rank<b.rank?-1:a.rank>b.rank?1:0).map(e=>e.note)}]});
  if(unknown.length)groups.push({key:'recorded-unknown',label:'기록 시각 미확인 · 검수 순서 미정',sections:[{basis:'unpositioned',label:'기존 목록 순서 유지 · 원문 시각이나 확인일로 대체하지 않음',items:unknown}]});
  return groups;
 }
 function recordMarkup(n,locked,loadedIds,correctedIds){
  const correction=n.supersedesId?(loadedIds.has(n.supersedesId)?' · 정정 대상 메모도 현재 목록에 표시됨':' · 정정 대상 메모는 현재 목록에 없음'):'';
  return '<article class="panel" data-note-record="'+esc(n.id)+'"><h4>@'+esc(n.handle)+'</h4><p>최신 상태 미확인</p><p>원문 확인일: '+esc(n.observedAt)+'<br>산지 기록 시각: '+esc(n.recordedAt)+'</p><p>작성자 유형: '+esc(({user:'사용자',assistant:'도우미',other_authorized_worker:'권한 있는 작업자'})[n.recorderType]||'미확인')+(n.supersedesId?' · 이전 메모 정정 기록':'')+correction+'</p>'+(correctedIds.has(n.id)?'<p class="notice">이 메모를 정정한 기록이 현재 목록에 있음 · 원래 기록도 유지</p>':'')+['inboundWhen','summary','intent','afterInboundOutbound','draft'].map(k=>'<h5>'+esc(labels[k])+'</h5><p class="manual-note-text">'+esc(n[k]||'기록 없음')+'</p>').join('')+'<p class="notice">미발송 참고 초안 · 전송 전 원문 재확인 필요</p>'+(/^https:\/\/(?:www\.)?instagram\.com\/direct\/t\/\d+\/?$/.test(n.sourceUrl)?'<a href="'+esc(n.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Instagram 원문 직접 확인 ↗</a>':'')+' <button type="button" data-note-action="correct" data-note-id="'+esc(n.id)+'" '+(locked?'disabled':'')+'>정정 메모 추가</button></article>';
 }
 function mount(host,opt){
  const owner=opt.getOwner();if(!owner)throw Error('로그인이 필요합니다.');
  let active=true,busy=false,dirty=false,uncertain=null,rows=[],cursor=null,listRead=false,listComplete=false,order='review',queue=[],target=null,correction=null,form={},checked=false,status='저장된 수동 확인 메모를 불러오세요.',unsubscribe=()=>{};
  const live=()=>active&&host.isConnected!==false&&opt.getOwner()===owner&&(!opt.isActive||opt.isActive());
  function destroy(){if(!active)return;active=false;host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);host.removeEventListener('submit',submit);unsubscribe();form={};rows=[];queue=[];uncertain=null;target=null;host.innerHTML='';}
  const request=async(path,body)=>{if(!live())throw Error('계정 또는 화면이 변경됐습니다.');const r=await opt.request('/creator-manual-notes/'+path,body,owner,live);if(!live())throw Error('계정 또는 화면이 변경됐습니다.');return r;};
  function render(){if(!live())return;const locked=busy||!!uncertain,loadedIds=new Set(rows.map(n=>n.id)),correctedIds=new Set(rows.map(n=>n.supersedesId).filter(Boolean));
   const scope=!listRead?'전체 저장 목록은 아직 읽지 않았습니다.':cursor?'아직 읽지 않은 저장 페이지가 있습니다. 더 읽으면 날짜 그룹과 정정 표시가 바뀔 수 있습니다.':listComplete?'마지막 목록 조회에서 남은 저장 페이지 없음. 원문 대화 전체를 확인했다는 뜻은 아닙니다.':'전체 저장 목록 수신 미확인. 새로 읽어 확인하세요.';
   host.innerHTML='<section class="panel manual-notes"><h1>수동 확인 메모</h1><p class="notice"><strong>최신 상태 미확인</strong> · 직접 확인한 과거 내용만 기록합니다. 제공사 수신함·동기화 결과·검증된 초안이 아닙니다.</p><p>미발송 참고 초안 · 전송 전 원문 재확인 필요</p><p class="fine">저장해도 DM을 보내거나 읽음 상태를 변경하지 않습니다. 실제 전송은 Instagram에서 직접 진행하세요.</p><p role="status" data-note-status>'+esc(status)+'</p><button type="button" data-note-action="load" '+(busy?'disabled':'')+'>저장된 메모 새로 읽기</button><label class="field manual-note-order">표시 순서 <select data-note-order '+(busy?'disabled':'')+'><option value="review" '+(order==='review'?'selected':'')+'>검수 순서 · 먼저 기록한 메모부터</option><option value="source" '+(order==='source'?'selected':'')+'>원문 표시 날짜·시각별</option></select></label><p class="notice" data-note-order-scope>현재 불러온 '+rows.length+'개 메모만 '+(order==='review'?'검수 순서로 표시합니다.':'원문 표시 날짜별로 배열합니다.')+' '+esc(scope)+'</p><p class="fine">'+(order==='review'?'산지에 먼저 기록한 메모부터 보는 검수 순서이며 실제 답장 도착 순서가 아닙니다. 같은 기록 시각은 기존 목록 순서를 유지합니다. 아직 읽지 않은 페이지에 더 먼저 기록한 메모가 있을 수 있습니다. 정정 전 기록과 초안도 함께 보존합니다.':'오래된 표시 날짜부터 · 같은 날짜에서는 같은 시각 표기·시간대·정밀도끼리만 시각순 · 같은 시각은 기존 목록 순서 유지. 서로 다른 표기 그룹의 앞뒤 순서는 비교하지 않습니다. 시간대를 추정하거나 UTC로 맞추지 않으며, 실제 수신 순서·전체 기간·최신 대화를 보장하지 않습니다. 정정 전 기록과 초안도 함께 보존합니다.')+'</p><div class="manual-note-records">'+(order==='review'?reviewGroups(rows):chronologyGroups(rows)).map(g=>'<section data-note-group="'+esc(g.key)+'"><h2>'+esc(g.label)+'</h2>'+g.sections.map(s=>'<section data-note-time-basis="'+esc(s.basis)+'"><h3>'+esc(s.label)+'</h3>'+s.items.map(n=>recordMarkup(n,locked,loadedIds,correctedIds)).join('')+'</section>').join('')+'</section>').join('')+'</div>'+(cursor?'<button type="button" data-note-action="more" '+(busy?'disabled':'')+'>이전 메모 더 읽기</button>':'')+'<hr><h2>'+(correction?'정정 메모 추가 · 이전 기록 유지':'새 수동 확인 메모')+'</h2><p>기존 기록은 덮어쓰지 않습니다. 확인한 날짜와 저장 시각은 별도로 보존합니다.</p><label>검토한 JSON 파일 불러오기 <input type="file" data-note-file accept="application/json,.json" '+(locked?'disabled':'')+'></label><details><summary>JSON 입력 형식</summary><p>객체 또는 items 배열. 필드: handle, observedAt, sourceUrl, inboundWhen, summary, draft, intent, afterInboundOutbound, recorderType (user / assistant / other_authorized_worker). 날짜를 자동으로 채우지 않습니다. 불러오기만으로 저장되지 않습니다.</p></details>'+(queue.length?'<p>가져온 메모 '+queue.length+'개 남음 · 각 메모를 검토하고 개별 저장하세요.</p><button type="button" data-note-action="skip" '+(locked?'disabled':'')+'>이번 메모 건너뛰기</button>':'')+'<form data-note-form><fieldset '+(locked?'disabled':'')+'>'+Object.entries(fields).map(([k,max])=>'<label class="field">'+esc(labels[k])+(k==='recorderType'?'<select name="'+k+'">'+[['user','사용자'],['assistant','도우미'],['other_authorized_worker','권한 있는 작업자']].map(([v,l])=>'<option value="'+v+'" '+((form[k]||'user')===v?'selected':'')+'>'+l+'</option>').join('')+'</select>':['summary','draft','intent','inboundWhen','afterInboundOutbound'].includes(k)?'<textarea name="'+k+'" maxlength="'+max+'">'+esc(form[k]||'')+'</textarea>':'<input name="'+k+'" maxlength="'+max+'" value="'+esc(form[k]||'')+'" '+(k==='observedAt'?'placeholder="YYYY-MM-DD 또는 ISO 시각"':'')+'>')+'</label>').join('')+'<button type="button" data-note-action="target">동일 계정의 저장된 크리에이터 확인</button><p>'+esc(target?'연결 대상: @'+target.handle+' · '+(target.displayName||''):'대상 확인 전 · 정확한 아이디만 조회합니다.')+'</p><label><input type="checkbox" data-note-reviewed '+(checked?'checked':'')+'> 위 내용·관찰 날짜·대상을 검토했습니다. 최신 수신 내용이나 발송 완료 기록이 아님을 확인합니다.</label><button type="submit" '+(!target||!checked?'disabled':'')+'>미발송 참고 메모 저장</button><button type="button" data-note-action="reset">입력 취소</button></fieldset></form>'+(uncertain?'<p class="notice">저장 결과 확인 필요 · 같은 기록 ID와 내용을 유지합니다. 새 메모로 중복 저장하지 마세요.</p><button type="button" data-note-action="readback" '+(busy?'disabled':'')+'>같은 기록 ID로 저장 여부 확인</button><button type="button" data-note-action="retry" '+(busy?'disabled':'')+'>동일 내용으로 저장 재시도</button>':'')+'</section>';
  }
  async function run(fn){if(busy||!live())return;busy=true;render();try{await fn();}catch{if(live())status='요청을 완료하지 못했습니다. 입력은 유지됩니다. 로그인과 연결 상태를 확인하세요.';}finally{busy=false;render();}}
  async function load(more=false){const r=await request('list',more?{before:cursor}:{});if(!Array.isArray(r.items)||typeof r.complete!=='boolean')throw Error();rows=more?[...new Map([...rows,...r.items].map(n=>[n.id,n])).values()]:r.items;cursor=r.nextBefore||null;listRead=true;listComplete=r.complete&&!cursor;status='저장된 수동 확인 메모 '+rows.length+'개 읽음 · 최신 대화 상태는 미확인';}
  function accepted(note,payload){if(!sameNote(note,payload))throw Error('저장 내용 불일치');rows=[note,...rows.filter(n=>n.id!==note.id)];uncertain=null;dirty=false;target=null;correction=null;checked=false;form={};if(queue.length){queue.shift();if(queue.length){form={...queue[0]};dirty=true;}}status='메모 저장 및 내용 일치 확인 · DM 미발송';}
  async function readback(){const payload=uncertain;if(!payload)return;const r=await request('list',{noteId:payload.noteId});const note=r.items?.find(n=>n.id===payload.noteId);if(note)accepted(note,payload);else {if(!Array.isArray(r.items)||r.items.length!==0||r.complete!==true||r.nextBefore!=null)throw Error('저장 여부 확인 불가');status='아직 저장 일치를 확인하지 못했습니다. 입력과 기록 ID를 유지합니다. 필요하면 동일 내용으로 재시도하세요.';return false;}return true;}
  async function retry(){try{const found=await readback();if(found===false&&uncertain)await save(true);}catch{status='저장 여부를 읽지 못해 재저장하지 않았습니다. 입력과 기록 ID를 유지합니다.';}}
  async function save(retry=false){if(!retry){if(!target||!checked)throw Error();const value=normalize({...form,recorderType:form.recorderType||'user'});if(value.handle!==target.handle)throw Error();uncertain=Object.freeze({...value,noteId:opt.newId?opt.newId():globalThis.crypto.randomUUID(),creatorId:target.creatorId,supersedesId:correction});}const payload=uncertain;if(!payload)return;try{const r=await request('save',payload);accepted(r.note,payload);}catch{if(!live())return;status='저장 결과 확인 중 · 동일 기록 ID로 다시 읽습니다.';try{await readback();}catch{status='저장 결과 확인 필요 · 입력과 기록 ID를 유지했습니다. 다시 읽어 확인하세요.';}}}
  async function click(e){const button=e.target.closest?.('[data-note-action]');if(!button||!host.contains(button))return;const action=button.dataset.noteAction;if(busy||!live())return;if(action==='load'||action==='more')return run(()=>load(action==='more'));if(action==='readback')return run(readback);if(action==='retry')return run(retry);if(uncertain)return;if(action==='skip'&&queue.length){if((opt.confirmSkip||opt.confirmDiscard)()!==true)return;queue.shift();form=queue.length?{...queue[0]}:{};target=null;checked=false;correction=null;dirty=queue.length>0;status='이번 메모를 건너뛰었습니다 · 저장하지 않음 · 남은 가져오기 '+queue.length+'개';render();return;}if(action==='target')return run(async()=>{const handle=String(form.handle||'').replace(/^@/,'').toLowerCase().trim();if(!/^[a-z0-9._]{1,30}$/.test(handle)){status='정확한 계정 아이디를 입력하세요.';return;}const r=await request('targets',{handle});if(!uuid(r.target?.creatorId)||r.target.handle!==handle)throw Error();target=r.target;form.handle=handle;status='저장된 크리에이터를 확인했습니다. 내용 검토 후 저장하세요.';});if(action==='reset'||action==='correct'){if(dirty&&opt.confirmDiscard()!==true)return;checked=false;target=null;queue=[];if(action==='correct'){const n=rows.find(n=>n.id===button.dataset.noteId);if(!n)return;form=Object.fromEntries(Object.keys(fields).map(k=>[k,n[k]||'']));correction=n.id;dirty=true;status='정정할 내용을 수정하고 대상을 다시 확인하세요. 원래 메모는 유지됩니다.';}else{form={};correction=null;dirty=false;status='입력을 취소했습니다.';}render();}}
  function input(e){if(busy||uncertain||!live())return;const k=e.target.name;if(Object.hasOwn(fields,k)){form[k]=e.target.value;dirty=true;checked=false;if(k==='handle')target=null;const check=host.querySelector('[data-note-reviewed]');if(check)check.checked=false;const saveButton=host.querySelector('[type="submit"]');if(saveButton)saveButton.disabled=true;}}
  async function change(e){if(!live()||busy)return;if(e.target.matches('[data-note-order]')){if(['review','source'].includes(e.target.value)){order=e.target.value;render();}return;}if(uncertain)return;if(e.target.matches('[data-note-reviewed]')){checked=e.target.checked;render();return;}if(e.target.matches('[data-note-file]')){const file=e.target.files?.[0];if(!file)return;if(dirty&&opt.confirmDiscard()!==true){e.target.value='';return;}await run(async()=>{if(file.size>200000){status='JSON 파일은 200KB 이하여야 합니다.';return;}let imported;try{imported=parseImport(await file.text());}catch{if(live())status='JSON 필드·날짜·원문 링크를 확인하세요. 기존 입력은 유지됩니다.';return;}if(!live())return;queue=imported;form={...queue[0]};target=null;correction=null;checked=false;dirty=true;status='가져온 내용을 화면에서 검토한 후 한 건씩 저장하세요. 아직 저장되지 않았습니다.';});}}
  function submit(e){if(!e.target.matches('[data-note-form]'))return;e.preventDefault();e.stopPropagation();if(busy||uncertain||!live())return;try{normalize({...form,recorderType:form.recorderType||'user'});}catch(err){status=err.message;render();return;}return run(()=>save());}
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);host.addEventListener('submit',submit);unsubscribe=opt.subscribeSession(()=>{if(opt.getOwner()!==owner)destroy();})||(()=>{});render();
  return {destroy,canClose:()=>!busy&&(!dirty&&!uncertain||opt.confirmDiscard()===true),hasWork:()=>dirty||!!uncertain||busy,load:()=>run(()=>load())};
 }
 return {normalize,parseImport,sameNote,inboundChronology,chronologyGroups,reviewGroups,mount};
});
