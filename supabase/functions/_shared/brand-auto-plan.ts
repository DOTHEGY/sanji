import {assessMailLead,permanentFailureEmails} from './mail-integrity.ts';
import {leadOutreach} from './mail-template.ts';
import {brandNextSafeSlot} from './brand-auto-schedule.ts';
import {mailRecipients} from './mail-recipients.ts';
// Pure gate for newly discovered brands; never reserves or dispatches by itself.
export function planAutomaticBrand({lead,template,enabledSince,now=new Date(),threads=[],suppression=[]}:any){
 if(!enabledSince||!Number.isFinite(Date.parse(enabledSince)))return {eligible:false,reason:'자동 예약이 꺼져 있습니다.'};
 const data=lead?.data||lead||{},discovered=data.firstEmailAt;
 if(!discovered||!Number.isFinite(Date.parse(discovered))||Date.parse(discovered)<Date.parse(enabledSince))return {eligible:false,reason:'활성화 이전 또는 발견 시각 미확인'};
 if(Date.parse(discovered)>new Date(now).getTime())return {eligible:false,reason:'발견 시각이 미래입니다.'};
 if(lead?.status==='blocked'||data.duplicateNote)return {eligible:false,reason:'중복 또는 차단된 업체'};
 if(!template?.id||!template?.version||template?.data?.channel!=='이메일'||!['brand_proposal','brand_auto_profile',undefined].includes(template.data.purpose))return {eligible:false,reason:'브랜드 이메일 템플릿이 없습니다.'};
 const refreshed=leadOutreach(template,data,new Date(now).toISOString());
 const enriched={...data,outreach:refreshed},review=assessMailLead(enriched,permanentFailureEmails(threads,suppression));
 if(!review.allowed)return {eligible:false,reason:'검토 대기: '+review.reasons.join(' / ')};
 const blocked=new Set(suppression.map((s:any)=>String(s.identity||'').replace(/^email:/,'').toLowerCase()));
 const emails=mailRecipients({emails:review.contacts.map((c:any)=>c.email)}).filter((e:string)=>!blocked.has(e.toLowerCase()));
 if(!emails.length)return {eligible:false,reason:'검증된 수신 이메일 없음 또는 수신 거부'};
 if(!refreshed.subject||!refreshed.body||/\{\{/.test(refreshed.subject+refreshed.body)||/치료|예방|완치|항암|효능.{0,4}보장|혈당.{0,5}(낮|개선)/.test(refreshed.subject+refreshed.body))return {eligible:false,reason:'템플릿 변수 또는 표현 확인 필요'};
 const contacts=review.contacts.filter((c:any)=>emails.includes(c.email));const qualifiedAt=Math.max(Date.parse(discovered),Date.parse(contacts[0].checked));if(!Number.isFinite(qualifiedAt)||qualifiedAt>new Date(now).getTime())return {eligible:false,reason:'유효 연락처 확인 시각 미확인'};
 return {eligible:true,leadId:lead.id,discoveredAt:new Date(qualifiedAt).toISOString(),runAt:brandNextSafeSlot(qualifiedAt,now),emails,contacts,copy:refreshed,templateId:template.id,templateVersion:template.version};
}
