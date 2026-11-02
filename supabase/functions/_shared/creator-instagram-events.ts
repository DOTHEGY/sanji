// Pure validation for Instagram webhook messages. No provider calls or database writes.
export async function verifyInstagramSignature(raw:Uint8Array, header:string, secret:string):Promise<boolean>{
 if(!secret || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(header.slice(7).match(/../g)!.map(x=>parseInt(x,16)));
 return crypto.subtle.verify('HMAC',key,bytes,raw);
}
export function instagramInboundEvents(payload:any,now=Date.now()){
 const result:any[]=[];
 if(payload?.object!=='instagram'||!Array.isArray(payload.entry))return result;
 for(const entry of payload.entry){
  const account=String(entry?.id||'');
  if(!/^\d+$/.test(account)||!Array.isArray(entry.messaging))continue;
  for(const e of entry.messaging){
   const peer=String(e?.sender?.id||''),recipient=String(e?.recipient?.id||''),mid=e?.message?.mid,text=e?.message?.text,at=Number(e?.timestamp);
   if(recipient!==account||!/^\d+$/.test(peer)||peer===account||e?.message?.is_echo===true||typeof mid!=='string'||!mid||mid.length>500||typeof text!=='string'||!text.trim()||text.length>10000||!Number.isFinite(at)||at<=0||at>now+300000)continue;
   result.push({accountId:account,peerId:peer,messageId:mid,text,receivedAt:new Date(at).toISOString()});
  }
 }
 return result;
}
export function instagramReplyAllowed(lastInbound:string,now=Date.now()){
 const at=Date.parse(lastInbound);return Number.isFinite(at)&&at<=now&&now-at<24*60*60*1000;
}
