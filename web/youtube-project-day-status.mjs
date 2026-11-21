const zone='Asia/Seoul';
const stamp=new Intl.DateTimeFormat('ko-KR',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const MAX_DAY_STATUS_IDS=100;
const states=Object.freeze({
  sent:{label:'발송 완료',time:'Gmail 접수 기록'},
  scheduled:{label:'발송 예약',time:'예약 시각'},
  found_only:{label:'찾기만 함'},
  failed:{label:'발송 실패'},
  unknown:{label:'확인 필요'},
});
const time=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(x)&&Number.isFinite(Date.parse(x))?x:null;
export const unknownDayStatus=Object.freeze({status:'unknown',at:null});
export function validDay(x){
  if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
  const t=Date.parse(x);
  return Number.isFinite(t)&&new Date(t).toISOString().startsWith(x+'T');
}
export function validCandidateId(x){return typeof x==='string'&&uuid.test(x);}
export function decodeDayStatus(payload,{projectId,day,ids}){
  if(!validDay(day)||payload?.projectId!==projectId||payload?.day!==day||!Array.isArray(payload.items)||payload.items.length>ids.length)return new Map();
  const expected=new Set(ids),out=new Map(),duplicates=new Set();
  for(const item of payload.items){
    if(!expected.has(item?.candidateId)||duplicates.has(item.candidateId))continue;
    const id=item.candidateId;
    if(out.has(id)){out.delete(id);duplicates.add(id);continue;}
    let status=item.state,at=null;
    if(!Object.hasOwn(states,status))status='unknown';
    else if(status==='sent'||status==='scheduled'){at=time(item.at);if(!at)status='unknown';}
    else if(status==='found_only'&&item.completeForCandidate!==true)status='unknown';
    out.set(id,{status,at});
  }
  return out;
}
export function dayStatusText(value){
  const state=Object.hasOwn(states,value?.status)?value.status:'unknown';
  const entry=states[state],at=time(value?.at);
  if(entry.time&&!at)return {state:'unknown',label:states.unknown.label,detail:null};
  return {state,label:entry.label,detail:entry.time?entry.time+' · '+stamp.format(new Date(at))+' (KST)':null};
}
