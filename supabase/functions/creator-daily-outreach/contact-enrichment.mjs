// Optional publication evidence only. No sending, consent or legal-classification decisions.
import {creatorIdentity,emailIdentity,sourceUrl,profileMatches,fresh} from './domain.mjs';
import {publicOfficialUrl} from './contact-enrichment-network.mjs';
export const CONTACT_ENRICHMENT=Object.freeze({enabled:false,maxCandidates:5000,maxSourcesPerCreator:3,maxRequests:120,maxHostRequests:5,maxBytes:262144,requestMs:8000,totalMs:90000,reviewDays:7});
const DAY=86400000,ownerValid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=v=>typeof v==='string'?v.trim():'';
const business=/협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor/i;
const unrelated=/개인정보|개인\s*연락|채용|입사|고객\s*(?:센터|지원)|팬\s*(?:레터|메일)|privacy|personal|recruit|career|support|customer|fan\s*mail|data\s*protection|not\s+(?:for\s+)?(?:business|commercial|advertis|collab)|no\s+(?:business|commercial|advertis|collab)|(?:협업|광고|사업|제휴).{0,30}(?:거절|금지|받지|불가|아닙|아님|제외)/i;
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export class ContactEnrichmentError extends Error {constructor(code){super(code);this.code=code;this.status=503;}}
const fail=code=>{throw new ContactEnrichmentError(code);};
function exactBioUrl(value,key){try{const u=new URL(value);return key.startsWith('instagram:')&&['https://www.instagram.com/'+key.slice(10)+'/', 'https://instagram.com/'+key.slice(10)+'/'].includes(u.href)&&u.href===value;}catch{return false;}}
export function sourceReviewReason(source,owner,key,now){
 if(!source||source.owner!==owner||source.creatorKey!==key||!ownerValid(source.sourceId)||!Number.isSafeInteger(source.revision)||source.revision<1)return 'source_identity_invalid';
 if(source.state!=='reviewed')return source.state==='revoked'?'source_review_revoked':'source_review_required';
 if(!['official_website','instagram_public_bio'].includes(source.sourceKind))return 'source_kind_not_supported';
 try{if(source.sourceKind==='official_website')publicOfficialUrl(source.sourceUrl);else if(!exactBioUrl(source.sourceUrl,key))return 'source_url_invalid';}catch{return 'source_url_invalid';}
 const link=source.storedLink,policy=source.policyReview,a=source.affiliation;
 // A reviewed URL must have been saved with an independently reviewed creator link.
 if(!link||link.creatorKey!==key||link.url!==source.sourceUrl||!text(link.sourceRecordId)||!sourceUrl(link.sourceUrl)||!text(link.sourceText)||!text(link.reviewedBy)||!fresh(link.checkedAt,now,30))return 'stored_official_link_required';
 if(!policy||policy.decision!==(source.sourceKind==='official_website'?'allow_public_get':'allow_existing_official_bio')||!text(policy.reviewedBy)||!fresh(policy.reviewedAt,now,7)||!Number.isFinite(Date.parse(policy.expiresAt))||Date.parse(policy.expiresAt)<=now||Date.parse(policy.expiresAt)>Date.parse(policy.reviewedAt)+7*DAY||policy.exactUrl!==source.sourceUrl||policy.noLoginOrChallenge!==true||policy.noAccessRestriction!==true||policy.maxRequestsPerDay!==1)return 'source_policy_review_required';
 if(!sourceUrl(policy.termsUrl)||!text(policy.termsExcerpt)||!sourceUrl(policy.robotsUrl)||!text(policy.robotsExcerpt)||!text(policy.accessRationale))return 'source_policy_review_required';
 if(source.sourceKind==='official_website'&&policy.robotsUrl!==new URL(source.sourceUrl).origin+'/robots.txt')return 'source_policy_review_required';
 if(!a||a.verified!==true||a.independentlyVerified!==true||a.creatorKey!==key||a.officialUrl!==source.sourceUrl||a.method!=='manual_cross_reference'||!text(a.reviewedBy)||!sourceUrl(a.sourceUrl)||!text(a.sourceText).includes(key.slice(key.indexOf(':')+1))||!fresh(a.checkedAt,now,30))return 'contact_creator_affiliation_required';
 return null;
}
// Deliberately narrow static rendering: reject every attribute that could change
// visibility, scripts, CSS and unsupported markup. No mailto/JSON/script inference.
// Complex sites need manual review, not an email regex over hidden HTML.
export function parsePublicBusinessPublication(input,{contentType='text/plain'}={}){
 if(typeof input!=='string'||new TextEncoder().encode(input).length>262144)return {status:'source_too_large'};
 if(/captcha|unusual traffic|access denied|보안\s*확인|자동\s*접근.{0,20}(?:금지|차단)|robots\s+denied/i.test(input))return {status:'source_access_denied'};
 let visible=input;
 if(contentType==='text/html'){
  visible=visible.replace(/<!--[\s\S]*?-->/g,'');
  if(/<!--|<!\[|<\?|<![^>]*(?!doctype)/i.test(visible.replace(/<!doctype\s+html\s*>/gi,'')))return {status:'source_render_review_required'};
  visible=visible.replace(/<!doctype\s+html\s*>/gi,'');
  // Only attribute-free structural tags and safe anchors with a single href.
  const tag=/<[^>]*>/g;for(const match of visible.matchAll(tag)){
   if(!/^<\/?(?:html|head|body|main|section|article|div|p|span|h[1-6]|ul|ol|li|strong|b|em|i|br|hr)\s*\/?>$/i.test(match[0])&&!/^<a\s+href\s*=\s*(?:"[^"<>]*"|'[^'<>]*')\s*>$/i.test(match[0])&&!/^<\/a\s*>$/i.test(match[0]))return {status:'source_render_review_required'};
  }
  // head text is never visible. No attributes/scripts can survive the gate above.
  visible=visible.replace(/<head>[\s\S]*?<\/head>/gi,'').replace(/<(?:br|hr|\/p|\/div|\/li|\/section|\/article|\/h[1-6])\s*\/?>/gi,'\n').replace(tag,' ');
  if(/[<>]/.test(visible))return {status:'source_render_review_required'};
  // Do not decode encoded/obfuscated email characters. Only ordinary spacing.
  visible=visible.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&');
 }else if(contentType!=='text/plain')return {status:'source_content_type_unsupported'};
 const lines=visible.split(/\r?\n/).map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean),found=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],emails=[...new Set((line.match(emailPattern)||[]).map(v=>v.toLowerCase()))];
  if(!emails.length)continue;
  const context=business.test(line.replace(emailPattern,''))?line:lines[i-1]&&business.test(lines[i-1].replace(emailPattern,''))?lines[i-1]+' '+line:line;
  if(!business.test(context.replace(emailPattern,''))||unrelated.test(context))continue;
  for(const address of emails)if(emailIdentity(address)&&!/(?:privacy|abuse|noreply|no-reply|support|careers|recruit|legal)@/.test(address))found.push({address,sourceText:context});
 }
 const unique=[...new Set(found.map(v=>v.address))];
 if(unique.length>1)return {status:'ambiguous_public_email'};
 if(!unique.length)return {status:'public_email_not_present'};
 const match=found.find(v=>v.address===unique[0]);
 if(match.sourceText.length>4000||(match.sourceText.match(emailPattern)||[]).some(v=>v.toLowerCase()!==match.address))return {status:'ambiguous_public_email'};
 return {status:'publication_verified',...match};
}
const versionRefs=sources=>sources.map(s=>({sourceId:s.sourceId,revision:s.revision})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&JSON.stringify(a.map(s=>({sourceId:s.sourceId,revision:s.revision})).sort((x,y)=>String(x.sourceId).localeCompare(String(y.sourceId))))===JSON.stringify(b.map(s=>({sourceId:s.sourceId,revision:s.revision})).sort((x,y)=>String(x.sourceId).localeCompare(String(y.sourceId))));
const minimalAffiliation=a=>({verified:true,creatorKey:a.creatorKey,sourceUrl:a.sourceUrl,sourceText:a.sourceText,checkedAt:a.checkedAt});
function evidenceFor(source,result,checkedAt){return {creatorKey:source.creatorKey,address:result.address||'',sourceUrl:source.sourceUrl,sourceText:result.sourceText||'',checkedAt,verified:result.status==='publication_verified',purpose:'business_collaboration',accessMethod:'public_source_review',sourceKind:source.sourceKind,affiliation:source.affiliation?minimalAffiliation(source.affiliation):null,ambiguous:result.status==='ambiguous_public_email',enrichment:{sourceId:source.sourceId,revision:source.revision,status:result.status,publicationEvidenceOnly:true}};}
function overlay(candidate,evidence){return {...candidate,contactEvidence:[...(Array.isArray(candidate.contactEvidence)?candidate.contactEvidence:[]),...(evidence?[evidence]:[])]};}
function applyReviewedName(candidate,sources,owner,key,now){
 if(!profileMatches(candidate,candidate.profileUrl))return candidate;
 const names=sources.filter(s=>!sourceReviewReason(s,owner,key,now)).map(s=>s.displayNameEvidence).filter(e=>{
  if(!e||e.creatorKey!==key||e.verified!==true||e.independentlyVerified!==true||!text(e.reviewedBy)||!['official_website','provided_by_creator'].includes(e.kind)||!text(e.name)||e.name.length>150||/[\r\n\[\]{}<>]/.test(e.name)||!text(e.sourceText).includes(e.name)||!e.sourceText.includes(key.slice(key.indexOf(':')+1))||!fresh(e.checkedAt,now,29))return false;
  try{return Boolean(publicOfficialUrl(e.sourceUrl));}catch{return false;}
 });
 if(!names.length||new Set(names.map(e=>e.name)).size!==1)return candidate;
 const latest=names.sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
 // The source-review route owns canonical identity. A newer registry record
 // may confirm it, but cannot replace its proof or rename a native CRM record.
 if(candidate.displayNameEvidence?.verified===true&&candidate.displayNameEvidence.name===candidate.name&&fresh(candidate.displayNameEvidence.checkedAt,now,29))return latest.name===candidate.name?candidate:{...candidate,displayNameReviewRequired:true};
 if(candidate.sourceRecordId&&latest.name!==candidate.name)return {...candidate,displayNameReviewRequired:true};
 const {name,sourceUrl,sourceText,checkedAt,kind}=latest;
 return {...candidate,name,displayNameEvidence:{name,sourceUrl,sourceText,checkedAt,kind,verified:true,creatorKey:key,profileUrl:candidate.profileUrl}};
}
export function createContactEnrichment({repository,network,enabled=false,now=()=>Date.now(),limits={}}={}){
 const cap={...CONTACT_ENRICHMENT,...limits};for(const k of ['maxCandidates','maxSourcesPerCreator','maxRequests','maxHostRequests','maxBytes','requestMs','totalMs'])if(!Number.isInteger(cap[k])||cap[k]<1||cap[k]>CONTACT_ENRICHMENT[k])fail('contact_limits_invalid');
 return {async enrich(owner,{candidates}={}){
  if(!ownerValid(owner)||!Array.isArray(candidates)||candidates.length>cap.maxCandidates)fail('contact_input_invalid');
  const result={complete:true,candidates:candidates.map(c=>({...c,contactEvidence:[...(c.contactEvidence||[])]})),observations:[],counts:{verified:0,held:0,requests:0,cached:0},reasons:{},publicationEvidenceOnly:true,sendingEnabled:false,recipientBasisApproved:false};
  const addReason=reason=>result.reasons[reason]=(result.reasons[reason]||0)+1;
  if(enabled!==true){addReason('contact_enrichment_disabled');return result;}
  if(!repository?.load||!repository?.appendObservation||!repository?.reserveSource)fail('contact_repository_required');
  const start=now(),keys=[...new Set(candidates.map(creatorIdentity).filter(Boolean))],loaded=await repository.load(owner,keys);
  if(loaded?.complete!==true||!Array.isArray(loaded.sources)||!Array.isArray(loaded.observations)||!Array.isArray(loaded.bios))fail('contact_sources_incomplete');
  if(loaded.sources.some(s=>s.owner!==owner||!keys.includes(s.creatorKey))||loaded.observations.some(s=>s.owner!==owner||!keys.includes(s.creatorKey))||loaded.bios.some(s=>s.owner!==owner||!keys.includes(s.creatorKey)))fail('contact_source_owner_mismatch');
  const byCreator=new Map(),processed=new Map(),hostCounts=new Map();
  for(const s of loaded.sources){const list=byCreator.get(s.creatorKey)||[];if(list.some(x=>x.sourceId===s.sourceId))fail('contact_source_versions_ambiguous');list.push(s);byCreator.set(s.creatorKey,list);}
  for(let index=0;index<candidates.length;index++){
   let candidate=candidates[index];const key=creatorIdentity(candidate);if(!key){addReason('creator_identity_required');continue;}
   if(processed.has(key)){result.candidates[index]=overlay(candidate,processed.get(key));continue;}
   const sources=(byCreator.get(key)||[]).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)),at=now(),refs=versionRefs(sources);
   if(!sources.length){addReason('no_reviewed_official_source');result.counts.held++;processed.set(key,null);continue;}
   if(key.startsWith('instagram:')&&candidate.existingDatabaseRecord!==true)fail('existing_instagram_record_required');
   candidate=applyReviewedName(candidate,sources,owner,key,at);result.candidates[index]=candidate;
   const prior=loaded.observations.filter(o=>o.creatorKey===key).sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt))[0];
   const blockedSources=(Array.isArray(prior?.blockedSources)?prior.blockedSources:[]).filter(b=>sources.some(s=>s.sourceId===b.sourceId&&s.revision===b.revision));
   const allReviewed=sources.every(s=>!sourceReviewReason(s,owner,key,at));
   // Cached HTML is valid only in this Korean day and while every review remains current.
   if(prior&&blockedSources.length){const e=prior.evidence;processed.set(key,e);result.candidates[index]=overlay(candidate,e);result.observations.push(prior);result.counts.held++;addReason('source_access_review_required');continue;}
   if(prior&&allReviewed&&sources.every(s=>s.sourceKind==='official_website')&&same(prior.sourceVersions,refs)&&Date.parse(prior.validUntil)>at&&fresh(prior.recordedAt,at,1)){
    const e=prior.evidence;processed.set(key,e);result.candidates[index]=overlay(candidate,e);result.observations.push(prior);result.counts.cached++;result.counts[e?.verified?'verified':'held']++;if(!e?.verified)addReason(prior.status);continue;
   }
   let status=sources.length>cap.maxSourcesPerCreator?'source_count_review_required':null;const findings=[];
   if(!status)for(const source of sources){
    const reviewReason=sourceReviewReason(source,owner,key,now());if(reviewReason){status=reviewReason;break;}
    if(now()-start>=cap.totalMs){status='contact_time_budget_exhausted';break;}
    if(source.sourceKind==='instagram_public_bio'){
     const bios=loaded.bios.filter(b=>b.creatorKey===key&&b.sourceUrl===source.sourceUrl).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
     const bio=bios[0];if(!bio||!fresh(bio.checkedAt,now(),7)||bio.sourceProvider!=='instagram_official'&&bio.sourceProvider!=='instagram_public'||!['business_discovery','manual_public_bio'].includes(bio.sourceRef)||typeof bio.text!=='string'||bio.contentAvailable!==true){status='fresh_instagram_bio_required';break;}
     if(bios.some(b=>b.checkedAt===bio.checkedAt&&b.text!==bio.text)){status='ambiguous_instagram_bio';break;}
     const parsed=parsePublicBusinessPublication(bio.text);findings.push({source,parsed,checkedAt:bio.checkedAt});if(parsed.status!=='publication_verified'){status=parsed.status;break;}continue;
    }
    if(!network?.read){status='pinned_public_reader_required';break;}
    const host=new URL(source.sourceUrl).hostname;
    if(result.counts.requests>=cap.maxRequests||(hostCounts.get(host)||0)>=cap.maxHostRequests){status='contact_request_budget_exhausted';break;}
    const reserved=await repository.reserveSource(owner,{creatorKey:key,sourceId:source.sourceId,revision:source.revision});
    if(reserved?.reserved!==true){status=reserved?.reason==='source_changed'?'source_changed':'source_daily_budget_used';break;}
    result.counts.requests++;hostCounts.set(host,(hostCounts.get(host)||0)+1);
    let parsed;const observedAt=new Date(now()).toISOString();
    try{const page=await network.read(source.sourceUrl,{timeoutMs:Math.min(cap.requestMs,Math.max(1,cap.totalMs-(now()-start))),maxBytes:cap.maxBytes});if(page?.url!==source.sourceUrl)parsed={status:'source_redirect_denied'};else if(typeof page.text!=='string'||new TextEncoder().encode(page.text).length>cap.maxBytes)parsed={status:'source_too_large'};else parsed=parsePublicBusinessPublication(page.text,{contentType:page.contentType});}catch(error){parsed={status:/^source_[a-z_]+$/.test(error?.code||'')?error.code:'source_unavailable'};}
    findings.push({source,parsed,checkedAt:observedAt});if(['source_access_denied','source_redirect_denied'].includes(parsed.status))blockedSources.push({sourceId:source.sourceId,revision:source.revision,reason:parsed.status});if(parsed.status!=='publication_verified'){status=parsed.status;break;}
   }
   if(!status&&new Set(findings.map(f=>f.parsed.address)).size!==1)status='ambiguous_public_email';
   status=status||'publication_verified';
   const selected=findings.find(f=>f.parsed.status==='publication_verified')||findings[0],source=selected?.source||sources[0];
   const checkedAt=status==='publication_verified'?selected.checkedAt:new Date(now()).toISOString();
   const e=evidenceFor(source,status==='publication_verified'?selected.parsed:{status},checkedAt);
   const recordedAt=new Date(now()).toISOString(),dayEnd=new Date(recordedAt);dayEnd.setUTCHours(15,0,0,0);if(dayEnd.getTime()<=Date.parse(recordedAt))dayEnd.setUTCDate(dayEnd.getUTCDate()+1);
   const validUntil=new Date(Math.min(dayEnd.getTime(),...sources.map(s=>Date.parse(s.policyReview?.expiresAt)||Date.parse(recordedAt)),...findings.filter(f=>f.source.sourceKind==='instagram_public_bio').map(f=>Date.parse(f.checkedAt)+7*DAY))).toISOString();
   const observation={owner,creatorKey:key,status,evidence:e,sourceVersions:refs,blockedSources,recordedAt,validUntil,publicationEvidenceOnly:true};
   // Atomic DB recheck refuses a review revision changed during network I/O.
   const saved=await repository.appendObservation(owner,observation);if(saved?.saved!==true)fail('contact_observation_not_saved');
   processed.set(key,e);result.candidates[index]=overlay(candidate,e);result.observations.push(observation);result.counts[e.verified?'verified':'held']++;if(!e.verified)addReason(status);
  }
  return result;
 }};
}
