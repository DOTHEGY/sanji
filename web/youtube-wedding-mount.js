import {mountWeddingResearchControl} from './youtube-wedding-research-control.mjs';
import { researchDay, weddingCandidate, weddingRows } from './youtube-wedding-model.mjs';
import { verifiedContactsForDay, readVerifiedProjectContacts } from './youtube-verified-project-contacts.mjs';
import { weddingDayGroups } from './youtube-wedding-day-groups.mjs';
import {decodeWeddingStatus,MAX_WEDDING_STATUS_IDS,decodeWeddingSubscriberRefresh,subscriberRefreshError} from './youtube-wedding-status-client.mjs';

import {createWeddingMailUi} from './youtube-wedding-mail-ui.mjs';
import {createWeddingRecoveryUi} from './youtube-wedding-recovery-ui.mjs';

const markup = `<div data-wedding-project>
<style>
[data-wedding-project] { min-width:0; }
[data-wedding-project] > header { margin:0 0 .5rem; }
[data-wedding-project] #wedding-heading { margin:0; font-size:clamp(1.35rem,3vw,1.85rem); line-height:1.3; }
[data-wedding-project] #wedding-panel { margin-bottom:0; min-width:0; }
[data-wedding-project] h3 { font-size:1.05rem; margin:0 0 .65rem; }
[data-wedding-project] details { margin-top:.85rem; padding-top:.85rem; border-top:1px solid #dbe4da; }
[data-wedding-project] summary { cursor:pointer; font-weight:650; }
[data-wedding-project] details[open] summary { margin-bottom:1rem; }
[data-wedding-project] :is(a,p,li) { overflow-wrap:anywhere; }
[data-wedding-project] select { display:block; width:min(20rem,100%); font:inherit; border:1px solid #b8cabb; border-radius:.5rem; background:#fcfdfb; padding:.45rem; }
[data-wedding-project] label { display:block; }
[data-wedding-project] :is(input,textarea,button) { max-width:100%; }
[data-wedding-project] .creator-project-day{margin-block:1rem 1.6rem}
[data-wedding-project] .creator-project-day h4{margin-block:0 .6rem}
[data-wedding-project] .creator-table-wrap{width:100%;overflow-x:auto}
[data-wedding-project] .creator-table{width:100%;border-collapse:collapse;table-layout:fixed}
[data-wedding-project] .creator-table :is(th,td){padding:.8rem .5rem;text-align:left;border-bottom:1px solid #edf1eb;vertical-align:top;overflow-wrap:anywhere}
[data-wedding-project] .creator-table th{font-size:.85rem;color:#617268}
[data-wedding-project] .creator-table td small{display:block;font-size:.73rem}
[data-wedding-project] .creator-table th:last-child{width:25%}
[data-wedding-project] .creator-mail-state{font-weight:700}
[data-wedding-project] .creator-mail-sent{color:#1a7352}
[data-wedding-project] .creator-mail-scheduled{color:#234fa5}
[data-wedding-project] .creator-mail-found_only{color:#4c5768}
[data-wedding-project] :is(.creator-mail-unknown,.creator-mail-failed){color:#8a400d}
[data-wedding-project] .wedding-mail-actions{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin:.65rem 0}
[data-wedding-project] .wedding-mail-actions :is(p,section){width:100%;margin:.25rem 0}
[data-wedding-project] .wedding-mail-copy{font-size:.9rem;padding:.65rem;border:1px solid #dbe4da;border-radius:.35rem;max-height:18rem;overflow:auto}
[data-wedding-project] .wedding-mail-copy p{white-space:pre-wrap}
[data-wedding-project] input.wedding-mail-exclude{width:auto;margin:0 .4rem 0 0;vertical-align:middle}
[data-wedding-project] [hidden] { display:none!important; }
</style>
<header><h2 id="wedding-heading">별도 YouTube 프로젝트</h2></header>
<p id="wedding-auth" role="status">로그인 확인 중…</p>
<section id="wedding-panel" class="panel" hidden>
<h3>날짜별 발굴·예약·발송 상태</h3>
<p>발굴일은 한국시간 기준입니다. 예약과 발송은 이 프로젝트의 확인된 기록만 표시합니다.</p>
<div id="wedding-optional-recovery" class="wedding-mail-actions" hidden></div>
<label for="wedding-day">조사일 (한국시간)</label><select id="wedding-day"><option value="">전체</option></select>
<p id="wedding-contact-status" role="status"></p>
<div id="wedding-contact-list"></div>
<button id="wedding-refresh" type="button">목록 새로고침</button>
<button id="wedding-subscriber-refresh" type="button" hidden>구독자 수 확인</button>
<p id="wedding-subscriber-result" role="status"></p>
<div id="wedding-research-control" hidden></div>
<details>
<summary>조사 원본 및 연락처 미확인 기록</summary>
<h3>직접 확인한 후보 기록</h3>
<p>이 프로젝트에 추가된 채널과 영상 근거를 조사일별로 확인합니다. 계정에 저장되어 다른 기기에서도 볼 수 있습니다.</p>
<form id="wedding-form" autocomplete="off">
<label for="w-name">채널명</label><input id="w-name" name="name" required maxlength="100">
<label for="w-channel">YouTube 채널 주소 (/channel/UC…)</label><input id="w-channel" name="channelUrl" type="url" required maxlength="250">
<label for="w-video">검토한 YouTube 영상 주소</label><input id="w-video" name="evidenceUrl" type="url" required maxlength="250">
<label for="w-note">웨딩 콘텐츠 확인 근거 (개인 연락처 제외)</label><textarea id="w-note" name="note" required maxlength="500" rows="3"></textarea>
<button type="submit">후보 저장</button>
</form>
<p id="wedding-status" role="status"></p>
<h3>날짜별 조사 기록</h3>

</details>
</section>
</div>`;

