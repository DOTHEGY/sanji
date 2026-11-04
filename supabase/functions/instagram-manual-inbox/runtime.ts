// Shared by the deployed entrypoint and integration tests. Never logs provider data.
const MAX_PROVIDER_BYTES=1024*1024;
export function createManualRemote(fetchImpl:any=fetch){
 return async(url:string,options:any={})=>{
  const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='graph.instagram.com'||target.username||target.password||options.method!=='GET')throw Error('invalid provider');
  const response=await fetchImpl(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(3500)});
  if(response.status===429){const header=response.headers.get('retry-after'),n=header&&/^\d{1,5}$/.test(header)?Number(header):null;throw Object.assign(new Error('provider rate limited'),{status:429,retryAfterSeconds:n!==null&&n<=86400?n:null});}
  if(!response.ok)throw Error('provider request failed');
  const length=response.headers.get('content-length');if(length&&/^\d+$/.test(length)&&Number(length)>MAX_PROVIDER_BYTES){response.body?.cancel().catch(()=>{});throw Error('provider response too large');}
  if(!response.body)throw Error('provider response unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PROVIDER_BYTES){reader.cancel().catch(()=>{});throw Error('provider response too large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{reader.releaseLock();}
 };
}
