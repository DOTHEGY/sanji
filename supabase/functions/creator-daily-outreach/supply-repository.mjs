import {OutreachError} from './domain.mjs';
const fail=code=>{throw new OutreachError(code,'일일 수집 저장소 상태를 확인하지 못했습니다.',503);};
// Service role only; caller has already authenticated owner membership. Pending
// SQL repeats membership and lease checks. No client-supplied owner is accepted.
export function createSupplyRepository(sb){
 async function rpc(name,args){let result;try{result=await sb.rpc(name,args);}catch{fail('SUPPLY_STORE_UNCERTAIN');}if(result.error)fail('SUPPLY_STORE_UNAVAILABLE');return result.data;}
 const params=c=>({p_owner:c.owner,p_campaign:c.campaign,p_day:c.day,p_token:c.token});
 async function read(query){const result=await query;if(result.error)fail('SUPPLY_STORE_UNAVAILABLE');return result;}
 return {
  async snapshot(owner,campaign,creatorKey){if(typeof creatorKey!=='string'||!/^youtube:UC[A-Za-z0-9_-]{22}$/.test(creatorKey))fail('SUPPLY_REVIEW_STALE');const r=await read(sb.from('sanji_daily_supply_snapshots').select('owner,campaign,channel_id,snapshot,observed_at,expires_at').eq('owner',owner).eq('campaign',campaign).eq('channel_id',creatorKey.slice(8)).gt('expires_at',new Date().toISOString()).maybeSingle());return r.data?[r.data]:[];},
  claim:c=>rpc('sanji_daily_supply_claim',params(c)),
  reserve:c=>rpc('sanji_daily_supply_reserve',{...params(c),p_project:c.projectId,p_kind:c.kind,p_request:c.requestId}),
  // Treat all uncertain finishes specially. Never retry a write blindly.
  async finish(c){try{return await rpc('sanji_daily_supply_finish',{...params(c),p_cursor:c.cursor,p_snapshots:c.snapshots,p_summary:c.summary});}catch{fail('SUPPLY_SAVE_UNCERTAIN');}},
  fail:c=>rpc('sanji_daily_supply_fail',{...params(c),p_summary:c.summary}),
  async sweepExpired(){const api=await rpc('sanji_daily_supply_sweep',{}),instagram=await rpc('sanji_daily_supply_instagram_sweep',{});return {...api,...instagram};},
  async saveInstagramReview(c){try{return await rpc('sanji_daily_supply_instagram_review',{p_owner:c.owner,p_campaign:c.campaign,p_review:c.review});}catch{fail('INSTAGRAM_REVIEW_SAVE_UNCERTAIN');}},
  async saveReview(c){try{return await rpc('sanji_daily_supply_review',{p_owner:c.owner,p_campaign:c.campaign,p_review:c.review});}catch{fail('SUPPLY_REVIEW_SAVE_UNCERTAIN');}},
  async reviews(owner,campaign){
   const rows=[];let cursor='',total=null;
   for(let page=0;page<100;page++){
    let q=sb.from('sanji_daily_supply_reviews').select('owner,campaign,creator_key,review,expires_at',{count:'exact'}).eq('owner',owner).eq('campaign',campaign).gt('expires_at',new Date().toISOString()).order('creator_key',{ascending:true}).limit(500);if(cursor)q=q.gt('creator_key',cursor);
    const r=await read(q);if(!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count<r.data.length)fail('SUPPLY_REVIEWS_INCOMPLETE');if(total===null)total=r.count;if(total>5000||rows.length+r.count!==total)fail('SUPPLY_REVIEWS_CHANGED');
    for(const row of r.data){if(row.owner!==owner||row.campaign!==campaign||typeof row.creator_key!=='string'||row.creator_key<=cursor)fail('SUPPLY_REVIEWS_INCOMPLETE');rows.push(row);cursor=row.creator_key;}
    if(rows.length===total)return rows;if(!r.data.length)break;
   }
   fail('SUPPLY_REVIEWS_INCOMPLETE');
  },
  async instagramReviews(owner,campaign,creatorIds){
   if(creatorIds!==undefined&&(!Array.isArray(creatorIds)||creatorIds.length>50||creatorIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))))fail('INSTAGRAM_REVIEW_PAGE_INVALID');
   if(creatorIds?.length===0)return [];
   const rows=[];let cursor='',total=null;
   for(let page=0;page<100;page++){
    let q=sb.from('sanji_daily_supply_instagram_reviews').select('owner,campaign,creator_id,source_updated,creator_key,review,expires_at',{count:'exact'}).eq('owner',owner).eq('campaign',campaign).gt('expires_at',new Date().toISOString()).order('creator_id',{ascending:true}).limit(500);if(creatorIds)q=q.in('creator_id',creatorIds);if(cursor)q=q.gt('creator_id',cursor);
    const r=await read(q);if(!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count<r.data.length)fail('INSTAGRAM_REVIEWS_INCOMPLETE');if(total===null)total=r.count;if(total>5000||rows.length+r.count!==total)fail('INSTAGRAM_REVIEWS_CHANGED');
    for(const row of r.data){if(row.owner!==owner||row.campaign!==campaign||typeof row.creator_id!=='string'||row.creator_id<=cursor||(creatorIds&&!creatorIds.includes(row.creator_id)))fail('INSTAGRAM_REVIEWS_INCOMPLETE');rows.push(row);cursor=row.creator_id;}
    if(rows.length===total)return rows;if(!r.data.length)break;
   }
   fail('INSTAGRAM_REVIEWS_INCOMPLETE');
  },
  async instagramReviewGuards(owner,campaign,creatorIds){
   if(creatorIds!==undefined&&(!Array.isArray(creatorIds)||creatorIds.length>50||creatorIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))))fail('INSTAGRAM_REVIEW_PAGE_INVALID');
   if(creatorIds?.length===0)return [];
   const rows=[];let cursor='',total=null;
   for(let page=0;page<100;page++){
    let q=sb.from('sanji_daily_supply_instagram_review_guards').select('owner,campaign,creator_id,last_reviewed_at',{count:'exact'}).eq('owner',owner).eq('campaign',campaign).order('creator_id',{ascending:true}).limit(500);if(creatorIds)q=q.in('creator_id',creatorIds);if(cursor)q=q.gt('creator_id',cursor);
    const r=await read(q);if(!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count<r.data.length)fail('INSTAGRAM_REVIEW_GUARDS_INCOMPLETE');if(total===null)total=r.count;if(total>5000||rows.length+r.count!==total)fail('INSTAGRAM_REVIEW_GUARDS_CHANGED');
    for(const row of r.data){if(row.owner!==owner||row.campaign!==campaign||typeof row.creator_id!=='string'||row.creator_id<=cursor||(creatorIds&&!creatorIds.includes(row.creator_id)))fail('INSTAGRAM_REVIEW_GUARDS_INCOMPLETE');rows.push(row);cursor=row.creator_id;}
    if(rows.length===total)return rows;if(!r.data.length)break;
   }
   fail('INSTAGRAM_REVIEW_GUARDS_INCOMPLETE');
  },
  async latest(owner,campaign){const r=await read(sb.from('sanji_daily_supply_runs').select('day,state,summary,lease_expires_at,search_calls,read_calls').eq('owner',owner).eq('campaign',campaign).order('day',{ascending:false}).limit(1));return r.data?.[0]||null;},
  async snapshots(owner,campaign){
   // Exact count + ordered keyset pagination, no silent PostgREST cap truncation.
   const rows=[];let cursor='',total=null;
   for(let page=0;page<100;page++){
    let q=sb.from('sanji_daily_supply_snapshots').select('owner,campaign,channel_id,snapshot,observed_at,expires_at',{count:'exact'}).eq('owner',owner).eq('campaign',campaign).gt('expires_at',new Date().toISOString()).order('channel_id',{ascending:true}).limit(500);if(cursor)q=q.gt('channel_id',cursor);
    const r=await read(q);if(!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count<r.data.length)fail('SUPPLY_SNAPSHOTS_INCOMPLETE');if(total===null)total=r.count;
    if(total>5000||rows.length+r.count!==total)fail('SUPPLY_SNAPSHOTS_CHANGED');
    for(const row of r.data){if(row.owner!==owner||row.campaign!==campaign||typeof row.channel_id!=='string'||row.channel_id<=cursor)fail('SUPPLY_SNAPSHOTS_INCOMPLETE');rows.push(row);cursor=row.channel_id;}
    if(rows.length===total)return rows;if(!r.data.length)break;
   }
   fail('SUPPLY_SNAPSHOTS_INCOMPLETE');
  }
 };
}
