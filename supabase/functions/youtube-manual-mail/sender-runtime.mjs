import {Buffer} from 'node:buffer';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {emailIdentity,OutreachError} from '../creator-daily-outreach/domain.mjs';
import {hashValue} from '../creator-daily-outreach/private-config.mjs';
import {createDailyDispatch} from '../creator-daily-outreach/dispatch.mjs';
import {dailyDispatchRepository} from '../creator-daily-outreach/dispatch-repository.mjs';

const error=code=>new OutreachError(code, '현재 Gmail 연결과 이력 검토가 필요합니다.',409);
const tokenURL='https://oauth2.googleapis.com/token',base='https://gmail.googleapis.com/gmail/v1/users/me';

// Reuses Sanji's existing encrypted Gmail connection and ordinary token refresh.
// No OAuth grants, credential/settings writes, saved drafts or external storage.
// Requests are injectable; the tests supply mocks and never read live tokens.
export function dailyGmailProvider({sb,env=()=>'',request=fetch,now=Date.now}){
 const sessions=new Map();
 const query=async promise=>{const r=await promise;if(r.error)throw error('GMAIL_CONNECTION_UNAVAILABLE');return r.data;};
 async function remote(url,options={}){
  const u=new URL(url),token=url===tokenURL&&options.method==='POST';
  const read=u.origin==='https://gmail.googleapis.com'&&(!options.method||options.method==='GET')&&(u.pathname==='/gmail/v1/users/me/messages'||/^\/gmail\/v1\/users\/me\/messages\/[A-Za-z0-9_-]{1,200}$/.test(u.pathname)||u.pathname==='/gmail/v1/users/me/profile');
  const send=url===base+'/messages/send'&&options.method==='POST';
  if(!token&&!read&&!send)throw error('PROVIDER_DESTINATION_NOT_ALLOWED');
  let response;try{response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(send?20000:12000)});}catch{throw error('PROVIDER_OUTCOME_UNKNOWN');}
  let data;try{data=await response.json();}catch{const e=error('PROVIDER_RESPONSE_INVALID');if(!response.ok)e.status=response.status;throw e;}
  if(!response.ok){const e=error(token&&data?.error==='invalid_grant'?'GMAIL_REAUTH_REQUIRED':'PROVIDER_REJECTED');e.status=response.status;throw e;}
  return data;
 }
 async function connection(owner){
  const r=await query(sb.from('sanji_connections').select('owner,encrypted,summary').eq('owner',owner).eq('provider','gmail').maybeSingle());
  if(!r||r.owner!==owner||r.summary?.reauthRequired===true||!env('TOKEN_ENCRYPTION_KEY'))throw error('GMAIL_REAUTH_REQUIRED');
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env('TOKEN_ENCRYPTION_KEY'))),'AES-GCM',false,['decrypt']);
  try{const bytes=Buffer.from(r.encrypted,'base64'),value=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},key,bytes.subarray(12))));
   if(!emailIdentity(value.email)||value.email.toLowerCase()!==r.summary.email?.toLowerCase())throw error('GMAIL_ACCOUNT_CHANGED');return value;
  }catch{throw error('GMAIL_CONNECTION_UNAVAILABLE');}
 }
 async function account(owner,senderEmail){
  // Re-read summary on every preflight, even while using an in-memory token.
  const current=await query(sb.from('sanji_connections').select('owner,summary').eq('owner',owner).eq('provider','gmail').maybeSingle());
  if(current?.owner!==owner||current.summary?.reauthRequired===true||current.summary?.email?.toLowerCase()!==senderEmail)throw error('GMAIL_ACCOUNT_CHANGED');
  let session=sessions.get(owner);
  if(!session||session.email!==senderEmail||session.expires<=now()+60000){
   let c=await connection(owner);if(c.email.toLowerCase()!==senderEmail)throw error('GMAIL_ACCOUNT_CHANGED');
   if(!c.access_token||!Number.isFinite(c.expires)||c.expires<=now()+60000){
    if(!c.refresh_token||!env('GOOGLE_CLIENT_ID')||!env('GOOGLE_CLIENT_SECRET'))throw error('GMAIL_REAUTH_REQUIRED');
    const fresh=await remote(tokenURL,{method:'POST',body:new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),client_secret:env('GOOGLE_CLIENT_SECRET'),refresh_token:c.refresh_token,grant_type:'refresh_token'})});
    if(typeof fresh.access_token!=='string'||!Number.isFinite(Number(fresh.expires_in))||Number(fresh.expires_in)<=0)throw error('GMAIL_REAUTH_REQUIRED');
    c={...c,access_token:fresh.access_token,expires:now()+Number(fresh.expires_in)*1000};
   }
   session={id:randomUUID(),email:senderEmail,accessToken:c.access_token,expires:c.expires};sessions.set(owner,session);
  }
  const profile=await remote(base+'/profile',{headers:{Authorization:'Bearer '+session.accessToken}});
  if(profile?.emailAddress?.toLowerCase()!==senderEmail)throw error('GMAIL_ACCOUNT_CHANGED');
  return session;
 }
 function listResult(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||data.messages!==undefined&&!Array.isArray(data.messages)||data.resultSizeEstimate!==undefined&&(!Number.isInteger(data.resultSizeEstimate)||data.resultSizeEstimate<0)||data.messages===undefined&&data.resultSizeEstimate!==0)throw error('GMAIL_HISTORY_UNVERIFIED');
  return data.messages||[];
 }
 async function history({owner,address,senderEmail}){
  const started=now();
  const emailKey=emailIdentity(address);if(!emailKey||address!==address.trim().toLowerCase()||!emailIdentity(senderEmail)||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address))throw error('INVALID_EMAIL');
  const session=await account(owner,senderEmail),headers={Authorization:'Bearer '+session.accessToken};
  const q=`in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`;
  const result=await remote(base+'/messages?'+new URLSearchParams({q,maxResults:'1',includeSpamTrash:'true'}),{headers});
  if(listResult(result).length||result.nextPageToken||Number(result.resultSizeEstimate)>0)throw error('EXISTING_GMAIL_CONTACT');
  if(emailKey.endsWith('@gmail.com')){
   // Gmail aliases can contain arbitrary dots and plus tags. A narrow exact
   // search is not proof of absence. Inspect bounded domain-wide metadata;
   // a mailbox larger than the budget is held, never treated as clear.
   const broad='in:anywhere {from:gmail.com to:gmail.com cc:gmail.com bcc:gmail.com from:googlemail.com to:googlemail.com cc:googlemail.com bcc:googlemail.com}';
   const aliases=await remote(base+'/messages?'+new URLSearchParams({q:broad,maxResults:'100',includeSpamTrash:'true'}),{headers}),messages=listResult(aliases);
   if(aliases.nextPageToken||Number(aliases.resultSizeEstimate)>messages.length||messages.length>100)throw error('GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED');
   for(const message of messages){
    if(now()-started>10000)throw error('GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED');
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(message?.id||''))throw error('GMAIL_HISTORY_UNVERIFIED');
    const params=new URLSearchParams({format:'metadata'});for(const name of ['From','To','Cc','Bcc','Delivered-To'])params.append('metadataHeaders',name);
    const detail=await remote(base+'/messages/'+message.id+'?'+params,{headers});
    if(detail?.id!==message.id||!Array.isArray(detail?.payload?.headers))throw error('GMAIL_HISTORY_UNVERIFIED');
    const recipientHeaders=detail.payload.headers.filter(h=>['from','to','cc','bcc','delivered-to'].includes(String(h.name).toLowerCase()));
    if(!recipientHeaders.length||recipientHeaders.some(h=>typeof h.value!=='string'))throw error('GMAIL_HISTORY_UNVERIFIED');
    const addresses=recipientHeaders.flatMap(h=>h.value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]);
    if(addresses.some(value=>emailIdentity(value)===emailKey))throw error('EXISTING_GMAIL_CONTACT');
   }
  }
  return {session:session.id,proof:{checkedAt:new Date(started).toISOString(),address,emailKey,senderEmail,clear:true}};
 }
 // Read-only, bounded metadata for an owner review of existing correspondence.
 // Message IDs remain server-side except as owner-visible Gmail links. No body is
 // returned or recorded, and a paginated/incomplete search always fails closed.
 async function historyFingerprint({owner,address,senderEmail}){
  const started=now(),key=emailIdentity(address);if(!key||address!==address.trim().toLowerCase()||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)||!emailIdentity(senderEmail))throw error('INVALID_EMAIL');
  const session=await account(owner,senderEmail),headers={Authorization:'Bearer '+session.accessToken};
  const exact=`in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`;
  const queries=[exact];if(key.endsWith('@gmail.com'))queries.push('in:anywhere {from:gmail.com to:gmail.com cc:gmail.com bcc:gmail.com from:googlemail.com to:googlemail.com cc:googlemail.com bcc:googlemail.com}');
  const ids=new Set();for(const q of queries){const list=await remote(base+'/messages?'+new URLSearchParams({q,maxResults:'100',includeSpamTrash:'true'}),{headers}),messages=listResult(list);if(list.nextPageToken||Number(list.resultSizeEstimate)>messages.length||messages.length>100)throw error('GMAIL_HISTORY_REVIEW_REQUIRED');for(const message of messages){if(!/^[A-Za-z0-9_-]{1,200}$/.test(message?.id||''))throw error('GMAIL_HISTORY_UNVERIFIED');ids.add(message.id);}}
  if(ids.size>100)throw error('GMAIL_HISTORY_REVIEW_REQUIRED');const matched=[];
  for(const id of ids){if(now()-started>10000)throw error('GMAIL_HISTORY_REVIEW_REQUIRED');const params=new URLSearchParams({format:'metadata'});for(const name of ['From','To','Cc','Bcc','Delivered-To'])params.append('metadataHeaders',name);const detail=await remote(base+'/messages/'+id+'?'+params,{headers});if(detail?.id!==id||!Array.isArray(detail?.payload?.headers))throw error('GMAIL_HISTORY_UNVERIFIED');const hs=detail.payload.headers.filter(h=>['from','to','cc','bcc','delivered-to'].includes(String(h.name).toLowerCase()));if(!hs.length||hs.some(h=>typeof h.value!=='string'))throw error('GMAIL_HISTORY_UNVERIFIED');const addresses=hs.flatMap(h=>h.value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]);if(addresses.some(v=>emailIdentity(v)===key))matched.push(id);}
  matched.sort();return {emailKey:key,senderEmail,messageIds:matched,fingerprint:hashValue({owner,emailKey:key,senderEmail,ids:matched}),checkedAt:new Date(started).toISOString()};
 }
 const usedSessions=new Set();
 async function send({owner,raw,rawHash,senderEmail,session:sessionId,grant}){
  // Independent deployment gates also guard the only network-send call.
  if(!['CREATOR_DAILY_CONFIGURATION_ENABLED','CREATOR_DAILY_DISPATCH_ENABLED','CREATOR_DAILY_SCHEDULER_ENABLED','EMAIL_SENDING_ENABLED'].every(name=>env(name)==='true'))throw error('EMAIL_SENDING_DISABLED');
  const session=sessions.get(owner);
  if(!session||session.id!==sessionId||session.email!==senderEmail||session.expires<=now()+20000||typeof raw!=='string'||hashValue(raw)!==rawHash||grant?.ready!==true||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now()||Date.parse(grant.expiresAt)>now()+16000)throw error('SEND_GRANT_EXPIRED');
  const key=hashValue({owner,sessionId,rawHash,expiresAt:grant.expiresAt});if(usedSessions.has(key))throw error('SEND_GRANT_REUSED');usedSessions.add(key);
  return remote(base+'/messages/send',{method:'POST',headers:{Authorization:'Bearer '+session.accessToken,'Content-Type':'application/json'},body:JSON.stringify({raw})});
 }
 // Manual YouTube entry is separate from the scheduled worker and defaults off.
 // Its caller MUST first consume an immutable owner-bound database send grant.
 async function manualSession({owner,senderEmail}){
  if(env('YOUTUBE_MANUAL_SEND_ENABLED')!=='true'||env('EMAIL_SENDING_ENABLED')!=='true')throw error('EMAIL_SENDING_DISABLED');
  if(typeof senderEmail!=='string'||senderEmail!==senderEmail.trim().toLowerCase()||!emailIdentity(senderEmail))throw error('GMAIL_ACCOUNT_CHANGED');
  const s=await account(owner,senderEmail);return {session:s.id};
 }
 async function manualSend({owner,raw,rawHash,senderEmail,session:sessionId,grant}){
  if(env('YOUTUBE_MANUAL_SEND_ENABLED')!=='true'||env('EMAIL_SENDING_ENABLED')!=='true')throw error('EMAIL_SENDING_DISABLED');
  const session=sessions.get(owner),expiry=Date.parse(grant?.expiresAt);
  if(!session||session.id!==sessionId||session.email!==senderEmail||session.expires<=now()+20000||typeof raw!=='string'||hashValue(raw)!==rawHash||grant?.ready!==true||grant.payloadHash!==rawHash||!Number.isFinite(expiry)||expiry<=now()||expiry>now()+5000)throw error('SEND_GRANT_EXPIRED');
  const key=hashValue({owner,sessionId,rawHash,expiresAt:grant.expiresAt});if(usedSessions.has(key))throw error('SEND_GRANT_REUSED');usedSessions.add(key);
  return remote(base+'/messages/send',{method:'POST',headers:{Authorization:'Bearer '+session.accessToken,'Content-Type':'application/json'},body:JSON.stringify({raw})});
 }
 return {history,historyFingerprint,send,manualSession,manualSend,resetSession(){sessions.clear();usedSessions.clear();}};
}
export function createDailyDispatchRuntime({sb,env,request=fetch,now=Date.now,uuid=randomUUID,recurringTriggerVerified=()=>false,candidateResolver}){
 const provider=dailyGmailProvider({sb,env,request,now}),worker=createDailyDispatch({repository:dailyDispatchRepository(sb,{candidateResolver}),provider,env,now,uuid,recurringTriggerVerified});
 return {...worker,async run(owner,options){provider.resetSession();try{return await worker.run(owner,options);}finally{provider.resetSession();}}};
}

// Optional isolated internal handler, never a user-selected owner/send route.
// No cron is registered by this module and no runner credential is created.
export function dailyCampaignRunnerHandler({run,env=()=>''}){
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async request=>{
  if(request.method!=='POST'||!new URL(request.url).pathname.endsWith('/creator-daily-outreach/run'))return json({error:'not_found'},404);
  const expected=env('JOB_RUNNER_TOKEN')||'',provided=request.headers.get('x-job-token')||'';
  if(expected.length<32)return json({error:'runner_not_configured'},503);
  if(provided.length>1024||!timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(provided).digest()))return json({error:'not_authorized'},401);
  if(Number(request.headers.get('content-length')||0)>1024)return json({error:'invalid_request'},413);
  if(request.body){const reader=request.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024){await reader.cancel();return json({error:'invalid_request'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();try{const body=text.trim()?JSON.parse(text):{};if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return json({error:'invalid_request'},400);}catch{return json({error:'invalid_request'},400);}}
  try{return json(await run());}catch{return json({error:'worker_unavailable'},503);}
 };
}
