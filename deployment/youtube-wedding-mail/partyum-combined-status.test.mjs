import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyumCombinedStatus} from './partyum-combined-status.mjs';
import {PROJECT} from './partyum-mail.mjs';
const a='UC'+'a'.repeat(22),b='UC'+'b'.repeat(22),c='UC'+'c'.repeat(22);
const scope={actor:'fixture-owner',projectId:PROJECT,day:'2026-11-23',channelIds:[a,b,c]};
const future='2026-11-24T01:00:00Z';
const item=(channelId,status='found_only',at=null)=>({channelId,status,at,completeForCandidate:true});
const legacy=items=>async()=>({projectId:PROJECT,day:scope.day,items});
test('projection uses linked authorized canonical record only; queued holds suppress discovery',async()=>{
 const read=createPartyumCombinedStatus({readLegacy:legacy([item(a),item(b),item(c)]),
  readLedger:async()=>new Map([[a,item(a,'scheduled',future)],[b,item(b,'unknown')]])});
 const {items}=await read(scope);assert.deepEqual(items.map(x=>x.status),['scheduled','unknown','found_only']);
 assert.equal(items[0].at,'2026-11-24T01:00:00.000Z');
});
test('origin overlap and cross-project errors fail closed',async()=>{
 const old=legacy([item(a,'sent',future),item(b),item(c)]);
 const read=createPartyumCombinedStatus({readLegacy:old,readLedger:async()=>new Map([[a,item(a,'scheduled',future)]])});
 assert.equal((await read(scope)).items[0].status,'unknown');
 await assert.rejects(()=>read({...scope,projectId:'chewy'}),/scope/);
});
