import {OutreachError,DAILY_OUTREACH,creatorIdentity} from './domain.mjs';
import {createOutreachRepository} from './repository.mjs';
import {createDailySupply,supplyConfig} from './supply.mjs';
import {createSupplyRepository} from './supply-repository.mjs';
import {createContactEnrichment} from './contact-enrichment.mjs';
import {createContactEnrichmentRepository} from './contact-enrichment-repository.mjs';
import {createPinnedPublicReader} from './contact-enrichment-network.mjs';
import {createDailyDispatchRuntime} from './sender-runtime.mjs';
import {campaignDue} from './dispatch.mjs';
import {createOutreachController} from './campaign-controller.mjs';
const fail=code=>{throw new OutreachError(code,'캠페인 실행 조건과 현재 원본을 확인해야 합니다.',503);};
export function createCampaignRuntime({sb,env=()=>'',request=fetch,now=Date.now,network=createPinnedPublicReader(),triggerVerified=()=>false}){
 const repository=createOutreachRepository(sb),contactRepository=createContactEnrichmentRepository(sb);
 const query=async promise=>{const r=await promise;if(r.error)fail('CAMPAIGN_DATABASE_UNAVAILABLE');return r.data;};
 const supply=createDailySupply({repository:createSupplyRepository(sb),sourceRepository:repository,...supplyConfig(env),fetchImpl:request,now,sweepDownstream:()=>query(sb.rpc('sanji_daily_outreach_sweep',{}))});
 const enrichment=createContactEnrichment({repository:contactRepository,network,enabled:env('CREATOR_DAILY_CONTACT_ENRICHMENT_ENABLED')==='true',now});
 async function candidateResolver(owner,prepared){
  const source=await supply.sourceCandidates(owner);if(source?.complete!==true)fail('CURRENT_EVIDENCE_INCOMPLETE');
  const matched=source.candidates.filter(row=>creatorIdentity(row)===prepared.creator_key);if(matched.length!==1)fail('CURRENT_EVIDENCE_AMBIGUOUS');
  const enriched=await enrichment.enrich(owner,{candidates:matched});if(enriched?.complete!==true||enriched.candidates.length!==1)fail('CURRENT_EVIDENCE_INCOMPLETE');
  const candidate=enriched.candidates[0];
  // Bind optimistic checks to the same native row that supplied the evidence.
  // A later metadata-only read could pair old evidence with a newer version.
  if(candidate.sourceRecordId){
   const version=candidate.sourceRecordVersion,updated=candidate.sourceRecordUpdated;
   if(typeof updated!=='string'||!Number.isFinite(Date.parse(updated))||candidate.platform==='youtube'&&(!Number.isSafeInteger(version)||version<1))fail('CURRENT_EVIDENCE_VERSION_REQUIRED');
   return {candidate,...(candidate.platform==='youtube'?{version}:{}),updated};
  }
  return {candidate};
 }
 const dispatch=createDailyDispatchRuntime({sb,env,request,now,candidateResolver,recurringTriggerVerified:triggerVerified});
 const sourceReviews={async list(owner){const source=await supply.sourceCandidates(owner);if(source?.complete!==true)fail('SOURCES_INCOMPLETE');const loaded=await contactRepository.load(owner,[...new Set(source.candidates.map(creatorIdentity).filter(Boolean))]);return {items:loaded.sources,registrationEnabled:true,approvalEnabled:false};},register:(owner,input)=>contactRepository.requestSource(owner,input)};
 const controller=createOutreachController({repository,supply,enrichment,dispatch,sourceReviews,env,now});
 async function run(){
  // Once API records exist, retention must continue even when sending is paused.
  if(env('CREATOR_DAILY_RETENTION_ENABLED')!=='true')return {state:'stopped',reason:'retention_not_enabled',sendingEnabled:false};
  const maintenance=await supply.sweepExpired();
  if(env('CREATOR_DAILY_WORKER_ENABLED')!=='true')return {state:'stopped',maintenance,sendingEnabled:false};
  const r=await sb.from('sanji_daily_campaign_policy').select('owner,data,enabled,send_enabled').eq('enabled',true).order('owner').limit(2);
  if(r.error||!Array.isArray(r.data))fail('SCHEDULE_POLICY_UNAVAILABLE');
  // This isolated campaign runs one explicitly configured account, never arbitrary
  // request owners or a silent cross-account fanout.
  if(r.data.length>1)fail('SCHEDULE_OWNER_AMBIGUOUS');const policy=r.data[0];
  if(!policy)return {state:'paused',maintenance,sendingEnabled:false};
  if(!campaignDue(policy.data?.schedule,now()))return {state:'not_due',maintenance,sendingEnabled:false};
  // Separate bounded passes avoid combining 120s collection, 90s publication
  // checks and provider sending in one Edge invocation.
  const collected=await controller.collect(policy.owner);
  if(collected.newlyCollected===true)return {state:'collected',campaign:DAILY_OUTREACH.campaign,maintenance,collected,morePassesMayBeRequired:true,sendingEnabled:false};
  let prepared=await controller.currentPlan(policy.owner);
  if(!prepared){prepared=await controller.prepare(policy.owner);return {state:'prepared',campaign:DAILY_OUTREACH.campaign,maintenance,prepared,morePassesMayBeRequired:true,sendingEnabled:false};}
  // Existing partial plans dispatch without a second publication/research pass.
  // Newly reviewed additions use the explicit prepare action and atomic quota.
  const dispatched=await dispatch.run(policy.owner,{maxItems:60,budgetMs:40000});
  return {state:'completed_pass',campaign:DAILY_OUTREACH.campaign,maintenance,prepared,dispatched,morePassesMayBeRequired:true};
 }
 return {controller,run,supply,enrichment,dispatch,candidateResolver};
}
