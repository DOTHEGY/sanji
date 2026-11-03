// Pure preparation only. No API calls, storage, scheduling or sending.
// Match explicit public content topics, across all deal categories; never infer health conditions.
const topics=x=>new Set((Array.isArray(x)?x:[]).filter(v=>typeof v==='string').map(v=>v.trim().toLocaleLowerCase()).filter(v=>v.length>=2&&v.length<=40&&!/[\x00-\x1f]/.test(v)&&!/(질병|질환|치료|진단|환자|복용|임신|불임|우울증|pregnan|diabet|disease|illness|patient|medicat|cancer|therapy|depress)/i.test(v)));
function validLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!!u.hostname}catch{return false}}
function planCreator(row,deals){
 const handle=String(row?.handle||'').replace(/^@/,'').toLowerCase();
 if(!row?.id||!/^[a-z0-9._]{1,30}$/.test(handle))return {status:'skip',reason:'계정 확인 필요'};
 if(row.status!=='new')return {id:row.id,handle,status:'skip',reason:'연락 상태 확인 필요'};
 if(row.bio_status!=='email_present'||row.link_status!=='source_confirmed'||!Array.isArray(row.emails)||row.emails.length!==1||!/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(row.emails[0])||!String(row.bio||'').toLowerCase().includes(row.emails[0].toLowerCase()))return {id:row.id,handle,status:'skip',reason:'공개 이메일 확인 필요'};
 let source;try{source=new URL(row.profile_url)}catch{}if(!source||source.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(source.hostname)||source.username||source.password||source.search||source.hash||source.pathname.replace(/\/$/,'').toLowerCase()!=='/'+handle)return {id:row.id,handle,status:'skip',reason:'이메일 출처 확인 필요'};
 const category=typeof row.category==='string'?row.category.split(/[,·/]/):[];
 const match=topics([...(Array.isArray(row.topics)?row.topics:[]),...category]),found=[];
 for(const d of Array.isArray(deals)?deals:[]){const productTopics=topics(d?.topics),overlap=[...productTopics].filter(t=>match.has(t));if(!d?.id||!d.name||!validLink(d.productUrl)||!['확정','협의 중'].includes(d.state)||!overlap.length||d.stock===0||d.soldOut===true||d.availability==='sold_out'||/품절/.test(String(d.sourceNote||'')+' '+String(d.note||'')))continue;found.push({id:d.id,name:d.name,productUrl:d.productUrl,overlap});}
 const unique=[...new Map(found.map(d=>[d.id,d])).values()];
 unique.sort((a,b)=>b.overlap.length-a.overlap.length||String(a.id).localeCompare(String(b.id)));
 if(!unique.length)return {id:row.id,handle,status:'skip',reason:'적합한 상품 연관 근거 필요'};
 return {id:row.id,handle,status:'ready_for_verification',email:row.emails[0],sourceUrl:row.profile_url,products:[unique[0]]};
}
function freezeManifest(rows){if(!Array.isArray(rows)||rows.some(r=>!r?.id)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('추천 대상 확인 필요');return Object.freeze(rows.map(r=>Object.freeze({id:String(r.id)})));}
export {planCreator,freezeManifest};
