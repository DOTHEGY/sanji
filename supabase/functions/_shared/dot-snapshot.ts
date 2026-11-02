// A snapshot contains aggregate evidence only. It never starts or controls the collector.
const metrics=['target','checked_attempts','unique_handles','new_saved','existing_on_import','duplicates_preskipped','failed_attempts','recovered_failures','unresolved_failures','pending_submissions','reserved_remaining','available_remaining'];
const id=/^[a-zA-Z0-9._:-]{1,128}$/;
export function validateDotSnapshot(value:any, now=Date.now()){
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('스냅샷 객체가 필요합니다.');
 const permitted=new Set(['schema_version','snapshot_id','ledger_generation_id','revision','day','timezone','source_as_of','last_profile_observed_at','sources','metrics','coverage','execution','login','database_audit','warnings','exported_at','runs']);
 if(Object.keys(value).some(k=>!permitted.has(k)))throw Error('지원하지 않는 필드가 있습니다.');
 if(value.schema_version!=='sanji.collection.snapshot.v1'||value.timezone!=='Asia/Seoul'||!id.test(value.snapshot_id||'')||!id.test(value.ledger_generation_id||'')||!id.test(value.revision||''))throw Error('스냅샷 식별 정보가 올바르지 않습니다.');
 if(typeof value.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||new Date(value.day+'T00:00:00Z').toISOString().slice(0,10)!==value.day)throw Error('날짜가 올바르지 않습니다.');
 if(!value.metrics||Array.isArray(value.metrics)||typeof value.metrics!=='object')throw Error('지표가 필요합니다.');
 const keys=[...metrics,'known_unique_handles','usage_cost'];
 if(Object.keys(value.metrics).some(k=>!keys.includes(k)))throw Error('알 수 없는 지표입니다.');
 for(const k of keys){const n=value.metrics[k];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||(k!=='usage_cost'&&!Number.isSafeInteger(n))))throw Error(k+' 값이 올바르지 않습니다.');}
 const stamp=(s:any)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Date.parse(s)<=now+300000;
 if(!stamp(value.source_as_of)||!stamp(value.exported_at)||Date.parse(value.source_as_of)>Date.parse(value.exported_at))throw Error('관찰 시각이 올바르지 않습니다.');
 if(value.last_profile_observed_at!==null&&!stamp(value.last_profile_observed_at))throw Error('프로필 관찰 시각이 올바르지 않습니다.');
 for(const k of ['coverage','execution','login'])if(!value[k]||Array.isArray(value[k])||typeof value[k]!=='object')throw Error(k+' 정보가 필요합니다.');
 if(value.database_audit!==null&&(!value.database_audit||Array.isArray(value.database_audit)||typeof value.database_audit!=='object'))throw Error('database_audit 정보가 올바르지 않습니다.');
 for(const t of [value.login.observed_at,value.database_audit?.observed_at])if(t!=null&&(!stamp(t)||Date.parse(t)>Date.parse(value.exported_at)))throw Error('보완 관찰 시각이 올바르지 않습니다.');
 for(const k of ['sources','warnings','runs'])if(!Array.isArray(value[k])||value[k].length>1000)throw Error(k+' 정보가 올바르지 않습니다.');
 const inspect=(x:any,depth=0):void=>{if(depth>8)throw Error('스냅샷 구조가 너무 깊습니다.');if(typeof x==='string'&&(x.length>1000||/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(x)||/\b(?:sk-|bearer\s+|eyJ[a-zA-Z0-9_-]{16})/i.test(x)||/(?:\/workspace\/|\/home\/|\/tmp\/)/i.test(x)))throw Error('집계에 개인 정보나 비밀값을 포함할 수 없습니다.');if(Array.isArray(x)){if(x.length>1000)throw Error('목록이 너무 깁니다.');for(const v of x)inspect(v,depth+1);}else if(x&&typeof x==='object')for(const [k,v] of Object.entries(x)){if(/token|secret|password|cookie|email|handle|path/i.test(k)&&!['unique_handles','known_unique_handles'].includes(k))throw Error('개인정보나 비밀 필드는 저장할 수 없습니다.');inspect(v,depth+1);}};inspect(value);
 if(JSON.stringify(value).length>250000)throw Error('스냅샷이 너무 큽니다.');
 return value;
}
