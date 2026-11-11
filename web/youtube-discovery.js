import { fullConfiguration } from './youtube-campaign-full.mjs';
import { previewEnvelope, privatePreviewDocument, previewWarning } from './youtube-email-view.mjs';
import { mountYoutubeSaved } from './youtube-saved.mjs';
import { createClient } from '@supabase/supabase-js';
import { reviewReasons, orderCandidates } from '../supabase/functions/youtube-discovery/review-filters.mjs';
import { buildBriefReview } from '../supabase/functions/youtube-discovery/relevance.mjs';
import { supabaseUrl, supabaseKey } from './supabase-config.js';

// Default Supabase session key matches the main workspace; no new authentication flow.
const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } });
const $ = (id) => document.getElementById(id);
let owner = null, epoch = 0, searchBusy = false, selectedEmail = '', selectedChannelId = '', disposed = false;
const pending = new Set();
let resultCards = [];
let queryOrigin = 'empty';
let submittedBrief = null;
const saved = mountYoutubeSaved({container:$('saved-youtube'),client,getOwner:()=>owner,isCurrent:candidateOwner=>!disposed&&owner===candidateOwner,onChange:()=>updateFolds(),onPreview:key=>campaign.previewRecipient(key),onReview:(rows,runAt,scope)=>campaign.previewBatch(rows,runAt,scope),onSelectionChange:()=>campaign.clear()});
let previewEpoch=0,previewController=null,sendInFlight=false;
const campaign={async load(offset=0){
 const account=owner,ticket=++previewEpoch,host=$('daily-outreach');if(!account||disposed)return;
 const current=()=>!disposed&&owner===account&&ticket===previewEpoch;
 try{const session=await client.auth.getSession();if(!current()||session?.data?.session?.user?.id!==account||!session.data.session.access_token)return;const response=await fetch(supabaseUrl+'/functions/v1/youtube-manual-mail/recent',{method:'POST',headers:{Authorization:'Bearer '+session.data.session.access_token,apikey:supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({offset}),cache:'no-store'});if(!response.ok)return;const data=await response.json();if(!current()||!Array.isArray(data.rows))return;
  const panel=el('div'),title=el('h3','최근 이메일 발송 상태'),refresh=el('button','발송 상태 새로고침');refresh.type='button';refresh.addEventListener('click',()=>campaign.load(offset));panel.append(title,refresh);if(offset>0){const latest=el('button','최신 발송 기록');latest.type='button';latest.addEventListener('click',()=>campaign.load(0));panel.append(latest);}if(data.more){const older=el('button','이전 발송 기록');older.type='button';older.addEventListener('click',()=>campaign.load(offset+10));panel.append(older);}const labels={reserved:'발송 대기',accepted:'Gmail 수락',held:'보류',cancelled:'대기 취소',outcome_unknown:'결과 미확인'};let count=0;for(const batch of data.rows){if(!Array.isArray(batch.rows))continue;if(batch.schedule&&Number.isFinite(Date.parse(batch.schedule.runAt))&&['scheduled','processing','complete','held','outcome_unknown','cancelled'].includes(batch.schedule.state)){const when=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'}).format(new Date(batch.schedule.runAt)),states={scheduled:'예약 대기',processing:'처리 중 · 오래 지속되면 자동 재개되지 않을 수 있음',complete:'처리 완료',held:'보류 · 남은 건은 자동 재개되지 않음',outcome_unknown:'결과 미확인 · 남은 건은 자동 재개되지 않음',cancelled:'취소'};panel.append(el('p',when+' · '+states[batch.schedule.state]));}else panel.append(el('p','예약 시각 확인 필요'));for(const row of batch.rows){if(typeof row.email!=='string'||typeof row.status!=='string')continue;const blockedWaiting=row.status==='reserved'&&(!batch.schedule||['processing','held','outcome_unknown'].includes(batch.schedule.state));const line=el('p',row.email+' · '+(blockedWaiting?'대기 · 작업 상태 확인 필요':labels[row.status]||'상태 확인 필요')); if(row.status==='outcome_unknown'&&typeof row.searchUrl==='string'){try{const u=new URL(row.searchUrl);if(u.protocol==='https:'&&u.hostname==='mail.google.com'&&u.pathname==='/mail/'&&u.hash.startsWith('#search/')){line.append(document.createTextNode(' · '),link('Gmail에서 메시지 ID 검색',u.href));}}catch{}}panel.append(line);count++;}if(typeof batch.batchId==='string'&&batch.rows.some(r=>['reserved','held'].includes(r.status))){const cancel=el('button','이 묶음의 대기·보류 취소');cancel.type='button';cancel.addEventListener('click',async()=>{if(!current()||!window.confirm('대기·보류 중인 건을 취소합니다. 이미 처리 중이거나 Gmail에 전달된 메일은 취소되지 않을 수 있습니다. 계속할까요?'))return;cancel.disabled=true;try{const r=await fetch(supabaseUrl+'/functions/v1/youtube-manual-mail/cancel',{method:'POST',headers:{Authorization:'Bearer '+session.data.session.access_token,apikey:supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({batchId:batch.batchId}),cache:'no-store'});if(!r.ok)throw Error('cancel');if(current())campaign.load(offset);}catch{if(current())panel.append(el('p','취소 결과를 확인하지 못했습니다. 상태를 새로고침하세요.'));}});panel.append(cancel);}}if(!count)panel.append(el('p',offset?'이 페이지에 표시할 발송 기록이 없습니다.':'확인할 발송 기록이 없습니다.'));if(data.more)panel.append(el('p','이전 발송 기록을 더 볼 수 있습니다.'));panel.append(el('p','결과 미확인 건은 다시 보내지 말고 원본 Gmail과 상태를 확인하세요.'));host.replaceChildren(panel);
 }catch{if(current())host.textContent='이메일 발송 상태를 불러오지 못했습니다.';}
},clear(){previewEpoch++;previewController?.abort();previewController=null;$('daily-outreach').textContent=sendInFlight?'발송 요청 결과를 확인하지 못했습니다. 상태 확인 전 다시 보내지 마세요.':'선택한 대상을 확인한 뒤 이메일 문안을 검토할 수 있습니다.';},async previewBatch(recipients,expectedRunAt,scope){
 if(!owner||disposed||!Array.isArray(recipients)||!recipients.length||recipients.length>100||!scope||!Number.isFinite(Date.parse(expectedRunAt)))return;
 previewController?.abort();const controller=new AbortController(),ticket=++previewEpoch,account=owner,host=$('daily-outreach');previewController=controller;host.replaceChildren(el('p','선택 대상과 승인 문안 확인 중…'));host.scrollIntoView?.({behavior:'smooth',block:'start'});
 const current=()=>!disposed&&owner===account&&ticket===previewEpoch;let batchCall;
 try{const session=await client.auth.getSession();if(!current()||session?.data?.session?.user?.id!==account||!session.data.session.access_token)throw Error('session');const headers={Authorization:'Bearer '+session.data.session.access_token,apikey:supabaseKey,'Content-Type':'application/json'};
  const call=async(service,path,body)=>{const response=await fetch(supabaseUrl+'/functions/v1/'+service+path,{method:body?'POST':'GET',headers,cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});if(!response.ok){let problem={};try{problem=await response.json();}catch{}const e=new Error('request');e.code=problem.code;e.candidateId=problem.candidateId;throw e;}return response.json();};batchCall=call;
  const config=fullConfiguration(await call('creator-daily-outreach','/configuration'));if(!current()||!config.snapshotId)throw Error('config');
  const result=await call('youtube-manual-mail','/preview',{expectedRevision:config.revision,recipients,scope});if(!current())return;
  if(typeof result.batchId!=='string'||!/^[a-f0-9]{64}$/.test(result.approvalHash||'')||result.sendingEnabled!==false||!Array.isArray(result.previews)||result.previews.length!==recipients.length||new Set(result.previews.map(p=>p.id)).size!==recipients.length||result.previews.some(p=>!recipients.some(r=>r.id===p.id&&r.email===p.recipient)||typeof p.channelName!=='string'||!p.channelName.trim()||p.channelName.length>200||typeof p.profileUrl!=='string'||typeof p.sourceUrl!=='string'||typeof p.sourceCheckedAt!=='string'||!Array.isArray(p.sources)||!p.sources.length||p.sources.length>5||p.sources.some(s=>!s||typeof s.url!=='string'||typeof s.checkedAt!=='string')||!Number.isSafeInteger(p.audience)||typeof p.metricsSource!=='string'||typeof p.metricsCheckedAt!=='string'||typeof p.activitySource!=='string'||typeof p.activityCheckedAt!=='string'||typeof p.mukbangReason!=='string'||typeof p.subject!=='string'||!p.subject.trim()||p.subject.length>300||/[\r\n]/.test(p.subject)||typeof p.html!=='string'||p.html.length>15*1024*1024))throw Error('preview mismatch');
  if(!Array.isArray(result.sharedImages)||result.sharedImages.length!==2)throw Error('preview images');const imageUrls=[];let imageBytes=0;for(const image of result.sharedImages){if(!image||typeof image.content!=='string'||image.content.length>8*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content)||!/^[a-f0-9]{64}$/.test(image.sha256||'')||!Number.isSafeInteger(image.bytes)||image.bytes<1)throw Error('preview image');const binary=atob(image.content),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));imageBytes+=bytes.length;if(bytes.length!==image.bytes||imageBytes>10*1024*1024)throw Error('preview image');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==image.sha256||!current())throw Error('preview image');imageUrls.push('data:image/png;base64,'+image.content);}
  const heading=el('h3',`선택 대상 ${recipients.length}명 · 문안 확인`),note=el('p','각 채널의 공개 주소와 구독자·활동 근거, 문안을 직접 확인해 주세요. 공개 주소는 소속·수신 가능 여부나 협업 동의가 확인된 주소가 아닙니다. Gmail 수락은 실제 전달 완료를 뜻하지 않습니다.'),checks=el('div');
  for(const item of result.previews){const block=el('details'),summary=el('summary',item.channelName+' · '+item.recipient),frame=el('iframe');frame.title=item.channelName+' 이메일 문안';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');let html=item.html;for(let i=0;i<2;i++){const marker='src="sanji-preview:'+i+'"';if(html.split(marker).length!==2)throw Error('preview image mismatch');html=html.replace(marker,'src="'+imageUrls[i]+'"');}block.addEventListener('toggle',()=>{if(block.open&&!frame.srcdoc)frame.srcdoc=privatePreviewDocument(html);});block.append(summary,el('p',`공개 구독자 ${item.audience.toLocaleString('ko-KR')}명 · 구독자 확인 기록 ${item.metricsCheckedAt} · 활동 확인 기록 ${item.activityCheckedAt}`),link('YouTube 채널 원문',item.profileUrl),document.createTextNode(' · '),...item.sources.flatMap((source,index)=>[link(`공개 이메일 출처 ${index+1}`,source.url),document.createTextNode(` (기록 ${source.checkedAt}) · `)]),link('구독자 출처',item.metricsSource),document.createTextNode(' · '),link('활동 출처',item.activitySource),el('p',item.mukbangReason),el('p',item.subject),frame);checks.append(block);}
  const label=el('label'),checkbox=document.createElement('input');checkbox.type='checkbox';label.append(checkbox,document.createTextNode(' 선택 대상의 공개 출처와 이메일 문안을 모두 확인했습니다.'));const send=el('button','확인 후 내일 오전 10시 예약');send.type='button';send.disabled=true;checkbox.addEventListener('change',()=>{send.disabled=!checkbox.checked;});const scheduledLabel=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'}).format(new Date(expectedRunAt));const state=el('p','예정 시각: '+scheduledLabel+' · 아직 예약하지 않았습니다.');state.setAttribute('role','status');host.replaceChildren(heading,note,el('p',result.warning||''),checks,label,send,state);
  send.addEventListener('click',async()=>{if(!checkbox.checked||!current()||send.disabled)return;send.disabled=true;checkbox.disabled=true;sendInFlight=true;const body={batchId:result.batchId,approvalHash:result.approvalHash};try{await call('youtube-manual-mail','/confirm',body);if(!current())return;const result=await call('youtube-manual-mail','/schedule',{...body,expectedRunAt});if(!current())return;if(result.state!=='scheduled'||Date.parse(result.runAt)!==Date.parse(expectedRunAt)||!Array.isArray(result.rows)||result.rows.length!==recipients.length)throw Error('schedule mismatch');state.textContent=`${scheduledLabel} 예약 ${result.rows.length}건 · 발송 결과는 예약 상태에서 확인하세요.`;}catch(error){if(current())state.textContent=['SCHEDULER_UNAVAILABLE','SENDING_DISABLED'].includes(error?.code)?'자동 실행이 준비되지 않아 예약되지 않았습니다.':'예약 결과를 확인하지 못했습니다. 상태를 확인하기 전 다시 누르지 마세요.';}finally{sendInFlight=false;}});
 }catch(error){if(current()){
  const selected=recipients.find(r=>r.id===error?.candidateId);if(error?.code==='GMAIL_REFUSAL_REVIEW_REQUIRED'&&selected&&batchCall){
   const intro=el('p','이전 Gmail 대화나 조회 오류가 있어 수신거부 여부를 확인해야 합니다. 이전 연락 자체는 중복으로 처리하지 않습니다.'),open=el('button','이전 Gmail 원본 확인'),remove=el('button','이 대상 제외하고 다시 검토');open.type='button';remove.type='button';remove.addEventListener('click',()=>{saved.excludeRecipient(selected.id);const remaining=saved.getSelectedRecipients();if(remaining.length)campaign.previewBatch(remaining,expectedRunAt,scope);});const area=el('div');host.replaceChildren(intro,open,remove,area);
   open.addEventListener('click',async()=>{open.disabled=true;try{const review=await batchCall('youtube-manual-mail','/gmail-review-prepare',selected);if(!current())return;if(!review||!/^[a-f0-9]{64}$/.test(review.fingerprint||'')||!Array.isArray(review.links)||!Number.isInteger(review.count)||review.count<1||review.count>100||review.links.length!==review.count)throw Error('review');area.replaceChildren(el('p',`${selected.email} · Gmail 원본 ${review.count}건을 모두 확인하세요.`));for(const [i,url] of review.links.entries()){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='mail.google.com'||u.pathname!=='/mail/'||!/^#all\/[A-Za-z0-9_-]+$/.test(u.hash))throw Error('link');const a=el('a',`Gmail 원본 ${i+1} 열기`);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';area.append(a,document.createTextNode(' '));}const label=el('label'),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode(' 원본을 모두 확인했으며 수신거부나 명시적 거절이 없습니다.'));const save=el('button','확인 기록 후 문안 보기');save.type='button';save.disabled=true;check.addEventListener('change',()=>save.disabled=!check.checked);area.append(label,save);save.addEventListener('click',async()=>{if(!check.checked||!current()||save.disabled)return;save.disabled=true;try{await batchCall('youtube-manual-mail','/gmail-review-confirm',{...selected,fingerprint:review.fingerprint,acknowledged:true});if(current())campaign.previewBatch(recipients,expectedRunAt,scope);}catch{if(current())area.append(el('p','확인 기록을 저장하지 못했거나 Gmail 대화가 변경됐습니다. 원본을 다시 확인하세요.'));}});}catch{if(current())area.replaceChildren(el('p','Gmail 원본을 완전히 확인하지 못했습니다. 이 대상은 발송을 보류합니다.'));}finally{if(current())open.disabled=false;}});
  }else if(error?.code==='MESSAGE_CLASSIFICATION_REVIEW_REQUIRED')host.replaceChildren(el('p','현재 이메일 유형과 발송 근거가 검토 대기입니다. 확인된 설정을 준비한 뒤 다시 시도하세요. 이메일은 발송하지 않았습니다.'));
  else if(selected&&['RECIPIENT_REVIEW_REQUIRED','PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED','AUDIENCE_SOURCE_REVIEW_REQUIRED','TOPIC_SOURCE_REVIEW_REQUIRED','ACTIVITY_SOURCE_REVIEW_REQUIRED','IDENTITY_AMBIGUOUS','HISTORY_ORIGIN_UNVERIFIED','WORK_ALREADY_SENT_OR_PENDING','RECIPIENT_BLOCKED'].includes(error?.code)){
   const labels={RECIPIENT_REVIEW_REQUIRED:'대상 채널 확인 필요',PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED:'공개 이메일 출처 확인 필요',AUDIENCE_SOURCE_REVIEW_REQUIRED:'구독자 규모와 출처 확인 필요',TOPIC_SOURCE_REVIEW_REQUIRED:'먹방 주제 근거 확인 필요',ACTIVITY_SOURCE_REVIEW_REQUIRED:'최근 활동 근거 확인 필요',IDENTITY_AMBIGUOUS:'중복 채널 또는 공유 이메일 확인 필요',HISTORY_ORIGIN_UNVERIFIED:'최근 발송 기록의 작업 출처 확인 필요',WORK_ALREADY_SENT_OR_PENDING:'이 작업의 발송 또는 대기 기록 있음',RECIPIENT_BLOCKED:'수신거부·거절 또는 이력 확인 필요'},remove=el('button','이 대상 제외하고 다시 검토');remove.type='button';host.replaceChildren(el('p',selected.email+' · '+labels[error.code]+' · 이메일은 발송하지 않았습니다.'),remove);remove.addEventListener('click',()=>{saved.excludeRecipient(selected.id);const remaining=saved.getSelectedRecipients();if(remaining.length)campaign.previewBatch(remaining,expectedRunAt,scope);});
  }else host.replaceChildren(el('p','선택 대상의 문안이나 이력을 확인하지 못했습니다. 공개 주소와 이전 Gmail 내역은 확인이 필요할 수 있습니다. 이메일은 발송하지 않았습니다.'));
 }}
},async previewRecipient(creatorKey){
 if(!/^youtube:UC[A-Za-z0-9_-]{22}$/.test(creatorKey)||!owner||disposed)return;
 previewController?.abort();const controller=new AbortController(),ticket=++previewEpoch,account=owner,host=$('daily-outreach');previewController=controller;host.replaceChildren(el('p','개별 이메일 카피 확인 중…'));host.scrollIntoView?.({behavior:'smooth',block:'start'});
 const current=()=>!disposed&&owner===account&&ticket===previewEpoch;
 try{const session=await client.auth.getSession();if(!current()||session?.data?.session?.user?.id!==account||!session.data.session.access_token)throw Error('session');const headers={Authorization:'Bearer '+session.data.session.access_token,apikey:supabaseKey,'Content-Type':'application/json'};const call=async(path,body)=>{const response=await fetch(supabaseUrl+'/functions/v1/creator-daily-outreach'+path,{method:body?'POST':'GET',headers,cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('request');return response.json()};const config=fullConfiguration(await call('/configuration'));if(!current())return;if(!config.snapshotId)throw Error('config');const raw=await call('/preview',{creatorKey,expectedRevision:config.revision});if(!current())return;const result=previewEnvelope(raw,{creatorKey,snapshotId:config.snapshotId,policyRevision:config.revision});const heading=el('h3',result.channelName+' 이메일 카피'),meta=el('p','수신 주소: '+(result.recipient||'미확인')+' · 미리보기 전용'),frame=el('iframe');frame.title=result.channelName+' 이메일 카피';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.srcdoc=privatePreviewDocument(result.html);host.replaceChildren(heading,meta,el('h4',result.subject),frame,...[...new Set([...result.warnings,'preview_is_not_send_authorization'])].map(w=>el('p',previewWarning(w))));
 }catch{if(current())host.replaceChildren(el('p','개별 카피를 확인하지 못했습니다. 설정과 로그인 상태를 확인하세요. 이메일은 발송하지 않았습니다.'));}finally{if(previewController===controller)previewController=null;}
}};

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function link(text, value) {
  const node = el('a', text);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return el('span', text);
    node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer';
  } catch { return el('span', text); }
  return node;
}
function clearDraft() {
  selectedEmail = ''; selectedChannelId = ''; $('subject').value = ''; $('body').value = '';
  $('recipient').textContent = ''; $('draft').hidden = true;
  $('confirm').checked = false; $('open-mail').disabled = true;
  $('mail-status').textContent = '발송된 메일은 없습니다. 이 화면은 자동 발송하지 않습니다.';
}
function clearPrivate() {
  saved.clear(); campaign.clear();
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  $('results').replaceChildren(); $('kept-results').replaceChildren(); $('excluded-results').replaceChildren(); $('status').textContent = ''; $('brief').value = ''; $('queries').value = ''; queryOrigin = 'empty'; $('query-origin').textContent = '';
  $('minimum-subscribers').value='30000';$('maximum-subscribers').value='200000';$('minimum-views').value='0';$('result-order').value='source';
  submittedBrief = null; $('results-purpose').replaceChildren(); $('previous-results-note').textContent = '';
  resultCards = []; $('brief-plan').replaceChildren(); $('result-criteria').replaceChildren(); $('fold-mukbang').checked = true; $('fold-news').checked = true; $('fold-business').checked = false; updateFolds();
  clearDraft(); searchBusy = false; $('search').disabled = false;
}
function sessionChanged(session) {
  const next = session?.user?.id || null;
  if (next !== owner) { clearPrivate(); owner = next; if(owner&&!disposed){saved.load();campaign.load();} }
  $('workspace').hidden = !owner || disposed;
  const login = el('a', '기존 워크스페이스에서 로그인하세요'); login.href = '../';
  $('auth-state').replaceChildren(owner ? el('span', '워크스페이스 계정 연결됨') : login);
}
function active(ticket) { return !disposed && owner === ticket.owner && epoch === ticket.epoch; }
async function api(path, payload, ticket) {
  const { data, error } = await client.auth.getSession();
  if (!active(ticket)) throw new Error('STALE');
  if (error || !data.session || data.session.user.id !== ticket.owner) {
    sessionChanged(null); throw new Error('STALE');
  }
  const controller = new AbortController(); pending.add(controller);
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/youtube-discovery${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: controller.signal,
    });
    const result = await response.json();
    if (!active(ticket)) throw new Error('STALE');
    if (!response.ok) {
      if (response.status === 401) { sessionChanged(null); throw new Error('STALE'); }
      throw new Error(response.status === 403 ? '워크스페이스 접근 권한이 필요합니다.' : result.error?.message || result.message || (typeof result.error === 'string' && result.error) || `요청 실패 (${response.status})`);
    }
    return result;
  } finally { clearTimeout(timeout); pending.delete(controller); }
}
function errorText(error) {
  return error.name === 'AbortError' ? '요청 시간이 초과되었습니다. 다시 시도해 주세요.' : error.message;
}
function warnings(container, values) {
  if (Array.isArray(values)) for (const value of values) container.append(el('p', value, 'notice'));
}
function showCriteria(container, criteria) {
  container.replaceChildren(); if (!criteria) return;
  container.append(el('h3', '검색 조건과 확인이 필요한 항목'));
  container.append(el('p','공식 API 요청: 검색 최대 4회(페이지당 50개 영상), 중복 제거 후 최대 100개 채널·최근 업로드 조회 최대 112회. 검색은 별도 검색 한도, 조회는 일반 할당량을 사용합니다. 호출 횟수는 금전 비용이나 프로젝트 잔여량이 아닙니다. 자동 재시도하지 않습니다.','muted'));
  if(criteria.discoveryIntent){const intent=criteria.discoveryIntent;container.append(el('p', `우선 탐색 분야: ${intent.primaryCategory} · ${intent.secondaryCategories.join(' · ')} / 상품: ${intent.productTerms.join(' · ') || '요청 참조'} / 부가 특성: ${intent.modifiers.join(' · ') || '없음'}`),el('p',intent.explanation));}
  container.append(el('p', `검색 주제: ${(criteria.topicTerms || []).map(term => term.label).join(' · ') || '자동 분류하지 못함'}`));
  container.append(el('p', `검색어: ${(criteria.queries || []).join(' / ') || '직접 입력해 주세요'}`));
  if (criteria.requiresQueryReview || !criteria.queries?.length) container.append(el('p', '검색어 확인이 필요합니다. 조건을 자동 확정하지 않았으므로 검색어를 직접 입력하거나 요청을 명확하게 수정해 주세요.', 'notice'));
  if (criteria.excludedTerms?.length) container.append(el('p', `검색어에서 제외한 표현: ${criteria.excludedTerms.join(' · ')} (후보 자동 탈락 아님)`));
  warnings(container, criteria.unresolvedRequirements); warnings(container, criteria.notes);
}
function updateFolds() {
  const folded = [];
  for (const { card, channel, savedNotice } of resultCards) {
    if(savedNotice)savedNotice.textContent=saved.hasChannelId(channel.channelId)?'이미 산지에 저장됨 · 기존 기록을 덮어쓰지 않습니다.':'';
    const reasons = (channel.contentFlags || []).filter(flag => (flag.kind === 'news_language' && $('fold-news').checked) || (flag.kind === 'business_language' && $('fold-business').checked));
    if($('fold-mukbang').checked&&channel.mukbangReview) { for(const label of channel.mukbangReview.reasons)reasons.push({label}); if(!channel.discoveryTarget&&!channel.mukbangReview.reasons.length)reasons.push({label:'추가 조사 후보 · 검증 이메일 아님'}); }
    const thresholdReasons = reviewReasons(channel,{minimumSubscribers:Number($('minimum-subscribers').value)||0,minimumViews:Number($('minimum-views').value)||0});
    for(const label of thresholdReasons)reasons.push({label});
    const maximum=Number($('maximum-subscribers').value)||0;if(maximum&&(channel.subscriberCount==null||channel.subscriberCount>maximum))reasons.push({label:channel.subscriberCount==null?'구독자 수 미확인':'현재 구독자 상한 20만 초과 · 조사 기록으로 보존'});
    card.hidden = reasons.length > 0;
    if (card.hidden) folded.push(`${channel.title}: ${reasons.map(flag => flag.label).join(' · ')}`);
  }
  for(const row of orderCandidates(resultCards,$('result-order').value))$(row.reviewState==='kept'?'kept-results':row.reviewState==='excluded'?'excluded-results':'results').append(row.card);
  $('review-summary').textContent=`내 검토 상태: 확인 전 ${resultCards.filter(r=>r.reviewState==='pending').length} · 직접 확인 후 남김 ${resultCards.filter(r=>r.reviewState==='kept').length} · 직접 제외 ${resultCards.filter(r=>r.reviewState==='excluded').length}`;
  $('fold-summary').textContent = `표시 필터: ${resultCards.length - folded.length}개 통과 · ${folded.length}개 접힘 (내 검토 상태별 목록)`;
  $('fold-reasons').replaceChildren(...folded.map(reason => el('p', reason)));
  $('show-all').hidden = folded.length === 0;
  $('fold-empty').hidden = resultCards.length === 0 || folded.length !== resultCards.length;
}
function updateQueryNotice() {
  $('query-origin').textContent = queryOrigin === 'manual' ? '직접 입력·수정한 검색어를 우선 사용합니다. 요청을 바꾸어도 유지되므로 새 요청과 맞는지 확인하세요.' : queryOrigin === 'generated' ? '현재 요청으로 만든 검색어 제안입니다. 요청을 바꾸면 이 제안은 지워집니다.' : '';
}
function updatePreviousResultsNotice() {
  $('previous-results-note').textContent = submittedBrief !== null && $('brief').value.trim() !== submittedBrief ? '요청이 변경되었습니다. 아래 결과와 여기서 만드는 초안은 이전 검색의 협업 목적을 기준으로 합니다. 새 목적을 반영하려면 다시 검색하세요.' : '';
}
function briefChanged() {
  updatePreviousResultsNotice();
  $('brief-plan').replaceChildren();
  if (queryOrigin === 'generated') { $('queries').value = ''; queryOrigin = 'empty'; }
  updateQueryNotice();
}
$('preview-queries').addEventListener('click', () => {
  const plan = buildBriefReview($('brief').value);
  if (queryOrigin !== 'manual') {
    $('queries').value = (plan.queries || []).join('\n');
    queryOrigin = $('queries').value ? 'generated' : 'empty';
  }
  updateQueryNotice(); showCriteria($('brief-plan'), plan);
});
$('brief').addEventListener('input', briefChanged);
$('queries').addEventListener('input', () => { queryOrigin = $('queries').value.trim() ? 'manual' : 'empty'; $('brief-plan').replaceChildren(); updateQueryNotice(); });
$('use-30k').addEventListener('click',()=>{$('minimum-subscribers').value='30000';$('maximum-subscribers').value='200000';updateFolds();});
for (const id of ['minimum-subscribers','maximum-subscribers','minimum-views','result-order','fold-news', 'fold-business', 'fold-mukbang']) $(id).addEventListener('change', updateFolds);
$('show-all').addEventListener('click', () => { $('minimum-subscribers').value='0';$('maximum-subscribers').value='0';$('minimum-views').value='0'; $('fold-mukbang').checked = false; $('fold-news').checked = false; $('fold-business').checked = false; updateFolds(); });
function selectedCandidateExcluded(){return resultCards.some(row=>row.channel.channelId===selectedChannelId&&row.reviewState==='excluded');}
function selectContact(contact, channel, brief) {
  if(resultCards.some(row=>row.channel.channelId===channel.channelId&&row.reviewState==='excluded'))return;
  selectedChannelId=channel.channelId;
  selectedEmail = contact.email;
  $('recipient').replaceChildren(document.createTextNode(`수신자: ${selectedEmail} · ${channel.title} · `), link('직접 확인한 연락처 출처', contact.sourceUrl), el('span', ` · 공개 용도·확인 메모: ${contact.context}`));
  $('subject').value = `[협업 제안] ${channel.title}님께`;
  $('body').value = `안녕하세요, ${channel.title}님.\n\n${channel.videos?.[0]?.title ? `공개된 「${channel.videos[0].title}」 영상과 관련해 협업 가능성을 문의드립니다.` : '협업 가능성을 문의드립니다.'}\n\n${brief}\n\n관심 있으시면 협업 조건을 함께 논의하고 싶습니다.\n\n감사합니다.\n[담당자 이름 / 브랜드 / 연락처]`;
  $('confirm').checked = false; $('open-mail').disabled = true; $('draft').hidden = false;
  $('mail-status').textContent = '발송된 메일은 없습니다. 수신자와 초안 내용을 검토해 주세요.';
  $('draft').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderChannel(channel, ticket) {
  const card = el('article', undefined, 'card');
  const title = el('h2'); title.append(link(channel.title, channel.url)); card.append(title);
  const savedNotice=el('p',saved.hasChannelId(channel.channelId)?'이미 산지에 저장됨 · 기존 기록을 덮어쓰지 않습니다.':'','notice');card.append(savedNotice);
  const reviewRow={card,channel,savedNotice,reviewState:'pending'};
  const reviewSelect=el('select');reviewSelect.setAttribute('aria-label',`내 검토 상태: ${channel.title}`);
  for(const [value,label] of [['pending','영상 확인 전'],['kept','사람 중심 영상 직접 확인 · 후보로 남김'],['excluded','직접 검토 제외']]){const option=el('option',label);option.value=value;reviewSelect.append(option);}
  reviewSelect.addEventListener('change',()=>{if(!active(ticket))return;reviewRow.reviewState=reviewSelect.value;choose.disabled=!valid();if(selectedChannelId===channel.channelId){invalidateConfirmation();$('mail-status').textContent=reviewRow.reviewState==='excluded'?'직접 제외한 후보입니다. 초안 내용은 보존했지만 메일 앱 열기는 차단했습니다. 후보 상태를 복원한 뒤 수신자를 다시 확인하세요.':'후보 상태가 변경되었습니다. 수신자와 초안을 다시 확인하세요.';}updateFolds();});
  card.append(el('p','내 검토 상태 (사용자 입력, YouTube 데이터·자동 판정 아님)'),reviewSelect);
  card.append(el('p', `이 결과의 협업 목적: ${ticket.brief}`, 'result-purpose'));
  if(channel.mukbangReview){card.append(el('p',channel.discoveryTarget?'조사 후보 · 공개 수치·먹방 표현 확인 (영상 직접 검토 전)':'추가 확인 필요','notice'));warnings(card,channel.mukbangReview.reasons);card.append(el('p',channel.mukbangReview.note));}
  const focus=channel.fieldEvidence;
  if(focus?.fields?.length){
    const section=el('section',undefined,'field-evidence');section.append(el('h3',`최근 제목에서 탐색 표현 찾기: ${focus.fields.join(' · ')}`),el('p',focus.note));
    section.append(el('p',`표시된 자기소개 일부에서 찾은 표현: ${focus.description.matches.map(m=>m.field+' ('+m.matchedTerms.join(', ')+')').join(' · ')||'미확인'}`));
    if(focus.description.matches.length)section.append(el('p',focus.description.text,'evidence'),link('채널 원문',focus.description.url));
    for(const match of focus.description.matches)if(match.contextWarning)section.append(el('p',match.contextWarning,'notice'));
    if(!focus.uploads.length)section.append(el('p','최근 업로드 원문 미확인. 제목 원문을 확인할 자료가 부족합니다.'));
    for(const video of focus.uploads){const row=el('p');row.append(link(video.title,video.url),document.createTextNode(` · ${video.publishedAt||'게시일 미확인'} · 찾은 표현: ${video.matches.map(m=>m.field+' ('+m.matchedTerms.join(', ')+')').join(' · ')||'미확인'}`));section.append(row);for(const match of video.matches)if(match.contextWarning)section.append(el('p',match.contextWarning,'notice'));}
    card.append(section);
  }
  card.append(el('p', `공개 구독자: ${channel.subscriberCount == null ? '비공개·미확인' : channel.subscriberCount.toLocaleString('ko-KR') + '명 (YouTube 공개 표시 수치, 세 자리 유효숫자로 내림)'}`));
  const recent=el('section');recent.append(el('h3','최근 업로드 최대 5개 · YouTube 공개 조회수'));
  recent.append(el('p','검색어와 무관하게 최신 업로드 목록에서 확인합니다. Shorts·일반 영상·라이브가 섞일 수 있으며 기간이 다른 누적 조회수입니다. 평균·참여율·종합 점수로 환산하지 않습니다.'));
  if(!channel.recentVideos?.length)recent.append(el('p','최근 업로드 지표 미확인'));
  for(const video of channel.recentVideos||[]){const row=el('p');row.append(link(video.title,video.url),document.createTextNode(` · ${video.publishedAt||'게시일 미확인'} · 조회 ${video.viewCount==null?'미확인':video.viewCount.toLocaleString('ko-KR')} · 길이 ${video.duration||'미확인'}`));recent.append(row);}
  card.append(recent);
  card.append(el('p', channel.description || '', 'muted'));
  card.append(el('p', `이 후보를 가져온 검색어 (원문 근거와 별개): ${(channel.matchedQueries || []).join(' / ') || '응답에 없음'}`, 'muted'));
  for (const video of channel.videos || []) { const p = el('p'); p.append(link(video.title, video.url)); card.append(p, el('p', `게시: ${video.publishedAt || '알 수 없음'}`, 'muted'), el('p', video.descriptionPreview || '', 'evidence')); }
  const briefEvidence = el('section', undefined, 'brief-evidence'); briefEvidence.append(el('h3', '공개 문구에서 찾은 근거'));
  if (!channel.evidence?.length) briefEvidence.append(el('p', '이번 검색의 공개 문구에서 연결 근거를 확인하지 못했습니다. 부적합 판정이 아닙니다.'));
  for (const item of channel.evidence || []) {
    const row = el('div', undefined, 'evidence'); row.append(el('strong', `${item.term} · ${item.matchType === 'related_term' ? '관련 표현' : item.matchType === 'alias_term' ? '별칭/번역 표현' : '직접 표현'}: ${item.matchedText}`), el('p', item.excerpt || ''), link(`${item.sourceType || '공개 출처'} 원문`, item.url));
    if (item.contextWarning) row.append(el('p', item.contextWarning, 'notice context-warning'));
    briefEvidence.append(row);
  }
  briefEvidence.append(el('p', channel.evidenceNote || '공개된 제목·설명 일부의 표현 연결이며 실제 협업 적합성을 검증하지 않습니다.', 'muted'));
  if (channel.unconfirmedTerms?.length) briefEvidence.append(el('p', `이번 근거에서 확인되지 않은 주제: ${channel.unconfirmedTerms.map(term => typeof term === 'string' ? term : term.label).join(' · ')}. 미확인은 부적합을 뜻하지 않습니다.`, 'notice'));
  for (const flag of channel.contentFlags || []) {
    const detail = el('details'); detail.append(el('summary', flag.label));
    for (const item of flag.evidence || []) detail.append(el('p', item.excerpt || '', 'evidence'), link(`${item.sourceType || '공개 출처'} 원문`, item.url));
    detail.append(el('p', flag.note || '문구에 따른 검토 보조이며 채널 유형을 확정하지 않습니다.')); briefEvidence.append(detail);
  }
  card.append(briefEvidence);
  warnings(card, channel.reviewRequired);
  card.append(el('p', '수동 검토 필요: 최근 콘텐츠, 광고 이력, 논란·클린 이미지, 시청자 연령, IP·초상 사용권과 브랜드 적합성을 직접 확인하세요. 안전성 검증 완료를 의미하지 않습니다.', 'notice'));
  const manual = el('div', undefined, 'contact');
  manual.append(el('h3', '비즈니스 연락처로 초안 작성'), el('p','연락처 상태: 이 검색에서 이메일을 자동 확보하지 않았습니다. 원문에서 확인한 업무용 주소와 출처를 입력하세요.','notice'), el('p', 'YouTube API를 통한 이메일 자동 수집과 고정 댓글 확인은 지원하지 않습니다. 채널 정보(About)나 공식 웹사이트의 비즈니스 연락처는 직접 확인할 수 있습니다. 공개된 문의 목적을 확인하세요. 공개 이메일이 모든 광고의 수신 동의를 의미하지는 않습니다.', 'notice'));
  const email = el('input'); email.type = 'email'; email.placeholder = '협업 문의용 이메일'; email.maxLength = 254; email.setAttribute('aria-label', '협업 문의용 이메일');
  const source = el('input'); source.type = 'url'; source.placeholder = '연락처 확인 출처 URL'; source.setAttribute('aria-label', '연락처 확인 출처 URL');
  const context = el('textarea'); context.rows = 2; context.maxLength = 500; context.placeholder = '공개 용도·확인 메모 (예: 광고·비즈니스 문의)'; context.setAttribute('aria-label', '공개 용도·확인 메모');
  const consent = el('input'); consent.type = 'checkbox';
  const label = el('label', undefined, 'confirm'); label.append(consent, document.createTextNode(' 협업 문의용으로 공개되었거나 이 목적의 연락에 동의받은 주소이며, 원문과 수신자를 확인했습니다.'));
  const choose = el('button', '입력한 주소로 초안 작성'); choose.disabled = true;
  function valid() {
    let url; try { url = new URL(source.value); } catch { return false; }
    return reviewRow.reviewState!=='excluded' && consent.checked && Boolean(context.value.trim()) && email.validity.valid && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.value) && url.protocol === 'https:' && !url.username && !url.password;
  }
  for (const field of [email, source, context]) field.addEventListener('input', () => { consent.checked = false; choose.disabled = true; clearDraft(); });
  consent.addEventListener('change', () => { choose.disabled = !valid(); if (!consent.checked) clearDraft(); });
  choose.addEventListener('click', () => { if (active(ticket) && valid()) selectContact({ email: email.value.trim(), sourceUrl: source.value, context: context.value.trim() }, channel, ticket.brief); });
  const lookup = el('button', '공식 사이트 업무 연락처 확인');
  const evidence = el('div'); evidence.className = 'business-evidence'; evidence.setAttribute('role', 'status');
  let lookupBusy = false, sourceRevision = 0;
  source.addEventListener('input', () => { sourceRevision++; evidence.replaceChildren(); });
  lookup.addEventListener('click', async () => {
    if (lookupBusy || !active(ticket)) return;
    let url;
    try { url = new URL(source.value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { evidence.replaceChildren(el('p', '자격증명이 없는 HTTPS 원문 URL을 입력하세요.', 'notice')); return; }
    const revision = sourceRevision, requestedSource = source.value;
    const current = () => active(ticket) && revision === sourceRevision && requestedSource === source.value;
    lookupBusy = true; lookup.disabled = true; evidence.replaceChildren(el('p', '공식 사이트 업무 연락처 지원 여부 확인 중…'));
    try {
      const response = await api('/business-contacts', { channelId: channel.channelId, sourceUrl: url.href }, ticket);
      if (!current()) return;
      evidence.replaceChildren(el('p', response.reason || '원문과 업무 용도, 크리에이터 소속을 직접 확인하세요.', 'notice'));
      if (response.status !== 'review_required') {
        evidence.append(link('입력한 원문에서 직접 확인', url.href)); return;
      }
      for (const candidate of response.candidates || []) {
        const item = el('div', undefined, 'evidence');
        item.append(el('strong', candidate.email), el('p', `업무 용도: ${candidate.purpose || '직접 확인 필요'}`), el('p', `수신자: ${candidate.agencyName || '소속사 확인 필요'} · 소속사 업무 수신함 (크리에이터 개인 주소 아님)`), link('업무 연락처 출처', candidate.sourceUrl), el('p', `연락처 확인 시각: ${candidate.observedAt || '알 수 없음'}`));
        item.append(el('p', candidate.affiliation?.excerpt || '소속 근거를 직접 확인하세요.'), link('소속 근거 원문', candidate.affiliation?.url), el('p', `소속 근거 검토일: ${candidate.affiliation?.reviewedAt || '알 수 없음'}`));
        const fill = el('button', '검토용으로 입력');
        fill.addEventListener('click', () => {
          if (!current()) return;
          email.value = String(candidate.email || ''); source.value = String(candidate.sourceUrl || '');
          context.value = `${candidate.purpose || ''} · ${candidate.agencyName || ''} 소속사 업무 수신함. 소속 근거: ${candidate.affiliation?.excerpt || '직접 확인 필요'} (검토일: ${candidate.affiliation?.reviewedAt || '알 수 없음'})`.slice(0, 500);
          consent.checked = false; choose.disabled = true; clearDraft(); sourceRevision++;
          evidence.replaceChildren(el('p', '검토용으로 입력했습니다. 크리에이터 소속, 공개 용도, 원문과 수신자를 직접 확인한 후 체크해 주세요.', 'notice'));
        });
        item.append(fill); evidence.append(item);
      }
    } catch (error) { if (current()) evidence.replaceChildren(el('p', errorText(error), 'notice')); }
    finally { if (active(ticket)) { lookupBusy = false; lookup.disabled = false; } }
  });
  if (/^UC[A-Za-z0-9_-]{22}$/.test(channel.channelId || '')) {
    const aboutUrl = `https://www.youtube.com/channel/${channel.channelId}/about`;
    const useAbout = el('button', '채널 정보 주소를 출처에 입력');
    useAbout.addEventListener('click', () => { if (!active(ticket)) return; source.value = aboutUrl; source.dispatchEvent(new Event('input')); });
    manual.append(link('채널 정보(About)에서 직접 확인', aboutUrl), useAbout, el('p', '주소 입력은 이메일 조회, 원문 열람 또는 연락 동의 확인을 의미하지 않습니다.', 'muted'));
  }
  manual.append(email, source, lookup, evidence, context, label, choose); card.append(manual);
  $('results').append(card); resultCards.push(reviewRow);
}
$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const brief = $('brief').value.trim();
  if (!owner || searchBusy || !brief || disposed) return;
  // Invalidate all previous result handlers without clearing the submitted brief.
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  const ticket = { owner, epoch, brief }; searchBusy = true; $('search').disabled = true;
  $('results').replaceChildren(); $('kept-results').replaceChildren(); $('excluded-results').replaceChildren(); resultCards = []; submittedBrief = null; $('results-purpose').replaceChildren(); updatePreviousResultsNotice(); updateFolds(); $('result-criteria').replaceChildren(); clearDraft(); $('status').textContent = '공개 YouTube 콘텐츠 검색 중…';
  try {
    const queries = $('queries').value.split('\n').map(value => value.trim()).filter(Boolean);
    if (queries.length > 2) throw new Error('검색어는 최대 2개까지 입력해 주세요.');
    const plan = buildBriefReview(brief, queries);
    if (!queries.length && (plan.requiresQueryReview || !plan.queries?.length)) { showCriteria($('brief-plan'), plan); throw new Error('검색어를 직접 확인·입력한 뒤 다시 검색해 주세요.'); }
    const result = await api('/search', { brief, ...(queries.length ? { queries } : {}) }, ticket); if (!active(ticket)) return;
    $('status').textContent = result.channels?.length ? `${result.channels.length}개 채널 · 검색어: ${(result.queries || []).join(' / ')} · API 호출: 검색 ${result.quota?.searchCalls ?? '?'} / 조회 ${result.quota?.readCalls ?? '?'}` : '이번 검색에서 표시할 채널이 없습니다. 검색어를 바꿔 다시 확인해 보세요.';
    if(result.summary)$('status').textContent=`조사 채널 ${result.channels?.length||0}개 · 공개 표현 기준 후보 ${result.summary.targetCandidates}개 · 추가 검토 ${result.summary.reviewCandidates}개. 채널 수는 검증 이메일 수가 아닙니다. · API 호출: 검색 ${result.quota?.searchCalls ?? '?'} / 조회 ${result.quota?.readCalls ?? '?'}`;
    submittedBrief = ticket.brief; $('results-purpose').textContent = `이 결과의 협업 목적: ${submittedBrief}`; updatePreviousResultsNotice();
    showCriteria($('result-criteria'), result.criteria);
    $('result-criteria').append(el('p',`공개 지표 조회 시각: ${result.observedAt || '미확인'}`));
    warnings($('results'), result.warnings);
    for (const channel of result.channels || []) renderChannel(channel, ticket);
    updateFolds();
  } catch (error) { if (active(ticket)) $('status').textContent = errorText(error); }
  finally { if (active(ticket)) { searchBusy = false; $('search').disabled = false; } }
});
for (const button of $('samples').querySelectorAll('button')) button.addEventListener('click', () => { $('brief').value = button.textContent; briefChanged(); $('brief').focus(); });
function invalidateConfirmation() { $('confirm').checked = false; $('open-mail').disabled = true; }
$('subject').addEventListener('input', invalidateConfirmation); $('body').addEventListener('input', invalidateConfirmation);
$('confirm').addEventListener('change', () => { $('open-mail').disabled = !$('confirm').checked || !selectedEmail || selectedCandidateExcluded(); });
$('clear-draft').addEventListener('click', clearDraft);
$('open-mail').addEventListener('click', () => {
  if (!owner || disposed || !selectedEmail || !$('confirm').checked || selectedCandidateExcluded()) return;
  const uri = `mailto:${encodeURIComponent(selectedEmail)}?subject=${encodeURIComponent($('subject').value)}&body=${encodeURIComponent($('body').value)}`;
  invalidateConfirmation();
  $('mail-status').textContent = '메일 앱에 초안 열기를 요청했습니다. 이 화면에서 발송된 메일은 없습니다. 메일 앱에서 수신자와 내용을 다시 확인하세요.';
  window.location.href = uri;
});
client.auth.onAuthStateChange((event, session) => { if (!disposed) { if (event === 'SIGNED_OUT') clearPrivate(); sessionChanged(session); } });
const initialEpoch = epoch;
client.auth.getSession().then(({ data, error }) => { if (!disposed && initialEpoch === epoch) { sessionChanged(error ? null : data.session); } });
window.addEventListener('pagehide', () => { disposed = true; clearPrivate(); owner = null; $('workspace').hidden = true; });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
