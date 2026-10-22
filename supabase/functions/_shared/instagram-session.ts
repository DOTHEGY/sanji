import { instagramTokenResponse } from "./instagram-token.ts";
export function instagramPermissions(value:any):string[]{return Array.isArray(value)?value.map(String):String(value||"").split(",").map(s=>s.trim()).filter(Boolean);}
export async function instagramProfile(token:any,request:any,version:string){
 // Official read-only forms. A login-scoped ID is never sufficient on its own.
 const paths=[version+"/me","me",...(/^\d+$/.test(String(token.user_id||token.id||""))?[version+"/"+(token.user_id||token.id)]:[]),...(version!=="v24.0"?["v24.0/me"]:[])];
 let error:any;
 for(const path of paths){try{
  const profile=await request("https://graph.instagram.com/"+path+"?"+new URLSearchParams({fields:"user_id,username",access_token:token.access_token}),{method:"GET"},"Instagram 계정 조회");
  if(!/^\d+$/.test(String(profile.user_id||profile.id||""))||!profile.username)throw Error("Instagram 계정 ID·이름을 확인할 수 없습니다.");
  return {...profile,id:String(profile.user_id||profile.id)};
 }catch(e){error=e;if(!/Unsupported request|Unsupported get request|Unknown path|nonexisting field/i.test(String(e?.message||"")))throw e;}}
 throw error;
}
export async function resolveInstagramSession(response:any,request:any,appSecret:string,version:string,time=Date.now()){
 const token=instagramTokenResponse(response);
 // Meta's documented order: exchange for a long token, then query the profile.
 // If exchange fails, a short token is usable only after a real profile lookup.
 let session:any=token,warning="",mode="long";
 try{session=instagramTokenResponse(await request("https://graph.instagram.com/access_token?"+new URLSearchParams({grant_type:"ig_exchange_token",client_secret:appSecret,access_token:token.access_token}),{method:"GET"},"Instagram 장기 토큰 교환"),true);}
 catch(e){mode="short";warning="장기 토큰 교환 미완료 · 임시 세션 최대 15분. "+String(e?.message||"").slice(0,350);}
 const profile=await instagramProfile({...token,...session},request,version);
 const duration=mode==="long"?Number(session.expires_in)*1000:Math.min(Number(token.expires_in)>0?Number(token.expires_in)*1000:900000,900000);
 return {...token,...session,...profile,expires:time+duration,tokenMode:mode,warning,expiryKnown:mode==="long"||Number(token.expires_in)>0,permissions:instagramPermissions(token.permissions),apiVerified:true,profileChecked:new Date(time).toISOString()};
}
export async function instagramCapabilities(session:any,request:any,version:string){
 const result:any={profileVerified:true,messagesReadable:false,webhookSubscribed:false,checked:new Date().toISOString(),errors:[]};
 const params=new URLSearchParams({platform:"instagram",limit:"1",access_token:session.access_token});
 try{await request("https://graph.instagram.com/"+version+"/"+session.id+"/conversations?"+params,{method:"GET"},"Instagram 대화 읽기 권한 확인");result.messagesReadable=true;}
 catch(e){result.errors.push(String(e?.message||"").slice(0,400));}
 if(result.messagesReadable){try{
  const response=await request("https://graph.instagram.com/"+version+"/"+session.id+"/subscribed_apps?"+new URLSearchParams({access_token:session.access_token}),{method:"GET"},"Instagram 웹훅 구독 확인");
  result.webhookSubscribed=(response.data||[]).some((a:any)=>(a.subscribed_fields||[]).includes("messages"));
 }catch(e){result.errors.push(String(e?.message||"").slice(0,400));}}
 return result;
}
