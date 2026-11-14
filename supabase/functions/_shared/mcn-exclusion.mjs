// Prospective selection only. Never use this policy to revalidate approved mail.
// Exact organization domains identify a managed contact, not an exclusive contract.
export const MCN_REGISTRY = Object.freeze([
  {id:'sandbox',name:'샌드박스',aliases:['샌드박스','샌드박스 네트워크','SANDBOX NETWORK'],domains:['sandbox.co.kr','sandboxnetwork.net'],evidenceUrl:'https://sandbox.co.kr/notice/16'},
  {id:'treasurehunter',name:'트레져헌터',aliases:['트레져헌터','트레저헌터','TREASURE HUNTER'],domains:['treasurehunter.co.kr'],evidenceUrl:'https://treasurehunter.co.kr/ko/creators'},
  {id:'soonent',name:'순이엔티',aliases:['순이엔티','SOONENT'],domains:['soon-ent.co.kr'],evidenceUrl:'https://www.soon-ent.co.kr/sub/management.php'},
  {id:'dooho',name:'두호컴퍼니',aliases:['두호컴퍼니'],domains:['doohocorp.com'],evidenceUrl:'https://www.doohocorp.com/business/main'},
  {id:'witu',name:'윗유',aliases:['윗유','위트유','witU'],domains:['witu.co.kr'],evidenceUrl:'https://witu.co.kr/creator'},
  {id:'shortt',name:'숏뜨',aliases:['숏뜨','쇼트뜨'],domains:['shortt.kr'],evidenceUrl:'https://shortt.kr/'},
  {id:'lolq',name:'롤큐',aliases:['롤큐'],domains:['lolq.co.kr'],evidenceUrl:'https://lolq.co.kr/'},
  {id:'ag',name:'AG 엔터테인먼트',aliases:['AG 엔터테인먼트'],domains:['ag-ent.net'],evidenceUrl:'https://www.ag-ent.net/creator'},
  {id:'goodwork',name:'굿워크랩',aliases:['굿워크랩'],domains:['goodworklab.co.kr'],evidenceUrl:'https://goodworklab.co.kr/'},
  {id:'the8',name:'더에잇이엔티',aliases:['더에잇이엔티','더에잇 이엔티','더에이트'],domains:['the8-ent.com'],evidenceUrl:'https://the8-ent.com/'},
].map(entry=>Object.freeze({...entry,sourceFields:Object.freeze(['creator_owned_business_contact','creator_owned_affiliation_statement','verified_official_roster'])})));
const unknown=()=>({excluded:false,membership:'unknown',reason:null,evidence:[]});
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const mailboxDomain=value=>{const s=typeof value==='string'?value.trim().toLowerCase():'';return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(s)?s.split('@')[1]:null;};
const business=/(?:문의|비즈니스|비지니스|광고|협찬|협업|제휴|business|contact|collab|sponsor|management)/iu;
const historical=/(?:이전|과거|전\s*소속|탈퇴|계약\s*(?:종료|해지)|소속\s*(?:아님|아니|없)|소속이\s*아|formerly|previously|former\b|no longer|not affiliated)/iu;
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function ownSource(e,creatorKey){
 if(e?.creatorKey!==creatorKey||e.publicSourceVerified!==true||e.directCreatorSourceVerified!==true||!safeUrl(e.sourceUrl)||typeof e.context!=='string')return false;
 const u=new URL(e.sourceUrl),channel=['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)?u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1]:null;
 return !channel||creatorKey==='youtube:'+channel;
}
export function classifyMcnEvidence({creatorKey,contacts=[],statements=[],rosterEvidence=[]}={}){
 if(typeof creatorKey!=='string'||!creatorKey)return unknown();
 for(const e of rosterEvidence){const org=MCN_REGISTRY.find(x=>x.id===e.organizationId);if(org&&e.creatorKey===creatorKey&&e.verified===true&&e.identityVerified===true&&e.current===true&&safeUrl(e.sourceUrl)&&org.domains.some(d=>new URL(e.sourceUrl).hostname===d||new URL(e.sourceUrl).hostname==='www.'+d))return {excluded:true,membership:'confirmed',reason:'MCN 소속 확인',organizationId:org.id,organizationName:org.name,evidence:[{kind:'verified_official_roster',sourceUrl:e.sourceUrl,registrySource:org.evidenceUrl}]};}
 for(const e of statements){if(!ownSource(e,creatorKey)||historical.test(e.context))continue;
  for(const org of MCN_REGISTRY){const names=org.aliases.map(escapeRegex).join('|');const explicit=new RegExp('^(?:저는|저희는|본\\s*채널은|이\\s*채널은)?\\s*(?:'+names+')\\s*소속(?:입니다|이에요|이예요|\\s*크리에이터입니다)?[.!。]?\\s*$|^소속\\s*[:：]\\s*(?:'+names+')[.!。]?\\s*$','iu');
   if(explicit.test(e.context))return {excluded:true,membership:'confirmed',reason:'MCN 소속 확인',organizationId:org.id,organizationName:org.name,evidence:[{kind:'creator_owned_affiliation_statement',sourceUrl:e.sourceUrl,registrySource:org.evidenceUrl}]};
  }
 }
 for(const e of contacts){if(!ownSource(e,creatorKey)||historical.test(e.context)||(!business.test(e.context)&&e.businessContactReviewed!==true))continue;
  // Inspect every explicitly published mailbox, including a manager alongside
  // the selected personal address. Exact domains only, never an address substring.
  const published=(e.context.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(x=>x.toLowerCase());
  if(/(?:친구|게스트|다른\s*채널|인용|guest|quoted|someone else)/iu.test(e.context))continue;
  for(const email of published){const domain=mailboxDomain(email),org=MCN_REGISTRY.find(x=>x.domains.includes(domain));
   if(org)return {excluded:true,membership:'unknown',reason:'MCN 관리 연락처 확인',organizationId:org.id,organizationName:org.name,evidence:[{kind:'creator_owned_business_contact',domain,sourceUrl:e.sourceUrl,registrySource:org.evidenceUrl}]};
  }
 }
 return unknown();
}
export function classifyYoutubeDescription(channelId,description){
 if(!/^UC[A-Za-z0-9_-]{22}$/.test(channelId))return unknown();
 const creatorKey='youtube:'+channelId,sourceUrl='https://www.youtube.com/channel/'+channelId;
 const rawLines=String(description||'').split(/[\r\n]+/);
 const lines=rawLines.map((context,i)=>({creatorKey,context,sourceUrl,publicSourceVerified:true,directCreatorSourceVerified:true}));
 const contactLines=lines.map((e,i)=>({...e,context:i>0&&/^(?:광고|협업|비즈니스|비지니스|business|contact|collab|제휴|문의)(?:\s*(?:문의|연락|contact|inquiries))?\s*[:：]?$/iu.test(rawLines[i-1].trim())?rawLines[i-1]+' '+e.context:e.context}));
 return classifyMcnEvidence({creatorKey,statements:lines,contacts:contactLines.flatMap(e=>(e.context.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(email=>({...e,email})))});
}
export function classifyMcnRecord(record){
 const d=record?.data||record||{},creatorKey='youtube:'+(d.youtubeResearch?.channelId||d.creator?.externalId||d.profile?.match(/\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1]||'');
 if(!/^youtube:UC[A-Za-z0-9_-]{22}$/.test(creatorKey))return unknown();
 const contacts=[d.contact,...(Array.isArray(d.youtubeResearch?.businessContacts)?d.youtubeResearch.businessContacts:[]).map(e=>({...e,businessContactReviewed:true}))].filter(Boolean).map(e=>({...e,creatorKey:e.creatorKey||creatorKey}));
 return classifyMcnEvidence({creatorKey,contacts,statements:contacts,rosterEvidence:d.youtubeResearch?.mcnRosterEvidence||[]});
}
export function youtubeSelectionExclusion(record){
 const d=record?.data||record||{};
 if(['거절','수신 거부','제외','상대방 거절','우리 측 거절'].includes(d.status))return {excluded:true,reason:d.youtubeResearch?.mcnAssessment?.reason||d.status,organizationName:d.youtubeResearch?.mcnAssessment?.organizationName,evidence:d.youtubeResearch?.mcnAssessment?.evidence||[]};
 return classifyMcnRecord(record);
}
