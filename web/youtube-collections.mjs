// Collection membership is separate from content classification and contact approval.
// Empty collections are drafts until their first candidate is saved; no settings
// writes are used, so creating a collection never changes email configuration.
export const DEFAULT_YOUTUBE_COLLECTION='먹방';
export function collectionName(value) {
  if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(value))throw Error('모음 이름은 1~40자의 일반 텍스트로 입력하세요.');
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!name||name.length>40||['전체','미분류'].includes(name))throw Error('모음 이름은 1~40자로 입력하세요. 전체·미분류는 사용할 수 없습니다.');
  return name;
}
const safeName=value=>{try{return collectionName(value);}catch{return null;}};
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function recordCollections(data) {
  const explicit=Array.isArray(data?.youtubeResearch?.collections)?data.youtubeResearch.collections:[];
  const names=explicit.map(safeName).filter(Boolean);
  // Existing sourced 먹방 records can be shown without mutating any stored data.
  // A name, a keyword in notes, or an unsourced tag alone is not enough.
  const sourced=Array.isArray(data?.evidence)&&data.evidence.some(e=>https(e?.url)&&typeof e?.description==='string'&&e.description.trim())||https(data?.youtubeResearch?.source);
  if(Array.isArray(data?.topics)&&data.topics.includes(DEFAULT_YOUTUBE_COLLECTION)&&sourced)names.unshift(DEFAULT_YOUTUBE_COLLECTION);
  return [...new Set(names)];
}
export function collectionNames(records,drafts=[]) {
  return [...new Set([DEFAULT_YOUTUBE_COLLECTION,...drafts.map(safeName).filter(Boolean),...records.flatMap(r=>recordCollections(r.data))])];
}
export function withCollection(data,name) {
  const normalized=collectionName(name),names=recordCollections(data);
  if(names.includes(normalized))return null;
  if(names.length>=100)throw Error('한 후보에 저장할 수 있는 모음은 최대 100개입니다.');
  return {...data,youtubeResearch:{...(data.youtubeResearch||{}),collections:[...names,normalized]}};
}
export function collectionStats(records,name) {
  const rows=records.filter(r=>name===null||name===''?name===null||recordCollections(r.data).length===0:recordCollections(r.data).includes(name));
  return {rows,count:rows.length,publicContactLeads:rows.filter(r=>r.data.contact?.email||Array.isArray(r.data.youtubeResearch?.businessContacts)&&r.data.youtubeResearch.businessContacts.some(c=>c?.email)).length};
}
