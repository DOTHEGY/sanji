import {functionRoute} from '../_shared/function-route.ts';
import {creatorInstagramOauth} from './oauth.ts';
import {instagramDirectInbox} from '../_shared/instagram-direct-inbox.ts';
import {oauthStateProblem,oauthLifetimeMs} from '../_shared/oauth-status.ts';

// Manual Instagram inbox only: no generic sender, scheduler, webhook, or other provider routes.
export function instagramInboxHandler({sb,query,env,key,digest,encrypt,connection,remote,resolveSession,capabilities,audit}:any){
 const origin=env('APP_ORIGIN')||'https://dothegy.github.io';
 const frontend=env('APP_FRONTEND_URL')||origin+'/sanji/workspace/';
 const front=new URL(frontend);if(front.origin!==origin||front.protocol!=='https:'||front.username||front.password||front.search||front.hash)throw Error('invalid frontend');
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 const oauth=creatorInstagramOauth({sb,query,env,key,digest,encrypt,remote,resolveSession,capabilities,audit,oauthStateProblem,oauthLifetimeMs});
 const inbox=instagramDirectInbox({sb,query,connection,remote,env});
 return async(req:Request)=>{
  try{
   const url=new URL(req.url),{path,base}=functionRoute(req.url,env('SUPABASE_URL'));
   if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return json({error:'허용되지 않은 출처'},403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   if(path==='/health'&&req.method==='GET')return json({ok:true});
   if(path==='/oauth/instagram/callback'){
    if(req.method!=='GET')return json({error:'허용되지 않은 요청 방식'},405);
    const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
    const destination=new URL(frontend);if(state&&code&&state.length<=256&&code.length<=4096)destination.hash='instagram-connect?'+new URLSearchParams({state,code});else{destination.searchParams.set('oauth_error','Instagram 연결이 취소되었거나 만료되었습니다.');destination.hash='creators';}
    return new Response(null,{status:302,headers:{Location:destination.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
   }
   const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
   const auth=await sb.auth.getUser(authorization.slice(7)),user=auth?.data?.user;if(auth?.error||!user)return json({error:'로그인 세션을 확인하세요.'},401);
   const member=await query(sb.from('sanji_members').select('user_id').eq('user_id',user.id).maybeSingle());if(!member)return json({error:'접근 권한이 없습니다.'},403);
   const owner=user.id;const input=async()=>{const raw=await req.text();if(new TextEncoder().encode(raw).length>20000)throw Error('요청 크기 초과');return raw?JSON.parse(raw):{};};
   if(path==='/creator-instagram/oauth/prepare'&&req.method==='POST'){if(!env('META_APP_ID')||!env('META_APP_SECRET')||!env('TOKEN_ENCRYPTION_KEY'))return json({error:'관리자의 Instagram 공식 앱과 암호화 설정을 확인하세요.'},503);return json(await oauth.prepare(owner,base));}
   if(path==='/creator-instagram/oauth/complete'&&req.method==='POST'){const b=await input();if(typeof b.state!=='string'||typeof b.code!=='string'||!b.state||!b.code||b.state.length>256||b.code.length>4096)throw Error('인증 요청 오류');const handoff=new URL(base+'/oauth/instagram/callback');handoff.searchParams.set('state',b.state);handoff.searchParams.set('code',b.code);return json(await oauth.callback(handoff,base,owner));}
   if(path==='/creator-instagram/message-status'&&req.method==='GET'){const rows=await query(sb.from('sanji_connections').select('provider,summary').eq('owner',owner).like('provider','instagram:%'));const matches=rows.filter((r:any)=>r.summary?.connected===true&&r.summary?.apiVerified===true&&String(r.summary?.username||'').toLowerCase()==='valu_est'&&r.provider==='instagram:'+r.summary?.accountId);const m=matches.length===1?matches[0].summary:null;return json({configured:!!env('META_APP_ID')&&!!env('META_APP_SECRET')&&!!env('TOKEN_ENCRYPTION_KEY'),expectedHandle:'valu_est',accountMatched:!!m,profileVerified:!!m,messagesReadable:m?.capabilities?.messagesReadable===true,lastChecked:m?.capabilities?.checked||null,officialRoutesEnabled:true,sendEnabled:env('INSTAGRAM_DIRECT_REPLY_ENABLED')==='true',notice:'저장된 연결 상태입니다. 현재 권한과 대화는 직접 확인해야 합니다.'});}
   if(path==='/creator-instagram/inbox'&&req.method==='GET'){const raw=url.searchParams.get('offset')||'0';if(!/^(0|[1-9]\d{0,5})$/.test(raw))throw Error('invalid offset');return json(await inbox.list(owner,Number(raw)));}
   if(path==='/creator-instagram/sync'&&req.method==='POST'){const b=await input();return json(await inbox.sync(owner,b.cursor));}
   if(path==='/creator-instagram/reply'&&req.method==='POST')return json(await inbox.reply(owner,await input()));
   return json({error:'지원하지 않는 경로'},404);
  }catch(e){const safe=e as any,status=Number(safe?.status),responseStatus=status===429?429:status===401||status===403?403:status>=500&&status<=599?503:400;if(['state','short_exchange','long_exchange','profile','account','save','capabilities'].includes(safe?.oauthStage)){const record:any={event:'instagram_oauth_failure',stage:safe.oauthStage,response_http_status:responseStatus};if(safe.compatibility==='unsupported_user_id_field')record.profile_error_kind='unsupported_user_id_field';for(const [key,name] of [['httpStatus','http_status'],['metaCode','meta_code'],['metaSubcode','meta_subcode']])if(Number.isSafeInteger(safe[key])&&safe[key]>=0&&safe[key]<=2147483647)record[name]=safe[key];console.error(JSON.stringify(record));}if(status===429)return json({error:'Meta 요청 한도에 도달했습니다. 잠시 후 직접 다시 확인하세요.'},429);if(status===401||status===403)return json({error:'Meta 계정 연결 또는 메시지 권한을 확인하세요.'},403);if(status>=500&&status<=599)return json({error:'Meta 서비스가 일시적으로 응답하지 않습니다. 잠시 후 직접 다시 확인하세요.'},503);return json({error:'Instagram 요청을 완료하지 못했습니다. 계정 연결과 권한을 확인하세요.'},400);}
 };
}
