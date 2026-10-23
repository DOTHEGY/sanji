export function instagramSetupService({sb,query,connection,saveConnection,remote,capabilities,version,audit}:any){
 return async function processRequested(){
  const rows=await query(sb.from("sanji_connections").select("owner,provider,summary").eq("summary->>webhookSetupRequested","true").limit(1));
  if(!rows.length)return {status:"idle"};const r=rows[0];
  if(!String(r.provider).startsWith("instagram:")||!r.summary?.apiVerified||!r.summary?.capabilities?.messagesReadable)return {status:"needs_permission"};
  const claimed=await query(sb.from("sanji_connections").update({summary:{...r.summary,webhookSetupRequested:false,webhookSetupStatus:"checking"}}).eq("owner",r.owner).eq("provider",r.provider).eq("summary",JSON.stringify(r.summary)).select("provider"));if(!claimed.length)return {status:"busy"};
  try{
   const session=await connection(r.owner,r.provider);if(!session||session.expires<=Date.now())throw Error("expired");
   await remote("https://graph.instagram.com/"+version+"/"+session.id+"/subscribed_apps",{method:"POST",body:new URLSearchParams({subscribed_fields:"messages,messaging_postbacks",access_token:session.access_token})},"Instagram 웹훅 구독");
   session.capabilities=await capabilities(session,remote,version);await saveConnection(r.owner,r.provider,session);
   await audit(r.owner,"instagram_webhook_setup_checked",{provider:r.provider,subscribed:session.capabilities.webhookSubscribed});
   return {status:session.capabilities.webhookSubscribed?"subscribed":"not_confirmed"};
  }catch(e){
   await query(sb.from("sanji_connections").update({summary:{...r.summary,webhookSetupRequested:false,webhookSetupStatus:"error",webhookSetupChecked:new Date().toISOString(),...(/checkpoint/i.test(String(e?.message||""))?{checkpointRequired:true,capabilities:{...r.summary.capabilities,messagesReadable:false,webhookSubscribed:false,checked:new Date().toISOString(),errors:["Instagram 본인 확인(checkpoint) 필요 · 공식 API 접근 중지"]}}:{})}}).eq("owner",r.owner).eq("provider",r.provider));
   await audit(r.owner,"instagram_webhook_setup_failed",{provider:r.provider,error:String(e?.message||"요청 실패").replace(/(?:access_token|client_secret)=[^&\s]+/g,"[redacted]").slice(0,400)});return {status:"error"};
  }
 };
}
