import {Buffer} from "node:buffer";
import {searchUrl} from "./discovery-search.ts";
const hash=async(s:string)=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex");
const normal=(v:any)=>String(v||"").trim().replace(/^@/,"").toLowerCase();
export function instagramSearchCandidates(html:string,source:string,keywords:string[]){
 const found=new Map<string,any>();
 html=html.replace(/<item\b[^>]*>([\s\S]*?)<\/item>/gi,(_,item)=>{const link=/<link[^>]*>([\s\S]*?)<\/link>/i.exec(item)?.[1]||"",title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1]||"",desc=/<description[^>]*>([\s\S]*?)<\/description>/i.exec(item)?.[1]||"";return `<a href="${link.replace(/<!\[CDATA\[|\]\]>/g,"")}">${title}</a>${desc}`;});
 for(const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let value=match[1].replace(/&amp;/g,"&");try{const u=new URL(value,source);value=u.searchParams.get("uddg")||u.searchParams.get("q")||u.searchParams.get("url")||u.toString();value=decodeURIComponent(value);}catch{}
  const hit=value.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:[?#"'&]|$)/i);if(!hit)continue;
  const handle=normal(hit[1]);if(!/^[a-z0-9._]{2,30}$/.test(handle)||["p","reel","reels","explore","stories","direct","accounts","about"].includes(handle))continue;
  const after=html.slice(match.index!+match[0].length,match.index!+match[0].length+400).split(/<a\b/i)[0];
  const raw=(match[0]+after).replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g," ").replace(/&[a-z#0-9]+;/gi," ").replace(/\s+/g," ").trim().slice(0,900);
  if(/(?:저는|제가|나의|투병|환자).{0,20}(?:당뇨|암|질병|임신|치료)/.test(raw))continue;
  const topics=keywords.flatMap(k=>k.split(/\s+/)).filter(k=>k.length>1&&raw.includes(k));
  let searchOnly=false;try{const u=new URL(source),q=u.searchParams.get("query")||u.searchParams.get("q")||"";searchOnly=/^(?:search\.naver\.com|www\.google\.com|www\.bing\.com|html\.duckduckgo\.com)$/.test(u.hostname)&&q.includes("site:instagram.com")&&keywords.some(k=>q.includes(k));}catch{}
  if(!searchOnly&&(!topics.length||!/(?:공동구매|공구|협업|비즈니스|크리에이터|레시피|푸드|웰니스)/.test(raw)))continue;
  found.set(handle,{handle,profile:"https://www.instagram.com/"+handle+"/",name:handle,source_url:source,excerpt:raw,reasons:topics.length?[...new Set(topics)].map(k=>"공개 검색 결과에 ‘"+k+"’ 표기"):["주제 검색에 노출된 프로필 · 콘텐츠 적합성은 미확인"],uncertainties:["공개 검색 색인 후보 · Instagram 원문·최근 활동·반응 수치 미검증","개인의 건강 상태·질병·고객층은 추정하지 않음"]});
 }return [...found.values()];
}
export function renderCreatorCopy(copy:string,handle:string){return copy.replace(/\{\{(?:크리에이터명|아이디)\}\}/g,handle);}
export function creatorDiscoveryService({sb,query,audit,env}:any){
 const get=async(owner:string)=>await query(sb.from("sanji_creator_config").select("*").eq("owner",owner).maybeSingle())||{owner,enabled:false,auto_send:false,target:500,keywords:["공동구매 레시피","공구 푸드","웰니스 크리에이터"],dm_copy:"",sender_handle:"",runtime:{},search_cursor:0};
 const safe=(c:any)=>{const {worker_hash,worker_expires,approved_hash,...rest}=c;return {...rest,workerConnected:!!worker_hash&&Date.parse(worker_expires||"")>Date.now()};};
 async function collect(owner:string){
  const c=await get(owner);if(!c.enabled)return {status:"disabled"};
  if(c.last_search&&Date.parse(c.last_search)>Date.now()-5*60000)return {status:"cooldown"};
  const start=new Date(new Date(Date.now()+9*3600000).toISOString().slice(0,10)+"T00:00:00+09:00").toISOString();
  const today=await query(sb.from("sanji_creator_prospects").select("id").eq("owner",owner).gte("checked",start));if(today.length>=c.target)return {status:"target_reached",found:today.length};
  // Conditional claim prevents overlapping authenticated requests from performing the same search.
  const claimed=await query(sb.from("sanji_creator_config").update({last_search:new Date().toISOString(),search_cursor:c.search_cursor+1,runtime:{status:"searching",checked:new Date().toISOString()}}).eq("owner",owner).eq("search_cursor",c.search_cursor).select("owner"));if(!claimed?.length)return {status:"busy"};
  const keyword=c.keywords[c.search_cursor%c.keywords.length]+["", " 크리에이터", " 협업", " 인플루언서", " 비즈니스"][Math.floor(c.search_cursor/c.keywords.length)%5],term='site:instagram.com '+keyword;let rows:any[]=[],sources:any[]=[];
  for(const engine of ["Naver","Google","Bing","DuckDuckGo"]){const url=searchUrl(engine,term);try{const r=await fetch(url,{headers:{Accept:"text/html","User-Agent":"SanjiResearch/1.0"},signal:AbortSignal.timeout(8000)});if(!r.ok){sources.push({engine,status:r.status});continue;}const reader=r.body?.getReader();if(!reader)throw Error("빈 검색 응답");let html="",bytes=0;const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2000000)throw Error("검색 크기 제한");html+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}if(/unusual traffic|anomaly-modal|id=["\'](?:captcha|challenge-form)["\']/i.test(html))throw Error("검색 보안 확인 · 우회하지 않음");rows=instagramSearchCandidates(html,url,c.keywords);sources.push({engine,candidates:rows.length});if(rows.length)break;}catch(e){sources.push({engine,error:String(e.message).slice(0,120)});}}
  let added=0;
  for(const r of rows.slice(0,Math.max(0,c.target-today.length))){const body=renderCreatorCopy(c.dm_copy,r.handle);const record={...r,owner,body,status:c.auto_send?"queued":"new",sender_handle:c.sender_handle,approved_hash:c.approved_hash};const saved=await sb.from("sanji_creator_prospects").insert(record);if(!saved.error)added++;}
  const runtime={checked:new Date().toISOString(),status:added?"found":sources.every(s=>s.error||s.status)?"search_failed":"no_new_results",query:term,added,sources,paidApiCalls:0};await query(sb.from("sanji_creator_config").update({runtime}).eq("owner",owner));await audit(owner,"creator_discovery_completed",{added,sources});return runtime;
 }
 async function handle(path:string,method:string,owner:string,input:()=>Promise<any>){
  if(path==="/creator-discovery"&&method==="GET"){
   const recent=await query(sb.from("sanji_creator_prospects").select("checked").eq("owner",owner).gte("checked",new Date(Date.now()-48*3600000).toISOString()).limit(1000));
   const day=(time:number)=>new Date(time+9*3600000).toISOString().slice(0,10),today=day(Date.now()),yesterday=day(Date.now()-86400000);
   return {config:safe(await get(owner)),counts:{today:recent.filter((r:any)=>day(Date.parse(r.checked))===today).length,yesterday:recent.filter((r:any)=>day(Date.parse(r.checked))===yesterday).length},prospects:await query(sb.from("sanji_creator_prospects").select("*").eq("owner",owner).order("checked",{ascending:false}).limit(300))};
  }
  const b=await input();
  if(path==="/creator-discovery/settings"&&method==="POST"){
   const old=await get(owner),keywords=Array.isArray(b.keywords)?b.keywords.map((s:any)=>String(s).trim()).filter(Boolean).slice(0,20):old.keywords,target=Number(b.target),copy=String(b.dmCopy||""),sender=normal(b.senderHandle);
   if(!Number.isInteger(target)||target<1||target>500||!keywords.length||copy.length>900||sender&&!/^[a-z0-9._]{2,30}$/.test(sender))throw Error("목표 1~500명·검색어·카피 900자 이하·발신 계정을 확인하세요.");
   if(b.autoSend)throw Error("신규 상대 선제 DM 자동 발송은 공식 연동에서 지원하지 않습니다. 검색·카피 준비만 활성화할 수 있습니다.");
   if(/치료|예방|완치|항암|개선.{0,4}보장/.test(copy))throw Error("미확인 효능·질병 표현을 수정하세요.");
   const approved=b.autoSend?await hash(JSON.stringify({copy,keywords,sender})):"";
   if(approved!==old.approved_hash)await query(sb.from("sanji_creator_prospects").update({status:"cancelled",result:{note:"캠페인 카피·조건·승인 변경"}}).eq("owner",owner).eq("status","queued"));
   await query(sb.from("sanji_creator_config").upsert({owner,enabled:b.enabled===true,auto_send:b.autoSend===true,target,keywords,dm_copy:copy,sender_handle:sender,approved_hash:approved,updated:new Date().toISOString()},{onConflict:"owner"}));
   const pending=await query(sb.from("sanji_creator_prospects").select("id,handle").eq("owner",owner).eq("status","new"));
   for(const row of pending)await query(sb.from("sanji_creator_prospects").update({body:renderCreatorCopy(copy,row.handle),sender_handle:sender}).eq("id",row.id).eq("owner",owner).eq("status","new"));return {ok:true};
  }
  if(path==="/creator-discovery/search"&&method==="POST")return await collect(owner);
  if(path==="/creator-discovery/stop"&&method==="POST"){await query(sb.from("sanji_creator_config").update({enabled:false,auto_send:false,worker_hash:null,worker_state:"stopped"}).eq("owner",owner));return {ok:true};}
  throw Error("지원하지 않는 크리에이터 작업");
 }
 return {handle,collect,scheduled:async()=>{const rows=await query(sb.from("sanji_creator_config").select("owner").eq("enabled",true).limit(1));return rows.length?await collect(rows[0].owner):{status:"disabled"};}};
}
