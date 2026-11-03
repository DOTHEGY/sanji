'use strict';
// Pure preparation only. No API calls, storage, scheduling or sending.
const TOPICS=new Set(['베이킹','요리','푸드','커피','라이프스타일','홈카페','디저트','육아','패션','뷰티','운동','웰니스']);
const topics=x=>new Set((Array.isArray(x)?x:[]).filter(v=>typeof v==='string'&&TOPICS.has(v.trim())).map(v=>v.trim()));
function validLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!!u.hostname}catch{return false}}
function planCreator(row,deals){
 const handle=String(row?.handle||'').replace(/^@/,'').toLowerCase();
 if(!row?.id||!/^[a-z0-9._]{1,30}$/.test(handle))return {status:'skip',reason:'계정 확인 필요'};
 if(!Array.isArray(row.emails)||row.emails.length!==1||!/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(row.emails[0]))return {id:row.id,handle,status:'skip',reason:'공개 이메일 확인 필요'};
 if(!validLink(row.profile_url))return {id:row.id,handle,status:'skip',reason:'이메일 출처 확인 필요'};
 const match=topics(row.topics),found=[];
 for(const d of Array.isArray(deals)?deals:[]){const overlap=[...topics(d?.topics)].filter(t=>match.has(t));if(!d?.id||!d.name||!validLink(d.productUrl)||!['확정','협의 중'].includes(d.state)||!overlap.length||d.stock===0||d.soldOut===true||/품절/.test(String(d.sourceNote||'')+' '+String(d.note||'')))continue;found.push({id:d.id,name:d.name,productUrl:d.productUrl,overlap});}
 const unique=[...new Map(found.map(d=>[d.id,d])).values()].slice(0,3);
 if(unique.length<2)return {id:row.id,handle,status:'skip',reason:'상품 연관 근거 2개 이상 필요'};
 return {id:row.id,handle,status:'ready_for_verification',email:row.emails[0],sourceUrl:row.profile_url,products:unique};
}
function freezeManifest(rows){if(!Array.isArray(rows)||rows.some(r=>!r?.id)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('추천 대상 확인 필요');return Object.freeze(rows.map(r=>Object.freeze({...r})));}
module.exports={planCreator,freezeManifest};
