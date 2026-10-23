import {decodeHtml,plainHtml,publicUrl,companyIdentity,parseOfficialPage,robotsAllowed} from "./discovery.ts";
import {searchUrl} from "./discovery-search.ts";
export const productBrandName=(name:string)=>String(name||"").split(/[,，·｜|]/)[0].replace(/(?:공식)?(?:온라인)?(?:쇼핑)?몰$|\s+온라인$/g,"").trim();
const food=/건강기능식품|건강식품|요거트|그래놀라|두유|녹차|홍차|생강차|귀리|마누카꿀|견과|유산균|비타민|단백질|프로틴|올리브오일|우유|선식|홍삼|오메가|콜라겐|효소|커피|차류|오트밀|프로폴리스|밀크씨슬|루테인|마그네슘/;
export function marketProductLinks(html:string,source:string,brand:string){
 const rows:any[]=[],seen=new Set(),identity=companyIdentity(brand).replace(/본사|공식|건강식품/g,"");if(identity.length<2)return rows;
 for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))try{
  let u=new URL(decodeHtml(m[1]),source);if(u.pathname==="/url"&&u.searchParams.get("q"))u=new URL(u.searchParams.get("q")!);if(u.searchParams.has("uddg"))u=new URL(u.searchParams.get("uddg")!);u=publicUrl(u.toString());
  const allowed=/(^|\.)coupang\.com$/.test(u.hostname)&&/^\/vp\/products\/\d+/.test(u.pathname)||/(^|\.)oliveyoung\.co\.kr$/.test(u.hostname)&&u.pathname.includes("getGoodsDetail")&&u.searchParams.has("goodsNo")||/^(?:smartstore|brand)\.naver\.com$/.test(u.hostname)&&/\/products\/\d+/.test(u.pathname);
  if(!allowed||seen.has(u.href))continue;
  const title=plainHtml(m[2]).replace(/새\s*창\s*열림/g,"").replace(/\s*[|｜]\s*(?:쿠팡|올리브영|네이버).*$/,"").replace(/\s*-\s*(?:쿠팡|올리브영|네이버).*$/,"").trim();
  if(!companyIdentity(title).includes(identity)||!food.test(title)||title.length<5||title.length>140||/배송조회|쿠폰받기|상품리뷰|검색결과/.test(title))continue;
  const name=title.replace(/\s+-\s+(?:요거트|티백\/드립백 커피|커피|비타민|유산균|건강기능식품|영양제)\s*$/,"");
  seen.add(u.href);rows.push({url:u.href,name,quote:title,searchSource:source});
 }catch{}return rows.slice(0,4);
}
export async function searchProduct(brand:string,read:(url:string,cap?:number,market?:boolean)=>Promise<any>){
 brand=productBrandName(brand);
 const checked=new Date().toISOString(),attempts:any[]=[];let candidates:any[]=[];
 const searches=[["Naver",brand+" 쿠팡"],["Naver",brand+" 올리브영"],["Naver",brand+" 스마트스토어"],["Google",brand+" 상품"]];
 for(const [engine,term] of searches){try{const source=searchUrl(engine,term),r=await read(source,2000000);if(/unusual traffic|anomaly-modal|id=["'](?:captcha|challenge-form)/i.test(r.text))throw Error("검색 보안 확인 · 우회하지 않음");candidates=marketProductLinks(r.text,source,brand);attempts.push({engine,query:term,candidates:candidates.length});if(candidates.length)break;}catch(e){attempts.push({engine,query:term,error:String(e.message).slice(0,140)});}}
 for(const candidate of candidates.slice(0,1)){
  try{const u=new URL(candidate.url),robots=await read(u.origin+"/robots.txt",100000,true);if(!robotsAllowed(robots.text,u.pathname))throw Error("판매처 robots.txt 수집 제한");const page=await read(candidate.url,2000000,true),e=parseOfficialPage(page.text,page.url,checked).publicEvidence;
   const product=e.products.find((p:any)=>companyIdentity(p.name).includes(companyIdentity(brand))&&food.test(p.name));
   if(product)return {checked,attempts,products:[{name:product.name,url:page.url,quote:product.quote,checked,sourceType:"marketplace_product_page",searchSource:candidate.searchSource,uncertainty:"외부 판매처 게시 상품 · 판매자 권한·공급 가능 여부 미확인"}]};
  }catch(e){attempts.push({url:candidate.url,error:String(e.message).slice(0,140)});}
 }
 // A search title is evidence from the index, not verification of the current product page.
 return {checked,attempts,products:candidates.slice(0,1).map(c=>({...c,quote:c.quote||c.name,checked,sourceType:"marketplace_search_index",uncertainty:"외부 판매 페이지 검색 색인 · 원문·현행 판매·판매자 권한·공급 가능 여부 미확인"}))};
}
