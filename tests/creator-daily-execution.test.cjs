const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,NOW,OWNER,CID}=require('./helpers/creator-daily-execution-supply.cjs');
test('discovery checks all proposed keys before hydration and again before staging; never reads full source/history',async()=>{
 const {createDailySupply}=await import('../supabase/functions/creator-daily-outreach/supply.mjs'),h=harness({channelCount:3});let checks=0;
 h.sourceRepository.candidates=h.sourceRepository.history=async()=>{throw Error('full scan forbidden');};h.repository.snapshots=async()=>{throw Error('full snapshot download forbidden');};
 const executionRepository={exclusions:async(owner,keys)=>{assert.equal(owner,OWNER);assert.ok(keys.length<=100);checks++;return {complete:true,creatorKeys:keys.filter(k=>k==='youtube:'+CID(1)||checks>=4&&k==='youtube:'+CID(3))};}};
 await createDailySupply({...h,executionRepository}).run(OWNER);
 const channelCall=h.calls.find(r=>r.url.pathname.endsWith('/channels'));assert.equal(channelCall.url.searchParams.get('id'),[CID(2),CID(3)].join(','));assert.deepEqual(h.saved.map(r=>r.channelId),[CID(2)]);assert.equal(checks,4);
});
test('incomplete exclusion query blocks hydration and cannot advance the discovery cursor',async()=>{
 const {createDailySupply}=await import('../supabase/functions/creator-daily-outreach/supply.mjs'),h=harness({channelCount:3});
 await assert.rejects(()=>createDailySupply({...h,executionRepository:{exclusions:async()=>({complete:false,creatorKeys:[]})}}).run(OWNER),e=>e.code==='SUPPLY_HISTORY_INCOMPLETE');assert.ok(h.calls.every(r=>r.url.pathname.endsWith('/search')));assert.equal(h.saved.length,0);assert.equal(h.store.cursor,undefined);
});
test('paged preparation enriches only bounded current page and checks aliases afterward; uncertain save is not retried',async()=>{
 const {createExecutionPreparation}=await import('../supabase/functions/creator-daily-outreach/execution-service.mjs');const calls=[],prior={day:'2026-11-08',executionProgress:{after:{instagram:'prior'}}};let saved=0;
 const repository={findRun:async()=>null,latest:async()=>prior};const execution={page:async(owner,args)=>{assert.equal(args.previous,prior);calls.push('page');return {complete:true,candidates:[],page:{},expected:null};},historyFor:async()=>{calls.push('history');return {complete:true,creatorKeys:[],emailKeys:[]};},savePage:async()=>{saved++;throw Object.assign(Error('uncertain'),{code:'SAVE_UNCERTAIN'});}};
 const enrichment={enrich:async()=>{calls.push('enrichment');return {complete:true,candidates:[]};}};
 await assert.rejects(()=>createExecutionPreparation({repository,execution,enrichment,now:()=>NOW}).prepare(OWNER),e=>e.code==='SAVE_UNCERTAIN');assert.deepEqual(calls,['page','enrichment','history']);assert.equal(saved,1);
});
test('targeted history response missing requested identity or mismatched owner envelope fails closed',async()=>{
 const {createExecutionRepository,adaptExecutionEnvelope}=await import('../supabase/functions/creator-daily-outreach/execution-repository.mjs');
 const repo=createExecutionRepository({rpc:async()=>({data:{complete:true,scope:'all_saved_sanji_history',gmailProviderHistoryChecked:false,matches:[]}})});
 await assert.rejects(()=>repo.exclusions(OWNER,['youtube:'+CID(1)]),e=>e.code==='EXECUTION_HISTORY_INCOMPLETE');
 assert.throws(()=>adaptExecutionEnvelope(OWNER,{creatorKey:'instagram:food',kind:'instagram',native:{owner:'other',id:'id',handle:'food'},evidence:[]}),e=>e.code==='EXECUTION_SOURCE_INVALID');
});
