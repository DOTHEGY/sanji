import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './supabase-config.js';
import { weddingCandidate, weddingRows } from './youtube-wedding-model.mjs';
const client = createClient(supabaseUrl, supabaseKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}});
const $ = id => document.getElementById(id);
const heading=$('wedding-heading'), panel=$('wedding-panel'), auth=$('wedding-auth'), form=$('wedding-form'),
  status=$('wedding-status'), filter=$('wedding-day'), list=$('wedding-list'), refresh=$('wedding-refresh');
const generic='별도 YouTube 프로젝트', projectTable='sanji_private_wedding_projects', shortlistTable='sanji_private_wedding_shortlist';
let owner=null, epoch=0, rows=[], disposed=false, saving=false, uncertain=false, refreshing=false;
const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
const link=(label,address)=>{const node=element('a',label);node.href=address;node.target='_blank';node.rel='noopener noreferrer';return node;};
const current=(actor,ticket)=>!disposed&&ticket===epoch&&owner===actor;
function clear(){
  owner=null;rows=[];panel.hidden=true;heading.textContent=generic;saving=false;uncertain=false;refreshing=false;
  status.textContent='';form.reset();filter.replaceChildren(new Option('전체',''));list.replaceChildren();
}
function draw(){
  const day=filter.value, all=weddingRows(rows,owner);
  const days=[...new Set(all.map(r=>r.projectDay))];
  filter.replaceChildren(new Option('전체',''), ...days.map(d=>new Option(d,d)));
  filter.value=days.includes(day)?day:'';
  const visible=weddingRows(rows,owner,filter.value);
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
  if(!requested){clear();auth.textContent='로그인 후 이용하세요.';return;}
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
    rows=next;uncertain=false;saving=false;heading.textContent=project.data.title;auth.textContent='후보 조사 목록 · 메일 기능 없음';panel.hidden=false;draw();
  }catch{if(!disposed&&ticket===epoch){clear();auth.textContent='워크스페이스 권한 또는 목록을 확인하지 못했습니다. 화면을 다시 열어 주세요.';}}
}
// Do not await Supabase calls inside the SDK's auth-event callback.
client.auth.onAuthStateChange((event,session)=>{
  if(disposed)return;
  const next=session?.user?.id??null;
  if(next&&next===owner&&event==='TOKEN_REFRESHED')return;
  if(next&&next===owner&&event==='SIGNED_IN'&&!panel.hidden)return;
  const ticket=++epoch;
  if(!next||owner!==next)clear();
  panel.hidden=true;
  setTimeout(()=>{if(!disposed&&ticket===epoch)void verify(session);},0);
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
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
window.addEventListener('pagehide',()=>{disposed=true;++epoch;clear();});
window.addEventListener('pageshow',event=>{if(event.persisted){disposed=false;const ticket=epoch;void client.auth.getSession().then(({data})=>{if(!disposed&&ticket===epoch)void verify(data?.session);});}});
