import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWeddingMailUi,tomorrowTenKst,weddingMailPlanInput,validateWeddingMailPlan,validateWeddingMailSubmit,weddingMailProject} from '../web/youtube-wedding-mail-ui.mjs';
const day='2026-11-23', channel='UC'+'A'.repeat(22), another='UC'+'B'.repeat(22), key='a98fa85d-712c-4e92-9080-6e523d948ccd';
const projectId=weddingMailProject;
const initial=Date.parse('2026-11-23T11:58:30Z');
const planId='fixturePlanKey123.'+'Z'.repeat(43);
const runAt=tomorrowTenKst(initial);
const copy={subject:'예시 제목 <b>',body:'가상 카피 본문\n<img src=x onerror=noop>',version:7};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=(mode,n=2)=>({projectId,day,mode,recipientCount:n,runAt:mode==='tomorrow'?runAt:new Date(initial).toISOString(),planId,expiresAt:new Date(initial+120000).toISOString(),subscriberMinimum:50000,copyVersion:7});
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.hidden=false;this.disabled=false;}
 setAttribute(k,v){this.attrs[k]=v;}
 append(...nodes){this.children.push(...nodes);}
 addEventListener(name,handler){this.listeners[name]=handler;}
 trigger(name){if(name!=='click'||!this.disabled)this.listeners[name]?.();}
}
const document={createElement:t=>new Element(t)};
function setup(opts={}){
 let active=true,time=initial;
 const calls=[], saved=opts.saved??new Map();
 const storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
 let refreshes=0;
 const ctl=createWeddingMailUi({owner:'fixture-owner',day:opts.day??day,storage,
  sessionActive:()=>active,now:()=>time,id:()=>key,readCopy:opts.readCopy??(async()=>copy),
  refreshStatus:()=>refreshes++,request:async request=>{
   calls.push(request.body);
   if(opts.request)return opts.request(request.body);
   const {action,mode}=request.body;
   return action==='plan'?response(mode):{...response(mode),batchId:key,state:mode==='now'?'queued':'scheduled'};
  }});
 function bind(){
  const host=new Element('div'),box=new Element('input');
  ctl.bind({host,exclusions:[[box,channel]],eligibleCount:2,document});
  const [legend,now,tomorrow,summary,preview,confirm,status]=host.children;
  return {host,box,legend,now,tomorrow,summary,preview,confirm,status};
 }
 return {ctl,bind,clearSession(){active=false;},calls,saved,get refreshes(){return refreshes;},time(v){time=v;}};
}

test('KST tomorrow 10 is 01:00 UTC and rolls on Seoul midnight, not host midnight',()=>{
 assert.equal(runAt,'2026-11-24T01:00:00.000Z');
 assert.equal(tomorrowTenKst(Date.parse('2026-11-23T15:01:00Z')),'2026-11-25T01:00:00.000Z');
 assert.deepEqual(weddingMailPlanInput(day,'now',new Set([another,channel])),{action:'plan',projectId,day,mode:'now',channelIdsExcluded:[channel,another]});
 assert.throws(()=>weddingMailPlanInput('2026-02-31','now',new Set()));
 assert.throws(()=>weddingMailPlanInput(day,'now',new Set(['address@example.test'])));
});

test('wrong project, date, signing token, send state or changed recipient count fails closed',()=>{
 const input=weddingMailPlanInput(day,'tomorrow',new Set());
 const rv=response('tomorrow'), plan=validateWeddingMailPlan(rv,input,initial);
 for(const mod of [{projectId:'chewy'},{day:'2026-11-22'},{planId:'not-a-signed-plan'},{subscriberMinimum:undefined},{subscriberMinimum:49999},{copyVersion:null},{recipientCount:101},{runAt:'2026-11-24T02:00:00.000Z'}])assert.throws(()=>validateWeddingMailPlan({...rv,...mod},input,initial));
 assert.throws(()=>validateWeddingMailSubmit({...rv,recipientCount:3,batchId:key,state:'scheduled'},input,plan));
 assert.throws(()=>validateWeddingMailSubmit({...rv,batchId:key,state:'sent'},input,plan));
});

