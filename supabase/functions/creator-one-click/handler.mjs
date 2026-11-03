// Review-only handler factory. No production entrypoint or credential is provided.
// auth/getRun/start/skip/enqueue/verifyApprovedDraft must be server-side adapters.
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function createHandler({origin,auth,member,getRun,getContext,getTemplate,getCurrentTemplate,getLatest,start,adopt,storeTemplate,skip,pause,enqueue,process,reconcile,verifyApprovedDraft}){
 if(typeof origin!=='string'||![auth,member,getRun,start,skip,enqueue].every(x=>typeof x==='function'))throw Error('missing trusted adapter');
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{...headers,'Content-Type':'application/json'}});
 return async req=>{try{
  const requestOrigin=req.headers.get('origin');if(requestOrigin&&requestOrigin!==origin)return json({error:'출처를 확인하세요.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  const bearer=req.headers.get('authorization')||'';if(!bearer.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
  const owner=await auth(bearer.slice(7));if(!uuid(owner))return json({error:'로그인이 필요합니다.'},401);if(!await member(owner))return json({error:'권한이 없습니다.'},403);
  const url=new URL(req.url),action=url.pathname.split('/').filter(Boolean).at(-1);
  if(req.method==='GET'&&action==='run'){const run=url.searchParams.get('id');if(!uuid(run))return json({error:'실행을 확인하세요.'},400);const data=await getRun(owner,run);return data?json(data):json({error:'실행을 찾지 못했습니다.'},404)}
  if(req.method==='GET'&&action==='latest'){if(typeof getLatest!=='function')return json({error:'조회가 불가능합니다.'},503);return json(await getLatest(owner))}
  if(req.method==='GET'&&action==='template-current'){if(typeof getCurrentTemplate!=='function')return json({error:'조회가 불가능합니다.'},503);return json(await getCurrentTemplate(owner))}
  if(req.method==='GET'&&action==='context'){const run=url.searchParams.get('runId'),creator=url.searchParams.get('creatorId');if(!uuid(run)||!uuid(creator)||typeof getContext!=='function')return json({error:'대상을 확인하세요.'},400);const data=await getContext(owner,run,creator);return data?json(data):json({error:'대상을 찾지 못했습니다.'},404)}
  if(req.method==='GET'&&action==='template'){const sha=url.searchParams.get('sha');if(!/^[a-f0-9]{64}$/.test(sha||'')||typeof getTemplate!=='function')return json({error:'템플릿을 확인하세요.'},400);const data=await getTemplate(owner,sha);return data?json(data):json({error:'템플릿을 찾지 못했습니다.'},404)}
  if(req.method!=='POST'||!['template','start','adopt','skip','pause','enqueue','process','reconcile'].includes(action))return json({error:'지원하지 않는 요청'},404);
  const announced=Number(req.headers.get('content-length')||0);if(Number.isFinite(announced)&&announced>65536)return json({error:'요청이 너무 깁니다.'},413);
  let size=0,chunks=[];if(req.body){const reader=req.body.getReader();for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();return json({error:'요청이 너무 깁니다.'},413)}chunks.push(part.value)}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}let b;try{b=JSON.parse(new TextDecoder().decode(bytes))}catch{return json({error:'요청을 확인하세요.'},400)}
  if(!b||typeof b!=='object'||Array.isArray(b))return json({error:'요청을 확인하세요.'},400);
  if(action==='template'){
   if(Object.keys(b).some(k=>!['subject','body','approved'].includes(k))||b.approved!==true||b.subject!=='도합 300만 크리에이터와 함께 일하는 남준혁 변리사입니다'||typeof b.body!=='string'||b.body.length>15000||!b.body.includes('{{아이디}}')||!b.body.includes('{{상품명}}')||typeof storeTemplate!=='function')return json({error:'승인된 템플릿을 확인하세요.'},400);
   return json({sha256:await storeTemplate(owner,b.subject,b.body,true)});
  }
  if(!uuid(b.runId))return json({error:'실행을 확인하세요.'},400);
  if(action==='pause'){
   if(Object.keys(b).some(k=>!['runId','paused'].includes(k))||typeof b.paused!=='boolean'||typeof pause!=='function')return json({error:'진행 상태를 확인하세요.'},400);
   return json({ok:await pause(owner,b.runId,b.paused)});
  }
  if(action==='start'){
   if(Object.keys(b).some(k=>!['runId','day','target','templateSha256','approved'].includes(k))||b.approved!==true||!/^\d{4}-\d{2}-\d{2}$/.test(b.day||'')||!Number.isInteger(b.target)||b.target<1||b.target>500||!/^[a-f0-9]{64}$/.test(b.templateSha256||''))return json({error:'추천 설정을 확인하세요.'},400);
   if(typeof verifyApprovedDraft!=='function'||!await verifyApprovedDraft({owner,templateSha256:b.templateSha256,phase:'start'}))return json({error:'승인된 템플릿 확인이 필요합니다.'},409);
   return json(await start(owner,b.runId,b.day,b.target,b.templateSha256));
  }
  if(action==='adopt'){
   if(Object.keys(b).some(k=>!['runId','day','creatorIds','templateSha256','approved'].includes(k))||b.approved!==true||!/^\d{4}-\d{2}-\d{2}$/.test(b.day||'')||!Array.isArray(b.creatorIds)||b.creatorIds.length<1||b.creatorIds.length>500||b.creatorIds.some(x=>!uuid(x))||new Set(b.creatorIds).size!==b.creatorIds.length||!/^[a-f0-9]{64}$/.test(b.templateSha256||'')||typeof adopt!=='function')return json({error:'확정된 추천 목록을 확인하세요.'},400);
   if(typeof verifyApprovedDraft!=='function'||!await verifyApprovedDraft({owner,templateSha256:b.templateSha256,phase:'start'}))return json({error:'승인된 템플릿 확인이 필요합니다.'},409);
   return json(await adopt(owner,b.runId,b.day,b.creatorIds,b.templateSha256,true));
  }
  if(!uuid(b.creatorId))return json({error:'대상을 확인하세요.'},400);
  if(action==='process'){
   if(Object.keys(b).some(k=>!['runId','creatorId'].includes(k))||typeof process!=='function')return json({error:'처리 대상을 확인하세요.'},400);
   return json(await process(owner,b.runId,b.creatorId,bearer.slice(7)));
  }
  if(action==='reconcile'){
   if(Object.keys(b).some(k=>!['runId','creatorId'].includes(k))||typeof reconcile!=='function')return json({error:'상태 확인 요청을 확인하세요.'},400);
   return json({status:await reconcile(owner,b.runId,b.creatorId)});
  }
  if(action==='skip'){
   if(Object.keys(b).some(k=>!['runId','creatorId','reason'].includes(k))||!['identity_unverified','contact_status','email_unverified','product_evidence_missing','draft_unavailable','review_existing','address_conflict','signature_unavailable','tracking_notice_unavailable'].includes(b.reason))return json({error:'제외 사유를 확인하세요.'},400);
   return json({ok:await skip(owner,b.runId,b.creatorId,b.reason)});
  }
  if(Object.keys(b).some(k=>!['runId','creatorId','draftId','hash','runAt'].includes(k))||!uuid(b.draftId)||!/^[a-f0-9]{64}$/.test(b.hash||'')||typeof b.runAt!=='string'||!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(b.runAt)||!Number.isFinite(Date.parse(b.runAt)))return json({error:'초안을 확인하세요.'},400);
  if(typeof verifyApprovedDraft!=='function'||!await verifyApprovedDraft({owner,runId:b.runId,creatorId:b.creatorId,draftId:b.draftId,phase:'enqueue'}))return json({error:'승인된 템플릿과 대상을 확인하세요.'},409);
  return json(await enqueue(owner,b.runId,b.creatorId,b.draftId,b.hash,b.runAt,bearer.slice(7)));
 }catch{return json({error:'처리 상태를 확인하세요. 결과가 불명확하면 다시 발송하지 마세요.'},503)}};
}
// A single atomic claim gates exactly one call to the existing authenticated
// mail engine. Uncertain transport is reconciled with canonical stored jobs.
async function submitThroughEngine({claim,forward,reconcile}){
 const state=await claim();if(state!=='claimed')return {status:state};
 try{await forward()}catch{}
 return {status:await reconcile()};
}
export {createHandler,submitThroughEngine};
