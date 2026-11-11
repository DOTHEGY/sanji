import {adaptYoutubeRecord} from '../creator-daily-outreach/repository.mjs';
import {verifiedManualHistory} from '../creator-daily-outreach/youtube-manual-history.mjs';
const fail=()=>{throw Object.assign(new Error('MANUAL_DATABASE_UNAVAILABLE'),{code:'MANUAL_DATABASE_UNAVAILABLE'});};
// A server service client is required. historySource must independently fetch
// the complete owner-scoped ledger, refusals and Gmail review. It is deliberately
// mandatory: no placeholder/default may claim those sources are complete.
export function youtubeManualRepository({sb,historySource}){
 const query=async q=>{let r;try{r=await q;}catch{fail();}if(r?.error)fail();return r.data;};
 const rpc=(name,args)=>query(sb.rpc('sanji_youtube_manual_'+name,args));
 return {
  policy:owner=>query(sb.from('sanji_daily_campaign_policy').select('*').eq('owner',owner).maybeSingle()),
  snapshot:(owner,id)=>query(sb.from('sanji_daily_campaign_snapshots').select('*').eq('owner',owner).eq('id',id).maybeSingle()),
  async currentSettings(owner){const rows=await query(sb.from('sanji_records').select('id,owner,version,data').eq('owner',owner).eq('kind','settings').order('id').limit(1));return rows?.[0]||null;},
  currentConnection:owner=>query(sb.from('sanji_connections').select('owner,provider,summary').eq('owner',owner).eq('provider','gmail').maybeSingle()),
  currentProducts:(owner,ids)=>query(sb.rpc('sanji_daily_campaign_products',{p_owner:owner,p_product_ids:ids})),
  async currentRecipient(owner,id){const row=await query(sb.from('sanji_records').select('id,owner,kind,data,version,updated').eq('owner',owner).eq('kind','candidate').eq('id',id).maybeSingle());if(!row||row.owner!==owner||row.id!==id||row.kind!=='candidate'||row.data?.channels!=='YouTube')return {complete:false};const candidate=adaptYoutubeRecord(row);return {complete:Boolean(candidate),owner,id,version:row.version,candidate,native:row};},
  async manualHistory(owner,addresses){if(typeof historySource!=='function')fail();const sources=await historySource(owner,addresses);return verifiedManualHistory({owner,...sources});},
  async recordGmailReview({owner,candidateId,version,email,sender,fingerprint,count}){return rpc('record_gmail_review',{p_owner:owner,p_candidate:candidateId,p_version:version,p_email:email,p_sender:sender,p_fingerprint:fingerprint,p_count:count});},
  async createBatch({owner,snapshotId,snapshotHash,settingsVersion,policyRevision,approvalHash,review}){const id=await rpc('create_batch',{p_owner:owner,p_snapshot:snapshotId,p_snapshot_hash:snapshotHash,p_settings_version:settingsVersion,p_policy_revision:policyRevision,p_approval_hash:approvalHash,p_review:review});if(typeof id!=='string')fail();return {id,owner};},
  async batch(owner,id){const r=await query(sb.from('sanji_youtube_manual_batches').select('id,owner,snapshot_id,snapshot_hash,policy_revision,approval_hash,review,created_at,expires_at,confirmed_at').eq('owner',owner).eq('id',id).maybeSingle());if(!r||r.owner!==owner||r.id!==id)return null;return {id:r.id,owner:r.owner,snapshotId:r.snapshot_id,snapshotHash:r.snapshot_hash,policyRevision:r.policy_revision,approvalHash:r.approval_hash,review:r.review,createdAt:r.created_at,expiresAt:r.expires_at,confirmedAt:r.confirmed_at};},
  async confirmBatch({owner,batchId,approvalHash}){return await rpc('confirm_batch',{p_owner:owner,p_batch:batchId,p_approval_hash:approvalHash})===true;},
  async recentBatches(owner,offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset>10000)fail();const r=await sb.from('sanji_youtube_manual_batches').select('id,owner,approval_hash,created_at,confirmed_at',{count:'exact'}).eq('owner',owner).not('confirmed_at','is',null).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+9);if(r.error||!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.data.length>10||r.data.some(x=>x.owner!==owner||!x.confirmed_at))fail();return {offset,more:r.count>offset+r.data.length,rows:r.data.map(x=>({id:x.id,approvalHash:x.approval_hash,createdAt:x.created_at}))};},
  async batchRows(owner,batchId){const r=await sb.from('sanji_youtube_manual_ledger').select('id,owner,batch_id,candidate_id,candidate_version,email,email_key,payload_hash,message_id,state',{count:'exact'}).eq('owner',owner).eq('batch_id',batchId).order('candidate_id').limit(101);if(r.error||!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count!==r.data.length||r.data.length>100||r.data.some(x=>x.owner!==owner||x.batch_id!==batchId))fail();return r.data;},
  async scheduleStatus(owner,batchId){const r=await query(sb.from('sanji_youtube_manual_schedule').select('owner,batch_id,run_at,state').eq('owner',owner).eq('batch_id',batchId).maybeSingle());if(!r)return null;if(r.owner!==owner||r.batch_id!==batchId||!Number.isFinite(Date.parse(r.run_at))||!['scheduled','processing','complete','held','outcome_unknown','cancelled'].includes(r.state))fail();return {runAt:r.run_at,state:r.state};},
  async reserveBatch({owner,batchId,approvalHash,items}){return rpc('reserve_batch',{p_owner:owner,p_batch:batchId,p_approval:approvalHash,p_items:items});},
  async scheduleBatch({owner,batchId,approvalHash,items,expectedRunAt}){return rpc('schedule_batch',{p_owner:owner,p_batch:batchId,p_approval:approvalHash,p_items:items,p_expected_run_at:expectedRunAt});},
  async claimDue(){return rpc('claim_due',{});},
  async continueClaim({token}){return rpc('continue_schedule',{p_token:token});},
  async finishClaim({token,result}){await rpc('finish_schedule',{p_token:token,p_result:result});},
  async cancelPending({owner,batchId}){return rpc('cancel_pending',{p_owner:owner,p_batch:batchId});},
  async claimRow({owner,id,approvalHash,payloadHash}){return rpc('claim',{p_owner:owner,p_id:id,p_approval:approvalHash,p_payload:payloadHash});},
  async claimScheduledRow({owner,id,approvalHash,payloadHash,schedulerToken}){return rpc('claim_scheduled',{p_owner:owner,p_id:id,p_approval:approvalHash,p_payload:payloadHash,p_scheduler_token:schedulerToken});},
  async recheck({owner,id,token}){return rpc('recheck',{p_owner:owner,p_id:id,p_token:token});},
  async consume({owner,id,token,payloadHash}){return rpc('consume',{p_owner:owner,p_id:id,p_token:token,p_payload:payloadHash});},
  async finish({owner,id,token,status,providerId,providerThread}){return rpc('finish',{p_owner:owner,p_id:id,p_token:token,p_result:status,p_provider_id:providerId??null,p_provider_thread:providerThread??null});}
 };
}