test('checked exclusions are passed without private data, exact reviewed copy and one confirm are inline',async()=>{
 const s=setup(), v=s.bind();
 v.box.checked=true;v.box.trigger('change');
 v.tomorrow.trigger('click'); await settle();
 assert.equal(v.confirm.hidden,false);
 assert.equal(v.confirm.disabled,false);
 assert.match(v.summary.textContent,/2026-11-23 발굴.*대상 2명.*예약.*10:00.*한국시간/);
 assert.equal(v.preview.children[1].textContent,copy.subject);
 assert.equal(v.preview.children[2].textContent,copy.body);
 assert.deepEqual(s.calls[0],{action:'plan',projectId,day,mode:'tomorrow',channelIdsExcluded:[channel]});
 v.confirm.trigger('click');v.confirm.trigger('click'); await settle();
 assert.deepEqual(s.calls[1],{action:'submit',projectId,day,mode:'tomorrow',channelIdsExcluded:[channel],planId,expectedRecipientCount:2,expectedRunAt:runAt,idempotencyKey:key});
 assert.equal(s.calls.length,2);assert.equal(s.refreshes,1);
 assert.match(v.status.textContent,/예약 요청을 접수/);
 assert.doesNotMatch(v.status.textContent,/발송 완료했습니다/);
 assert.equal(s.bind().tomorrow.disabled,true);
});

test('altering an exclusion invalidates preview, and mismatched copy version never enables confirm',async()=>{
 const s=setup(), v=s.bind();
 v.now.trigger('click');await settle();assert.equal(v.confirm.hidden,false);
 v.box.checked=true;v.box.trigger('change');assert.equal(v.confirm.hidden,true);
 v.confirm.trigger('click');assert.equal(s.calls.length,1);
 const m=setup({readCopy:async()=>({...copy,version:8})}), x=m.bind();
 x.now.trigger('click');await settle();assert.equal(x.confirm.hidden,true);
 assert.match(x.status.textContent,/저장 카피의 최신 버전을 확인하지 못했습니다/);
});

test('uncertain network result does not render sent and blocks same-day resubmit across controller recreation',async()=>{
 const s=setup({request:async body=>{if(body.action==='submit')throw Error('timeout');return response(body.mode);}});
 const v=s.bind();v.now.trigger('click');await settle();
 v.confirm.trigger('click');await settle();
 assert.match(v.status.textContent,/결과를 확인하지 못했습니다/);assert.equal(s.refreshes,1);
 const reload=setup({saved:s.saved}), v2=reload.bind();
 assert.equal(v2.now.disabled,true);v2.now.trigger('click');assert.equal(reload.calls.length,0);
 const other=setup({saved:s.saved,day:'2026-11-22'});assert.equal(other.bind().now.disabled,false);
});

test('expired plan or inactive session cannot submit; zero count is inert',async()=>{
 const s=setup(), v=s.bind();v.tomorrow.trigger('click');await settle();
 s.time(initial+121000);v.confirm.trigger('click');assert.equal(s.calls.length,1);assert.match(v.status.textContent,/만료/);
 const p=setup(), v2=p.bind();v2.now.trigger('click');await settle();p.clearSession();v2.confirm.trigger('click');assert.equal(p.calls.length,1);
 const e=setup({request:async b=>response(b.mode,0)}), v3=e.bind();v3.now.trigger('click');await settle();assert.equal(v3.confirm.hidden,true);assert.match(v3.status.textContent,/대상이 없습니다/);
});

test('fail-closed typed preflight UX never loads copy or submits and does not show server details',async()=>{
 let copyReads=0;
 const s=setup({
  request:async body=>{assert.equal(body.action,'plan');throw Object.assign(Error('retained smoke test secret detail'),{partyumPlanCode:'PARTYUM_DISABLED'});},
  readCopy:async()=>{copyReads++;return copy;},
 });
 const v=s.bind();v.now.trigger('click');await settle();
 assert.match(v.status.textContent,/더파티움 발송이 일시 중지/);
 assert.match(v.status.textContent,/발송·예약 요청은 하지 않았습니다/);
 assert.doesNotMatch(v.status.textContent,/secret|PARTYUM_DISABLED/);
 assert.equal(v.confirm.hidden,true);assert.equal(copyReads,0);
 v.confirm.trigger('click');assert.equal(s.calls.length,1);assert.equal(s.saved.size,0);
});
