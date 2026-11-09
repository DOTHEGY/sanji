import {createHash} from 'node:crypto';
import {RECIPIENT_CRITERIA,emailIdentity,OutreachError,renderOutreachCopy,sourceUrl} from './domain.mjs';
import {validateInlineImages} from './inline-mail.mjs';
import {gmailSignature} from '../_shared/gmail-signature.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw new OutreachError(code,'캠페인 원본·서명·사진·검토 범위를 확인해야 합니다.',409);};
export const CAMPAIGN_CLASSIFICATIONS=Object.freeze(['solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal']);
export function stableJSON(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))fail('INVALID_PRIVATE_CONFIGURATION');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';
 if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJSON(value[k])).join(',')+'}';
 fail('INVALID_PRIVATE_CONFIGURATION');
}
export const hashValue=value=>createHash('sha256').update(typeof value==='string'?value:stableJSON(value)).digest('hex');
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('INVALID_PRIVATE_CONFIGURATION');};
const safeText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;

export function settingsSignature(settings,connection){
 const d=settings?.data||{},email=String(d.gmailSignatureEmail||'').trim().toLowerCase();
 if(!UUID.test(settings?.id||'')||!Number.isSafeInteger(settings.version)||settings.version<1||d.signatureSource!=='gmail'||d.gmailSignatureNeedsConsent===true||!emailIdentity(email)||email!==String(connection?.summary?.email||'').toLowerCase()||connection?.summary?.reauthRequired===true||!safeText(d.senderName,200)||/[\r\n]/.test(d.senderName))fail('CURRENT_GMAIL_SIGNATURE_REQUIRED');
 const signature=gmailSignature(d.gmailSignatureHtml||'');
 if(!signature.text||signature.text!==d.emailSignature||signature.html!==d.gmailSignatureHtml)fail('CURRENT_GMAIL_SIGNATURE_CHANGED');
 return {verified:true,source:'existing_gmail_signature',senderEmail:email,html:signature.html,text:signature.text,settingsId:settings.id,settingsVersion:settings.version,senderName:d.senderName};
}
export function requireRecipientCriteria(snapshot){
 if(snapshot?.version!==2)fail('RECIPIENT_CRITERIA_REVIEW_REQUIRED');
 const criteria=snapshot.recipientCriteria;keys(criteria,[...Object.keys(RECIPIENT_CRITERIA),'approvalSource']);
 if(!safeText(criteria.approvalSource,4000))fail('RECIPIENT_CRITERIA_REVIEW_REQUIRED');
 const {approvalSource,...scope}=criteria;if(stableJSON(scope)!==stableJSON(RECIPIENT_CRITERIA))fail('RECIPIENT_CRITERIA_CHANGED');
 return criteria;
}
function scopeOf(snapshot){
 return {...(snapshot.version===2?{recipientCriteria:snapshot.recipientCriteria}:{}),templateRevision:snapshot.template.revision,templateHash:hashValue(snapshot.template),signatureHash:hashValue(snapshot.signature),products:snapshot.products,...(snapshot.productMode==='approved_campaign_assets'?{productMode:snapshot.productMode,campaignProducts:snapshot.campaignProducts}:{}),images:snapshot.template.requiredInlineImageIds.map(id=>{const x=snapshot.images.find(i=>i.id===id);return {id:x.id,sha256:x.sha256,bytes:x.bytes};})};
}
function validateSnapshotData(data,owner){
 keys(data,['version','owner','template','signature','images','products','productMode','campaignProducts','recipientCriteria','scopeHash','contentHash']);
 if(![1,2].includes(data.version)||data.owner!==owner||!UUID.test(owner))fail('PRIVATE_SNAPSHOT_OWNER_MISMATCH');
 if(data.version===2)requireRecipientCriteria(data);else if(data.recipientCriteria!==undefined)fail('RECIPIENT_CRITERIA_CHANGED');
 keys(data.template,['owner','revision','approved','approvalSource','subject','body','requiredInlineImageIds']);
 if(data.template.owner!==owner||!Number.isSafeInteger(data.template.revision)||data.template.revision<1)fail('TEMPLATE_REVISION_REQUIRED');
 keys(data.signature,['verified','source','senderEmail','html','text','settingsId','settingsVersion','senderName']);
 if(!UUID.test(data.signature.settingsId||'')||!Number.isSafeInteger(data.signature.settingsVersion)||data.signature.settingsVersion<1||!safeText(data.signature.senderName,200)||/[\r\n]/.test(data.signature.senderName))fail('CURRENT_GMAIL_SIGNATURE_REQUIRED');
 if(!Array.isArray(data.images)||data.images.length!==2)fail('INLINE_IMAGES_REQUIRED');
 for(const image of data.images)keys(image,['id','owner','verified','sharingApproved','mimeType','content','bytes','sha256','width','height','alt']);
 validateInlineImages(data.images,{owner,requiredIds:data.template.requiredInlineImageIds});
 if(!Array.isArray(data.products)||![0,2].includes(data.products.length)||new Set(data.products.map(x=>x.id)).size!==data.products.length)fail('PRODUCT_SCOPE_REQUIRED');
 for(const product of data.products){keys(product,['id','version','sha256']);if(!UUID.test(product.id||'')||!Number.isSafeInteger(product.version)||product.version<1||!HASH.test(product.sha256||''))fail('PRODUCT_SCOPE_REQUIRED');}
 if(data.productMode==='approved_campaign_assets'){
  if(data.products.length||!Array.isArray(data.campaignProducts)||data.campaignProducts.length!==2||new Set(data.campaignProducts.map(p=>p.name)).size!==2)fail('CAMPAIGN_PRODUCT_ASSETS_REQUIRED');
  // The user approved the two photographs together. Bind them jointly through
  // scopeHash, without inferring a photograph-to-SKU mapping or extra facts.
  for(const product of data.campaignProducts){keys(product,['name','approvalSource']);if(!['마라쫀득빵','짬뽕쫀득빵'].includes(product.name)||!safeText(product.approvalSource,2000))fail('CAMPAIGN_PRODUCT_ASSETS_CHANGED');}
 }else if(data.productMode!==undefined&&data.productMode!=='catalog'||data.campaignProducts!==undefined)fail('PRODUCT_SCOPE_REQUIRED');
 renderOutreachCopy({template:data.template,channelName:'검증 채널',signature:data.signature,inlineImages:data.images});
 const sanitized=gmailSignature(data.signature.html);
 if(sanitized.text!==data.signature.text||sanitized.html!==data.signature.html)fail('CURRENT_GMAIL_SIGNATURE_CHANGED');
 if(data.scopeHash!==hashValue(scopeOf(data)))fail('CAMPAIGN_SCOPE_CHANGED');
 const {contentHash,...content}=data;if(!HASH.test(contentHash||'')||contentHash!==hashValue(content))fail('PRIVATE_SNAPSHOT_HASH_MISMATCH');
 return data;
}

