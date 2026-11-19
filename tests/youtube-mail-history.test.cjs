const test=require('node:test'), assert=require('node:assert/strict');
const modulePromise=import('../web/youtube-mail-history.mjs');
const at='2026-11-15T16:00:00Z';
test('reserved rows require a real active reservation; other states are not successes',async()=>{
 const {classifyMailHistoryRow:state}=await modulePromise;
 assert.equal(state('reserved',{state:'scheduled',runAt:at}),'reserved');
 for(const schedule of [null,{state:'complete',runAt:at},{state:'cancelled',runAt:at},{state:'scheduled',runAt:'bad'}])assert.equal(state('reserved',schedule),'unverified');
 for(const value of ['held','processing','outcome_unknown']) assert.equal(state('reserved',{state:value,runAt:at}),value);
 for(const value of ['held','cancelled','outcome_unknown','failed','bounced'])assert.equal(state(value,{state:'scheduled',runAt:at}),value);
 assert.equal(state('accepted',{state:'outcome_unknown'}),'accepted');
 assert.equal(state('constructor',null),'unverified');
});
function el(tag,value='',className=''){
 return {tag,value,className,children:[],append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},addEventListener(event,fn){this[event]=fn;},get text(){return this.value+' '+this.children.map(x=>x.text).join(' ');}};
}
test('filters span dated batches and distinguish reservation from actual provider acceptance',async()=>{
 const {renderMailHistory:render}=await modulePromise,host=el('div'),base={host,el,link:(name,url)=>el('a',name+' '+url),offset:0};
 const batches=[
  {batchId:'a',createdAt:'2026-11-10T03:00:00Z',schedule:{state:'scheduled',runAt:at},rows:[{email:'pending-a@example.test',status:'reserved'},{email:'sent-a@example.test',status:'accepted'}]},
  {batchId:'b',schedule:{state:'outcome_unknown',runAt:'2026-11-18T03:00:00Z'},rows:[{email:'stalled@example.test',status:'reserved'},{email:'sent-b@example.test',status:'accepted'},{email:'suspect@example.test',status:'outcome_unknown',searchUrl:'https://mail.google.com:999/mail/#search/fixture'}]},
  {batchId:'c',createdAt:'2026-11-17T03:00:00Z',rows:[{email:'unknown@example.test',status:'outcome_unknown',searchUrl:'https://mail.google.com/mail/#search/fixture'},null]}
 ];
 let cancelled;
 render({...base,batches,filter:'all',onCancel:id=>{cancelled=id;}});
 assert.match(host.text,/예약 시각: 2026년 11월 16일/);
 assert.match(host.text,/묶음 생성 시각: 2026년 11월 17일/);
 assert.match(host.text,/unknown@example.test.*Gmail에서 메시지 ID 검색/);
 assert.doesNotMatch(host.text,/:999/);
 assert.doesNotMatch(host.text,/실제 발송 시각|전달 완료/);
 host.children[1].children.find(x=>x.tag==='button').click();
 assert.equal(cancelled,'a');
 render({...base,batches,filter:'reserved'});
 assert.match(host.text,/pending-a@example.test.*예약됨/);
 assert.doesNotMatch(host.text,/stalled@|sent-|취소/);
 render({...base,batches,filter:'accepted'});
 assert.match(host.text,/sent-a@example.test.*발송 완료 · Gmail 접수.*sent-b@example.test.*발송 완료 · Gmail 접수/);
 assert.doesNotMatch(host.text,/pending-|stalled@|취소/);
 render({...base,batches,filter:'attention'});
 assert.match(host.text,/stalled@example.test.*결과 미확인/);
 assert.doesNotMatch(host.text,/pending-|sent-/);
});

test('history uses only recent for browsing; active filter persists on older dates',async()=>{
 const {mailHistoryFilters,renderMailHistory}=await modulePromise;
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../web/youtube-discovery.js'),'utf8');
 const host=el('div'),calls=[];
 function node(...args){const n=el(...args);n.setAttribute=(k,v)=>{n[k]=v;};return n;}
 const sandbox={el:node,$:()=>host,owner:'fixture-owner',disposed:false,Set, cancelHistoryPending:new Set(),URLSearchParams,location:{search:''},mailHistoryFilters,renderMailHistory,link:node,supabaseUrl:'https://supabase.example.test',supabaseKey:'test',client:{auth:{getSession:async()=>({data:{session:{user:{id:'fixture-owner'},access_token:'fixture'}}})}},
  fetch:async(url,init)=>{
   const offset=JSON.parse(init.body).offset;
   calls.push([url,offset]);
   return {ok:true,json:async()=>({more:!offset,rows:[{createdAt:offset?'2026-11-14T00:00:00Z':'2026-11-15T00:00:00Z',schedule:{state:'scheduled',runAt:offset?'2026-11-15T00:00:00Z':at},rows:[{email:'pending@example.test',status:'reserved'},{email:'sent@example.test',status:'accepted'}]}]})};
  }
 };
 const snippet=source.slice(source.indexOf('let previewEpoch='),source.indexOf(',clear(){previewEpoch'));
 const list=vm.runInNewContext(snippet+'}; campaign;',sandbox);
 await list.load();
 const descendants=(root)=>[root,...root.children.flatMap(descendants)];
 const button=(label)=>descendants(host).find(n=>n.tag==='button'&&n.value===label);
 button('발송 완료').click();
 assert.equal(button('발송 완료')['aria-pressed'],'true');
 assert.doesNotMatch(host.text,/pending@example.test/);
 await button('이전 발송 기록').click();
 assert.equal(button('발송 완료')['aria-pressed'],'true');
 assert.match(host.text,/예약 시각: 2026년 11월 15일/);
 assert.doesNotMatch(host.text,/pending@example.test/);
 assert.deepEqual(calls,[['https://supabase.example.test/functions/v1/youtube-manual-mail/recent',0],['https://supabase.example.test/functions/v1/youtube-manual-mail/recent',10]]);
});
