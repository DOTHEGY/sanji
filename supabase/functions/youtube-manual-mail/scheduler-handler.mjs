// Invoked only through a separately authenticated service endpoint. It accepts
// no owner, batch ID or recipient data from the request.
export function schedulerHandler({authenticate,runOne}){
 if(typeof authenticate!=='function'||typeof runOne!=='function')throw Error('SCHEDULER_AUTH_REQUIRED');
 return async request=>{
  const response=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method!=='POST')return response({code:'NOT_FOUND'},404);
  try{if(await authenticate(request)!==true)return response({code:'UNAUTHORIZED'},401);const result=await runOne();return response({status:result?.status||'unknown'},200);}catch{return response({code:'WORKER_UNAVAILABLE'},503);}
 };
}
