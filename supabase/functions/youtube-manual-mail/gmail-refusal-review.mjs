import {emailIdentity} from '../creator-daily-outreach/domain.mjs';
// Read-only use of the existing Gmail history adapter. Presence of any old
// correspondence is UNKNOWN, never a refusal and never proof of consent.
// This does not inspect message bodies or send mail.
export async function gmailRefusalReview({provider,owner,senderEmail,addresses,now=Date.now}){
 if(!owner||!emailIdentity(senderEmail)||!Array.isArray(addresses)||addresses.length>100||new Set(addresses.map(emailIdentity)).size!==addresses.length||addresses.some(a=>!emailIdentity(a)))throw Error('GMAIL_REVIEW_INVALID');
 const rows=new Array(addresses.length),deadline=now()+45000;let next=0;
 async function worker(){while(true){const i=next++;if(i>=addresses.length)return;const email=addresses[i];if(now()>deadline){rows[i]={owner,email,status:'unknown',source:'provider_unavailable',checkedAt:new Date(now()).toISOString()};continue;}
  try{
   const result=await provider.history({owner,address:email.trim().toLowerCase(),senderEmail}),p=result?.proof,checked=Date.parse(p?.checkedAt),elapsed=now()-checked;
   if(p?.clear!==true||p.address!==email.trim().toLowerCase()||p.emailKey!==emailIdentity(email)||p.senderEmail!==senderEmail||!Number.isFinite(checked)||elapsed<0||elapsed>10000)throw Error('GMAIL_HISTORY_UNVERIFIED');
   rows[i]={owner,email,status:'no_refusal_confirmed',source:'provider_empty_history',checkedAt:p.checkedAt};
  }catch(error){
   if(error?.code!=='EXISTING_GMAIL_CONTACT'&&error?.code!=='GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED'){rows[i]={owner,email,status:'unknown',source:'provider_unavailable',checkedAt:new Date(now()).toISOString()};continue;}
   let fingerprint=null;try{fingerprint=await provider.historyFingerprint({owner,address:email.trim().toLowerCase(),senderEmail});}catch{}
   rows[i]={owner,email,status:'unknown',source:'provider_existing_history',checkedAt:fingerprint?.checkedAt||new Date(now()).toISOString(),...(fingerprint?{fingerprint:fingerprint.fingerprint,messageCount:fingerprint.messageIds.length}:{})};
  }
 }}
 const results=await Promise.allSettled(Array.from({length:Math.min(4,addresses.length)},()=>worker()));if(results.some(r=>r.status==='rejected')||rows.some(x=>!x))throw Error('GMAIL_HISTORY_UNAVAILABLE');
 return {owner,complete:true,rows};
}
