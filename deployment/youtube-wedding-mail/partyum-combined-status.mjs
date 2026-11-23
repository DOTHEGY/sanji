import {PROJECT} from './partyum-mail.mjs';
const UC=/^UC[A-Za-z0-9_-]{22}$/;
const unknown=channelId=>({channelId,status:'unknown',at:null,completeForCandidate:false});
const states=new Set(['found_only','scheduled','sent','failed','unknown']);
function clean(item,channelId){
 if(!item||!states.has(item.status)||item.completeForCandidate!==true||item.status==='unknown')return unknown(channelId);
 if(item.status==='found_only')return {channelId,status:'found_only',at:null,completeForCandidate:true};
 if(typeof item.at!=='string'||!Number.isFinite(Date.parse(item.at)))return unknown(channelId);
 return {channelId,status:item.status,at:new Date(item.at).toISOString(),completeForCandidate:true};
}
/** Wire only after both readers have been verified under the existing auth guard. */
export function createPartyumCombinedStatus({readLegacy,readLedger}){
 return async scope=>{
  const {actor,projectId,day,channelIds}=scope;
  if(projectId!==PROJECT||typeof actor!=='string'||!Array.isArray(channelIds)||!channelIds.length||channelIds.length>100||
     !channelIds.every(x=>typeof x==='string'&&UC.test(x))||new Set(channelIds).size!==channelIds.length)throw Error('Status scope mismatch');
  const fallback=()=>({projectId,day,items:channelIds.map(unknown)});
  let legacy,logged;
  try{[legacy,logged]=await Promise.all([readLegacy(scope),readLedger(scope)]);}catch{return fallback();}
  if(legacy?.projectId!==projectId||legacy.day!==day||!Array.isArray(legacy.items)||!(logged instanceof Map)||
     new Set(legacy.items.map(x=>x?.channelId)).size!==legacy.items.length||
     legacy.items.some(x=>!channelIds.includes(x?.channelId))||[...logged.keys()].some(x=>!channelIds.includes(x)))return fallback();
  const old=new Map(legacy.items.map(x=>[x.channelId,x]));
  return {projectId,day,items:channelIds.map(channelId=>{
   const previous=clean(old.get(channelId),channelId);
   if(!logged.has(channelId))return previous;
   const current=clean(logged.get(channelId),channelId);
   // A second, legacy event could be ambiguous. Do not union or choose latest blindly.
   return previous.status==='found_only'?current:unknown(channelId);
  })};
 };
}
