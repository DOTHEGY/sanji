import {Buffer} from "node:buffer";
import {localApprovalHash} from "./creator-local.ts";
import {creatorSessionService} from "./creator-session.ts";
const digest=async(s:string)=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex");
export function creatorServerService({sb,query,encrypt,decrypt,audit,creatorLocal,creatorDiscovery}:any){
 const sessions=creatorSessionService({sb,query,encrypt,decrypt,audit});
 const get=async(owner:string)=>await query(sb.from("sanji_creator_config").select("*").eq("owner",owner).single());
 async function admin(path:string,owner:string,b:any){
  const c=await get(owner);
  if(path==="/creator-server/progress"){
   const rows=await query(sb.from("sanji_creator_prospects").select("profile_preview").eq("owner",owner));
   const snapshots=rows.map((r:any)=>r.profile_preview||{}),checked=snapshots.filter((p:any)=>p.status==="checked").length,captures=snapshots.filter((p:any)=>p.imagePath).length,followers=snapshots.filter((p:any)=>p.followersText).length,unavailable=snapshots.filter((p:any)=>p.status==="unavailable").length;
   const r=c.server_runtime||{},responding=!!c.server_enabled&&Date.parse(c.server_lease_until)>Date.now();
   return {sender:c.sender_handle,total:rows.length,checked,captures,followers,unavailable,pending:rows.length-checked-unavailable,lastProfileChecked:snapshots.map((p:any)=>p.checked).filter(Boolean).sort().at(-1)||null,state:!c.server_enabled?(r.requiresNewSession?"auth_required":r.status==="error"?"error":"paused"):!responding?"no_heartbeat":r.status==="recovering"?"recovering":r.status==="daily_limit"?"daily_limit":"running",reason:r.reason||"",lastWorkerChecked:r.checked||null,workerVersion:r.workerVersion||"미확인",discoveryEnabled:!!c.enabled,dailyDiscoveryTarget:c.target||50};
  }
  if(path==="/creator-server/login-status"){
   const s=c.sender_handle?await query(sb.from("sanji_instagram_pc_sessions").select("handle,checked,expires").eq("owner",owner).eq("handle",c.sender_handle).maybeSingle()):null;
   const valid=!!s&&Date.parse(s.expires)>Date.now(),runtime=c.server_runtime||{},same=!!s&&runtime.verifiedSender===c.sender_handle&&Date.parse(runtime.sessionChecked)===Date.parse(s.checked),confirmed=valid&&same&&!runtime.requiresNewSession;
   const state=!s?"not_saved":!valid?"session_expired":runtime.requiresNewSession&&Date.parse(s.checked)<=Date.parse(runtime.checked)?"reauth_required":confirmed?"identity_confirmed":"saved_unverified";
   return {sender:c.sender_handle||"",state,saved:!!s,sessionChecked:s?.checked||null,sessionExpires:s?.expires||null,identityConfirmed:confirmed,identityConfirmedAt:confirmed?runtime.identityChecked||null:null,serverEnabled:!!c.server_enabled,serverResponding:c.server_enabled&&Date.parse(c.server_lease_until)>Date.now(),runtimeReason:runtime.reason||""};
  }
  if(path==="/creator-server/approve-test"){
   if(!/^[a-z0-9._]{2,30}$/.test(c.sender_handle||"")||!c.server_enabled||c.server_runtime?.requiresNewSession||!["server-test-v2","server-background-v3","server-background-v4"].includes(c.server_runtime?.workerVersion)||!["ready","idle","daily_limit"].includes(c.server_runtime?.status))throw Error("서버 업데이트와 새 세션 계정 확인을 먼저 마치세요.");
   const r=await query(sb.from("sanji_creator_prospects").select("*").eq("owner",owner).eq("id","a6cedd56-dbab-43b0-a2a5-1f3f893e1606").single());
   const body="산지 Instagram DM 발송 기능 확인용 테스트 메시지입니다. 확인되시면 답장 부탁드립니다!";
   if(r.handle!=="taemin_dtg"||r.body!==body||r.status!=="failed"||r.result?.clickStarted)throw Error("발송 전 중단된 내부 테스트 1건만 허용합니다. 발송·처리 중·결과 미확인 건은 재시도하지 않습니다.");
   const changed=await query(sb.from("sanji_creator_prospects").update({status:"queued",sender_handle:c.sender_handle,approved_hash:await localApprovalHash({...r,sender_handle:c.sender_handle}),profile_preview:{...r.profile_preview,internalTest:true},result:{note:"운영자 승인 · 서버 테스트 1건 대기",previousAttempt:r.result}}).eq("owner",owner).eq("id",r.id).eq("status","failed").select("id"));if(changed.length!==1)throw Error("상태 변경 · 테스트 승인 취소");
   await query(sb.from("sanji_creator_config").update({server_test_id:r.id,server_test_sender:c.sender_handle,server_test_deadline:new Date(Date.now()+2*3600000).toISOString()}).eq("owner",owner));
   await audit(owner,"creator_server_internal_test_approved",{id:r.id,sender:c.sender_handle,recipient:"taemin_dtg",scope:"one-shot exact copy"});return {ok:true,id:r.id};
  }
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
  if(path==="/creator-server/worker/control")return {enabled:c.server_enabled,revision:c.server_revision,runtime:c.server_runtime,previewOnly:true,discoveryEnabled:c.enabled===true,testAllowed:!!c.server_test_id&&Date.parse(c.server_test_deadline)>Date.now()};
  if(!c.server_enabled)throw Error("서버 실행이 중지돼 있습니다.");
  if(!/^[0-9a-f-]{36}$/i.test(b.instance||""))throw Error("서버 실행 식별자가 필요합니다.");
  const lease=await query(sb.rpc("sanji_creator_server_lease",{p_owner:owner,p_instance:b.instance,p_sender:b.sender}));
  if(!lease)throw Error("다른 서버가 실행 중입니다. 중복 브라우저를 실행하지 않습니다.");
  if(path==="/creator-server/worker/discover"){
   if(!c.enabled)return {status:"disabled"};
   if(!creatorDiscovery)throw Error("서버 검색 서비스 설정 필요");
   return await creatorDiscovery.collect(owner);
  }
  if(path==="/creator-server/worker/status"){
   const reasons:any={ready:"DB 세션·발신 계정 확인 · 미리보기 전용",reauth_required:"PC에서 추가 인증 후 새 세션 저장 필요",error:"서버 오류 · 작업 중지, 수동 재개 필요",daily_limit:"서버 프로필 일일 확인 한도 도달",idle:"새 확인 작업 없음",recovering:"브라우저 종료·일시 연결 오류 · 제한된 자동 복구 중"};
   if(!reasons[b.status])throw Error("올바르지 않은 서버 상태");
   let status=b.status,reason=reasons[b.status];
   if(status==="reauth_required"){
    const recent=await query(sb.from("sanji_creator_prospects").select("profile_preview").eq("owner",owner).order("profile_preview->>checked",{ascending:false}).limit(1));
    const p=Array.isArray(recent)?recent[0]?.profile_preview:null;
    if(p?.method==="server_visible_profile"&&/Target page, context or browser has been closed/.test(p.reason||"")&&Date.now()-Date.parse(p.checked)<30000){status="error";reason="브라우저가 종료됐습니다. 서버 실행기 업데이트·복구 필요 · 재로그인 오류 아님";}
   }
   const runtime={...c.server_runtime,status,reason,checked:new Date().toISOString(),requiresNewSession:status==="reauth_required",instance:b.instance,sessionChecked:String(b.sessionChecked||c.server_runtime?.sessionChecked||"").slice(0,40),...(status==="ready"?{verifiedSender:b.sender,identityChecked:new Date().toISOString()}:{} ),workerVersion:String(b.workerVersion||c.server_runtime?.workerVersion||"preview-v1").slice(0,30)};
   await query(sb.from("sanji_creator_config").update({server_runtime:runtime,...(["error","reauth_required"].includes(status)?{server_enabled:false,server_lease_until:null}:{} )}).eq("owner",owner));return {ok:true};
  }
  if(["/creator-server/worker/test-check","/creator-server/worker/test-before-click","/creator-server/worker/test-result"].includes(path)){
   if(b.id!==c.server_test_id||Date.parse(c.server_test_deadline)<=Date.now()||b.sender!==c.server_test_sender)throw Error("승인된 내부 테스트 1건만 허용합니다.");
   const r=await query(sb.from("sanji_creator_prospects").select("*").eq("owner",owner).eq("id",b.id).single());
   if(r.handle!=="taemin_dtg"||r.body!=="산지 Instagram DM 발송 기능 확인용 테스트 메시지입니다. 확인되시면 답장 부탁드립니다!"||!r.profile_preview?.internalTest)throw Error("내부 테스트 대상·내용 불일치");
   if(path.endsWith("/test-result")){
    const result=await creatorLocal.execute(owner,c,b.sender,"/creator-local/worker/result",b,"server");
    await query(sb.from("sanji_creator_config").update({server_test_deadline:new Date().toISOString()}).eq("owner",owner).eq("server_test_id",b.id));return result;
   }
   await creatorLocal.execute(owner,c,b.sender,"/creator-local/worker/check",b,"server");
   if(r.result?.clickStarted)throw Error("이미 클릭을 시작한 건은 재시도하지 않습니다.");
   if(path.endsWith("/test-before-click")){
    const updated=await query(sb.from("sanji_creator_prospects").update({result:{note:"전송 클릭 시작 · 결과 미확인 시 재시도 금지",clickStarted:true}}).eq("owner",owner).eq("id",r.id).eq("status","sending").eq("result",JSON.stringify(r.result)).select("id"));if(!updated.length)throw Error("테스트 상태 변경 · 전송 중단");
   }
   return {ok:true};
  }
  if(path==="/creator-server/worker/test-next"){
   if(!["server-test-v2","server-background-v3","server-background-v4"].includes(b.workerVersion))throw Error("서버 실행기 업데이트 필요");
   if(!["ready","idle","daily_limit"].includes(c.server_runtime.status))throw Error("계정 확인 후 테스트하세요.");
   return {job:await query(sb.rpc("sanji_creator_server_test_claim",{p_owner:owner,p_sender:b.sender}))};
  }
  if(!c.session_backup_enabled)throw Error("DB 세션 백업이 꺼져 있습니다.");
  if(path==="/creator-server/worker/session")return await sessions.handle(owner,b.sender,true,"load",{});
  if(path==="/creator-server/worker/next"){
   if(b.live)throw Error("서버 DM 발송은 별도 검증·승인 전까지 비활성입니다.");
   const start=new Date(new Date(Date.now()+9*3600000).toISOString().slice(0,10)+"T00:00:00+09:00").toISOString();
   const count=await query(sb.from("sanji_creator_prospects").select("id").eq("owner",owner).gte("profile_preview->>attempted",start));
   if(count.length>=50)return {job:null,dailyLimit:true};
   if(!["ready","idle","daily_limit"].includes(c.server_runtime.status))throw Error("세션 확인 후에만 프로필 작업을 시작합니다.");
   return {job:await query(sb.rpc("sanji_claim_local_creator",{p_owner:owner,p_sender:b.sender,p_send:false}))};
  }
  if(path==="/creator-server/worker/profile")return await creatorLocal.execute(owner,c,b.sender,"/creator-local/worker/profile",b,"server");
  throw Error("지원하지 않는 서버 실행 요청");
 }
 return {admin,worker};
}
