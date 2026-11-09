import {DAILY_OUTREACH,OutreachError,outreachDay} from './domain.mjs';
import {dailyOutreachService} from './service.mjs';
// Full orchestration, still stopped until the separately reviewed deployments,
// source policies, immutable copy/images and recurring trigger are configured.
export function createOutreachController({repository,supply,enrichment,dispatch,sourceReviews,env=()=>'',now=()=>Date.now()}){
 const prepared=dailyOutreachService({repository:{...repository,async candidates(owner){
  const sources=await supply.sourceCandidates(owner);
  if(sources?.complete!==true||!Array.isArray(sources.candidates))throw new OutreachError('SOURCES_INCOMPLETE','현재 후보 원본을 완전하게 확인하지 못했습니다.',503);
  const enriched=await enrichment.enrich(owner,{candidates:sources.candidates});
  if(enriched?.complete!==true||!Array.isArray(enriched.candidates))throw new OutreachError('CONTACT_ENRICHMENT_INCOMPLETE','공개 업무 연락처의 최신 확인을 완료하지 못했습니다.',503);
  return {complete:true,candidates:enriched.candidates};
 }},now});
 async function status(owner){
  const [base,discovery,campaign]=await Promise.all([prepared.status(owner),supply.status(owner),dispatch.configuration(owner)]);
  return {...DAILY_OUTREACH,state:'campaign',preparationEnabled:env('CREATOR_DAILY_PREPARATION_ENABLED')==='true'&&discovery.enabled===true&&discovery.configurationReady!==false&&env('CREATOR_DAILY_RETENTION_ENABLED')==='true',latest:base.latest,discovery,campaign,
   // These flags describe capability, not a promise that an external timer exists.
   sendingEnabled:campaign.sendingEnabled===true&&env('EMAIL_SENDING_ENABLED')==='true',schedulerEnabled:campaign.schedulerEnabled===true&&env('CREATOR_DAILY_WORKER_ENABLED')==='true',recurringTriggerVerified:campaign.recurringTriggerVerified===true,
   blockers:Array.isArray(campaign.blockers)?campaign.blockers:[],copyStatus:campaign.snapshotId?'private_template_saved':'private_template_required'};
 }
 async function prepare(owner){
  if(env('CREATOR_DAILY_PREPARATION_ENABLED')!=='true')throw new OutreachError('PREPARATION_DISABLED','일일 후보 준비가 아직 운영 활성화 전입니다.',503);
  if(env('CREATOR_DAILY_RETENTION_ENABLED')!=='true')throw new OutreachError('RETENTION_REQUIRED','API 자료 정리 작업을 먼저 연결해야 합니다.',503);
  const existing=await repository.findRun(owner,outreachDay(now()));if(existing&&(!existing.counts||existing.counts.youtube>=50&&existing.counts.instagram>=10))return {...existing,duplicate:true};
  const discovery=await supply.status(owner),latest=discovery.latest;
  if(latest?.day!==outreachDay(now())||latest?.state!=='completed')throw new OutreachError('COLLECTION_REQUIRED','오늘 신규 후보 탐색을 먼저 완료하고 근거를 검토하세요.',409);
  return prepared.prepare(owner);
 }
 async function collect(owner){
  if(env('CREATOR_DAILY_PREPARATION_ENABLED')!=='true')throw new OutreachError('PREPARATION_DISABLED','일일 후보 준비가 아직 운영 활성화 전입니다.',503);
  if(env('CREATOR_DAILY_RETENTION_ENABLED')!=='true')throw new OutreachError('RETENTION_REQUIRED','API 자료 정리 작업을 먼저 연결해야 합니다.',503);
  const result=await supply.run(owner);
  if(result?.state==='busy')throw new OutreachError('DAILY_SUPPLY_BUSY','오늘의 후보 탐색이 이미 진행 중입니다. 상태를 새로고침하세요.',409);
  if(result?.state!=='completed')throw new OutreachError('DAILY_SUPPLY_FAILED','오늘의 후보 탐색을 완료하지 못했습니다. 저장된 결과를 확인하세요.',503);
  return result;
 }
 return {status,prepare,collect,currentPlan:owner=>repository.findRun(owner,outreachDay(now())),configuration:owner=>dispatch.configuration(owner),configure:(owner,input)=>dispatch.configure(owner,input),schedule:(owner,input)=>dispatch.schedule(owner,input),pause:(owner,input)=>dispatch.pause(owner,input),runs:owner=>dispatch.runs(owner),recipientReviews:owner=>dispatch.recipientReviews(owner),reviewRecipient:(owner,input)=>dispatch.reviewRecipient(owner,input),supplyReview:owner=>supply.listReview(owner),reviewCandidate:(owner,input)=>supply.review(owner,input),sourceReviewList:owner=>sourceReviews?.list(owner)||Promise.resolve({items:[],registrationEnabled:false}),registerSourceReview:(owner,input)=>{if(!sourceReviews?.register)throw new OutreachError('SOURCE_REGISTRATION_DISABLED','출처 검토 등록이 아직 연결되지 않았습니다.',503);return sourceReviews.register(owner,input);}};
}
const routes={
 '/status':['GET','status',0],'/configuration':['GET','configuration',0],'/runs':['GET','runs',0],'/recipient-reviews':['GET','recipientReviews',0],'/supply-review':['GET','supplyReview',0],'/source-reviews':['GET','sourceReviewList',0],
 '/collect':['POST','collect',32],'/review-candidate':['POST','reviewCandidate',24000],'/prepare':['POST','prepare',32],'/configure':['POST','configure',5*1024*1024],'/schedule':['POST','schedule',512],'/pause':['POST','pause',512],'/review-recipient':['POST','reviewRecipient',16000],'/register-source-review':['POST','registerSourceReview',24000]
};
async function jsonBody(req,max){
 if(Number(req.headers.get('Content-Length')||0)>max)throw new OutreachError('BODY_TOO_LARGE','요청 파일 또는 내용이 너무 큽니다.',413);
 const reader=req.body?.getReader();const chunks=[];let size=0;
 if(reader)try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw new OutreachError('BODY_TOO_LARGE','요청 파일 또는 내용이 너무 큽니다.',413);}chunks.push(r.value);}}finally{reader.releaseLock();}
 const raw=new Uint8Array(size);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.length;}
 let body;try{body=size?JSON.parse(new TextDecoder().decode(raw)):{};}catch{throw new OutreachError('INVALID_JSON','입력 형식을 확인하세요.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new OutreachError('INVALID_INPUT','입력 형식을 확인하세요.');
 if(['owner','sendEnabled','enabled','sendingEnabled','serviceRole','token'].some(key=>Object.hasOwn(body,key)))throw new OutreachError('CALLER_SCOPE_DENIED','계정·발송 권한·인증정보를 요청으로 지정할 수 없습니다.');
 return body;
}
export function campaignHandler({sb,controller,env=()=>''}){
 return async req=>{
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
  const origin=req.headers.get('Origin'),allowed=(env('APP_ORIGIN')||'https://dothegy.github.io').split(',').map(v=>v.trim());
  if(origin&&!allowed.includes(origin))return json({code:'ORIGIN_DENIED'},403);if(origin)headers['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
   const token=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')||'')?.[1];if(!token)throw new OutreachError('AUTH_REQUIRED','로그인이 필요합니다.',401);
   const auth=await sb.auth.getUser(token),owner=auth.data?.user?.id;if(auth.error||!owner)throw new OutreachError('AUTH_REQUIRED','로그인이 필요합니다.',401);
   const member=await sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle();if(member.error||member.data?.user_id!==owner)throw new OutreachError('MEMBERSHIP_REQUIRED','현재 Sanji 회원 확인이 필요합니다.',403);
   const path=new URL(req.url).pathname.replace(/^.*\/creator-daily-outreach/,''),route=routes[path];if(!route||req.method!==route[0])throw new OutreachError('NOT_FOUND','지원하지 않는 요청입니다.',404);
   if(req.method==='GET')return json(await controller[route[1]](owner));
   const body=await jsonBody(req,route[2]);
   if(['/prepare','/collect'].includes(path)){
    if(Object.keys(body).length)throw new OutreachError('INVALID_INPUT','준비 요청은 빈 객체만 허용합니다.');
    if(env('CREATOR_DAILY_PREPARATION_ENABLED')!=='true')throw new OutreachError('PREPARATION_DISABLED','일일 후보 준비가 아직 운영 활성화 전입니다.',503);
   }
   if(['/schedule','/pause'].includes(path)&&(Object.keys(body).some(key=>key!=='expectedRevision')||!Number.isInteger(body.expectedRevision)||body.expectedRevision<1))throw new OutreachError('REVISION_REQUIRED','현재 설정 버전을 확인하세요.');
   return json(await controller[route[1]](owner,body));
  }catch(error){return json({code:error instanceof OutreachError?error.code:'CAMPAIGN_UNAVAILABLE',error:error instanceof OutreachError?error.message:'캠페인 처리 결과를 확인하지 못했습니다. 상태를 새로고침하세요.'},error instanceof OutreachError?error.status:503);}
 };
}
