import {DAILY_OUTREACH,OutreachError,buildDailyOutreachBatch,outreachDay} from './domain.mjs';
// The service has no email transport or credentials and cannot enqueue a send.
// Sources must be complete server-side repository reads, never client DTOs.
export function dailyOutreachService({repository,now=()=>Date.now()}){
 async function status(owner){const latest=await repository.latest(owner);return {...DAILY_OUTREACH,state:'preparation_only',copyStatus:'private_template_required',latest,blockers:['production_activation_required','approved_recipient_basis_required','verified_inline_product_images_required','daily_discovery_adapter_required','dispatch_not_implemented','existing_gmail_signature_required','private_template_required','live_gmail_preflight_required'],sendingEnabled:false,schedulerEnabled:false};}
 async function prepare(owner){
  const day=outreachDay(now());const existing=await repository.findRun(owner,day);if(existing&&(!existing.counts||existing.counts.youtube>=50&&existing.counts.instagram>=10))return {...existing,duplicate:true};
  const [sources,history]=await Promise.all([repository.candidates(owner),repository.history(owner)]);
  if(!sources||sources.complete!==true||!Array.isArray(sources.candidates))throw new OutreachError('SOURCES_INCOMPLETE','후보 원본을 모두 확인하지 못했습니다.',503);
  const plan=buildDailyOutreachBatch({candidates:sources.candidates,history,now:now()});
  // Atomic persistence rechecks native and new history under an owner lock.
  // A lost response is uncertain; the HTTP client must query status, never resend.
  const result=await repository.save(owner,plan);if(!result||result.day!==day||result.sendingEnabled!==false)throw new OutreachError('SAVE_UNCERTAIN','저장 결과를 확인하지 못했습니다. 상태를 새로고침하세요.',503);return result;
 }
 return {status,prepare};
}
export function dailyOutreachHandler({sb,service,env=()=>''}){
 return async req=>{
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
  const origin=req.headers.get('Origin'),allowed=(env('APP_ORIGIN')||'https://dothegy.github.io').split(',').map(x=>x.trim());
  if(origin&&!allowed.includes(origin))return json({code:'ORIGIN_DENIED'},403);if(origin)headers['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
   const token=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')||'')?.[1];if(!token)throw new OutreachError('AUTH_REQUIRED','로그인이 필요합니다.',401);
   const auth=await sb.auth.getUser(token),owner=auth?.data?.user?.id;if(auth.error||!owner)throw new OutreachError('AUTH_REQUIRED','로그인이 필요합니다.',401);
   const member=await sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle();if(member.error||member.data?.user_id!==owner)throw new OutreachError('MEMBERSHIP_REQUIRED','Sanji 회원 확인이 필요합니다.',403);
   const path=new URL(req.url).pathname.replace(/^.*\/creator-daily-outreach/,'');
   if(path==='/status'&&req.method==='GET')return json({...await service.status(owner),preparationEnabled:env('CREATOR_DAILY_PREPARATION_ENABLED')==='true'});
   if(path!=='/prepare'||req.method!=='POST')throw new OutreachError('NOT_FOUND','지원하지 않는 요청입니다.',404);
   if(env('CREATOR_DAILY_PREPARATION_ENABLED')!=='true')throw new OutreachError('PREPARATION_DISABLED','일일 후보 준비는 아직 운영 활성화 전입니다.',503);
   const reader=req.body?.getReader();let body='';if(reader){let bytes=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32){await reader.cancel();throw new OutreachError('BODY_TOO_LARGE','요청 내용을 확인하세요.',413);}chunks.push(value);}}finally{reader.releaseLock();}const raw=new Uint8Array(bytes);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}body=new TextDecoder().decode(raw);}
   if(body.trim()&&body.trim()!=='{}')throw new OutreachError('INVALID_INPUT','수신자·본문·계정은 요청 본문으로 지정할 수 없습니다.');
   return json(await service.prepare(owner));
  }catch(error){return json({code:error instanceof OutreachError?error.code:'PREPARATION_UNAVAILABLE',error:error instanceof OutreachError?error.message:'후보 준비를 완료하지 못했습니다. 상태를 확인하세요.'},error instanceof OutreachError?error.status:503);}
 };
}
