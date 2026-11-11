// Owner-authenticated review and scheduling only. No direct send route.
export function youtubeManualHandler({sb,prepare,confirm,schedule,status,recent,cancel,gmailReviewPrepare,gmailReviewConfirm,origin='https://dothegy.github.io'}){
 return async req=>{
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const json=(v,status)=>new Response(JSON.stringify(v),{status,headers:h});
  const source=req.headers.get('Origin'),allowed=String(origin).split(',').map(x=>x.trim()).filter(Boolean);if(source&&!allowed.includes(source))return json({code:'ORIGIN_DENIED'},403);if(source)h['Access-Control-Allow-Origin']=source;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});
  try{
   const token=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')||'')?.[1];if(!token)return json({code:'AUTH_REQUIRED'},401);
   const auth=await sb.auth.getUser(token),owner=auth.data?.user?.id;if(auth.error||!owner)return json({code:'AUTH_REQUIRED'},401);
   const member=await sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle();if(member.error||member.data?.user_id!==owner)return json({code:'MEMBERSHIP_REQUIRED'},403);
   const path=new URL(req.url).pathname;const route=path.match(/\/youtube-manual-mail\/(preview|confirm|schedule|status|recent|cancel|gmail-review-prepare|gmail-review-confirm)$/)?.[1],handlers={preview:prepare,confirm,schedule,status,recent,cancel,'gmail-review-prepare':gmailReviewPrepare,'gmail-review-confirm':gmailReviewConfirm};
   if(req.method!=='POST'||!route||typeof handlers[route]!=='function')return json({code:'NOT_FOUND'},404);
   if(Number(req.headers.get('content-length')||0)>32768)return json({code:'BODY_TOO_LARGE'},413);
   const reader=req.body?.getReader(),chunks=[];let count=0;if(reader)try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>32768){await reader.cancel();return json({code:'BODY_TOO_LARGE'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({code:'INVALID_INPUT'},400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'owner'))return json({code:'INVALID_INPUT'},400);
   return json(await handlers[route](owner,input),200);
  }catch(error){if(error?.code==='MESSAGE_CLASSIFICATION_REVIEW_REQUIRED')return json({code:error.code},409);if(['SCHEDULER_UNAVAILABLE','SENDING_DISABLED'].includes(error?.code))return json({code:error.code},503);if(['GMAIL_REFUSAL_REVIEW_REQUIRED','RECIPIENT_REVIEW_REQUIRED','PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED','AUDIENCE_SOURCE_REVIEW_REQUIRED','TOPIC_SOURCE_REVIEW_REQUIRED','ACTIVITY_SOURCE_REVIEW_REQUIRED','IDENTITY_AMBIGUOUS','HISTORY_ORIGIN_UNVERIFIED','WORK_ALREADY_SENT_OR_PENDING','RECIPIENT_BLOCKED'].includes(error?.code)&&typeof error.candidateId==='string'&&/^[a-f0-9-]{36}$/i.test(error.candidateId))return json({code:error.code,candidateId:error.candidateId},409);return json({code:'PREVIEW_UNAVAILABLE'},503);}
 };
}
