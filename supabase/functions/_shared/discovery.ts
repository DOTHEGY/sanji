const marketHosts = ["coupang.com","naver.com","smartstore.naver.com","gmarket.co.kr","11st.co.kr","auction.co.kr","lotteon.com","ssg.com","tmon.co.kr","wemakeprice.com","danawa.com","cafe24.com"];
export const companyIdentity = (v: string) => v.normalize("NFKC").toLowerCase().replace(/주식회사|\(주\)|㈜|[\s.,·()_-]/g, "");
export function publicUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes(".") || /^\d+(?:\.\d+){3}$/.test(u.hostname) || /(^|\.)(localhost|local|internal|invalid|test|example|arpa)$/.test(u.hostname)) throw Error("공개 HTTPS 홈페이지 주소만 입력하세요.");
  u.hash=""; return u;
}
export function marketplace(value: string) {
  try { const h = new URL(value).hostname; return marketHosts.some(d=>h===d || h.endsWith("."+d)); } catch { return false; }
}
export function publicIp(ip: string) {
  if (ip.includes(":")) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:0?db8:/i.test(ip) && !/^2002:/i.test(ip);
  const a=ip.split(".").map(Number);
  return a.length===4 && a.every(n=>Number.isInteger(n)&&n>=0&&n<=255) && ![0,10,127].includes(a[0]) && a[0]<224 && !(a[0]===169&&a[1]===254) && !(a[0]===172&&a[1]>=16&&a[1]<=31) && !(a[0]===192&&(a[1]===168||(a[1]===0&&[0,2].includes(a[2])))) && !(a[0]===198&&[18,19,51].includes(a[1])) && !(a[0]===203&&a[1]===0&&a[2]===113) && !(a[0]===100&&a[1]>=64&&a[1]<=127);
}
export function plainHtml(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g," ").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();
}
export function parseOfficialPage(html: string, source: string, checked: string) {
  const text=plainHtml(html), host=publicUrl(source).hostname.replace(/^www\./,"");
  const emails=Array.from(new Set([...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]),...Array.from(html.matchAll(/href=["']mailto:([^?"']+)/gi),m=>m[1])])).slice(0,30);
  const contacts:any[]=[], rejected:any[]=[];
  for(const email of emails){
    const at=text.indexOf(email), context=at<0?"":text.slice(Math.max(0,at-100),at+email.length+100);
    const domain=email.split("@")[1]?.toLowerCase(), ownerMatch=domain===host || (host.endsWith("."+domain) || domain.endsWith("."+host));
    const unrelated=/^(user|example|test|sample|noreply|no-reply|privacy|hr|recruit)@/i.test(email) || /개인정보(?:보호책임|관리|담당|\s*문의)|정보보호(?:책임|담당)|채용|인사담당/.test(context);
    const platformMail=/@(coupang\.com|navercorp\.com|cafe24\.com|cafe24corp\.com|gmarket\.co\.kr)$/i.test(email) && !ownerMatch;
    if(unrelated || platformMail) {
      rejected.push({email,reason:unrelated?"예시·수신불가·개인정보·채용 용도":"플랫폼 운영사 이메일이며 제안 대상 회사와 다름",source}); continue;
    }
    const purpose=/제휴|입점|도매|공동구매|영업|파트너|b2b|business|partnership/i.test(context)?"사업 제휴":/고객센터|고객문의|customer|support/i.test(context)||/^(cs|help|support)@/i.test(email)?"고객센터":"대표·일반 문의 / 세부 용도 미확인";
    contacts.push({email,source,checked,purpose,context,domainMatch:ownerMatch,ownership:ownerMatch?"도메인 일치 · 법인 확인 필요":"회사 소유 관계 확인 필요",verified:false});
  }
  const links=Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)).map(m=>{
    try { return {url:publicUrl(new URL(m[1],source).toString()).toString(),label:plainHtml(m[2])}; }catch{return null;}
  }).filter((a:any)=>a && /제휴|입점|도매|공동구매|문의|contact|partner|business|회사소개|about/i.test(a.label));
  return {contacts,rejected,links,text:text.slice(-8000)};
}
export function shoppingProspects(items: any[], keyword: string, checked: string) {
  const found=new Map();
  for(const item of items) {
    const brand=plainHtml(String(item.brand||"")), maker=plainHtml(String(item.maker||""));
    const name=brand || maker;
    if(!name || name.length<2 || /쿠팡|네이버|스마트스토어|해외직구|상세참조|상세설명|상품상세|기타|알수없음|없음/.test(name))continue;
    const identity=companyIdentity(name); if(found.has(identity))continue;
    let source="";try{source=publicUrl(String(item.link||"")).toString();}catch{}
    found.set(identity,{identity,name,company:"",manufacturerClaim:maker,brandClaim:brand,product:plainHtml(String(item.title||"")),source,channel:item.mallName||"네이버 상품검색",keyword,checked,classification:"미확인",authority:"미확인",officialVerified:false});
  }
  return Array.from(found.values());
}
export function robotsAllowed(robots: string, path: string) {
  let active=false; const rules:string[]=[];
  for(const raw of robots.split(/\r?\n/)) {
    const line=raw.replace(/#.*/,"").trim();
    if(/^user-agent:/i.test(line)) active=/^user-agent:\s*\*\s*$/i.test(line);
    else if(active && /^disallow:/i.test(line)){const value=line.replace(/^disallow:\s*/i,"").trim();if(value)rules.push(value);}
  }
  return !rules.some(rule=>new RegExp("^"+rule.split("*").map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*").replace(/\\\$$/,"$")).test(path));
}
