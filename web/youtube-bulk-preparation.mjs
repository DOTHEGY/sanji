import {emailIdentity} from '../supabase/functions/creator-daily-outreach/domain.mjs';
export const HOLD_REASONS=Object.freeze({RECIPIENT_REVIEW_REQUIRED:'채널 정보 불일치',PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED:'저장된 연락처 출처 불일치',IDENTITY_AMBIGUOUS:'중복 채널 또는 공유 이메일',HISTORY_ORIGIN_UNVERIFIED:'기존 발송 기록의 작업 출처 불명',WORK_ALREADY_SENT_OR_PENDING:'이미 발송 또는 대기 중',RECIPIENT_BLOCKED:'수신거부·거절 또는 차단',RECIPIENT_MCN_EXCLUDED:'기존 제외 또는 MCN 관리 연락처',DUPLICATE_RECIPIENT:'같은 채널·수신함 중복'});
const fail=code=>Object.assign(new Error(code),{code});
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const body=(recipients,expectedRevision,scope)=>({expectedRevision,recipients,scope});
// These are request resource boundaries, never a limit on the user's total selection.
export function chunkManualRecipients(recipients,expectedRevision,scope){
 const chunks=[];let chunk=[];
 for(const row of recipients){
  if(bytes(body([row],expectedRevision,scope))>32768)throw fail('RECIPIENT_REQUEST_TOO_LARGE');
  if(chunk.length===100||bytes(body([...chunk,row],expectedRevision,scope))>32768){chunks.push(chunk);chunk=[];}
  chunk.push(row);
 }
 if(chunk.length)chunks.push(chunk);return chunks;
}
export async function prepareManualBatches({recipients,expectedRevision,scope,request,current,validate,onProgress=()=>{},now=Date.now}){
 const snapshot=structuredClone(recipients),scopeSnapshot=structuredClone(scope),held=[],unique=[],ids=new Set(),emails=new Set(),batches=[];
 for(const row of snapshot){const email=emailIdentity(row?.email);if(!row||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||!email)throw fail('INVALID_SELECTION');if(ids.has(row.id)||emails.has(email)){held.push({...row,code:'DUPLICATE_RECIPIENT'});continue;}ids.add(row.id);emails.add(email);unique.push(row);}
 const queue=chunkManualRecipients(unique,expectedRevision,scopeSnapshot),check=()=>{if(!current())throw fail('PREPARATION_CANCELLED');if(batches.some(b=>now()>=b.expiresAt))throw fail('PREPARATION_EXPIRED');};
 const progress=()=>onProgress({held:[...held],prepared:batches.reduce((n,b)=>n+b.recipients.length,0),remaining:queue.reduce((n,c)=>n+c.length,0)});
 progress();
 while(queue.length){check();const selected=queue[0],startedAt=now();let result;
  try{result=await request('/preview',body(selected,expectedRevision,scopeSnapshot));check();}
  catch(error){check();const matches=typeof error?.candidateId==='string'&&error.candidateId?selected.filter(r=>r.id===error.candidateId):[];
   if(Object.hasOwn(HOLD_REASONS,error?.code)&&matches.length===1){held.push({...matches[0],code:error.code});queue[0]=selected.filter(r=>r.id!==error.candidateId);if(!queue[0].length)queue.shift();progress();continue;}
   // This code means the server rejected the oversized review before creating a batch.
   if(error?.code==='PREVIEW_PAYLOAD_TOO_LARGE'&&selected.length>1){const middle=Math.ceil(selected.length/2);queue.splice(0,1,selected.slice(0,middle),selected.slice(middle));progress();continue;}
   throw error;
  }
  await validate(result,selected);check();
  if(batches.some(b=>b.result.batchId===result.batchId))throw fail('PREVIEW_BATCH_MISMATCH');
  batches.push({result,recipients:selected,expiresAt:startedAt+15*60*1000});queue.shift();progress();
 }
 check();if(batches.some(b=>now()>=b.expiresAt))throw fail('PREPARATION_EXPIRED');
 return {batches,held,total:batches.reduce((n,b)=>n+b.recipients.length,0)};
}
export async function scheduleManualBatches({prepared,expectedRunAt,request,current,onProgress=()=>{},now=Date.now}){
 // One call is one explicit user authorization. Its caller must remain single-flight.
 const states=prepared.batches.map(b=>({batchId:b.result.batchId,count:b.recipients.length,state:'not_requested'}));
 const report=()=>onProgress(states.map(x=>({...x})));report();
 for(let i=0;i<prepared.batches.length;i++){
  const batch=prepared.batches[i],row=states[i],approval={batchId:batch.result.batchId,approvalHash:batch.result.approvalHash};
  if(!current()){row.state='stopped';report();break;}
  if(now()>=batch.expiresAt){row.state='expired';report();break;}
  row.state='confirming';report();
  try{const result=await request('/confirm',approval);if(result?.status!=='confirmed'||result.sendingEnabled!==false)throw fail('CONFIRM_MISMATCH');}catch{row.state='confirm_unknown';report();break;}
  if(!current()){row.state='confirmed_not_scheduled';report();break;}
  if(now()>=batch.expiresAt){row.state='expired';report();break;}
  row.state='scheduling';report();
  try{const result=await request('/schedule',{...approval,expectedRunAt});
   if(result?.state!=='scheduled'||Date.parse(result.runAt)!==Date.parse(expectedRunAt)||!Array.isArray(result.rows)||result.rows.length!==batch.recipients.length||new Set(result.rows.map(r=>r?.id)).size!==batch.recipients.length||new Set(result.rows.map(r=>r?.candidateId)).size!==batch.recipients.length||result.rows.some(r=>!r||typeof r.id!=='string'||!r.id.trim()||r.state!=='reserved'||!batch.recipients.some(x=>x.id===r.candidateId)))throw fail('SCHEDULE_MISMATCH');
   row.state='scheduled';
  }catch{row.state='schedule_unknown';report();break;}
  report();if(!current())break;
 }
 return states;
}
