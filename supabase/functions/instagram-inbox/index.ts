import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {Buffer} from 'node:buffer';
import {resolveInstagramSession} from './session.ts';
import {instagramInboxHandler} from './handler.ts';
import {metaCompatibility} from './meta-compatibility.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function query(p:any){const {data,error}=await p;if(error)throw Error('database request failed');return data;}
const digest=async(s:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function key(){const secret=env('TOKEN_ENCRYPTION_KEY');if(!secret)throw Error('encryption key unavailable');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
async function encrypt(value:any){const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(JSON.stringify(value)));return Buffer.concat([Buffer.from(iv),Buffer.from(bytes)]).toString('base64');}
async function decrypt(value:string){const b=Buffer.from(value,'base64');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.subarray(0,12)},await key(),b.subarray(12))));}
async function connection(owner:string,provider:string){const r=await query(sb.from('sanji_connections').select('encrypted').eq('owner',owner).eq('provider',provider).maybeSingle());return r?decrypt(r.encrypted):null;}
async function remote(url:string,options:any={}){const target=new URL(url);if(target.protocol!=='https:'||!['graph.instagram.com','api.instagram.com'].includes(target.hostname)||target.username||target.password)throw Error('invalid provider');const response=await fetch(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(20000)});if(!response.ok){const failure:any=Error('provider request failed');failure.status=response.status;failure.httpStatus=response.status;try{const data=await response.json();const compatibility=metaCompatibility(data);if(compatibility)failure.compatibility=compatibility;for(const [source,target] of [['code','metaCode'],['error_subcode','metaSubcode']]){const n=data?.error?.[source]??data?.[source];if(Number.isSafeInteger(n)&&n>=0&&n<=2147483647)failure[target]=n;}}catch{}throw failure;}return response.json();}
async function capabilities(session:any,request:any,version:string){try{await request('https://graph.instagram.com/'+version+'/me/conversations?platform=instagram&limit=1',{headers:{Authorization:'Bearer '+session.access_token}});return {profileVerified:true,messagesReadable:true,checked:new Date().toISOString()};}catch{return {profileVerified:true,messagesReadable:false,checked:new Date().toISOString()};}}
async function audit(owner:string,action:string,data:any){await query(sb.from('sanji_audit').insert({owner,action,data}));}
Deno.serve(instagramInboxHandler({sb,query,env,key,digest,encrypt,connection,remote,resolveSession:resolveInstagramSession,capabilities,audit}));
