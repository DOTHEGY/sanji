const {test}=require('node:test'),assert=require('node:assert/strict');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',CAMPAIGN='mara-jjamppong-bread';
const id=i=>'33333333-3333-4333-8333-'+String(i).padStart(12,'0');
function mock(tables={},options={}){
 const calls=[];
 return {calls,from(table){
  const filters=[],orders=[];let max=Infinity,columns='*',params={};
  const q={select(value,p={}){columns=value;params=p;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},in(k,values){filters.push(r=>values.includes(r[k]));return q;},order(k,{ascending=true}={}){orders.push([k,ascending]);return q;},limit(n){max=n;return q;},then(resolve,reject){
   let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r))).sort((a,b)=>{for(const [key,asc] of orders){if(a[key]!==b[key])return (a[key]<b[key]?-1:1)*(asc?1:-1);}return 0;});
   const count=rows.length;rows=params.head?null:rows.slice(0,Math.min(max,options.cap??Infinity)).map(row=>columns==='*'?{...row}:Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
   const call={table,head:params.head===true,counted:params.count==='exact',limit:max,columns,rows:rows?.length||0};calls.push(call);
   const result={data:rows,count:params.count==='exact'?count:null,error:null};
   return Promise.resolve(options.response?options.response(result,call,calls.length):result).then(resolve,reject);
  }};return q;
 }};
}
function native(i){return {owner:OWNER,id:id(i),handle:'creator_'+i,nickname:'Creator '+i,profile_url:'https://www.instagram.com/creator_'+i+'/',updated:'2026-11-08T00:00:00Z',followers:35000,followers_source:'https://www.instagram.com/creator_'+i+'/',followers_checked:'2026-11-08T00:00:00Z',status:'new',assessment:i%7===0?'excluded':'candidate',entity_type:'creator',link_status:'source_confirmed'};}
const load=()=>import('../supabase/functions/creator-daily-outreach/repository.mjs');

