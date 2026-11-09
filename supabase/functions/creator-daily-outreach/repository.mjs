import {OutreachError,creatorIdentity,emailIdentity} from './domain.mjs';
import {readReviewPage} from './review-pages.mjs';
const fail=code=>{throw new OutreachError(code,'원본·중복 이력을 완전하게 확인하지 못했습니다.',503);};
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T00:00:00.000Z':v;
export function adaptYoutubeRecord(record){
 const d=record.data||{},r=d.youtubeResearch||{},review=d.dailyOutreachEvidence||{};
 const channelId=r.channelId||String(d.profile||'').match(/\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
 if(!channelId)return null;
 // Existing secondary-source leads stay unverified. This adapter never upgrades them.
 const leads=(r.businessContacts||[]).map(e=>({creatorKey:'youtube:'+channelId,address:e.email,sourceUrl:e.sourceUrl,sourceText:e.context||'',sourceKind:'unverified_secondary_source',checkedAt:iso(e.checked),verified:false}));
 return {platform:'youtube',externalId:channelId,name:d.name,profileUrl:d.profile,sourceRecordId:record.id,sourceRecordVersion:record.version,sourceRecordUpdated:record.updated,audience:d.followers,audienceSource:d.metricsSource,audienceCheckedAt:iso(review.audienceCheckedAt||r.subscriberObservationDate),lastActiveAt:review.lastActiveAt||r.observedActivity?.last_activity_date,activitySource:review.activitySource||r.observedActivity?.last_activity_url,activityCheckedAt:iso(review.activityCheckedAt),mukbang:review.mukbang,displayNameEvidence:review.displayNameEvidence,contactEvidence:Array.isArray(review.contactEvidence)?review.contactEvidence:leads,excluded:['거절','수신 거부','제외'].includes(d.status)};
}
export function adaptInstagramRecord(record,evidence){
 const review=evidence.filter(e=>e.creator_id===record.id&&e.source_kind==='daily_outreach_review').sort((a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at))[0]?.detail||{};
 return {platform:'instagram',externalId:record.handle,name:record.nickname||record.handle,profileUrl:record.profile_url,sourceRecordId:record.id,sourceRecordUpdated:record.updated,existingDatabaseRecord:true,audience:record.followers,audienceSource:record.followers_source,audienceCheckedAt:record.followers_checked,lastActiveAt:review.lastActiveAt,activitySource:review.activitySource,activityCheckedAt:review.activityCheckedAt,mukbang:review.mukbang,displayNameEvidence:review.displayNameEvidence,contactEvidence:Array.isArray(review.contactEvidence)?review.contactEvidence:[],excluded:record.status!=='new'||record.assessment==='excluded'||record.entity_type==='noncreator_suspected'||record.link_status!=='source_confirmed'};
}
function historicalIdentities(rows,directory=[]){
 const creatorKeys=new Set(),emailKeys=new Set();
 const byId=new Map(directory.filter(r=>r.id&&r.creatorKey).map(r=>[r.id,r.creatorKey]));
 function walk(value,key=''){
  if(typeof value==='string'){
   for(const address of value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]){const identity=emailIdentity(address);if(identity)emailKeys.add(identity);}
   if(['target','sourceRecordId','creator_id','creatorId','creatorReviewId'].includes(key)&&byId.has(value))creatorKeys.add(byId.get(value));
   if(['channelId','channel_id'].includes(key)&&/^UC[A-Za-z0-9_-]{22}$/.test(value))creatorKeys.add('youtube:'+value);
   const youtube=value.match(/(?:youtube:|youtube\.com\/channel\/)(UC[A-Za-z0-9_-]{22})(?:$|[/?#\s])/);if(youtube)creatorKeys.add('youtube:'+youtube[1]);
   if(['creator_key','creatorKey'].includes(key)&&/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value))creatorKeys.add(value);
   if(['identity','creator_key','creatorKey'].includes(key)&&/^instagram:[a-z0-9._]{1,30}$/i.test(value))creatorKeys.add(value.toLowerCase());
   if(['handle','username'].includes(key)&&/^[a-z0-9._]{1,30}$/i.test(value.replace(/^@/,'')))creatorKeys.add('instagram:'+value.replace(/^@/,'').toLowerCase());
   const instagram=value.match(/instagram\.com\/([a-z0-9._]{1,30})(?:\/|$)/i);if(instagram)creatorKeys.add('instagram:'+instagram[1].toLowerCase());
  }else if(Array.isArray(value))value.forEach(v=>walk(v,key));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))walk(v,k);
 }
 rows.forEach(walk);return {complete:true,creatorKeys:[...creatorKeys],emailKeys:[...emailKeys]};
}
export function createOutreachRepository(sb){
 const query=async promise=>{const r=await promise;if(r.error)fail('SOURCE_READ_FAILED');return r.data;};
 async function scan(table,owner,{key='id',columns='*',filter}={}){
  const scanOnce=async()=>{
   const rows=[];let cursor='',total=null;
   for(let page=0;page<100;page++){
    let q=sb.from(table).select(columns,{count:'exact'}).eq('owner',owner).order(key,{ascending:true}).limit(500);
    if(filter)q=filter(q);if(cursor)q=q.gt(key,cursor);
    const response=await q,part=response.data,count=response.count;
    if(response.error)fail('SOURCE_READ_FAILED');
    if(!Array.isArray(part)||part.length>500||!Number.isSafeInteger(count)||count<part.length)fail('SOURCES_INCOMPLETE');
    if(total===null)total=count;
    if(total>10000||rows.length+count!==total)fail('SOURCES_INCOMPLETE');
    for(const row of part){if(row.owner!==owner||typeof row[key]!=='string'||!row[key]||(cursor&&row[key]<=cursor))fail('SOURCE_READ_FAILED');cursor=row[key];rows.push(row);}
    if(rows.length===total)return rows;
    // A configured PostgREST row cap may be smaller than our requested page size.
    // Continue until the exact count is consumed, never infer completion from a short page.
    if(!part.length)fail('SOURCES_INCOMPLETE');
   }
   fail('SOURCES_INCOMPLETE');
  };
  const rows=await scanOnce(),check=await scanOnce();if(JSON.stringify(rows)!==JSON.stringify(check))fail('SOURCES_CHANGED');return rows;
 }
 async function compositeScan(table,owner,{columns='*',keys,filter}={}){
  const once=async()=>{let q=sb.from(table).select(columns,{count:'exact'}).eq('owner',owner);if(filter)q=filter(q);for(const key of keys)q=q.order(key,{ascending:true});const response=await q.limit(10001),rows=response.data;
   if(response.error)fail('SOURCE_READ_FAILED');
   if(!Array.isArray(rows)||!Number.isSafeInteger(response.count)||response.count!==rows.length||rows.length>10000||rows.some(row=>row.owner!==owner))fail('SOURCES_INCOMPLETE');return rows;};
  const rows=await once(),check=await once();if(JSON.stringify(rows)!==JSON.stringify(check))fail('SOURCES_CHANGED');return rows;
 }
 async function candidates(owner){
  const [saved,instagram]=await Promise.all([scan('sanji_records',owner,{filter:q=>q.eq('kind','candidate')}),scan('sanji_creator_recovery',owner)]);
  // A composite source that cannot be fully read under the server cap blocks preparation.
  const evidence=await compositeScan('sanji_creator_evidence',owner,{columns:'owner,creator_id,source_kind,source_url,source_ref,observation_key,detail,seen_at',keys:['creator_id','source_kind','source_url','source_ref','observation_key'],filter:q=>q.eq('source_kind','daily_outreach_review')});
  const candidates=[...saved.filter(r=>r.data?.channels==='YouTube').map(adaptYoutubeRecord).filter(Boolean),...instagram.map(r=>adaptInstagramRecord(r,evidence))];
  if(candidates.length>5000)fail('SOURCES_INCOMPLETE');return {complete:true,candidates};
 }
 async function reviewCandidates(owner,{cursor=null}={}){
  const page=await readReviewPage(sb,{table:'sanji_creator_recovery',owner,columns:'owner,id,handle,nickname,profile_url,updated,followers,followers_source,followers_checked,status,assessment,entity_type,link_status',scope:'existing_instagram_database',cursor});
  const ids=page.rows.map(row=>row.id);
  const evidence=ids.length?await compositeScan('sanji_creator_evidence',owner,{columns:'owner,creator_id,source_kind,source_url,source_ref,observation_key,detail,seen_at',keys:['creator_id','source_kind','source_url','source_ref','observation_key'],filter:q=>q.eq('source_kind','daily_outreach_review').in('creator_id',ids)}):[];
  if(evidence.some(row=>!ids.includes(row.creator_id)||row.source_kind!=='daily_outreach_review'))fail('REVIEW_PAGE_INCOMPLETE');
  return {pageComplete:true,candidates:page.rows.map(row=>adaptInstagramRecord(row,evidence)),pagination:page.pagination};
 }
 async function history(owner){
  const [outbox,records,suppression,reserved,reviews,drafts,jobs,inbound,notes,manual,queue,instagramInbound,instagramReplies,recovery]=await Promise.all([
   scan('sanji_outbox',owner),scan('sanji_records',owner),scan('sanji_suppression',owner,{key:'identity'}),scan('sanji_daily_outreach_candidates',owner,{key:'creator_key'}),scan('sanji_creator_contact_review',owner,{key:'creator_id'}),
   scan('sanji_drafts',owner),scan('sanji_jobs',owner),
   compositeScan('sanji_creator_inbound_messages',owner,{keys:['mailbox','provider_thread_id','provider_message_id']}),scan('sanji_creator_manual_notes',owner,{key:'note_id'}),compositeScan('sanji_ig_manual_conversations',owner,{keys:['account_id','peer_id']}),scan('sanji_creator_email_isolated_queue',owner,{key:'creator_id'}),
   compositeScan('sanji_instagram_inbound',owner,{keys:['account_id','message_id']}),scan('sanji_instagram_reply_attempts',owner,{key:'request_id'}),scan('sanji_creator_recovery',owner)
  ]);
  const draftById=new Map(drafts.map(r=>[r.id,r]));
  if(jobs.some(r=>!draftById.has(r.draft_id)))fail('HISTORY_INCOMPLETE');
  const directory=[...records.filter(r=>r.kind==='candidate').map(r=>({id:r.id,creatorKey:r.data?.channels==='YouTube'?creatorIdentity(adaptYoutubeRecord(r)):creatorIdentity({platform:'instagram',externalId:r.data?.handle})})),...recovery.map(r=>({id:r.id,creatorKey:creatorIdentity({platform:'instagram',externalId:r.handle})}))];
  return {...historicalIdentities([...outbox,...records.filter(r=>r.kind==='thread'),...suppression,...reserved,...reviews,...jobs,...jobs.map(r=>draftById.get(r.draft_id)),...inbound,...notes,...manual,...queue,...instagramInbound,...instagramReplies],directory),scope:'saved_sanji_history',gmailProviderHistoryChecked:false};
 }
 const findRun=async(owner,day)=>{const row=await query(sb.from('sanji_daily_outreach_runs').select('summary').eq('owner',owner).eq('day',day).maybeSingle());return row?.summary||null;};
 return {candidates,reviewCandidates,history,findRun,async latest(owner){const rows=await query(sb.from('sanji_daily_outreach_runs').select('summary').eq('owner',owner).order('day',{ascending:false}).limit(1));return rows?.[0]?.summary||null;},async save(owner,plan){return query(sb.rpc('sanji_daily_outreach_prepare',{p_owner:owner,p_day:plan.day,p_plan:plan}));}};
}
