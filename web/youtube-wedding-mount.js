import { researchDay, weddingCandidate, weddingRows } from './youtube-wedding-model.mjs';
import { verifiedContactsForDay, readVerifiedProjectContacts } from './youtube-verified-project-contacts.mjs';

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
[data-wedding-project] [hidden] { display:none!important; }
</style>
<header><h2 id="wedding-heading">별도 YouTube 프로젝트</h2></header>
<p id="wedding-auth" role="status">로그인 확인 중…</p>
<section id="wedding-panel" class="panel" hidden>
<h3>공개 비즈니스 주소 확인 후보</h3>
<p>채널 또는 공식 사이트에서 용도가 확인된 협업 문의 주소만 표시합니다. 발송·예약에는 연결되지 않습니다.</p>
<label for="wedding-day">조사일 (한국시간)</label><select id="wedding-day"><option value="">전체</option></select>
<p id="wedding-contact-status" role="status"></p>
<ul id="wedding-contact-list"></ul>
<button id="wedding-refresh" type="button">목록 새로고침</button>
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
<ul id="wedding-list"></ul>
</details>
</section>
</div>`;

function createWeddingView(root,{client,expectedOwner=null,mountCopy}){
 root.innerHTML=markup;
 const document=root.ownerDocument;
 const $ = id => root.querySelector('#'+id);
 const heading=$('wedding-heading'), panel=$('wedding-panel'), auth=$('wedding-auth'), form=$('wedding-form'),
   status=$('wedding-status'), filter=$('wedding-day'), list=$('wedding-list'), refresh=$('wedding-refresh'),
   contactStatus=$('wedding-contact-status'), contactList=$('wedding-contact-list');
 const generic='별도 YouTube 프로젝트', projectTable='sanji_private_wedding_projects', shortlistTable='sanji_private_wedding_shortlist';
 let copyDetails=null,owner=null, epoch=0, rows=[], contacts=null, disposed=false, saving=false, uncertain=false, refreshing=false;
 const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const link=(label,address)=>{const node=element('a',label);node.href=address;node.target='_blank';node.rel='noopener noreferrer';return node;};
 const current=(actor,ticket)=>!disposed&&ticket===epoch&&owner===actor;
 function clear(){
   owner=null;rows=[];contacts=null;copyDetails?.remove();copyDetails=null;panel.hidden=true;heading.textContent=generic;saving=false;uncertain=false;refreshing=false;
   status.textContent='';contactStatus.textContent='';contactList.replaceChildren();form.reset();filter.replaceChildren(new Option('전체',''));list.replaceChildren();
 }
 function draw(){
   const day=filter.value, all=weddingRows(rows,owner);
   const days=[...new Set(all.map(r=>r.projectDay))];
   filter.replaceChildren(new Option('전체',''), ...days.map(d=>new Option(d,d)));
   filter.value=days.includes(day)?day:'';
   const visible=weddingRows(rows,owner,filter.value);
   const verified=contacts===null?null:verifiedContactsForDay(contacts,filter.value);
   contactStatus.textContent=verified===null
     ? '주소 확인 목록을 불러오지 못했습니다. 조사 원본은 아래에서 볼 수 있습니다.'
     : `공개 비즈니스 주소 확인 ${verified.length}개 · 조사 기록 ${visible.length}개`;
   contactList.replaceChildren(...(verified??[]).map(row=>{
     const item=element('li','');
     item.append(element('strong',row.name),element('p',row.email),
       element('p',row.projectDay+' · 주소 확인 '+researchDay(row.verifiedAt)),link('주소 확인 출처',row.sourceUrl));
     return item;
   }));
   list.replaceChildren(...visible.map(row=>{
     const item=element('li','');
     item.append(element('strong',row.name),element('p',row.projectDay+' · '+row.note),link('채널 원문',row.channelUrl),document.createTextNode(' · '),link('영상 근거',row.evidenceUrl));
     return item;
   }));
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
     auth.textContent='비즈니스 주소 확인 · 발송 기능 없음';panel.hidden=false;draw();
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
     rows=[...rows,readCandidate(r.data,actor)];form.reset();filter.value='';draw();
     status.textContent='후보를 저장했습니다.';
   }catch{
     if(current(actor,ticket)){uncertain=true;status.textContent='저장 결과를 확인하지 못했습니다. 새로고침으로 목록을 확인한 뒤 다시 시도하세요.';}
   }finally{if(current(actor,ticket))saving=false;}
 });
 refresh.addEventListener('click',async()=>{
   if(!owner||disposed||saving||refreshing)return;
   refreshing=true;
   const ticket=epoch;
   try{
     const session=(await client.auth.getSession())?.data?.session;
     if(!disposed&&ticket===epoch)await verify(session);
   }catch{
     if(!disposed&&ticket===epoch){++epoch;clear();auth.textContent='목록을 불러오지 못했습니다.';}
   }finally{refreshing=false;}
 });
 filter.addEventListener('change',()=>{if(owner&&!disposed)draw();});

 return {authChanged,revoke,resume,open:actor=>verify({user:{id:actor}})};
}

// The host supplies its verified owner and existing Supabase Auth client. The view
// re-verifies that owner and still applies the existing server-side RLS checks.
export function mountYouTubeWedding(root,{owner,signal,client,mountCopy}={}){
 if(signal?.aborted)return ()=>{};
 if(!root||!owner||!client)return ()=>{};
 const view=createWeddingView(root,{client,expectedOwner:owner,mountCopy});
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
export function startStandaloneYouTubeWedding(root,client){
 const view=createWeddingView(root,{client});
 client.auth.onAuthStateChange(view.authChanged);
 const win=root.ownerDocument.defaultView;
 win.addEventListener('pagehide',view.revoke);
 win.addEventListener('pageshow',event=>{if(event.persisted)view.resume();});
}