// The browser's "verified" flags are not evidence of a stored Gmail signature.
// Current account/settings and product digests are supplied by server-side reads.
export function createPrivateSnapshot(input,{owner,settings,connection,products}){
 keys(input,['version','owner','template','signature','images','products','productMode','campaignProducts','recipientCriteria','scopeHash','contentHash']);
 if(input.owner!==owner)fail('PRIVATE_SNAPSHOT_OWNER_MISMATCH');
 requireRecipientCriteria(input);
 const signature=settingsSignature(settings,connection);
 if(input.signature&&stableJSON(input.signature)!==stableJSON(signature))fail('CURRENT_GMAIL_SIGNATURE_CHANGED');
 if(!Array.isArray(input.products)||!Array.isArray(products)||products.length!==input.products.length)fail('PRODUCT_SCOPE_REQUIRED');
 const selected=input.products.map(p=>{keys(p,['id','version','sha256']);const current=products.find(r=>r.id===p.id);if(!current||current.version!==p.version||!HASH.test(current.sha256||'')||(p.sha256&&p.sha256!==current.sha256))fail('PRODUCT_SCOPE_CHANGED');return {id:p.id,version:p.version,sha256:current.sha256};});
 const data=JSON.parse(JSON.stringify({version:input.version,owner,...(input.recipientCriteria!==undefined?{recipientCriteria:input.recipientCriteria}:{}),template:input.template,signature,images:input.images,products:selected,...(input.productMode!==undefined?{productMode:input.productMode}:{}),...(input.campaignProducts!==undefined?{campaignProducts:input.campaignProducts}:{})}));
 data.scopeHash=hashValue(scopeOf(data));data.contentHash=hashValue(data);
 if((input.scopeHash&&input.scopeHash!==data.scopeHash)||(input.contentHash&&input.contentHash!==data.contentHash))fail('PRIVATE_SNAPSHOT_HASH_MISMATCH');
 return validateSnapshotData(data,owner);
}
export function verifyPrivateSnapshot(row,owner){
 if(row?.owner!==owner||!UUID.test(row.id||'')||!HASH.test(row.sha256||''))fail('PRIVATE_SNAPSHOT_OWNER_MISMATCH');
 // The database supplies an independent immutable row hash. contentHash and
 // each image digest protect the bytes consumed by the MIME composer as well.
 const data=validateSnapshotData(row.data,owner);
 if(row.sha256!==hashValue(data))fail('PRIVATE_SNAPSHOT_HASH_MISMATCH');
 return data;
}
export function campaignPolicy(input={}){
 keys(input,['classification','classificationSource','authorizationSource','schedule']);
 const classification=input.classification||'pending_review';
 if(![...CAMPAIGN_CLASSIFICATIONS,'pending_review','marketing'].includes(classification))fail('MESSAGE_CLASSIFICATION_REQUIRED');
 if(input.classificationSource!==undefined&&typeof input.classificationSource!=='string'||input.authorizationSource!==undefined&&typeof input.authorizationSource!=='string')fail('INVALID_PRIVATE_CONFIGURATION');
 const schedule=input.schedule||{timezone:'Asia/Seoul',hour:9,minute:0,confirmed:false};keys(schedule,['timezone','hour','minute','confirmed']);
 if(schedule.timezone!=='Asia/Seoul'||!Number.isInteger(schedule.hour)||schedule.hour<0||schedule.hour>23||!Number.isInteger(schedule.minute)||schedule.minute<0||schedule.minute>59||typeof schedule.confirmed!=='boolean')fail('SCHEDULE_REVIEW_REQUIRED');
 return {classification,classificationSource:(input.classificationSource||'').trim().slice(0,2000),authorizationSource:(input.authorizationSource||'').trim().slice(0,2000),schedule:{...schedule}};
}
export function recipientBasis(basis,{owner,candidate,policy,snapshot,now=Date.now()}){
 const expectedKind=policy.data?.classification==='solicited_non_marketing_proposal'?'solicited_proposal':'documented_business_proposal';
 return Boolean(basis&&basis.owner===owner&&basis.creator_key===candidate.creator_key&&basis.recipient===candidate.recipient&&basis.status==='approved'&&basis.kind===expectedKind&&CAMPAIGN_CLASSIFICATIONS.includes(basis.classification)&&basis.classification===policy.data?.classification&&basis.approved_by===owner&&basis.policy_revision===policy.revision&&basis.snapshot_id===snapshot.id&&basis.snapshot_hash===snapshot.sha256&&safeText(basis.approval_source,2000)&&safeText(basis.classification_source,2000)&&sourceUrl(basis.source_url)&&safeText(basis.source_text,4000)&&Number.isFinite(Date.parse(basis.verified_at))&&Date.parse(basis.verified_at)<=now&&Date.parse(basis.verified_at)>=now-30*86400000&&Date.parse(basis.expires_at)>now);
}
