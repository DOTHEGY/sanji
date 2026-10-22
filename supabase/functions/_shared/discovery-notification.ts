import { mime } from "./mail-mime.ts";
export function discoveryCompletionNotifier({sb,query,gmailToken,remote,audit,env}:any){
 return async function notifyOwner(owner:string){
  if(env("EMAIL_SENDING_ENABLED")!=="true")return {status:"sending_disabled"};
  const snapshot=await query(sb.rpc("sanji_claim_discovery_notification",{p_owner:owner}));
  if(!snapshot)return {status:"not_due_or_already_attempted"};
  let submitting=false;
  try{
   const g=await gmailToken(owner);
   const subject="[산지] "+snapshot.day+" 신규 업체 "+snapshot.target+"곳 이메일 발굴 완료";
   const body="오늘의 이메일 발굴 목표를 달성했습니다.\n\n"+
    "집계일: "+snapshot.day+" (한국시간)\n목표: 신규 업체 "+snapshot.target+"곳\n이메일 확보 업체: "+snapshot.companies+"곳\n신규 이메일: "+snapshot.emails+"개\n홈페이지 확인 처리: "+snapshot.processed+"회\n\n"+
    "발굴 결과·제품 개인화·게시 출처 대조 상태를 서비스에서 확인하세요. 이메일 확보 완료와 회사·상품 검증 완료는 구분됩니다.\n"+
    "https://dothegy.github.io/sanji/workspace/#brands\n\n"+
    "매일 한국시간 자정(00:00)에 새 날짜의 발굴을 시작합니다. 업체 대상 영업 메일은 별도 발송 승인 전에는 전송하지 않습니다.";
   const raw=mime({email:snapshot.recipient,subject,body,senderName:"산지 · 발굴 완료 알림",messageId:"discovery-"+owner+"-"+snapshot.day,attachments:[]},g.email);
   submitting=true;
   const r=await remote("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:"Bearer "+g.access_token,"Content-Type":"application/json"},body:JSON.stringify({raw})});
   if(!r.id)throw Error("제공자 메시지 ID를 확인하지 못했습니다.");
   await query(sb.from("sanji_discovery_notifications").update({status:"accepted",provider_id:r.id,updated:new Date().toISOString()}).eq("owner",owner).eq("day",snapshot.day));
   await audit(owner,"discovery_completion_notified",{day:snapshot.day,providerId:r.id});
   return {status:"accepted",day:snapshot.day};
  }catch(e){
   // Once submitted, an ambiguous failure must never cause a second email automatically.
   const status=submitting?"outcome_unknown":"failed";
   await query(sb.from("sanji_discovery_notifications").update({status,error:String(e.message).slice(0,400),updated:new Date().toISOString()}).eq("owner",owner).eq("day",snapshot.day));
   await audit(owner,"discovery_completion_notification_failed",{day:snapshot.day,status,error:String(e.message).slice(0,200)});
   return {status,error:String(e.message).slice(0,200)};
  }
 };
}
