const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),esbuild=require('esbuild');
const fixture={name:'Synthetic Fixture <script>alert(1)</script>',channelUrl:'https://m.youtube.com/channel/UC'+'a'.repeat(22)+'/?tracking=strip',evidenceUrl:'https://youtu.be/ZXCVbnm1234?t=1',note:'확인용 가상 웨딩 콘텐츠 근거'};
class Node {
 constructor(text='',value=''){this.textContent=text;this.value=value;this.children=[];this.handlers={};}
 append(...args){this.children.push(...args);}
 replaceChildren(...args){this.children=args;}
 addEventListener(name,cb){this.handlers[name]=cb;}
 reset(){this.input={};}
}
async function harness(){
 const code=(await esbuild.build({entryPoints:[path.resolve('web/youtube-wedding.js')],bundle:true,write:false,plugins:[{
  name:'mock-supabase',setup(build){
   build.onResolve({filter:/^@supabase\/supabase-js$/},()=>({namespace:'mock',path:'auth'}));
   build.onLoad({namespace:'mock',filter:/.*/},()=>({contents:'export const createClient=()=>mockClient'}));
  }
 }]})).outputFiles[0].text;
 const nodes={}, events={}, get=id=>nodes[id]??(nodes[id]=new Node());
 const state={actor:null,allowed:true,wait:null,sessionWait:null,requestWait:null,calls:[],rows:[],project:true,loadOthers:false,failure:false,inserts:0}; let change;
 const mockClient={auth:{
  onAuthStateChange(cb){change=cb;cb('INITIAL_SESSION',null)},
  async getUser(){state.calls.push('getUser');return state.wait??{data:{user:{id:state.actor}}}},
  async getSession(){const actor=state.actor;if(state.sessionWait)await state.sessionWait;return {data:{session:actor?{user:{id:actor},access_token:'fixture-token-'+actor}:null}}}
 },async rpc(name){state.calls.push(name);return {data:state.allowed}},
 from(table){
  let currentOwner,inserted,last,authorization;
  assert.ok(['sanji_private_wedding_projects','sanji_private_wedding_shortlist'].includes(table));
  const q={select(){return q},eq(k,v){assert.equal(k,'owner');currentOwner=v;return q},order(){return q},limit(){return q},gt(k,v){assert.equal(k,'channel_id');last=v;return q},
  async maybeSingle(){state.calls.push('project');return {data:state.project?{owner:currentOwner,title:'Private fixture title'}:null}},
  then(resolve){state.calls.push('list');return Promise.resolve({data:state.rows.filter(r=>(state.loadOthers||r.owner===currentOwner)&&(!last||r.channel_id>last)).slice(0,100)}).then(resolve)},
  insert(value){assert.deepEqual(Object.keys(value).sort(),['channel_id','channel_name','evidence_note','owner','video_id']);state.inserts++;inserted=value;return q},
  setHeader(name,value){assert.equal(name,'Authorization');authorization=value;return q},
  async single(){
    if(state.requestWait)await state.requestWait;
    const bearerActor=authorization?.replace('Bearer fixture-token-','')??state.actor;
    if(bearerActor!==inserted.owner)return {error:{code:'42501'}};
    const row={...inserted,project_day:'2026-11-21',added_at:'2026-11-21T15:00:00Z'};state.rows.push(row);
    if(state.failure)throw Error('uncertain');
    return {data:row};
  }
  };return q;
 }};
 vm.runInNewContext(code,{mockClient,document:{getElementById:get,createElement:()=>new Node(),createTextNode:t=>t},Option:Node,
  URL,window:{addEventListener:(n,c)=>events[n]=c},setTimeout,FormData:class{constructor(form){return Object.entries(form.input??{});}}});
 const auth=(actor)=>{state.actor=actor;change('CHANGED',actor?{user:{id:actor}}:null);};
 const tick=()=>new Promise(r=>setTimeout(r,10));
 return {get,state,auth,tick,events};
}
test('canonical evidence, KST date, and owner/project isolation',async()=>{
 const m=await import('../web/youtube-wedding-model.mjs');
 const row=m.weddingCandidate('a',fixture,new Date('2026-11-21T15:00:00Z'));
 assert.equal(row.channelUrl,'https://www.youtube.com/channel/UC'+'a'.repeat(22));
 assert.equal(row.evidenceUrl,'https://www.youtube.com/watch?v=ZXCVbnm1234');
 assert.deepEqual(m.weddingRows([row,{...row,owner:'b'},{...row,projectId:'gs-bbangteojineunjip-chewy-bread'}],'a','2026-11-22'),[row]);
 assert.deepEqual(m.weddingRows([row],'a','2026-11-21'),[]);
 const imported=m.weddingCandidate('a',fixture,new Date('2026-11-22T15:00:00Z'),'2026-11-21');
 assert.equal(imported.addedAt,'2026-11-22T15:00:00.000Z');
 assert.deepEqual(m.weddingRows([imported],'a','2026-11-21'),[imported]);
 assert.throws(()=>m.weddingCandidate('a',fixture,new Date(),'2026-02-30'));
 for(const evidenceUrl of ['https://youtube.com.evil.test/watch?v=ZXCVbnm1234','https://joe@youtube.com/watch?v=ZXCVbnm1234','https://www.youtube.com/@channel'])assert.throws(()=>m.weddingCandidate('a',{...fixture,evidenceUrl}));
 assert.throws(()=>m.weddingCandidate('',fixture));
});
test('standalone route rejects outsiders, persists against owner shortlist, dedups and clears on switch',async()=>{
 const {get,state,auth,tick,events}=await harness();
 await tick();assert.equal(get('wedding-panel').hidden,true);
 state.allowed=false;auth('outsider');await tick();assert.equal(get('wedding-panel').hidden,true);
 state.allowed=true;auth('a');await tick();assert.equal(get('wedding-panel').hidden,false);
 const f=get('wedding-form'),list=get('wedding-list');
 assert.equal(get('wedding-heading').textContent,'Private fixture title');
 f.input=fixture;await f.handlers.submit({preventDefault(){}});assert.equal(list.children.length,1);
 assert.equal(list.children[0].children[0].textContent,fixture.name);
 f.input=fixture;await f.handlers.submit({preventDefault(){}});assert.match(get('wedding-status').textContent,/이미/);
 assert.equal(list.children.length,1);
 auth('b');assert.equal(list.children.length,0);await tick();assert.equal(list.children.length,0);
 assert.equal(get('wedding-panel').hidden,false);
 assert.equal(state.inserts,1);
 assert.deepEqual(state.calls,['getUser','sanji_is_member','getUser','sanji_is_member','project','list','getUser','sanji_is_member','project','list']);
 auth('a');await tick();assert.equal(list.children.length,1);
 events.pagehide();assert.equal(get('wedding-panel').hidden,true);assert.equal(list.children.length,0);
});
test('stale previous owner response cannot re-open after logout',async()=>{
 const {get,state,auth,tick}=await harness();
 let release;state.wait=new Promise(r=>{release=r;});
 auth('former');await tick();assert.deepEqual(state.calls,['getUser']);
 auth(null);release({data:{user:{id:'former'}}});await tick();
 assert.equal(get('wedding-panel').hidden,true);
 assert.equal(get('wedding-heading').textContent,'별도 YouTube 프로젝트');
 assert.deepEqual(state.calls,['getUser']);
});
test('blank route is owner-gated, isolated from old YouTube page, and only loaded by workspace tab',()=>{
 const parent=fs.readFileSync('private/ui/app.js','utf8'),old=fs.readFileSync('public/workspace/youtube/index.html','utf8'),child=fs.readFileSync('public/workspace/youtube/wedding/index.html','utf8');
 assert.match(parent,/me = await api\("\/me"\)/);
 assert.match(parent,/id="youtube-pane-empty" role="tabpanel"[^>]+ hidden><\/div>/);
 assert.match(parent,/index===1&&!panes\[1\]\.querySelector\('iframe'\)/);
 assert.match(parent,/frame\.src='\.\/youtube\/wedding\/'/);
 assert.doesNotMatch(old,/\.\/wedding\//);
 assert.doesNotMatch(child,/mailto:|(?:id|name)="(?:send|schedule|subject|email)"/i);
 const source=fs.readFileSync('web/youtube-wedding.js','utf8');
 assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|mailto:|youtube-manual-(?:mail|scheduler)/i);
});

