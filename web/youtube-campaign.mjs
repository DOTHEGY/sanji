import {mountFullCampaign} from './youtube-campaign-full.mjs';
// Preparation-only UI. No send, schedule, recipient or copy payload is exposed.
const count=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const kstDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function campaignSummary(raw){
  if(raw==null)return null;
  if(typeof raw!=='object'||Array.isArray(raw)||raw.sendingEnabled!==false||raw.schedulerEnabled!==false||!/^\d{4}-\d{2}-\d{2}$/.test(raw.day||'')||!Number.isFinite(Date.parse(raw.day+'T00:00:00Z'))||new Date(raw.day+'T00:00:00Z').toISOString().slice(0,10)!==raw.day||!Number.isFinite(Date.parse(raw.preparedAt||'')))throw Error('준비 결과 형식을 확인하지 못했습니다. 상태를 새로고침하세요.');
  if(!count(raw.counts?.youtube,50)||!count(raw.counts?.instagram,10)||!count(raw.shortfall?.youtube,50)||!count(raw.shortfall?.instagram,10)||raw.counts.youtube+raw.shortfall.youtube!==50||raw.counts.instagram+raw.shortfall.instagram!==10)throw Error('준비 인원 집계를 확인하지 못했습니다. 상태를 새로고침하세요.');
  if(!count(raw.duplicateSkippedAtSave,5000)||!count(raw.heldCount,5000))throw Error('보류·중복 집계를 확인하지 못했습니다. 상태를 새로고침하세요.');
  return {day:raw.day,preparedAt:raw.preparedAt,counts:{...raw.counts},shortfall:{...raw.shortfall},duplicate:raw.duplicate===true,duplicateSkippedAtSave:raw.duplicateSkippedAtSave,heldCount:raw.heldCount};
}
const blockerLabels={
 production_activation_required:'운영 활성화 확인 필요',live_gmail_preflight_required:'발송 직전 Gmail 전체 이력 확인 필요',approved_recipient_basis_required:'수신자별 공개 업무 연락처·발송 근거 확인 필요',verified_product_attachments_required:'서명 위 본문 사진 확인 필요',verified_inline_product_images_required:'서명 위 본문 사진 확인 필요',inline_product_images_required:'서명 위 본문 사진 확인 필요',daily_discovery_adapter_required:'매일 새 후보를 찾는 검색 연결 확인 필요',private_template_required:'전달받은 고정 문안의 서버 적용 확인 필요',existing_gmail_signature_required:'기존 Gmail 서명 확인 필요',gmail_signature_required:'기존 Gmail 서명 확인 필요',template_required:'고정 문안 적용 확인 필요',dispatch_not_implemented:'발송 기능은 아직 연결되지 않았습니다.'
};
export function campaignStatus(raw){
  if(!raw||raw.state!=='preparation_only'||raw.sendingEnabled!==false||raw.schedulerEnabled!==false)throw Error('서버의 준비 전용 상태를 확인하지 못했습니다.');
  return {latest:campaignSummary(raw.latest),enabled:raw.preparationEnabled===true,blockers:[...new Set([...(Array.isArray(raw.blockers)?raw.blockers:[]),...(raw.copyStatus==='private_template_required'?['private_template_required']:[])])].map(v=>blockerLabels[v]||'추가 운영 조건 확인 필요')};
}
export function campaignError(error,prepare=false){
  const code=error?.code;
  if(code==='AUTH_REQUIRED')return '로그인 상태를 다시 확인하세요.';
  if(code==='MEMBERSHIP_REQUIRED')return '현재 계정의 Sanji 접근 권한을 확인하세요.';
  if(code==='PREPARATION_DISABLED')return '서버 연결·배포 대기: 일일 후보 준비가 아직 활성화되지 않았습니다.';
  if(code==='SOURCES_INCOMPLETE')return '후보 자료를 모두 확인하지 못해 준비를 중단했습니다. 실제 후보가 없다는 뜻은 아닙니다.';
  if(code==='HISTORY_INCOMPLETE')return '기존 발송·중복 이력을 모두 확인하지 못해 준비를 중단했습니다.';
  if(prepare)return '준비 저장 결과를 확인하지 못했습니다. 다시 누르지 말고 상태를 새로고침해 확인하세요. 이 화면은 메일을 보내지 않습니다.';
  return '서버 연결·배포 대기: 준비 상태를 불러오지 못했습니다. 후보가 없는 것으로 처리하지 않았습니다.';
}
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function mountLegacyCampaign({container,client,functionUrl,apiKey,getOwner,isCurrent,fetchImpl=fetch,onCampaign}){
  let revision=0,busy=false,enabled=false,uncertain=false,uncertainDay=null;const pending=new Set();
  const heading=el('h2','일일 제안 준비 · YouTube 50명 + 기존 Instagram 10명');
  const safety=el('p','후보와 중복 이력을 확인해 오늘의 검토 목록만 만듭니다. 메일 발송·예약·매일 자동 실행은 하지 않습니다.');safety.className='notice';
  const required=el('p','발송 전에는 고정 문안, 수신자별 업무 연락처, 기존 Gmail 서명과 서명 위에 표시할 본문 사진 2장을 확인해야 합니다.');
  const prepare=el('button','오늘의 제안 후보 준비');prepare.type='button';prepare.disabled=true;
  const refresh=el('button','준비 상태 새로고침');refresh.type='button';
  const status=el('p','로그인 후 준비 상태를 불러옵니다.');status.setAttribute('role','status');
  const conditions=el('ul'),result=el('div');
  container.replaceChildren(heading,safety,required,prepare,refresh,status,conditions,result);
  function controls(){prepare.disabled=busy||!enabled||uncertain||!getOwner();refresh.disabled=busy||!getOwner();}
  function draw(summary){result.replaceChildren();if(!summary){result.append(el('p','아직 확인된 일일 준비 기록이 없습니다.'));return;}
    result.append(el('p',`${summary.day} · 한국시간 기준 검토 목록`),el('p',`준비: YouTube ${summary.counts.youtube}/50명 · Instagram ${summary.counts.instagram}/10명`));
    result.append(el('p',`부족: YouTube ${summary.shortfall.youtube}명 · Instagram ${summary.shortfall.instagram}명 · 검토 보류 ${summary.heldCount}명 · 저장 시 중복 제외 ${summary.duplicateSkippedAtSave}명`));
    result.append(el('p','준비된 수신자는 발송 완료 인원이 아닙니다. 조건에 맞는 후보가 부족하면 부족한 수 그대로 표시합니다.'));
  }
  function current(owner,ticket){return ticket===revision&&getOwner()===owner&&isCurrent(owner);}
  async function request(path,payload,owner,ticket){
    const auth=await client.auth.getSession();if(!current(owner,ticket)){const e=Error('STALE');e.code='STALE';throw e;}if(auth.error||auth.data?.session?.user?.id!==owner){const e=Error('로그인 확인 필요');e.code='AUTH_REQUIRED';throw e;}
    const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),35000);
    try{const response=await fetchImpl(functionUrl+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+auth.data.session.access_token,apikey:apiKey,'Content-Type':'application/json'},cache:'no-store',...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:controller.signal});
      const body=await response.json();const latest=await client.auth.getSession();
      if(!current(owner,ticket)){const e=Error('STALE');e.code='STALE';throw e;}if(latest.error||latest.data?.session?.user?.id!==owner){const e=Error('로그인 상태 변경');e.code=payload===undefined?'AUTH_REQUIRED':'SAVE_UNCERTAIN';throw e;}
      if(!response.ok){const e=Error(typeof body?.error==='string'?body.error:'준비 상태 확인 실패');e.code=body?.code;e.status=response.status;throw e;}return body;
    }finally{clearTimeout(timer);pending.delete(controller);}
  }
  async function load(){
    if(busy)return;const owner=getOwner(),ticket=++revision;enabled=false;conditions.replaceChildren();result.replaceChildren();
    if(!owner){status.textContent='로그인 후 준비 상태를 불러옵니다.';controls();return;}
    busy=true;controls();status.textContent='일일 준비 상태 확인 중…';
    try{const raw=await request('/status',undefined,owner,ticket);if(!current(owner,ticket))return;if(raw?.state==='campaign'&&onCampaign){return await onCampaign(raw);}const view=campaignStatus(raw);enabled=view.enabled;if(!uncertain||(view.latest&&view.latest.day===uncertainDay)){uncertain=false;uncertainDay=null;}
      for(const label of view.blockers)conditions.append(el('li',label));draw(view.latest);
      status.textContent=uncertain?'이전 준비 요청의 저장 여부가 아직 확인되지 않았습니다. 오늘의 준비 기록이 확인될 때까지 다시 실행하지 않고 상태를 조회하세요.':enabled?'준비 전용 연결 확인됨 · 자동 발송과 예약은 꺼져 있습니다.':'서버 연결·배포 대기: 일일 후보 준비는 아직 활성화되지 않았습니다.';
    }catch(e){if(current(owner,ticket)&&e.code!=='STALE')status.textContent=campaignError(e);}
    finally{if(current(owner,ticket)){busy=false;controls();}}
  }
  prepare.addEventListener('click',async()=>{
    if(busy||!enabled||uncertain)return;const owner=getOwner(),ticket=revision;if(!owner||!isCurrent(owner))return;busy=true;const requestDay=kstDay();controls();status.textContent='후보·연락처 출처·기존 이력을 확인해 검토 목록 준비 중…';
    try{const summary=campaignSummary(await request('/prepare',{},owner,ticket));if(!current(owner,ticket))return;if(!summary)throw Error('준비 결과 미확인');draw(summary);status.textContent=summary.duplicate?'오늘 준비한 목록이 이미 있어 다시 불러왔습니다. 중복 생성이나 메일 발송은 하지 않았습니다.':'오늘의 검토 목록을 준비했습니다. 메일 발송·예약은 하지 않았습니다.';}
    catch(e){if(current(owner,ticket)&&e.code!=='STALE'){uncertain=!['PREPARATION_DISABLED','SOURCES_INCOMPLETE','HISTORY_INCOMPLETE','AUTH_REQUIRED','MEMBERSHIP_REQUIRED'].includes(e.code);if(uncertain)uncertainDay=requestDay;if(['PREPARATION_DISABLED','AUTH_REQUIRED','MEMBERSHIP_REQUIRED'].includes(e.code))enabled=false;if(e.code==='AUTH_REQUIRED')result.replaceChildren();status.textContent=campaignError(e,true);}}
    finally{if(current(owner,ticket)){busy=false;controls();}}
  });
  refresh.addEventListener('click',load);
  return {load,clear(){revision++;for(const c of pending)c.abort();pending.clear();busy=false;enabled=false;uncertain=false;uncertainDay=null;conditions.replaceChildren();result.replaceChildren();status.textContent='로그인 후 준비 상태를 불러옵니다.';controls();}};
}

// Preserve the preparation-only deployment while upgrading after an explicit server contract.
export function mountYoutubeCampaign(options){
 let controller;
 const legacy=()=>mountLegacyCampaign({...options,onCampaign:async raw=>{controller.clear();controller=mountFullCampaign({...options,initialStatus:raw});await controller.load();}});
 controller=legacy();
 return {load:()=>controller.load(),clear(){controller.clear();controller=legacy();}};
}