test('production-size native review page is bounded, exact and independent of full candidate/history scans',async()=>{
 const rows=Array.from({length:26552},(_,i)=>native(i+1)),sb=mock({sanji_creator_recovery:[...rows,{...native(30000),owner:OTHER}],sanji_records:Array.from({length:777},(_,i)=>({owner:OWNER,id:id(i),kind:'candidate',data:{}}))});
 const repository=(await load()).createOutreachRepository(sb),page=await repository.reviewCandidates(OWNER);
 assert.equal(page.pageComplete,true);assert.equal(page.complete,undefined);assert.equal(page.candidates.length,50);assert.deepEqual(page.pagination,{scope:'existing_instagram_database',cursor:null,nextCursor:id(50),pageSize:50,total:26552,remaining:26552,returned:50,hasMore:true});
 assert.equal(page.candidates[6].excluded,true);assert.equal(page.candidates[0].sourceRecordUpdated,rows[0].updated);
 assert.ok(sb.calls.every(c=>['sanji_creator_recovery','sanji_creator_evidence'].includes(c.table)));assert.ok(sb.calls.filter(c=>c.table==='sanji_creator_recovery'&&!c.head).every(c=>c.limit===50&&c.rows===50));
 const next=await repository.reviewCandidates(OWNER,{cursor:page.pagination.nextCursor});assert.equal(next.candidates[0].sourceRecordId,id(51));assert.equal(next.pagination.remaining,26502);
 const last=await repository.reviewCandidates(OWNER,{cursor:id(26550)});assert.equal(last.pagination.returned,2);assert.equal(last.pagination.nextCursor,null);assert.equal(last.pagination.hasMore,false);
 await assert.rejects(()=>repository.candidates(OWNER),e=>e.code==='SOURCES_INCOMPLETE');await assert.rejects(()=>repository.history(OWNER),e=>e.code==='SOURCES_INCOMPLETE');
});
test('short server caps still expose honest continuation without fetching all pages',async()=>{
 const sb=mock({sanji_creator_recovery:Array.from({length:8},(_,i)=>native(i+1))},{cap:3}),repository=(await load()).createOutreachRepository(sb);
 const first=await repository.reviewCandidates(OWNER);assert.equal(first.candidates.length,3);assert.equal(first.pagination.total,8);assert.equal(first.pagination.nextCursor,id(3));
 const second=await repository.reviewCandidates(OWNER,{cursor:id(3)});assert.equal(second.pagination.remaining,5);assert.equal(second.pagination.nextCursor,id(6));assert.equal(sb.calls.filter(c=>c.table==='sanji_creator_recovery'&&!c.head).length,4);
});
test('missing counts, ownership leaks, wrong order, empty partial pages and changed versions fail closed',async()=>{
 for(const response of [r=>({...r,count:null}),(r,c)=>!c.head&&c.table==='sanji_creator_recovery'?{...r,data:r.data.map(x=>({...x,owner:OTHER}))}:r,(r,c)=>!c.head&&c.table==='sanji_creator_recovery'?{...r,data:[...r.data].reverse()}:r,(r,c)=>!c.head&&c.table==='sanji_creator_recovery'?{...r,data:[]}:r]){
  const repository=(await load()).createOutreachRepository(mock({sanji_creator_recovery:[native(1),native(2)]},{response}));await assert.rejects(()=>repository.reviewCandidates(OWNER));
 }
 let read=0;const repository=(await load()).createOutreachRepository(mock({sanji_creator_recovery:[native(1)]},{response:(r,c)=>!c.head&&c.table==='sanji_creator_recovery'?{...r,data:r.data.map(x=>({...x,updated:String(++read)}))}:r}));await assert.rejects(()=>repository.reviewCandidates(OWNER),e=>e.code==='REVIEW_PAGE_CHANGED');
});
test('malformed cursors fail before reads and page-scoped evidence never includes another creator',async()=>{
 const repository=(await load()).createOutreachRepository(mock());for(const cursor of ['', 'not-a-uuid','x'.repeat(1000),{id:id(1)},1])await assert.rejects(()=>repository.reviewCandidates(OWNER,{cursor}),e=>e.code==='REVIEW_CURSOR_INVALID');
 const sb=mock({sanji_creator_recovery:[native(1)],sanji_creator_evidence:[{owner:OWNER,creator_id:id(2),source_kind:'daily_outreach_review',detail:{contactEvidence:[{address:'must-not-leak@example.com'}]}}]});const page=await (await load()).createOutreachRepository(sb).reviewCandidates(OWNER);assert.deepEqual(page.candidates[0].contactEvidence,[]);
});
test('source registry pages list latest versions only and never read native candidates or call RPC',async()=>{
 const {createContactEnrichmentRepository}=await import('../supabase/functions/creator-daily-outreach/contact-enrichment-repository.mjs');
 const versions=Array.from({length:25},(_,i)=>[1,2,3].map(revision=>({owner:OWNER,source_id:id(i+1),revision,creator_key:'instagram:creator_'+i,source_url:'https://www.instagram.com/creator_'+i+'/',source_kind:'instagram_public_bio',state:revision===3?'revoked':revision===2?'reviewed':'pending'}))).flat();
 const sb=mock({sanji_contact_source_versions:[...versions,{...versions[0],owner:OTHER,source_id:id(100)}]}),repository=createContactEnrichmentRepository(sb),first=await repository.listRegisteredSources(OWNER);
 assert.equal(first.scope,'registered_contact_sources');assert.equal(first.items.length,20);assert.equal(first.pagination.total,25);assert.equal(first.pagination.remaining,25);assert.equal(first.pagination.nextCursor,id(20));assert.ok(first.items.every(x=>x.revision===3&&x.state==='revoked'));assert.equal(first.approvalEnabled,false);assert.equal(first.registrationEnabled,true);assert.ok(sb.calls.every(c=>c.table==='sanji_contact_source_versions'));assert.ok(sb.calls.every(c=>c.head||c.limit<=20));
 const second=await repository.listRegisteredSources(OWNER,{cursor:id(20)});assert.equal(second.items.length,5);assert.equal(second.pagination.nextCursor,null);assert.equal(second.pagination.remaining,5);
});
test('a changed latest registry version fails closed rather than presenting an older approval',async()=>{
 const {createContactEnrichmentRepository}=await import('../supabase/functions/creator-daily-outreach/contact-enrichment-repository.mjs');let reads=0;
 const sb=mock({sanji_contact_source_versions:[{owner:OWNER,source_id:id(1),revision:1,creator_key:'instagram:creator',source_url:'https://www.instagram.com/creator/',source_kind:'instagram_public_bio',state:'pending'}]},{response:(r,c)=>c.limit===1?{...r,data:r.data.map(row=>({...row,revision:++reads}))}:r});await assert.rejects(()=>createContactEnrichmentRepository(sb).listRegisteredSources(OWNER),e=>e.code==='contact_sources_changed');
});
test('supply review GET uses a native page and page-scoped proof without invoking complete-source preparation',async()=>{
 const {createDailySupply}=await import('../supabase/functions/creator-daily-outreach/supply.mjs'),sb=mock({sanji_creator_recovery:[native(1)]}),repository=(await load()).createOutreachRepository(sb),calls=[];
 const supply=createDailySupply({sourceRepository:{reviewCandidates:repository.reviewCandidates,candidates:async()=>{throw Error('complete candidates must not run for GET');}},repository:{snapshots:async()=>[],reviews:async()=>[],instagramReviews:async(owner,campaign,ids)=>{calls.push(ids);return [];},instagramReviewGuards:async(owner,campaign,ids)=>{calls.push(ids);return [];}}});
 const result=await supply.listReview(OWNER);assert.equal(result.preparationEligibilityChecked,false);assert.equal(result.scope,'paged_native_instagram_and_current_youtube_snapshots');assert.equal(result.items.length,1);assert.deepEqual(calls,[[id(1)],[id(1)]]);await assert.rejects(()=>supply.sourceCandidates(OWNER),/complete candidates must not run/);
});
test('supplemental Instagram proof paging never broadens complete-source scans or leaks page IDs',async()=>{
 const {createSupplyRepository}=await import('../supabase/functions/creator-daily-outreach/supply-repository.mjs'),sb=mock({sanji_daily_supply_instagram_reviews:[{owner:OWNER,campaign:CAMPAIGN,creator_id:id(1),expires_at:'2100-01-01T00:00:00Z'},{owner:OWNER,campaign:CAMPAIGN,creator_id:id(2),expires_at:'2100-01-01T00:00:00Z'}],sanji_daily_supply_instagram_review_guards:[{owner:OWNER,campaign:CAMPAIGN,creator_id:id(1)},{owner:OWNER,campaign:CAMPAIGN,creator_id:id(2)}]}),repository=createSupplyRepository(sb);
 assert.equal((await repository.instagramReviews(OWNER,CAMPAIGN,[id(2)])).length,1);assert.equal((await repository.instagramReviewGuards(OWNER,CAMPAIGN,[id(2)]))[0].creator_id,id(2));assert.equal((await repository.instagramReviews(OWNER,CAMPAIGN)).length,2);
 const before=sb.calls.length;assert.deepEqual(await repository.instagramReviews(OWNER,CAMPAIGN,[]),[]);assert.equal(sb.calls.length,before);
});
test('authenticated GET cursor parsing rejects unknown, duplicated and malformed input before controller work',async()=>{
 const {campaignHandler}=await import('../supabase/functions/creator-daily-outreach/campaign-controller.mjs'),calls=[];
 const sb={auth:{getUser:async()=>({data:{user:{id:OWNER}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{user_id:OWNER}})})};
 const handler=campaignHandler({sb,controller:{supplyReview:async(owner,options)=>{calls.push({owner,options});return {ok:true};},sourceReviewList:async(owner,options)=>{calls.push({owner,options});return {ok:true};}}});
 const request=path=>new Request('https://example.com/creator-daily-outreach'+path,{headers:{Authorization:'Bearer test'}});
 for(const path of ['/supply-review?cursor=','/supply-review?cursor=invalid','/source-reviews?cursor='+id(1)+'&cursor='+id(2),'/source-reviews?owner='+OTHER,'/supply-review?limit=5000'])assert.equal((await handler(request(path))).status,400,path);
 assert.equal(calls.length,0);assert.equal((await handler(request('/supply-review?cursor='+id(1)))).status,200);assert.deepEqual(calls[0],{owner:OWNER,options:{cursor:id(1)}});assert.equal((await handler(request('/source-reviews'))).status,200);assert.equal(calls[1].options.cursor,null);
});
test('real campaign runtime restores both read views at production scale without provider or mutation calls',async()=>{
 const {createCampaignRuntime}=await import('../supabase/functions/creator-daily-outreach/campaign-runtime.mjs');
 const sb=mock({sanji_creator_recovery:Array.from({length:26552},(_,i)=>native(i+1))});
 sb.rpc=async()=>{throw Error('GET must never call a write/RPC');};
 const runtime=createCampaignRuntime({sb,env:()=>'',request:async()=>{throw Error('GET must not call provider');},network:{read:async()=>{throw Error('GET must not fetch sources');}}});
 const supply=await runtime.controller.supplyReview(OWNER,{cursor:null}),sources=await runtime.controller.sourceReviewList(OWNER,{cursor:null});
 assert.equal(supply.items.length,50);assert.equal(supply.pagination.total,26552);assert.equal(sources.pagination.total,0);assert.deepEqual(sources.items,[]);assert.equal(sources.approvalEnabled,false);
 await assert.rejects(()=>runtime.supply.sourceCandidates(OWNER),e=>e.code==='SOURCES_INCOMPLETE');
});
