const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,query,owner,other,cid}=require('./helpers/creator-daily-execution-fixture.cjs');
const rpc=async(db,name,args)=> (await query(db,'select sanji_daily_execution_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
const yt=n=>'youtube:UC'+String(n).padStart(22,'0');
const input=(creatorKey,emailKeys=[],sourceRecordId=null)=>({creatorKey,emailKeys,sourceRecordId});
test('local eight-schema execution functions install and remain service-only/invoker',async()=>{const db=await setup();try{
 const functions=await query(db,"select proname,prosecdef,has_function_privilege('authenticated',oid,'EXECUTE') allowed from pg_proc where pronamespace='public'::regnamespace and proname like 'sanji_daily_execution_%'");assert.equal(functions.length,8);assert.ok(functions.every(r=>!r.prosecdef&&!r.allowed));
 await db.exec('set role service_role');const page=await rpc(db,'page',[owner,null,{youtube:50,instagram:10},null,false]);assert.equal(page.complete,true);assert.deepEqual(page.rows,[]);
 await assert.rejects(()=>rpc(db,'page',['33333333-1111-4111-8111-111111111111',null,{youtube:50,instagram:10},null,false]),/invalid/);
 }finally{await db.close();}});
test('26,552 native IG rows do not cause scans/downloads and latest tie ambiguity fails closed',async()=>{const db=await setup();try{
 await db.exec(`insert into sanji_creator_recovery(id,owner,handle,nickname,profile_url) select md5('ig'||n)::uuid,'${owner}','food_'||lpad(n::text,6,'0'),'Food','https://www.instagram.com/food_'||lpad(n::text,6,'0')||'/' from generate_series(1,26552) n;`);
 await db.exec(`insert into sanji_creator_evidence(owner,creator_id,source_kind,detail) select owner,id,'daily_outreach_review','{"marker":"last reviewed"}' from sanji_creator_recovery where handle='food_026552';`);
 const page=await rpc(db,'page',[owner,null,{youtube:50,instagram:10},null,false]);assert.equal(page.rows.length,1);assert.equal(page.rows[0].creatorKey,'instagram:food_026552');assert.equal(page.unreviewedInstagram,26551);assert.equal(page.total.instagram,1);assert.ok(JSON.stringify(page).length<5000);
 const current=await rpc(db,'current',[owner,'instagram:food_000001',null]);assert.equal(current.row.native.handle,'food_000001','direct lookup supports currently unreviewed sources');
 const old=page.snapshot.instagram;await db.exec("update sanji_creator_recovery set nickname='Changed' where handle='food_000001'");const next=await rpc(db,'page',[owner,{snapshot:page.snapshot,after:page.last},{youtube:50,instagram:10},null,false]);assert.notEqual(next.snapshot.instagram,old);assert.equal(next.after.instagram,'','same-count edit behind cursor resets safely');
 await db.exec(`insert into sanji_creator_evidence(owner,creator_id,source_kind,source_ref,detail,seen_at) select owner,creator_id,source_kind,'conflict','{"marker":"conflicting"}',seen_at from sanji_creator_evidence;`);await assert.rejects(()=>rpc(db,'current',[owner,'instagram:food_026552',null]),/ambiguous/);
 }finally{await db.close();}});
test('global nested history resolves refs and canonical aliases, across every native history branch',async()=>{const db=await setup();try{
 await query(db,"insert into sanji_creator_recovery(id,owner,handle) values($1,$2,'foodperson')",[cid,owner]);
 const branches=[
 ["insert into sanji_creator_manual_notes(owner,payload) values($1,$2)",{deep:{creatorReviewId:cid,mail:'First.Last+old@googlemail.com'}}],
 ["insert into sanji_creator_contact_review(owner,data) values($1,$2)",{nested:{channel_id:yt(11).slice(8)}}],
 ["insert into sanji_creator_inbound_messages(owner,data) values($1,$2)",{nested:{identity:'INSTAGRAM:UPPERHANDLE'}}],
 ["insert into sanji_creator_email_isolated_queue(owner,snapshot) values($1,$2)",{nested:{creatorKey:yt(12)}}],
 ["insert into sanji_instagram_inbound(owner,body) values($1,$2)",'https://www.youtube.com/channel/'+yt(13).slice(8)],
 ["insert into sanji_instagram_reply_attempts(owner,body) values($1,$2)",'https://instagram.com/lastreply/']
 ];for(const [sql,data] of branches)await query(db,sql,[owner,data]);
 await query(db,"insert into sanji_ig_manual_conversations(owner,creator_id,username) values($1,$2,'Manual')",[owner,cid]);
 await query(db,"insert into sanji_suppression(owner,identity) values($1,$2)",[owner,yt(14)]);
 await query(db,"insert into sanji_records(id,owner,kind,data) values($1,$2,'candidate',$3)",[cid,owner,{channels:'YouTube',youtubeResearch:{channelId:yt(15).slice(8)}}]);
 await query(db,"insert into sanji_drafts(id,owner,data) values($1,$2,$3)",[cid,owner,{nested:{target:cid}}]);await query(db,'insert into sanji_jobs(owner,draft_id) values($1,$2)',[owner,cid]);
 const keys=['instagram:foodperson','instagram:upperhandle','instagram:manual','instagram:lastreply',...Array.from({length:5},(_,i)=>yt(11+i))];
 const result=await rpc(db,'identities',[owner,keys.map(k=>input(k,['firstlast@gmail.com'])),false]);assert.ok(result.matches.every(m=>m.duplicateCreator),JSON.stringify(result));assert.ok(result.matches.every(m=>m.emailKeys.includes('firstlast@gmail.com')));
 const foreign=await rpc(db,'identities',[other,keys.map(k=>input(k,['firstlast@gmail.com'])),true]);assert.ok(foreign.matches.every(m=>!m.duplicateCreator&&!m.emailKeys.length&&!m.saved));
 const exact=(await query(db,'select entry from sanji_daily_outreach_saved_history($1)',[owner])).map(r=>r.entry);assert.ok(exact.some(r=>r.dailyExactCreatorKeys?.includes('instagram:foodperson')),'authoritative prepare/send receive exact recursive creator tokens too');
 await query(db,'insert into sanji_jobs(owner,draft_id) values($1,gen_random_uuid())',[owner]);await assert.rejects(()=>rpc(db,'identities',[owner,[input(yt(99))],false]),/incomplete saved history/);
 }finally{await db.close();}});
test('discovery excludes all saved and historical channels, but IG source presence is not contact history',async()=>{const db=await setup();try{
 await query(db,"insert into sanji_records(owner,kind,data) values($1,'candidate',$2)",[owner,{channels:'YouTube',youtubeResearch:{channelId:yt(1).slice(8)},status:'제외'}]);await query(db,"insert into sanji_creator_recovery(id,owner,handle) values($1,$2,'newperson')",[cid,owner]);
 const result=await rpc(db,'identities',[owner,[input(yt(1)),input('instagram:newperson')],true]);assert.equal(result.matches.find(r=>r.creatorKey===yt(1)).saved,true);assert.equal(result.matches.find(r=>r.creatorKey==='instagram:newperson').duplicateCreator,false);
 }finally{await db.close();}});
test('two platform cursors do not consume quota overflow and resume across days; checkpoint is atomic',async()=>{const db=await setup();try{
 await db.exec(`insert into sanji_records(owner,kind,data) select '${owner}','candidate',jsonb_build_object('channels','YouTube','youtubeResearch',jsonb_build_object('channelId','UC'||lpad(n::text,22,'0'))) from generate_series(1,55) n;
 insert into sanji_creator_recovery(id,owner,handle) select md5('pageig'||n)::uuid,'${owner}','page_'||lpad(n::text,3,'0') from generate_series(1,25) n;
 insert into sanji_creator_evidence(owner,creator_id,source_kind,detail) select owner,id,'daily_outreach_review','{}' from sanji_creator_recovery;`);
 const page=await rpc(db,'page',[owner,null,{youtube:50,instagram:10},null,false]);assert.equal(page.rows.length,60);assert.equal(page.rows.filter(r=>r.kind==='instagram').length,10);
 const {outreachDay,buildDailyOutreachBatch}=await import('../supabase/functions/creator-daily-outreach/domain.mjs');const day=outreachDay(),plan=buildDailyOutreachBatch({candidates:[],history:{complete:true,creatorKeys:[],emailKeys:[]}});
 const saved=await rpc(db,'prepare_page',[owner,day,plan,page,null]);assert.equal(saved.morePreparationRequired,true);assert.deepEqual(saved.executionProgress.after,page.last);
 await assert.rejects(()=>rpc(db,'prepare_page',[owner,day,plan,page,null]),/checkpoint changed/);
 const resumed=await rpc(db,'page',[owner,saved.executionProgress,{youtube:50,instagram:10},null,true]);assert.equal(resumed.rows.filter(r=>r.kind==='youtube').length,5);assert.equal(resumed.rows.filter(r=>r.kind==='instagram').length,10);assert.equal(resumed.rows.find(r=>r.kind==='instagram').creatorKey,'instagram:page_011');
 const bounds=await rpc(db,'page',[owner,saved.executionProgress,{youtube:0,instagram:3},null,false]);assert.equal(bounds.rows.length,3);assert.equal(bounds.last.youtube,page.last.youtube);assert.equal(bounds.rows[0].creatorKey,'instagram:page_011');
 await query(db,"update sanji_creator_recovery set nickname='Edited behind page' where handle='page_001'");
 await assert.rejects(()=>rpc(db,'prepare_page',[owner,day,plan,resumed,saved.executionProgress]),/page changed/);
 const unchanged=(await query(db,'select summary from sanji_daily_outreach_runs where owner=$1',[owner]))[0].summary;assert.deepEqual(unchanged.executionProgress,saved.executionProgress);
 }finally{await db.close();}});
test('API cursor content is physically removed at its earliest expiry while native IG continuation survives',async()=>{const db=await setup();try{
 const progress={after:{youtube:yt(1)+':api',instagram:'instagram:food_010:'+cid},snapshot:{youtube:'api-digest',instagram:'native-digest'},youtubeExpiresAt:new Date(Date.now()-1000).toISOString()};
 await query(db,"insert into sanji_daily_outreach_runs(owner,day,campaign,summary) values($1,current_date,'mara-jjamppong-bread',$2)",[owner,{executionProgress:progress}]);
 await db.exec('set role service_role');const result=(await query(db,'select sanji_daily_outreach_sweep() result'))[0].result;assert.equal(result.executionApiCursorsRemoved,1);
 const summary=(await query(db,'select summary from sanji_daily_outreach_runs where owner=$1',[owner]))[0].summary;assert.equal(summary.executionProgress.after.youtube,'');assert.equal(summary.executionProgress.snapshot.youtube,'');assert.equal(summary.executionProgress.after.instagram,progress.after.instagram);
 }finally{await db.close();}});
test('identity lookup includes history beyond the former 10,000-record ceiling without returning it',async()=>{const db=await setup();try{
 await db.exec(`insert into sanji_creator_manual_notes(owner,payload) select '${owner}',jsonb_build_object('nested',jsonb_build_object('creatorKey','youtube:UC'||lpad(n::text,22,'0'))) from generate_series(1,10001) n;`);
 const result=await rpc(db,'identities',[owner,[input(yt(10001))],false]);assert.equal(result.matches[0].duplicateCreator,true);assert.ok(JSON.stringify(result).length<1000);
 }finally{await db.close();}});
test('page slots use current eligible recipient counts, not stale legacy 500k summary counts',async()=>{const db=await setup();try{
 await query(db,"insert into sanji_daily_outreach_runs(owner,day,campaign,summary) values($1,(now() at time zone 'Asia/Seoul')::date,'mara-jjamppong-bread',$2)",[owner,{counts:{youtube:50,instagram:10}}]);
 for(const [n,platform,audience,expired] of [[1,'youtube',250000,false],[2,'youtube',150000,false],[3,'youtube',100000,true],[4,'instagram',350000,false]])await query(db,"insert into sanji_daily_outreach_candidates(owner,creator_key,email_key,recipient,platform,day,snapshot,expires_at) values($1,$2,$3,$3,$4,(now() at time zone 'Asia/Seoul')::date,$5,now()+($6::int*interval '1 day'))",[owner,platform==='youtube'?yt(n):'instagram:largeig','person'+n+'@example.com',platform,{audience},expired?-1:1]);
 const page=await rpc(db,'page',[owner,null,{youtube:50,instagram:10},null,false]);assert.deepEqual(page.counts,{youtube:1,instagram:1});assert.deepEqual(page.limits,{youtube:49,instagram:9});
 const history=await rpc(db,'identities',[owner,[input(yt(1),['person1@example.com'])],false]);assert.equal(history.matches[0].duplicateCreator,true);assert.deepEqual(history.matches[0].emailKeys,['person1@example.com']);
 }finally{await db.close();}});
test('execution cursors use explicit C ordering for mixed-case digit underscore and hyphen channel IDs',async()=>{const db=await setup();try{
 const fs=require('node:fs'),sql=fs.readFileSync('supabase/pending/creator-daily-execution-reads.sql','utf8');assert.match(sql,/execution-v2-c-collation:/);const pageSql=sql.slice(sql.indexOf('create function public.sanji_daily_execution_page('),sql.indexOf('create function public.sanji_daily_execution_current('));
 assert.equal((pageSql.match(/page_key collate "C">after_key collate "C"/g)||[]).length,2);assert.equal((pageSql.match(/order by page_key collate "C"/g)||[]).length,2);assert.match(pageSql,/max\(page_key collate "C"\)/);assert.doesNotMatch(pageSql,/page_key>after_key|order by page_key(?! collate "C")|max\(page_key\)/);
 const ids=['a','A','z','Z','0','9','_','-'].map(c=>'UC'+c+'0'.repeat(21));
 for(const channelId of ids)await query(db,"insert into sanji_records(owner,kind,data) values($1,'candidate',$2)",[owner,{channels:'YouTube',youtubeResearch:{channelId}}]);
 const keys=[];let resume=null;
 for(let n=0;n<4;n++){
  const page=await rpc(db,'page',[owner,resume,{youtube:2,instagram:0},null,false]);assert.equal(page.rows.length,2);const pageKeys=page.rows.map(r=>r.pageKey);assert.deepEqual(pageKeys,[...pageKeys].sort());assert.equal(page.last.youtube,pageKeys.at(-1));if(resume)assert.ok(pageKeys[0]>resume.after.youtube);
  keys.push(...page.rows.map(r=>r.creatorKey));resume={snapshot:page.snapshot,after:page.last,exhausted:page.exhausted,youtubeExpiresAt:page.youtubeExpiresAt};assert.equal(page.hasMore.youtube,n<3);
 }
 assert.deepEqual(keys,ids.map(id=>'youtube:'+id).sort());assert.equal(new Set(keys).size,ids.length);
 const final=await rpc(db,'page',[owner,resume,{youtube:2,instagram:0},null,false]);assert.deepEqual(final.rows,[]);assert.equal(final.last.youtube,resume.after.youtube);assert.equal(final.exhausted.youtube,true);
 }finally{await db.close();}});

test('six base schemas plus criteria upgrade and execution reads need no scheduler kick or credential infrastructure',async()=>{const db=await setup();try{
 const absent=(await query(db,"select to_regprocedure('public.sanji_daily_supply_kick()') kick,(select count(*)::int from pg_namespace where nspname in('cron','net','vault')) infrastructure"))[0];assert.equal(absent.kick,null);assert.equal(absent.infrastructure,0);
 await db.exec('set role service_role');const page=await rpc(db,'page',[owner,null,{youtube:50,instagram:10},null,false]);assert.equal(page.complete,true);
 const {buildDailyOutreachBatch,outreachDay}=await import('../supabase/functions/creator-daily-outreach/domain.mjs');const plan=buildDailyOutreachBatch({candidates:[],history:{complete:true,creatorKeys:[],emailKeys:[]}}),saved=await rpc(db,'prepare_page',[owner,outreachDay(),plan,page,null]);assert.equal(saved.sendingEnabled,false);assert.equal(saved.schedulerEnabled,false);assert.equal(saved.targetUnit,'distinct_verified_business_email');
 }finally{await db.close();}});
