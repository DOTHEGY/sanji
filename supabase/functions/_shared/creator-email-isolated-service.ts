import {creatorEmailPlan, verifiedCreatorEmail, exactCreatorProfile} from './creator-email-plan.ts';
import {instagramBusinessDiscovery} from './creator-recovery-adapters.ts';
import {mime} from './mail-mime.ts';

const prefix='sanji_creator_email_isolated_';
const clean=(v:any)=>String(v??'').trim();

// This is a recipient-specific review, never an inference from a published address
// or the sender's assertion that all messages are non-marketing.
export function creatorEmailBasis(b:any, owner:string, creator:string, recipient:string, revision:number, productId:string, now=Date.now()) {
 if(!Array.isArray(b?.product_ids)||!b.product_ids.includes(productId))return false;
 if(!b||b.owner!==owner||b.creator_id!==creator||clean(b.recipient).toLowerCase()!==recipient.toLowerCase()||b.policy_revision!==revision)return false;
 if(b.status!=='approved'||b.kind!=='solicited_proposal'||b.classification!=='solicited_non_marketing_proposal'||b.approved_by!==owner)return false;
 if(!clean(b.approval_source)||!clean(b.classification_source)||!clean(b.source_text)||!/^https:\/\//i.test(clean(b.source_url)))return false;
 const checked=Date.parse(b.verified_at),expiry=Date.parse(b.expires_at);
 return Number.isFinite(checked)&&checked<=now&&checked>=now-30*86400000&&Number.isFinite(expiry)&&expiry>now;
}

export function isolatedCreatorEmailService({sb,query,env,connection,gmailToken,remote,digest,uuid,audit,request=fetch,now=Date.now}:any){
 async function config(owner:string){return await query(sb.from(prefix+'policy').select('*').eq('owner',owner).maybeSingle());}
 async function history(owner:string,address:string,sender:string){
  if(!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address))throw Error('invalid_email');
  const gmail=await gmailToken(owner);
  if(clean(gmail.email).toLowerCase()!==sender.toLowerCase())throw Error('gmail_account_changed');
  const result=await remote('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+new URLSearchParams({q:`in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`,maxResults:'1',includeSpamTrash:'true'}),{headers:{Authorization:'Bearer '+gmail.access_token}});
  if(!result||typeof result!=='object'||(result.messages!==undefined&&!Array.isArray(result.messages))||(result.resultSizeEstimate!==undefined&&(!Number.isInteger(result.resultSizeEstimate)||result.resultSizeEstimate<0)))throw Error('gmail_history_unverified');
  if(result.nextPageToken||result.messages?.length||Number(result.resultSizeEstimate)>0)throw Error('existing_gmail_contact');
  if(result.messages===undefined&&result.resultSizeEstimate!==0)throw Error('gmail_history_unverified');
  return {gmail,proof:{checkedAt:new Date(now()).toISOString(),address,senderEmail:sender,clear:true}};
 }
 async function enrich(creator:any,evidence:any[]){
  if(verifiedCreatorEmail(creator,evidence,now()).address)return evidence;
  if(creator.status!=='new'||creator.link_status!=='source_confirmed'||!exactCreatorProfile(creator,creator.profile_url))return evidence;
  const c=await connection(creator.owner,'creator_meta');
  if(!c?.access_token||!c.selectedId||!Number.isFinite(Number(c.expires))||Number(c.expires)<=now()||c.tokenMode!=='facebook_login')return evidence;
  // Reuse the existing lookup budget. Never increase it or change account selection.
  await query(sb.rpc('sanji_creator_meta_claim',{p_owner:creator.owner,p_tag:'profile_'+creator.handle.replace(/[^a-z0-9_]/g,'_').slice(0,20),p_kind:'profile'}));
  const r=await instagramBusinessDiscovery({accountId:c.selectedId,token:c.access_token,handle:creator.handle,request,version:env('META_GRAPH_VERSION')||'v24.0'});
  if(r.state!=='verified'||typeof r.biography!=='string')throw Error('official_api_'+r.state);
  const emails=[...new Set((r.biography.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map((e:string)=>e.toLowerCase()))];
  const e={owner:creator.owner,creator_id:creator.id,source_provider:'instagram_official',source_kind:'public_bio',source_url:creator.profile_url,source_ref:'business_discovery',observation_key:await digest(r.biography+'|'+r.checkedAt),detail:{bio:r.biography,bio_source_url:creator.profile_url,bio_status:emails.length?'email_present':'email_not_in_bio',bio_checked_at:r.checkedAt,bio_content_available:true,emails}};
  await query(sb.from('sanji_creator_evidence').upsert(e,{onConflict:'owner,creator_id,source_kind,source_url,source_ref,observation_key',ignoreDuplicates:true}));
  return [...evidence,e];
 }
 async function hold(job:any,reason:string,plan?:any){
  const patch:any={status:'held',reason,lease_token:null,lease_until:null,updated:new Date(now()).toISOString()};
  if(plan)patch.snapshot=plan;
  await query(sb.from(prefix+'queue').update(patch).eq('owner',job.owner).eq('creator_id',job.creator_id).eq('status','processing').eq('lease_token',job.lease_token));
  return {status:'held',creator:job.creator_id,reason};
 }
 async function current(job:any){return await query(sb.from(prefix+'queue').select('status,outbox_id,reservation_token').eq('owner',job.owner).eq('creator_id',job.creator_id).maybeSingle());}
 async function finish(job:any,reservation:any,status:string,provider:any){
  try{return await query(sb.rpc(prefix+'finalize',{p_owner:job.owner,p_creator:job.creator_id,p_reservation:reservation.reservationToken,p_status:status,p_provider:provider}));}
  catch{
   // Gmail acceptance and a database receipt are separate outcomes. Never resend
   // because the receipt write timed out. Terminal state may already have committed.
   try{const q=await current(job);if(['accepted','rejected','outcome_unknown','cancelled'].includes(q?.status))return {status:q.status,creator:job.creator_id,reconciled:true};}catch{}
   return {status:'outcome_unknown',creator:job.creator_id,reason:'receipt_reconciliation_required'};
  }
 }
 async function processOne(owner:string){
  const rows=await query(sb.rpc(prefix+'claim',{p_owner:owner})),job=Array.isArray(rows)?rows[0]:rows;
  if(!job)return {status:'idle'};
  let reservation:any=null;
  try{
   const policy=await config(owner);
   if(!policy?.enabled||policy.revision!==job.policy_revision)return await hold(job,'authorization_changed');
   const creator=await query(sb.from('sanji_creator_recovery').select('*').eq('owner',owner).eq('id',job.creator_id).maybeSingle());
   if(!creator||creator.status!=='new')return await hold(job,'creator_not_new');
   const review=await query(sb.from('sanji_creator_contact_review').select('*').eq('owner',owner).eq('creator_id',creator.id).maybeSingle());
   if(review?.data?.email?.status==='hold'||['scheduled','sent','unknown'].includes(review?.data?.email?.observation?.status)||review?.data?.email?.observation?.humanReply)return await hold(job,'existing_outreach_or_hold');
   let evidence=await query(sb.from('sanji_creator_evidence').select('*').eq('owner',owner).eq('creator_id',creator.id).eq('source_kind','public_bio'));
   evidence=await enrich(creator,evidence);
   const records=await query(sb.from('sanji_records').select('id,kind,version,data').eq('owner',owner).in('kind',['settings','deal']).limit(501));
   if(records.length>500)return await hold(job,'catalog_requires_review');
   const settingsRows=records.filter((r:any)=>r.kind==='settings').sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id))),settings=settingsRows[0]?.data||{};
   const deals=records.filter((r:any)=>r.kind==='deal').map((r:any)=>({...r.data,id:r.id,version:r.version}));
   const plan:any=creatorEmailPlan({creator,evidence,deals,settings,policy,now:now(),requireClassification:false});
   if(!plan.eligible)return await hold(job,plan.reason);
   if(review?.data?.email?.body&&[review.data.email.body!==plan.body,review.data.email.subject!==plan.subject,clean(review.data.email.address).toLowerCase()!==plan.email.address,JSON.stringify(review.data.email.productIds)!==JSON.stringify([plan.product.id])].some(Boolean))return await hold(job,'existing_draft_needs_review',plan);
   const basis=await query(sb.from(prefix+'basis').select('*').eq('owner',owner).eq('creator_id',creator.id).eq('recipient',plan.email.address).maybeSingle());
   if(!creatorEmailBasis(basis,owner,creator.id,plan.email.address,policy.revision,plan.product.id,now()))return await hold(job,'recipient_basis_required',plan);
   if(policy.data.messageType!=='non_marketing'||!clean(policy.data.classificationSource))return await hold(job,'message_classification_required',plan);
   if(policy.send_enabled!==true||env('EMAIL_SENDING_ENABLED')!=='true')return await hold(job,'sending_disabled',plan);
   // First read precedes reservation; the second runs after reservation, directly
   // before the final one-use grant. Any new Gmail activity wins over the plan.
   const second=await history(owner,plan.email.address,policy.data.senderEmail);
   plan.gmailHistory=second.proof;
   const draft={channel:'email',proposalType:'creator_product_proposal',subject:plan.subject,body:plan.body,signature:'',signatureText:plan.signatureText,signatureHtml:plan.signatureHtml,attachments:[],attachmentSummary:[],dealIds:[plan.product.id],recipientMode:'primary',marketing:false,email:plan.email.address,emails:[plan.email.address],senderName:settings.senderName,targetName:plan.name,messageId:uuid(),replyRecipientNeedsReview:false,trackingRequested:false,tracking:{enabled:false,reason:'exact_approved_template'}};
   reservation=await query(sb.rpc(prefix+'reserve',{p_owner:owner,p_creator:creator.id,p_lease:job.lease_token,p_expected_updated:creator.updated,p_review_version:review?.version||0,p_plan:plan,p_draft:draft}));
   if(reservation?.duplicate||reservation?.status!=='reserved'||!reservation?.outbox?.id||!reservation?.draft||!reservation?.reservationToken)return {status:'held',creator:creator.id,reason:'reservation_reconciliation_required'};
   let ready:any;
   try{
    if(now()-Date.parse(second.proof.checkedAt)>60000||Date.parse(basis.expires_at)<=now())throw Error('preflight_expired');
    ready=await history(owner,plan.email.address,policy.data.senderEmail);
    const grant=await query(sb.rpc(prefix+'begin_send',{p_owner:owner,p_creator:creator.id,p_reservation:reservation.reservationToken,p_gmail_history:ready.proof}));
    if(grant?.ready!==true||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now()||now()-Date.parse(ready.proof.checkedAt)>60000||Date.parse(basis.expires_at)<=now())throw Error('preflight_expired');
   }catch{return await finish(job,reservation,'cancelled',{reason:'preflight_changed_no_send'});}
   // This process alone owns the newly returned one-use reservation. It never
   // creates legacy jobs, calls the legacy runner or sends a recovered reservation.
   let provider:any;
   try{
    provider=await remote('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+ready.gmail.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:mime(reservation.draft,ready.gmail.email)})});
    if(!provider||!['id','threadId'].every(k=>typeof provider[k]==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(provider[k])))throw Error('provider_receipt_missing');
   }catch(error:any){
    const rejected=[400,401,403,404,429].includes(error?.status);
    return await finish(job,reservation,rejected?'rejected':'outcome_unknown',{reason:rejected?'provider_rejected':'provider_outcome_unknown'});
   }
   return await finish(job,reservation,'accepted',{id:String(provider.id),threadId:clean(provider.threadId)});
  }catch(error:any){
   // A reservation RPC may have committed even though its response was lost.
   // Never recover its grant and send, and never downgrade it to retryable work.
   try{const q=await current(job);if(q&&['reserved','accepted','rejected','outcome_unknown'].includes(q.status))return {status:q.status==='accepted'?'accepted':'outcome_unknown',creator:job.creator_id,reason:'reservation_reconciliation_required'};}catch{return {status:'outcome_unknown',creator:job.creator_id,reason:'queue_reconciliation_required'};}
   const reason=/^(official_api_|existing_gmail_contact$|gmail_account_changed$|gmail_history_unverified$|gmail_reauth_required$)/.test(clean(error?.message))?error.message:'preparation_failed';
   try{await audit(owner,'creator_email_isolated_held',{creator:job.creator_id,reason});}catch{}
   return await hold(job,reason);
  }
 }
 async function run(maxItems=2,budgetMs=20000){
  const started=now(),results:any[]=[];
  const policies=await query(sb.from(prefix+'policy').select('owner').eq('enabled',true).order('owner').limit(2));
  // This deployment is authorized for one owner, not a multi-tenant mail service.
  if(policies.length>1)return {processed:0,accepted:0,held:0,uncertain:0,reason:'owner_scope_requires_review'};
  for(const p of policies){
   if(results.length>=maxItems||now()-started>=budgetMs)break;
   await query(sb.rpc(prefix+'sync',{p_owner:p.owner}));
   while(results.length<maxItems&&now()-started<budgetMs){const r=await processOne(p.owner);if(r.status==='idle')break;results.push(r);}
  }
  // No recipients, copy, provider IDs or internal exception payload in cron output.
  return {processed:results.length,accepted:results.filter(r=>r.status==='accepted').length,held:results.filter(r=>['held','cancelled'].includes(r.status)).length,uncertain:results.filter(r=>r.status==='outcome_unknown').length};
 }
 return {processOne,run};
}
