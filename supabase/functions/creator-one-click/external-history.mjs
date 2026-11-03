// Read-only, owner-bound Gmail history check. Tokens and provider payloads never
// leave this module. Any uncertainty fails closed; no token refresh or writes.
const validEmail=x=>typeof x==='string'&&x.length<=254&&/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x);
async function safeJson(response){const announced=Number(response.headers.get('content-length')||0);if(Number.isFinite(announced)&&announced>32768)return null;if(!response.body)return null;const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>32768){await reader.cancel();return null}chunks.push(p.value)}const all=new Uint8Array(size);let n=0;for(const c of chunks){all.set(c,n);n+=c.byteLength}try{return JSON.parse(new TextDecoder().decode(all))}catch{return null}}
async function verifyGmailHistory({owner,address,readConnection,decrypt,fetcher=fetch,now=Date.now}){
 if(!owner||!validEmail(address)||typeof readConnection!=='function'||typeof decrypt!=='function')return null;
 try{
  const row=await readConnection(owner);if(!row||row.summary?.reauthRequired||String(row.summary?.email||'').toLowerCase()!=='valuest24@gmail.com'||typeof row.encrypted!=='string')return null;
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.encrypted))),x=>x.toString(16).padStart(2,'0')).join('');
  const session=await decrypt(row.encrypted);if(String(session?.email||'').toLowerCase()!=='valuest24@gmail.com'||typeof session.access_token!=='string'||!session.access_token||!Number.isFinite(Number(session.expires))||Number(session.expires)<=now()+60000)return null;
  const profile=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(12000)});if(!profile.ok)return null;const profileData=await safeJson(profile);if(String(profileData?.emailAddress||'').toLowerCase()!=='valuest24@gmail.com')return null;
  const email=address.toLowerCase(),query='in:sent {to:"'+email+'" cc:"'+email+'" bcc:"'+email+'"}',params=new URLSearchParams({q:query,maxResults:'1',includeSpamTrash:'true'});
  const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+params.toString(),{headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(12000)});
  if(!response.ok)return null;const result=await safeJson(response);
  if(!result||typeof result!=='object'||Array.isArray(result)||!Number.isInteger(result.resultSizeEstimate)||result.resultSizeEstimate<0||(result.messages!==undefined&&!Array.isArray(result.messages)))return null;
  const messages=result.messages||[];if(messages.length>1||messages.some(x=>!x||typeof x.id!=='string'||!x.id))return null;
  if(messages.length>0)return {complete:true,account:'valuest24@gmail.com',contacted:true,connectionFingerprint:fingerprint};
  if(result.resultSizeEstimate!==0||result.nextPageToken)return null;
  return {complete:true,account:'valuest24@gmail.com',contacted:false,connectionFingerprint:fingerprint};
 }catch{return null}
}
async function decryptGmailConnection(encrypted,keyText){
 if(!keyText||typeof encrypted!=='string')throw Error('unavailable');
 const packed=Uint8Array.from(atob(encrypted),c=>c.charCodeAt(0));if(packed.length<29)throw Error('unavailable');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(keyText)),key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.subarray(0,12)},key,packed.subarray(12));return JSON.parse(new TextDecoder().decode(plain));
}
export {verifyGmailHistory,decryptGmailConnection};
