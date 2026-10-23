export function decodedPart(part:any):string{try{return part?.body?.data?new TextDecoder().decode(Uint8Array.from(atob(part.body.data.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0))):"";}catch{return "";}}
export function deliveryFailures(payload:any){
 const parts:any[]=[];const walk=(p:any)=>{if(!p)return;parts.push(p);for(const c of p.parts||[])walk(c);};walk(payload);
 const texts=parts.filter(p=>/delivery-status|text\/plain/.test(p.mimeType||"")).map(decodedPart).join("\n");
 const failures:any[]=[];for(const block of texts.split(/\r?\n\s*\r?\n/)){
 const recipient=/(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s<>;,]+)/i.exec(block)?.[1]?.toLowerCase(),status=/^Status:\s*(5\.\d+\.\d+)/im.exec(block)?.[1];
 if(recipient&&status&&/^Action:\s*failed/im.test(block))failures.push({email:recipient,status,kind:"permanent",source:"delivery_status"});
 }return failures;
}
export function gmailMessages(remoteThread:any,account:string,old:any[],textBody:any,hasAttachments:any){return (remoteThread.messages||[]).map((m:any)=>{
 const h=Object.fromEntries((m.payload?.headers||[]).map((h:any)=>[h.name.toLowerCase(),h.value])),failures=deliveryFailures(m.payload);
 const mailbox=(s:string)=>s.match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1]||"";
 const automatic=failures.length>0||/mailer-daemon|postmaster@/i.test(h.from||"")||!!h["auto-submitted"]&&h["auto-submitted"]!=="no"||/auto_reply|auto-replied|bulk/i.test(h.precedence||"");
 return {id:m.id,...(old.find(o=>o.id===m.id)?.outboxId?{outboxId:old.find(o=>o.id===m.id).outboxId}:{}),messageId:h["message-id"]||"",references:h.references||"",inReplyTo:h["in-reply-to"]||"",subject:h.subject||"",from:h.from||"",replyToHeader:h["reply-to"]||"",replyAddress:mailbox(h["reply-to"]||h.from||""),out:mailbox(h.from||"").toLowerCase()===account.toLowerCase(),text:textBody(m.payload)||m.snippet||"[본문 미지원]",hasAttachments:hasAttachments(m.payload),at:new Date(Number(m.internalDate)).toISOString(),automatic,bounceFailures:failures};
 }).sort((a:any,b:any)=>a.at.localeCompare(b.at));}
export function gmailSyncService({sb,query,records,putRecord,gmailToken,remote,textBody,gmailHasAttachments}:any){
 async function sync(owner:string){
  const claimed=await query(sb.rpc("sanji_claim_gmail_sync",{p_owner:owner})),state=Array.isArray(claimed)?claimed[0]:claimed;
  if(!state?.owner)return {status:"busy",imported:0};
  const now=new Date().toISOString();
  try{
   const g=await gmailToken(owner),threads=(await records(owner,"thread")).filter((t:any)=>t.channel==="email"&&t.providerId&&t.target).sort((a:any,b:any)=>a.id.localeCompare(b.id));
   const candidates=await records(owner,"candidate");
   const start=Number(state?.cursor||0)%Math.max(1,threads.length),batch=threads.slice(start,start+25),errors:any[]=[];let imported=0,humanReplies=0;
   for(let offset=0;offset<batch.length;offset+=4)await Promise.all(batch.slice(offset,offset+4).map(async(t:any)=>{
    try{const rt=await remote("https://gmail.googleapis.com/gmail/v1/users/me/threads/"+encodeURIComponent(t.providerId)+"?format=full",{headers:{Authorization:"Bearer "+g.access_token}}),messages=gmailMessages(rt,g.email,t.messages||[],textBody,gmailHasAttachments),inbound=messages.filter((m:any)=>!m.out&&!m.automatic);
     const opted=inbound.some((m:any)=>/수신\s*거부(합니다|할게|해\s*주세요|요청합니다)|^\s*수신\s*거부[.!]?\s*$|unsubscribe\s+me|please\s+(unsubscribe|stop)|연락.{0,8}(중단해|그만해|하지\s*마)/im.test(m.text));
     if(JSON.stringify(t.messages||[])!==JSON.stringify(messages)||(opted&&t.classification!=="수신 거부"))await putRecord(owner,"thread",{...t,messages,classification:opted?"수신 거부":t.classification,synced:now},t.id);
     if(opted){const c=candidates.find((c:any)=>c.id===t.target);if(c){for(const email of c.recipientEmails?.length?c.recipientEmails:[c.contact?.email])if(email)await query(sb.from("sanji_suppression").upsert({owner,identity:"email:"+email.toLowerCase(),reason:"수신 메일의 수신 거부 요청"},{onConflict:"owner,identity"}));await putRecord(owner,"candidate",{...c,status:"수신 거부"},c.id);}}
if(inbound.length){humanReplies++;const c=candidates.find((c:any)=>c.id===t.target);if(c&&!opted&&!["회신","거절","수신 거부"].includes(c.status))await putRecord(owner,"candidate",{...c,status:"회신"},c.id);}imported++;
    }catch(e){errors.push({thread:t.id,error:String(e.message||e).slice(0,180)});}
   }));
   let bounceMessages=0;
   if(start===0){
    try{const listing=await remote("https://gmail.googleapis.com/gmail/v1/users/me/messages?"+new URLSearchParams({q:"{from:mailer-daemon from:postmaster} newer_than:90d",maxResults:"30"}),{headers:{Authorization:"Bearer "+g.access_token}});
     for(const entry of listing.messages||[]){const rm=await remote("https://gmail.googleapis.com/gmail/v1/users/me/messages/"+encodeURIComponent(entry.id)+"?format=full",{headers:{Authorization:"Bearer "+g.access_token}}),failures=deliveryFailures(rm.payload);if(!failures.length)continue;
      const c=candidates.find((c:any)=>failures.some((f:any)=>(c.recipientEmails||[c.contact?.email]).some((e:string)=>String(e).toLowerCase()===f.email)));if(!c)continue;
      const old=(await records(owner,"thread")).find((t:any)=>t.channel==="email"&&t.providerId===rm.threadId),messages=gmailMessages({messages:[rm]},g.email,old?.messages||[],textBody,gmailHasAttachments);
      const merged=[...(old?.messages||[]).filter((m:any)=>m.id!==rm.id),...messages].sort((a:any,b:any)=>a.at.localeCompare(b.at));
      if(!old||JSON.stringify(old.messages||[])!==JSON.stringify(merged))await putRecord(owner,"thread",{...old,target:c.id,channel:"email",providerId:rm.threadId,subject:messages[0]?.subject||"배달 실패 알림",classification:old?.classification||"자동 응답",messages:merged,synced:now},old?.id);bounceMessages++;
     }
    }catch(e){errors.push({stage:"bounce_read",error:String(e.message||e).slice(0,180)});}
   }
   const next=start+batch.length>=threads.length?0:start+batch.length;
   await query(sb.from("sanji_gmail_sync").update({cursor:next,last_checked:now,lease_until:null,result:{imported,humanReplies,bounceMessages,total:threads.length,remaining:Math.max(0,threads.length-start-batch.length),errors}}).eq("owner",owner));
   return {status:"synced",imported,humanReplies,bounceMessages,total:threads.length,remaining:Math.max(0,threads.length-start-batch.length),errors};
  }catch(e){await query(sb.from("sanji_gmail_sync").update({lease_until:null,result:{error:String(e.message||e).slice(0,180)}}).eq("owner",owner));throw e;}
 }
 return {sync};
}
