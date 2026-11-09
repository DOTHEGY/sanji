import {DAILY_OUTREACH,OutreachError,creatorIdentity,emailIdentity,outreachDay} from './domain.mjs';
const fail=()=>{throw new OutreachError('PREPARED_RECIPIENTS_UNAVAILABLE','오늘 준비한 수신 주소를 확인하지 못했습니다.',503);};
// This is a small private presentation view, never send authorization. It reads
// only this owner's current-day prepared rows; no source directory/history scan.
export function createPreparedRecipients({sb,now=Date.now}){
 return async owner=>{
  const at=now(),day=outreachDay(at),pages=await Promise.all(['youtube','instagram'].map(async platform=>{
   const bounds=DAILY_OUTREACH.audienceBounds[platform],cap=platform==='youtube'?50:10;
   // Historical/expired rows remain stored but cannot consume this view's cap.
   // -> keeps JSON numbers numeric; ->> would compare audience text lexically.
   const r=await sb.from('sanji_daily_outreach_candidates').select('owner,creator_key,email_key,recipient,platform,day,state,snapshot,expires_at',{count:'exact'}).eq('owner',owner).eq('day',day).eq('platform',platform).gt('expires_at',new Date(at).toISOString()).gte('snapshot->audience',bounds.minimum).lte('snapshot->audience',bounds.maximum).order('creator_key',{ascending:true}).limit(cap+1);
   if(r.error||!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count!==r.data.length||r.count>cap||r.data.some(row=>row.platform!==platform))fail();return r.data;
  }));
  const r={data:pages.flat()};
  const items=[],keys=new Set(),emails=new Set(),counts={youtube:0,instagram:0};
  for(const row of r.data){
   const s=row.snapshot,key=creatorIdentity(s),email=emailIdentity(row.recipient),bounds=DAILY_OUTREACH.audienceBounds[row.platform];
   if(row.owner!==owner||row.day!==day||!bounds||!key||key!==row.creator_key||s.platform!==row.platform||!email||row.email_key!==email||keys.has(key)||emails.has(email)||row.state!=='awaiting_dispatch_review')fail();
   keys.add(key);emails.add(email);
   if(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=at||!Number.isSafeInteger(s.audience)||s.audience<bounds.minimum||s.audience>bounds.maximum)continue;
   if(typeof s.name!=='string'||!s.name.trim()||s.name.length>200||s.contact?.verified!==true||s.contact.address!==row.recipient||s.contact.key!==email)fail();
   counts[row.platform]++;if(counts[row.platform]>(row.platform==='youtube'?50:10))fail();
   items.push({creatorKey:key,platform:row.platform,name:s.name,email:row.recipient,audience:s.audience});
  }
  return {day,scope:'current_day_prepared_recipients',items,counts,preparationOnly:true,sendingEnabled:false,gmailHistoryChecked:false};
 };
}
