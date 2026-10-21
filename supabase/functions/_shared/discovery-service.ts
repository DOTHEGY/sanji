import { publicUrl, publicIp, marketplace, companyIdentity, plainHtml, parseOfficialPage, shoppingProspects, robotsAllowed } from "./discovery.ts";
const defaults={enabled:false,target:30,keywords:["건강기능식품 유산균","건강식품 효소","건강식품 단백질","건강식품 견과","건강식품 올리브오일"]};
const day=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
export function discoveryService(deps:any){
 const {sb,query,connection,saveConnection,env,audit,putRecord}=deps;
 const navKeys=async(u:string)=>(await connection(u,"naver")) || {clientId:env("NAVER_CLIENT_ID"),clientSecret:env("NAVER_CLIENT_SECRET")};
 async function naver(u:string,kind:string,q:string,start=1){
  const c=await navKeys(u);
  if(!c.clientId||!c.clientSecret)throw Error("네이버 검색 연결이 필요합니다. API 키 없이도 공식 URL 직접 수집은 가능합니다.");
  const url="https://openapi.naver.com/v1/search/"+kind+".json?"+new URLSearchParams({query:q,display:kind==="shop"?"100":"5",start:String(start)});
  const r=await fetch(url,{headers:{"X-Naver-Client-Id":c.clientId,"X-Naver-Client-Secret":c.clientSecret},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("네이버 검색 요청 실패 ("+r.status+"). 키·이용 한도를 확인하세요. 자동 재시도하지 않습니다.");
  return await r.json();
 }
 async function publicFetch(value:string,cap=700000){
  let url=publicUrl(value);
  for(let redirect=0;redirect<3;redirect++){
   // Resolve before every request, including redirects. Fail closed if DNS checks are unavailable.
   const addresses=(await Promise.allSettled([Deno.resolveDns(url.hostname,"A"),Deno.resolveDns(url.hostname,"AAAA")])).flatMap((r:any)=>r.status==="fulfilled"?r.value:[]);
   if(!addresses.length||addresses.some((ip:string)=>!publicIp(ip)))throw Error("공개 IP 확인이 안 되는 주소는 수집하지 않습니다.");
   const r=await fetch(url,{redirect:"manual",headers:{"User-Agent":"SanjiResearch/1.0 (business-contact-research; no form submissions)",Accept:"text/html,text/plain"},signal:AbortSignal.timeout(8000)});
   if([301,302,303,307,308].includes(r.status)){
    const next=publicUrl(new URL(r.headers.get("location")||"",url).toString());
    if(next.hostname.replace(/^www\./,"")!==url.hostname.replace(/^www\./,""))throw Error("다른 도메인 리디렉션은 검토 후 직접 등록하세요.");
    url=next;await r.body?.cancel();continue;
   }
   if(r.status===404&&url.pathname==="/robots.txt")return {text:"",url:url.toString()};
   if(!r.ok)throw Error("공식 사이트 HTTP "+r.status+" · 로그인·차단·보안문자를 우회하지 않습니다.");
   const type=r.headers.get("content-type")||"";
   if(!/text\/(html|plain)|application\/xhtml/i.test(type))throw Error("HTML·텍스트 페이지만 수집합니다.");
   const reader=r.body?.getReader();if(!reader)throw Error("빈 응답");
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>cap){await reader.cancel();throw Error("페이지 크기 제한 초과");}chunks.push(part.value);}
   const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}
   const charset=/charset=([^;\s]+)/i.exec(type)?.[1]||"utf-8";
   let text;try{text=new TextDecoder(charset).decode(bytes);}catch{text=new TextDecoder().decode(bytes);}
   return {text,url:url.toString()};
  }throw Error("리디렉션 횟수 제한 초과");
 }
 async function crawl(website:string){
  const base=publicUrl(website);
  if(marketplace(base.toString()))throw Error("쿠팡·스마트스토어 등 플랫폼은 발견 출처로만 사용합니다. 공식 회사 홈페이지를 입력하세요.");
  const robots=await publicFetch(base.origin+"/robots.txt",100000);
  if(!robotsAllowed(robots.text,base.pathname))throw Error("robots.txt에서 수집이 제한된 경로입니다.");
  const home=await publicFetch(base.toString());
  const checked=new Date().toISOString();const first=parseOfficialPage(home.text,home.url,checked);
  const results=[first];let count=1;
  for(const link of first.links as any[]){
   if(count>=3)break;
   let next;try{next=publicUrl(link.url);}catch{continue;}
   if(next.origin!==new URL(home.url).origin||!robotsAllowed(robots.text,next.pathname)||/login|logout|signup|cart|order|privacy|recruit|terms/i.test(next.pathname))continue;
   try{const page=await publicFetch(next.toString());results.push(parseOfficialPage(page.text,page.url,checked));count++;}catch{/* Keep successful sources; blocked pages are not retried. */}
  }
  const contacts=Array.from(new Map(results.flatMap(p=>p.contacts).map(c=>[c.email.toLowerCase(),c])).values());
  return {contacts,excludedCount:results.reduce((n,p)=>n+p.rejected.length,0),inquiryLinks:results.flatMap(p=>p.links).filter((l:any)=>/제휴|도매|입점|공동구매/.test(l.label)).slice(0,5),checked,pages:count,officialVerified:false,reviewNote:"공식 사이트에 공개된 이메일 후보입니다. 대표·일반 문의·고객센터도 포함하며 용도를 구분합니다. 회사 소유 관계 최종 확인 전이며 발송되지 않습니다."};
 }
 async function config(u:string){return await query(sb.from("sanji_discovery_config").select("*").eq("owner",u).maybeSingle()) || {...defaults,owner:u};}
 async function cycle(u:string){
  const settings=await config(u);const keys=await navKeys(u);
  let pending=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("status","new").order("created").limit(1));
  if(!pending.length && (!keys.clientId||!keys.clientSecret))return {status:"waiting_connection",message:"네이버 검색 API 미연결 · 공식 URL 직접 수집은 가능"};
  const claimed=await query(sb.rpc("sanji_discovery_claim",{p_owner:u}));const usage=Array.isArray(claimed)?claimed[0]:claimed;
  if(!usage?.owner)return {status:"busy_or_budget",message:"실행 중이거나 오늘 실행 한도에 도달했습니다."};
  let added=0,processed=0,emails=0,error="";
  try{
   if(usage.emails>=settings.target)return {status:"target_reached",message:"오늘 공식 공개 이메일 후보 목표에 도달했습니다. 최종 검증 수는 별도 집계합니다."};
   if(pending.length){
    const lead=pending[0], data={...lead.data};
    try{
     if(!data.website){
      const result=await naver(u,"webkr",data.name+" 공식 홈페이지 제휴 문의");
      const match=(result.items||[]).find((x:any)=>{
       try{return !marketplace(x.link)&&companyIdentity(plainHtml(x.title+" "+x.description)).includes(companyIdentity(data.name))&&publicUrl(x.link);}catch{return false;}
      });
      if(!match)throw Error("공식 홈페이지 후보를 찾지 못했습니다. URL을 직접 보완하세요.");
      data.website=match.link;data.officialSearchSource={title:plainHtml(match.title),description:plainHtml(match.description),url:match.link};
     }
     Object.assign(data,await crawl(data.website));
     // Count each public business email once across the entire workspace.
     const previous=await query(sb.from("sanji_discovery_leads").select("data").eq("owner",u));
     const known=new Set(previous.flatMap((r:any)=>(r.data.contacts||[]).map((c:any)=>c.email.toLowerCase())));
     emails=data.contacts.filter((c:any)=>!known.has(c.email.toLowerCase())).length;
     data.error="";
    }catch(e){data.error=String(e.message||"수집 실패").slice(0,400);data.contacts=data.contacts||[];}
    await query(sb.from("sanji_discovery_leads").update({data,status:"review",updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));processed=1;
   }else if(usage.added<150){
    const keywords=settings.keywords.length?settings.keywords:defaults.keywords;
    const index=Math.floor(usage.calls/2)%keywords.length;
    const page=Math.floor(usage.calls/(keywords.length*2))%10;
    const result=await naver(u,"shop",keywords[index],page*100+1);
    const prospects=shoppingProspects(result.items||[],keywords[index],new Date().toISOString()).slice(0,Math.min(20,150-usage.added));
    for(const data of prospects){
     const {error:e}=await sb.from("sanji_discovery_leads").insert({owner:u,identity:data.identity,data});
     if(!e)added++;else if(e.code!=="23505")throw Error("발굴 후보 저장 실패");
    }
   }
   return {status:"processed",added,processed,emailCandidatesAdded:emails};
  }catch(e){error=String(e.message||"발굴 실행 실패").slice(0,400);return {status:"error",message:error};}
  finally{
   await query(sb.from("sanji_discovery_usage").update({added:usage.added+added,processed:usage.processed+processed,emails:usage.emails+emails,lease_until:null,last_error:error}).eq("owner",u).eq("day",usage.day));
   await sb.from("sanji_discovery_config").update({updated:new Date().toISOString()}).eq("owner",u);
  }
 }
 async function scheduled(){
  await sb.from("sanji_connections").delete().eq("provider","instagram_pending").lt("summary->>expires",String(Date.now()));
  const rows=await query(sb.from("sanji_discovery_config").select("owner").eq("enabled",true).order("updated").limit(1));
  if(!rows.length)return {status:"disabled",message:"자동 발굴이 꺼져 있습니다."};
  await sb.from("sanji_discovery_config").update({updated:new Date().toISOString()}).eq("owner",rows[0].owner);
  return await cycle(rows[0].owner);
 }
 async function handle(path:string,method:string,u:string,input:any){
  if(path==="/discovery"&&method==="GET"){
   const settings=await config(u),keys=await navKeys(u);
   const leads=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).order("created",{ascending:false}).limit(500));
   const usage=await query(sb.from("sanji_discovery_usage").select("*").eq("owner",u).eq("day",day()).maybeSingle());
   return {settings,leads,usage:usage||{calls:0,added:0,processed:0,emails:0},configured:!!keys.clientId&&!!keys.clientSecret,scope:"한국시간 오늘 · 공식 공개 이메일 후보 / 최종 검증 전 · 문의폼·전화번호 제외",llmCalls:0};
  }
  const b=await input();
  if(path==="/discovery/settings"&&method==="POST"){
   const target=Number(b.target);if(!Number.isInteger(target)||target<1||target>100)throw Error("하루 목표는 1~100입니다.");
   const keywords=Array.isArray(b.keywords)?b.keywords.map((x:any)=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,20):defaults.keywords;
   await query(sb.from("sanji_discovery_config").upsert({owner:u,enabled:b.enabled===true,target,keywords,updated:new Date().toISOString()},{onConflict:"owner"}));return {ok:true};
  }
  if(path==="/discovery/credentials"&&method==="POST"){
   if(typeof b.clientId!=="string"||typeof b.clientSecret!=="string"||b.clientId.length<8||b.clientSecret.length<8||b.clientId.length>200||b.clientSecret.length>300)throw Error("발급된 네이버 검색 API Client ID·Secret을 확인하세요.");
   await saveConnection(u,"naver",{clientId:b.clientId.trim(),clientSecret:b.clientSecret.trim()});await audit(u,"discovery_search_connected");return {ok:true};
  }
  if(path==="/discovery/seed"&&method==="POST"){
   const url=publicUrl(String(b.url||""));if(marketplace(url.toString()))throw Error("플랫폼 URL에서 이메일을 수집하지 않습니다. 회사 공식 홈페이지 URL을 입력하세요.");
   const name=String(b.name||"").trim().slice(0,150);if(!name)throw Error("확인한 회사·브랜드명을 입력하세요.");
   await query(sb.from("sanji_discovery_leads").insert({owner:u,identity:companyIdentity(name),data:{name,website:url.toString(),company:"",source:url.toString(),channel:"공식 URL 직접 등록",checked:new Date().toISOString(),officialVerified:false}}));return {ok:true};
  }
  if(path==="/discovery/requeue"&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   const url=publicUrl(String(b.url||""));if(marketplace(url.toString()))throw Error("회사의 공식 홈페이지 URL을 입력하세요.");
   if(lead.status==="imported")throw Error("등록한 회사는 브랜드 목록에서 수정하세요.");
   await query(sb.from("sanji_discovery_leads").update({status:"new",data:{...lead.data,website:url.toString(),error:""},updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));return {ok:true};
  }
  if(path==="/discovery/run"&&method==="POST")return await cycle(u);
  if(path==="/discovery/import"&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   const selected=(lead.data.contacts||[]).find((c:any)=>c.email===b.email);
   const company=String(b.company||"").trim().slice(0,200);
   if(!b.approved||!selected||!company)throw Error("회사·이메일 소유 관계·사업용 용도를 확인하고 승인하세요.");
   const key=companyIdentity(company),existing=await query(sb.from("sanji_records").select("id,data").eq("owner",u).eq("kind","candidate"));
   if(existing.some((r:any)=>companyIdentity(r.data.company||"")===key || r.data.contact?.email?.toLowerCase()===selected.email.toLowerCase()))throw Error("같은 회사 또는 이메일이 이미 등록되어 있습니다. 기존 후보를 확인하세요.");
   const c={name:lead.data.name,company,companyKey:key,kind:"브랜드",product:String(lead.data.product||"").slice(0,200),category:"미확인",classification:"개별 제품의 법적 분류 확인 필요",authority:"브랜드·법인 소유 관계 확인, 해당 제품 판매·유통 권한은 별도 확인 필요",website:lead.data.website,channels:lead.data.channel||"",contact:{email:selected.email,owner:company,source:selected.source,checked:selected.checked.slice(0,10),purpose:selected.purpose === "사업 제휴" ? "사업 제휴" : "비즈니스",verified:true},handle:"",profile:"",agency:"",topics:[],followers:null,metricsSource:"",metricsChecked:"",evidence:[{url:selected.source,checked:selected.checked.slice(0,10),description:selected.context}],reason:"공식 사이트의 공개 회사 이메일을 직접 검토·승인함. 제품·조건은 미확인.",status:"미접촉",note:"이메일 용도: "+selected.purpose+" / 발굴 출처: "+lead.data.source,next:"상품·법적 분류와 제안 근거 확인",due:"",owner:""};
   await putRecord(u,"candidate",c);await query(sb.from("sanji_discovery_leads").update({status:"imported",updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));await audit(u,"discovery_email_approved",{lead:lead.id});return {ok:true};
  }
  throw Error("지원하지 않는 발굴 작업입니다.");
 }
 return {handle,scheduled,configured:async(u:string)=>{const c=await navKeys(u);return !!c.clientId&&!!c.clientSecret;},search:async(u:string,q:string)=>{const r=await naver(u,"webkr",q);return {results:(r.items||[]).map((x:any)=>({title:plainHtml(x.title),url:x.link,description:plainHtml(x.description),checked:new Date().toISOString(),verification:"네이버 검색 결과 · 회사 소유 관계 검증 전"}))};}};
}
