import {OutreachError} from './domain.mjs';
import {adaptYoutubeRecord,adaptInstagramRecord} from './repository.mjs';
const prefix='sanji_daily_campaign_';

// Only the existing server service client may instantiate this adapter. No
// public-client credentials, Storage URLs, policy writes or new grants here.
export function dailyDispatchRepository(sb,{candidateResolver}={}){
 const query=async promise=>{const r=await promise;if(r.error)throw new OutreachError('CAMPAIGN_DATABASE_UNAVAILABLE','캠페인 저장 상태를 확인해야 합니다.',503);return r.data;};
 const rpc=(name,args)=>query(sb.rpc(prefix+name,args));
 const policy=owner=>query(sb.from(prefix+'policy').select('*').eq('owner',owner).maybeSingle());
 const snapshot=(owner,id)=>query(sb.from(prefix+'snapshots').select('*').eq('owner',owner).eq('id',id).maybeSingle());
 const currentSettings=async owner=>{const rows=await query(sb.from('sanji_records').select('id,owner,version,data').eq('owner',owner).eq('kind','settings').order('id').limit(1));return rows?.[0]||null;};
 const currentConnection=owner=>query(sb.from('sanji_connections').select('owner,provider,summary').eq('owner',owner).eq('provider','gmail').maybeSingle());
 const currentProducts=(owner,ids)=>rpc('products',{p_owner:owner,p_product_ids:ids});
 const candidate=(owner,key)=>query(sb.from('sanji_daily_outreach_candidates').select('*').eq('owner',owner).eq('creator_key',key).maybeSingle());
 async function currentCandidate(owner,c){
  // A supply resolver can combine owner-bound API snapshots with independent
  // source review. A failed resolver must not fall back to stale native data.
  if(candidateResolver)return await candidateResolver(owner,c);
  const id=c?.snapshot?.sourceRecordId;if(!id)return null;
  if(c.platform==='youtube'){
   const row=await query(sb.from('sanji_records').select('id,owner,version,data,updated').eq('owner',owner).eq('kind','candidate').eq('id',id).maybeSingle());
   if(!row||row.data?.channels!=='YouTube')return null;
   return {candidate:adaptYoutubeRecord(row),version:row.version,updated:row.updated};
  }
  if(c.platform!=='instagram')return null;
  const row=await query(sb.from('sanji_creator_recovery').select('*').eq('owner',owner).eq('id',id).maybeSingle());if(!row)return null;
  const response=await sb.from('sanji_creator_evidence').select('owner,creator_id,source_kind,detail,seen_at',{count:'exact'}).eq('owner',owner).eq('creator_id',id).eq('source_kind','daily_outreach_review').order('seen_at',{ascending:false}).limit(1001);
  if(response.error||!Array.isArray(response.data)||response.data.length!==response.count||response.data.length>1000)throw new OutreachError('CURRENT_EVIDENCE_INCOMPLETE','현재 연락처 근거를 모두 확인하지 못했습니다.',503);
  const evidence=response.data;if(evidence.length>1&&evidence[0].seen_at===evidence[1].seen_at&&JSON.stringify(evidence[0].detail)!==JSON.stringify(evidence[1].detail))throw new OutreachError('CURRENT_EVIDENCE_AMBIGUOUS','최신 연락처 근거가 충돌합니다.',409);
  return {candidate:adaptInstagramRecord(row,evidence),updated:row.updated};
 }
 return {policy,snapshot,currentSettings,currentConnection,currentProducts,candidate,currentCandidate,
  basis:(owner,key,recipient)=>query(sb.from(prefix+'basis').select('*').eq('owner',owner).eq('creator_key',key).eq('recipient',recipient).maybeSingle()),
  configure:(owner,expectedRevision,snapshot,policy)=>rpc('configure',{p_owner:owner,p_expected_revision:expectedRevision,p_snapshot:snapshot,p_policy:policy}),
  schedule:(owner,expectedRevision)=>rpc('schedule',{p_owner:owner,p_expected_revision:expectedRevision}),
  pause:(owner,expectedRevision)=>rpc('pause',{p_owner:owner,p_expected_revision:expectedRevision}),
  reviewBasis:(owner,expectedRevision,review)=>rpc('review_basis',{p_owner:owner,p_expected_revision:expectedRevision,p_review:review}),
  async recipientReviews(owner){const r=await sb.from(prefix+'basis').select('creator_key,recipient,status,kind,classification,classification_source,verified_at,expires_at,policy_revision,snapshot_id,updated',{count:'exact'}).eq('owner',owner).order('creator_key').limit(1001);if(r.error||!Array.isArray(r.data)||r.data.length!==r.count||r.data.length>1000)throw new OutreachError('RECIPIENT_REVIEWS_INCOMPLETE','수신자 검토 목록을 모두 확인하지 못했습니다.',503);return r.data;},
  sync:owner=>rpc('sync',{p_owner:owner}),
  async claim(owner){const result=await rpc('claim',{p_owner:owner});return Array.isArray(result)?result[0]||null:result;},
  hold:(owner,job,reason)=>rpc('hold',{p_owner:owner,p_creator_key:job.creator_key,p_lease:job.lease_token,p_reason:reason}),
  reserve:(owner,job,plan)=>rpc('reserve',{p_owner:owner,p_creator_key:job.creator_key,p_lease:job.lease_token,p_plan:plan}),
  beginSend:(owner,job,reservation,proof,rawHash)=>rpc('begin_send',{p_owner:owner,p_creator_key:job.creator_key,p_reservation:reservation.reservationToken,p_gmail_history:proof,p_raw_hash:rawHash}),
  finalize:(owner,job,reservation,status,provider)=>rpc('finalize',{p_owner:owner,p_creator_key:job.creator_key,p_reservation:reservation.reservationToken,p_status:status,p_provider:provider}),
  current:((owner,key)=>query(sb.from(prefix+'queue').select('status,reason,outbox_id,send_started_at').eq('owner',owner).eq('creator_key',key).maybeSingle())),
  runs:owner=>rpc('runs',{p_owner:owner,p_limit:14})
 };
}
