import {Buffer} from "node:buffer";
const digest=async(s:string)=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex");
const handle=(s:any)=>String(s||"").replace(/^@/,"").toLowerCase();
export const localApprovalHash=(r:any)=>digest(JSON.stringify([r.id,r.handle,r.body,r.sender_handle]));
export function creatorLocalService({sb,query,audit}:any){
 async function config(owner:string){return await query(sb.from("sanji_creator_config").select("*").eq("owner",owner).single());}
 async function admin(path:string,owner:string,b:any){
  if(path==="/creator-local/pair"){
   const c=await config(owner);if(!/^[a-z0-9._]{2,30}$/.test(c.sender_handle))throw Error("먼저 발신 Instagram 아이디를 저장하세요.");
   const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),expires=new Date(Date.now()+7*86400000).toISOString();
   await query(sb.from("sanji_creator_config").update({worker_hash:await digest(token),worker_expires:expires,worker_seen:null,worker_state:"awaiting_pc"}).eq("owner",owner));
   await audit(owner,"creator_local_paired",{expires});return {token,expires};
  }
  if(path==="/creator-local/revoke"){
   await query(sb.from("sanji_creator_config").update({worker_hash:null,worker_expires:null,worker_state:"revoked"}).eq("owner",owner));
   await query(sb.from("sanji_creator_prospects").update({status:"cancelled",result:{note:"PC 연결 해제 · 재승인 필요"}}).eq("owner",owner).eq("status","queued"));return {ok:true};
  }
  if(path==="/creator-local/approve"){
   const ids=Array.isArray(b.ids)?[...new Set(b.ids)]:[];if(!ids.length||ids.length>20)throw Error("한 번에 1~20명의 대상·최종 카피를 확인하세요.");
   const c=await config(owner);if(!c.sender_handle||!c.dm_copy.trim())throw Error("발신 계정과 DM 카피를 먼저 저장하세요.");
   const rows=await query(sb.from("sanji_creator_prospects").select("*").eq("owner",owner).in("id",ids));if(rows.length!==ids.length)throw Error("본인 후보만 승인할 수 있습니다.");
   if(rows.some((r:any)=>r.status!=="new"||!r.body.trim()||r.sender_handle!==c.sender_handle))throw Error("이미 처리 중·발송·결과 미확인인 후보는 재승인하지 않습니다. 최신 카피를 확인하세요.");
   // Bind approval to exact sender, recipient and body visible in the approval dialog.
   for(const r of rows){if(b.copies?.[r.id]!==r.body)throw Error("카피가 변경됐습니다. 미리보기를 다시 확인하세요.");}
   for(const r of rows)await query(sb.from("sanji_creator_prospects").update({status:"queued",approved_hash:await localApprovalHash(r),result:{note:"내 PC 실행 대기 · 아직 전송되지 않음"}}).eq("owner",owner).eq("id",r.id).eq("status","new"));
   await audit(owner,"creator_local_approved",{ids});return {ok:true,count:rows.length};
  }
  if(path==="/creator-local/preview"){
   const r=await query(sb.from("sanji_creator_prospects").select("profile_preview").eq("owner",owner).eq("id",b.id).single());
   if(!r.profile_preview?.imagePath)return {url:null};const {data,error}=await sb.storage.from("sanji-creator-previews").createSignedUrl(r.profile_preview.imagePath,60);if(error)throw Error("미리보기 이미지 조회 실패");return {url:data.signedUrl};
  }
  throw Error("지원하지 않는 PC 연결 작업");
 }
 async function worker(path:string,token:string,b:any){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("PC 연결 키가 필요합니다.");
  const c=await query(sb.from("sanji_creator_config").select("*").eq("worker_hash",await digest(token)).maybeSingle());
  if(!c||Date.parse(c.worker_expires)<Date.now())throw Error("PC 연결이 만료·해제됐습니다. 새 연결 키를 발급하세요.");
  const owner=c.owner,sender=handle(b.sender);if(sender!==c.sender_handle)throw Error("로그인한 Instagram 계정이 승인된 발신 계정과 다릅니다.");
  await query(sb.from("sanji_creator_config").update({worker_seen:new Date().toISOString(),worker_state:b.live===true?"pc_ready_approved_only":"pc_profile_only"}).eq("owner",owner));
  if(path==="/creator-local/worker/next")return {job:await query(sb.rpc("sanji_claim_local_creator",{p_owner:owner,p_sender:sender,p_send:b.live===true}))};
  if(path==="/creator-local/worker/heartbeat")return {ok:true};
  const r=await query(sb.from("sanji_creator_prospects").select("*").eq("owner",owner).eq("id",b.id).single());
  if(path==="/creator-local/worker/check"){
   const suppression=await query(sb.from("sanji_suppression").select("identity").eq("owner",owner).in("identity",[r.handle,"instagram:"+r.handle]));
   const valid=r.status==="sending"&&r.sender_handle===sender&&r.approved_hash===b.approvedHash&&r.approved_hash===await localApprovalHash(r)&&!suppression.length;
   if(!valid)throw Error("발송 승인이 변경됐거나 수신 거부됨 · 보내지 않습니다.");return {ok:true};
  }
  if(path==="/creator-local/worker/result"){
   if(r.status==="unknown"&&b.status==="unknown"&&r.approved_hash===b.approvedHash)return {ok:true};
   if(r.status!=="sending"||r.approved_hash!==b.approvedHash)throw Error("처리 중인 승인 건만 결과를 저장합니다.");
   const status=b.status==="sent"?"sent":b.status==="blocked"?"blocked":b.status==="failed"?"failed":"unknown";
   await query(sb.from("sanji_creator_prospects").update({status,finished:new Date().toISOString(),result:{note:String(b.note||"").slice(0,350),method:"local_browser",deliveryConfirmed:false,readConfirmed:false}}).eq("owner",owner).eq("id",r.id).eq("status","sending"));return {ok:true};
  }
  if(path==="/creator-local/worker/profile"){
   const p=b.profile||{},preview:any={attempted:r.profile_preview?.attempted||new Date().toISOString(),checked:new Date().toISOString(),source:"https://www.instagram.com/"+r.handle+"/",status:p.status==="checked"?"checked":"unavailable",method:"local_visible_profile"};
   for(const k of ["displayName","bio","followersText","followingText","postsText","reason"])preview[k]=String(p[k]||"").slice(0,k==="bio"?1000:250);
   if(p.image){const bytes=Buffer.from(String(p.image),"base64");if(bytes.length>400000||bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("프로필 이미지 형식·크기 오류");
    const imagePath=owner+"/"+r.id+".png",{error}=await sb.storage.from("sanji-creator-previews").upload(imagePath,bytes,{contentType:"image/png",upsert:true});if(error)throw Error("프로필 이미지 저장 실패");preview.imagePath=imagePath;
   }
   await query(sb.from("sanji_creator_prospects").update({profile_preview:preview}).eq("owner",owner).eq("id",r.id));return {ok:true};
  }
  throw Error("지원하지 않는 PC 실행기 요청");
 }
 return {admin,worker};
}
