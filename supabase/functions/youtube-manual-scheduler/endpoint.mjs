import {schedulerHandler} from '../youtube-manual-mail/scheduler-handler.mjs';
// The manual health route never calls the worker or accepts any work payload.
export function schedulerEndpoint({authorize,runOne}){
 const worker=schedulerHandler({authenticate:request=>authorize(request,'schedule'),runOne});
 return async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/auth-health')){
   if(request.method!=='POST')return new Response(null,{status:404});
   try{if(await authorize(request,'workflow_dispatch')!==true)return new Response(null,{status:401});return Response.json({status:'authenticated'},{headers:{'Cache-Control':'no-store'}});}catch{return new Response(null,{status:401});}
  }
  if(!/\/youtube-manual-scheduler\/?$/.test(path))return new Response(null,{status:404});
  return worker(request);
 };
}
