import {readPartyumDayStatus} from './partyum-day-status.mjs';
const publicOrigin='https://dothegy.github.io';
const headers={
 'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
 'Access-Control-Allow-Origin':publicOrigin,
 'Access-Control-Allow-Headers':'authorization, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const respond=(body,status=200)=>Response.json(body,{headers,status});
const maximumBody=12000;
async function boundedJson(request){
 const reader=request.body?.getReader();
 if(!reader)throw new Error('REQUEST');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let decoded='',size=0;
 for(;;){
  const {value,done}=await reader.read();if(done)break;
  size+=value.byteLength;
  if(size>maximumBody){void reader.cancel().catch(()=>{});throw new Error('SIZE');}
  decoded+=decoder.decode(value,{stream:true});
 }
 return JSON.parse(decoded+decoder.decode());
}

export function createPartyumDayStatusHandler({authenticate,readShortlist,readSnapshot,now}){
 return async request=>{
  const origin=request.headers.get('origin');
  if(origin&&origin!==publicOrigin)return respond({error:'ORIGIN'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return respond({error:'METHOD'},405);
  const bearer=request.headers.get('authorization')??'';
  if(!/^Bearer [^\s,]+$/i.test(bearer)||bearer.length>8192)return respond({error:'AUTH'},401);
  let actor; try{actor=await authenticate(bearer.slice(7));}catch{return respond({error:'AUTH'},401);}
  if(!actor)return respond({error:'AUTH'},401);
  let input;
  try{input=await boundedJson(request);}catch(e){
   return e?.message==='SIZE'?respond({error:'SIZE'},413):respond({error:'REQUEST'},400);
  }
  try{
   const result=await readPartyumDayStatus({actor,input,readShortlist,readSnapshot,now});
   return respond(result);
  }catch(e){
   if(e?.code==='AUTH')return respond({error:'AUTH'},401);
   if(e?.code==='SCOPE')return respond({error:'SCOPE'},400);
   return respond({error:'READ'},503);
  }
 };
}
