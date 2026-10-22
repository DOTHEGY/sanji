import { companyIdentity, publicUrl, marketplace, plainHtml, decodeHtml } from "./discovery.ts";
const excludedHosts=/(^|\.)(google|bing|naver|coupang|facebook|instagram|youtube|kakao|twitter|wikimedia|wikipedia|wikidata|w3|adobe|microsoft)\.(com|co\.kr|org|net)$/i;
export function sourceProspects(rows:any[],known:any[],date:string){
 const names=new Set(known.map(l=>companyIdentity(l.identity||l.data?.name||""))),hosts=new Set(known.map(l=>{try{return new URL(l.data?.website).hostname.replace(/^www\./,"");}catch{return "";}}));
 const out:any[]=[];
 for(const r of rows){
  if(/restaurant|foodservice|catering|retail|holding|fast food|brewing|alcohol/i.test(String(r.industry||"")))continue;
  const name=plainHtml(String(r.name||"")).trim().slice(0,150);if(name.length<2||/^Q\d+$/.test(name))continue;
  let url;try{url=publicUrl(String(r.website||"").replace(/^http:/,"https:"));}catch{continue;}
  const host=url.hostname.replace(/^www\./,"");if(marketplace(url.toString())||excludedHosts.test(host)||/\.gov\.|\.go\.kr$/.test(host))continue;
  const aliases:any={"한국야쿠르트":"hy","에이치와이":"hy","sempiofoodscompany":"샘표"};
  const identity=aliases[companyIdentity(name)]||companyIdentity(name);if(names.has(identity)||hosts.has(host))continue;
  names.add(identity);hosts.add(host);
  out.push({identity,data:{name,website:url.toString(),source:r.source,sourceEntity:r.entity||"",channel:"공개 기업 데이터·협회 목록 · 소유 관계 검토 전",company:"",product:"",contacts:[],checked:date,officialVerified:false,classification:"미확인",authority:"미확인",researchNote:"외부 목록에 게시된 식품·건강 관련 업체 후보입니다. 홈페이지·이메일·법인 소유·상품 분류는 원문 확인 후 별도 검토합니다."}});
 }
 return out;
}
export const directoryRoots=["https://www.khff.or.kr/","https://www.kfia.or.kr/","https://seoulfood.or.kr/"];
export function directoryLinks(html:string,source:string){
 const out:any[]=[];
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let url;try{url=publicUrl(new URL(decodeHtml(m[1]),source).toString());}catch{continue;}
  const label=plainHtml(m[2])||/alt=["']([^"']+)/i.exec(m[2])?.[1]||"";
  if(url.origin===new URL(source).origin){if(/회원사|회원업체|참가업체|출품업체|기업목록|회원현황|회원사현황|회원사소개|회원.*(?:현황|소개|안내)|member|affiliation/i.test(label+" "+url.pathname))out.push({directory:true,url:url.toString(),name:label});}
  else if(label.length>=2&&!/개인정보|로그인|이메일|페이스북|유튜브|인스타|관련기관|식약처|식품의약품|홈페이지 제작|copyright|이용약관|한국.*협회/i.test(label)&&!excludedHosts.test(url.hostname))out.push({name:label,website:url.toString(),source});
 }
 return out;
}
// Official, free Wikidata Query Service. No API key, AI call or paid search service.
export const publicCompanyQuery=`SELECT DISTINCT ?company ?companyLabel ?site ?industryName WHERE {
 ?company wdt:P17 wd:Q884; wdt:P856 ?site; wdt:P452 ?industry.
 ?industry rdfs:label ?industryName. FILTER(LANG(?industryName)="en" && REGEX(?industryName,"food|beverage|pharma|nutrition|dairy","i"))
 SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". }
} LIMIT 300`;
