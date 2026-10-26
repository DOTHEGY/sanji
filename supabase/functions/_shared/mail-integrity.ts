import {unsafeContactReason,excludedBusinessSource} from "./contact-safety.ts";
import {companyIdentity} from "./discovery.ts";

const discoveryOnlyHosts=["blog.naver.com","post.naver.com","tistory.com","medium.com","brunch.co.kr"];
const publisherDomains=["pharmnews.com","inthenews.co.kr","foodbank.co.kr","mkhealth.co.kr","4th.kr","medical-tribune.co.kr","k-health.com"];
export function permanentFailureEmails(threads:any[]=[],suppression:any[]=[]){return [...new Set([...suppression.filter(s=>/영구.{0,4}반송|permanent/i.test(s.reason||"")).map(s=>String(s.identity||"").replace(/^email:/,"").toLowerCase()),...threads.flatMap(t=>(t.data||t).messages||[]).flatMap(m=>m.bounceFailures||[]).filter(f=>f.kind==="permanent"&&f.source==="delivery_status"&&/^5\./.test(f.status||"")).map(f=>String(f.email||"").toLowerCase())].filter(e=>e.includes("@")))];}

export function exactEmailIn(text:string,email:string){const escaped=email.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return new RegExp("(?<![a-z0-9._%+-])"+escaped+"(?![a-z0-9.-])","i").test(text);}
export function editorialSource(url:string,pages:any[]=[]){
 try{const u=new URL(url);if([...publisherDomains,...discoveryOnlyHosts].some(h=>u.hostname===h||u.hostname.endsWith("."+h)))return true;
 const p=pages.find(p=>{try{return new URL(p.url).hostname===u.hostname;}catch{return false;}}),text=[p?.title,p?.description,p?.excerpt].join(" ");
 const editorialMarkers=text.match(/발행인|편집인|인터넷신문|언론사고충처리/g)||[];
 return editorialMarkers.length>=2||/NewsArticle|NewsMediaOrganization/.test(p?.sourceType||"")||(/\/news\/article|\/articleView|\/news\/view/i.test(u.pathname)&&/기자|발행인|편집인|인터넷신문|고충처리/.test(text));
 }catch{return true;}
}
export function validBrandName(value:any){const s=String(value||"").trim();return s.length>=2&&s.length<=60&&!/[\n]|…|리뉴얼 출시|라인업 공개|운영 종료|신제품.{0,30}출시|^상품 |최신 뉴스|\d+주 전/.test(s)&&!/(?:신문|저널|경제|뉴스|팜뉴스|매경헬스|메디칼트리뷴|헬스경향)[\s.]*$/.test(s);}
export function realProductName(value:any){const s=String(value||"").trim();return s.length>=3&&s.length<=100&&!/^(?:상품\s*사용후기|상품\s*후기|제품\s*구매|제품구매|전체\s*상품|모든\s*상품|상품\s*목록|상품\s*리스트|제품\s*소개|제품\s*목록|상품\s*문의|상품\s*상세|고객센터|구매\s*후기|사용\s*후기|공지사항|자유게시판|게시판|회원가입|장바구니|로그인|브랜드|쇼핑|Shop|FAQ|Q&A)(?:\s*\(?\d+\)?)?$/i.test(s)&&!/(?:공식몰|쇼핑몰|헬스케어몰|제품군|협의 가능한|리뉴얼 출시|라인업 공개|운영 종료|신제품.{0,30}출시)/.test(s);}
export function productDetailUrl(url:string){try{const u=new URL(url);if(/\/board\/|\/news\/|\/magazine\/|\/category\/|\/(?:product|goods)\/(?:list|index|review)/i.test(u.pathname)||u.searchParams.has("board_no"))return false;return /^\/product\/(?:detail[^/]*|[^/]+\/\d+(?:\/|$))/i.test(u.pathname)&&(/product_no=\d+/.test(u.search)||/\/\d+(?:\/|$)/.test(u.pathname))||/\/(?:vp\/products|products)\/\d+/.test(u.pathname)||/(?:goodsNo|goodsno|goods_no|goodsCd|goodsNo)=\w+/.test(u.search)&&/goods|product/.test(u.pathname);}catch{return false;}}
export function duplicateParagraphs(text:string){const seen=new Set(),duplicates:string[]=[];for(const p of String(text||"").split(/\n\s*\n/)){const key=p.replace(/\s+/g,"").replace(/[.!！。]/g,"");if(key.length<30)continue;if(seen.has(key))duplicates.push(p);seen.add(key);}const requests=String(text||"").match(/저희가 적합한 크리에이터 후보와 채널 자료,?\s*구체적인 진행안을 정리해 제안드리겠습니다[.!]?/g)||[];if(requests.length>1)duplicates.push("크리에이터 후보·채널 자료·진행안 제공 문단 반복");return duplicates;}
export function dedupeProposal(text:string){let seen=new Set<string>();let out=String(text||"").split(/\n\s*\n/).filter(p=>{const key=p.replace(/\s+/g,"").replace(/[.!！。]/g,"");if(key.length<30)return true;if(seen.has(key))return false;seen.add(key);return true;}).join("\n\n");for(const pattern of [/저희가 적합한 크리에이터 후보와 채널 자료,?\s*구체적인 진행안을 정리해 제안드리겠습니다[.!]?/g,/공동구매 담당자분을 편하게 연결해주시면 감사하겠습니다[.!]?/g]){let found=false;out=out.replace(pattern,s=>{if(found)return "";found=true;return s;});}return out.replace(/\n{3,}/g,"\n\n").trim();}
// Trust only successful crawl links/redirects rooted at the selected official site.
export function officialOrigins(d:any){
 const origin=(v:string)=>{try{const u=new URL(v);return u.protocol==="https:"?u.hostname.replace(/^www\./,""):"";}catch{return "";}};
 const trusted=new Set<string>([origin(d.website)].filter(Boolean));
 for(let pass=0;pass<8;pass++){let changed=false;for(const a of d.sourceAttempts||[]){if(a.status!=="checked")continue;const from=[a.requestedUrl,a.linkedFrom,...(a.redirects||[])].map(origin).filter(Boolean);if(!from.some(h=>trusted.has(h)))continue;const dest=origin(a.url);if(dest&&!trusted.has(dest)&&!editorialSource(a.url,d.publicEvidence||[])){trusted.add(dest);changed=true;}}if(!changed)break;}
 return trusted;
}
export function contactResearchState(lead:any,check:any){
 const d=lead.data||lead,attempts=d.sourceAttempts||[];
 if(d.officialRecheckRequested)return {status:"queued",label:"공식 홈페이지 재확인 예약",detail:"서버가 2분 간격으로 기존 후보를 순차 확인합니다. 새 업체 발굴 목표와 별도입니다."};
 if(d.officialRecheck?.status==="running")return {status:"running",label:"공식 홈페이지 재확인 중",detail:"현재 푸터·고객센터·공식 문의 경로를 확인하고 있습니다."};
 if(check.allowed)return {status:"verified",label:"공식 게시 이메일 확인",detail:"공식 사이트에 게시된 이메일과 회사 관계를 확인했습니다."};
 if(!validBrandName(check.brand)||editorialSource(d.website,d.publicEvidence||[]))return {status:"discovery_only",label:"브랜드 공식 사이트 분리 필요",detail:"기사·중간 사이트의 이메일은 제안 대상에 사용하지 않습니다."};
 if((d.contacts||[]).length)return {status:"relationship_review",label:"이메일 있음 · 게시 관계 재확인",detail:check.excluded.flatMap((c:any)=>c.reasons).filter((v:any,i:number,a:any[])=>a.indexOf(v)===i).join(" / ")};
 if(!attempts.length&&!d.publicEvidence?.length)return {status:"not_checked",label:"공식몰 확인 대기",detail:"아직 홈페이지 확인 결과가 없습니다. 이메일이 없다는 의미가 아닙니다."};
 if(!attempts.some((a:any)=>a.status==="checked")&&!d.publicEvidence?.length)return {status:"fetch_failed",label:"홈페이지 접속 실패 · 재확인 필요",detail:attempts.find((a:any)=>a.error)?.error||d.error||"페이지를 확인하지 못했습니다."};
 return {status:"not_found_in_checked_pages",label:"확인한 페이지에서 이메일 미발견",detail:"확인 범위: "+(d.publicEvidence?.length||0)+"페이지. 다른 공식 문의·판매처까지 확인이 필요합니다."};
}
export function assessMailLead(lead:any,permanentFailures:string[]=[]){
 const d=lead?.data||lead||{},o=d.outreach||{},pages=d.publicEvidence||[],brand=o.brandName||d.name||d.company||"",reasons:string[]=[],contacts:any[]=[],excluded:any[]=[];
 if(!validBrandName(brand))reasons.push("검증된 브랜드·회사명 대신 기사 제목·매체명·메뉴가 저장됨");
 if(editorialSource(d.website,pages))reasons.push("기사·언론사·중간 사이트는 발견 출처이며 브랜드 연락처 출처가 아님");
 const scopeReason=excludedBusinessSource(d.website,pages);if(scopeReason)reasons.push(scopeReason);
 const trusted=officialOrigins(d),trustedPages=pages.filter((p:any)=>{try{return trusted.has(new URL(p.url).hostname.replace(/^www\./,""))&&!editorialSource(p.url,pages);}catch{return false;}});
 const identity=companyIdentity(brand),home=trustedPages[0],homeMatches=!!identity&&trustedPages.some((p:any)=>[p.title,p.description].some(v=>companyIdentity(String(v||"")).includes(identity)));
 for(const c of d.contacts||[]){const email=String(c.email||"").toLowerCase(),why:string[]=[];let sameHost=false;try{const source=new URL(c.source),site=new URL(d.website),sh=source.hostname.replace(/^www\./,""),h=site.hostname.replace(/^www\./,"");sameHost=source.protocol==="https:"&&(trusted.has(sh)||sh===h||(sh.endsWith("."+h)&&c.linkedFrom&&new URL(c.linkedFrom).hostname.replace(/^www\./,"")===h));}catch{}
 const unsafe=unsafeContactReason(email,c.context||"");if(unsafe)why.push(unsafe);
 if(c.excluded||c.excludeFromOutreach)why.push("이미 제외된 주소");
 if(permanentFailures.includes(email))why.push("사용자 확인 영구 반송 주소 · 주소 단위 제외");
 if(editorialSource(c.source,pages))why.push("언론사·기자·중간 사이트 연락처");
 if(/^(?:privacy|recruit|career|jobs|dpo|postmaster|noreply)(?:[._-]|$)/i.test(email.split('@')[0])||(/개인정보.{0,10}(?:담당|책임|관리)|고충처리|기자\s*(?:메일|이메일)|취재\s*문의|보도자료\s*(?:문의|접수)/.test(c.context||"")&&!/고객센터|대표\s*(?:메일|이메일)|제휴\s*(?:메일|문의)/.test(c.context||"")))why.push("개인정보·언론 전용 등 영업과 무관한 용도");
 const page=pages.find((p:any)=>p.url===c.source),posted=!!page&&exactEmailIn([c.context,page.excerpt].filter(Boolean).join(" "),email);
 if(!Number.isFinite(Date.parse(c.checked||""))||Date.parse(c.checked)<Date.now()-30*86400000)why.push("연락처 원문 확인일 미기록·30일 경과 · 캐시 재확인 필요");
 if(!sameHost||!homeMatches||!posted)why.push("공식 브랜드 사이트의 회사–이메일 게시 관계 확인 필요");
 if(why.length)excluded.push({...c,email,reasons:why});else contacts.push({...c,email,verification:{brand,officialSite:d.website,source:c.source,checked:c.checked,method:"official_cached_publication",domainOnly:false}});
 }
 if(!contacts.length)reasons.push("공식 출처로 관계가 확인된 수신 이메일 없음");
 const productName=o.productName||d.product||"",productEvidence=(o.evidence||[]).find((p:any)=>p.url&&productDetailUrl(p.url));
 const productValid=o.productSourceType!=="marketplace_search_index"&&realProductName(productName)&&!!productEvidence;
 return {brand,allowed:reasons.length===0,reasons,contacts,excluded,product:{name:productValid?productName:"",source:productValid?productEvidence.url:"",valid:productValid,reason:productValid?"실제 상품명·판매 상세 출처":"메뉴·게시판·기사 제목 또는 실제 상품 판매 출처 미확인"},draftMode:productValid?"product":"brand_first"};
}
export function assessDispatch(d:any,c:any,lead:any,failures:string[]=[],replyAddresses:string[]=[]){const check=assessMailLead(lead||{...c,website:c.website,contacts:[{...c.contact,email:c.contact?.email,context:c.contact?.context||""}],publicEvidence:c.officialEvidence||[]},failures),reasons=[...check.reasons];
 const recipients=(d.emails?.length?d.emails:[d.email]).map((e:string)=>String(e).toLowerCase()),allowed=new Set([...check.contacts.map((c:any)=>c.email),...(check.allowed?replyAddresses:[])]);
 if(recipients.some((e:string)=>!allowed.has(e)||failures.includes(e)||!!unsafeContactReason(e)))reasons.push("승인 초안 수신자에 회사 관계 미검증·반송·제외 주소 포함");
 if(!validBrandName(d.targetName||c.name))reasons.push("인사말 대상 브랜드·회사명 미검증");
 if(duplicateParagraphs(d.body).length)reasons.push("본문 문단·크리에이터 자료 제공 안내 중복");
 const productNames=[...String(d.body||"").matchAll(/[‘']([^’'\n]+)[’']\s*제품/g)].map(m=>m[1]);if(productNames.some(p=>!realProductName(p)||!check.product.valid||companyIdentity(p)!==companyIdentity(check.product.name)))reasons.push("본문에 메뉴·게시판명이 상품명으로 포함됨");
 const greeting=/^안녕하세요[,!]?\s*(.+?)\s*담당자님[.!]?/m.exec(String(d.body||""));if(greeting&&companyIdentity(greeting[1])!==companyIdentity(check.brand))reasons.push("인사말 이름과 검증된 브랜드·회사명 불일치");
 return {...check,allowed:reasons.length===0,reasons};}
