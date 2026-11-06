// Official API only. No scraping, contact harvesting, profiling scores or sending.
export class DiscoveryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new DiscoveryError(status, code, message); };
export const channelIdValid = value => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value);
const videoIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export function publicText(value, max = 600) {
  // Mask conventional email strings in descriptive prose; this is not a PII classifier.
  return String(value || '').replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[연락처 표시 안 함]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,max);
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
  } else {
    // Preserve topic modifiers (e.g. 비건, 커피); never replace them with unrelated examples.
    const topic = brief.replace(/찾아\s*줘|찾기|크리에이터|유튜버|협업|런칭|출시|필요한|적합한/g,' ').replace(/\s+/g,' ').trim();
    queries = [(topic || brief).slice(0,100)];
  }
  return {brief, queries:[...new Set(queries)]};
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
    return data.items;
  }
  const candidates = new Map();
  for (const query of plan.queries) {
    const items = await request('search',{part:'snippet',type:'video',q:query,maxResults:10,relevanceLanguage:'ko',safeSearch:'strict'});
    for (const item of items) {
      const c = item?.snippet?.channelId, v=item?.id?.videoId;
      if (!channelIdValid(c) || !videoIdValid(v)) continue;
      if (!candidates.has(c)) candidates.set(c, {channelId:c,title:publicText(item.snippet.channelTitle,150),description:'',url:'https://www.youtube.com/channel/'+c,videos:[],reviewRequired:['콘텐츠·논란·광고 이력과 타깃 적합성을 직접 확인하세요.','클린 크리에이터 여부·시청자 연령·협업 가능성은 검증하지 않았습니다.']});
      const candidate=candidates.get(c);
      if (!candidate.videos.some(row=>row.videoId===v) && candidate.videos.length<3) candidate.videos.push({videoId:v,title:publicText(item.snippet.title,200),url:'https://www.youtube.com/watch?v='+v});
    }
  }
  if (candidates.size) {
    const channels = await request('channels',{part:'snippet',id:[...candidates.keys()].join(','),maxResults:50});
    const visible = new Set();
    for (const item of channels) if (item && candidates.has(item.id)) {
      visible.add(item.id);
      Object.assign(candidates.get(item.id), {title:publicText(item.snippet?.title,150),description:publicText(item.snippet?.description)});
    }
    for (const id of candidates.keys()) if (!visible.has(id)) candidates.delete(id);
  }
  return {...plan,channels:[...candidates.values()],observedAt:new Date(now()).toISOString(),quota,warnings:['YouTube 키워드 검색 결과이며 추천 순위·적합도 점수가 아닙니다. 전체 채널을 빠짐없이 검색하지 않습니다.','고정댓글 여부는 공식 API로 확인할 수 없습니다. 이메일 자동 수집은 제공하지 않습니다.','협업 문의용 공개 주소 또는 제공받은 연락처를 원문·용도와 함께 직접 확인하세요. 공개라는 이유만으로 대량 수집·무차별 발송하지 않습니다.','검색 결과와 초안은 이 화면에서만 유지되며 새로고침·로그아웃 시 지워집니다.']};
}
