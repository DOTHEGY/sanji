import {inAudienceRange,savedEmailDisplay} from './youtube-email-view.mjs';
import {loadStableStateRecords} from './state-records.mjs';
import {DEFAULT_YOUTUBE_COLLECTION,collectionName,recordCollections,collectionNames,withCollection,collectionStats} from './youtube-collections.mjs';
import {FIRST_PROJECT,projectMemberships,addProjectMembership,projectStats,projectDay} from './youtube-projects.mjs';
// Manually researched CRM records only. This module never persists YouTube API
// search snapshots, creates credentials, changes permissions, or sends messages.
export function youtubeProfile(value) {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:' || !['www.youtube.com','youtube.com'].includes(u.hostname) || u.username || u.password || u.port || u.search || u.hash) return null;
    const path=u.pathname.replace(/\/$/,'');
    if(!/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path) && !/^\/@[\p{L}\p{N}_.-]{1,100}$/u.test(decodeURIComponent(path))) return null;
    return 'https://www.youtube.com'+path;
  }catch{return null;}
}
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function manualYoutubeRecord(input,now=new Date().toISOString()) {
  const profile=youtubeProfile(input.profile), name=String(input.name||'').trim(), source=https(input.source), reason=String(input.reason||'').trim(), collection=collectionName(input.collection||DEFAULT_YOUTUBE_COLLECTION);
  if(!profile || !/^https:\/\/www\.youtube\.com\/channel\/UC[A-Za-z0-9_-]{22}$/.test(profile))throw Error('중복 확인을 위해 @핸들이 아닌 /channel/UC로 시작하는 채널 ID 주소를 입력하세요.');
  if(!name || name.length>200 || !source || !reason || reason.length>4000)throw Error('채널명·YouTube 채널 주소·확인 출처·주제 근거를 입력하세요.');
  if(input.attested!==true)throw Error('공개 원문을 직접 확인한 내용인지 확인하세요.');
  return {kind:'크리에이터',name,company:name,companyKey:'youtube:channel-id-hex:'+Array.from(profile.split('/').pop(),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join(''),profile,handle:'',channels:'YouTube',topics:[collection],category:'미확인',classification:collection+' 후보 · 공개 출처 수동 기록',followers:null,contact:{email:'',owner:'',source:'',checked:'',verified:false,purpose:'미확인'},evidence:[{url:source,description:reason,checked:now.slice(0,10)}],reason,status:'검토 중',next:'최근 영상·협업 조건·업무 연락처 확인',note:'수동 출처 기록입니다. 전체 영상 시청·협업 적합성·연락 동의 확인을 의미하지 않습니다.',youtubeResearch:{method:'operator_public_source_review',observedAt:now,source,collections:[collection]}};
}
export const isYoutubeRecord=row=>row?.kind==='candidate'&&row.data?.kind==='크리에이터'&&Boolean(youtubeProfile(row.data.profile));
// The date is the recorded observation date, not the video's publication date.
export function youtubeObservationDay(data){
  const value=data?.youtubeResearch?.observedAt;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)||!Number.isFinite(Date.parse(value)))return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
