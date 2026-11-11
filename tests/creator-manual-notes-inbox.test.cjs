const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=require('../private/ui/creator-manual-notes.js');
// Synthetic historical records only. Never copy private handles or DM content into tests.
const note=(n,extra={})=>({id:`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`,creatorId:`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`,handle:`fictional.${n}`,observedAt:'2020-11-03',recordedAt:`2020-11-03T08:${String(n).padStart(2,'0')}:00.000001+00:00`,sourceUrl:`https://www.instagram.com/direct/t/${100+n}/`,inboundWhen:'상대 시점 미확인',summary:`가상 과거 대화 ${n}`,draft:`가상 미발송 초안 ${n}`,intent:'가상 관심 표시',afterInboundOutbound:'미확인',recorderType:'assistant',supersedesId:null,recordType:'manual_historical_note',latestVerified:false,dispatchState:'not_sent',...extra});
const page=(items,next=null,complete=!next)=>({items,nextBefore:next,complete});
const cursor=n=>({recordedAt:n.recordedAt,id:n.id});
const ids=html=>[...html.matchAll(/data-note-record="([^"]+)"/g)].map(x=>x[1]);
function fixture(responses=[],extra={}){
 const events={},host={isConnected:true,innerHTML:'',addEventListener(k,fn){events[k]=fn;},removeEventListener(k){delete events[k];},contains(){return true;}},state={owner:'owner-a',active:true,calls:[],responses:[...responses],unsubscribed:0};
 const view=ui.mountInboxReader(host,{getOwner:()=>state.owner,isActive:()=>state.active,subscribeSession:fn=>{state.session=fn;return()=>state.unsubscribed++;},request:async(path,body,owner,live)=>{state.calls.push({path,body,owner});assert.equal(live(),true);if(state.wait)await new Promise(resolve=>state.release=resolve);const r=state.responses.shift();if(r instanceof Error)throw r;return r;},...extra});
 const click=(action,id)=>events.click({target:{closest:()=>({dataset:{noteAction:action,noteId:id}})}});
 const order=value=>events.change({target:{matches:s=>s==='[data-note-order]',value}});
 return {host,state,view,events,click,order};
}
test('Inbox reader renders every loaded context and draft in separate review order without official rows or write controls',async()=>{
 const records=Array.from({length:11},(_,i)=>note(i+1)),f=fixture([page([...records].reverse())]);await f.view.load();
 assert.deepEqual(ids(f.host.innerHTML),records.map(n=>n.id));assert.match(f.host.innerHTML,/data-note-count>11명 · 11개 기록/);
 for(const text of ['최신 상태 미확인','미발송 참고 초안','원문 확인일: 2020-11-03','산지 기록 시각:','제공사 수신함·동기화 결과·검증된 초안이 아닙니다','최근 7일·태그바이 근거 필터는 이 메모 목록에 적용하지 않습니다','메모 수는 답장한 사람 수가 아니며','원문 대화 전체를 확인했다는 뜻은 아닙니다'])assert.ok(f.host.innerHTML.includes(text),text);
 for(const n of records){assert.ok(f.host.innerHTML.includes(n.summary));assert.ok(f.host.innerHTML.includes(n.draft));assert.ok(f.host.innerHTML.includes(n.sourceUrl));}
 assert.doesNotMatch(f.host.innerHTML,/<form|<textarea|data-note-file|data-note-action="correct"|data-action="thread"|instagram-official:/);
 assert.deepEqual(f.state.calls,[{path:'/creator-manual-notes/list',body:{},owner:'owner-a'}]);assert.equal(f.view.hasWork(),false);assert.equal(f.view.canClose(),true);
});
test('Inbox reader automatically reads stored pages and preserves correction history and original drafts',async()=>{
 const a=note(1),b=note(2),c=note(3,{creatorId:a.creatorId,handle:a.handle,supersedesId:a.id}),f=fixture([page([c,b],cursor(b)),page([a])],{onReviewProducts:()=>true});await f.view.load();
 assert.deepEqual(ids(f.host.innerHTML),[c.id,a.id,b.id]);assert.deepEqual(f.state.calls.map(x=>x.body),[{}, {before:cursor(b)}]);
 assert.match(f.host.innerHTML,/정정 대상 메모도 현재 목록에 표시됨/);assert.match(f.host.innerHTML,/원래 기록도 유지/);
 assert.match(f.host.innerHTML,new RegExp('data-note-action="review-products" data-note-id="'+a.id+'" disabled'));
 assert.ok(f.host.innerHTML.includes(a.draft));assert.ok(f.host.innerHTML.includes(c.draft));
});
test('Inbox order switch stays local and preserves unknown source times and escaped text',async()=>{
 const a=note(1,{inboundWhen:'어제',draft:'<img src=x onerror="bad()">'}),b=note(2,{inboundWhen:'2020-10-01 오전 9:00'}),f=fixture([page([b,a])]);await f.view.load();
 assert.deepEqual(ids(f.host.innerHTML),[a.id,b.id]);f.order('source');assert.deepEqual(ids(f.host.innerHTML),[b.id,a.id]);assert.match(f.host.innerHTML,/상대 시점 · 날짜 미확정/);assert.match(f.host.innerHTML,/관찰 시각으로 날짜를 계산하지 않음/);assert.match(f.host.innerHTML,/&lt;img/);assert.doesNotMatch(f.host.innerHTML,/<img/);f.order('review');assert.deepEqual(ids(f.host.innerHTML),[a.id,b.id]);assert.equal(f.state.calls.length,1);
});
test('Inbox partial and failed reads never claim complete coverage or erase the last visible records',async()=>{
 const a=note(1),f=fixture([page([a],null,false),new Error('synthetic offline')]);await f.view.load();assert.match(f.host.innerHTML,/전체 저장 목록 수신 미확인/);await f.view.load();assert.deepEqual(ids(f.host.innerHTML),[a.id]);assert.match(f.host.innerHTML,/끝까지 읽지 못했습니다/);assert.doesNotMatch(f.host.innerHTML,/남은 저장 페이지 없음/);
});
test('Inbox pagination rejects repeated cursors and contradictory completion without looping',async()=>{
 const a=note(1),b=note(2),f=fixture([page([b],cursor(b)),page([a],cursor(b))]);await f.view.load();assert.equal(f.state.calls.length,2);assert.deepEqual(ids(f.host.innerHTML),[b.id]);assert.match(f.host.innerHTML,/끝까지 읽지 못했습니다/);assert.doesNotMatch(f.host.innerHTML,/남은 저장 페이지 없음/);
 const g=fixture([page([a],cursor(a),true)]);await g.view.load();assert.deepEqual(ids(g.host.innerHTML),[]);assert.match(g.host.innerHTML,/끝까지 읽지 못했습니다/);
});
test('Inbox reader refuses provider or sent records and unknown actions cannot save',async()=>{
 for(const change of [{recordType:'official'},{latestVerified:true},{dispatchState:'sent'}]){const f=fixture([page([note(1,change)])]);await f.view.load();assert.deepEqual(ids(f.host.innerHTML),[]);for(const action of ['save','target','correct','retry','readback','reset'])await f.click(action);assert.equal(f.state.calls.length,1);}
});
test('Inbox repeated loads deduplicate in flight; session switch erases content and late responses',async()=>{
 const f=fixture([page([note(1)])]);f.state.wait=true;const pending=f.view.load();await f.view.load();assert.equal(f.state.calls.length,1);f.state.owner='owner-b';f.state.session();assert.equal(f.host.innerHTML,'');assert.equal(f.state.unsubscribed,1);f.state.release();await pending;assert.equal(f.host.innerHTML,'');assert.equal(Object.keys(f.events).length,0);
});
test('Inbox navigation and replaced hosts stop auto-pagination and stale paints',async()=>{
 for(const invalidate of [f=>f.state.active=false,f=>f.host.isConnected=false,f=>f.view.destroy()]){const a=note(1),f=fixture([page([a],cursor(a))]);f.state.wait=true;const pending=f.view.load();invalidate(f);const previous=f.host.innerHTML;f.state.release();await pending;assert.equal(f.state.calls.length,1);assert.equal(f.host.innerHTML,previous);assert.deepEqual(ids(f.host.innerHTML),[]);}
});
test('Inbox product review receives exact frozen note and owner; rejected replacement preserves prior selection',async()=>{
 const contexts=[],a=note(1),b=note(2);let accepted=true;const f=fixture([page([b,a]),page([b,a])],{onReviewProducts:(n,context)=>{assert.equal(Object.isFrozen(n),true);assert.equal(context.owner,'owner-a');assert.equal(context.isCurrent(),true);contexts.push({note:n,...context});return accepted;}});await f.view.load();
 f.click('review-products',a.id);assert.deepEqual(contexts[0].note,a);assert.equal(contexts[0].isCurrent(),true);
 accepted=false;f.click('review-products',b.id);assert.equal(contexts[0].isCurrent(),true);assert.equal(contexts[1].isCurrent(),false);
 accepted=true;f.click('review-products',b.id);assert.equal(contexts[0].isCurrent(),false);assert.equal(contexts[2].isCurrent(),true);
 await f.view.load();assert.equal(contexts[2].isCurrent(),false);assert.ok(f.state.calls.every(x=>x.path==='/creator-manual-notes/list'));
});
test('Inbox known corrected originals cannot open product review even through synthetic action events',async()=>{
 let opened=0;const a=note(1),b=note(2,{creatorId:a.creatorId,handle:a.handle,supersedesId:a.id}),f=fixture([page([b,a])],{onReviewProducts:()=>{opened++;return true;}});await f.view.load();f.click('review-products',a.id);assert.equal(opened,0);f.click('review-products',b.id);assert.equal(opened,1);
});
function appFixture(){
 const source=fs.readFileSync('private/ui/app.js','utf8'),block=source.slice(source.indexOf('const MANUAL_NOTES_AVAILABLE = false;'),source.indexOf('\nfunction filterThreads()')).replace('const MANUAL_NOTES_AVAILABLE = false;','const MANUAL_NOTES_AVAILABLE = true;');
 const calls=[],host={isConnected:true,innerHTML:''},app={innerHTML:''},state={callbacks:[],disposed:0,loads:0,options:null};
 const account={id:'synthetic-owner'},context={me:account,location:{hash:'#inbox'},globalThis:{SanjiManualNotes:{mountInboxReader:(h,opt)=>{assert.equal(h,host);state.options=opt;opt.subscribeSession(()=>state.disposed++);return {destroy:()=>state.disposed++,load:()=>state.loads++};}}},manualNotesApi:()=>{},manualClient:{auth:{onAuthStateChange:fn=>{state.callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}};}}},prototypeOpenHistoricalNote:()=>true,prototypeDisposeHistorical:()=>{state.productDisposed=(state.productDisposed||0)+1;},$:selector=>selector==='#app'?app:selector==='#inbox-historical-notes-root'?host:null,instagramInboxOwner:null,instagramInboxCursor:null,instagramInboxOffset:0,instagramInboxHasMore:false,instagramSyncStatus:null,inboxRequestGeneration:0,inboxEdited:false,creatorInboxThreads:[],api:async path=>{calls.push(path);return {items:[],hasMore:false};},toast:()=>{},head:()=>'',button:()=>'',esc:x=>String(x??''),MANUAL_INBOX_AVAILABLE:false,TRANSIENT_INBOX_AVAILABLE:false,inboxFolder:'',inboxProject:'',inboxProjectOptions:()=>[],inboxLifecycle:'active',inboxDateRange:'7d',conversationStatuses:[],filterThreads:()=>{}};
 vm.createContext(context);vm.runInContext(block,context);return {context,host,app,state,calls};
}
test('email Inbox does not mount historical Instagram notes or query Instagram',async()=>{
 const f=appFixture();await f.context.inboxPage();assert.doesNotMatch(f.app.innerHTML,/inbox-historical-notes-root|Instagram|태그바이/);assert.equal(f.state.loads,0);assert.equal(f.context.creatorInboxThreads.length,0);assert.deepEqual(f.calls,['/creator-inbox','/creator-conversation-status']);
});
test('App late Inbox and dirty form guards never replace a live reader or its saved view',async()=>{
 const f=appFixture();f.context.inboxEdited=true;await f.context.inboxPage();assert.equal(f.state.loads,0);assert.equal(f.app.innerHTML,'');
 f.context.inboxEdited=false;let release;f.context.api=async()=>{await new Promise(r=>release=r);return {items:[]};};const pending=f.context.inboxPage();f.context.location.hash='#deals';release();await pending;assert.equal(f.state.loads,0);assert.equal(f.app.innerHTML,'');
});
test('App lifecycle disposes read-only history on auth, route exit, accepted logout and pagehide',()=>{
 const s=fs.readFileSync('private/ui/app.js','utf8');assert.match(s,/async function authPage\(\) \{\s*manualNotesDispose\(\)/);assert.match(s,/function manualNotesDispose\(\)\{[^\n]*inboxNotesDispose\(\)/);assert.match(s,/if\(key!=="inbox"\)\{inboxLifecycle="active";inboxNotesDispose\(\);\}/);assert.match(s,/pagehide',\(\)=>\{manualNotesDispose\(\)/);
 const logout=s.slice(s.indexOf('  async logout() {'),s.indexOf('  "add-brand":'));assert.ok(logout.indexOf('manualNotesDispose()')>logout.indexOf('if(!allowInboxChange())return;'));
});
test('App historical dirty route cancellation retains Inbox and note reader; accepted exit closes the local editor',()=>{
 const source=fs.readFileSync('private/ui/app.js','utf8'),start=source.indexOf('window.addEventListener("hashchange", () => {'),end=source.indexOf('\nwindow.addEventListener("beforeunload"',start);let handler,allowed=false,disposed=0,rendered=0;
 const context={window:{addEventListener:(_n,fn)=>handler=fn},location:{hash:'#deals'},history:{replaceState(_a,_b,hash){context.location.hash=hash;}},manualNotesView:null,transientInboxView:null,$:s=>s==='#instagram-prototype-text'?{}:null,inboxEdited:false,inboxDirtyForms:new Map(),instagramProposalContext:{mode:'historical'},prototypeCanCloseHistorical:()=>allowed,prototypeDisposeHistorical:()=>disposed++,render:()=>rendered++};
 vm.runInNewContext(source.slice(start,end),context);handler();assert.equal(context.location.hash,'#inbox');assert.equal(disposed,0);assert.equal(rendered,0);allowed=true;context.location.hash='#deals';handler();assert.equal(disposed,1);assert.equal(rendered,1);
});
test('App canceled historical logout preserves drafts and reader until all close guards allow it',async()=>{
 const source=fs.readFileSync('private/ui/app.js','utf8'),start=source.indexOf('  async logout() {'),end=source.indexOf('\n  },',start)+5,calls=[];let allowed=false;
 const context={catalogSheetSettingsDispose:()=>calls.push('dispose-sheet'),manualNotesView:null,allowInboxChange:()=>true,$:()=>null,transientInboxView:null,prototypeCanCloseHistorical:()=>allowed,prototypeDisposeHistorical:()=>calls.push('dispose-product'),manualNotesDispose:()=>calls.push('dispose-notes'),transientDispose:()=>calls.push('dispose-transient'),inboxEdited:false,inboxDirtyForms:{clear:()=>{}},api:async()=>calls.push('logout'),location:{reload:()=>calls.push('reload')}};
 const logout=vm.runInNewContext('({'+source.slice(start,end)+'}).logout',context);await logout();assert.deepEqual(calls,[]);allowed=true;await logout();assert.deepEqual(calls,['dispose-sheet','dispose-product','dispose-notes','dispose-transient','logout','reload']);
});
test('Inbox synchronous session loss unsubscribes and never retains private content or initiates a read',async()=>{
 let owner='a',unsubscribed=0,requests=0;const events={},host={isConnected:true,innerHTML:'',addEventListener(k,fn){events[k]=fn;},removeEventListener(k){delete events[k];}};
 const view=ui.mountInboxReader(host,{getOwner:()=>owner,subscribeSession:cb=>{owner='b';cb();return()=>unsubscribed++;},request:async()=>requests++});await view.load();assert.equal(host.innerHTML,'');assert.equal(Object.keys(events).length,0);assert.equal(unsubscribed,1);assert.equal(requests,0);view.destroy();assert.equal(unsubscribed,1);
});
test('App queued stale auth callback cannot clear a newer same-host reader or its product modal',async()=>{
 const f=appFixture();f.context.inboxNotesMount();f.context.inboxNotesMount();f.host.innerHTML='new reader';const current=f.state.options;f.state.callbacks[0]('SIGNED_OUT',null);assert.equal(f.host.innerHTML,'new reader');assert.equal(current.getOwner(),'synthetic-owner');assert.equal(f.state.productDisposed,undefined);f.state.callbacks[1]('SIGNED_OUT',null);assert.match(f.host.innerHTML,/로그인 계정이 변경/);assert.equal(f.state.productDisposed,1);
});

const correct=(n,parent,extra={})=>note(n,{creatorId:parent.creatorId,handle:parent.handle,supersedesId:parent.id,...extra});
const currentIds=p=>p.groups.flatMap(g=>g.current.map(n=>n.id));
const historyIds=p=>p.groups.flatMap(g=>g.history.map(n=>n.id));
test('latest view: eleven people and twenty-two immutable records keep corrected drafts first and originals collapsed',async()=>{
 const originals=Array.from({length:11},(_,i)=>note(i+1)),corrections=originals.map((n,i)=>correct(i+21,n)),records=[...corrections].reverse().concat([...originals].reverse()),before=JSON.stringify(records);
 const f=fixture([page(records.slice(0,20),cursor(records[19])),page(records.slice(20))]);await f.view.load();
 assert.match(f.host.innerHTML,/<option value="latest" selected/);assert.match(f.host.innerHTML,/data-note-count>11명 · 22개 기록/);
 assert.equal((f.host.innerHTML.match(/<details data-note-history>/g)||[]).length,11);assert.doesNotMatch(f.host.innerHTML,/<details data-note-history open/);
 assert.deepEqual(ids(f.host.innerHTML),originals.flatMap((n,i)=>[corrections[i].id,n.id]));assert.equal(JSON.stringify(records),before);
 assert.match(f.host.innerHTML,/최신 대화·검증된 최종본 아님/);assert.match(f.host.innerHTML,/실제 답장 도착 순서가 아닙니다/);
 const calls=f.state.calls.length;f.order('review');assert.deepEqual(ids(f.host.innerHTML),[...originals,...corrections].map(n=>n.id));f.order('latest');assert.equal(f.state.calls.length,calls);
});
test('latest view: transitive correction chains collapse every ancestor without mutating any record',()=>{
 const a=note(1),b=correct(2,a),c=correct(3,b),records=[b,a,c];for(const n of records)Object.freeze(n);Object.freeze(records);
 const p=ui.latestGroups(records,'owner-a');assert.deepEqual(currentIds(p),[c.id]);assert.deepEqual(historyIds(p),[b.id,a.id]);assert.equal(p.groups[0].current[0],c);assert.deepEqual([...p.correctedIds],[a.id,b.id]);assert.equal(p.blockedIds.has(c.id),false);
});
test('latest view: missing parents stay explicit, block product review, and cannot validate descendant chains',()=>{
 const a=note(1),b=correct(2,a),c=correct(3,b),partial=ui.latestGroups([c,b]);assert.deepEqual(currentIds(partial),[c.id]);assert.match(partial.warnings.get(b).join(' '),/현재 목록에 없음/);assert.match(partial.warnings.get(c).join(' '),/상위 정정 연결 미확인/);assert.equal(partial.blockedIds.has(c.id),true);
 const full=ui.latestGroups([c,b,a]);assert.deepEqual(currentIds(full),[c.id]);assert.equal(full.warnings.size,0);assert.equal(full.blockedIds.has(c.id),false);
});
test('latest view: unrelated creators, owners and mismatched handles cannot hide or replace another record',()=>{
 const a=note(1,{owner:'owner-a'});
 for(const patch of [{creatorId:note(99).creatorId},{owner:'owner-b'},{handle:'different.handle'}]){
  const b=correct(2,a,{owner:'owner-a',...patch}),p=ui.latestGroups([b,a],'owner-a');assert.equal(historyIds(p).length,0);assert.equal(currentIds(p).length,2);assert.match(p.warnings.get(b).join(' '),/불일치/);assert.equal(p.blockedIds.has(b.id),true);
 }
 const b=correct(2,a),p=ui.latestGroups([b,a],'owner-a');assert.deepEqual(currentIds(p),[b.id]);assert.deepEqual(historyIds(p),[a.id]);
});
test('latest view: self-links and cycles remain visible with no inferred winner, including descendants',()=>{
 const a=note(1),b=correct(2,a,{recordedAt:a.recordedAt});a.supersedesId=b.id;const c=correct(3,b),d=correct(4,c),p=ui.latestGroups([d,c,b,a]);
 assert.ok(currentIds(p).includes(a.id));assert.ok(currentIds(p).includes(b.id));assert.ok(currentIds(p).includes(d.id));for(const n of [a,b,c,d])assert.equal(p.blockedIds.has(n.id),true);
 assert.match(p.warnings.get(a).join(' '),/순환/);assert.match(p.warnings.get(d).join(' '),/상위 정정 연결 미확인/);
 const self=note(9);self.supersedesId=self.id;const q=ui.latestGroups([self]);assert.deepEqual(currentIds(q),[self.id]);assert.equal(historyIds(q).length,0);assert.match(q.warnings.get(self).join(' '),/순환/);
});
test('latest view: competing correction branches all remain candidates, even with a later descendant or invalid branch',()=>{
 const a=note(1),b=correct(2,a),c=correct(3,a),d=correct(4,b),p=ui.latestGroups([a,b,c,d]);assert.deepEqual(currentIds(p),[d.id,c.id]);assert.deepEqual(historyIds(p),[b.id,a.id]);for(const n of [b,c,d]){assert.match(p.warnings.get(n).join(' '),/여러 갈래/);assert.equal(p.blockedIds.has(n.id),true);}
 const invalid=correct(5,a,{recordedAt:'invalid'}),q=ui.latestGroups([b,invalid,a]);assert.match(q.warnings.get(b).join(' '),/여러 갈래/);assert.equal(q.blockedIds.has(b.id),true);assert.ok(currentIds(q).includes(invalid.id));
});
test('latest view: timestamps retain nanoseconds and stable ties; malformed or backward links never supersede',()=>{
 const a=note(1),b=correct(2,a,{recordedAt:'2020-11-03T08:01:00.000002Z'}),c=correct(3,a,{recordedAt:'2020-11-03T17:01:00.000002+09:00'}),d=correct(4,a,{recordedAt:'2020-11-03T08:01:00.000003Z'});
 assert.deepEqual(currentIds(ui.latestGroups([c,b,d,a])),[d.id,c.id,b.id]);
 for(const recordedAt of ['2020-11-01T00:00:00Z','2020-02-30T01:00:00Z','2020-11-03T24:00:00Z','2020-11-03T08:02:00+14:01','2020-11-03T08:02:00.1234567890Z','2020-11-03','invalid']){
  const bad=correct(9,a,{recordedAt}),p=ui.latestGroups([bad,a]);assert.equal(historyIds(p).length,0);assert.equal(p.blockedIds.has(a.id),true);assert.equal(p.blockedIds.has(bad.id),true);assert.match(p.warnings.get(bad).join(' '),/시각/);
 }
});
test('latest view: duplicate IDs and independent notes remain visible rather than silently discarded',()=>{
 const a=note(1),b=correct(2,a),duplicate={...a,draft:'separate loaded record'},p=ui.latestGroups([a,b,duplicate]);assert.equal(p.groups[0].current.length,3);assert.equal(historyIds(p).length,0);assert.match(p.warnings.get(b).join(' '),/기록 ID 불일치/);
 const independent=note(2,{creatorId:a.creatorId,handle:a.handle}),q=ui.latestGroups([a,independent]);assert.deepEqual(currentIds(q),[independent.id,a.id]);assert.equal(historyIds(q).length,0);assert.equal(q.blockedIds.size,0);
});
test('latest view: bounded pagination only claims loaded coverage and re-evaluates corrections when parents arrive',async()=>{
 const a=note(1),b=correct(30,a),records=[b,...Array.from({length:19},(_,i)=>note(21-i))],pages=records.map(n=>page([n],cursor(n)));pages.push(page([a]));let opened=0;
 const f=fixture(pages,{onReviewProducts:()=>{opened++;return true;}});await f.view.load();assert.equal(f.state.calls.length,20);assert.match(f.host.innerHTML,/아직 읽지 않은 저장 페이지/);assert.doesNotMatch(f.host.innerHTML,/남은 저장 페이지 없음/);assert.match(f.host.innerHTML,/정정 대상 메모는 현재 목록에 없음/);f.click('review-products',b.id);assert.equal(opened,0);
 await f.click('more');assert.equal(f.state.calls.length,21);assert.match(f.host.innerHTML,/data-note-count>20명 · 21개 기록/);assert.match(f.host.innerHTML,/원문 대화 전체를 확인했다는 뜻은 아닙니다/);assert.match(f.host.innerHTML,/<details data-note-history>/);f.click('review-products',a.id);assert.equal(opened,0);f.click('review-products',b.id);assert.equal(opened,1);
});
test('latest view: ambiguous correction actions remain blocked in all order modes and synthetic clicks',async()=>{
 const a=note(1),b=correct(2,a),c=correct(3,a);let opened=0;const f=fixture([page([a,b,c])],{onReviewProducts:()=>{opened++;return true;}});await f.view.load();
 for(const order of ['latest','review','source']){f.order(order);for(const n of [a,b,c]){f.click('review-products',n.id);assert.match(f.host.innerHTML,new RegExp('data-note-action="review-products" data-note-id="'+n.id+'" disabled'));}}assert.equal(opened,0);
});
