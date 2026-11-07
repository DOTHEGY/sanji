import { decodeHtml, plainHtml, publicUrl, marketplace } from "./discovery.ts";

const excluded=/(^|\.)(google\.[a-z.]+|naver\.com|navercorp\.com|bing\.com|duckduckgo\.com|youtube\.com|instagram\.com|facebook\.com|coupang\.com|daum\.net|tistory\.com|wikipedia\.org|wikidata\.org|microsoft\.com)$/i;
export const searchTopics=["건강기능식품 유산균", "건강식품 효소", "단백질 프로틴", "올리브오일", "홍삼", "비타민", "콜라겐", "오메가3", "루테인", "견과", "디카페인 커피", "건강즙", "식이섬유", "곡물 선식", "밀크씨슬", "마그네슘", "프로폴리스", "발효식품", "차 건강식품", "이너뷰티", "산양유", "양배추즙", "알부민", "프리바이오틱스"];
export const searchEngines=["Google","Naver","Bing","DuckDuckGo"];
// Stable, explicit food subcategories broaden supply without more requests or paid providers.
// Exhaust every topic/variant pair before repeating. The persisted cursor, not the date,
// determines the query so a new day cannot silently restart the same search window.
export const searchSubtopics=["저당 식품", "무설탕 간식", "글루텐프리 식품", "비건 식품", "식물성 단백질", "단백질바", "단백질 쉐이크", "그릭요거트", "발효유", "두유", "귀리 음료", "저염 식품", "현미 누룽지", "통곡물 시리얼", "오트밀", "그래놀라", "견과 버터", "건과일", "동결건조 과일", "과채 주스", "석류즙", "배도라지즙", "아로니아", "타트체리", "흑마늘", "생강청", "꿀 식품", "흑염소 진액", "들기름", "참기름", "아보카도오일", "발사믹 식초", "발효 식초", "콤부차", "보리차", "루이보스차", "작두콩차", "레몬즙", "비타민D", "비타민C", "아연 영양제", "칼슘 영양제", "철분 영양제", "엽산 영양제", "코엔자임Q10", "글루코사민", "차전자피", "포스트바이오틱스"];
export const searchVariants=[" 공식몰", " 브랜드 공식몰 이메일", " 제조사 홈페이지", " 식품 회사소개", " 도매 공급 공식 홈페이지", " 고객센터 이메일"];
export const searchPlanVersion="food-topics-v2";
export function searchPlan(cursor:number,keywords:string[]=[]){
 if(!Number.isSafeInteger(cursor)||cursor<0)throw Error("유효하지 않은 검색 순번");
 const topics=Array.from(new Set([...keywords,...searchTopics,...searchSubtopics].map(x=>x.trim()).filter(Boolean)));
 const topic=topics[cursor%topics.length],variant=searchVariants[Math.floor(cursor/topics.length)%searchVariants.length];
 return {query:topic+variant,cursor,version:searchPlanVersion,topic,variant,cycle:Math.floor(cursor/(topics.length*searchVariants.length))};
}
export function searchQuery(cursor:number,keywords:string[]=[]){return searchPlan(cursor,keywords).query;}
export type DiscoverySourceAudit={input?:number;accepted?:number;rejected?:Record<string,number>};
export function resetSourceAudit(audit:DiscoverySourceAudit){audit.input=0;audit.accepted=0;audit.rejected={};}
export function rejectSource(audit:DiscoverySourceAudit,reason:string){audit.rejected![reason]=(audit.rejected![reason]||0)+1;}
export function searchUrl(engine:string,q:string){
 if(engine==="Google")return "https://www.google.com/search?"+new URLSearchParams({q,hl:"ko",num:"10"});
 if(engine==="Naver")return "https://search.naver.com/search.naver?"+new URLSearchParams({query:q,where:"webkr"});
 if(engine==="Bing")return "https://www.bing.com/search?"+new URLSearchParams({q,format:"rss",setlang:"ko"});
 return "https://html.duckduckgo.com/html/?"+new URLSearchParams({q,kl:"kr-kr"});
}
function destination(raw:string,source:string){
 let u=new URL(decodeHtml(raw),source);
 if(/(^|\.)google\./.test(u.hostname)&&u.pathname==="/url")u=new URL(u.searchParams.get("q")||u.searchParams.get("url")||"");
 if(/(^|\.)duckduckgo\.com$/.test(u.hostname)&&u.searchParams.has("uddg"))u=new URL(u.searchParams.get("uddg")!);
 // Search engines only supply links; emails must subsequently be found on the destination site.
 u=publicUrl(u.toString());
 if(excluded.test(u.hostname)||marketplace(u.toString())||/\.(go\.kr|gov|edu|ac\.kr)$/.test(u.hostname))throw Error("excluded_destination");
 return u;
}
export function searchResults(html:string,source:string,query:string,audit:DiscoverySourceAudit={}){
 resetSourceAudit(audit);
 if(/unusual traffic|anomaly-modal|<title[^>]*>[^<]*(?:captcha|보안 확인|자동입력)|id=["'](?:captcha|challenge-form)["']/i.test(html))throw Error("검색 제공자 보안 확인 · 우회하지 않음");
 const rows:any[]=[],hosts=new Set<string>();
 const add=(href:string,title:string)=>{audit.input!++;try{
  const u=destination(href,source),host=u.hostname.replace(/^www\./,"");
  const text=plainHtml(title).replace(/새\s*창\s*열림/g,"").replace(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/gi,"").replace(/›.*$/,"").replace(/\s+/g," ").trim();
  if(text.length<2){rejectSource(audit,"empty_title");return;}
  if(hosts.has(host)){rejectSource(audit,"duplicate_host");return;}
  if(/개인정보|이용약관|로그인|회원가입|뉴스|신문|블로그|리뷰|후기|백과|채용/.test(text)){rejectSource(audit,"non_company_title");return;}
  const name=text.split(/\s+[|｜–—]\s+|\s+-\s+/)[0].replace(/공식\s*(쇼핑몰|홈페이지|온라인몰|스토어|사이트|몰)|홈페이지|바로가기/g,"").trim().slice(0,100);
  if(name.length<2){rejectSource(audit,"empty_name");return;}hosts.add(host);
  if(rows.length>=15){rejectSource(audit,"result_cap");return;}
  rows.push({name,website:u.origin+"/",source,searchResultUrl:u.toString(),searchQuery:query,industry:"food candidate"});
 }catch(e){rejectSource(audit,e instanceof Error&&e.message==="excluded_destination"?"excluded_destination":"invalid_destination");}};
 for(const m of html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(m[1])?.[1]||"";
  const link=/<link[^>]*>([\s\S]*?)<\/link>/i.exec(m[1])?.[1]||"";
  add(link.replace(/<!\[CDATA\[|\]\]>/g,""),title.replace(/<!\[CDATA\[|\]\]>/g,""));
 }
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(m[1],m[2]);
 audit.accepted=rows.length;
 return rows;
}
