import {PROJECT} from './partyum-mail.mjs';
const TOKEN='https://oauth2.googleapis.com/token';
const API='https://gmail.googleapis.com/gmail/v1/users/me';
const address=/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
const providerId=/^[A-Za-z0-9_-]{1,128}$/;
const localId=/^[0-9a-f-]{36}$/i;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const err=code=>Object.assign(Error(code),{code});
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const byte64=(x)=>btoa(Array.from(x,c=>String.fromCharCode(c)).join(''));
const unbase64=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
const b64url=x=>byte64(x).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const allowedMailbox=x=>address.test(x)&&x.length<=254;
const nonempty=(x)=>typeof x==='string'&&x.length>0;
const encodeMime=(value)=>byte64(enc.encode(value));
function encodedSubject(subject){
 // RFC 2047 encoded-word length cap using complete UTF-8 code points.
 const words=[];let part='';
 for(const c of subject){
  if(part&&enc.encode(part+c).length>42){words.push('=?UTF-8?B?'+encodeMime(part)+'?=');part='';}
  part+=c;
 }
 if(part)words.push('=?UTF-8?B?'+encodeMime(part)+'?=');
 return words.join('\r\n ');
}
export function partyumMime({from,to,subject,body,intentId}){
 if(!allowedMailbox(from)||!allowedMailbox(to)||!localId.test(intentId??'')||
  !nonempty(subject)||subject.length>200||/[\r\n\0]/.test(subject)||
  !nonempty(body)||body.length>20000||/\0/.test(body))throw err('MIME_INVALID');
 const folded=(encodeMime(body).match(/.{1,76}/g)||[]).join('\r\n');
 return b64url(enc.encode([
  'From: '+from,'To: '+to,'Subject: '+encodedSubject(subject),
  // Stable reconciliation identifier, no new ads/tracking or copy changes.
  'Message-ID: <partyum-'+intentId.toLowerCase()+'@sanji.invalid>',
  'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',folded,'',
 ].join('\r\n')));
}

/** Only use as an injected server-side service in a Partyum-specific worker. */
export function createPartyumGmail({env,readConnection,request=fetch,now=Date.now}){
 if(typeof env!=='function'||typeof readConnection!=='function')throw err('GMAIL_UNCONFIGURED');
 async function remote(url,options={}){
  if(![TOKEN,API+'/profile',API+'/messages/send'].includes(url))throw err('GMAIL_DESTINATION_DENIED');
  let response;
  try{response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch{throw err('GMAIL_OUTCOME_UNKNOWN');}
  if(url===API+'/messages/send'&&response.status===429){
   const raw=response.headers.get('retry-after');
   const retry=raw!==null&&/^\d{1,6}$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw??'')-now())/1000);
   throw Object.assign(err('GMAIL_RATE_LIMIT'),{retryAfterSeconds:Number.isFinite(retry)?Math.max(30,Math.min(300,retry)):60});
  }
  let data;
  try{data=await response.json();}catch{throw err('GMAIL_OUTCOME_UNKNOWN');}
  if(!response.ok)throw err(url===TOKEN&&data?.error==='invalid_grant'?'GMAIL_REAUTH_REQUIRED':'GMAIL_OUTCOME_UNKNOWN');
  return data;
 }
 async function checkedConnection(q,owner){
  const r=await readConnection(q,owner);
  const email=norm(r?.summary?.email);
  if(r?.owner!==owner||r.provider!=='gmail'||r.summary?.reauthRequired===true||!allowedMailbox(email)||
     !nonempty(r.encrypted)||r.encrypted.length>24000)return null;
  // Ciphertext hash is revision-only: reconnect/re-encrypt stops prior snapshots.
  const rev=await crypto.subtle.digest('SHA-256',enc.encode(r.encrypted));
  return {...r,email,senderRef:'gmail:'+b64url(new Uint8Array(rev))};
 }
 const resolveSender=async(q,owner)=>{
  const r=await checkedConnection(q,owner);
  const ready=r&&env('PARTYUM_MAIL_ENABLED')==='true'&&env('EMAIL_SENDING_ENABLED')==='true'&&
   nonempty(env('TOKEN_ENCRYPTION_KEY'))&&nonempty(env('GOOGLE_CLIENT_ID'))&&nonempty(env('GOOGLE_CLIENT_SECRET'));
  return ready?{owner,verified:true,senderRef:r.senderRef}:null;
 };
 async function tokenFor(r){
  const secret=env('TOKEN_ENCRYPTION_KEY');
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(secret)),'AES-GCM',false,['decrypt']);
  let value;
  try{
   const raw=unbase64(r.encrypted);
   value=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12)},key,raw.slice(12))));
  }catch{throw err('GMAIL_CONNECTION_UNAVAILABLE');}
  if(norm(value?.email)!==r.email)throw err('GMAIL_ACCOUNT_CHANGED');
  if(nonempty(value.access_token)&&Number.isFinite(value.expires)&&value.expires>now()+60000)return value.access_token;
  if(!nonempty(value.refresh_token))throw err('GMAIL_REAUTH_REQUIRED');
  const fresh=await remote(TOKEN,{method:'POST',body:new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),
   client_secret:env('GOOGLE_CLIENT_SECRET'),refresh_token:value.refresh_token,grant_type:'refresh_token'})});
  if(!nonempty(fresh?.access_token)||!Number.isFinite(Number(fresh.expires_in))||Number(fresh.expires_in)<=60)throw err('GMAIL_REAUTH_REQUIRED');
  return fresh.access_token;
 }
 async function deliver({actor,projectId,from,to,subject,body,intentId}){
  // A callable worker adapter is never exposed to a browser. It is invoked only
  // by the due executor after the pending intent has been committed.
  if(projectId!==PROJECT||env('PARTYUM_MAIL_ENABLED')!=='true'||env('EMAIL_SENDING_ENABLED')!=='true'||
     !localId.test(intentId??''))throw err('GMAIL_SEND_DISABLED');
  const row=await checkedConnection(null,actor);
  if(!row||row.senderRef!==from)throw err('GMAIL_ACCOUNT_CHANGED');
  const accessToken=await tokenFor(row),headers={Authorization:'Bearer '+accessToken};
  const profile=await remote(API+'/profile',{headers});
  if(norm(profile?.emailAddress)!==row.email)throw err('GMAIL_ACCOUNT_CHANGED');
  if((await checkedConnection(null,actor))?.senderRef!==from)throw err('GMAIL_ACCOUNT_CHANGED');
  const raw=partyumMime({from:row.email,to,subject,body,intentId});
  const receipt=await remote(API+'/messages/send',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  if(!providerId.test(receipt?.id??'')||!providerId.test(receipt?.threadId??''))throw err('GMAIL_OUTCOME_UNKNOWN');
  return {kind:'accepted',intentId,providerId:receipt.id,at:new Date(now()).toISOString()};
 }
 return {resolveSender,deliver};
}
