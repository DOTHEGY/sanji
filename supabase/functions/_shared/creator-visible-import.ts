import {Buffer} from 'node:buffer';
const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export function sanitizeVisibleRows(raw:any){
 if(!Array.isArray(raw)||raw.length<1||raw.length>30)throw Error('한 번에 1~30개 계정만 가져올 수 있습니다.');
 const rows:any[]=[],seen=new Set();
 for(const [index,x] of raw.entries()){
  const handle=String(x?.handle||'').trim().replace(/^@/,'').toLowerCase(),source=String(x?.source_url||'').trim(),reference=String(x?.source_ref||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9._]{1,30}$/.test(handle)||!['https://tagby.io/influencer/search','https://tagby.io/instant/recommend/search'].includes(source)||!/^[a-z0-9._]{0,30}$/.test(reference))throw Error('아이디 또는 태그바이 출처를 확인하세요.');
  const key=[handle,source,reference].join('|');if(seen.has(key))continue;seen.add(key);
  let profile=String(x.profile_url||'').trim();if(profile){let u:URL;try{u=new URL(profile);}catch{throw Error('프로필 URL이 올바르지 않습니다.');}if(u.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(u.hostname)||u.pathname.replace(/\/$/,'').toLowerCase()!=='/'+handle)throw Error('프로필 URL과 아이디가 일치하지 않습니다.');profile=u.origin+u.pathname.replace(/\/$/,'')+'/';}
  const bio=String(x.bio||'').slice(0,4000),matches=[...bio.matchAll(EMAIL)].map(m=>m[0].replace(/\.+$/,'')),emails=[...new Set(matches.map(e=>e.toLowerCase()))];
  const requested=String(x.bio_status||''),bioStatus=requested|| (bio?(emails.length?'email_present':'email_not_in_bio'):'not_checked');
  if(!['email_present','email_not_in_bio','bio_unreadable','not_checked'].includes(bioStatus))throw Error('소개란 확인 상태가 올바르지 않습니다.');
  if((bioStatus==='email_present'&&!emails.length)||(bioStatus==='email_not_in_bio'&&emails.length)||(['bio_unreadable','not_checked'].includes(bioStatus)&&bio))throw Error('소개란 내용과 확인 상태가 일치하지 않습니다.');
  if(bioStatus!=='not_checked'){let bioSource:URL;try{bioSource=new URL(String(x.bio_source_url||''));}catch{throw Error('소개란을 확인한 Instagram 출처가 필요합니다.');}if(bioSource.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(bioSource.hostname)||bioSource.pathname.replace(/\/$/,'').toLowerCase()!=='/'+handle||!profile)throw Error('소개란 출처와 아이디를 확인하세요.');}
  const bioChecked=typeof x.bio_checked_at==='string'&&Number.isFinite(Date.parse(x.bio_checked_at))?new Date(x.bio_checked_at).toISOString():null;
  const count=(v:any)=>Number.isSafeInteger(v)&&v>=0?v:null;
  rows.push({handle,profile_url:profile,nickname:String(x.nickname||'').slice(0,200),followers:count(x.followers),category:String(x.category||'').slice(0,200),bio,bio_source_url:bioStatus!=='not_checked'?profile:'',bio_status:bioStatus,bio_checked_at:bioChecked,bio_content_available:!!bio,emails,email_status:bioStatus==='email_present'?'소개란 공개 · 유효성 미검증':bioStatus==='email_not_in_bio'?'해당 시점 소개란에 이메일 없음':bioStatus==='bio_unreadable'?'소개란 조회 실패 · 이메일 미확인':'아직 조회하지 않음',source_url:source,source_ref:reference,checked:typeof x.checked==='string'&&Number.isFinite(Date.parse(x.checked))?new Date(x.checked).toISOString():null,observation_kind:['file_observed','page_observed'].includes(x.observation_kind)?x.observation_kind:'unknown',source_position:Number.isInteger(x.source_position)&&x.source_position>0&&x.source_position<=30?x.source_position:index+1,similarity:String(x.similarity||'').slice(0,100),average_likes:count(x.average_likes),average_comments:count(x.average_comments)});
 }
 return rows;
}
export function visibleImportService({sb,query,audit}:any){return async(owner:string,input:any)=>{
 const rows=sanitizeVisibleRows(input?.rows);const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)))).toString('hex');
 const result=await query(sb.rpc('sanji_creator_import_visible',{p_owner:owner,p_hash:hash,p_rows:rows}));await audit(owner,'creator_visible_imported',{processed:result.processed,added:result.added,duplicateBatch:result.duplicateBatch});return result;
};}
