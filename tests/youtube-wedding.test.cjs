const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),esbuild=require('esbuild');
const fixture={name:'Synthetic Fixture <script>alert(1)</script>',channelUrl:'https://m.youtube.com/channel/UC'+'a'.repeat(22)+'/?tracking=strip',evidenceUrl:'https://youtu.be/ZXCVbnm1234?t=1',note:'확인용 가상 웨딩 콘텐츠 근거'};
class Node {
 constructor(text='',value=''){this.textContent=text;this.value=value;this.children=[];this.handlers={};}
 append(...args){this.children.push(...args);}
 setAttribute(name,value){this[name]=value;}
 replaceChildren(...args){this.children=args;}
 addEventListener(name,cb){this.handlers[name]=cb;}
 reset(){this.input={};}
}
async function harness({embedded=false}={}){
 const entry=embedded?{stdin:{resolveDir:path.resolve('web'),contents:"import { mountYouTubeWedding } from './youtube-wedding-mount.js'; globalThis.mountFixture=mountYouTubeWedding;"}}:
  {entryPoints:[path.resolve('web/youtube-wedding.js')]};
 const code=(await esbuild.build({...entry,bundle:true,write:false,plugins:[{
  name:'mock-supabase',setup(build){
   build.onResolve({filter:/^@supabase\/supabase-js$/},()=>({namespace:'mock',path:'auth'}));
   build.onLoad({namespace:'mock',filter:/.*/},()=>({contents:'export const createClient=()=>mockClient'}));
  }
 }]})).outputFiles[0].text;
 const nodes={}, events={}, get=id=>nodes[id]??(nodes[id]=new Node());
 const state={actor:null,allowed:true,wait:null,sessionWait:null,requestWait:null,calls:[],rows:[],contacts:[],contactReads:[],contactWait:null,contactFailure:false,project:true,loadOthers:false,failure:false,inserts:0}; let change;
 const mockClient={auth:{
  onAuthStateChange(cb){change=cb;cb('INITIAL_SESSION',null);return {data:{subscription:{unsubscribe(){state.unsubscribed=true}}}}},
  async getUser(){state.calls.push('getUser');return state.wait??{data:{user:{id:state.actor}}}},
  async getSession(){const actor=state.actor;if(state.sessionWait)await state.sessionWait;return {data:{session:actor?{user:{id:actor},access_token:'fixture-token-'+actor}:null}}}
 },async rpc(name){state.calls.push(name);return {data:state.allowed}},
 from(table){
  if(table==='sanji_private_wedding_contacts'){
   let actor,ids;
   const q={select(){return q},eq(k,v){assert.equal(k,'owner');actor=v;return q},in(k,v){assert.equal(k,'channel_id');ids=v;return q},limit(limit){assert.equal(limit,ids.length+1);return q},
    then(resolve,reject){state.contactReads.push({actor,ids});return (async()=>{
     if(state.contactWait)await state.contactWait;
     return state.contactFailure?{error:true}:{data:state.contacts.filter(r=>r.owner===actor&&ids.includes(r.channel_id))};
    })().then(resolve,reject)}};
   return q;
  }
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
 const root=new Node();
 const document={getElementById:id=>id==='wedding-root'?root:get(id),createElement:()=>new Node(),createTextNode:t=>t,defaultView:{addEventListener:(n,c)=>events[n]=c}};
 Object.assign(root,{ownerDocument:document,querySelector:sel=>get(sel.slice(1)),replaceChildren(){this.innerHTML='';}});
 const context={mockClient,document,Option:Node,URL,setTimeout,FormData:class{constructor(form){return Object.entries(form.input??{});}}};
 vm.runInNewContext(code,context);
 const auth=(actor)=>{state.actor=actor;change('CHANGED',actor?{user:{id:actor}}:null);};
 const tick=()=>new Promise(r=>setTimeout(r,10));
 return {get,state,auth,tick,events,root,mount:(owner,signal)=>context.mountFixture(root,{owner,signal,client:mockClient})};
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
test('standalone route and native panel share the same private view without send or schedule',()=>{
 const old=fs.readFileSync('public/workspace/youtube/index.html','utf8'),child=fs.readFileSync('public/workspace/youtube/wedding/index.html','utf8');
 assert.match(child,/id="wedding-root"/);
 assert.doesNotMatch(old,/\.\/wedding\//);
 const entry=fs.readFileSync('web/youtube-wedding.js','utf8');
 assert.match(entry,/startStandaloneYouTubeWedding[(]root, client[)]/);
 const source=fs.readFileSync('web/youtube-wedding-mount.js','utf8');
 assert.match(source,/export function mountYouTubeWedding/);
 assert.match(source,/root\.querySelector/);
 assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|mailto:|iframe|youtube-manual-(?:mail|scheduler)|(?:id|name)="(?:send|schedule|subject|email)"/i);
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
test('embedded view reuses explicit client and abort removes scoped content and drops a stale owner response',async()=>{
 const {get,state,auth,tick,root,mount}=await harness({embedded:true});
 const abort=new AbortController();
 let finish;state.actor='a';state.wait=new Promise(r=>finish=r);
 const cleanup=mount('a',abort.signal);
 assert.match(root.innerHTML,/data-wedding-project/);
 assert.deepEqual(state.calls,['getUser']);
 abort.abort();
 assert.equal(root.innerHTML,'');
 assert.equal(state.unsubscribed,true);
 finish({data:{user:{id:'a'}}});await tick();
 assert.equal(get('wedding-panel').hidden,true);
 assert.deepEqual(state.calls,['getUser']);
 cleanup(); // idempotent
 assert.equal(root.innerHTML,'');
 const timer=new AbortController();state.wait=null;state.actor='a';
 const destroy=mount('a',timer.signal);
 await tick();
 assert.equal(get('wedding-panel').hidden,false);
 get('wedding-form').input=fixture;
 await get('wedding-form').handlers.submit({preventDefault(){}});
 assert.equal(get('wedding-list').children.length,1);
 auth('b'); // The old host cannot load a second owner.
 assert.equal(get('wedding-list').children.length,0);
 assert.equal(get('wedding-panel').hidden,true);
 await tick();
 assert.equal(state.calls.filter(c=>c==='project').length,1);
 destroy();
});

test('standalone BFCache restoration requires fresh session and owner evidence',async()=>{
 const {get,state,auth,tick,events}=await harness();
 auth('a');await tick();
 assert.equal(get('wedding-panel').hidden,false);
 events.pagehide();
 assert.equal(get('wedding-panel').hidden,true);
 state.actor='b';events.pageshow({persisted:true});await tick();
 assert.equal(get('wedding-panel').hidden,false);
 assert.equal(state.calls.filter(c=>c==='project').length,2);
});

test('owner verified list does not rename original evidence; source failure is unknown, not zero',async()=>{
 const {get,state,auth,tick}=await harness(),channel='UC'+'a'.repeat(22);
 state.rows.push({owner:'a',channel_id:channel,channel_name:'Synthetic',video_id:'ZXCVbnm1234',project_day:'2026-11-21',added_at:'2026-11-21T15:00:00Z',evidence_note:'Research only'});
 state.contacts.push({owner:'a',channel_id:channel,email:'partnerships@example.com',source_url:'https://creator.example.com/contact',source_kind:'official_website',verified_at:new Date(Date.now()-1800).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});
 auth('a');await tick();
 assert.equal(get('wedding-contact-list').children.length,1);
 const group=get('wedding-contact-list').children[0];
 assert.equal(group.children[0].textContent,'2026-11-21 · 발굴일 (KST)');
 const row=group.children[2].children[0].children[1].children[0];
 assert.equal(row.children[1].textContent,'partnerships@example.com');
 assert.equal(row.children[0].children[1].children[3].href,'https://creator.example.com/contact');
 assert.equal(row.children[2].children[0].textContent,'확인 필요');
 assert.match(get('wedding-contact-status').textContent,/확인 1개 · 조사 기록 1개/);
 assert.equal(get('wedding-list').children.length,1);
 state.contactFailure=true;await get('wedding-refresh').handlers.click();
 assert.equal(get('wedding-contact-list').children.length,1);
 assert.match(get('wedding-contact-list').children[0].children[1].textContent,/확인 필요 1명/);
 assert.match(get('wedding-contact-status').textContent,/불러오지 못했습니다/);
 assert.equal(get('wedding-list').children.length,1);
});

test('late owner contact read is discarded after account changes',async()=>{
 const {get,state,auth,tick}=await harness(),channel='UC'+'a'.repeat(22);
 state.rows.push({owner:'a',channel_id:channel,channel_name:'Synthetic',video_id:'ZXCVbnm1234',project_day:'2026-11-21',added_at:'2026-11-21T15:00:00Z',evidence_note:'Research only'});
 state.contacts.push({owner:'a',channel_id:channel,email:'partnerships@example.com',source_url:'https://creator.example.com/contact',source_kind:'official_website',verified_at:new Date(Date.now()-1800).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});
 let finish;state.contactWait=new Promise(r=>finish=r);
 auth('a');await tick();assert.equal(state.contactReads.length,1);
 auth('b');await tick();finish();await tick();
 assert.equal(get('wedding-contact-list').children.length,0);
 assert.match(get('wedding-contact-status').textContent,/확인 0개 · 조사 기록 0개/);
 assert.equal(state.inserts,0);
});
