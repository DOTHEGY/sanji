import { decodeHtml, plainHtml, publicUrl, marketplace } from "./discovery.ts";

const excluded=/(^|\.)(google\.[a-z.]+|naver\.com|navercorp\.com|bing\.com|duckduckgo\.com|youtube\.com|instagram\.com|facebook\.com|coupang\.com|daum\.net|tistory\.com|wikipedia\.org|wikidata\.org|microsoft\.com)$/i;
export const searchTopics=["건강기능식품 유산균", "건강식품 효소", "단백질 프로틴", "올리브오일", "홍삼", "비타민", "콜라겐", "오메가3", "루테인", "견과", "디카페인 커피", "건강즙", "식이섬유", "곡물 선식", "밀크씨슬", "마그네슘", "프로폴리스", "발효식품", "차 건강식품", "이너뷰티", "산양유", "양배추즙", "알부민", "프리바이오틱스"];
export const searchEngines=["Google","Naver","Bing","DuckDuckGo"];
export function searchQuery(cursor:number,keywords:string[]=[]){
 const topics=keywords.length?Array.from(new Set([...keywords,...searchTopics])):searchTopics;
 const variants=[" 공식몰"," 브랜드 공식몰 이메일"," 제조사 홈페이지"," 식품 회사소개"," 도매 공급 공식 홈페이지"," 고객센터 이메일"];
 const dayIndex=Math.floor((Date.now()+9*3600000)/86400000);
 return topics[cursor%topics.length]+variants[(dayIndex+Math.floor(cursor/topics.length))%variants.length];
}
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
 if(excluded.test(u.hostname)||marketplace(u.toString())||/\.(go\.kr|gov|edu|ac\.kr)$/.test(u.hostname))throw Error("목록·플랫폼 제외");
 return u;
}
export function searchResults(html:string,source:string,query:string){
 if(/unusual traffic|anomaly-modal|<title[^>]*>[^<]*(?:captcha|보안 확인|자동입력)|id=["'](?:captcha|challenge-form)["']/i.test(html))throw Error("검색 제공자 보안 확인 · 우회하지 않음");
 const rows:any[]=[],hosts=new Set<string>();
 const add=(href:string,title:string)=>{try{
  const u=destination(href,source),host=u.hostname.replace(/^www\./,"");
  const text=plainHtml(title).replace(/새\s*창\s*열림/g,"").replace(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/gi,"").replace(/›.*$/,"").replace(/\s+/g," ").trim();
  if(text.length<2||hosts.has(host)||/개인정보|이용약관|로그인|회원가입|뉴스|신문|블로그|리뷰|후기|백과|채용/.test(text))return;
  const name=text.split(/\s+[|｜–—]\s+|\s+-\s+/)[0].replace(/공식\s*(쇼핑몰|홈페이지|온라인몰|스토어|사이트|몰)|홈페이지|바로가기/g,"").trim().slice(0,100);
  if(name.length<2)return;hosts.add(host);
  rows.push({name,website:u.origin+"/",source,searchResultUrl:u.toString(),searchQuery:query,industry:"food candidate"});
 }catch{}};
 for(const m of html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(m[1])?.[1]||"";
  const link=/<link[^>]*>([\s\S]*?)<\/link>/i.exec(m[1])?.[1]||"";
  add(link.replace(/<!\[CDATA\[|\]\]>/g,""),title.replace(/<!\[CDATA\[|\]\]>/g,""));
 }
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(m[1],m[2]);
 return rows.slice(0,15);
}
