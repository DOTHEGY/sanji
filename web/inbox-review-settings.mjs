// Durable private task state, kept separate from provider evidence and dispatch records.
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const key=v=>typeof v==='string'&&(/^(?:historical):[0-9a-f-]{36}$/.test(v)&&uuid(v.slice(11))||/^instagram:\d{1,100}$/.test(v));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=message=>{throw Object.assign(Error(message),{status:409});};
function queue(value,owner){
 if(value==null)return {schema:1,ownerId:owner,items:[]};
 if(value.schema!==1||value.ownerId!==owner||!Array.isArray(value.items)||value.items.length>200||Object.keys(value).some(k=>!['schema','ownerId','items'].includes(k)))fail('확인·숨김 기록 형식을 확인하세요.');
 const seen=new Set();for(const e of value.items){if(!e||Object.keys(e).length!==6||Object.keys(e).some(k=>!['key','fingerprint','state','label','reportedAt','source'].includes(k))||!key(e.key)||!hash(e.fingerprint)||!['reviewed','reported_sent'].includes(e.state)||e.source!=='operator_reported'||typeof e.label!=='string'||!e.label||e.label.length>160||typeof e.reportedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.reportedAt)||!Number.isFinite(Date.parse(e.reportedAt))||new Date(e.reportedAt).toISOString()!==e.reportedAt||seen.has(e.key))fail('확인·숨김 기록 형식을 확인하세요.');seen.add(e.key);}
 return JSON.parse(JSON.stringify(value));
}
export function createInboxReviewSettingsApi({client,member,result}){
 return async function inboxReviewSettingsApi(action,body,owner,stillActive){
  if(!['read','reviewed','reported_sent','restore'].includes(action)||!uuid(owner)||typeof stillActive!=='function'||!stillActive())fail('현재 계정과 대화함을 확인하세요.');
  const input=body==null?null:JSON.parse(JSON.stringify(body));
  if(action==='read'){if(input!==null)fail('조회 입력을 확인하세요.');}
  else if(!input||!uuid(input.settingsId)||!Number.isSafeInteger(input.version)||input.version<1||!key(input.key)||!hash(input.fingerprint)||Object.keys(input).length!==(action==='restore'?4:5)||Object.keys(input).some(k=>!['settingsId','version','key','fingerprint',...(action==='restore'?[]:['label'])].includes(k))||action!=='restore'&&(typeof input.label!=='string'||!input.label||input.label.length>160))fail('현재 기록과 설정 버전을 다시 확인하세요.');
  const initial=await client.auth.getSession(),token=initial?.data?.session?.access_token;
  if(initial?.error||initial?.data?.session?.user?.id!==owner||typeof token!=='string'||!token||!stillActive())fail('계정 또는 화면이 변경됐습니다.');
  const check=async()=>{const r=await client.auth.getSession();if(r?.error||r?.data?.session?.user?.id!==owner||r?.data?.session?.access_token!==token||!stillActive())fail('계정 또는 기록이 변경됐습니다. 저장 여부는 다시 조회하세요.');};
  await member();await check();
  const rows=await result(client.from('sanji_records').select('id,owner,kind,data,version,updated').eq('owner',owner).eq('kind','settings').limit(2).setHeader('Authorization','Bearer '+token));await check();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.owner!==owner||rows[0]?.kind!=='settings'||!uuid(rows[0]?.id)||!Number.isSafeInteger(rows[0]?.version)||rows[0].version<1)fail('계정의 기존 설정을 하나로 확인하지 못했습니다.');
  const row=rows[0],current=queue(row.data?.inboxReviewQueue,owner),out=r=>({id:r.id,version:r.version,inboxReviewQueue:queue(r.data?.inboxReviewQueue,owner)});
  if(action==='read')return out(row);
  if(row.id!==input.settingsId||row.version!==input.version)fail('다른 변경이 있습니다. 확인·숨김 상태를 다시 읽어 주세요.');
  const old=current.items.find(e=>e.key===input.key);
  if(action==='restore'&&(!old||old.fingerprint!==input.fingerprint))fail('확인·숨김 대상이 변경됐습니다. 다시 읽어 주세요.');
  current.items=current.items.filter(e=>e.key!==input.key);
  if(action!=='restore')current.items.push({key:input.key,fingerprint:input.fingerprint,label:input.label,state:action,reportedAt:new Date().toISOString(),source:'operator_reported'});
  queue(current,owner);if(new TextEncoder().encode(JSON.stringify(current)).length>80000)fail('확인·숨김 기록 저장 한도를 넘었습니다. 기존 표시를 되돌린 뒤 다시 확인하세요.');
  await check();
  const saved=await result(client.rpc('sanji_save_record',{p_kind:'settings',p_id:row.id,p_version:row.version,p_data:{inboxReviewQueue:current}}).setHeader('Authorization','Bearer '+token));await check();
  const value=Array.isArray(saved)?saved[0]:saved;
  if(!value||value.owner!==owner||value.kind!=='settings'||value.id!==row.id||value.version!==row.version+1)fail('저장 결과를 확인하지 못했습니다. 다시 읽어 주세요.');
  const actual=queue(value.data?.inboxReviewQueue,owner);if(actual.items.length!==current.items.length||current.items.some(e=>!actual.items.some(a=>Object.keys(e).every(k=>e[k]===a[k]))))fail('저장 내용이 일치하지 않습니다. 다시 읽어 주세요.');
  return out(value);
 };
}
