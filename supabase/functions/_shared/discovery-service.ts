import {assessMailLead,assessDispatch,contactResearchState,editorialSource,validBrandName,permanentFailureEmails} from "./mail-integrity.ts";
import {searchProduct} from "./product-search.ts";
import { researchBrand } from "./brand-research.ts";
import { discoveryHealth } from "./discovery-health.ts";
import { searchEngines, searchQuery, searchUrl, searchResults } from "./discovery-search.ts";
import { sourceProspects, directoryLinks, directoryRoots, publicCompanyQuery } from "./discovery-sources.ts";
import { leadOutreach } from "./mail-template.ts";
import { mailRecipients } from "./mail-recipients.ts";
import { publicUrl, publicIp, marketplace, companyIdentity, parseOfficialPage, robotsAllowed, publicHtmlRedirect } from "./discovery.ts";
const defaults={enabled:false,target:40,keywords:["건강기능식품 유산균","건강식품 효소","건강식품 단백질","건강식품 견과","건강식품 올리브오일"]};
const day=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
export function discoveryService(deps:any){
 const {sb,query,audit,putRecord}=deps;
 async function publicFetch(value:string,cap=700000,productOnly=false){
  let url=publicUrl(value);const redirects:string[]=[];
  for(let redirect=0;redirect<3;redirect++){
   // Resolve before every request, including redirects. Fail closed if DNS checks are unavailable.
   const addresses=(await Promise.allSettled([Deno.resolveDns(url.hostname,"A"),Deno.resolveDns(url.hostname,"AAAA")])).flatMap((r:any)=>r.status==="fulfilled"?r.value:[]);
   if(!addresses.length||addresses.some((ip:string)=>!publicIp(ip)))throw Error("공개 IP 확인이 안 되는 주소는 수집하지 않습니다.");
   const r=await fetch(url,{redirect:"manual",headers:{"User-Agent":"SanjiResearch/1.0 (business-contact-research; no form submissions)",Accept:"text/html,text/plain"},signal:AbortSignal.timeout(8000)});
   if([301,302,303,307,308].includes(r.status)){
    const next=publicUrl(new URL(r.headers.get("location")||"",url).toString());
    if(!productOnly&&marketplace(next.toString()))throw Error("플랫폼으로 이동한 주소는 회사 이메일 출처로 자동 수집하지 않습니다: "+next.hostname);
    if(next.origin!==url.origin&&url.pathname!=="/robots.txt"){
     const policy=await publicFetch(next.origin+"/robots.txt",100000,productOnly);
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
  async function read(value:string,linkedFrom="",redirectDepth=0){
   const url=publicUrl(value);visited.add(url.toString());
   try{
    if(!robotCache.has(url.origin)){const r=await publicFetch(url.origin+"/robots.txt",100000);robotCache.set(url.origin,r.text);}
    if(!robotsAllowed(robotCache.get(url.origin)||"",url.pathname))throw Error("robots.txt에서 수집이 제한된 경로입니다.");
    const page=await publicFetch(url.toString(),Math.min(2*1024*1024,htmlBudget));htmlBudget-=page.bytes||0;
    const shellRedirect=publicHtmlRedirect(page.text,page.url);
    if(shellRedirect&&redirectDepth<2&&!visited.has(shellRedirect)){attempts.push({url:page.url,redirect:shellRedirect,checked,status:"public_redirect"});return await read(shellRedirect,linkedFrom,redirectDepth+1);}
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
  const queue=[...first.links.filter((l:any)=>["shop","company"].includes(l.type)),...first.links.filter((l:any)=>l.type==="product").slice(0,1),...first.links.filter((l:any)=>!["shop","company","product"].includes(l.type))];
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
 async function refreshSources(u:string){
  const claimed=await query(sb.rpc("sanji_claim_daily_sources",{p_owner:u}));
  if(!claimed)return null;
  const cfg=await config(u), known=await query(sb.from("sanji_discovery_leads").select("identity,data").eq("owner",u)),found:any[]=[],sources:any[]=[];
  const checked=new Date().toISOString();
  await Promise.all([
   (async()=>{try{
    const url="https://query.wikidata.org/sparql?"+new URLSearchParams({query:publicCompanyQuery,format:"json"});
    const r=await fetch(url,{headers:{Accept:"application/sparql-results+json","User-Agent":"SanjiResearch/1.0 (food-company-discovery; limited daily query)"},signal:AbortSignal.timeout(18000)});
    if(!r.ok)throw Error("공개 기업 데이터 HTTP "+r.status);
    const raw=await r.text();if(raw.length>1000000)throw Error("공개 목록 크기 제한 초과");const result=JSON.parse(raw);
    const rows=(result.results?.bindings||[]).map((r:any)=>({name:r.companyLabel?.value,website:r.site?.value,industry:r.industryName?.value,source:r.company?.value,entity:r.company?.value}));found.push(...rows);sources.push({source:"Wikidata 공개 기업 데이터",count:rows.length,ok:true});
   }catch(e){sources.push({source:"Wikidata 공개 기업 데이터",ok:false,error:String(e.message).slice(0,250)});}})(),
   ...directoryRoots.map(root=>(async()=>{try{
    const robots=await publicFetch(root+"robots.txt",100000);if(!robotsAllowed(robots.text,"/"))throw Error("robots.txt 수집 제한");
    let page=await publicFetch(root);const redirect=publicHtmlRedirect(page.text,page.url);if(redirect&&robotsAllowed(robots.text,new URL(redirect).pathname))page=await publicFetch(redirect);let links=directoryLinks(page.text,page.url);found.push(...links.filter(l=>!l.directory));
    const dir=links.find(l=>l.directory);if(dir&&robotsAllowed(robots.text,new URL(dir.url).pathname)){const list=await publicFetch(dir.url);links=directoryLinks(list.text,list.url);found.push(...links.filter(l=>!l.directory));}
    sources.push({source:root,count:links.filter(l=>!l.directory).length,ok:true});
   }catch(e){sources.push({source:root,ok:false,error:String(e.message).slice(0,250)});}})())
  ]);
  const rows=sourceProspects(found,known,checked).slice(0,200).map(row=>({...row,owner:u}));
  let added=0;if(rows.length){added=Number(await query(sb.rpc("sanji_enqueue_discovery_sources",{p_owner:u,p_rows:rows})));}
  const state={day:day(),checked,attempts:cfg.source_state?.attempts||1,status:sources.some(s=>s.ok)?"completed":"limited",added,sources,error:sources.filter(s=>!s.ok).map(s=>s.source+": "+s.error).join(" / ").slice(0,1200)};
  await query(sb.from("sanji_discovery_config").update({source_state:state,updated:checked}).eq("owner",u));
  await audit(u,"daily_discovery_sources_refreshed",{day:state.day,added,status:state.status});
  return {status:"sources_refreshed",added,message:added?"중복 제외 신규 홈페이지 후보 "+added+"곳 추가":"외부 목록 확인 완료 · 신규 후보 없음",sources};
 }
 async function refillSearch(u:string){
  const lease=await query(sb.rpc("sanji_claim_search_sources",{p_owner:u}));if(!lease)return null;
  const cfg=await config(u),known=await query(sb.from("sanji_discovery_leads").select("identity,data").eq("owner",u));
  const sources:any[]=[],found:any[]=[];const checked=new Date().toISOString();
  // Two distinct queries per lease, paced by SQL. Try another public search engine on denial/empty HTML.
  for(let offset=0;offset<2;offset++){
   const cursor=Number(lease.cursor||0)+offset,q=searchQuery(cursor,cfg.keywords||[]);
   for(let n=0;n<searchEngines.length;n++){
    const engine=searchEngines[(cursor+n)%searchEngines.length],url=searchUrl(engine,q);
    try{
     const r=await fetch(url,{headers:{Accept:"text/html,application/rss+xml,application/xml","User-Agent":"SanjiResearch/1.0 (public business discovery; no authentication bypass)"},signal:AbortSignal.timeout(4500)});
     if(!r.ok){await r.body?.cancel();throw Error("검색 HTTP "+r.status);}
     const reader=r.body?.getReader();if(!reader)throw Error("빈 검색 결과");let text="",size=0;const decoder=new TextDecoder();
     while(true){const b=await reader.read();if(b.done)break;size+=b.value.length;if(size>1800000){await reader.cancel();throw Error("검색 페이지 크기 제한");}text+=decoder.decode(b.value,{stream:true});}text+=decoder.decode();
     const rows=searchResults(text,url,q);sources.push({engine,query:q,count:rows.length,ok:rows.length>0,checked,diagnostics:{title:/<title[^>]*>([^<]*)/i.exec(text)?.[1]?.slice(0,150),bytes:size,anchors:(text.match(/<a\b/gi)||[]).length,items:(text.match(/<item\b/gi)||[]).length}});
     if(rows.length){found.push(...rows);break;}
    }catch(e){sources.push({engine,query:q,ok:false,error:String(e.message).slice(0,200),checked});}
   }
  }
  const rows=sourceProspects(found,known,checked).map(row=>({...row,owner:u}));
  const added=rows.length?Number(await query(sb.rpc("sanji_enqueue_discovery_sources",{p_owner:u,p_rows:rows}))):0;
  const state={...lease,status:added?"replenished":"no_new_results",added,checked,leaseUntil:null,sources};
  await query(sb.from("sanji_discovery_config").update({search_state:state}).eq("owner",u));
  await audit(u,"discovery_search_refilled",{queries:2,added,sources});
  return {status:"search_refilled",added,sources};
 }
 async function cycle(u:string){
  const cycleStarted=Date.now();
  const settings=await config(u);
  let pending=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("status","new").order("created").limit(1));
  if(!pending.length)return {status:"sources_exhausted",message:"현재 홈페이지 후보 대기열을 모두 확인했습니다. 신규 소스 보강이 필요합니다. 수집 중으로 표시하지 않습니다."};
  const claimed=await query(sb.rpc("sanji_discovery_claim",{p_owner:u}));const usage=Array.isArray(claimed)?claimed[0]:claimed;
  if(!usage?.owner)return {status:"busy_or_budget",message:"실행 중이거나 오늘 실행 한도에 도달했습니다."};
  let added=0,processed=0,emails=0,companies=0,error="",duplicate=false;
  try{
   if((usage.companies||0)>=settings.target)return {status:"target_reached",message:"오늘 이메일을 확보한 신규 업체 목표에 도달했습니다. 소유·발송 적합성은 별도 검토합니다."};
   if(pending.length){
    const lead=pending[0], data={...lead.data};
    try{
     if(!data.website)throw Error("홈페이지 후보 주소가 없어 수집하지 못했습니다.");
     data.crawlStarted=new Date().toISOString();
     await query(sb.from("sanji_discovery_leads").update({data,updated:data.crawlStarted}).eq("owner",u).eq("id",lead.id));
     if(editorialSource(data.website,data.publicEvidence||[])||!validBrandName(data.name)){
      const discoverySource=data.searchResultUrl||data.website,claim=String(data.name||"").split(/[,，]/)[0].trim();
      data.discoverySource=discoverySource;data.brandClaim=claim;data.contacts=[];
      if(!validBrandName(claim))throw Error("기사·중간 사이트는 후보 발견 전용 · 공식 브랜드·사이트 확인 필요");
      const queryText=claim+" 공식 홈페이지",search=searchUrl("Naver",queryText),r=await publicFetch(search,2000000);
      const options=searchResults(r.text,search,queryText).filter((p:any)=>!editorialSource(p.website)&&companyIdentity(p.name).includes(companyIdentity(claim)));
      if(!options.length)throw Error("기사에서 발견한 브랜드의 공식 사이트를 확인하지 못함 · 기사 이메일은 저장·발송하지 않음");
      data.website=options[0].website;data.name=claim;data.officialLookup={source:search,checked:new Date().toISOString()};
     }
     const priorContacts=data.contacts||[];
     const crawled=await crawl(data.website);
     Object.assign(data,crawled);
     data.contacts=Array.from(new Map([...priorContacts,...crawled.contacts].map((c:any)=>[c.email.toLowerCase(),c])).values());
     if(crawled.error)error=crawled.error;
     const sourceThreads=await query(sb.from("sanji_records").select("data").eq("owner",u).eq("kind","thread"));
     const contactReview=assessMailLead(data,permanentFailureEmails(sourceThreads,await query(sb.from("sanji_suppression").select("identity,reason").eq("owner",u)))),invalid=new Map(contactReview.excluded.map((c:any)=>[c.email,c.reasons]));
     data.integrityReview={allowed:contactReview.allowed,reasons:contactReview.reasons,checked:new Date().toISOString()};
     data.contacts=data.contacts.map((c:any)=>invalid.has(c.email.toLowerCase())?{...c,excluded:true,excludeFromOutreach:true,exclusionReason:invalid.get(c.email.toLowerCase())}:c);
     if(!contactReview.allowed)data.outreach={...data.outreach,sendBlockedReason:"검토 대기: "+contactReview.reasons.join(" / ")};
     else if(data.outreach?.sendBlockedReason?.startsWith("검토 대기:"))data.outreach={...data.outreach,sendBlockedReason:""};

     // Count each public business email once across the entire workspace.
     const previous=await query(sb.from("sanji_discovery_leads").select("id,data").eq("owner",u));
     const known=new Set(previous.filter((r:any)=>r.id!==lead.id).flatMap((r:any)=>(r.data.contacts||[]).map((c:any)=>c.email.toLowerCase())));
     duplicate=!priorContacts.length&&data.contacts.some((c:any)=>known.has(c.email.toLowerCase()));
     emails=duplicate?0:data.contacts.filter((c:any)=>!c.excluded&&!c.excludeFromOutreach&&!known.has(c.email.toLowerCase())&&!priorContacts.some((p:any)=>p.email.toLowerCase()===c.email.toLowerCase())).length;
     companies=!duplicate&&!priorContacts.length&&emails>0?1:0;
     if(duplicate){data.duplicateNote="기존 업체와 이메일 중복 · 별도 신규 제안 차단";}
     if(companies){data.firstEmailAt=data.firstEmailAt||new Date().toISOString();data.discoveredDay=day();const ts=await query(sb.from("sanji_records").select("id,data,version,updated").eq("owner",u).eq("kind","template").order("updated",{ascending:true}).limit(20));const t=ts.find((t:any)=>t.data.channel==="이메일");if(t){const researched=researchBrand(data,t);data.outreach=researched.outreach;data.research=researched.research;}}
     data.error=crawled.error||"";
    }catch(e){data.error=String(e.message||"수집 실패").slice(0,400);error=data.error;data.contacts=data.contacts||[];data.checked=new Date().toISOString();}
    await query(sb.from("sanji_discovery_leads").update({data,status:duplicate?"blocked":"review",updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));processed=1;
   }
   return {status:error?"source_failed":"processed",added,processed,emailCandidatesAdded:emails,companiesAdded:companies,message:error || (emails?"공개 이메일 후보 "+emails+"개 확보":"업체 확인 완료 · 신규 이메일 후보 없음")};
  }catch(e){error=String(e.message||"발굴 실행 실패").slice(0,400);return {status:"error",message:error};}
  finally{
   await query(sb.from("sanji_discovery_usage").update({added:usage.added+added,processed:usage.processed+processed,emails:usage.emails+emails,companies:(usage.companies||0)+companies,lease_until:null,last_error:error}).eq("owner",u).eq("day",usage.day));
   await sb.from("sanji_discovery_config").update({updated:new Date().toISOString()}).eq("owner",u);
   await audit(u,"discovery_cycle_completed",{processed,emails,companies,error,durationMs:Date.now()-cycleStarted});
  }
 }
 async function enrich(u:string,id:string){
  const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",id).single());
  const source=(lead.data.contacts||[]).find((c:any)=>c.discoveryMethod==="public_page"&&c.source)?.source||lead.data.website;
  const result=await crawl(publicUrl(source).origin+"/",2);
  await query(sb.from("sanji_discovery_leads").update({data:{...lead.data,publicEvidence:result.publicEvidence||[],evidenceError:result.error||"",evidenceChecked:new Date().toISOString()},updated:new Date().toISOString()}).eq("owner",u).eq("id",id));
  return {ok:true,pages:result.pages,evidenceCount:result.publicEvidence?.length||0,error:result.error||""};
 }
 async function researchNext(u:string,requestedId="",productOnly=false){
  let leadsQuery=sb.from("sanji_discovery_leads").select("*").eq("owner",u);if(productOnly)leadsQuery=leadsQuery.eq("data->outreach->>draftMode","brand_first");
  const all=await query(leadsQuery.order("updated").limit(500));
  const sentTargets=productOnly?new Set((await query(sb.from("sanji_outbox").select("target").eq("owner",u).in("status",["accepted","submitting","outcome_unknown"]))).map((o:any)=>o.target)):new Set();
  const lead=all.filter((l:any)=>!productOnly||!sentTargets.has(l.data.candidateId)).sort((a:any,b:any)=>Number(!a.data.outreach?.needsPersonalization&&!a.data.outreach?.sendBlockedReason)-Number(!b.data.outreach?.needsPersonalization&&!b.data.outreach?.sendBlockedReason)).find((l:any)=>l.status!=="blocked"&&(!requestedId||l.id===requestedId)&&l.data.contacts?.length&&(!l.data.research||l.data.outreach?.needsPersonalization||l.data.outreach?.sendBlockedReason||l.data.research?.ownership==="research_pending"||l.data.outreach?.draftMode==="brand_first")&&(productOnly?l.data.outreach?.draftMode==="brand_first"&&Number(l.data.productLookup?.attempts||0)<3:Number(l.data.research?.attempts||0)<3)&&(requestedId||Number(l.data.research?.attempts||0)===0||!l.data.research?.checked||Date.parse(l.data.research.checked)<Date.now()-(productOnly?15*60000:6*3600000)));
  if(!lead)return null;
  const liveConfig=await config(u);await query(sb.from("sanji_discovery_config").update({runtime:{...liveConfig.runtime,currentResearch:lead.data.name}}).eq("owner",u));
  const data={...lead.data};let repaired=false;
  if(data.outreach?.sendBlockedReason){
   const target=String(data.outreach.sendBlockedReason).includes("종근당건강")?"종근당건강":data.name;
   const url=searchUrl("Naver",target+" 건강식품 공식몰");
   try{
    const r=await fetch(url,{headers:{Accept:"text/html","User-Agent":"SanjiResearch/1.0"},signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw Error("업체 재검색 HTTP "+r.status);const html=await r.text();if(html.length>2000000)throw Error("검색 결과 크기 제한");
    const rows=searchResults(html,url,target+" 건강식품 공식몰");data.researchLookup={query:target+" 건강식품 공식몰",checked:new Date().toISOString(),candidates:rows.slice(0,8).map((r:any)=>({name:r.name,website:r.website,source:r.source}))};
    const candidate=rows.find((r:any)=>companyIdentity(r.name).includes(companyIdentity(target))&&new URL(r.website).origin!==new URL(data.website).origin);
    if(candidate){const result=await crawl(candidate.website,2);const evidence=(result.publicEvidence||[]).map((p:any)=>p.title+" "+p.description+" "+p.excerpt).join(" ");
     if(result.contacts?.length&&companyIdentity(evidence).includes(companyIdentity(target))&&/건강기능식품|건강식품/.test(evidence)){
      data.previousContactResearch=[...(data.previousContactResearch||[]),{website:data.website,contacts:data.contacts,reason:data.outreach.sendBlockedReason,checked:new Date().toISOString()}];
      Object.assign(data,result,{website:candidate.website,name:target});data.outreach={...data.outreach,brandName:target,companyName:target,intro:"",needsPersonalization:true,sendBlockedReason:""};repaired=true;
     }
    }
   }catch(e){data.researchLookupError=String(e.message).slice(0,300);}
  }else if(!productOnly&&((!data.publicEvidence?.some((p:any)=>p.products?.length)&&data.outreach?.needsPersonalization)||!data.publicEvidence?.some((p:any)=>{try{return new URL(p.url).origin===new URL(data.website).origin;}catch{return false;}}))){
   const result=await crawl(data.website,3);if(result.publicEvidence?.length)data.publicEvidence=Array.from(new Map([...(data.publicEvidence||[]),...result.publicEvidence].map((p:any)=>[p.url,p])).values());
  }
  const missing=(data.contacts||[]).map((c:any)=>c.source).filter((url:string)=>url&&!data.publicEvidence?.some((p:any)=>p.url===url));
  for(const source of Array.from(new Set(missing)).slice(0,productOnly?0:2)){
   try{const result=await crawl(String(source),1);if(result.publicEvidence?.length)data.publicEvidence=Array.from(new Map([...(data.publicEvidence||[]),...result.publicEvidence].map((p:any)=>[p.url,p])).values());}catch{}
  }
  if(!data.outreach?.sendBlockedReason && (!data.outreach?.productName || data.outreach?.draftMode==="brand_first" || data.outreach?.needsPersonalization)){
   const found=await searchProduct(data.outreach?.brandName||data.name,publicFetch);
   data.marketProductEvidence=found.products;data.productLookup={...found,attempts:Number(data.productLookup?.attempts||0)+1};
  }
  const ts=await query(sb.from("sanji_records").select("id,data,version,updated").eq("owner",u).eq("kind","template").order("updated").limit(20));
  const t=ts.find((t:any)=>t.data.channel==="이메일"),result=researchBrand(data,t);
  result.research.attempts=Number(data.research?.attempts||0)+1;
  if(data.outreach?.sendBlockedReason){result.outreach.sendBlockedReason=data.outreach.sendBlockedReason;result.research.ownership="research_pending";result.research.reason=data.outreach.sendBlockedReason;}
  const excluded=!!data.outreach?.sendBlockedReason&&result.research.attempts>=3;
  if(excluded){result.research.status="excluded";result.research.reason="공식 홈페이지와 동명 식품 브랜드 재검색을 대조했지만 식품 제안 대상 회사·이메일 근거가 일치하지 않아 자동 제외했습니다.";}
  const saved=await query(sb.from("sanji_discovery_leads").update({data:{...data,...result},...(excluded?{status:"blocked"}:{}),updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id).eq("updated",lead.updated).select("id"));
  if(!saved?.length)return {status:"research_stale",name:data.name};
  await audit(u,"brand_researched",{lead:lead.id,ownership:result.research.ownership,personalized:!result.outreach.needsPersonalization,repaired});
  return {status:"brand_researched",name:data.name,ownership:result.research.ownership,personalized:!result.outreach.needsPersonalization,reason:result.research.reason};
 }
 async function scheduled(input:any={}){
  await sb.from("sanji_connections").delete().eq("provider","instagram_pending").lt("summary->>expires",String(Date.now()));
  const rows=await query(sb.from("sanji_discovery_config").select("owner").eq("enabled",true).order("updated").limit(1));
  if(!rows.length)return {status:"disabled",message:"자동 발굴이 꺼져 있습니다."};
  const owner=rows[0].owner,cfg=await config(owner),lastStarted=new Date().toISOString();
  await query(sb.from("sanji_discovery_config").update({runtime:{...cfg.runtime,lastStarted,status:"running"},updated:lastStarted}).eq("owner",owner));
  try{
   let result;
   if(input.task==="product")result=await researchNext(owner,"",true)||{status:"product_research_idle"};
   else if(input.task==="enrich"&&typeof input.leadId==="string")result=await enrich(owner,input.leadId);
   else if(input.task==="research"&&typeof input.leadId==="string")result=await researchNext(owner,input.leadId)||{status:"research_wait"};
   else {
    const refreshed=await refreshSources(owner);
    const searched=refreshed?.added?null:await refillSearch(owner);
    // Research backlog every other tick; new-contact research also happens inside cycle().
    const researched=(!refreshed?.added&&!searched&&Math.floor(Date.now()/300000)%2===0)?await researchNext(owner):null;
    result=refreshed?.added?refreshed:searched||researched||await cycle(owner);
   }
   const completionNotification=input.task!=="product"&&deps.notifyOwner?await deps.notifyOwner(owner):null;
   await query(sb.from("sanji_discovery_config").update({runtime:{lastStarted,lastFinished:new Date().toISOString(),status:"idle",result,completionNotification},updated:new Date().toISOString()}).eq("owner",owner));
   return result;
  }catch(e){await query(sb.from("sanji_discovery_config").update({runtime:{lastStarted,lastFinished:new Date().toISOString(),status:"failed",error:String(e.message).slice(0,400)}}).eq("owner",owner));throw e;}

 }
 async function handle(path:string,method:string,u:string,input:any){
  if(path==="/discovery"&&method==="GET"){
   const settings=await config(u);
   const leads=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).order("created",{ascending:false}).limit(500));
   const usage=await query(sb.from("sanji_discovery_usage").select("*").eq("owner",u).eq("day",day()).maybeSingle());
   const today=usage||{calls:0,added:0,processed:0,emails:0};
   const history=await query(sb.rpc("sanji_discovery_history",{p_owner:u}));
   const pending=leads.filter((l:any)=>l.status==="new");
   const active=!!usage?.lease_until&&Date.parse(usage.lease_until)>Date.now();
   const status=!settings.enabled?"paused":(today.companies||0)>=settings.target?"target_reached":today.calls>=240?"daily_limit":!pending.length?"sources_exhausted":active?"running":"queued";
   const labels:any={paused:"자동 수집 꺼짐",target_reached:"오늘 신규 업체 목표 도달",daily_limit:"오늘 실행 한도 도달",sources_exhausted:settings.enabled?"후보 대기열 소진 · 검색 보충 대기":"대기열 소진 · 신규 소스 보강 필요",running:"홈페이지 공개 이메일 확인 중",queued:"홈페이지 후보 순차 수집 대기 · 5분 간격"};
   const activity=leads.filter((l:any)=>l.status!=="new").sort((a:any,b:any)=>Date.parse(b.updated)-Date.parse(a.updated)).slice(0,12).map((l:any)=>({id:l.id,name:l.data.name,checked:l.data.checked||l.updated,emailCount:l.data.contacts?.length||0,pages:l.data.pages||0,error:l.data.error||""}));
   const notification=await query(sb.from("sanji_discovery_notifications").select("day,status,created,updated,error").eq("owner",u).eq("day",day()).maybeSingle());
   const integrityThreads=await query(sb.from("sanji_records").select("data").eq("owner",u).eq("kind","thread")),failed=permanentFailureEmails(integrityThreads,await query(sb.from("sanji_suppression").select("identity,reason").eq("owner",u)));
   const reviewed=leads.map((l:any)=>{const check=assessMailLead(l,failed),o=l.data.outreach||{},dispatch=o.body?assessDispatch({targetName:check.brand,emails:check.contacts.map((c:any)=>c.email),body:o.body},{name:check.brand},l,failed):check;
    const exclusions=new Map(check.excluded.map((c:any)=>[c.email,c.reasons]));return {...l,mailReview:dispatch,contactResearch:contactResearchState(l,check),data:{...l.data,contacts:(l.data.contacts||[]).map((c:any)=>exclusions.has(c.email.toLowerCase())?{...c,excluded:true,excludeFromOutreach:true,exclusionReason:exclusions.get(c.email.toLowerCase())}:c),outreach:{...o,...(!dispatch.allowed?{sendBlockedReason:contactResearchState(l,check).label+": "+dispatch.reasons.join(" / ")}:o.sendBlockedReason?.startsWith("검토 대기:")?{sendBlockedReason:""}:{})}}};});
   const integritySummary={checked:reviewed.length,passed:reviewed.filter((l:any)=>l.mailReview.allowed).length,review:reviewed.filter((l:any)=>!l.mailReview.allowed).length};
   return {settings,notification:notification||null,leads:reviewed,integritySummary,usage:today,history,health:discoveryHealth(settings,today,reviewed),configured:false,engine:{status,label:labels[status],pending:pending.length,current:active?pending[0]?.data.name||"":"",heartbeat:settings.updated,lastCompleted:activity[0]?.checked||null,mode:"public_sources_and_homepages",refreshAt:"00:00",timezone:"Asia/Seoul",sourceState:settings.source_state||{},searchState:settings.search_state||{},nextRun:settings.enabled&&pending.length&&(today.companies||0)<settings.target&&today.calls<240?new Date(Math.ceil((Date.now()+1000)/300000)*300000).toISOString():null},activity,scope:"한국시간 오늘 · 이메일 확보 신규 업체 / 이메일 주소 수 별도 · 소유 관계 검토 전",llmCalls:0};
  }
  const b=await input();
  if(path==="/discovery/refresh"&&method==="POST")return await refreshSources(u)||{status:"already_checked",message:"오늘 외부 목록을 확인했습니다. 매일 한국시간 00:00에 새 후보를 확인합니다."};
  if(path==="/discovery/enrich"&&method==="POST")return await enrich(u,String(b.id||""));
  if(path==="/discovery/outreach"&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   const old=lead.data.outreach||{};
   if((b.templateVersion&&b.templateVersion!==old.templateVersion)||(b.templateId&&b.templateId!==old.templateId))throw Error("공통 템플릿이 변경됐습니다. 메일 확인 창을 닫고 최신 초안을 다시 열어 주세요.");
   const fields:any={};for(const k of ["subject","body","signature","intro","productName","brandName","companyName"]){if(typeof b[k]==="string")fields[k]=b[k].slice(0,k==="body"?15000:1000);}
   await query(sb.from("sanji_discovery_leads").update({data:{...lead.data,outreach:{...old,...fields,approved:false,updated:new Date().toISOString()}},updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));
   return {ok:true};
  }
  if(path==="/discovery/settings"&&method==="POST"){
   const target=Number(b.target);if(!Number.isInteger(target)||target<1||target>100)throw Error("하루 목표는 1~100입니다.");
   const keywords=Array.isArray(b.keywords)?b.keywords.map((x:any)=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,20):defaults.keywords;
   await query(sb.from("sanji_discovery_config").upsert({owner:u,enabled:b.enabled===true,target,keywords,...(typeof b.notifyCompletion==="boolean"?{notify_completion:b.notifyCompletion}:{}),updated:new Date().toISOString()},{onConflict:"owner"}));return {ok:true};
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
  if(path==="/discovery/run"&&method==="POST"){const result=await cycle(u);if(deps.notifyOwner)await deps.notifyOwner(u);return result;}
  if((path==="/discovery/import"||path==="/discovery/prepare-contact")&&method==="POST"){
   const lead=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",u).eq("id",b.id).single());
   if(lead.data.outreach?.sendBlockedReason)throw Error(lead.data.outreach.sendBlockedReason);
   const failureThreads=await query(sb.from("sanji_records").select("data").eq("owner",u).eq("kind","thread"));
   const integrity=assessMailLead(lead,permanentFailureEmails(failureThreads,await query(sb.from("sanji_suppression").select("identity,reason").eq("owner",u))));if(!integrity.allowed)throw Error("검토 대기: "+integrity.reasons.join(" / "));
   if(b.expectedCopy){const o=lead.data.outreach||{},v=b.expectedCopy;if(v.subject!==o.subject||v.body!==o.body||v.signature!==o.signature||(v.templateVersion&&v.templateVersion!==o.templateVersion))throw Error("초안이 변경됐습니다. 목록을 새로고침하고 내용을 확인한 뒤 보내세요.");}
   if(lead.status==="blocked")throw Error("중복·차단된 업체입니다. 기존 연락 이력을 확인하세요.");
   const eligible=integrity.contacts;
   if(b.email&&!eligible.some((c:any)=>c.email.toLowerCase()===String(b.email).toLowerCase()))throw Error("선택한 주소는 검증 미통과·반송·제외 대상입니다. 다른 주소로 자동 대체하지 않습니다.");
   const selected=eligible.find((c:any)=>c.email.toLowerCase()===String(b.email||"").toLowerCase())||eligible[0];
   const company=String(lead.data.outreach?.brandName||lead.data.name||lead.data.company||b.company||"").trim().slice(0,200);
   const emails=mailRecipients({emails:eligible.map((e:any)=>e.email)});
   if(selected){const source=String(b.source||selected.source||"").trim();if(source)selected.source=publicUrl(source).toString();else if(selected.evidenceType!=="screenshot")throw Error("이메일 원문 출처를 확인하세요.");}
   if(!b.approved||!selected||!company)throw Error("회사·이메일 소유 관계·사업용 용도를 확인하고 승인하세요.");
   const key=companyIdentity(lead.data.company||company),existing=await query(sb.from("sanji_records").select("id,data,version").eq("owner",u).eq("kind","candidate"));
   const previous=existing.find((r:any)=>r.id===lead.data.candidateId||(r.data.companyKey||companyIdentity(r.data.legalCompanyName||r.data.company||""))===key||emails.includes(r.data.contact?.email?.toLowerCase()));
   const c={name:company,company,legalCompanyName:lead.data.company||"",recipientEmails:emails,companyKey:key,kind:"브랜드",product:String(lead.data.product||"").slice(0,200),category:"미확인",classification:"개별 제품의 법적 분류 확인 필요",authority:"브랜드·법인 소유 관계 확인, 해당 제품 판매·유통 권한은 별도 확인 필요",website:lead.data.website,channels:lead.data.channel||"",contact:{email:selected.email,owner:company,source:selected.source,checked:selected.checked.slice(0,10),purpose:selected.purpose === "사업 제휴" ? "사업 제휴" : "비즈니스",verified:true,verification:selected.verification},handle:"",profile:"",agency:"",topics:[],followers:null,metricsSource:"",metricsChecked:"",evidence:[{url:selected.source,checked:selected.checked.slice(0,10),description:selected.context}],reason:"공식 사이트의 회사–이메일 게시 근거를 규칙으로 대조하고 사용자가 수신자·카피를 승인함. 공급 조건은 미확인.",status:"미접촉",note:"이메일 용도: "+selected.purpose+" / 발굴 출처: "+lead.data.source,next:"상품·법적 분류와 제안 근거 확인",due:"",owner:""};
   c.product=String(lead.data.outreach?.productName||c.product||"").slice(0,200);
   const saved=await putRecord(u,"candidate",previous?{...previous.data,...c,status:previous.data.status,version:previous.version}:c,previous?.id);await query(sb.from("sanji_discovery_leads").update({status:"imported",data:{...lead.data,candidateId:saved.id},updated:new Date().toISOString()}).eq("owner",u).eq("id",lead.id));await audit(u,"discovery_email_approved",{lead:lead.id});return {ok:true,candidateId:saved.id,templateId:lead.data.outreach?.templateId,templateVersion:lead.data.outreach?.templateVersion};
  }
  throw Error("지원하지 않는 발굴 작업입니다.");
 }
 return {handle,scheduled,configured:async()=>false};
}
