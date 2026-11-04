import {unsafeContactReason} from './contact-safety.ts';
import {gmailSignature} from './gmail-signature.ts';

const text=(v:any)=>String(v||'').trim();
const fresh=(v:any,now:number)=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=now+60000&&Date.parse(v)>=now-30*86400000;
export function exactCreatorProfile(creator:any,url:string){
 try {const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['instagram.com','www.instagram.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'').toLowerCase()==='/'+text(creator.handle).toLowerCase();} catch{return false;}
}
// Publication is evidence of an advertised contact, never proof of inbox deliverability.
export function verifiedCreatorEmail(creator:any,evidence:any[],now=Date.now()){
 if(creator.status!=='new'||creator.link_status!=='source_confirmed'||!exactCreatorProfile(creator,creator.profile_url))return {reason:'creator_identity_unverified'};
 const rows=evidence.filter(e=>e.creator_id===creator.id&&e.owner===creator.owner&&e.source_kind==='public_bio'&&['instagram_official','instagram_public'].includes(e.source_provider)&&e.source_url===creator.profile_url&&e.detail?.bio_source_url===creator.profile_url&&e.detail?.bio_content_available===true&&fresh(e.detail?.bio_checked_at,now)).sort((a,b)=>Date.parse(b.detail.bio_checked_at)-Date.parse(a.detail.bio_checked_at));
 if(!rows.length)return {reason:'fresh_public_bio_required'};
 const source=rows[0],bio=text(source.detail.bio),addresses=[...new Set((bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(e=>e.toLowerCase()))].filter(e=>!unsafeContactReason(e,bio));
 if(addresses.length!==1)return {reason:addresses.length?'multiple_public_emails':'email_not_public'};
 if(!Array.isArray(source.detail.emails)||!source.detail.emails.map((x:any)=>text(x).toLowerCase()).includes(addresses[0]))return {reason:'email_evidence_mismatch'};
 return {address:addresses[0],sourceUrl:creator.profile_url,bio,checkedAt:source.detail.bio_checked_at,source};
}
const groups=[
 {key:'wellness',creator:/웰니스|건강|운동|헬스|식단|다이어트|피트니스|러닝|요가|필라테스|wellness|fitness|workout/i,product:/웰니스|건강|단백|프로틴|비타|유산균|영양|저당|식이섬유|오메가|효소|콜라겐|미네랄|발효밀|바이옴|뉴트라|코큐|메가3|옥타비|화이토/i},
 {key:'food',creator:/푸드|식품|요리|레시피|식단|주방|집밥|food|cook|recipe/i,product:/식품|푸드|건강|저당|곡물|견과|단백|영양|간식|음료|커피|차|티백|주스|그릭|프로틴|페스토|올리브유|파스타|브레드|발효밀|미네랄/i},
 {key:'beauty',creator:/뷰티|미용|피부|beauty|skincare/i,product:/콜라겐|미네랄|이너뷰티|비타/i},
 {key:'lifestyle',creator:/라이프|일상|살림|육아|엄마|living|lifestyle/i,product:/미네랄 워터|소금|올리브유|곡물|페스토|파스타/i},
 {key:'baking',creator:/베이킹|디저트|제과|제빵|baking/i,product:/베이킹|디저트|제과|제빵|쿠키|초콜릿/i},
 {key:'coffee',creator:/커피|카페|바리스타|coffee|barista/i,product:/커피|디카페인|티백|원두|coffee/i}
];
export function selectCreatorProduct(creator:any,deals:any[]){
 const context=[creator.category,creator.bio].map(text).join(' '),ranked=deals.filter(d=>['확정','협의 중'].includes(d.state)&&text(d.name)&&!/[\[\]]|정기배송|정기구독|샴푸|비누|트리트먼트|페이셜|바디바|암 극복|도서/.test(d.name)&&/^https:\/\//.test(text(d.productUrl))).map(d=>{
  const desc=[d.category,d.name,d.description,d.target,(d.topics||[]).join(' ')].map(text).join(' '),matched=groups.filter(g=>g.creator.test(context)&&g.product.test(desc));
  const score=matched.reduce((n,g)=>n+(g.key==='wellness'?8:['food','lifestyle'].includes(g.key)?3:6),0)+(matched.length&&/웰니스|건강|단백|프로틴|저당|영양/.test(desc)?2:0);
  return {deal:d,score,matched:matched.map(g=>g.key)};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Number(b.deal.state==='확정')-Number(a.deal.state==='확정')||String(a.deal.id).localeCompare(String(b.deal.id)));
 return ranked[0]||null;
}
export function creatorEmailPlan({creator,evidence,deals,settings,policy,now=Date.now(),requireClassification=true}:any){
 const hold=(reason:string)=>({eligible:false,reason});
 if(!policy?.enabled||!text(policy.authorization_source)||!Number.isInteger(policy.revision))return hold('authorization_required');
 const p=policy.data||{};
 const classified=['non_marketing','marketing'].includes(p.messageType)&&!!text(p.classificationSource);
 if(requireClassification&&!classified)return hold('message_classification_required');
 if(p.recipientClaimsConfirmed!==true||!text(p.claimsSource))return hold('recipient_claims_confirmation_required');
 if(creator.entity_type==='noncreator_suspected')return hold('not_creator');
 const email=verifiedCreatorEmail(creator,evidence,now);if(!email.address)return hold(email.reason!);
 const selection=selectCreatorProduct({...creator,bio:email.bio},deals);if(!selection)return hold('matching_live_product_required');
 if(settings.signatureSource!=='gmail'||text(settings.gmailSignatureEmail).toLowerCase()!==text(p.senderEmail).toLowerCase()||settings.gmailSignatureNeedsConsent)return hold('gmail_signature_required');
 const sig=gmailSignature(settings.gmailSignatureHtml||'');
 if(!sig.text||sig.text!==text(settings.emailSignature)||sig.html!==p.signatureHtml||sig.text!==p.signatureText)return hold('approved_signature_changed');
 if(!settings.senderName||!settings.senderPhone)return hold('sender_information_required');
 const name=text(creator.nickname)||text(creator.handle),product=selection.deal;
 if(/[\r\n\[\]{}<>]/.test(name+product.name)||name.length>100||text(product.name).length>200)return hold('unsafe_personalization');
 const render=(v:any)=>text(v).replaceAll('[인플루언서명]',name).replaceAll('[상품명]',product.name);
 const subject=render(p.subject),base=render(p.body),body=base+'\n\n'+sig.text;
 if(!subject||!base||subject.length>200||body.length>15000||/[\r\n]/.test(subject)||/\{\{|\[[^\]]+\]/.test(subject+body))return hold('invalid_approved_template');
 if(/치료|예방|완치|항암|효능.{0,4}보장|혈당.{0,5}(낮|개선)/.test(subject+body))return hold('unsupported_medical_claim');
 if(requireClassification&&p.messageType==='marketing'&&(!subject.startsWith('(광고)')||!settings.senderAddress||!body.includes(settings.senderAddress)||!body.includes(settings.optOut||'회신으로 수신 거부를 요청하실 수 있습니다.')))return hold('marketing_requirements_need_approval');
 return {eligible:true,email,product,match:selection.matched,name,subject,body,signatureText:sig.text,signatureHtml:sig.html,marketing:classified?p.messageType==='marketing':null,classificationPending:!classified,policyRevision:policy.revision};
}