export function youtubeMatchesFilters(data,query,from,to){
  const q=String(query||'').trim().toLocaleLowerCase('ko-KR');
  const fields=[data?.name,data?.reason,data?.note,...(Array.isArray(data?.topics)?data.topics:[]),...recordCollections(data||{})];
  if(q&&!fields.join(' ').toLocaleLowerCase('ko-KR').includes(q))return false;
  if(!from&&!to)return true;
  const day=youtubeObservationDay(data);return Boolean(day&&(!from||day>=from)&&(!to||day<=to));
}
function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function sourceLink(text,value){const url=https(value);if(!url)return node('span',text);const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
export function mountYoutubeSaved({container,client,getOwner,isCurrent,onChange=()=>{},onPreview=()=>{}}) {
  let revision=0,busy=false,records=[],saveOperation=0,selected=DEFAULT_YOUTUBE_COLLECTION,drafts=[],loaded=false,uncertain=false,selectedRecipients=new Set(),projectMode=false;
  const heading=node('h2','YouTube 크리에이터');
  const projectPanel=node('section'),projectHeading=node('h3','프로젝트'),projectButton=node('button',FIRST_PROJECT.name),allButton=node('button','기존 후보 전체'),projectInfo=node('p'),projectDays=node('div');projectButton.type='button';allButton.type='button';projectInfo.setAttribute('role','status');projectDays.setAttribute('aria-label','프로젝트 날짜별 후보');
  const projectChoice=node('select');projectChoice.setAttribute('aria-label','프로젝트에 추가할 기존 후보');const projectAdd=node('button','선택 후보를 프로젝트에 추가');projectAdd.type='button';
  projectPanel.append(projectHeading,projectButton,allButton,projectInfo,projectDays,projectChoice,projectAdd,node('p','프로젝트 분류 날짜 기준이며, 구독자 3만~20만과 공개 이메일 주소를 모두 확인한 후보만 일일 목표에 포함합니다. 자동 수집은 아직 연결되지 않았습니다.'));
  const status=node('p','로그인 후 저장한 후보를 불러옵니다.');status.setAttribute('role','status');
  const refresh=node('button','저장한 후보 새로고침');refresh.type='button';
  const list=node('div');list.className='saved-youtube-list';
  const search=node('input');search.type='search';search.placeholder='채널명·주제·키워드 검색';search.setAttribute('aria-label','저장한 YouTube 후보 검색');
  const dateControls=node('div');dateControls.className='youtube-date-filters';
  const fromLabel=node('label','조사 확인일 시작 '),from=node('input');from.type='date';from.setAttribute('aria-label','조사 확인일 시작');fromLabel.append(from);
  const toLabel=node('label','조사 확인일 끝 '),to=node('input');to.type='date';to.setAttribute('aria-label','조사 확인일 끝');toLabel.append(to);
  const resetFilters=node('button','검색 조건 지우기');resetFilters.type='button';dateControls.append(fromLabel,toLabel,resetFilters);
  const dateNote=node('p','조사 확인일 기준입니다. 기간을 선택하면 확인일이 없는 후보는 제외됩니다.');
  const selectionStatus=node('p','선택 0명');selectionStatus.setAttribute('role','status');
  const reviewSelection=node('button','선택한 대상 검토');reviewSelection.type='button';
  const selectionReview=node('div');selectionReview.setAttribute('aria-label','선택 대상 검토');
  const explain=node('p','주제별로 계속 모아두는 후보 목록입니다. 같은 채널은 여러 모음에 넣어도 CRM 기록은 하나만 유지합니다. 공개 출처의 수치·연락처는 협업 적합성이나 이메일 발송 승인이 아닙니다.');
  const collectionBox=node('div');collectionBox.className='youtube-collection-boxes';collectionBox.setAttribute('aria-label','크리에이터 모음 선택');
  const collectionInfo=node('p');collectionInfo.className='notice';collectionInfo.setAttribute('role','status');
  const createForm=node('form');createForm.dataset.role='create-collection';createForm.className='youtube-collection-create';
  const collectionInput=node('input');collectionInput.name='collectionName';collectionInput.maxLength=40;collectionInput.placeholder='새 모음 이름 · 예: 약사';collectionInput.setAttribute('aria-label','새 모음 이름');collectionInput.required=true;
  const create=node('button','새 모음 만들기');create.type='submit';createForm.append(collectionInput,create);
  const collectionStatus=node('p');collectionStatus.dataset.role='collection-status';collectionStatus.setAttribute('role','status');
  const existingWrap=node('div');existingWrap.className='youtube-collection-existing';
  const existingLabel=node('label','이 모음에 기존 후보 추가'),existing=node('select');existing.setAttribute('aria-label','이 모음에 추가할 기존 후보');existingLabel.append(existing);
  const addExisting=node('button','선택한 후보를 이 모음에 추가');addExisting.type='button';existingWrap.append(existingLabel,addExisting);
  const manage=node('details');manage.className='saved-management';manage.append(node('summary','모음 관리 · 후보 추가'),explain,createForm,collectionStatus,existingWrap);
  container.replaceChildren(heading,projectPanel,collectionBox,search,dateControls,dateNote,status,selectionStatus,reviewSelection,selectionReview,list,refresh,manage);
  manage.append(collectionInfo);
  function controls(){refresh.disabled=busy;save.disabled=busy||!loaded||uncertain;create.disabled=busy||!loaded;addExisting.disabled=busy||!loaded||uncertain||!existing.value;for(const b of collectionBox.children)b.disabled=busy;}
  function drawCollections(){
    collectionBox.replaceChildren();
    for(const name of [null,...collectionNames(records,drafts),'']){const stats=collectionStats(records,name),label=name===null?'전체':name===''?'미분류':name,button=node('button',`${label} ${stats.count}명`);button.type='button';button.className='youtube-collection'+(selected===name?' selected':'');button.setAttribute('aria-pressed',String(selected===name));button.addEventListener('click',()=>{if(busy)return;selected=name;draw();});collectionBox.append(button);}
    const stats=collectionStats(records,selected),label=selected===null?'전체':selected===''?'미분류':selected;
    collectionInfo.textContent=`${label} 누적 ${stats.count}명 · 공개 주소 근거 ${stats.publicContactLeads}명 (소속·수신 가능 여부·연락 동의 미확인)`+(selected&&stats.count===0?' · 빈 모음은 이 화면의 임시 모음이며 첫 후보 저장 후 유지됩니다.':'');
    const options=records.filter(r=>selected&&!recordCollections(r.data).includes(selected)),old=existing.value;existing.replaceChildren();const placeholder=node('option','기존 후보 선택');placeholder.value='';existing.append(placeholder);
    for(const row of options){const option=node('option',row.data.name+' · '+youtubeProfile(row.data.profile).split('/').pop());option.value=row.id;existing.append(option);}existing.value=options.some(r=>r.id===old)?old:'';existingWrap.hidden=!selected;
    manualSummary.textContent=selected?`직접 찾은 ${selected} 채널 기록`:'직접 찾은 채널 기록 · 먼저 주제 모음을 선택하세요';
    form.hidden=!selected;controls();
  }
  function draw(){
    drawCollections();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),stats=projectStats(records,FIRST_PROJECT.id,today);
    projectInfo.textContent=`${FIRST_PROJECT.name} · ${FIRST_PROJECT.description} · 누적 채널 ${stats.count}명 · 구독자 3만~20만 ${stats.qualified}명 · 공개 이메일 후보 ${stats.withEmail}명 · 오늘 이메일 후보 ${stats.today}/${FIRST_PROJECT.dailyGoal}명`;
    projectDays.replaceChildren();for(const day of [...new Set(stats.rows.flatMap(r=>projectMemberships(r.data).filter(p=>p.id===FIRST_PROJECT.id).map(projectDay)))].sort().reverse()){const count=projectStats(records,FIRST_PROJECT.id,day).today,button=node('button',`${day} · 이메일 ${count}명`);button.type='button';button.addEventListener('click',()=>{projectMode=true;from.value=day;to.value=day;draw();});projectDays.append(button);}
    projectButton.setAttribute('aria-pressed',String(projectMode));allButton.setAttribute('aria-pressed',String(!projectMode));collectionBox.hidden=projectMode;
    const oldChoice=projectChoice.value;projectChoice.replaceChildren();const prompt=node('option','기존 후보 선택');prompt.value='';projectChoice.append(prompt);for(const r of records.filter(r=>!projectMemberships(r.data).some(p=>p.id===FIRST_PROJECT.id))){const option=node('option',r.data.name);option.value=r.id;projectChoice.append(option);}projectChoice.value=oldChoice;
    dateNote.textContent=projectMode?'프로젝트 분류 날짜 기준입니다. 실제 조사일과 다를 수 있습니다.':'조사 확인일 기준입니다. 기간을 선택하면 확인일이 없는 후보는 제외됩니다.';
    const projectRows=projectMode?stats.rows:collectionStats(records,selected).rows;const rows=projectRows.filter(r=>{if(!projectMode)return youtubeMatchesFilters(r.data,search.value,from.value,to.value);if(!youtubeMatchesFilters(r.data,search.value,'',''))return false;const m=projectMemberships(r.data).find(p=>p.id===FIRST_PROJECT.id);const day=projectDay(m);return (!from.value||day>=from.value)&&(!to.value||day<=to.value);});
    selectionStatus.textContent=`선택 ${selectedRecipients.size}명 · 다른 조건에서 선택한 대상도 유지됩니다.`;
    if(from.value&&to.value&&from.value>to.value){status.textContent='시작일이 종료일보다 늦습니다. 날짜를 확인하세요.';list.replaceChildren();return;}
    const hasAddress=row=>inAudienceRange(row.data.followers)&&savedEmailDisplay(row.data).email!==null;const current=rows.filter(hasAddress),history=rows.filter(r=>!hasAddress(r));
    list.replaceChildren();status.textContent=`산지 저장 ${records.length}명 · 표시 ${rows.length}명 · 3만–20만 규모·공개 주소 후보 ${current.length}명 (검증 주소 수가 아닙니다)`;
    function table(records,label){const wrap=node('div');wrap.className='creator-table-wrap';const table=node('table');table.className='creator-table';table.setAttribute('aria-label',label);const head=node('thead'),hr=node('tr');for(const title of ['채널명','이메일주소','구독자수']){const th=node('th',title);th.setAttribute('scope','col');hr.append(th);}head.append(hr);const body=node('tbody');table.append(head,body);wrap.append(table);return {wrap,body};}
    const activeTable=table(current,'공개 주소가 기록된 구독자 3만–20만 YouTube 조사 후보');list.append(activeTable.wrap);
    if(!current.length)list.append(node('p','이 모음에 공개 주소가 기록된 구독자 3만–20만 채널이 없습니다. 이메일 미확인·기존 조사 기록은 아래에 보존되어 있습니다.'));
    const historyBox=node('details');historyBox.className='creator-history';historyBox.append(node('summary',`이메일 미확인·규모 미확인/범위 외 조사 기록 (${history.length}명)`),node('p','기존 후보·주소·주제 모음을 그대로 보존합니다. 이메일 미확인, 3만–20만 범위 밖 또는 규모 미확인 기록은 현재 50개 주소 목표에 포함하지 않습니다.'));
    const oldTable=table(history,'기존 YouTube 조사 기록');historyBox.append(oldTable.wrap);list.append(historyBox);
    for(const r of rows){const d=r.data,card=node('details');card.className='creator-detail';const summary=node('summary','상세 근거');card.append(summary,sourceLink('YouTube 채널 원문',d.profile));
      const tr=node('tr'),name=node('td'),email=node('td'),audience=node('td'),contact=savedEmailDisplay(d);
      const choose=node('input');choose.type='checkbox';choose.checked=selectedRecipients.has(r.id);choose.disabled=!contact.email;choose.setAttribute('aria-label',`${d.name} 검토 대상으로 선택`);choose.addEventListener('change',()=>{if(choose.checked)selectedRecipients.add(r.id);else selectedRecipients=new Set([...selectedRecipients].filter(id=>id!==r.id));selectionReview.replaceChildren();selectionStatus.textContent=`선택 ${selectedRecipients.size}명 · 다른 조건에서 선택한 대상도 유지됩니다.`;});
      name.append(choose,sourceLink(d.name,d.profile));const key=youtubeProfile(d.profile)?.match(/\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1];
      const preview=node('button','카피 보기');preview.type='button';preview.className='compact secondary';preview.disabled=!key;preview.setAttribute('aria-label',`${d.name} 개별 카피 보기`);const owner=getOwner(),ticket=revision;preview.addEventListener('click',()=>{if(!loaded||busy||ticket!==revision||!isCurrent(owner)||getOwner()!==owner||!key)return;onPreview('youtube:'+key);});name.append(preview,card);
      email.append(node('span',contact.email||'미확인'));const hint=node('small',contact.label);hint.className='muted';email.append(hint);if(contact.otherCount)card.append(node('p',`추가 주소 근거 ${contact.otherCount}개는 아래에 보존합니다. 수신자는 크리에이터당 최대 1개 주소만 선택하며 플랫폼 간 공유 수신함도 중복 제외합니다.`));
      audience.textContent=Number.isSafeInteger(d.followers)&&d.followers>=0?d.followers.toLocaleString('ko-KR'):'미확인';tr.append(name,email,audience);(hasAddress(r)?activeTable.body:oldTable.body).append(tr);
      if(d.followers!=null)card.append(node('p',`공개 구독자 수: ${Number(d.followers).toLocaleString('ko-KR')} · 출처 확인일 ${d.metricsChecked||'미확인'}`),sourceLink('수치 확인 출처',d.metricsSource));
      card.append(node('p','모음: '+(recordCollections(d).join(' · ')||'미분류')),node('p',d.reason||'주제 근거 확인 필요'),node('p',d.note||''));
      for(const e of d.evidence||[]){const p=node('p');p.append(sourceLink(e.description||'확인 출처',e.url),document.createTextNode(` · 확인 ${e.checked||'미확인'}`));card.append(p);}
      const leads=Array.isArray(d.youtubeResearch?.businessContacts)?d.youtubeResearch.businessContacts:[];
      for(const lead of leads){if(!lead?.email)continue;card.append(node('p',`공개 주소 근거: ${lead.email} · 소속·수신 가능 여부·연락 동의 미확인`),sourceLink('업무 연락처 확인 출처',lead.sourceUrl||lead.source),node('p',`출처 확인일: ${lead.checked||lead.observedAt||'미확인'} · ${[lead.purpose,lead.context,lead.note].filter(Boolean).join(' · ')||'업무 용도 원문 확인 필요'}`));}
      if(d.contact?.email)card.append(node('p',`공개 업무 연락처: ${d.contact.email} · 수신 가능 여부·연락 동의 미확인`),sourceLink('연락처 공개 출처',d.contact.source));
      else if(!leads.some(lead=>lead?.email))card.append(node('p','공개 업무 이메일 미확인 · 이메일 개수가 아닌 후보 수로 집계합니다.'));
      card.append(node('p',`상태: ${d.status||'검토 중'} · ${d.next||'원문 검토 필요'}`));
    }
  }
  async function checkedSession(owner,ticket){
    const r=await client.auth.getSession();if(r.error||r.data?.session?.user?.id!==owner||ticket!==revision||!isCurrent(owner))throw Error('STALE');return r.data.session;
  }
  async function load(afterSave=false){
    if(busy&&afterSave!==true)return;
    const owner=getOwner(),ticket=++revision;records=[];selectedRecipients.clear();selectionReview.replaceChildren();loaded=false;list.replaceChildren();drawCollections();onChange();
    if(!owner){status.textContent='로그인 후 저장한 후보를 불러옵니다.';return;}
    status.textContent='저장한 후보 확인 중…';refresh.disabled=true;
    try{const session=await checkedSession(owner,ticket),token=session.access_token;
      const result=await loadStableStateRecords({owner,fetchPage:async({owner,cursor,summary,pageSize})=>{
        await checkedSession(owner,ticket);
        let q=client.from('sanji_records').select(summary?'id,owner,version,updated':'id,owner,kind,data,version,updated').eq('owner',owner).eq('kind','candidate').order('id',{ascending:true}).limit(pageSize).setHeader('Authorization','Bearer '+token);
        if(cursor)q=q.gt('id',cursor);const r=await q;if(r.error)throw Error('저장한 후보를 불러오지 못했습니다. 다시 확인하세요.');return r.data;
      }});await checkedSession(owner,ticket);records=result.filter(isYoutubeRecord);projectMode=records.some(r=>projectMemberships(r.data).some(p=>p.id===FIRST_PROJECT.id));loaded=true;uncertain=false;draw();onChange();
    }catch(e){if(ticket===revision&&isCurrent(owner)&&e.message!=='STALE')status.textContent=e.message;}
    finally{if(ticket===revision)controls();}
  }
  refresh.addEventListener('click',()=>load());search.addEventListener('input',()=>{if(loaded)draw();});existing.addEventListener('change',controls);
  projectButton.addEventListener('click',()=>{projectMode=true;if(loaded)draw();});allButton.addEventListener('click',()=>{projectMode=false;if(loaded)draw();});
  projectAdd.addEventListener('click',async()=>{if(busy||!loaded||uncertain)return;const row=records.find(r=>r.id===projectChoice.value),owner=getOwner(),ticket=revision;if(!row||row.owner!==owner)return;const operation=++saveOperation;busy=true;projectAdd.disabled=true;projectInfo.textContent='프로젝트에 추가 중…';try{const data=addProjectMembership(row.data,FIRST_PROJECT.id,new Date().toISOString());if(!data)throw Error('이미 이 프로젝트에 추가된 후보입니다.');const session=await checkedSession(owner,ticket);uncertain=true;const result=await client.rpc('sanji_save_record',{p_kind:'candidate',p_id:row.id,p_version:row.version,p_data:data}).setHeader('Authorization','Bearer '+session.access_token);await checkedSession(owner,ticket);const value=Array.isArray(result.data)?result.data[0]:result.data;if(result.error||!value||value.owner!==owner||value.id!==row.id||value.version!==row.version+1||!projectMemberships(value.data).some(p=>p.id===FIRST_PROJECT.id))throw Error('저장 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');await load(true);}catch(e){if(ticket===revision&&isCurrent(owner)&&e.message!=='STALE')projectInfo.textContent=e.message;}finally{if(operation===saveOperation){busy=false;projectAdd.disabled=false;controls();}}});
  for(const input of [from,to])input.addEventListener('change',()=>{if(loaded)draw();});
  resetFilters.addEventListener('click',()=>{search.value='';from.value='';to.value='';if(loaded)draw();});
  function drawSelectionReview(){selectionReview.replaceChildren();const chosen=records.filter(r=>selectedRecipients.has(r.id));if(!chosen.length){selectionReview.append(node('p','먼저 이메일 주소가 있는 대상을 선택하세요.'));return;}selectionReview.append(node('p',`선택한 ${chosen.length}명 · 아직 이메일을 보내지 않았습니다. 발송 기능은 연결 검토 중입니다.`));const items=node('ul');for(const row of chosen){const item=node('li',`${row.data.name} · ${savedEmailDisplay(row.data).email||'주소 미확인'} `),remove=node('button','선택에서 제외');remove.type='button';remove.setAttribute('aria-label',`${row.data.name} 선택에서 제외`);remove.addEventListener('click',()=>{selectedRecipients=new Set([...selectedRecipients].filter(id=>id!==row.id));draw();drawSelectionReview();});item.append(remove);items.append(item);}selectionReview.append(items);}
  reviewSelection.addEventListener('click',drawSelectionReview);
  createForm.addEventListener('submit',event=>{event.preventDefault();if(busy||!loaded)return;try{const name=collectionName(collectionInput.value),names=collectionNames(records,drafts);if(!names.includes(name)){if(names.length>=100)throw Error('모음은 최대 100개까지 만들 수 있습니다.');drafts.push(name);}selected=name;collectionInput.value='';collectionStatus.textContent='모음을 선택했습니다. 첫 후보를 저장하면 다른 기기에서도 이 모음을 볼 수 있습니다.';draw();}catch(e){collectionStatus.textContent=e.message;}});
  async function addMembership(row,name,owner,ticket){
    if(!row||row.owner!==owner||!Number.isInteger(row.version)||row.version<1)throw Error('현재 후보를 다시 불러오세요.');
    const data=withCollection(row.data,name);if(!data)return false;
    const session=await checkedSession(owner,ticket);
    uncertain=true;const result=await client.rpc('sanji_save_record',{p_kind:'candidate',p_id:row.id,p_version:row.version,p_data:data}).setHeader('Authorization','Bearer '+session.access_token);
    await checkedSession(owner,ticket);
    if(result.error){throw Error(result.error.code==='40001'?'다른 변경이 있습니다. 새로고침한 뒤 다시 추가하세요.':'저장 결과를 확인하지 못했습니다. 먼저 목록을 새로고침하세요.');}
    const value=Array.isArray(result.data)?result.data[0]:result.data;
    if(!value||value.owner!==owner||value.kind!=='candidate'||value.id!==row.id||value.version!==row.version+1||youtubeProfile(value.data?.profile)!==youtubeProfile(row.data.profile)||!recordCollections(value.data).includes(name)){throw Error('저장 결과를 확인하지 못했습니다. 먼저 목록을 새로고침하세요.');}
    return true;
  }
  addExisting.addEventListener('click',async()=>{
    if(busy||!loaded||uncertain||!selected)return;const row=records.find(r=>r.id===existing.value),name=selected,owner=getOwner(),ticket=revision;if(!owner||!row)return;const operation=++saveOperation;busy=true;controls();collectionStatus.textContent='모음에 추가 중…';
    try{await addMembership(row,name,owner,ticket);collectionStatus.textContent=`${name} 모음에 추가했습니다. 기존 후보·연락처 기록을 유지했습니다.`;await load(true);}
    catch(e){if(ticket===revision&&isCurrent(owner)&&e.message!=='STALE'){uncertain=true;collectionStatus.textContent=e.message;}}
    finally{if(operation===saveOperation){busy=false;controls();}}
  });
  const manual=node('details'),form=node('form'),manualSummary=node('summary','직접 찾은 먹방 채널 기록');manual.append(manualSummary);form.dataset.role='manual-candidate';
  const fields={};
  for(const [key,label,type] of [['name','채널명','text'],['profile','YouTube 채널 ID 주소 (https://www.youtube.com/channel/UC…)','url'],['source','주제 근거를 확인한 공개 출처 URL','url'],['reason','주제·콘텐츠 근거·확인하지 못한 내용','textarea']]){const wrap=node('label',label),f=node(type==='textarea'?'textarea':'input');if(type!=='textarea')f.type=type;f.required=true;f.name=key;f.maxLength=key==='reason'?4000:500;wrap.append(f);form.append(wrap);fields[key]=f;}
  const checkbox=node('input');checkbox.type='checkbox';const label=node('label');label.append(checkbox,document.createTextNode(' 공개 원문에서 직접 확인한 내용입니다.'));form.append(label);
  const save=node('button','산지 후보로 저장');save.type='submit';const saveStatus=node('p');saveStatus.setAttribute('role','status');form.append(save,saveStatus);manual.append(form);manage.append(manual);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!loaded||uncertain||!selected)return;const owner=getOwner(),ticket=revision;if(!owner)return;const operation=++saveOperation;busy=true;controls();
    const snapshot=()=>JSON.stringify({...Object.fromEntries(Object.entries(fields).map(([k,f])=>[k,f.value])),attested:checkbox.checked,collection:selected});const submitted=snapshot();
    try{const data=manualYoutubeRecord(JSON.parse(submitted));
      const session=await checkedSession(owner,ticket);
      const exists=records.find(r=>r.data.companyKey===data.companyKey||youtubeProfile(r.data.profile)===data.profile);
      if(exists){if(recordCollections(exists.data).includes(selected)){saveStatus.textContent='이미 저장된 채널입니다. 기존 기록을 덮어쓰지 않았습니다.';return;}await addMembership(exists,selected,owner,ticket);saveStatus.textContent='기존 후보를 이 모음에 추가했습니다. 입력한 이름·근거로 기존 기록을 덮어쓰지 않았습니다.';if(snapshot()===submitted)form.reset();await load(true);return;}
      busy=true;save.disabled=true;saveStatus.textContent='산지에 저장 중…';
      uncertain=true;const result=await client.rpc('sanji_save_record',{p_kind:'candidate',p_data:data,p_id:null,p_version:null}).setHeader('Authorization','Bearer '+session.access_token);
      await checkedSession(owner,ticket);
      if(result.error){throw Error(result.error.code==='23505'?'이미 저장된 채널입니다. 목록을 새로고침한 뒤 기존 후보를 이 모음에 추가하세요.':'저장 결과를 확인하지 못했습니다. 목록을 새로고침한 뒤 중복 여부를 확인하세요.');}
      const value=Array.isArray(result.data)?result.data[0]:result.data;if(!value||value.owner!==owner||value.kind!=='candidate'||typeof value.id!=='string'||!Number.isInteger(value.version)||value.version<1||value.data?.companyKey!==data.companyKey||youtubeProfile(value.data?.profile)!==data.profile||!recordCollections(value.data).includes(selected))throw Error('저장 결과를 확인하지 못했습니다. 먼저 목록을 새로고침하세요.');
      saveStatus.textContent='산지 후보에 저장했습니다. 메시지는 보내지 않았습니다.';if(snapshot()===submitted)form.reset();await load(true);
    }catch(e){if(ticket===revision&&isCurrent(owner)&&e.message!=='STALE')saveStatus.textContent=e.message;}
    finally{if(operation===saveOperation){busy=false;controls();if(isCurrent(owner)&&saveStatus.textContent==='산지에 저장 중…')saveStatus.textContent='저장 결과를 확인하지 못했습니다. 목록을 새로고침한 뒤 중복 여부를 확인하세요.';}}
  });
  const getSavedIds=()=>new Set(records.map(r=>youtubeProfile(r.data.profile)?.match(/\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1]).filter(Boolean));
  drawCollections();
  return {load,getSavedIds,hasChannelId:id=>typeof id==='string'&&getSavedIds().has(id),clear(){revision++;saveOperation++;records=[];selectedRecipients.clear();selectionReview.replaceChildren();selectionStatus.textContent='선택 0명';projectInfo.textContent='';projectChoice.replaceChildren();projectMode=false;busy=false;loaded=false;uncertain=false;selected=DEFAULT_YOUTUBE_COLLECTION;drafts=[];list.replaceChildren();form.reset();search.value='';from.value='';to.value='';collectionInput.value='';collectionStatus.textContent='';saveStatus.textContent='';status.textContent='로그인 후 저장한 후보를 불러옵니다.';drawCollections();onChange();}};
}
