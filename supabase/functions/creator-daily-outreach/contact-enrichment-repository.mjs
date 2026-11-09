// Server-only adapter. The caller supplies the authenticated member owner, never a body owner.
import {ContactEnrichmentError} from './contact-enrichment.mjs';
import {publicOfficialUrl} from './contact-enrichment-network.mjs';
import {readReviewPage} from './review-pages.mjs';
const fail=code=>{throw new ContactEnrichmentError(code);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const key=value=>typeof value==='string'&&/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value);
const source=row=>({owner:row.owner,sourceId:row.source_id,revision:row.revision,creatorKey:row.creator_key,sourceUrl:row.source_url,sourceKind:row.source_kind,state:row.state,storedLink:row.stored_link,policyReview:row.policy_review,affiliation:row.affiliation,displayNameEvidence:row.display_name_evidence});
export function createContactEnrichmentRepository(sb){
 async function rpc(name,args){const r=await sb.rpc(name,args);if(r?.error)fail('contact_repository_failed');return r?.data;}
 return {
  async listRegisteredSources(owner,{cursor=null}={}){
   // Every append-only registry source starts at revision 1. Page source IDs,
   // then fetch each latest version; never present an older approval as current.
   const page=await readReviewPage(sb,{table:'sanji_contact_source_versions',owner,key:'source_id',columns:'owner,source_id,revision',scope:'registered_contact_sources',cursor,pageSize:20,filter:q=>q.eq('revision',1)});
   if(page.rows.some(row=>row.revision!==1))fail('contact_sources_incomplete');
   const latest=async()=>Promise.all(page.rows.map(async row=>{
    const r=await sb.from('sanji_contact_source_versions').select('owner,source_id,revision,creator_key,source_url,source_kind,state,stored_link,policy_review,affiliation,display_name_evidence',{count:'exact'}).eq('owner',owner).eq('source_id',row.source_id).order('revision',{ascending:false}).limit(1);
    const current=r.data?.[0];
    if(r.error||!Array.isArray(r.data)||r.data.length!==1||!Number.isSafeInteger(r.count)||r.count<1||current.owner!==owner||current.source_id!==row.source_id||!Number.isSafeInteger(current.revision)||current.revision<1||!key(current.creator_key))fail('contact_sources_incomplete');
    return source(current);
   }));
   const items=await latest(),check=await latest();if(JSON.stringify(items)!==JSON.stringify(check))fail('contact_sources_changed');
   return {scope:'registered_contact_sources',items,pagination:page.pagination,registrationEnabled:true,approvalEnabled:false};
  },
  async load(owner,creatorKeys){
   if(!uuid(owner)||!Array.isArray(creatorKeys)||creatorKeys.length>5000||creatorKeys.some(k=>!key(k)))fail('contact_input_invalid');
   if(!creatorKeys.length)return {complete:true,sources:[],observations:[],bios:[]};
   const data=await rpc('sanji_contact_enrichment_load',{p_owner:owner,p_creator_keys:creatorKeys});
   if(data?.complete!==true||!Array.isArray(data.sources)||!Array.isArray(data.observations)||!Array.isArray(data.bios)||data.sources.length>15000||data.observations.length>5000||data.bios.length>20000)fail('contact_sources_incomplete');
   return {...data,sources:data.sources.map(source)};
  },
  async reserveSource(owner,{creatorKey,sourceId,revision}){
   if(!uuid(owner)||!key(creatorKey)||!uuid(sourceId)||!Number.isInteger(revision)||revision<1)fail('contact_input_invalid');
   const result=await rpc('sanji_contact_enrichment_reserve',{p_owner:owner,p_creator_key:creatorKey,p_source_id:sourceId,p_revision:revision});
   if(typeof result?.reserved!=='boolean')fail('contact_reservation_outcome_unknown');return result;
  },
  async appendObservation(owner,observation){
   if(!uuid(owner)||observation?.owner!==owner||!key(observation?.creatorKey))fail('contact_input_invalid');
   const result=await rpc('sanji_contact_enrichment_observe',{p_owner:owner,p_observation:observation});
   if(result?.saved!==true)fail('contact_observation_outcome_unknown');return result;
  },
  // UI-safe registration contract. No approved/state/review/owner/evidence fields.
  // This creates pending review only and never performs any network access.
  async requestSource(owner,input){
   if(!uuid(owner)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['creatorKey','sourceUrl','sourceKind'].includes(k))||!key(input.creatorKey)||!['official_website','instagram_public_bio'].includes(input.sourceKind))fail('contact_registration_invalid');
   if(input.sourceKind==='official_website')publicOfficialUrl(input.sourceUrl);
   else if(!input.creatorKey.startsWith('instagram:')||!['https://www.instagram.com/'+input.creatorKey.slice(10)+'/','https://instagram.com/'+input.creatorKey.slice(10)+'/'].includes(input.sourceUrl))fail('contact_registration_invalid');
   return rpc('sanji_contact_source_request',{p_owner:owner,p_creator_key:input.creatorKey,p_source_url:input.sourceUrl,p_source_kind:input.sourceKind});
  }
 };
}
