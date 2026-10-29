import {selectedBrandTemplate} from './outbound-profile.ts';
import {planAutomaticBrand} from './brand-auto-plan.ts';
import {assessDispatch,permanentFailureEmails} from './mail-integrity.ts';
import {companyIdentity} from './discovery.ts';
import {mailContent} from './mail-content.ts';
import {gmailSignature} from './gmail-signature.ts';
export function brandAutoService({sb,query,env,connection,emailTracking,digest,uuid,audit}:any){
 async function config(owner:string){return await query(sb.from('sanji_brand_auto_config').select('*').eq('owner',owner).maybeSingle())||{enabled:false,enabled_at:null,message_type:'unconfirmed'};}
 async function setConfig(owner:string,enabled:boolean,messageType:string){const current=await config(owner);if(enabled&&!['non_marketing','marketing'].includes(messageType))throw Error('메일 유형을 선택하세요.');const record={owner,enabled,message_type:enabled?messageType:(current.message_type||'unconfirmed'),enabled_at:enabled?(current.enabled?current.enabled_at:new Date().toISOString()):null,updated:new Date().toISOString()};await query(sb.from('sanji_brand_auto_config').upsert(record,{onConflict:'owner'}));await audit(owner,'brand_auto_config_changed',{enabled,messageType:record.message_type,enabledAt:record.enabled_at});return record;}
 async function process(owner:string){
  const cfg=await config(owner);if(!cfg.enabled||!cfg.enabled_at)return {status:'disabled'};
  if(env('EMAIL_SENDING_ENABLED')!=='true')return {status:'email_disabled'};
  const gmail=await connection(owner,'gmail');if(!gmail?.email)return {status:'gmail_not_connected'};const gmailStatus=await query(sb.from('sanji_connections').select('summary').eq('owner',owner).eq('provider','gmail').maybeSingle());if(gmailStatus?.summary?.reauthRequired)return {status:'gmail_reauth_required'};if(!['non_marketing','marketing'].includes(cfg.message_type))return {status:'message_type_required'};const marketing=cfg.message_type==='marketing';
  const rows=await query(sb.from('sanji_discovery_leads').select('*').eq('owner',owner).eq('status','review').gte('data->>firstEmailAt',cfg.enabled_at).order('updated',{ascending:false}).limit(500));
  if(!rows.length)return {status:'idle'};
  const template=await selectedBrandTemplate(sb,query,owner);
  const settingsRows=await query(sb.from('sanji_records').select('data').eq('owner',owner).eq('kind','settings').limit(1));const settings=settingsRows[0]?.data||{};
  if(!settings.senderName||!settings.senderPhone||(marketing&&!settings.senderAddress))return {status:'sender_information_required'};let richSignature:any=null;if(settings.signatureSource==='gmail'){if(gmail.email.toLowerCase()!==String(settings.gmailSignatureEmail||'').toLowerCase())return {status:'gmail_signature_account_changed'};const sig=gmailSignature(settings.gmailSignatureHtml||'');if(sig.text===String(settings.emailSignature||'').trim())richSignature=sig;}
  if(template?.data?.attachments?.length)return {status:'template_attachments_need_review'};
  const candidates=await query(sb.from('sanji_records').select('data').eq('owner',owner).eq('kind','candidate'));const failures=await query(sb.from('sanji_brand_auto_failures').select('*').eq('owner',owner));
  const threads=await query(sb.from('sanji_records').select('data').eq('owner',owner).eq('kind','thread'));const suppression=await query(sb.from('sanji_suppression').select('identity,reason').eq('owner',owner));
  for(const lead of rows){
   const failure=failures.find((x:any)=>x.lead_id===lead.id);if(failure&&(Number(failure.attempts)>=2||Date.parse(failure.next_attempt||'')>Date.now()))continue;
   const plan=planAutomaticBrand({lead,template,enabledSince:cfg.enabled_at,threads,suppression});if(!plan.eligible)continue;
   if(marketing&&!plan.copy.subject.startsWith('(광고)'))continue;const data=lead.data,contact=plan.contacts[0],company=String(plan.copy.brandName||data.name||'').trim(),key=companyIdentity(data.company||company);if(!key||!contact?.source||!contact.checked)continue;if(candidates.some((r:any)=>companyIdentity(r.data?.companyKey||r.data?.legalCompanyName||r.data?.company||'')===key||(r.data?.recipientEmails||[]).some((e:any)=>String(e).toLowerCase()===plan.emails[0].toLowerCase())||String(r.data?.contact?.email||'').toLowerCase()===plan.emails[0].toLowerCase()))continue;
   const target=uuid(),email=plan.emails[0];const candidate={name:company,company,legalCompanyName:data.company||'',companyKey:key,kind:'브랜드',product:String(plan.copy.productName||'').slice(0,200),category:'미확인',classification:'개별 제품의 법적 분류 확인 필요',authority:'판매·유통 권한 별도 확인 필요',website:data.website||'',channels:data.channel||'',recipientEmails:[email],contact:{email,owner:company,source:contact.source,checked:contact.checked.slice(0,10),purpose:contact.purpose==='사업 제휴'?'사업 제휴':'비즈니스',verified:true,verification:contact.verification},handle:'',profile:'',agency:'',topics:[],followers:null,metricsSource:'',metricsChecked:'',evidence:[{url:contact.source,checked:contact.checked.slice(0,10),description:contact.context||''}],reason:'공식 출처 검증 및 브랜드 자동 예약 설정에 따른 제안',status:'미접촉',note:'자동 예약 · 발굴 출처 '+String(data.source||''),next:'회신 확인',due:'',owner:''};
   let body=mailContent(plan.copy.body,plan.copy.signature,settings,true,marketing);const input={target,dealIds:[],channel:'email',subject:plan.copy.subject,body,signature:plan.copy.signature,attachments:[],templateId:plan.templateId,templateVersion:plan.templateVersion,recipientMode:'primary',trackingRequested:undefined,trackingNoticeAcknowledged:undefined,trackingInternalTest:false,lawfulBasis:'',marketing};
   const notice=await emailTracking.withNotice(owner,input,body,'brand');body=notice.body;const tracking=await emailTracking.preview(owner,{...notice.input,body},'brand');
   const draft={...notice.input,tracking,autoOutreach:plan.copy,...(richSignature?{signatureText:richSignature.text,signatureHtml:richSignature.html}:{}),subject:plan.copy.subject,body,email,emails:[email],replyRecipientNeedsReview:false,senderName:settings.senderName,targetName:company,targetVersion:1,dealVersions:[],messageId:uuid(),attachmentSummary:[]};
   const check=assessDispatch(draft,candidate,{...lead,data:{...data,outreach:plan.copy}},permanentFailureEmails(threads,suppression));if(!check.allowed)continue;
   if(!draft.subject||draft.subject.length>200||!draft.body||draft.body.length>15000||/[\r\n]/.test(draft.subject)||/\{\{/.test(draft.subject+draft.body)||/치료|예방|완치|항암|효능.{0,4}보장|혈당.{0,5}(낮|개선)/.test(draft.subject+draft.body))continue;
   const hash=await digest(JSON.stringify(draft));
   try{return await query(sb.rpc('sanji_brand_auto_commit',{p_owner:owner,p_lead:lead.id,p_lead_updated:lead.updated,p_candidate:target,p_company_key:key,p_candidate_data:candidate,p_draft_data:draft,p_hash:hash,p_run_at:plan.runAt}));}
   catch(e:any){const attempts=Number(failure?.attempts||0)+1;await query(sb.from('sanji_brand_auto_failures').upsert({owner,lead_id:lead.id,attempts,next_attempt:new Date(Date.now()+15*60000).toISOString(),updated:new Date().toISOString()},{onConflict:'owner,lead_id'}));await audit(owner,'brand_auto_schedule_failed',{lead:lead.id,error:String(e.message||'예약 실패').slice(0,250)});return {status:'failed',reason:'예약 실패 · 기존 예약 확인 후 다음 실행에서 재검토'};}
  }
  return {status:'review_pending'};
 }
 return {config,setConfig,process};
}
