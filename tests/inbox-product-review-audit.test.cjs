const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const note=()=>({id:'50000000-0000-4000-8000-000000000001',creatorId:'60000000-0000-4000-8000-000000000001',handle:'fictional.audit',observedAt:'2020-11-03',recordedAt:'2020-11-04T01:00:00Z',sourceUrl:'https://www.instagram.com/direct/t/101/',inboundWhen:'미확인',summary:'가상 과거 대화',draft:'가상 미발송 초안',intent:'협업 방식 문의',afterInboundOutbound:'미확인',recordType:'manual_historical_note',latestVerified:false,dispatchState:'not_sent'});
// Run actual app handlers with synthetic state. No browser, server or network calls.
function fixture(){
 const events={window:{},document:{},modal:{}},calls=[],notices=[],state={confirm:false,prompts:0,rendered:0,manual:false,manualCan:true,transientDisposals:0};
 let result=null,editor=null;
 const add=(target,name,fn)=>(events[target][name]??=[]).push(fn);
 const emit=(target,name,event={})=>{for(const fn of events[target][name]||[])fn(event);};
 const dialog={id:'modal',open:false,addEventListener:(name,fn)=>add('modal',name,fn),showModal(){this.open=true;},close(){this.open=false;emit('modal','close');}};
 const content={set innerHTML(value){this.html=value;result=value.includes('id="instagram-prototype-result"')?{innerHTML:'',textContent:''}:null;editor=result?{value:'synthetic edit'}:null;},get innerHTML(){return this.html||'';}};
 const form={values:{disposition:'context',reviewedSource:'on',reviewedExclusions:'on'}};
 class FormData{constructor(node){this.values=node?.values||{}}get(k){const v=this.values[k];return Array.isArray(v)?v[0]??null:v??null;}getAll(k){const v=this.values[k];return Array.isArray(v)?v:v==null?[]:[v];}has(k){return Object.hasOwn(this.values,k)&&this.values[k]!==false;}}
 const h={catalogSheetSettingsDispose:()=>{},URL,FormData,esc,me:{id:'owner-a'},location:{hash:'#inbox',reload(){state.reload=true;}},history:{replaceState(_a,_b,hash){h.location.hash=hash;}},data:{candidates:[],deals:[]},selectedThread:'official',creatorInboxThreads:[],inboundHumanReply:()=>true,inboxEdited:false,inboxDirtyForms:new Set(),manualInbox:{dirty:false},manualProductView:null,transientInboxView:null,manualNotesView:null,preview:null,manualCanChange:()=>state.manualCan,manualDispose:()=>{state.manual=false;},transientDispose:()=>{state.transientDisposals++;h.transientInboxView=null;},manualNotesDispose:()=>{state.notesDisposed=true;},allowInboxChange:()=>true,render:()=>{state.rendered++;},mountTrackingForm:()=>{},toast:m=>notices.push(m),api:async(...args)=>{calls.push(args);return {};},navigator:{clipboard:{writeText:async value=>{state.copied=value;}}},window:{confirm:()=>{state.prompts++;return state.confirm;},addEventListener:(name,fn)=>add('window',name,fn)},document:{addEventListener:(name,fn)=>add('document',name,fn)},$:selector=>selector==='#modal'?dialog:selector==='#modal-content'?content:selector==='#instagram-prototype-result'?result:selector==='#instagram-prototype-text'?editor:selector==='#instagram-prototype-draft'?form:selector==='#instagram-prototype-draft-output'?{innerHTML:''}:selector==='#manual-inbox-root'&&state.manual?{}:null};
 vm.createContext(h);
 vm.runInContext(slice('function modal(html) {','function err(e) {')+slice('// Local review prototype:','function instagramReplyConfirmation(')+slice("document.addEventListener('cancel',e=>{if(e.target?.id==='modal'&&$('#manual-inbox-root'))",'document.addEventListener("input"')+slice("window.addEventListener('beforeunload',e=>{if(inboxEdited",'boot();')+slice('  async logout() {','  "add-brand":').replace('  async logout() {','async function auditLogout() {').replace(/,\s*$/,'')+';this.openNote=prototypeOpenHistoricalNote;this.dirty=x=>prototypeDraftDirty=x;this.context=()=>instagramProposalContext;this.valid=prototypeCurrentDraft;this.apply=prototypeApplyManualReview;this.copy=prototypeCopy;this.openGeneric=modal;this.dismiss=close;',h);
 return {h,state,events,calls,dialog,content,form,notices,emit,open:()=>h.openNote(note(),{owner:'owner-a',isCurrent:()=>true}),result:()=>result,editor:()=>editor};
}
test('audit: Escape cancellation preserves historical dialog, approved close clears private state',()=>{
 const f=fixture();assert.equal(f.open(),true);f.h.dirty(true);const original=f.h.context();let prevented=false;
 f.emit('document','cancel',{target:f.dialog,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.h.context(),original);assert.equal(f.dialog.open,true);
 f.state.confirm=true;prevented=false;f.emit('document','cancel',{target:f.dialog,preventDefault(){prevented=true;}});assert.equal(prevented,false);f.dialog.close();assert.equal(f.h.context(),null);assert.equal(f.result().textContent,'');
});
test('audit: Back or forward away from Inbox honors dirty cancel and then clears accepted historical work',()=>{
 const f=fixture();f.open();f.h.dirty(true);const original=f.h.context();f.h.location.hash='#deals';f.emit('window','hashchange');assert.equal(f.h.location.hash,'#inbox');assert.equal(f.h.context(),original);assert.equal(f.state.rendered,0);
 f.state.confirm=true;f.h.location.hash='#deals';f.emit('window','hashchange');assert.equal(f.h.context(),null);assert.equal(f.dialog.open,false);assert.equal(f.state.rendered,1);
});
test('audit: logout declined keeps note and makes no request; accepted logout clears note before its request',async()=>{
 const f=fixture();f.open();f.h.dirty(true);const original=f.h.context();await f.h.auditLogout();assert.equal(f.calls.length,0);assert.equal(f.h.context(),original);assert.equal(f.state.notesDisposed,undefined);
 f.state.confirm=true;f.h.api=async(...args)=>{assert.equal(f.h.context(),null);assert.equal(f.dialog.open,false);f.calls.push(args);return {};};await f.h.auditLogout();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'/auth/logout');assert.equal(f.state.reload,true);
});
test('audit: transient or manual cancellation prevents historical opening and keeps prior dialog',()=>{
 for(const kind of ['transient','manual']){const f=fixture();f.h.openGeneric('<p>existing draft</p>');if(kind==='transient')f.h.transientInboxView={canClose:()=>false};else{f.state.manual=true;f.state.manualCan=false;}assert.equal(f.open(),false,kind);assert.equal(f.h.context(),null,kind);assert.match(f.content.innerHTML,/existing draft/,kind);assert.equal(f.dialog.open,true,kind);}
});
test('audit: page hide clears the historical context even when edits were dirty',()=>{
 const f=fixture();f.open();f.h.dirty(true);f.emit('window','pagehide');assert.equal(f.h.context(),null);assert.equal(f.dialog.open,false);assert.equal(f.state.notesDisposed,true);assert.equal(f.state.prompts,0);
});
test('audit: a queued old modal close event cannot destroy a newly opened historical review',()=>{
 const f=fixture();f.open();const first=f.h.context();assert.equal(f.open(),true);const next=f.h.context();assert.notEqual(first,next);f.emit('modal','close');assert.equal(f.h.context(),next);assert.equal(f.dialog.open,true);
});
test('audit: every historical action remains copy-only without a network call on repeat',async()=>{
 const f=fixture();f.open();for(let i=0;i<3;i++){f.h.apply(f.form);assert.equal(f.h.valid(),true);await f.h.copy();}assert.equal(f.calls.length,0);assert.equal(f.state.copied,'synthetic edit');
});
test('audit: generic modal replacement obeys historical dirty cancellation and removes accepted private context',()=>{
 const f=fixture();f.open();f.h.dirty(true);const original=f.h.context(),html=f.content.innerHTML;f.h.openGeneric('<p>replacement</p>');assert.equal(f.h.context(),original);assert.equal(f.content.innerHTML,html);assert.equal(f.dialog.open,true);
 f.state.confirm=true;f.h.openGeneric('<p>replacement</p>');assert.equal(f.h.context(),null);assert.match(f.content.innerHTML,/replacement/);assert.equal(f.result(),null);assert.equal(f.dialog.open,true);
});
test('audit: accepted historical replacement asks once, clears old context, and repeated close remains safe',()=>{
 const f=fixture();f.open();f.h.dirty(true);f.state.confirm=true;const original=f.h.context();assert.equal(f.open(),true);assert.equal(f.state.prompts,1);assert.notEqual(f.h.context(),original);f.h.dismiss();f.h.dismiss();assert.equal(f.h.context(),null);assert.equal(f.dialog.open,false);
});
