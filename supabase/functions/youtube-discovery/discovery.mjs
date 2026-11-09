import {buildBriefReview,annotateCandidate} from './relevance.mjs';
import { mukbangReview } from './review-filters.mjs';
export const DISCOVERY_LIMITS = {target:50, searchCalls:4, candidates:100, pageSize:50};
// Official API only. No scraping, contact harvesting, profiling scores or sending.
export class DiscoveryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new DiscoveryError(status, code, message); };
export const publicCount = value => /^(?:0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export const channelIdValid = value => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value);
const videoIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export function publicText(value, max = 600) {
  // Mask conventional email strings in descriptive prose; this is not a PII classifier.
  return String(value || '').normalize('NFKC').replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[연락처 표시 안 함]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,max);
}
export function searchPlan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['brief','queries'].includes(k))) fail(400,'INVALID_INPUT','협업 목적과 검색어를 확인하세요.');
  if (typeof body.brief !== 'string' || body.brief.trim().length < 2 || body.brief.length > 500 || /[\u0000-\u001f]/.test(body.brief)) fail(400,'INVALID_BRIEF','협업 목적은 2~500자로 입력하세요.');
  const brief = body.brief.trim();
  if (/@|https?:\/\/|\b(?:password|token|secret)\b/i.test(brief)) fail(400,'PRIVATE_INPUT','검색에는 공개 분야와 키워드만 입력하세요. 이메일·비밀정보는 넣지 마세요.');
  let queries;
  if (body.queries !== undefined) {
    if (!Array.isArray(body.queries) || !body.queries.length || body.queries.length > 2 || body.queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 100 || /[@\u0000-\u001f]|https?:\/\//i.test(q))) fail(400,'INVALID_QUERIES','검색어는 최대 2개, 각 100자 이내로 입력하세요.');
    queries = body.queries.map(q=>q.trim());
  }
  const criteria=buildBriefReview(brief,queries);
  if(criteria.requiresQueryReview&&!queries?.length) fail(400,'QUERY_REVIEW_REQUIRED','제외 조건의 의미를 자동 확정하지 않았습니다. 검색어를 직접 지정하세요.');
  if(!criteria.queries.length) fail(400,'TOPIC_REQUIRED','먹방·호빵처럼 찾을 콘텐츠 주제를 입력하거나 검색어를 직접 지정하세요.');
  return {brief, queries:criteria.queries,criteria};
}
export async function discover(body, {apiKey, fetchImpl=fetch, now=()=>Date.now()} = {}) {
  const plan = searchPlan(body);
  if (!apiKey) fail(503,'YOUTUBE_NOT_CONFIGURED','YouTube API 연결이 아직 준비되지 않았습니다.');
  const quota = {searchCalls:0,readCalls:0};
  const deadline = now() + 18000;
  async function request(resource, params) {
    if (now() >= deadline) fail(504,'YOUTUBE_TIMEOUT','검색 시간이 초과되었습니다. 잠시 후 다시 시도하세요.');
    const url = new URL('https://www.googleapis.com/youtube/v3/'+resource);
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
    // Keep API keys out of URLs and exception strings.
    let response;
    try { response = await fetchImpl(url, {headers:{'X-Goog-Api-Key':apiKey},signal:AbortSignal.timeout(Math.min(8000,Math.max(1,deadline-now()))),redirect:'error'}); }
    catch { fail(504,'YOUTUBE_TIMEOUT','YouTube 응답을 받지 못했습니다. 자동 재시도는 하지 않았습니다.'); }
    quota[resource === 'search' ? 'searchCalls':'readCalls']++;
    let data;
    try { data = await response.json(); } catch { fail(502,'YOUTUBE_INVALID_RESPONSE','YouTube 응답을 해석하지 못했습니다.'); }
    if (!response.ok) {
      const reasons = (data?.error?.errors || []).map(e=>e.reason);
      if (response.status===429 || reasons.some(r=>['quotaExceeded','dailyLimitExceeded','rateLimitExceeded'].includes(r))) fail(429,'YOUTUBE_QUOTA','YouTube 검색 한도에 도달했습니다. 프로젝트 할당량을 확인하세요.');
      fail(502,'YOUTUBE_UNAVAILABLE','YouTube 검색이 거절되었습니다. API 설정을 확인하세요.');
    }
    if (!data || !Array.isArray(data.items)) fail(502,'YOUTUBE_INVALID_RESPONSE','YouTube 결과 형식이 올바르지 않습니다.');
    return data;
  }
  const candidates = new Map();
  let unavailableChannels=0;
  const searches=plan.queries.map(query=>({query,pageToken:null,done:false,seen:new Set()}));
  for(let turn=0;turn<DISCOVERY_LIMITS.searchCalls&&candidates.size<DISCOVERY_LIMITS.candidates;turn++){
    const search=searches.filter(s=>!s.done)[turn % searches.filter(s=>!s.done).length];
    if(!search)break;
    const query=search.query;
    const data=await request('search',{part:'snippet',type:'video',q:query,maxResults:50,relevanceLanguage:'ko',safeSearch:'strict',publishedAfter:new Date(now()-180*86400000).toISOString(),...(search.pageToken?{pageToken:search.pageToken}:{})});
    const token=typeof data.nextPageToken==='string'&&data.nextPageToken.length<=512?data.nextPageToken:null;
    search.done=!token||search.seen.has(token);if(token)search.seen.add(token);search.pageToken=token;
    for (const item of data.items.slice(0,50)) {
      const c = item?.snippet?.channelId, v=item?.id?.videoId;
      if (!channelIdValid(c) || !videoIdValid(v) || (!candidates.has(c)&&candidates.size>=DISCOVERY_LIMITS.candidates)) continue;
      if (!candidates.has(c)) candidates.set(c, {channelId:c,title:publicText(item.snippet.channelTitle,150),description:'',url:'https://www.youtube.com/channel/'+c,matchedQueries:[],videos:[],reviewRequired:['콘텐츠·논란·광고 이력과 타깃 적합성을 직접 확인하세요.','클린 크리에이터 여부·시청자 연령·협업 가능성은 검증하지 않았습니다.']});
      const candidate=candidates.get(c);
      if(!candidate.matchedQueries.includes(query))candidate.matchedQueries.push(query);
      if (!candidate.videos.some(row=>row.videoId===v) && candidate.videos.length<3) candidate.videos.push({videoId:v,title:publicText(item.snippet.title,200),url:'https://www.youtube.com/watch?v='+v,descriptionPreview:publicText(item.snippet.description,320),publishedAt:typeof item.snippet.publishedAt==='string'&&Number.isFinite(Date.parse(item.snippet.publishedAt))?item.snippet.publishedAt:null});
    }
  }
  if (candidates.size) {
    const channels=[];const channelIds=[...candidates.keys()];
    for(let i=0;i<channelIds.length;i+=50)channels.push(...(await request('channels',{part:'snippet,statistics,contentDetails',id:channelIds.slice(i,i+50).join(','),maxResults:50})).items);
    const visible = new Set();
    for (const item of channels) if (item && candidates.has(item.id)) {
      visible.add(item.id);
      Object.assign(candidates.get(item.id), {title:publicText(item.snippet?.title,150)||candidates.get(item.id).title,description:publicText(item.snippet?.description), subscriberCount:item.statistics?.hiddenSubscriberCount ? null : publicCount(item.statistics?.subscriberCount), subscribersHidden:Boolean(item.statistics?.hiddenSubscriberCount), uploadsPlaylistId:/^UU[A-Za-z0-9_-]{22}$/.test(item.contentDetails?.relatedPlaylists?.uploads||'')?item.contentDetails.relatedPlaylists.uploads:null});
    }
    for (const id of candidates.keys()) if (!visible.has(id)) {candidates.delete(id);unavailableChannels++;}
  }
  // Fetch latest uploads, not keyword-matched old videos. Bounded concurrency and no retries.
  const queue=[...candidates.values()];let recentFailure=null;
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
    while(queue.length&&!recentFailure){const c=queue.shift();c.recentVideos=[];c.recentStatus='unavailable';
      if(!c.uploadsPlaylistId)continue;
      try{
        const {items}=await request('playlistItems',{part:'contentDetails',playlistId:c.uploadsPlaylistId,maxResults:5});
        c.recentIds=items.slice(0,5).map(i=>i?.contentDetails?.videoId).filter(videoIdValid);c.recentStatus='loaded';
      }catch(error){recentFailure=recentFailure||error;}
    }
  }));
  if(recentFailure&&recentFailure.code!=='YOUTUBE_TIMEOUT')throw recentFailure;
  const ids=[...new Set([...candidates.values()].flatMap(c=>c.recentIds||[]))];const videos=new Map();
  for(let i=0;i<ids.length;i+=50){
    let items;
    try{({items}=await request('videos',{part:'snippet,statistics,contentDetails',id:ids.slice(i,i+50).join(','),maxResults:50}));}
    catch(error){if(error.code!=='YOUTUBE_TIMEOUT')throw error;recentFailure=error;break;}
    for(const v of items)if(videoIdValid(v?.id)&&ids.includes(v.id))videos.set(v.id,v);
  }
  for(const c of candidates.values()){
    c.recentVideos=(c.recentIds||[]).map(id=>videos.get(id)).filter(v=>v?.snippet?.channelId===c.channelId).map(v=>({videoId:v.id,title:publicText(v.snippet.title,200),url:'https://www.youtube.com/watch?v='+v.id,publishedAt:Number.isFinite(Date.parse(v.snippet.publishedAt))?v.snippet.publishedAt:null,viewCount:publicCount(v.statistics?.viewCount),duration:v.contentDetails?.duration||null}));
    if(!c.recentVideos.length)c.recentStatus='unavailable';
    delete c.recentIds;delete c.uploadsPlaylistId;
  }
  const channels=[...candidates.values()].map(c=>{const annotated=annotateCandidate(c,plan.criteria);return {...annotated,mukbangReview:mukbangReview(annotated,now())};});
  let accepted=0;for(const c of channels){c.discoveryTarget=c.mukbangReview.reasons.length===0&&accepted<50;if(c.discoveryTarget)accepted++;}
  const summary={target:50,targetCandidates:accepted,reviewCandidates:channels.length-accepted,examined:channels.length,searchLimit:4,candidateLimit:100};
  return {...plan,channels,summary,observedAt:new Date(now()).toISOString(),quota,warnings:[...(recentFailure?['조회 시간 제한으로 일부 최근 영상 근거를 확인하지 못했습니다. 확인된 채널만 표시하며 미확인 후보는 추가 검토로 남겼습니다. 자동 재시도하지 않았습니다.']:[]),...(unavailableChannels?[`채널 상세 조회 미확인 ${unavailableChannels}개는 후보 정보로 표시하지 못했습니다.`]:[]),...(accepted<50?[`목표 50개 중 공개 구독자 3만 이상·최근 먹방 표현 조건을 확인한 후보 ${accepted}개입니다. 나머지는 부족하며 미확인·조건 미충족 후보는 별도 검토로 남겼습니다. 제한된 검색이므로 50개를 보장하지 않습니다.`]:[]),'최대 100개 채널을 확인합니다. 최근 180일 검색과 최근 업로드 5개의 먹방 제목 표현은 사람 중심 여부나 주력 분야를 검증하지 않습니다.','YouTube 키워드 검색 결과이며 추천 순위·적합도 점수가 아닙니다. 전체 채널을 빠짐없이 검색하지 않습니다.','고정댓글 여부는 공식 API로 확인할 수 없습니다. 이메일 자동 수집은 제공하지 않습니다.','협업 문의용 공개 주소 또는 제공받은 연락처를 원문·용도와 함께 직접 확인하세요. 공개라는 이유만으로 대량 수집·무차별 발송하지 않습니다.','검색 결과와 초안은 이 화면에서만 유지되며 새로고침·로그아웃 시 지워집니다.']};
}
