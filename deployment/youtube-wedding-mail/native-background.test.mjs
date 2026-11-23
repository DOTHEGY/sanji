import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumNativeWorkerHandler,deferPartyumWork} from './production-runtime.mjs';
const url='https://abcdefghijklmnopqrst.supabase.co/functions/v1/youtube-wedding-mail-worker';
const hint=()=>new Request(url,{method:'POST',headers:{'x-sanji-partyum-wake':'native-v1'},body:'{}'});
test('HTTP returns ahead of slow mock Gmail with tracked waitUntil registered before launch',async()=>{
 let release,called=0,completed=false,healthy=0;
 const slow=new Promise(r=>{release=r;});
 const tasks=[];
 const worker=createPartyumNativeWorkerHandler({consume:async()=>{healthy++;return true;},enabled:()=>true,
  runDue:async()=>{assert.equal(tasks.length,1);called++;await slow;completed=true;},
  markUnhealthy:async()=>assert.fail('unexpected failure'),waitUntil:p=>{tasks.push(p);}});
 let timer;
 const timeout=new Promise((_,rej)=>{timer=setTimeout(()=>rej(Error('HTTP awaited fake Gmail')),1000);});
 let r;
 try{r=await Promise.race([worker(hint()),timeout]);}finally{clearTimeout(timer);}
 assert.equal(r.status,202);assert.equal(healthy,1);assert.equal(await r.text(),'');
 assert.equal(tasks.length,1);assert.equal(called,1);assert.equal(completed,false);
 release();await Promise.all(tasks);assert.equal(completed,true);
});
test('missing/throwing tracker never runs provider work; a thrown registration marks worker unhealthy',async()=>{
 let ran=0,marked=0,consumed=0;
 const opts={consume:async()=>{consumed++;return true;},enabled:()=>true,runDue:async()=>{ran++;},markUnhealthy:async()=>{marked++;}};
 const failed=createPartyumNativeWorkerHandler({...opts,waitUntil:()=>{throw Error('fixture unavailable');}});
 assert.equal((await failed(hint())).status,503);
 assert.equal(consumed,1);assert.equal(marked,1);assert.equal(ran,0);
 const missing=createPartyumNativeWorkerHandler(opts);
 assert.equal((await missing(hint())).status,503);
 assert.equal(consumed,1);assert.equal(ran,0);
 assert.equal(deferPartyumWork(undefined,async()=>{ran++;}),false);
 assert.equal(ran,0);
});
test('an empty boot probe with disabled product sends nothing even when native grant is fresh',async()=>{
 let grants=0, work=0, track=0;
 const handler=createPartyumNativeWorkerHandler({consume:async()=>{grants++;return true;},enabled:()=>false,
  runDue:async()=>{work++;},markUnhealthy:async()=>{},waitUntil:()=>{track++;}});
 assert.equal((await handler(hint())).status,202);
 assert.equal(grants,1);assert.equal(track,0);assert.equal(work,0);
});
