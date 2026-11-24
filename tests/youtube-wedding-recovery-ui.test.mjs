import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeddingRecoveryUi} from '../web/youtube-wedding-recovery-ui.mjs';
const mail='owner@example.test';
const when=Date.parse('2026-01-01T12:00:00Z');
const preview={state:'incident_preview',recipientCount:29,sender:mail,historyScope:'canonical_gmail_and_sanji_ledger',
 planToken:'u'.repeat(25)+'.'+'x'.repeat(43),expiresAt:new Date(when+70000).toISOString()};
const magic={available:true,recipientCount:29,expectedMailbox:mail};
const later=()=>new Promise(r=>setImmediate(r));
function setup(stub){
 let calls=[],active=true,queued=0;
 function element(tag){
  return {tag,children:[],hidden:false,disabled:false,textContent:'',setAttribute(){},
   addEventListener(name,fn){this[name]=fn;},replaceChildren(...kids){this.children=kids;}};
 }
 const host=element('div');host.hidden=true;
 const x=createWeddingRecoveryUi({host,document:{createElement:element},active:()=>active,now:()=>when,
  afterQueued:()=>{queued++;},
  request:async ({body,stillActive})=>{assert.ok(stillActive());calls.push(body);return stub(body);}
 });
 return {host,calls,x,get queued(){return queued;},revoke(){active=false;x.revoke();}};
}
test('no control is shown when authenticated server says unavailable or request cannot verify',async()=>{
 for(const stub of [()=>({available:false}),()=>({available:true,recipientCount:29,expectedMailbox:null}),()=>{throw Error();}]){
  const s=setup(stub);await s.x.load();
  assert.deepEqual(s.calls.map(x=>x.action),['recovery_availability']);
  assert.equal(s.host.hidden,true);assert.equal(s.host.children.length,0);
 }
});
test('owner sees one exact action, clicking once prepares then admits without claiming provider sent',async()=>{
 const s=setup(x=>x.action==='recovery_availability'?magic:x.action==='recovery_prepare'?preview:
   {state:'incident_admitted',recipientCount:29,runAt:new Date(when).toISOString()});
 await s.x.load();assert.equal(s.host.hidden,false);
 const [button,p]=s.host.children;
 assert.match(button.textContent,/29건/);assert.match(p.textContent,/owner@example.test/);
 assert.equal(s.calls.length,1);
 button.click();button.click();await later();
 assert.deepEqual(s.calls.map(v=>v.action),['recovery_availability','recovery_prepare','recovery_submit']);
 assert.deepEqual(s.calls[2],{action:'recovery_submit',projectId:'private-wedding-research',expectedMailbox:mail,
  planToken:preview.planToken,confirm:'SEND_ORIGINAL_RESERVATIONS'});
 assert.equal(button.hidden,true);assert.equal(s.queued,1);assert.match(p.textContent,/발송 대기열/);
});
test('a changed recipient count, mailbox or token validity during preparation stops before commit',async()=>{
 for(const change of [{recipientCount:28},{sender:'other@example.test'},{expiresAt:new Date(when).toISOString()}]){
  const s=setup(x=>x.action==='recovery_availability'?magic:{...preview,...change});
  await s.x.load();s.host.children[0].click();await later();
  assert.deepEqual(s.calls.map(v=>v.action),['recovery_availability','recovery_prepare']);
  assert.equal(s.host.children[0].disabled,false);assert.equal(s.queued,0);
 }
});
test('unmount during preview never submits and uncertain commit cannot be replayed in this view',async()=>{
 let resolve;
 const s=setup(x=>x.action==='recovery_availability'?magic:new Promise(r=>{resolve=r;}));
 await s.x.load();s.host.children[0].click();s.revoke();resolve(preview);await later();
 assert.deepEqual(s.calls.map(v=>v.action),['recovery_availability','recovery_prepare']);
 assert.equal(s.host.hidden,true);
 const y=setup(x=>{
  if(x.action==='recovery_availability')return magic;
  if(x.action==='recovery_prepare')return preview;
  throw Error('network');
 });
 await y.x.load();const [b,p]=y.host.children;b.click();await later();b.click();await later();
 assert.equal(b.disabled,true);assert.match(p.textContent,/중복 요청하지 말고/);
 assert.deepEqual(y.calls.map(v=>v.action),['recovery_availability','recovery_prepare','recovery_submit']);
});
