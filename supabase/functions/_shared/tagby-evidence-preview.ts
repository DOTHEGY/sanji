// Preview hashes protect the reviewed payload from accidental change; they do
// not authenticate the source or replace inspecting the original export.
const keys=['handle','sender','provider_status','campaign_id','campaign_url','sheet','sheet_row','evidence_sha256','sent_at_display','observed_at'];
export function normalizeTagbyRows(value:any){
 if(!Array.isArray(value)||value.length<1||value.length>200)throw Error('근거 행 확인 필요');
 return value.map((r:any)=>{if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k)))throw Error('근거 행 확인 필요');
  const handle=typeof r.handle==='string'?r.handle.toLowerCase():'',campaign=Number(r.campaign_id),row=Number(r.sheet_row),at=typeof r.observed_at==='string'?r.observed_at:'',observed=Date.parse(at);
  if(!/^[a-z0-9._]{1,30}$/.test(handle)||['.','..','valu_est'].includes(handle)||r.sender!=='valu_est'||r.provider_status!=='SUCCESS'||!Number.isSafeInteger(campaign)||campaign<1||campaign>999999999999||r.campaign_url!=='https://tagby.io/tools/instagram/dm/'+campaign||r.sheet!=='발송 내역'||!Number.isSafeInteger(row)||row<1||row>9999999||typeof r.evidence_sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.evidence_sha256)||typeof r.sent_at_display!=='string'||!/^\d{4}\.\d{2}\.\d{2}\. (오전|오후) \d{1,2}:\d{2}$/.test(r.sent_at_display)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(at)||!Number.isFinite(observed)||observed>Date.now()+300000||observed<Date.parse('2000-01-01T00:00:00Z'))throw Error('근거 행 확인 필요');
  return {handle,sender:'valu_est',provider_status:'SUCCESS',campaign_id:campaign,campaign_url:r.campaign_url,sheet:'발송 내역',sheet_row:row,evidence_sha256:r.evidence_sha256,sent_at_display:r.sent_at_display,observed_at:at};
 });
}
export async function tagbyPreviewHash(owner:string,account:string,rows:any[]){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['tagby-import-preview-v1',owner,account,rows])));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
