// GitHub signs short-lived job identities. No database, GitHub or Edge secret
// is placed in an HTTP request queue. Failed discovery or verification is a deny.
const ISSUER='https://token.actions.githubusercontent.com';
const JWKS=ISSUER+'/.well-known/jwks';
const AUDIENCE='sanji-youtube-scheduler-v1';
const WORKFLOW='DOTHEGY/sanji/.github/workflows/youtube-manual-scheduler.yml@refs/heads/main';
const decode=value=>{if(typeof value!=='string'||!value||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid');const encoded=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(encoded+'='.repeat((4-encoded.length%4)%4)),c=>c.charCodeAt(0));};
const parse=value=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(value)));
let cachedKeys=null,cachedUntil=0,pendingKeys=null;
async function readKeys(fetchKeys,now){
 const cacheable=fetchKeys===fetch,time=now();if(cacheable&&cachedKeys&&time<cachedUntil)return cachedKeys;if(cacheable&&pendingKeys)return pendingKeys;
 const load=async()=>{const response=await fetchKeys(JWKS,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length')||0)>65536)throw Error('unavailable');const text=await response.text();if(text.length>65536)throw Error('invalid');const keys=JSON.parse(text)?.keys;if(!Array.isArray(keys)||keys.length>100)throw Error('invalid');if(cacheable){cachedKeys=keys;cachedUntil=now()+300000;}return keys;};
 if(!cacheable)return load();pendingKeys=load();try{return await pendingKeys;}finally{pendingKeys=null;}
}
export async function authorizedGithubScheduler(request,{fetchKeys=fetch,now=Date.now,event='schedule'}={}){
 try{
  if(!['schedule','workflow_dispatch'].includes(event))return false;
  const token=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('authorization')||'')?.[1];if(!token||token.length>8192)return false;
  const parts=token.split('.');if(parts.length!==3)return false;const header=parse(parts[0]),payload=parse(parts[1]);
  if(!header||header.alg!=='RS256'||typeof header.kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)||header.crit!==undefined||header.jku!==undefined||header.x5u!==undefined)return false;
  const time=Math.floor(now()/1000);if(!Number.isSafeInteger(time)||!payload||payload.iss!==ISSUER||payload.aud!==AUDIENCE||payload.repository_id!=='1427742371'||payload.repository_owner_id!=='92072050'||payload.repository!=='DOTHEGY/sanji'||payload.workflow_ref!==WORKFLOW||payload.ref!=='refs/heads/main'||payload.event_name!==event||payload.runner_environment!=='github-hosted'||!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||!Number.isSafeInteger(payload.nbf)||payload.iat>time+30||payload.nbf>time+30||payload.exp<=time||payload.exp-payload.iat>600||payload.exp<=payload.iat||!/^[0-9]{1,32}$/.test(payload.run_id||''))return false;
  const keys=await readKeys(fetchKeys,now);
  const matches=keys.filter(k=>k?.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&typeof k.n==='string'&&typeof k.e==='string');if(matches.length!==1)return false;
  const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  const verifiedAt=Math.floor(now()/1000);return valid&&Number.isSafeInteger(verifiedAt)&&payload.exp>verifiedAt&&payload.nbf<=verifiedAt+30&&payload.iat<=verifiedAt+30;
 }catch{return false;}
}
