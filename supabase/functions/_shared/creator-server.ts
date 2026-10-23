import {Buffer} from "node:buffer";
import {creatorSessionService} from "./creator-session.ts";
const digest=async(s:string)=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex");
export function creatorServerService({sb,query,encrypt,decrypt,audit,creatorLocal}:any){
 const sessions=creatorSessionService({sb,query,encrypt,decrypt,audit});
 const get=async(owner:string)=>await query(sb.from("sanji_creator_config").select("*").eq("owner",owner).single());
 async function admin(path:string,owner:string,b:any){
  const c=await get(owner);
  if(path==="/creator-server/key"){
   if(!c.session_backup_enabled||!c.sender_handle)throw Error("PC에서 발신 계정을 저장하고 DB 세션 백업을 켜세요.");
   const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),expires=new Date(Date.now()+30*86400000).toISOString();
   await query(sb.from("sanji_creator_config").update({server_worker_hash:await digest(token),server_worker_expires:expires,server_enabled:false,server_lease_owner:null,server_lease_until:null,server_runtime:{...c.server_runtime,status:"paused",reason:"서버 키 발급 · 재개 승인 전",checked:c.server_runtime?.requiresNewSession?c.server_runtime.checked:new Date().toISOString()}}).eq("owner",owner));
   await audit(owner,"creator_server_key_issued",{expires});return {token,expires};
  }
  if(path==="/creator-server/pause"||path==="/creator-server/revoke"){
   const revoke=path.endsWith("/revoke");await query(sb.from("sanji_creator_config").update({server_enabled:false,server_lease_owner:null,server_lease_until:null,...(revoke?{server_worker_hash:null,server_worker_expires:null}:{}),server_runtime:{...c.server_runtime,status:"paused",reason:revoke?"서버 연결 해제":"운영자 일시중지",checked:c.server_runtime?.requiresNewSession?c.server_runtime.checked:new Date().toISOString()}}).eq("owner",owner));return {ok:true};
  }
  if(path==="/creator-server/resume"){
   if(!c.server_worker_hash||Date.parse(c.server_worker_expires)<=Date.now())throw Error("새 서버 연결 키를 발급하세요.");
   const s=await query(sb.from("sanji_instagram_pc_sessions").select("checked,expires").eq("owner",owner).eq("handle",c.sender_handle).maybeSingle());
   if(!c.session_backup_enabled||!s||Date.parse(s.expires)<=Date.now())throw Error("PC 실행기에서 직접 로그인해 세션을 DB에 저장하세요.");
   if(c.server_runtime?.requiresNewSession&&Date.parse(s.checked)<=Date.parse(c.server_runtime.checked))throw Error("추가 인증 이후 PC에서 새 세션을 저장한 다음 재개하세요.");
   await query(sb.from("sanji_creator_config").update({server_enabled:true,server_revision:c.server_revision+1,server_runtime:{status:"starting",reason:"운영자가 새 세션으로 재개 승인",checked:new Date().toISOString(),sessionChecked:s.checked}}).eq("owner",owner));
   await audit(owner,"creator_server_resume_approved",{sender:c.sender_handle});return {ok:true,previewOnly:true};
  }
  throw Error("지원하지 않는 서버 설정");
 }
 async function worker(path:string,token:string,b:any){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("서버 연결 키가 필요합니다.");
  const c=await query(sb.from("sanji_creator_config").select("*").eq("server_worker_hash",await digest(token)).maybeSingle());
  if(!c||Date.parse(c.server_worker_expires)<=Date.now()||b.sender!==c.sender_handle)throw Error("서버 키 만료·해제 또는 발신 계정 불일치");
  const owner=c.owner;
  if(path==="/creator-server/worker/control")return {enabled:c.server_enabled,revision:c.server_revision,runtime:c.server_runtime,previewOnly:true};
  if(!c.server_enabled)throw Error("서버 실행이 중지돼 있습니다.");
  if(!/^[0-9a-f-]{36}$/i.test(b.instance||""))throw Error("서버 실행 식별자가 필요합니다.");
  const lease=await query(sb.rpc("sanji_creator_server_lease",{p_owner:owner,p_instance:b.instance,p_sender:b.sender}));
  if(!lease)throw Error("다른 서버가 실행 중입니다. 중복 브라우저를 실행하지 않습니다.");
  if(path==="/creator-server/worker/status"){
   const reasons:any={ready:"DB 세션·발신 계정 확인 · 미리보기 전용",reauth_required:"PC에서 추가 인증 후 새 세션 저장 필요",error:"서버 오류 · 작업 중지, 수동 재개 필요",daily_limit:"서버 프로필 일일 확인 한도 도달",idle:"새 확인 작업 없음"};
   if(!reasons[b.status])throw Error("올바르지 않은 서버 상태");
   const runtime={status:b.status,reason:reasons[b.status],checked:new Date().toISOString(),requiresNewSession:b.status==="reauth_required",instance:b.instance,sessionChecked:String(b.sessionChecked||"").slice(0,40)};
   await query(sb.from("sanji_creator_config").update({server_runtime:runtime,...(["error","reauth_required"].includes(b.status)?{server_enabled:false,server_lease_until:null}:{} )}).eq("owner",owner));return {ok:true};
  }
  if(!c.session_backup_enabled)throw Error("DB 세션 백업이 꺼져 있습니다.");
  if(path==="/creator-server/worker/session")return await sessions.handle(owner,b.sender,true,"load",{});
  if(path==="/creator-server/worker/next"){
   if(b.live)throw Error("서버 DM 발송은 별도 검증·승인 전까지 비활성입니다.");
   const start=new Date(new Date(Date.now()+9*3600000).toISOString().slice(0,10)+"T00:00:00+09:00").toISOString();
   const count=await query(sb.from("sanji_creator_prospects").select("id").eq("owner",owner).eq("profile_preview->>method","server_visible_profile").gte("profile_preview->>attempted",start));
   if(count.length>=5)return {job:null,dailyLimit:true};
   if(!["ready","idle","daily_limit"].includes(c.server_runtime.status))throw Error("세션 확인 후에만 프로필 작업을 시작합니다.");
   return {job:await query(sb.rpc("sanji_claim_local_creator",{p_owner:owner,p_sender:b.sender,p_send:false}))};
  }
  if(path==="/creator-server/worker/profile")return await creatorLocal.execute(owner,c,b.sender,"/creator-local/worker/profile",b,"server");
  throw Error("지원하지 않는 서버 실행 요청");
 }
 return {admin,worker};
}