function createWeddingView(root,{client,expectedOwner=null,mountCopy,readStatus,refreshSubscribers,researchRequest,mailRequest,readMailCopy,mailStorage}){
 root.innerHTML=markup;
 const document=root.ownerDocument;
 const $ = id => root.querySelector('#'+id);
 const heading=$('wedding-heading'), panel=$('wedding-panel'), auth=$('wedding-auth'), form=$('wedding-form'),
   status=$('wedding-status'), filter=$('wedding-day'), refresh=$('wedding-refresh'),
   subscriberRefresh=$('wedding-subscriber-refresh'),subscriberResult=$('wedding-subscriber-result'),contactStatus=$('wedding-contact-status'), contactList=$('wedding-contact-list');
 const generic='별도 YouTube 프로젝트', projectTable='sanji_private_wedding_projects', shortlistTable='sanji_private_wedding_shortlist';
 const mailByDay=new Map();
 const recoveryHost=$('wedding-optional-recovery');
 let recoveryUi=null,statusReader=null,copyDetails=null,owner=null, epoch=0, rows=[], contacts=null,statusByDay=new Map(), disposed=false, saving=false, uncertain=false, refreshing=false, subscriberBusy=false;
 const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const link=(label,address)=>{const node=element('a',label);node.href=address;node.target='_blank';node.rel='noopener noreferrer';return node;};
 const current=(actor,ticket)=>!disposed&&ticket===epoch&&owner===actor;
 const researchHost=$('wedding-research-control');
 const researchControl=mountWeddingResearchControl(researchHost,{
   submit:researchRequest,
   context:()=>{
     const actor=owner,ticket=epoch;
     if(!actor||panel.hidden||saving||refreshing||subscriberBusy)return null;
     return {owner:actor,ticket,stillActive:()=>current(actor,ticket)&&!panel.hidden&&root.isConnected};
   },
   onSuccess:async ({owner:actor,ticket},result)=>{
     if(result.enrolled>0){refresh.click();return;}
     if(current(actor,ticket)){refreshMailStatuses(actor,ticket);draw();}
   },
 });

 function clear(){
   recoveryUi?.revoke();recoveryUi=null;
   researchControl.revoke();researchHost.hidden=true;
   statusReader?.abort();statusReader=null;
   for(const ctl of mailByDay.values())ctl.revoke();mailByDay.clear();
   owner=null;rows=[];contacts=null;statusByDay=new Map();copyDetails?.remove();copyDetails=null;panel.hidden=true;heading.textContent=generic;saving=false;uncertain=false;refreshing=false;
   subscriberBusy=false;subscriberRefresh.hidden=true;subscriberRefresh.disabled=false;subscriberResult.textContent='';
   status.textContent='';contactStatus.textContent='';contactList.replaceChildren();form.reset();filter.replaceChildren(new Option('전체',''));
 }
 function draw(){
   const day=filter.value, all=weddingRows(rows,owner);
   const days=[...new Set(all.map(r=>r.projectDay))];
   filter.replaceChildren(new Option('전체',''), ...days.map(d=>new Option(d,d)));
   filter.value=days.includes(day)?day:'';
   const visible=weddingRows(rows,owner,filter.value);
   const verified=contacts===null?null:verifiedContactsForDay(contacts,filter.value);
   const groups=weddingDayGroups({owner,rows:visible,verified,statusByDay,day:filter.value});
   const active=groups.reduce((n,g)=>n+g.active.length,0);
   contactStatus.textContent=verified===null
     ? '공개 이메일 확인 목록을 불러오지 못했습니다. 이전 조사와 발송 상태는 보존됩니다.'
     : `공개 이메일 확인 및 구독자 5만 명 이상 ${active}명 · 전체 조사 기록 ${visible.length}명`;
   function buildTable(rows,label,exclusions=null){
     const wrap=element('div','');wrap.className='creator-table-wrap';
     const table=element('table','');table.className='creator-table';table.setAttribute('aria-label',label);
     const head=element('thead',''), header=element('tr',''),body=element('tbody','');
     for(const name of ['채널명','YouTube 구독자','이메일주소','발송 상태']){
       const th=element('th',name);th.setAttribute('scope','col');header.append(th);
     }
     head.append(header);table.append(head,body);wrap.append(table);
     for(const {row,contact,status,subscriberCount} of rows){
       const tr=element('tr',''),candidate=element('td',''),address=element('td',contact?.email||'미확인'),state=element('td','');
       const details=element('details','');details.className='creator-detail';
       details.append(element('summary','상세 근거'),element('p',row.note),link('영상 근거',row.evidenceUrl));
       if(contact)details.append(link('주소 확인 출처',contact.sourceUrl),element('small','주소 확인일 '+researchDay(contact.verifiedAt)));
       if(contact&&exclusions){
         const box=element('input','');box.type='checkbox';box.className='wedding-mail-exclude';box.setAttribute('aria-label',row.name+' 발송에서 제외');
         exclusions.push([box,row.channelID]);candidate.append(box);
       }
       candidate.append(link(row.name,row.channelUrl),details);
       const badge=element('span',status.label);badge.className='creator-mail-state creator-mail-'+status.state;state.append(badge);
       if(status.detail)state.append(element('small',status.detail));
       tr.append(candidate,element('td',subscriberCount===null?'미확인':new Intl.NumberFormat('ko-KR').format(subscriberCount)+'명'),address,state);body.append(tr);
     }
     return wrap;
   }
   contactList.replaceChildren(...groups.map(group=>{
     const section=element('section','');section.className='creator-project-day';
     const {counts,cutoffCounts}=group;
     section.append(element('h4',group.day+' · 발굴일 (KST)'),element('p',`기준 충족 ${group.active.length}명 · 구독자 5만 미만 ${cutoffCounts.below_minimum}명 · 구독자 미확인 ${cutoffCounts.unknown}명 · 5만 이상 중 이메일 미확인 ${cutoffCounts.eligible-group.active.length}명`),element('p',`전체 조사 기록 상태: 찾기만 함 ${counts.found_only}명 · 발송 예약 ${counts.scheduled}명 · 발송 완료 ${counts.sent}명 · 발송 실패 ${counts.failed}명 · 확인 필요 ${counts.unknown}명`));
     const hasMail=typeof mailRequest==='function'&&typeof readMailCopy==='function';
     const exclusions=hasMail?[]:null;
     if(group.active.length)section.append(buildTable(group.active,'공개 주소가 확인된 YouTube 후보',exclusions));
     if(hasMail){
       const actor=owner, scope=group.day;
       if(!mailByDay.has(scope)){
         const sessionActive=()=>!disposed&&owner===actor&&!root.hidden&&root.isConnected;
         mailByDay.set(scope,createWeddingMailUi({owner:actor,day:scope,storage:mailStorage,sessionActive,
           request:({body,stillActive})=>mailRequest({owner:actor,body,stillActive}),
           readCopy:stillActive=>readMailCopy(actor,stillActive),
           refreshStatus:()=>refreshMailStatuses(actor,epoch),
         }));
       }
       const host=element('div','');host.className='wedding-mail-actions';
       section.append(host);mailByDay.get(scope).bind({host,exclusions,eligibleCount:group.active.length,document});
     }
     if(group.history.length){
       const history=element('details','');history.className='creator-history';
       history.append(element('summary',`활성 기준 미충족·이전 조사 기록 (${group.history.length}명)`),buildTable(group.history,'기존 YouTube 조사 기록'));
       section.append(history);
     }
     return section;
   }));

 }
 function refreshMailStatuses(actor,ticket){
   statusReader?.abort();statusReader=null;statusByDay=new Map();
   if(typeof readStatus!=='function'||!current(actor,ticket))return;
   const channelsByDay=new Map();
   for(const row of weddingRows(rows,actor)){
     if(!channelsByDay.has(row.projectDay))channelsByDay.set(row.projectDay,[]);
     channelsByDay.get(row.projectDay).push(row.channelID);
   }
   const queue=[];
   for(const [day,ids] of channelsByDay){
     for(let i=0;i<ids.length;i+=MAX_WEDDING_STATUS_IDS)queue.push({day,channelIds:ids.slice(i,i+MAX_WEDDING_STATUS_IDS)});
   }
   const ctl=new AbortController();statusReader=ctl;
   const live=()=>statusReader===ctl&&!ctl.signal.aborted&&current(actor,ticket);
   const worker=async()=>{
     while(queue.length&&live()){
       const scope={owner:actor,...queue.shift()};
       try{
         const data=await readStatus({...scope,signal:ctl.signal});
         if(!live())return;
         const verified=decodeWeddingStatus(data,scope), currentDay=statusByDay.get(scope.day)??new Map();
         for(const [channel,item] of verified)currentDay.set(channel,item);
         statusByDay.set(scope.day,currentDay);
       }catch{/* Keep unknown on errors and partial reads. */}
     }
   };
   void Promise.all(Array.from({length:Math.min(3,queue.length)},worker)).then(()=>{if(live())draw();});
 }
 function readCandidate(row,actor){
   if(row.owner!==actor||!row.added_at||!row.project_day)throw Error('invalid row');
   return weddingCandidate(actor,{name:row.channel_name,note:row.evidence_note,
     channelUrl:'https://www.youtube.com/channel/'+row.channel_id,
     evidenceUrl:'https://www.youtube.com/watch?v='+row.video_id},new Date(row.added_at),row.project_day);
 }
 async function readRows(actor,ticket){
   const items=[];
   let last='';
   for(let page=0;page<21;page++){
     if(!current(actor,ticket))return null;
     let query=client.from(shortlistTable).select('owner,channel_id,video_id,channel_name,evidence_note,project_day,added_at')
       .eq('owner',actor).order('channel_id',{ascending:true}).limit(100);
     if(last)query=query.gt('channel_id',last);
     const r=await query;
     if(!current(actor,ticket))return null;
     if(r.error||!Array.isArray(r.data))throw Error('read');
     if(r.data.length===0)return items;
     items.push(...r.data.map(item=>readCandidate(item,actor)));
     if(r.data.length<100)return items;
     const next=r.data.at(-1).channel_id;
     if(!next||next===last)throw Error('page');
     last=next;
   }
   throw Error('result limit');
 }
 async function verify(session){
   recoveryUi?.revoke();recoveryUi=null;
   statusReader?.abort();statusReader=null;statusByDay=new Map();
   for(const ctl of mailByDay.values())ctl.refreshed();
   const ticket=++epoch, requested=session?.user?.id;
   if(disposed)return;
   if(!requested||(expectedOwner&&requested!==expectedOwner)){clear();auth.textContent='로그인 후 이용하세요.';return;}
   if(owner!==requested){clear();auth.textContent='로그인 확인 중…';}
   panel.hidden=true;
   try{
     const {data,error}=await client.auth.getUser();
     if(disposed||ticket!==epoch)return;
     if(error||data.user?.id!==requested)throw Error();
     const member=await client.rpc('sanji_is_member');
     if(disposed||ticket!==epoch)return;
     if(member.error||member.data!==true)throw Error();
     const project=await client.from(projectTable).select('owner,title').eq('owner',requested).maybeSingle();
     if(disposed||ticket!==epoch)return;
     if(project.error)throw Error();
     if(!project.data){clear();auth.textContent='이 계정에 등록된 별도 프로젝트가 없습니다.';return;}
     if(project.data.owner!==requested||typeof project.data.title!=='string'||!project.data.title.trim())throw Error();
     owner=requested;
     const next=await readRows(requested,ticket);
     if(!current(requested,ticket)||!next)return;
     let nextContacts=null;
     try { nextContacts=await readVerifiedProjectContacts({client,owner:requested,shortlist:next,current:()=>current(requested,ticket)}); }
     catch { /* An unavailable evidence query must not look like zero verified contacts. */ }
     if(!current(requested,ticket))return;
     rows=next;contacts=nextContacts;uncertain=false;saving=false;heading.textContent=project.data.title;
     auth.textContent=mailRequest&&readMailCopy?'공개 업무 이메일 확인 · 날짜별 발송·예약':'비즈니스 주소 확인 · 발송 기능 없음';panel.hidden=false;subscriberRefresh.hidden=typeof refreshSubscribers!=='function';researchHost.hidden=typeof researchRequest!=='function';draw();refreshMailStatuses(requested,ticket);
     if(recoveryHost&&typeof mailRequest==='function'){
       const active=()=>current(requested,ticket)&&!panel.hidden&&root.isConnected&&root.contains(recoveryHost);
       recoveryUi=createWeddingRecoveryUi({host:recoveryHost,document,active,
         request:({body,stillActive})=>mailRequest({owner:requested,body,stillActive}),
         afterQueued:()=>{if(active())refreshMailStatuses(requested,ticket);}
       });
       void recoveryUi.load();
     }
     if(mountCopy){
       const details=element('details','');
       details.id='wedding-copy-panel';
       const host=element('div','기본 카피를 불러오는 중…');
       host.setAttribute('role','status');
       details.append(element('summary','기본 이메일 카피'),host);
       copyDetails?.remove();copyDetails=details;
       panel.prepend(details);
       mountCopy(host);
     }
   }catch{if(!disposed&&ticket===epoch){clear();auth.textContent='워크스페이스 권한 또는 목록을 확인하지 못했습니다. 화면을 다시 열어 주세요.';}}
 }
 // Do not make Supabase calls inside the SDK's auth-event callback.
 function authChanged(event,session){
   if(disposed)return;
   const next=session?.user?.id??null;
   if(expectedOwner&&next!==expectedOwner){
     // Some SDKs deliver INITIAL_SESSION separately from the parent verified session.
     if(event==='INITIAL_SESSION')return;
     revoke();
     return;
   }
   if(next&&next===owner&&event==='TOKEN_REFRESHED')return;
   if(next&&next===owner&&event==='SIGNED_IN'&&!panel.hidden)return;
   const ticket=++epoch;
   if(!next||owner!==next)clear();
   panel.hidden=true;
   setTimeout(()=>{if(!disposed&&ticket===epoch)void verify(session);},0);
 }
 function revoke(){
   disposed=true;
   ++epoch;
   clear();
   auth.textContent='로그인 후 이용하세요.';
 }
 function resume(){
   disposed=false;
   const ticket=++epoch;
   void Promise.resolve().then(()=>client.auth.getSession()).then(({data})=>{
     if(!disposed&&ticket===epoch)void verify(data?.session);
   }).catch(()=>{
     if(!disposed&&ticket===epoch){clear();auth.textContent='로그인 후 이용하세요.';}
   });
 }
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   event.stopPropagation?.();
   if(!owner||disposed||panel.hidden||saving||uncertain||refreshing)return;
   let row;
   try{
     row=weddingCandidate(owner,Object.fromEntries(new FormData(form)));
     if(weddingRows(rows,owner).some(r=>r.channelID===row.channelID))throw Error('이미 이 프로젝트에 저장한 채널입니다.');
   }catch(error){status.textContent=error.message;return;}
   const actor=owner,ticket=epoch;
   saving=true;status.textContent='저장 중…';
   try{
     const session=(await client.auth.getSession())?.data?.session;
     if(!current(actor,ticket))return;
     const token=session?.access_token;
     if(session?.user?.id!==actor||typeof token!=='string'||!token){++epoch;clear();auth.textContent='로그인 후 이용하세요.';return;}
     // Bind the form to its captured owner in both the row and the HTTP authentication.
     // SQL requires this explicit owner to equal auth.uid(), even if credentials change mid-request.
     const r=await client.from(shortlistTable).insert({owner:actor,channel_id:row.channelID,video_id:row.videoID,
       channel_name:row.name,evidence_note:row.note})
       .setHeader('Authorization','Bearer '+token)
       .select('owner,channel_id,video_id,channel_name,evidence_note,project_day,added_at').single();
     if(!current(actor,ticket))return;
     if(r.error)throw Error();
     rows=[...rows,readCandidate(r.data,actor)];form.reset();filter.value='';refreshMailStatuses(actor,ticket);draw();
     status.textContent='후보를 저장했습니다.';
   }catch{
     if(current(actor,ticket)){uncertain=true;status.textContent='저장 결과를 확인하지 못했습니다. 새로고침으로 목록을 확인한 뒤 다시 시도하세요.';}
   }finally{if(current(actor,ticket))saving=false;}
 });
 refresh.addEventListener('click',async()=>{
   if(!owner||disposed||saving||refreshing||subscriberBusy||researchControl.busy())return;
   refreshing=true;
   const ticket=epoch;
   try{
     const session=(await client.auth.getSession())?.data?.session;
     if(!disposed&&ticket===epoch)await verify(session);
   }catch{
     if(!disposed&&ticket===epoch){++epoch;clear();auth.textContent='목록을 불러오지 못했습니다.';}
   }finally{refreshing=false;}
 });
 subscriberRefresh.addEventListener('click',async()=>{
   if(!owner||disposed||panel.hidden||subscriberBusy||researchControl.busy()||typeof refreshSubscribers!=='function')return;
   const actor=owner,ticket=epoch;
   const stillActive=()=>current(actor,ticket)&&!panel.hidden&&root.isConnected;
   subscriberBusy=true;subscriberRefresh.disabled=true;
   subscriberResult.textContent='YouTube에서 구독자 수를 확인 중입니다…';
   try{
     const data=await refreshSubscribers({owner:actor,stillActive});
     if(!stillActive())return;
     const verified=decodeWeddingSubscriberRefresh(data);
     if(!verified)throw Error('Invalid subscriber receipt');
     subscriberResult.textContent=`YouTube 확인 ${verified.total}명: 5만 이상 ${verified.eligible}명 · 5만 미만 ${verified.belowMinimum}명 · 미확인 ${verified.unknown}명. 공개 이메일 확인 여부는 아래 날짜별 목록에 표시됩니다.`;
     refreshMailStatuses(actor,ticket);draw();
   }catch(e){
     if(!stillActive())return;
     subscriberResult.textContent=subscriberRefreshError(e?.partyumSubscriberCode);
   }finally{if(stillActive()){subscriberBusy=false;subscriberRefresh.disabled=false;}}
 });
 filter.addEventListener('change',()=>{if(owner&&!disposed)draw();});

 return {authChanged,revoke,resume,open:actor=>verify({user:{id:actor}})};
}

