const marketHosts = ["coupang.com","naver.com","smartstore.naver.com","gmarket.co.kr","11st.co.kr","auction.co.kr","lotteon.com","ssg.com","tmon.co.kr","wemakeprice.com","danawa.com","cafe24.com"];
export const companyIdentity = (v: string) => v.normalize("NFKC").toLowerCase().replace(/주식회사|\(주\)|㈜|[\s.,·()_-]/g, "");
export function publicUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes(".") || /^\d+(?:\.\d+){3}$/.test(u.hostname) || /(^|\.)(localhost|local|internal|invalid|test|example|arpa)$/.test(u.hostname)) throw Error("공개 HTTPS 홈페이지 주소만 입력하세요.");
  u.hash=""; return u;
}
export function marketplace(value: string) {
  try { const h = new URL(value).hostname; if(h.endsWith(".cafe24.com")&&!/^(www|support|help|hosting|eclogin)\.cafe24\.com$/.test(h))return false; return marketHosts.some(d=>h===d || h.endsWith("."+d)); } catch { return false; }
}
export function publicIp(ip: string) {
  if (ip.includes(":")) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:0?db8:/i.test(ip) && !/^2002:/i.test(ip);
  const a=ip.split(".").map(Number);
  return a.length===4 && a.every(n=>Number.isInteger(n)&&n>=0&&n<=255) && ![0,10,127].includes(a[0]) && a[0]<224 && !(a[0]===169&&a[1]===254) && !(a[0]===172&&a[1]>=16&&a[1]<=31) && !(a[0]===192&&(a[1]===168||(a[1]===0&&[0,2].includes(a[2])))) && !(a[0]===198&&[18,19,51].includes(a[1])) && !(a[0]===203&&a[1]===0&&a[2]===113) && !(a[0]===100&&a[1]>=64&&a[1]<=127);
}
export function decodeHtml(value: string) {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi,(_,n)=>{const point=n[0].toLowerCase()==="x"?parseInt(n.slice(1),16):parseInt(n,10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):"";}).replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&commat;/gi,"@").replace(/&period;/gi,".");
}
export function plainHtml(html: string) {
  return decodeHtml(html.replace(/<!--[\s\S]*?-->/g," ").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
}
function attribute(tag:string,name:string) {
  const match=new RegExp("(?:^|\\s)"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i").exec(tag);
  return match?decodeHtml(match[1]??match[2]??match[3]??""):"";
}
export function parseOfficialPage(html: string, source: string, checked: string) {
  const visible=html.replace(/<!--[\s\S]*?-->/g," ").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ");
  const text=plainHtml(visible),host=publicUrl(source).hostname.replace(/^www\./,"");
  const footerStart=visible.search(/<(?:footer\b|(?:div|section)\b[^>]*(?:id|class)\s*=\s*["'][^"']*footer)/i);
  const footerHtml=footerStart>=0?visible.slice(footerStart):"";
  const footerText=plainHtml(footerHtml);
  const mailto=Array.from(visible.matchAll(/<a\b([^>]*)>/gi),m=>attribute(m[1],"href")).filter(v=>/^mailto:/i.test(v)).map(v=>{try{return decodeURIComponent(v.replace(/^mailto:/i,"").split("?")[0]);}catch{return "";}});
  const emails=Array.from(new Set([...(footerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]),...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]),...mailto])).filter(v=>/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v)).slice(0,30);
  const blocks=visible.replace(/<\/(?:p|li|address|dd|dt|td|div)>|<br\b[^>]*>/gi,"\n").split("\n").map(plainHtml).filter(Boolean);
  const contacts:any[]=[],rejected:any[]=[];
  for(const email of emails){
    const at=text.toLowerCase().indexOf(email.toLowerCase()),context=at<0?"":text.slice(Math.max(0,at-100),at+email.length+100);
    const block=blocks.filter(v=>v.toLowerCase().includes(email.toLowerCase())).sort((a,b)=>a.length-b.length)[0]||email;
    const domain=email.split("@")[1]?.toLowerCase(),ownerMatch=domain===host||host.endsWith("."+domain)||domain.endsWith("."+host);
    const unrelated=/[._-]it@/i.test(email)||/^(user|example|test|sample|noreply|no-reply|privacy|hr|recruit|recruitment|jobs|career|security|dpo|techsupport|webmaster|postmaster|hostmaster|abuse|it)@/i.test(email)||(/개인정보(?:보호책임|관리|담당|\s*문의)|정보보호(?:책임|담당)|채용|인사담당/.test(block)&&!/(고객센터|대표\s*(?:메일|이메일)|제휴\s*(?:문의|메일))/.test(block));
    const platformMail=/@(coupang\.com|navercorp\.com|cafe24\.com|cafe24corp\.com|gmarket\.co\.kr|godo\.co\.kr|godomall\.com|nhn-commerce\.com|nhncommerce\.com|makeshop\.co\.kr|connectwave\.co\.kr|gabia\.com)$/i.test(email);
    if(unrelated||platformMail){rejected.push({email,reason:unrelated?"예시·수신불가·개인정보·채용 용도":"플랫폼 운영사 이메일이며 제안 대상 회사와 다름",source});continue;}
    const purpose=/^(cs[0-9]*|help|support)@/i.test(email)||/고객센터|고객문의|customer|support/i.test(block)?"고객센터":/제휴|입점|도매|공동구매|영업|파트너|b2b|business|partnership/i.test(block)?"사업 제휴":"대표·일반 문의 / 세부 용도 미확인";
    contacts.push({email,source,checked,purpose,context:block.length<500?block:context,location:footerText.includes(email)?"footer":mailto.includes(email)?"mailto":"body",domainMatch:ownerMatch,ownership:ownerMatch?"도메인 일치 · 법인 확인 필요":"회사 소유 관계 확인 필요",verified:false});
  }
  const found:any[]=[];
  for(const m of visible.matchAll(/<(a|option)\b([^>]*)>([\s\S]*?)<\/\1>/gi)){
    const value=attribute(m[2],m[1].toLowerCase()==="option"?"value":"href"),label=plainHtml(m[3]);
    if(!value||/^(javascript:|mailto:|tel:|#)/i.test(value))continue;
    const shop=/공식몰|자사몰|온라인\s*쇼핑몰|온라인몰|브랜드몰|쇼핑몰|공식\s*(?:스토어|샵)|몰(?:$|[)）])/i.test(label);
    const company=/회사\s*소개|기업\s*소개|기업\s*홈페이지|회사\s*홈페이지|공식\s*(?:홈페이지|사이트|웹)|오피셜|official\s*(?:site|website)/i.test(label);
    const contact=/제휴|입점|도매|공동구매|문의|고객센터|고객상담|contact|partner|business|회사\s*소개|about/i.test(label+" "+value);
    if(!shop&&!contact&&!company)continue;
    try{const url=publicUrl(new URL(value,source).toString()).toString();if(!marketplace(url))found.push({url,label,type:shop?"shop":company?"company":"contact",linkedFrom:source});}catch{}
  }
  const links=Array.from(new Map(found.map(l=>[l.url,l])).values());
  const title=plainHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||"");
  const description=Array.from(html.matchAll(/<meta\b([^>]*)>/gi)).map(m=>({name:attribute(m[1],"name")||attribute(m[1],"property"),content:attribute(m[1],"content")})).find(m=>/^(description|og:description)$/i.test(m.name))?.content||"";
  return {contacts,rejected,links,text:text.slice(-8000),publicEvidence:{url:source,title,description:plainHtml(description),excerpt:text.slice(0,5000),checked}};
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
