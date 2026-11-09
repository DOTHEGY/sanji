const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,query,owner,other,cid}=require('./helpers/creator-daily-execution-fixture.cjs');
const key='instagram:foodperson',profile='https://www.instagram.com/foodperson/',campaign='mara-jjamppong-bread';
const rpc=async(db,name,args)=>(await query(db,'select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args))[0].r;
const client=db=>({rpc:async(name,args)=>{try{return {data:await rpc(db,name,Object.values(args))};}catch(error){return {error};}}});
async function native(db){await query(db,"insert into sanji_creator_recovery(id,owner,handle,nickname,profile_url,status,assessment,entity_type,link_status) values($1,$2,'foodperson','Food',$3,'new','candidate','creator','source_confirmed')",[cid,owner,profile]);return (await query(db,'select * from sanji_creator_recovery where id=$1',[cid]))[0];}
const input=(updated,now)=>{const at=new Date(now-1000).toISOString();return {creatorKey:key,sourceRecordId:cid,sourceRecordUpdated:updated,audience:40000,audienceSource:profile,audienceCheckedAt:at,lastActiveAt:at,activitySource:profile,activityCheckedAt:at,mukbang:{verified:true,sourceUrl:profile,sourceText:'먹방',checkedAt:at},contactEvidence:[]};};
async function fixture(){const db=await setup(),raw=await native(db),{createExecutionRepository}=await import('../supabase/functions/creator-daily-outreach/execution-repository.mjs'),{createDailySupply}=await import('../supabase/functions/creator-daily-outreach/supply.mjs');const execution=createExecutionRepository(client(db)),calls=[];
 const repository={saveInstagramReview:async c=>{calls.push(c);return rpc(db,'sanji_daily_supply_instagram_review',[c.owner,c.campaign,c.review]);}};
 const supply=createDailySupply({enabled:true,executionRepository:execution,repository,sourceRepository:{candidates:async()=>{throw Error('full scan forbidden');}}});return {db,raw,execution,supply,calls,repository};}
test('guard-only expired/swept review can be renewed without weakening merged preparation lookup',async()=>{const f=await fixture();try{
 await query(f.db,'insert into sanji_daily_supply_instagram_review_guards(owner,campaign,creator_id,last_reviewed_at) values($1,$2,$3,now()-interval \'1 day\')',[owner,campaign,cid]);
 assert.equal((await f.execution.current(owner,key,cid)).candidates[0].excluded,true);
 const source=await f.execution.instagramReviewSource(owner,key,cid);assert.equal(source.candidates[0].excluded,false);assert.equal(source.candidates[0].supplyReview,undefined);
 const result=await f.supply.review(owner,input(source.candidates[0].sourceRecordUpdated,Date.now()));assert.equal(result.saved,true);assert.equal(f.calls.length,1);
 const refreshed=(await f.execution.current(owner,key,cid)).candidates[0];assert.equal(refreshed.excluded,false);assert.ok(refreshed.supplyReview);assert.equal(refreshed.audience,40000);
 }finally{await f.db.close();}});
test('source-changed supplemental review can be renewed only against the fresh native version',async()=>{const f=await fixture();try{
 const first=(await f.execution.instagramReviewSource(owner,key,cid)).candidates[0];await f.supply.review(owner,input(first.sourceRecordUpdated,Date.now()));
 await query(f.db,"update sanji_creator_recovery set nickname='Updated Food',updated=updated+interval '1 second' where id=$1",[cid]);
 assert.equal((await f.execution.current(owner,key,cid)).candidates[0].excluded,true);
 await assert.rejects(()=>f.supply.review(owner,input(first.sourceRecordUpdated,Date.now())),e=>e.code==='INSTAGRAM_REVIEW_SOURCE_CHANGED');assert.equal(f.calls.length,1);
 const second=(await f.execution.instagramReviewSource(owner,key,cid)).candidates[0];assert.equal(second.excluded,false);assert.notEqual(second.sourceRecordUpdated,first.sourceRecordUpdated);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal((await f.supply.review(owner,input(second.sourceRecordUpdated,Date.now()))).saved,true);assert.equal(f.calls.length,2);
 assert.equal((await f.execution.current(owner,key,cid)).candidates[0].excluded,false);
 }finally{await f.db.close();}});
test('expired review and ambiguous legacy evidence cannot block fresh review, but still block execution',async()=>{const f=await fixture();try{
 const source=(await f.execution.instagramReviewSource(owner,key,cid)).candidates[0];const oldReview={...input(source.sourceRecordUpdated,Date.now()-2*86400000),reviewedBy:owner,reviewedAt:new Date(Date.now()-2*86400000).toISOString(),expiresAt:new Date(Date.now()-86400000).toISOString()};
 await query(f.db,'insert into sanji_daily_supply_instagram_reviews(owner,campaign,creator_id,source_updated,creator_key,review,reviewed_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[owner,campaign,cid,source.sourceRecordUpdated,key,oldReview,oldReview.reviewedAt,oldReview.expiresAt]);
 await query(f.db,'insert into sanji_daily_supply_instagram_review_guards(owner,campaign,creator_id,last_reviewed_at) values($1,$2,$3,$4)',[owner,campaign,cid,oldReview.reviewedAt]);
 assert.equal((await f.execution.current(owner,key,cid)).candidates[0].excluded,true);
 await query(f.db,"insert into sanji_creator_evidence(owner,creator_id,source_kind,source_ref,detail,seen_at) values($1,$2,'daily_outreach_review','a','{\"conflict\":1}','2026-01-01'),($1,$2,'daily_outreach_review','b','{\"conflict\":2}','2026-01-01')",[owner,cid]);
 await assert.rejects(()=>f.execution.current(owner,key,cid),e=>e.code==='EXECUTION_READ_FAILED');
 assert.equal((await f.execution.instagramReviewSource(owner,key,cid)).candidates[0].excluded,false);
 assert.equal((await f.supply.review(owner,input(source.sourceRecordUpdated,Date.now()))).saved,true);
 // Renewal is not permission to bypass an independent ambiguous legacy source.
 await assert.rejects(()=>f.execution.current(owner,key,cid),e=>e.code==='EXECUTION_READ_FAILED');
 }finally{await f.db.close();}});
test('native exclusions, wrong owner/key/id and changed native source remain blocked',async()=>{const f=await fixture();try{
 for(const [column,value] of [['status','contacted'],['assessment','excluded'],['entity_type','noncreator_suspected'],['link_status','unconfirmed']]){
  await query(f.db,'update sanji_creator_recovery set '+column+'=$1 where id=$2',[value,cid]);const source=(await f.execution.instagramReviewSource(owner,key,cid)).candidates[0];assert.equal(source.excluded,true);await assert.rejects(()=>f.supply.review(owner,input(source.sourceRecordUpdated,Date.now())),e=>e.code==='INSTAGRAM_REVIEW_NATIVE_EXCLUDED');
  await query(f.db,"update sanji_creator_recovery set status='new',assessment='candidate',entity_type='creator',link_status='source_confirmed' where id=$1",[cid]);
 }
 await assert.rejects(()=>f.execution.instagramReviewSource(other,key,cid));await assert.rejects(()=>f.execution.instagramReviewSource(owner,'instagram:someoneelse',cid));await assert.rejects(()=>f.execution.instagramReviewSource(owner,key,other));assert.equal(f.calls.length,0);
 await f.db.exec('set role authenticated');await assert.rejects(()=>rpc(f.db,'sanji_daily_execution_instagram_source',[owner,key,cid]),/permission denied/);
 }finally{await f.db.close();}});

test('native update racing after the raw read still aborts the authoritative SQL review save',async()=>{const f=await fixture();try{
 const source=(await f.execution.instagramReviewSource(owner,key,cid)).candidates[0],save=f.repository.saveInstagramReview;
 f.repository.saveInstagramReview=async c=>{await query(f.db,"update sanji_creator_recovery set updated=updated+interval '1 second' where id=$1",[cid]);return save(c);};
 await assert.rejects(()=>f.supply.review(owner,input(source.sourceRecordUpdated,Date.now())),/Instagram source changed/);
 assert.equal((await query(f.db,'select count(*)::int n from sanji_daily_supply_instagram_reviews where owner=$1',[owner]))[0].n,0);
 }finally{await f.db.close();}});