test('uncertain save blocks replay until a verified refresh; cross-owner response fails closed',async()=>{
 const {get,state,auth,tick}=await harness();
 auth('a');await tick();
 const f=get('wedding-form'),list=get('wedding-list');
 state.failure=true;f.input=fixture;await f.handlers.submit({preventDefault(){}});
 assert.match(get('wedding-status').textContent,/확인하지 못했습니다/);
 await f.handlers.submit({preventDefault(){}});
 assert.equal(state.inserts,1);
 await get('wedding-refresh').handlers.click();assert.equal(list.children.length,1);
 state.loadOthers=true;auth('b');await tick();
 assert.equal(get('wedding-panel').hidden,true);
 assert.equal(list.children.length,0);
});
test('unseeded owner cannot query shortlist or submit',async()=>{
 const {get,state,auth,tick}=await harness();state.project=false;auth('unseeded');await tick();
 assert.equal(get('wedding-panel').hidden,true);
 assert.deepEqual(state.calls,['getUser','sanji_is_member','project']);
 await get('wedding-form').handlers.submit({preventDefault(){}});
 assert.equal(state.inserts,0);
});

test('two configured owners: a deferred submit is dropped if the account changes before session check',async()=>{
 const {get,state,auth,tick}=await harness();
 auth('a');await tick();assert.equal(get('wedding-panel').hidden,false);
 let release;state.sessionWait=new Promise(r=>{release=r;});
 const form=get('wedding-form');form.input=fixture;
 const submitting=form.handlers.submit({preventDefault(){}});
 auth('b');await tick();assert.equal(get('wedding-panel').hidden,false);
 release();await submitting;
 assert.equal(state.inserts,0);
 assert.deepEqual(state.rows,[]);
});
test('two configured owners: SDK credentials switch during deferred request without an auth event',async()=>{
 const {get,state,auth,tick}=await harness();
 auth('a');await tick();assert.equal(get('wedding-panel').hidden,false);
 let release;state.requestWait=new Promise(r=>{release=r;});
 const form=get('wedding-form');form.input=fixture;
 const submitting=form.handlers.submit({preventDefault(){}});
 await tick();assert.equal(state.inserts,1);
 state.actor='b'; // SDK has switched while the app has not received a change event.
 release();await submitting;
 assert.deepEqual(state.rows.map(r=>r.owner),['a']);
 assert.equal(get('wedding-list').children.length,1);
 auth('b');await tick();assert.equal(get('wedding-list').children.length,0);
 assert.equal(get('wedding-panel').hidden,false);
});
test('installed Supabase SDK preserves explicit Authorization while its internal credential lookup switches',async()=>{
 const {createClient}=require('@supabase/supabase-js');let sdkCalls=0, release, started;
 const wait=new Promise(r=>{release=r;}),lookup=new Promise(r=>{started=r;});
 const requests=[];
 const sdk=createClient('https://example.invalid','sb_publishable_fixture',{
  accessToken(){if(sdkCalls++===0)return Promise.resolve(null);started();return wait;},
  global:{fetch:async (url,init)=>{
   requests.push({path:new URL(url).pathname,authorization:new Headers(init.headers).get('Authorization'),body:JSON.parse(init.body)});
   return new Response(JSON.stringify({owner:'a'}),{headers:{'Content-Type':'application/json'}});
  }},
 });
 const sending=(async()=>await sdk.from('sanji_private_wedding_shortlist').insert({owner:'a'})
   .setHeader('Authorization','Bearer fixture-token-a').select('owner').single())();
 await lookup;release('fixture-token-b');const response=await sending;
 assert.equal(response.error,null);
 assert.deepEqual(requests,[{path:'/rest/v1/sanji_private_wedding_shortlist',authorization:'Bearer fixture-token-a',body:{owner:'a'}}]);
});
test('workspace tab mounts the authenticated project iframe once, without rebuilding the existing frame',()=>{
 const app=fs.readFileSync('private/ui/app.js','utf8');
 const logic=app.slice(app.indexOf('function mountYoutubeProjectTabs('),app.indexOf('function syncYoutubeEmailHost('));
 const tabs=['existing','empty'].map(key=>({
  on:{},classList:{toggle(){}},
  getAttribute(){return key},setAttribute(k,v){this[k]=v},
  addEventListener(k,v){this.on[k]=v},focus(){this.focused=true}
 }));
 let opens=0;
 const untouchedFrame={draft:'synthetic existing draft'};
 const frame={};
 const panes={existing:{hidden:false,frame:untouchedFrame},empty:{hidden:true,querySelector(q){assert.equal(q,'iframe');return this.frame||null;},
  append(value){assert.equal(value,frame);assert.equal(value.src,'./youtube/wedding/');opens++;this.frame=value;}}};
 const host={ownerDocument:{createElement(tag){assert.equal(tag,'iframe');return frame;}},querySelectorAll(){return tabs},querySelector(q){return panes[q.slice(1)]}};
 vm.runInNewContext(logic+'mountYoutubeProjectTabs(host)',{host});
 assert.equal(opens,0);assert.equal(panes.empty.frame,undefined);
 tabs[1].on.click();assert.equal(opens,1);assert.equal(panes.existing.hidden,true);assert.equal(panes.empty.hidden,false);
 tabs[1].on.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(tabs[0].focused,true);
 assert.equal(panes.existing.hidden,false);assert.equal(panes.empty.hidden,true);
 tabs[1].on.click();assert.equal(opens,1);assert.equal(panes.existing.frame,untouchedFrame);assert.equal(panes.empty.frame,frame);
});