// The host supplies its verified owner and existing Supabase Auth client. The view
// re-verifies that owner and still applies the existing server-side RLS checks.
export function mountYouTubeWedding(root,{owner,signal,client,mountCopy,readStatus,refreshSubscribers,researchRequest,mailRequest,readMailCopy,mailStorage}={}){
 if(signal?.aborted)return ()=>{};
 if(!root||!owner||!client)return ()=>{};
 const view=createWeddingView(root,{client,expectedOwner:owner,mountCopy,readStatus,refreshSubscribers,researchRequest,mailRequest,readMailCopy,mailStorage});
 const auth=client.auth.onAuthStateChange(view.authChanged);
 let stopped=false;
 const cleanup=()=>{
   if(stopped)return;
   stopped=true;
   signal?.removeEventListener('abort',cleanup);
   auth?.data?.subscription?.unsubscribe();
   view.revoke();
   root.replaceChildren();
 };
 signal?.addEventListener('abort',cleanup,{once:true});
 void view.open(owner);
 return cleanup;
}

// The historic direct URL retains independent sign-in verification and BFCache
// handling, with exactly the same view and data operations as the inline panel.
export function startStandaloneYouTubeWedding(root,client,{readStatus}={}){
 const view=createWeddingView(root,{client,readStatus});
 client.auth.onAuthStateChange(view.authChanged);
 const win=root.ownerDocument.defaultView;
 win.addEventListener('pagehide',view.revoke);
 win.addEventListener('pageshow',event=>{if(event.persisted)view.resume();});
}
