import { DAILY_OUTREACH, OutreachError, creatorIdentity, outreachDay } from './domain.mjs';
import {validateInstagramReview,applyInstagramReview,instagramReviewState} from './supply-instagram-review.mjs';
import {validateSupplyReview,applySupplyReview} from './supply-review.mjs';
import { channelIdValid, publicCount, publicText } from '../youtube-discovery/discovery.mjs';

// This adapter stages official API facts, never contact approval or messages.
export const SUPPLY_LIMITS = Object.freeze({searchCalls:4, readCalls:112, candidates:100, pageSize:50, recentDays:90, snapshotDays:29, cursorDays:7, projectSearchCalls:20, projectReadUnits:500, leaseSeconds:300, timeoutMs:120000});
const DAY=86400000;
const CAMPAIGN=DAILY_OUTREACH.campaign;
const QUERIES=['먹방','빵 먹방'];
const videoIdValid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v);
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const fail=(code,message,status=503)=>{throw new OutreachError(code,message,status);};
export const quotaDay=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function supplyConfig(env=()=>undefined){return {enabled:env('CREATOR_DAILY_SUPPLY_ENABLED')==='true',apiKey:env('YOUTUBE_API_KEY')||'',projectId:env('YOUTUBE_QUOTA_PROJECT_ID')||''};}
function initialCursor(now){return {version:1,anchor:new Date(now).toISOString(),expiresAt:new Date(now+SUPPLY_LIMITS.cursorDays*DAY).toISOString(),next:0,queries:QUERIES.map(query=>({query,pageToken:null,done:false,seenTokens:[]}))};}
export function continuationCursor(prior,now){
 if(!prior||prior.version!==1||!validDate(prior.anchor)||Date.parse(prior.anchor)>now||!validDate(prior.expiresAt)||Date.parse(prior.expiresAt)<=now||!Array.isArray(prior.queries)||prior.queries.length!==QUERIES.length||prior.queries.some((s,i)=>s.query!==QUERIES[i]||!(s.pageToken===null||typeof s.pageToken==='string'&&s.pageToken.length<=512)||!Array.isArray(s.seenTokens)||s.seenTokens.length>32||s.seenTokens.some(t=>typeof t!=='string'||t.length>512))||prior.queries.every(q=>q.done))return initialCursor(now);
 return structuredClone(prior);
}
function snapshotCandidate(row){
 const c=row.snapshot||row;
 return {platform:'youtube',externalId:c.channelId,name:c.title,profileUrl:c.url,sourceRecordId:null,audience:c.subscriberCount,audienceSource:c.url,audienceCheckedAt:c.observedAt,lastActiveAt:c.lastActiveAt,activitySource:c.lastActivityUrl,activityCheckedAt:c.observedAt,mukbang:null,contactEvidence:[],apiSnapshot:{channelId:c.channelId,observedAt:c.observedAt,expiresAt:c.expiresAt,fieldNames:['creatorKey','externalId','profileUrl','name','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt'],titleFromApi:true},reviewRequired:['mukbang_evidence_required','public_email_evidence_required']};
}
export function mergeSupplyCandidates(manual,snapshots,now=Date.now(),reviews=[],instagramReviews=[],instagramReviewGuards=[]){
 const fresh=snapshots.filter(r=>{const c=r.snapshot||r;return channelIdValid(c.channelId)&&validDate(c.observedAt)&&Date.parse(c.observedAt)<=now&&validDate(c.expiresAt)&&Date.parse(c.expiresAt)>now&&Date.parse(c.expiresAt)<=Date.parse(c.observedAt)+30*DAY;});
 const byKey=new Map(fresh.map(r=>{const candidate=snapshotCandidate(r),review=reviews.find(v=>(v.review||v).creatorKey===creatorIdentity(candidate));return [creatorIdentity(candidate),applySupplyReview(candidate,review?.review||review,now)];}));
 const result=manual.map(row=>{
  if(row.platform==='instagram'){const review=instagramReviews.find(r=>(r.review||r).sourceRecordId===row.sourceRecordId);return applyInstagramReview(row,review?.review||review,now,instagramReviewGuards.some(g=>g.creator_id===row.sourceRecordId));}
  if(row.platform!=='youtube')return {...row};
  const api=byKey.get(creatorIdentity(row));
  // Existing reviewed contact/mukbang and all exclusion flags survive. Facts are
  // overlaid in memory only; there is no write to sanji_records or IG sources.
  return api?{...row,audience:api.audience,audienceSource:api.audienceSource,audienceCheckedAt:api.audienceCheckedAt,lastActiveAt:api.lastActiveAt,activitySource:api.activitySource,activityCheckedAt:api.activityCheckedAt,apiSnapshot:{...api.apiSnapshot,fieldNames:api.apiSnapshot.fieldNames.filter(name=>!['name','creatorKey','externalId','profileUrl'].includes(name)),titleFromApi:false}}: {...row};
 });
 const manualKeys=new Set(manual.map(creatorIdentity).filter(Boolean));
 for(const [key,row] of byKey)if(!manualKeys.has(key))result.push(row);
 if(result.length>5000)fail('SOURCES_INCOMPLETE','후보 원본의 안전 조회 한도를 초과했습니다.');
 return result;
}
export function createDailySupply({repository,sourceRepository,apiKey='',projectId='',enabled=false,fetchImpl=fetch,now=()=>Date.now(),uuid=()=>crypto.randomUUID(),sweepDownstream}){
 async function status(owner){const configurationReady=Boolean(apiKey&&/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId));return {enabled,configurationReady,state:enabled?(configurationReady?'ready':'blocked'):'stopped',blockers:[...(!apiKey?['existing_youtube_key_required']:[]),...(!/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId)?['existing_google_project_id_required']:[])],campaign:CAMPAIGN,recentActivityDays:90,provisionalActivityWindow:true,targets:{youtube:50,instagram:10},quotaScope:'daily_supply_worker_only',quotaTimezone:'America/Los_Angeles',limits:SUPPLY_LIMITS,latest:await repository.latest(owner,CAMPAIGN),sendingEnabled:false,schedulerEnabled:false};}
 async function sourceCandidates(owner){
  const [source,snapshots,reviews,instagramReviews,instagramReviewGuards]=await Promise.all([sourceRepository.candidates(owner),repository.snapshots(owner,CAMPAIGN),repository.reviews?repository.reviews(owner,CAMPAIGN):[],repository.instagramReviews?repository.instagramReviews(owner,CAMPAIGN):[],repository.instagramReviewGuards?repository.instagramReviewGuards(owner,CAMPAIGN):[]]);
  if(source?.complete!==true||!Array.isArray(source.candidates))fail('SOURCES_INCOMPLETE','기존 후보 원본을 완전하게 확인하지 못했습니다.');
  return {complete:true,candidates:mergeSupplyCandidates(source.candidates,snapshots,now(),reviews,instagramReviews,instagramReviewGuards)};
 }
 async function listReview(owner){
  const [snapshots,reviews,source,instagramReviews,instagramReviewGuards]=await Promise.all([repository.snapshots(owner,CAMPAIGN),repository.reviews?repository.reviews(owner,CAMPAIGN):[],sourceRepository.candidates(owner),repository.instagramReviews?repository.instagramReviews(owner,CAMPAIGN):[],repository.instagramReviewGuards?repository.instagramReviewGuards(owner,CAMPAIGN):[]]);
  if(source?.complete!==true||!Array.isArray(source.candidates))fail('SOURCES_INCOMPLETE','기존 후보 원본을 완전하게 확인하지 못했습니다.');
  const youtube=snapshots.map(row=>({...row,platform:'youtube',review:reviews.find(r=>r.creator_key==='youtube:'+(row.snapshot||row).channelId)?.review||null}));
  const instagram=source.candidates.filter(row=>row.platform==='instagram'&&row.existingDatabaseRecord===true).map(row=>{const review=instagramReviews.find(r=>(r.review||r).sourceRecordId===row.sourceRecordId)?.review||null;return {platform:'instagram',creator_key:creatorIdentity(row),creator_id:row.sourceRecordId,candidate:row,review,reviewState:instagramReviewState(row,review,now(),instagramReviewGuards.some(g=>g.creator_id===row.sourceRecordId))};});
  return {source:'youtube_data_api',sources:['youtube_data_api','existing_instagram_database'],requiresHumanReview:true,items:[...youtube,...instagram],contactCollectionSupported:false};
 }
 async function review(owner,input){
  if(!enabled)fail('DAILY_SUPPLY_DISABLED','일일 후보 근거 검토는 아직 운영 활성화 전입니다.');
  if(typeof input?.creatorKey==='string'&&input.creatorKey.startsWith('instagram:')){
   const source=await sourceRepository.candidates(owner);if(source?.complete!==true||!Array.isArray(source.candidates))fail('SOURCES_INCOMPLETE','기존 후보 원본을 완전하게 확인하지 못했습니다.');
   const matched=source.candidates.filter(row=>row.platform==='instagram'&&row.sourceRecordId===input.sourceRecordId&&creatorIdentity(row)===input.creatorKey);
   if(matched.length!==1)fail('INSTAGRAM_REVIEW_SOURCE_CHANGED','기존 Instagram 후보를 다시 불러오세요.',409);
   const evidence=validateInstagramReview(owner,input,matched[0],now());
   const saved=await repository.saveInstagramReview({owner,campaign:CAMPAIGN,review:evidence});
   if(saved?.saved!==true)fail('INSTAGRAM_REVIEW_SAVE_UNCERTAIN','근거 저장 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');
   return {...saved,platform:'instagram',sendingEnabled:false,reviewed:true,contactEvidenceReady:evidence.contactEvidence.length>0};
  }
  const snapshots=await repository.snapshots(owner,CAMPAIGN),row=snapshots.find(r=>'youtube:'+(r.snapshot||r).channelId===input?.creatorKey);
  if(!row)fail('SUPPLY_REVIEW_STALE','검토할 최신 후보를 다시 불러오세요.',409);
  const evidence=validateSupplyReview(owner,input,row.snapshot||row,now());
  const saved=await repository.saveReview({owner,campaign:CAMPAIGN,review:evidence});
  if(saved?.saved!==true)fail('SUPPLY_REVIEW_SAVE_UNCERTAIN','근거 저장 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');
  return {...saved,sendingEnabled:false,reviewed:true,contactEvidenceReady:evidence.contactEvidence.length>0};
 }
 async function sweepExpired(){const own=await repository.sweepExpired();return typeof sweepDownstream==='function'?{...own,downstream:await sweepDownstream()}:own;}
 async function run(owner){
  if(!enabled)fail('DAILY_SUPPLY_DISABLED','일일 후보 수집은 아직 운영 활성화 전입니다.');
  if(!apiKey||!/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId))fail('DAILY_SUPPLY_NOT_CONFIGURED','기존 YouTube 키와 동일 프로젝트 할당량 식별자를 확인하세요.');
  const start=now(),day=outreachDay(start),token=uuid();
  // Purge API material physically before reads and provider work. Do not mutate CRM.
  await sweepExpired();
  const claim=await repository.claim({owner,campaign:CAMPAIGN,day,token});
  if(claim?.state==='completed'||claim?.state==='failed')return {...claim.summary,state:claim.state,duplicate:true,newlyCollected:false};
  if(claim?.state==='busy')return {state:'busy',day,campaign:CAMPAIGN,newlyCollected:false,sendingEnabled:false};
  if(claim?.state!=='claimed')fail('SUPPLY_CLAIM_UNCERTAIN','수집 실행 잠금을 확인하지 못했습니다. 상태를 새로고침하세요.');
  const context={owner,campaign:CAMPAIGN,day,token};
  const quota={searchCalls:claim.searchCalls||0,readCalls:claim.readCalls||0};
  let cursor=continuationCursor(claim.cursor,start),staged=0,examined=0,skippedExisting=0,excludedBounds=0,unverifiedActivity=0;
  const deadline=start+SUPPLY_LIMITS.timeoutMs;
  let source,history;
  async function request(resource,params){
   const search=resource==='search',kind=search?'search':'read';
   if(now()>=deadline)fail('SUPPLY_TIMEOUT','이번 수집의 시간 제한에 도달했습니다.');
   if(outreachDay(now())!==day)fail('SUPPLY_DAY_CHANGED','한국 날짜가 바뀌어 이번 실행을 종료했습니다.');
   if((search?quota.searchCalls:quota.readCalls)>=(search?SUPPLY_LIMITS.searchCalls:SUPPLY_LIMITS.readCalls))fail('SUPPLY_RUN_BUDGET','이번 실행의 조회 한도에 도달했습니다.');
   const reserved=await repository.reserve({...context,projectId,kind,requestId:uuid()});
   if(reserved?.granted!==true)fail(reserved?.code==='lease_lost'?'SUPPLY_LEASE_LOST':'SUPPLY_QUOTA_LIMIT','프로젝트 할당량 또는 실행 잠금을 확인하지 못해 조회를 중단했습니다.');
   // Charge before network, never refund failed/uncertain calls. Another worker's
   // completed reservation is not permission to repeat the request.
   quota[search?'searchCalls':'readCalls']++;
   const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);
   for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
   let response;
   try{response=await fetchImpl(url,{headers:{'X-Goog-Api-Key':apiKey},redirect:'error',signal:AbortSignal.timeout(Math.min(8000,Math.max(1,deadline-now())))});}catch{fail('SUPPLY_PROVIDER_UNCERTAIN','YouTube 조회 결과를 받지 못했습니다. 자동 재시도하지 않았습니다.');}
   let data;try{data=await response.json();}catch{fail('SUPPLY_INVALID_RESPONSE','YouTube 응답을 확인하지 못했습니다.');}
   if(!response.ok){const reasons=data?.error?.errors?.map(e=>e.reason)||[];fail(response.status===429||reasons.some(r=>['quotaExceeded','dailyLimitExceeded','rateLimitExceeded'].includes(r))?'SUPPLY_PROVIDER_QUOTA':'SUPPLY_PROVIDER_REJECTED','YouTube 조회가 중단되었습니다. 키를 바꾸거나 자동 재시도하지 않았습니다.');}
   if(!data||!Array.isArray(data.items))fail('SUPPLY_INVALID_RESPONSE','YouTube 결과 형식이 올바르지 않습니다.');
   return data;
  }
  const summary=(state,code=null)=>({state,day,campaign:CAMPAIGN,stagedYoutube:staged,examined,skippedExisting,excludedBounds,unverifiedActivity,targets:{youtube:50,instagram:10},youtubeResearchShortfall:Math.max(0,50-staged),contactReadyGuaranteed:false,quota,quotaScope:'daily_supply_worker_only',recentActivityDays:90,provisionalActivityWindow:true,stopCode:code,sendingEnabled:false,schedulerEnabled:false});
  try{
   [source,history]=await Promise.all([sourceRepository.candidates(owner),sourceRepository.history(owner)]);
   if(source?.complete!==true||!Array.isArray(source.candidates)||history?.complete!==true||!Array.isArray(history.creatorKeys))fail('SUPPLY_HISTORY_INCOMPLETE','기존 후보·연락 이력을 완전하게 확인하지 못해 수집을 중단했습니다.');
   const snapshots=await repository.snapshots(owner,CAMPAIGN);
   const excluded=new Set([...source.candidates.map(creatorIdentity),...history.creatorKeys,...snapshots.map(r=>'youtube:'+(r.snapshot||r).channelId)].filter(Boolean));
   const found=new Map();
   while(quota.searchCalls<SUPPLY_LIMITS.searchCalls&&found.size<SUPPLY_LIMITS.candidates){
    const available=cursor.queries.map((s,index)=>({s,index})).filter(({s})=>!s.done);if(!available.length)break;
    const {s,index}=available.find(x=>x.index>=cursor.next)||available[0];
    const page=await request('search',{part:'snippet',type:'video',q:s.query,order:'date',maxResults:50,relevanceLanguage:'ko',safeSearch:'strict',publishedAfter:new Date(Date.parse(cursor.anchor)-90*DAY).toISOString(),fields:'nextPageToken,items(id/videoId,snippet(channelId,channelTitle,title,publishedAt))',...(s.pageToken?{pageToken:s.pageToken}:{})});
    for(const item of page.items.slice(0,50)){
     const id=item?.snippet?.channelId;if(!channelIdValid(id)||!videoIdValid(item?.id?.videoId))continue;
     if(excluded.has('youtube:'+id)){skippedExisting++;continue;}
     if(!found.has(id)&&found.size<SUPPLY_LIMITS.candidates)found.set(id,{id});
    }
    const next=typeof page.nextPageToken==='string'&&page.nextPageToken.length<=512?page.nextPageToken:null;
    s.done=!next||s.seenTokens.includes(next)||s.seenTokens.length>=32;if(next)s.seenTokens.push(next);s.pageToken=next;cursor.next=(index+1)%cursor.queries.length;
    // Persist cursor only together with staged channel results below. A crash
    // before that checkpoint may repeat a read with a NEW paid reservation.
   }
   examined=found.size;
   const details=[];const ids=[...found.keys()];
   for(let offset=0;offset<ids.length;offset+=50){const page=await request('channels',{part:'snippet,statistics,contentDetails',id:ids.slice(offset,offset+50).join(','),maxResults:50,fields:'items(id,snippet/title,statistics(subscriberCount,hiddenSubscriberCount),contentDetails/relatedPlaylists/uploads)'});details.push(...page.items);}
   const stage=[],seenDetails=new Set();
   for(const c of details){
    if(!found.has(c?.id)||seenDetails.has(c.id))continue;seenDetails.add(c.id);
    const count=c.statistics?.hiddenSubscriberCount?null:publicCount(c.statistics?.subscriberCount);
    if(count===null||count<30000||count>500000){excludedBounds++;continue;}
    const playlist=c.contentDetails?.relatedPlaylists?.uploads;if(!/^UU[A-Za-z0-9_-]{22}$/.test(playlist||'')){unverifiedActivity++;continue;}
    const uploads=await request('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:5,fields:'items/contentDetails(videoId)'});
    const videoIds=[...new Set(uploads.items.map(v=>v?.contentDetails?.videoId).filter(videoIdValid))].slice(0,5);
    // Use videos.list to bind latest visible uploads to this channel. Date-only
    // playlist entries or keyword search hits never prove current activity.
    if(!videoIds.length){unverifiedActivity++;continue;}
    stage.push({channelId:c.id,title:publicText(c.snippet?.title,150),url:'https://www.youtube.com/channel/'+c.id,subscriberCount:count,videoIds});
   }
   const videoIds=[...new Set(stage.flatMap(c=>c.videoIds))],videos=new Map();
   for(let offset=0;offset<videoIds.length;offset+=50){const page=await request('videos',{part:'snippet',id:videoIds.slice(offset,offset+50).join(','),maxResults:50,fields:'items(id,snippet(channelId,title,publishedAt))'});for(const video of page.items)if(videoIds.includes(video?.id))videos.set(video.id,video);}
   const observedAt=new Date(now()).toISOString(),expiresAt=new Date(now()+SUPPLY_LIMITS.snapshotDays*DAY).toISOString();
   const rows=[];
   for(const c of stage){
    const recentVideos=c.videoIds.map(id=>videos.get(id)).filter(v=>v?.snippet?.channelId===c.channelId&&validDate(v.snippet.publishedAt)&&Date.parse(v.snippet.publishedAt)<=now()).map(v=>({videoId:v.id,title:publicText(v.snippet.title,200),url:'https://www.youtube.com/watch?v='+v.id,publishedAt:v.snippet.publishedAt})).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
    if(!recentVideos.length||Date.parse(recentVideos[0].publishedAt)<now()-90*DAY){unverifiedActivity++;continue;}
    rows.push({channelId:c.channelId,title:c.title,url:c.url,subscriberCount:c.subscriberCount,lastActiveAt:recentVideos[0].publishedAt,lastActivityUrl:recentVideos[0].url,recentVideos,observedAt,expiresAt,source:'youtube_data_api',reviewRequired:true});
   }
   // Finish atomically checkpoints the cursor and API snapshots under the lease.
   staged=rows.length;
   let result;try{result=await repository.finish({...context,cursor,snapshots:rows,summary:summary('completed')});}catch{fail('SUPPLY_SAVE_UNCERTAIN','수집 저장 결과를 확인하지 못했습니다. 상태를 새로고침하세요.');}
   if(result?.state!=='completed')fail('SUPPLY_SAVE_UNCERTAIN','수집 저장 결과를 확인하지 못했습니다. 상태를 새로고침하세요.');
   return {...result,newlyCollected:true};
  }catch(error){
   const code=error instanceof OutreachError?error.code:'SUPPLY_UNAVAILABLE';
   // Do not advance cursor on a partial run. Failed/unknown reads stay charged.
   // Atomic finish has unknown outcome: query status, do not issue another write.
   if(code==='SUPPLY_SAVE_UNCERTAIN')throw error;
   try{await repository.fail({...context,summary:summary('failed',code)});}catch{/* Original failure only; status must reconcile unknown DB outcome. */}
   throw error instanceof OutreachError?error:new OutreachError('SUPPLY_UNAVAILABLE','후보 수집을 완료하지 못했습니다. 상태를 확인하세요.',503);
  }
 }
 return {status,run,sourceCandidates,listReview,review,sweepExpired};
}
