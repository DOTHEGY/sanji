import { mailRecipients } from "./mail-recipients.ts";
import { publicUrl, publicIp, marketplace, companyIdentity, parseOfficialPage, robotsAllowed } from "./discovery.ts";
const defaults={enabled:false,target:30,keywords:["건강기능식품 유산균","건강식품 효소","건강식품 단백질","건강식품 견과","건강식품 올리브오일"]};
const day=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
export function discoveryService(deps:any){
 const {sb,query,audit,putRecord}=deps;
 async function publicFetch(value:string,cap=700000){
  let url=publicUrl(value);const redirects:string[]=[];
  for(let redirect=0;redirect<3;redirect++){
   // Resolve before every request, including redirects. Fail closed if DNS checks are unavailable.
   const addresses=(await Promise.allSettled([Deno.resolveDns(url.hostname,"A"),Deno.resolveDns(url.hostname,"AAAA")])).flatMap((r:any)=>r.status==="fulfilled"?r.value:[]);
   if(!addresses.length||addresses.some((ip:string)=>!publicIp(ip)))throw Error("공개 IP 확인이 안 되는 주소는 수집하지 않습니다.");
   const r=await fetch(url,{redirect:"manual",headers:{"User-Agent":"SanjiResearch/1.0 (business-contact-research; no form submissions)",Accept:"text/html,text/plain"},signal:AbortSignal.timeout(8000)});
   if([301,302,303,307,308].includes(r.status)){
    const next=publicUrl(new URL(r.headers.get("location")||"",url).toString());
    if(marketplace(next.toString()))throw Error("플랫폼으로 이동한 주소는 회사 이메일 출처로 자동 수집하지 않습니다: "+next.hostname);
    if(next.origin!==url.origin&&url.pathname!=="/robots.txt"){
     const policy=await publicFetch(next.origin+"/robots.txt",100000);
     if(!robotsAllowed(policy.text,next.pathname))throw Error("이동한 사이트의 robots.txt에서 수집이 제한됩니다.");
    }
    redirects.push(url.toString());
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
   return {text,url:url.toString(),bytes:size,redirects};
  }throw Error("리디렉션 횟수 제한 초과");
 }
 async function crawl(website:string,maxPages=5){
  const base=publicUrl(website);
  if(marketplace(base.toString()))throw Error("플랫폼 운영사 메일을 브랜드 메일로 수집하지 않습니다. 회사·자사몰 URL을 확인하세요.");
  const robotCache=new Map<string,string>(),attempts:any[]=[],results:any[]=[],visited=new Set<string>();
  const checked=new Date().toISOString();let htmlBudget=3*1024*1024;
  async function read(value:string,linkedFrom=""){
   const url=publicUrl(value);visited.add(url.toString());
   try{
    if(!robotCache.has(url.origin)){const r=await publicFetch(url.origin+"/robots.txt",100000);robotCache.set(url.origin,r.text);}
    if(!robotsAllowed(robotCache.get(url.origin)||"",url.pathname))throw Error("robots.txt에서 수집이 제한된 경로입니다.");
    const page=await publicFetch(url.toString(),Math.min(2*1024*1024,htmlBudget));htmlBudget-=page.bytes||0;
    const parsed={...parseOfficialPage(page.text,page.url,checked),source:page.url};
    const contacts=parsed.contacts.map((c:any)=>({...c,discoveryMethod:"public_page",linkedFrom,sourceRelation:linkedFrom?"홈페이지에서 연결된 페이지 · 동일 회사 소유 관계 검토 전":"홈페이지 후보 · 소유 관계 검토 전"}));
    results.push({...parsed,contacts});attempts.push({url:page.url,requestedUrl:url.toString(),redirects:page.redirects,linkedFrom,checked,emailCount:contacts.length,status:"checked"});
    return parsed;
   }catch(e){if(/크기 제한/.test(e.message||""))htmlBudget=0;attempts.push({url:url.toString(),linkedFrom,checked,status:"failed",error:String(e.message||"페이지 확인 실패").slice(0,300)});return null;}
  }
  const first=await read(base.toString());
  if(!first)return {contacts:[],excludedCount:0,inquiryLinks:[],checked,pages:0,sourceAttempts:attempts,error:attempts[0]?.error||"홈페이지 확인 실패",officialVerified:false};
  // Follow explicitly linked stores, including unquoted href and family-site option values.
  // A link is evidence of a relationship, never proof of legal ownership or permission to contact.
  const homeOrigin=new URL(first.source).origin,extraOrigins=new Set<string>();
  const queue=[...first.links.filter((l:any)=>["shop","company"].includes(l.type)),...first.links.filter((l:any)=>!["shop","company"].includes(l.type))];
  while(queue.length&&attempts.length<maxPages&&htmlBudget>0){
   const link:any=queue.shift();let next;try{next=publicUrl(link.url);}catch{continue;}
   if(visited.has(next.toString())||marketplace(next.toString())||/login|logout|signup|cart|order|privacy|recruit|terms/i.test(next.pathname))continue;
   if(next.origin!==homeOrigin){
    if(!extraOrigins.has(next.origin)&&(!["shop","company"].includes(link.type)||extraOrigins.size>=1))continue;
    extraOrigins.add(next.origin);
   }
   const page=await read(next.toString(),link.linkedFrom||website);
   if(page&&next.origin!==homeOrigin){
    const local=page.links.filter((l:any)=>{try{return new URL(l.url).origin===next.origin&&l.type!=="shop";}catch{return false;}});
    queue.push(...local);
   }
  }
  const contacts=Array.from(new Map(results.flatMap(p=>p.contacts).map(c=>[c.email.toLowerCase(),c])).values());
  return {contacts,publicEvidence:results.map(p=>p.publicEvidence),excludedCount:results.reduce((n,p)=>n+p.rejected.length,0),inquiryLinks:results.flatMap(p=>p.links).filter((l:any)=>/제휴|도매|입점|공동구매/.test(l.label)).slice(0,5),checked,pages:results.length,sourceAttempts:attempts,error:"",officialVerified:false,reviewNote:"홈페이지·연결된 자사몰 후보의 푸터·공개 사업용 메일을 확인했습니다. 이메일 출처와 연결 경로를 남기며 동일 법인 소유 관계는 별도 확인해야 합니다."};
 }
 async function config(u:string){return await query(sb.from("sanji_discovery_config").select("*").eq("owner",u).maybeSingle()) || {...defaults,owner:u};}
 async function cycle(u:string){
  const settings=await config(u);
  let pending=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("status","new").order("created").limit(1));
  if(!pending.length)return {status:"sources_exhausted",message:"현재 홈페이지 후보 대기열을 모두 확인했습니다. 신규 소스 보강이 필요합니다. 수집 중으로 표시하지 않습니다."};
  const claimed=await query(sb.rpc("sanji_discovery_claim",{p_owner:u}));const usage=Array.isArray(claimed)?claimed[0]:claimed;
  if(!usage?.owner)return {status:"busy_or_budget",message:"실행 중이거나 오늘 실행 한도에 도달했습니다."};
  let added=0,processed=0,emails=0,error="";
  try{
   if(usage.emails>=settings.target)return {status:"target_reached",message:"오늘 공식 공개 이메일 후보 목표에 도달했습니다. 최종 검증 수는 별도 집계합니다."};
   if(pending.length){
    const lead=pending[0], data={...lead.data};
    try{
     if(!data.website)throw Error("홈페이지 후보 주소가 없어 수집하지 못했습니다.");
     data.crawlStarted=new Date().toISOString();
     await query(sb.from("sanji_discovery_leads").update({data,updated:data.crawlStarted}).eq("owner",u).eq("id",lead.id));
     const priorContacts=data.contacts||[];
     const crawled=await crawl(data.website);
     Object.assign(data,crawled);
     data.contacts=Array.from(new Map([...priorContacts,...crawled.contacts].map((c:any)=>[c.email.toLowerCase(),c])).values());
     if(crawled.error)error=crawled.error;
     // Count each public business email once across the entire workspace.
     const previous=await query(sb.from("sanji_discovery_leads").select("data").eq("owner",u));
     const known=new Set(previous.flatMap((r:any)=>(r.data.contacts||[]).map((c:any)=>c.email.toLowerCase())));
     emails=data.contacts.filter((c:any)=>!known.has(c.email.toLowerCase())).length;
     data.error=crawled.error||"";
    }catch(e){data.error=String(e.message||"수집 실패").slice(0,400);error=data.error;data.contacts=data.contacts||[];data.checked=new Date().toISOString();}
    await query(sb.from("sanji_discovery_leads").update({data,status:"review",updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));processed=1;
   }
   return {status:error?"source_failed":"processed",added,processed,emailCandidatesAdded:emails,message:error || (emails?"공개 이메일 후보 "+emails+"개 확보":"업체 확인 완료 · 신규 이메일 후보 없음")};
  }catch(e){error=String(e.message||"발굴 실행 실패").slice(0,400);return {status:"error",message:error};}
  finally{
   await query(sb.from("sanji_discovery_usage").update({added:usage.added+added,processed:usage.processed+processed,emails:usage.emails+emails,lease_until:null,last_error:error}).eq("owner",u).eq("day",usage.day));
   await sb.from("sanji_discovery_config").update({updated:new Date().toISOString()}).eq("owner",u);
  }
 }
 async function enrich(u:string,id:string){
  const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",id).single());
  const source=(lead.data.contacts||[]).find((c:any)=>c.discoveryMethod==="public_page"&&c.source)?.source||lead.data.website;
  const result=await crawl(publicUrl(source).origin+"/",2);
  await query(sb.from("sanji_discovery_leads").update({data:{...lead.data,publicEvidence:result.publicEvidence||[],evidenceError:result.error||"",evidenceChecked:new Date().toISOString()},updated:new Date().toISOString()}).eq("owner",u).eq("id",id));
  return {ok:true,pages:result.pages,evidenceCount:result.publicEvidence?.length||0,error:result.error||""};
 }
 async function scheduled(input:any={}){
  await sb.from("sanji_connections").delete().eq("provider","instagram_pending").lt("summary->>expires",String(Date.now()));
  const rows=await query(sb.from("sanji_discovery_config").select("owner").eq("enabled",true).order("updated").limit(1));
  if(!rows.length)return {status:"disabled",message:"자동 발굴이 꺼져 있습니다."};
  if(input.task==="enrich"&&typeof input.leadId==="string")return await enrich(rows[0].owner,input.leadId);
  await sb.from("sanji_discovery_config").update({updated:new Date().toISOString()}).eq("owner",rows[0].owner);
  return await cycle(rows[0].owner);
 }
 async function handle(path:string,method:string,u:string,input:any){
  if(path==="/discovery"&&method==="GET"){
   const settings=await config(u);
   const leads=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).order("created",{ascending:false}).limit(500));
   const usage=await query(sb.from("sanji_discovery_usage").select("*").eq("owner",u).eq("day",day()).maybeSingle());
   const today=usage||{calls:0,added:0,processed:0,emails:0};
   const pending=leads.filter((l:any)=>l.status==="new");
   const active=!!usage?.lease_until&&Date.parse(usage.lease_until)>Date.now();
   const status=!settings.enabled?"paused":today.emails>=settings.target?"target_reached":today.calls>=160?"daily_limit":!pending.length?"sources_exhausted":active?"running":"queued";
   const labels:any={paused:"자동 수집 꺼짐",target_reached:"오늘 이메일 후보 목표 도달",daily_limit:"오늘 실행 한도 도달",sources_exhausted:"대기열 소진 · 신규 소스 보강 필요",running:"홈페이지 공개 이메일 확인 중",queued:"홈페이지 후보 순차 수집 대기 · 5분 간격"};
   const activity=leads.filter((l:any)=>l.status!=="new").sort((a:any,b:any)=>Date.parse(b.updated)-Date.parse(a.updated)).slice(0,12).map((l:any)=>({id:l.id,name:l.data.name,checked:l.data.checked||l.updated,emailCount:l.data.contacts?.length||0,pages:l.data.pages||0,error:l.data.error||""}));
   return {settings,leads,usage:today,configured:false,engine:{status,label:labels[status],pending:pending.length,current:active?pending[0]?.data.name||"":"",heartbeat:settings.updated,lastCompleted:activity[0]?.checked||null,mode:"homepage_queue",nextRun:settings.enabled&&pending.length&&today.emails<settings.target&&today.calls<160?new Date(Math.ceil((Date.now()+1000)/300000)*300000).toISOString():null},activity,scope:"한국시간 오늘 · 공식 공개 이메일 후보 / 최종 검증 전 · 문의폼·전화번호 제외",llmCalls:0};
  }
  const b=await input();
  if(path==="/discovery/enrich"&&method==="POST")return await enrich(u,String(b.id||""));
  if(path==="/discovery/outreach"&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   const old=lead.data.outreach||{};
   const fields:any={};for(const k of ["subject","body","signature","intro","productName","brandName","companyName"]){if(typeof b[k]==="string")fields[k]=b[k].slice(0,k==="body"?15000:1000);}
   await query(sb.from("sanji_discovery_leads").update({data:{...lead.data,outreach:{...old,...fields,approved:false,updated:new Date().toISOString()}},updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));
   return {ok:true};
  }
  if(path==="/discovery/settings"&&method==="POST"){
   const target=Number(b.target);if(!Number.isInteger(target)||target<1||target>100)throw Error("하루 목표는 1~100입니다.");
   const keywords=Array.isArray(b.keywords)?b.keywords.map((x:any)=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,20):defaults.keywords;
   await query(sb.from("sanji_discovery_config").upsert({owner:u,enabled:b.enabled===true,target,keywords,updated:new Date().toISOString()},{onConflict:"owner"}));return {ok:true};
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
  if((path==="/discovery/import"||path==="/discovery/prepare-contact")&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   const eligible=(lead.data.contacts||[]).filter((c:any)=>!c.excluded&&!c.excludeFromOutreach);
   const selected=eligible.find((c:any)=>c.email===b.email)||eligible[0];
   const company=String(lead.data.outreach?.brandName||lead.data.name||lead.data.company||b.company||"").trim().slice(0,200);
   const emails=mailRecipients({emails:(lead.data.contacts||[]).filter((e:any)=>!e.excluded&&!e.excludeFromOutreach).map((e:any)=>e.email)});
   if(selected){const source=String(b.source||selected.source||"").trim();if(source)selected.source=publicUrl(source).toString();else if(selected.evidenceType!=="screenshot")throw Error("이메일 원문 출처를 확인하세요.");}
   if(!b.approved||!selected||!company)throw Error("회사·이메일 소유 관계·사업용 용도를 확인하고 승인하세요.");
   const key=companyIdentity(lead.data.company||company),existing=await query(sb.from("sanji_records").select("id,data,version").eq("owner",u).eq("kind","candidate"));
   const previous=existing.find((r:any)=>r.id===lead.data.candidateId||(r.data.companyKey||companyIdentity(r.data.legalCompanyName||r.data.company||""))===key||emails.includes(r.data.contact?.email?.toLowerCase()));
   const c={name:company,company,legalCompanyName:lead.data.company||"",recipientEmails:emails,companyKey:key,kind:"브랜드",product:String(lead.data.product||"").slice(0,200),category:"미확인",classification:"개별 제품의 법적 분류 확인 필요",authority:"브랜드·법인 소유 관계 확인, 해당 제품 판매·유통 권한은 별도 확인 필요",website:lead.data.website,channels:lead.data.channel||"",contact:{email:selected.email,owner:company,source:selected.source,checked:selected.checked.slice(0,10),purpose:selected.purpose === "사업 제휴" ? "사업 제휴" : "비즈니스",verified:true},handle:"",profile:"",agency:"",topics:[],followers:null,metricsSource:"",metricsChecked:"",evidence:[{url:selected.source,checked:selected.checked.slice(0,10),description:selected.context}],reason:"공식 사이트의 공개 회사 이메일을 직접 검토·승인함. 제품·조건은 미확인.",status:"미접촉",note:"이메일 용도: "+selected.purpose+" / 발굴 출처: "+lead.data.source,next:"상품·법적 분류와 제안 근거 확인",due:"",owner:""};
   c.product=String(lead.data.outreach?.productName||c.product||"").slice(0,200);
   const saved=await putRecord(u,"candidate",previous?{...previous.data,...c,status:previous.data.status,version:previous.version}:c,previous?.id);await query(sb.from("sanji_discovery_leads").update({status:"imported",data:{...lead.data,candidateId:saved.id},updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));await audit(u,"discovery_email_approved",{lead:lead.id});return {ok:true,candidateId:saved.id};
  }
  throw Error("지원하지 않는 발굴 작업입니다.");
 }
 return {handle,scheduled,configured:async()=>false};
}
