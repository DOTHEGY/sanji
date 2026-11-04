import {Buffer} from 'node:buffer';
import {isolatedCreatorEmailService} from './creator-email-isolated-service.ts';

export function creatorEmailRuntime({sb,env,request=fetch,now=Date.now}:any){
 const query=async(p:any)=>{const r=await p;if(r.error)throw Error('database_operation_failed');return r.data;};
 const digest=async(v:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('hex');
 async function decrypt(value:string){
  if(!env('TOKEN_ENCRYPTION_KEY'))throw Error('connection_unavailable');
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env('TOKEN_ENCRYPTION_KEY'))),'AES-GCM',false,['decrypt']);
  const bytes=Buffer.from(value,'base64');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},key,bytes.subarray(12))));
 }
 async function connection(owner:string,provider:string){
  if(!['gmail','creator_meta'].includes(provider))throw Error('connection_provider_not_allowed');
  const row=await query(sb.from('sanji_connections').select('encrypted,summary').eq('owner',owner).eq('provider',provider).maybeSingle());
  if(!row)return null;
  if(provider==='gmail'&&row.summary?.reauthRequired)throw Error('gmail_reauth_required');
  return await decrypt(row.encrypted);
 }
 async function remote(url:string,options:any={}){
  const u=new URL(url),token=url==='https://oauth2.googleapis.com/token';
  const history=u.origin==='https://gmail.googleapis.com'&&u.pathname==='/gmail/v1/users/me/messages'&&(!options.method||options.method==='GET');
  const send=u.origin==='https://gmail.googleapis.com'&&u.pathname==='/gmail/v1/users/me/messages/send'&&options.method==='POST'&&!u.search;
  if(!token&&!history&&!send)throw Error('remote_destination_not_allowed');
  let response:any;
  try{response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(send?20000:12000)});}catch{throw Error('provider_outcome_unknown');}
  let data:any;try{data=await response.json();}catch{const e:any=Error('provider_response_invalid');e.status=response.ok?undefined:response.status;throw e;}
  if(!response.ok){const e:any=Error(token&&data?.error==='invalid_grant'?'gmail_reauth_required':'provider_rejected');e.status=response.status;throw e;}
  return data;
 }
 const cached=new Map<string,any>();
 async function gmailToken(owner:string){
  const stored=cached.get(owner);if(stored?.expires>now()+60000)return stored;
  const c=await connection(owner,'gmail');
  if(!c||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(c.email||'')))throw Error('gmail_account_changed');
  if(c.access_token&&c.expires>now()+60000){cached.set(owner,c);return c;}
  if(!c.refresh_token||!env('GOOGLE_CLIENT_ID')||!env('GOOGLE_CLIENT_SECRET'))throw Error('gmail_reauth_required');
  const r=await remote('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),client_secret:env('GOOGLE_CLIENT_SECRET'),refresh_token:c.refresh_token,grant_type:'refresh_token'})});
  if(typeof r.access_token!=='string'||!Number.isFinite(Number(r.expires_in))||Number(r.expires_in)<=0)throw Error('gmail_reauth_required');
  // Ordinary refresh uses an existing grant. Keep short-lived access in memory:
  // never save credentials, change the connection, request scopes or enroll OAuth.
  const fresh={...c,access_token:r.access_token,expires:now()+Number(r.expires_in)*1000};cached.set(owner,fresh);return fresh;
 }
 const audit=async(owner:string,action:string,data:any)=>await query(sb.from('sanji_audit').insert({owner,action,data}));
 return isolatedCreatorEmailService({sb,query,env,connection,gmailToken,remote,digest,uuid:()=>crypto.randomUUID(),audit,request,now});
}

async function sameSecret(a:string,b:string){
 const encode=new TextEncoder(),x=new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(a))),y=new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(b)));
 let different=0;for(let i=0;i<x.length;i++)different|=x[i]^y[i];return different===0;
}
export function creatorEmailHandler({run,env}:any){
 const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async(req:Request)=>{
  if(req.method!=='POST'||!new URL(req.url).pathname.endsWith('/creator-email-worker/run'))return json({error:'not_found'},404);
  const expected=env('JOB_RUNNER_TOKEN')||'',provided=req.headers.get('x-job-token')||'';
  if(expected.length<32)return json({error:'runner_not_configured'},503);
  if(provided.length>1024||!await sameSecret(expected,provided))return json({error:'not_authorized'},401);
  if(Number(req.headers.get('content-length')||0)>1024)return json({error:'invalid_request'},413);
  // No caller-selected owner, recipient, content, policy or arbitrary dispatch.
  if(req.body){let length=0;const chunks:Uint8Array[]=[],reader=req.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024){await reader.cancel();return json({error:'invalid_request'},413);}chunks.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const body=new TextDecoder().decode(bytes);try{if(body.trim()&&JSON.stringify(JSON.parse(body))!=='{}')return json({error:'invalid_request'},400);}catch{return json({error:'invalid_request'},400);}}
  try{return json(await run());}catch{return json({error:'worker_unavailable'},503);}
 };
}
