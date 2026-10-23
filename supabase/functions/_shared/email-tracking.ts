import { Buffer } from "node:buffer";
import { mailRecipients } from "./mail-recipients.ts";
export const trackingLimitNotice="열람 추정은 사람의 실제 열람 확인이 아닙니다. Apple Mail 사전 로딩, 이미지 프록시·보안 시스템, 이미지 차단·캐시·전달에 영향을 받습니다. 감지 없음은 미열람·수신 실패를 뜻하지 않습니다.";
export const trackingReasonLabels:any={none:"분류 근거 없음",image_proxy:"메일 이미지 프록시 User-Agent 패턴 · 자체 추정",prefetch_header:"사전 로딩 목적 헤더 · 자체 추정",scanner_user_agent:"보안 스캐너 User-Agent 패턴 · 자체 추정"};
const gif=Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64"));
export const tokenHash=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,"0")).join("");
export const newTrackingToken=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export function classifyImageRequest(headers:Headers){
 const ua=(headers.get("user-agent")||"").slice(0,512),purpose=[headers.get("purpose"),headers.get("sec-purpose")].join(" ");
 if(/prefetch|prerender/i.test(purpose))return {classification:"suspected_automated",reason:"prefetch_header"};
 if(/GoogleImageProxy|YahooMailProxy|ImageProxy/i.test(ua))return {classification:"suspected_automated",reason:"image_proxy"};
 if(/Proofpoint|Mimecast|Barracuda|urlscan|HeadlessChrome|bot\b|crawler|scanner/i.test(ua))return {classification:"suspected_automated",reason:"scanner_user_agent"};
 return {classification:"unknown",reason:"none"};
}
export function trackingLabel(row:any,includeAutomated=false){
 if(row.tracking_result?.stopped)return "추적 중지 · 통계 제외";
 if(row.tracking_result?.applied&&(!row.tracking_id||Date.parse(row.expires)<=Date.now()))return "보관기간 만료 · 통계 제외";
 if(!row.tracking_id)return "추적 미적용";
 if(row.is_test)return "내부 테스트 · 수신자 통계 제외";
 return (includeAutomated?row.first_request:row.first_included)?"열람 추정":"감지 없음";
}
export function emailTrackingService({sb,query,env,audit,baseUrl}:any){
 const activated=()=>env("EMAIL_TRACKING_ACTIVATION_APPROVED")==="true";
 const policy=async(owner:string)=>await query(sb.from("sanji_tracking_policy").select("*").eq("owner",owner).maybeSingle())||{enabled:false,version:0,retention_days:30};
 async function preview(owner:string,input:any,scope:string){
  const no=(reason:string)=>({requested:!!input.trackingRequested,eligible:false,reason,campaignId:input.trackingCampaignId||null});
  if(input.channel!=="email")return no("이메일 외 채널 · 추적 미적용");
  if(!input.trackingRequested)return no("발송별 추적 선택 안 함");
  try{
   const p=await policy(owner);
   if(!activated())return no("운영 추적 활성화 승인 전 · 추적 미적용");
   if(!p.enabled)return no("서비스 추적 꺼짐");
   if(!input.trackingCampaignId)return no("캠페인 미선택");
   const c=await query(sb.from("sanji_email_campaigns").select("*").eq("owner",owner).eq("id",input.trackingCampaignId).maybeSingle());
   if(!c||c.scope!==scope||!c.enabled)return no("해당 영업 범위의 캠페인 추적 꺼짐");
   if(c.external_tracking)return no("외부 추적 적용 캠페인 · 중복 픽셀 미삽입");
   if(!input.trackingNoticeAcknowledged||c.basis_note.length<5||c.disclosure.length<20||!input.body.includes(c.disclosure))return no("처리 근거·고지 확인 필요 · 저장된 고지 문구/링크가 본문에 있어야 적용");
   return {requested:true,eligible:true,campaignId:c.id,campaignName:c.name,scope,policyVersion:p.version,campaignVersion:c.version,disclosure:c.disclosure,retentionDays:p.retention_days,testOnly:env("EMAIL_TRACKING_TEST_ONLY")!=="false",internalTest:!!input.trackingInternalTest,reason:"수신자·발송 건별 추적 · 복수 수신자는 공용 본문 단위"};
  }catch{return no("추적 설정 조회 오류 · 이메일은 추적 없이 발송 가능");}
 }
 async function withNotice(owner:string,input:any,body:string,scope:string){
  if(input.channel!=="email"||input.trackingRequested===false||input.trackingNoticeAcknowledged===false||!activated())return {input,body};
  try{const p=await policy(owner);if(!p.enabled)return {input,body};
   const rows=await query(sb.from("sanji_email_campaigns").select("*").eq("owner",owner).eq("scope",scope).eq("enabled",true).order("created"));
   const c=input.trackingCampaignId?rows.find((r:any)=>r.id===input.trackingCampaignId):rows[0];
   if(!c||c.external_tracking||c.disclosure.length<20||c.basis_note.length<5)return {input,body};
   return {input:{...input,trackingRequested:true,trackingCampaignId:c.id,trackingNoticeAcknowledged:true},body:body.includes(c.disclosure)?body:body+"\n\n"+c.disclosure};
  }catch{return {input,body};}
 }
 async function prepare(owner:string,outboxId:string,d:any,sender:string){
  const none=(reason:string)=>({draft:d,summary:{applied:false,reason}});
  if(d.channel!=="email"||!d.tracking?.eligible||!activated())return none("미적용 또는 운영 활성화 승인 전");
  // Tokens are never created for previews. Never insert another pixel over known provider tracking.
  try{
   const token=newTrackingToken(),hash=await tokenHash(token),url=new URL(baseUrl);
   if(url.protocol!=="https:"||url.username||url.password)return none("HTTPS 추적 주소 미설정");
   const t=await query(sb.rpc("sanji_register_email_tracking",{p_owner:owner,p_outbox:outboxId,p_hash:hash,p_campaign:d.tracking.campaignId,p_policy_version:d.tracking.policyVersion,p_campaign_version:d.tracking.campaignVersion,p_sender:sender,p_test:!!d.tracking.internalTest,p_test_only:env("EMAIL_TRACKING_TEST_ONLY")!=="false"}));
   const row=Array.isArray(t)?t[0]:t;if(!row?.id)return none("설정·고지 변경 또는 추적 중단 · 미적용");
   const pixel=baseUrl.replace(/\/$/,"")+"/email-events/pixel/"+token+".gif";
   return {draft:{...d,trackingPixelUrl:pixel},summary:{applied:true,campaignId:row.campaign_id,mode:row.mode,recipientCount:mailRecipients(d).length,isTest:row.is_test,expires:row.expires}};
  }catch{
   // A tracking outage cannot abort or retry an already approved business send.
   try{await audit(owner,"email_tracking_skipped",{outboxId,reason:"tracking_unavailable"});}catch{}
   return none("추적 장애 · 원문 이메일 발송 유지");
  }
 }
 async function pixel(req:Request,token:string){
  if(req.method==="GET"&&activated()&&/^[A-Za-z0-9_-]{43}$/.test(token)){
   try{const cls=classifyImageRequest(req.headers);await query(sb.rpc("sanji_record_image_request",{p_hash:await tokenHash(token),p_classification:cls.classification,p_reason:cls.reason}));}catch{/* Always return the actual transparent image, including DB outage or unknown token. */}
  }
  return new Response(req.method==="HEAD"?null:gif,{status:200,headers:{"Content-Type":"image/gif","Content-Length":String(gif.length),"Cache-Control":"no-store, no-cache, max-age=0, must-revalidate","Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"cross-origin","Content-Security-Policy":"default-src 'none'"}});
 }
 async function handle(path:string,method:string,owner:string,input:()=>Promise<any>,params:URLSearchParams){
  if(path==="/email-tracking"&&method==="GET")return {policy:await policy(owner),activationApproved:activated(),testOnly:env("EMAIL_TRACKING_TEST_ONLY")!=="false",provider:"Gmail API · 제공자 열람 웹훅 없음",campaigns:await query(sb.from("sanji_email_campaigns").select("id,name,scope,enabled,external_tracking,disclosure,basis_note,version").eq("owner",owner).order("created")),notice:trackingLimitNotice};
  const stop=path.match(/^\/email-tracking\/messages\/([0-9a-f-]{36})$/);
  if(stop&&method==="GET"){
   const o=await query(sb.from("sanji_outbox").select("id,created").eq("id",stop[1]).eq("owner",owner).single());
   const report=await query(sb.rpc("sanji_email_tracking_report",{p_owner:owner,p_from:o.created,p_to:new Date(Date.parse(o.created)+1).toISOString(),p_campaign:null,p_include_automated:false,p_target:null}));
   const r=report.rows.find((r:any)=>r.id===o.id);if(!r)throw Error("메일 기록을 찾지 못했습니다.");
   return {...r,label:trackingLabel(r),reasonLabels:(r.reasons||[]).map((code:string)=>trackingReasonLabels[code]||"근거 미확인"),notice:trackingLimitNotice};
  }
  if(stop&&method==="DELETE"){
   const row=await query(sb.from("sanji_outbox").select("id,data").eq("id",stop[1]).eq("owner",owner).single());
   await query(sb.from("sanji_email_tracking").delete().eq("outbox_id",row.id).eq("owner",owner));
   await query(sb.from("sanji_outbox").update({data:{...row.data,trackingResult:{...row.data.trackingResult,stopped:true}}}).eq("id",row.id).eq("owner",owner));
   await audit(owner,"email_tracking_message_stopped",{outboxId:row.id});return {ok:true};
  }
  if(path==="/email-tracking/policy"&&method==="POST"){
   const b=await input(),days=Number(b.retentionDays);if(!Number.isInteger(days)||days<7||days>90)throw Error("보관 기간은 7~90일입니다.");
   const p=await policy(owner);await query(sb.from("sanji_tracking_policy").upsert({owner,enabled:b.enabled===true,retention_days:days,version:p.version+1,updated:new Date().toISOString()},{onConflict:"owner"}));
   await audit(owner,"email_tracking_policy_changed",{enabled:b.enabled===true,retentionDays:days});return {ok:true};
  }
  if(path==="/email-tracking/campaigns"&&method==="POST"){
   const b=await input();if(!["brand","creator"].includes(b.scope)||typeof b.name!=="string"||!b.name.trim()||b.name.length>120)throw Error("캠페인 이름·영업 범위를 확인하세요.");
   const data={name:b.name.trim(),scope:b.scope,enabled:b.enabled===true,external_tracking:b.externalTracking===true,disclosure:String(b.disclosure||"").trim().slice(0,2000),basis_note:String(b.basisNote||"").trim().slice(0,2000),updated:new Date().toISOString()};
   if(data.enabled&&(data.disclosure.length<20||data.basis_note.length<5))throw Error("캠페인 추적에는 처리 근거와 20자 이상의 고지 문구/링크가 필요합니다. 공개 이메일을 동의로 간주하지 마세요.");
   if(b.id){const old=await query(sb.from("sanji_email_campaigns").select("id,version").eq("id",b.id).eq("owner",owner).single());await query(sb.from("sanji_email_campaigns").update({...data,version:old.version+1}).eq("id",old.id).eq("owner",owner));}
   else await query(sb.from("sanji_email_campaigns").insert({...data,owner}));
   await audit(owner,"email_tracking_campaign_changed",{campaign:b.id||"new",enabled:data.enabled});return {ok:true};
  }
  if(path==="/email-tracking/report"&&method==="GET"){
   const from=new Date(params.get("from")||Date.now()-30*86400000),to=new Date(params.get("to")||Date.now()),campaign=params.get("campaign")||null;
   if(params.get("target")&&!/^[0-9a-f-]{36}$/.test(params.get("target")!))throw Error("대상 ID를 확인하세요.");
   if(!Number.isFinite(+from)||!Number.isFinite(+to)||+to<=+from||+to-+from>90*86400000||campaign&&!/^[0-9a-f-]{36}$/.test(campaign))throw Error("집계 기간은 최대 90일이며 캠페인을 확인해야 합니다.");
   const report=await query(sb.rpc("sanji_email_tracking_report",{p_owner:owner,p_from:from.toISOString(),p_to:to.toISOString(),p_campaign:campaign,p_include_automated:params.get("includeAutomated")==="true",p_target:params.get("target")||null}));
   return {...report,rows:(report?.rows||[]).map((r:any)=>({...r,label:trackingLabel(r,params.get("includeAutomated")==="true"),reasonLabels:(r.reasons||[]).map((code:string)=>trackingReasonLabels[code]||"근거 미확인")})),notice:trackingLimitNotice};
  }
  throw Error("지원하지 않는 추적 요청");
 }
 return {preview,prepare,pixel,handle,withNotice};
}
