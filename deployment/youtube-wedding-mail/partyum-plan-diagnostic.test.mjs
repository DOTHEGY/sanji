import test from 'node:test';
import assert from 'node:assert/strict';
import {logPlanDiagnostic} from './partyum-plan-diagnostic.mjs';
import {createPartyumProductionRuntime,readPartyumPlanKey} from './production-runtime.mjs';
import {PROJECT} from './partyum-mail.mjs';
const owner='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const ch='UC'+'a'.repeat(22), day='2026-11-21';
const hidden='private user@example.test body and postgres://do-not-log';

const fixture=new Uint8Array(32).fill(8);
function scenario({global=true,failControl=false,material=fixture}={}){
 const lines=[];
 const runtime=createPartyumProductionRuntime({
  planLog:x=>lines.push(JSON.parse(x)),
  pool:{connect:async()=>({query:async(sql)=>{
   if(sql.startsWith('select send_enabled')){
    if(failControl)throw Object.assign(new Error(hidden),{code:'42501'});
    return {rows:[{send_enabled:true}]};
   }
   if(sql.startsWith('select material'))return {rows:[{material}]};
   if(sql.includes('clock_timestamp() as now'))return {rows:[{now:new Date()}]};
   if(sql.includes('select user_id'))return {rows:[{user_id:owner}]};
   if(sql.includes('sanji_private_wedding_shortlist'))return {rows:[{channel_id:ch}]};
   if(sql.includes('read_partyum_verified_contacts'))throw Object.assign(new Error(hidden),{code:'42501'});
   return {rows:[]};
  },release(){}})},
  initTx:async()=>{},env:n=>n==='EMAIL_SENDING_ENABLED'?(global?'true':''):n==='GOOGLE_CLIENT_ID'?'fixture-google-id':'',
  sb:{auth:{getUser:async token=>({data:{user:{id:token==='owner'?owner:other}}})},from(table){
   let id;const q={select:()=>q,eq:(k,v)=>{id=v;return q;},maybeSingle:async()=>({data:table==='sanji_members'?{user_id:id}:id===owner?{owner}:null})};
   return q;
  }},
 });
 async function call(token='owner',action='plan'){
  const rt=await runtime;
  return rt.handleMail(new Request('https://fixture.example.test',{method:'POST',
   headers:{Authorization:'Bearer '+token},body:JSON.stringify({action,mode:'now',projectId:PROJECT,day,channelIdsExcluded:[]})}));
 }
 return {call,lines};
}
test('only known stage/code; no raw exception, input, identity or secret',async()=>{
 const s=scenario();const r=await s.call();
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'ADMISSION_UNVERIFIED'});
 assert.deepEqual(s.lines,[{event:'partyum_plan_gmail_env',tokenKeyPresent:false,googleClientIdPresent:true,googleClientSecretPresent:false},{event:'partyum_plan_diagnostic',phase:'snapshot_contacts',code:'42501'}]);
 assert.doesNotMatch(JSON.stringify(s.lines),/postgres:|example.test|00000000|2026-/);
 assert.equal((await s.call('not_owner')).status,401);
 await s.call('owner','submit');assert.equal(s.lines.length,2);
});
test('explicit global OFF is diagnosed safely while scoped flag can remain OFF',async()=>{
 const s=scenario({global:false});const r=await s.call();
 assert.deepEqual(await r.json(),{error:'GLOBAL_EMAIL_DISABLED'});
 assert.deepEqual(s.lines,[{event:'partyum_plan_diagnostic',phase:'product_control',code:'GLOBAL_EMAIL_DISABLED'}]);
});
test('known DB failure in control read is distinguished without raw exception',async()=>{
 const s=scenario({failControl:true});const r=await s.call();
 assert.equal(r.status,503);
 assert.deepEqual(s.lines,[{event:'partyum_plan_diagnostic',phase:'control_query',code:'42501'},
 {event:'partyum_plan_diagnostic',phase:'product_control',code:'PARTYUM_CONTROL_UNAVAILABLE'}]);
});
test('attacker-controlled stages and error codes cannot leave the log allowlist',()=>{
 let out;logPlanDiagnostic(x=>{out=x;},'unexpected-stage',Object.assign(Error(hidden),{partyumStage:hidden,code:hidden}));
 assert.deepEqual(JSON.parse(out),{event:'partyum_plan_diagnostic',phase:'snapshot',code:'OTHER'});
});

test('plan key reads role-scoped private bytea and fails closed on invalid key',async()=>{
 const calls=[];
 const q={query:async(sql,params)=>{
  calls.push([sql,params]);return {rows:[{material:fixture}]};
 },release(){calls.push(['released']);}};
 const key=await readPartyumPlanKey({pool:{connect:async()=>q},initTx:q=>q.query('set local role service_role')});
 assert.deepEqual(key,fixture);
 assert.deepEqual(calls.map(r=>r[0]),['begin read only','set local role service_role',"set local statement_timeout='3000ms'",
 'select material from sanji_partyum_internal.partyum_plan_key where project_id=$1','commit','released']);
 const s=scenario({material:'broken'});
 assert.equal((await s.call()).status,503);
 assert.deepEqual(s.lines.at(-1),{event:'partyum_plan_diagnostic',phase:'plan_signing',code:'NOT_CONFIGURED'});
});
