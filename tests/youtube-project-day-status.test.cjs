const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../web/youtube-project-day-status.mjs');
const U=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const owner=U(90),projectId='gs-bbangteojineunjip-chewy-bread',day='2026-11-15';
const at='2026-11-15T16:00:00.000Z';
test('row status validates project, date, stable ID and verified event timestamp',async()=>{
 const {decodeDayStatus,dayStatusText}=await modulePromise;
 const ids=[1,2,3,4,5,6,7].map(U),scope={day,ids,projectId};
 const data={day,projectId,items:[
   {candidateId:U(1),state:'sent',at},{candidateId:U(2),state:'scheduled',at},
   {candidateId:U(3),state:'found_only'},{candidateId:U(4),state:'failed'},
   {candidateId:U(5),state:'found_only',completeForCandidate:true},
   {candidateId:U(6),state:'sent',at:day},{candidateId:U(7),state:'unknown'},
 ]};
 const map=decodeDayStatus(data,scope);
 assert.match(dayStatusText(map.get(U(1))).detail,/Gmail 접수 기록.*11.*16.*1:00/);
 assert.match(dayStatusText(map.get(U(2))).detail,/예약 시각.*11.*16.*1:00/);
 assert.equal(map.get(U(3)).status,'unknown');
 assert.equal(map.get(U(4)).status,'failed');
 assert.equal(map.get(U(5)).status,'found_only');
 assert.equal(map.get(U(6)).status,'unknown');
 assert.equal(map.get(U(7)).status,'unknown');
 assert.equal(decodeDayStatus({...data,day:'2026-11-16'},scope).size,0);
 assert.equal(decodeDayStatus({...data,projectId:'other'},scope).size,0);
 assert.equal(decodeDayStatus({...data,items:[data.items[0],data.items[0]]},scope).size,0);
 assert.equal(decodeDayStatus({...data,items:[{candidateId:U(8),state:'sent',at}]},scope).size,0);
});
test('saved candidate DOM keeps each status under its discovery cohort, and ignores stale owner results',async()=>{
 const {mountYoutubeSaved}=await import('../web/youtube-saved.mjs');
 class Element{
  constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.attrs={};this.value='';this.checked=false;this._text='';}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;this._text='';}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this[k]=v;}
  reset(){}
  get textContent(){return [this._text,...this.children.map(x=>x.textContent)].filter(Boolean).join(' ');}
  set textContent(v){this.children=[];this._text=String(v);}
  find(fn){return [ ...(fn(this)?[this]:[]), ...this.children.flatMap(c=>c.find(fn)) ];}
 }
 const prior=global.document;
 global.document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 let account=owner;const calls=[];let lookup=async scope=>({...scope,items:scope.ids.map(id=>({
   candidateId:id,state:id===U(1)?'sent':id===U(2)?'scheduled':id===U(3)?'found_only':'unknown',
   at:id===U(1)?at:id===U(2)?'2026-11-16T01:00:00Z':null,completeForCandidate:id===U(3),
 }))});
 const rows=Array.from({length:4},(_,i)=>({id:U(i+1),owner,kind:'candidate',version:1,updated:'2026-11-15T00:00:00Z',
  data:{kind:'크리에이터',name:'합성 후보 '+i,profile:'https://www.youtube.com/channel/UC'+String.fromCharCode(97+i).repeat(22),
    contact:{email:'fixture-'+i+'@example.test'},youtubeResearch:{observedAt:'2026-11-14T01:00:00Z',projects:[{id:projectId,addedAt:at,assignedDay:i===3?'2026-11-16':day}]}}}));
 const client={auth:{getSession:async()=>({data:{session:{user:{id:account},access_token:'fixture'}}})},
  from(){let requested;const q={select:()=>q,eq:(k,v)=>{if(k==='owner')requested=v;return q;},order:()=>q,limit:()=>q,setHeader:()=>q,
    then:(resolve)=>resolve({data:rows.filter(r=>r.owner===requested)})};return q;}};
 const container=new Element('div'),readDayStatus=(scope,c)=>{calls.push({...scope,...c});return lookup(scope);};
 const controller=mountYoutubeSaved({container,client,getOwner:()=>account,isCurrent:o=>account===o,readDayStatus});
 try {
   await controller.load();await new Promise(setImmediate);
   const groups=container.find(x=>x.className==='creator-project-day');
   assert.equal(groups.length,2);const known=groups.find(x=>x.textContent.includes(day+' · 프로젝트 분류일'));
   assert.match(known.textContent,/조사 확인일: 2026-11-14/);
   assert.match(known.textContent,/발송 완료.*Gmail 접수 기록.*11.*16.*1:00/);
   assert.match(known.textContent,/발송 예약.*예약 시각.*11.*16.*10:00/);
   assert.match(known.textContent,/찾기만 함/);
   assert.match(groups.find(x=>x!==known).textContent,/확인 필요/);
   assert.deepEqual([...calls[0].ids,...calls[1].ids].sort(),[U(1),U(2),U(3),U(4)]);
   const resolvers=[];lookup=scope=>new Promise(resolve=>resolvers.push(()=>resolve({...scope,items:scope.ids.map(id=>({candidateId:id,state:'sent',at}))})));
   await controller.load();await new Promise(setImmediate);
   assert.equal(resolvers.length,2);
   const old=container.find(x=>x.className==='creator-project-day');
   account=U(91);controller.clear();resolvers.forEach(resolve=>resolve());await new Promise(setImmediate);
   assert.equal(container.find(x=>x.className==='creator-project-day').length,0);
   assert.equal(old.some(g=>g.textContent.includes('발송 완료')),false);
 }finally{global.document=prior;}
});
