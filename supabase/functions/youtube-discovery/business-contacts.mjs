import {DiscoveryError,channelIdValid} from './discovery.mjs';

// No production source currently has verified automated-access permission.
// Add exact pages only after reviewing current access rules AND creator affiliation.
// Never populate this registry from request bodies, search snippets or page instructions.
export const REVIEWED_BUSINESS_SOURCES = Object.freeze([]);
export const MANUAL_BUSINESS_SOURCES = Object.freeze([
  {name:'TreasureHunter',url:'https://www.treasurehunter.co.kr/en/contact',purpose:'캠페인·크리에이터 매칭 문의',status:'manual_only'},
  {name:'SANDBOX',url:'https://www.sandbox.co.kr/business-inquiry',purpose:'사업·제휴 문의',status:'manual_only'},
  {name:'LEFERI',url:'https://www.leferi.com/ko/contact',purpose:'비즈니스 협업 문의',status:'manual_only'},
]);
const fail=(status,code,message)=>{throw new DiscoveryError(status,code,message);};
const forbidden=/(^|\.)(?:youtube\.com|youtu\.be|google\.com|googleapis\.com|googleusercontent\.com|localhost|local|internal)$/i;
export function officialSourceUrl(value) {
  let u;try {u=new URL(value);}catch {fail(400,'INVALID_SOURCE','공식 사이트의 HTTPS 출처 주소를 확인하세요.');}
  if(typeof value!=='string'||value.length>1000||u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||forbidden.test(u.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)) fail(400,'INVALID_SOURCE','YouTube 이외의 공식 사이트 HTTPS 주소를 입력하세요. 쿼리·로그인 정보·내부 주소는 허용하지 않습니다.');
  return u.href;
}
export function validateBusinessRequest(body) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['channelId','sourceUrl'].includes(k))||!channelIdValid(body.channelId)) fail(400,'INVALID_CONTACT_REQUEST','선택한 채널과 공식 출처를 확인하세요.');
  return {channelId:body.channelId,sourceUrl:officialSourceUrl(body.sourceUrl)};
}
const within=(value,now)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<=7*86400000;
function reviewed(entry,body,now) {
  if(!entry||entry.sourceUrl!==body.sourceUrl||!Array.isArray(entry.channelIds)||!entry.channelIds.includes(body.channelId)||entry.accessDecision!=='approved'||entry.affiliationVerified!==true||!within(entry.accessReviewedAt,now)||!within(entry.affiliationReviewedAt,now))return false;
  if(!entry.robotsEvidence?.trim()||!entry.termsEvidence?.trim()||!entry.affiliationExcerpt?.trim()||!entry.agencyName?.trim()||!Array.isArray(entry.emailDomains)||!entry.emailDomains.length)return false;
  try {const origin=new URL(body.sourceUrl).origin;return [entry.robotsUrl,entry.termsUrl,entry.affiliationUrl].every(url=>new URL(officialSourceUrl(url)).origin===origin);}catch{return false;}
}
const business=/사업\s*[·/ㆍ]?\s*제휴|사업|제휴|협업|광고\s*문의|비즈니스|비지니스|캠페인|business|partnership|commercial|advertis|campaign/i;
const unrelated=/개인정보|개인\s*연락|채용|입사|고객\s*(?:센터|지원)|고객문의|팬\s*레터|팬\s*메일|privacy|personal|recruit|career|support|customer|fan\s*mail|data\s*protection/i;
const hasPurpose=value=>business.test(value.replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,''));
const role=/^(?:biz|business|partnerships?|commercial|advertising|advertise|ads|campaigns?|collabs?|collaboration|sponsorships?)$/i;
export function extractBusinessCandidates(html, entry, checkedAt) {
  if(typeof html!=='string'||html.length>262144)return [];
  // Fail closed on complex/hidden presentation until a reviewed DOM-rendering extractor exists.
  // No currently approved live sources rely on this intentionally narrow parser.
  if(/<(?:script|style|noscript|template|svg|form|textarea|input|select|iframe|object|link)\b|\b(?:hidden|aria-hidden|style|class|id)\s*(?:=|>)/i.test(html))return [];
  const visible=html.replace(/<[^>]*>/g,' ');
  // A mixed privacy/support section or negated business invitation is not a prospect source.
  if(unrelated.test(visible)||/not\s+(?:for\s+)?(?:business|commercial|advertis)|no\s+(?:business|commercial|advertis)|(?:협업|광고|사업|제휴).{0,30}(?:거절|금지|받지|불가|아닙|아님|제외)/i.test(visible))return [];
  // Conservative visible-text extraction. No scripts, forms, hidden emails or mailto inference.
  const lines=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<[^>]*\b(?:hidden|aria-hidden\s*=\s*["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').split(/\r?\n/).map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean);
  const candidates=[],seen=new Set();
  for(let i=0;i<lines.length;i++){
    const line=lines[i],context=hasPurpose(line)?line:lines[i-1]&&hasPurpose(lines[i-1])?lines[i-1]+' '+line:line;
    if(context.length>600||!hasPurpose(context)||unrelated.test(context))continue;
    for(const hit of line.matchAll(/\b([a-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([a-z0-9.-]+\.[a-z]{2,})\b/gi)){
      const email=hit[0].toLowerCase(),domain=hit[2].toLowerCase();
      if(!role.test(hit[1])||!entry.emailDomains.includes(domain)||seen.has(email))continue;
      seen.add(email);candidates.push({email,sourceUrl:entry.sourceUrl,purpose:context,observedAt:checkedAt,recipientType:'agency_business_inbox',agencyName:entry.agencyName,affiliation:{url:entry.affiliationUrl,excerpt:entry.affiliationExcerpt,reviewedAt:entry.affiliationReviewedAt},reviewRequired:true});
    }
  }
  return candidates.slice(0,3);
}
export async function businessContacts(body,{sources=REVIEWED_BUSINESS_SOURCES,fetchImpl=fetch,now=()=>Date.now()}={}){
  const input=validateBusinessRequest(body),at=now();
  const entry=sources.find(value=>reviewed(value,input,at));
  if(!entry)return {status:'manual_required',sourceUrl:input.sourceUrl,candidates:[],reason:'이 페이지의 자동접근 정책과 해당 채널 소속을 모두 확인하지 못했습니다. 자동 조회하지 않았습니다. 원문에서 직접 확인하세요.'};
  let response;try {response=await fetchImpl(entry.sourceUrl,{method:'GET',redirect:'error',headers:{Accept:'text/html','User-Agent':'SanjiBusinessContactReview/1.0'},signal:AbortSignal.timeout(8000)});}catch {return {status:'manual_required',sourceUrl:input.sourceUrl,candidates:[],reason:'접근이 차단되었거나 응답하지 않았습니다. 다른 경로나 재시도로 우회하지 않았습니다.'};}
  if(!response.ok||response.redirected||(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()!=='text/html'){await response.body?.cancel();return {status:'manual_required',sourceUrl:input.sourceUrl,candidates:[],reason:'허용된 공개 HTML 페이지를 확인하지 못했습니다. 자동 조회를 중단했습니다.'};}
  const reader=response.body?.getReader(),decoder=new TextDecoder();let bytes=0,html='';
  if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144){await reader.cancel();fail(413,'SOURCE_TOO_LARGE','페이지가 허용 크기를 초과하여 분석하지 않았습니다.');}html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}finally{reader.releaseLock();}
  if(/captcha|unusual traffic|access denied|보안\s*확인|자동\s*접근.{0,20}(?:금지|차단)/i.test(html))return {status:'manual_required',sourceUrl:input.sourceUrl,candidates:[],reason:'접근 확인 또는 차단 안내가 있어 분석하지 않았습니다.'};
  return {status:'review_required',sourceUrl:entry.sourceUrl,candidates:extractBusinessCandidates(html,entry,new Date(at).toISOString()),reason:'공식 사이트에 명시된 업무용 후보입니다. 소속·게시 목적·수신자를 확인한 뒤 초안에 사용하세요. 자동 발송하지 않습니다.'};
}
