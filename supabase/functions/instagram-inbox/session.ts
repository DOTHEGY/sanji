import { instagramTokenResponse } from "../_shared/instagram-token.ts";
export function instagramPermissions(value:any):string[]{return Array.isArray(value)?value.map(String):String(value||"").split(",").map(s=>s.trim()).filter(Boolean);}
export async function instagramProfile(token:any,request:any,version:string){
 // Meta distinguishes the app-scoped id from the professional account user_id.
 const response=await request("https://graph.instagram.com/"+version+"/me?"+new URLSearchParams({fields:"user_id,username",access_token:token.access_token}),{method:"GET"},"Instagram 계정 조회");
 const profile=Array.isArray(response?.data)&&response.data.length===1?response.data[0]:response;
 if(!/^\d+$/.test(String(profile?.user_id||""))||!profile?.username)throw Error("Instagram 계정 ID·이름을 확인할 수 없습니다.");
 return {...profile,id:String(profile.user_id)};
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
