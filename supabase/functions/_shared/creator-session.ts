import {Buffer} from "node:buffer";
// Browser credentials may only contain Instagram state, never other sites or executable code.
export function instagramStorageState(input:any){
 if(!input||!Array.isArray(input.cookies)||input.cookies.length>100||!Array.isArray(input.origins||[])||Buffer.byteLength(JSON.stringify(input))>250000)throw Error("Instagram 세션 형식·크기 오류");
 const cookies=input.cookies.filter((c:any)=>["instagram.com",".instagram.com","www.instagram.com"].includes(c.domain)).map((c:any)=>{
  if(typeof c.name!=="string"||!c.name||c.name.length>128||typeof c.value!=="string"||c.value.length>16000||!Number.isFinite(c.expires)||typeof c.path!=="string"||!c.path.startsWith("/"))throw Error("Instagram 쿠키 형식 오류");
  return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires:c.expires,httpOnly:!!c.httpOnly,secure:!!c.secure,sameSite:["Strict","Lax","None"].includes(c.sameSite)?c.sameSite:"Lax"};
 });
 if(!cookies.some((c:any)=>c.name==="sessionid"&&c.value&&(c.expires===-1||c.expires>Date.now()/1000)))throw Error("유효한 Instagram 로그인 세션이 없습니다.");
 const origins=input.origins.filter((o:any)=>o.origin==="https://www.instagram.com").map((o:any)=>({origin:o.origin,localStorage:(Array.isArray(o.localStorage)?o.localStorage:[]).filter((x:any)=>typeof x.name==="string"&&typeof x.value==="string").map((x:any)=>({name:x.name,value:x.value}))}));
 return {cookies,origins};
}
export function creatorSessionService({sb,query,encrypt,decrypt,audit}:any){
 async function handle(owner:string,sender:string,enabled:boolean,action:string,b:any){
  if(!enabled&&action==="load")return {state:null,disabled:true};
  if(!enabled)throw Error("DB 로그인 세션 백업이 꺼져 있습니다. 관리자 화면에서 활성화 후 새 PC 연결 키를 발급하세요.");
  if(action==="save"){
   const state=instagramStorageState(b.state),checked=new Date().toISOString(),expires=new Date(Date.now()+7*86400000).toISOString();
   const encrypted=await encrypt({owner,sender,state,version:1});
   await query(sb.from("sanji_instagram_pc_sessions").upsert({owner,handle:sender,encrypted,checked,expires},{onConflict:"owner,handle"}));
   await audit(owner,"instagram_pc_session_saved",{sender,expires});return {ok:true,checked,expires};
  }
  const row=await query(sb.from("sanji_instagram_pc_sessions").select("encrypted,checked,expires").eq("owner",owner).eq("handle",sender).maybeSingle());
  if(!row)return {state:null};
  if(Date.parse(row.expires)<=Date.now()){await query(sb.from("sanji_instagram_pc_sessions").delete().eq("owner",owner).eq("handle",sender));return {state:null,expired:true};}
  if(action==="load"){
   const value=await decrypt(row.encrypted);if(value.owner!==owner||value.sender!==sender||value.version!==1)throw Error("세션 계정 검증 실패");
   await audit(owner,"instagram_pc_session_restored",{sender});return {state:instagramStorageState(value.state),checked:row.checked,expires:row.expires};
  }
  throw Error("지원하지 않는 세션 요청");
 }
 return {handle};
}
