import {OutreachError,creatorIdentity,emailIdentity} from './domain.mjs';
import {adaptYoutubeRecord,adaptInstagramRecord} from './repository.mjs';
import {mergeSupplyCandidates} from './supply.mjs';
const fail=code=>{throw new OutreachError(code,'현재 후보 페이지와 전체 중복 이력을 확인해야 합니다.',503);};
const key=v=>typeof v==='string'&&/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(v);
export function adaptExecutionEnvelope(owner,e,now=Date.now()){
 if(!e||!key(e.creatorKey)||!['youtube','instagram','api'].includes(e.kind)||!Array.isArray(e.evidence)||e.evidence.length>1||e.native&&e.native.owner!==owner||e.snapshot&&e.snapshot.owner!==owner||e.evidence.some(r=>r.owner!==owner||r.creator_id!==e.native?.id))fail('EXECUTION_SOURCE_INVALID');
 const native=e.kind==='youtube'?adaptYoutubeRecord(e.native):e.kind==='instagram'?adaptInstagramRecord(e.native,e.evidence):null;
 if(e.kind!=='api'&&(!native||creatorIdentity(native)!==e.creatorKey))fail('EXECUTION_SOURCE_CHANGED');
 const rows=mergeSupplyCandidates(native?[native]:[],e.snapshot?[e.snapshot]:[],now,e.review?[{review:e.review}]:[],e.instagramReview?[{review:e.instagramReview}]:[],e.instagramGuard?[{creator_id:e.native?.id}]:[]);
 if(rows.length!==1||creatorIdentity(rows[0])!==e.creatorKey)fail('EXECUTION_SOURCE_CHANGED');
 return rows[0];
}
export function createExecutionRepository(sb,{now=()=>Date.now()}={}){
 async function rpc(name,args){let r;try{r=await sb.rpc('sanji_daily_execution_'+name,args);}catch{fail(name==='prepare_page'?'SAVE_UNCERTAIN':'EXECUTION_READ_FAILED');}if(r?.error)fail(name==='prepare_page'?'SAVE_UNCERTAIN':'EXECUTION_READ_FAILED');return r?.data;}
 async function identityMatches(owner,inputs,includeSaved=false){
  if(!Array.isArray(inputs)||inputs.length>100||inputs.some(r=>!key(r.creatorKey)))fail('EXECUTION_IDENTITY_INVALID');
  if(!inputs.length)return {complete:true,scope:'all_saved_sanji_history',gmailProviderHistoryChecked:false,matches:[]};
  const result=await rpc('identities',{p_owner:owner,p_inputs:inputs,p_include_saved:includeSaved});
  if(result?.complete!==true||result.scope!=='all_saved_sanji_history'||result.gmailProviderHistoryChecked!==false||!Array.isArray(result.matches)||result.matches.length!==inputs.length||new Set(result.matches.map(r=>r.creatorKey)).size!==inputs.length||result.matches.some(r=>!inputs.some(i=>i.creatorKey===r.creatorKey)||typeof r.duplicateCreator!=='boolean'||typeof r.saved!=='boolean'||!Number.isSafeInteger(r.sourceCount)||r.sourceCount<0||!Array.isArray(r.emailKeys)||r.emailKeys.some(e=>emailIdentity(e)!==e)))fail('EXECUTION_HISTORY_INCOMPLETE');
  return result;
 }
 return {
  async page(owner,{existing=null,previous=null}={}){
   // SQL recomputes current eligible prepared counts. A stale/older-criteria
   // summary must never consume the new distinct-recipient quota.
   const limits={youtube:50,instagram:10};
   const page=await rpc('page',{p_owner:owner,p_resume:(existing||previous)?.executionProgress||null,p_limits:limits,p_at:new Date(now()).toISOString(),p_restart:!existing});
   if(page?.complete!==true||page.scope!=='reviewable_sources'||!Array.isArray(page.rows)||page.rows.length>60||!Number.isSafeInteger(page.unreviewedInstagram)||page.unreviewedInstagram<0)fail('EXECUTION_PAGE_INCOMPLETE');
   for(const platform of ['youtube','instagram']){
    const rows=page.rows.filter(r=>r.creatorKey?.startsWith(platform+':'));let last=page.after?.[platform];
    if(typeof last!=='string'||!/^([a-f0-9]{32})$/.test(page.snapshot?.[platform]||'')||!Number.isSafeInteger(page.total?.[platform])||typeof page.hasMore?.[platform]!=='boolean'||typeof page.exhausted?.[platform]!=='boolean'||!Number.isSafeInteger(page.counts?.[platform])||page.counts[platform]<0||!Number.isSafeInteger(page.limits?.[platform])||page.limits[platform]<0||page.limits[platform]>limits[platform]||rows.length>page.limits[platform])fail('EXECUTION_PAGE_INCOMPLETE');
    for(const row of rows){if(typeof row.pageKey!=='string'||row.pageKey<=last)fail('EXECUTION_PAGE_ORDER');last=row.pageKey;}
    if(last!==page.last?.[platform]||rows.length===0&&page.hasMore?.[platform])fail('EXECUTION_PAGE_INCOMPLETE');
   }
   return {complete:true,page,candidates:page.rows.map(r=>adaptExecutionEnvelope(owner,r,now())),expected:existing?.executionProgress||null};
  },
  async current(owner,creatorKey,sourceRecordId=null){
   if(!key(creatorKey))fail('EXECUTION_IDENTITY_INVALID');
   const result=await rpc('current',{p_owner:owner,p_creator_key:creatorKey,p_source_id:sourceRecordId});
   if(result?.complete!==true)fail('EXECUTION_SOURCE_CHANGED');return {complete:true,candidates:[adaptExecutionEnvelope(owner,result.row,now())]};
  },
  // Review renewal uses only authoritative native identity/status/version.
  // Stale supplemental reviews and their anti-revival guards belong exclusively
  // to merged preparation/send reads and must not block a fresh human review.
  async instagramReviewSource(owner,creatorKey,sourceRecordId){
   if(!key(creatorKey)||!creatorKey.startsWith('instagram:')||typeof sourceRecordId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sourceRecordId))fail('EXECUTION_IDENTITY_INVALID');
   const result=await rpc('instagram_source',{p_owner:owner,p_creator_key:creatorKey,p_source_id:sourceRecordId});
   if(result?.complete!==true||result.source!=='native_instagram_review'||result.creatorKey!==creatorKey||result.native?.owner!==owner||result.native?.id!==sourceRecordId)fail('EXECUTION_SOURCE_CHANGED');
   const candidate=adaptInstagramRecord(result.native,[]);
   if(creatorIdentity(candidate)!==creatorKey||!Number.isFinite(Date.parse(candidate.sourceRecordUpdated)))fail('EXECUTION_SOURCE_CHANGED');
   return {complete:true,candidates:[candidate]};
  },
  async historyFor(owner,candidates){
   const inputs=[...new Map(candidates.map(c=>[creatorIdentity(c),{creatorKey:creatorIdentity(c),sourceRecordId:c.sourceRecordId||null,emailKeys:[...new Set((c.contactEvidence||[]).map(e=>emailIdentity(e.address)).filter(Boolean))].slice(0,10)}])).values()];
   if(inputs.some(r=>candidates.filter(c=>creatorIdentity(c)===r.creatorKey).some(c=>(c.contactEvidence||[]).filter(e=>emailIdentity(e.address)).length>10)))fail('EXECUTION_CONTACT_LIMIT');
   const result=await identityMatches(owner,inputs);
   return {complete:true,scope:result.scope,gmailProviderHistoryChecked:false,creatorKeys:result.matches.filter(r=>r.duplicateCreator||r.sourceCount>1).map(r=>r.creatorKey),emailKeys:[...new Set(result.matches.flatMap(r=>r.emailKeys))]};
  },
  async exclusions(owner,creatorKeys){
   const keys=[...new Set(creatorKeys)];const result=await identityMatches(owner,keys.map(creatorKey=>({creatorKey,emailKeys:[]})),true);
   return {complete:true,creatorKeys:result.matches.filter(r=>r.saved||r.duplicateCreator).map(r=>r.creatorKey)};
  },
  async savePage(owner,plan,loaded){return rpc('prepare_page',{p_owner:owner,p_day:plan.day,p_plan:plan,p_page:loaded.page,p_expected:loaded.expected});}
 };
}
