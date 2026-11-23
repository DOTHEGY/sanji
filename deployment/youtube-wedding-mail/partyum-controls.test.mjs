import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPartyumControls} from './partyum-controls.mjs';
import {deferPartyumWork,createPartyumProductionRuntime} from './production-runtime.mjs';

test('missing infrastructure, product OFF, global OFF, and enabled are distinct safe decisions',async()=>{
 let calls=0,global=true,rows=[];
 const guard=createPartyumControls({env:()=>global?'true':'',pool:{connect:async()=>{
   calls++;return {query:async q=>q.startsWith('select ')?{rows}:{},release(){}};
 }},initTx:async()=>{}});
 assert.deepEqual(await guard(),{allowed:false,code:'PARTYUM_CONTROL_UNAVAILABLE'});
 rows=[{send_enabled:false}];assert.deepEqual(await guard(),{allowed:false,code:'PARTYUM_DISABLED'});
 rows=[{send_enabled:true}];assert.deepEqual(await guard(),{allowed:true,code:null});
 global=false;assert.deepEqual(await guard(),{allowed:false,code:'GLOBAL_EMAIL_DISABLED'});assert.equal(calls,3);
});

test('operator-only default disabled, late rollback stops deferred work, public/service roles cannot enable',async t=>{
 if(!process.env.PARTYUM_PGLITE){t.skip('set PARTYUM_PGLITE path');return;}
 const {PGlite}=await import(pathToFileURL(process.env.PARTYUM_PGLITE));
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema sanji_partyum_internal; grant usage on schema sanji_partyum_internal to service_role;');
 await db.exec(await fs.readFile(new URL('./0003_partyum_runtime_control.unapplied.sql',import.meta.url),'utf8'));
 const table='sanji_partyum_internal.partyum_runtime_controls';
 const guard=createPartyumControls({env:()=>'true',pool:{connect:async()=>({query:db.query.bind(db),release(){}})},initTx:q=>q.query('set local role service_role')});
 assert.deepEqual(await guard(),{allowed:false,code:'PARTYUM_DISABLED'});
 for(const r of ['anon','authenticated','service_role']){
  await db.exec('set role '+r);
  await assert.rejects(()=>db.query('update '+table+' set send_enabled=true'),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('update '+table+' set send_enabled=true');
 assert.deepEqual(await guard(),{allowed:true,code:null});
 let tracked,work=0,release;
 const delay=new Promise(r=>{release=r;});
 assert.equal(deferPartyumWork(p=>{tracked=p;},async()=>{
  await delay;
  if((await guard()).allowed)work++;
 }),true);
 await db.exec('update '+table+' set send_enabled=false');
 release();await tracked;
 assert.equal(work,0);
 assert.deepEqual(await guard(),{allowed:false,code:'PARTYUM_DISABLED'});
});

test('only the authenticated Partyum owner can distinguish scoped and global OFF',async()=>{
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 let global=true;
 const runtime=await createPartyumProductionRuntime({
  pool:{connect:async()=>({query:async(q)=>q.startsWith('select send_enabled')?{rows:[{send_enabled:false}]}:{},release(){}})},
  initTx:async()=>{},env:n=>n==='EMAIL_SENDING_ENABLED'&&global?'true':'',
  sb:{auth:{getUser:async token=>({data:{user:{id:token==='owner'?a:b}}})},from(table){
   let id;
   const q={select:()=>q,eq:(k,v)=>{id=v;return q;},maybeSingle:async()=>({data:table==='sanji_members'?{user_id:id}:id===a?{owner:a}:null})};
   return q;
  }},
 });
 const call=token=>runtime.handleMail(new Request('https://fixture.example.test',{method:'POST',
  headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'plan'})}));
 const outsider=await call('non-owner');assert.equal(outsider.status,401);assert.deepEqual(await outsider.json(),{error:'AUTH'});
 const scoped=await call('owner');assert.deepEqual(await scoped.json(),{error:'PARTYUM_DISABLED'});
 global=false;const outer=await call('owner');assert.deepEqual(await outer.json(),{error:'GLOBAL_EMAIL_DISABLED'});
});
