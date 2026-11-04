import {creatorInstagramManualInbox} from '../_shared/creator-instagram-manual-inbox.ts';
// No OAuth, webhook, reply, message-send or general workspace routes here.
export function instagramManualInboxHandler({sb,query,connection,connectionFingerprint,remote,env,makeInbox=creatorInstagramManualInbox}:any){
 const origin=env('APP_ORIGIN')||'https://dothegy.github.io';
 const allowed=new URL(origin);if(allowed.origin!==origin||allowed.protocol!=='https:'||allowed.username||allowed.password)throw Error('invalid origin');
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json'}});
 const inbox=makeInbox({sb,query,connection,connectionFingerprint,remote,env});
 return async(req:Request)=>{
  try{
   if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return json({error:'허용되지 않은 출처'},403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   const parts=new URL(req.url).pathname.split('/').filter(Boolean),i=parts[0]==='functions'&&parts[1]==='v1'?2:0;
   if(parts[i]!=='instagram-manual-inbox')return json({error:'지원하지 않는 경로'},404);
   const path='/'+parts.slice(i+1).join('/');if(path==='/health'&&req.method==='GET')return json({ok:true});
   const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
   const auth=await sb.auth.getUser(authorization.slice(7)),user=auth?.data?.user;if(auth?.error||!user)return json({error:'로그인 세션을 확인하세요.'},401);
   const member=await query(sb.from('sanji_members').select('user_id').eq('user_id',user.id).maybeSingle());if(!member)return json({error:'접근 권한이 없습니다.'},403);
   const input=async()=>{const declared=req.headers.get('content-length');if(declared&&/^\d+$/.test(declared)&&Number(declared)>65536){req.body?.cancel().catch(()=>{});throw Error('요청 크기 초과');}if(!req.body)return {};const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){reader.cancel().catch(()=>{});throw Error('요청 크기 초과');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();return raw?JSON.parse(raw):{};}finally{reader.releaseLock();}};
   if(path==='/creator-instagram/manual-inbox'&&req.method==='POST'){try{const b=await input();return json(await inbox.list(user.id,b.cursor));}catch(e:any){if(e?.message==='저장된 내용이 표시 한도를 초과해 목록을 불러오지 못했습니다.')return json({error:'저장된 내용이 표시 한도를 초과해 목록을 불러오지 못했습니다.'},409);throw e;}}
   if(path==='/creator-instagram/manual-thread'&&req.method==='POST')return json(await inbox.thread(user.id,await input()));
   if(path==='/creator-instagram/manual-sync'&&req.method==='POST')return json(await inbox.sync(user.id,await input()));
   if(path==='/creator-instagram/manual-reverify'&&req.method==='POST')return json(await inbox.reverify(user.id,await input()));
   if(path==='/creator-instagram/manual-review-audit'&&req.method==='POST')return json(await inbox.reviewAudit(user.id,await input()));
   if(path==='/creator-instagram/manual-reviewed-draft'&&req.method==='POST'){try{return json(await inbox.saveReviewedDraft(user.id,await input()));}catch{return json({error:'검수 상태가 변경됐거나 기존 초안을 덮어쓸 수 없습니다. 원문과 초안을 다시 확인하세요.'},409);}}
   if(path==='/creator-instagram/manual-draft'&&req.method==='POST'){
    try{return json(await inbox.saveDraft(user.id,await input()));}catch(e:any){if(e?.status===429)return json({error:'Instagram 조회 제한에 도달했습니다. 자동 재시도하지 말고 나중에 확인하세요.',retryCursor:typeof e.retryCursor==='string'&&/^[A-Za-z0-9_-]{43}$/.test(e.retryCursor)?e.retryCursor:null,restartRequired:e.restartRequired===true,retryAfterSeconds:Number.isInteger(e.retryAfterSeconds)&&e.retryAfterSeconds>=0&&e.retryAfterSeconds<=86400?e.retryAfterSeconds:null},429);return json({error:e?.message==='초안이 다른 곳에서 변경됐습니다. 다시 불러온 후 저장하세요.'?'초안이 다른 곳에서 변경됐습니다. 다시 불러온 후 저장하세요.':'초안을 저장하지 못했습니다. 대화 확인 상태를 확인하세요.'},409);}
   }
   return json({error:'지원하지 않는 경로'},404);
  }catch(e:any){if(e?.status===429)return json({error:'Instagram 조회 제한에 도달했습니다. 자동 재시도하지 말고 나중에 확인하세요.',retryCursor:typeof e.retryCursor==='string'&&/^[A-Za-z0-9_-]{43}$/.test(e.retryCursor)?e.retryCursor:null,restartRequired:e.restartRequired===true,retryAfterSeconds:Number.isInteger(e.retryAfterSeconds)&&e.retryAfterSeconds>=0&&e.retryAfterSeconds<=86400?e.retryAfterSeconds:null},429);return json({error:e?.message==='저장 목록이 변경되었거나 이어보기 기한이 지났습니다. 처음부터 다시 확인하세요.'?'저장 목록이 변경되었거나 이어보기 기한이 지났습니다. 처음부터 다시 확인하세요.':'Instagram 요청을 완료하지 못했습니다. 계정 연결과 조회 범위를 확인하세요.'},409);}
 };
}
