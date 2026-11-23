const ORIGIN='https://dothegy.github.io';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const errors=Object.freeze({
 AUTH:401,SCOPE:400,INVALID_EXCLUSION:400,INVALID_PLAN:409,PLAN_STALE:409,KEY_REUSED:409,
 SOURCE_UNVERIFIED:503,COPY_UNAVAILABLE:409,COPY_REVIEW_REQUIRED:409,ADMISSION_UNVERIFIED:503,
 NOT_CONFIGURED:503,DUPLICATE:409,NOT_ENABLED:503,REQUEST:400,SIZE:413,
});
const response=(v,status=200)=>Response.json(v,{headers,status});
const MAX_BYTES=12000;
async function parse(request){
 const reader=request.body?.getReader();if(!reader)throw new Error('REQUEST');
 const dec=new TextDecoder('utf-8',{fatal:true});
 let text='',n=0;
 for(;;){
  const {value,done}=await reader.read();if(done)break;
  n+=value.byteLength;if(n>MAX_BYTES){void reader.cancel().catch(()=>{});throw new Error('SIZE');}
  text+=dec.decode(value,{stream:true});
 }
 return JSON.parse(text+dec.decode());
}
export function createPartyumMailHandler({authenticate,mail}){
 return async request=>{
  const origin=request.headers.get('origin');
  if(origin&&origin!==ORIGIN)return response({error:'ORIGIN'},403);
  if(request.method==='OPTIONS')return new Response(null,{headers,status:204});
  if(request.method!=='POST')return response({error:'METHOD'},405);
  const bearer=request.headers.get('authorization')??'';
  if(!/^Bearer [^\s,]+$/i.test(bearer)||bearer.length>8192)return response({error:'AUTH'},401);
  let actor;try{actor=await authenticate(bearer.slice(7));}catch{return response({error:'AUTH'},401);}
  if(!actor)return response({error:'AUTH'},401);
  let input;try{input=await parse(request);}catch(e){
   return e?.message==='SIZE'?response({error:'SIZE'},413):response({error:'REQUEST'},400);
  }
  try{
   if(typeof mail!=='function')return response({error:'NOT_ENABLED'},503);
   return response(await mail(actor,input));
  }catch(e){
   const code=Object.hasOwn(errors,e?.code)?e.code:'ADMISSION_UNVERIFIED';
   return response({error:code},errors[code]);
  }
 };
}
