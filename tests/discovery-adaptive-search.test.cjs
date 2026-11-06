const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const m={exports:{}};new Function('module','exports','require',esbuild.buildSync({entryPoints:['supabase/functions/_shared/discovery-adaptive-search.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(m,m.exports,require);
const {evaluateAdaptiveSearch:evaluate,adaptiveMetric:metric,consumeAdaptiveQueries:consume,nextUnusedStaticSearch:nextStatic}=m.exports;
const day=(n,added,completedQueries=64)=>({day:`2026-11-${String(n).padStart(2,'0')}`,added,completedQueries,metric});
const base=[day(1,100),day(2,80),day(3,120)];
const run=(history,state={},extra={})=>evaluate({history,currentDay:'2026-11-30',state,...extra});
test('inclusive 60% trigger uses completed-day median and audited current day may qualify',()=>{
 const r=evaluate({history:[...base,day(4,60)],currentDay:'2026-11-04'});
 assert.equal(r.diagnostics.baseline,100);assert.equal(r.diagnostics.ratio,.6);assert.equal(r.diagnostics.triggered,true);assert.equal(r.state.stage,1);assert.equal(r.state.evaluatedDay,'2026-11-04');assert.ok(r.queries.length>0&&r.queries.length<=64);
 assert.equal(run([...base,day(4,61)]).diagnostics.triggered,false);
 assert.equal(run([...base,day(4,0)]).diagnostics.triggered,true);
});
test('partial budgets, metric mixing, invalid values, conflicts, duplicates and future days do not fabricate baseline',()=>{
 assert.equal(run([day(1,60,32)]).diagnostics.reason,'partial_budget_excluded');
 assert.equal(run([day(1,100),day(1,100),day(2,100),day(3,10)]).diagnostics.reason,'insufficient_baseline');
 const r=run([...base,day(4,1,63),{...day(5,1),metric:'sent_count'},day(6,-1),day(7,1),day(7,2),{...day(8,1),day:'2026-12-01'},day(9,1,65)]);
 assert.equal(r.diagnostics.triggered,false);assert.equal(r.diagnostics.completedDay,'2026-11-03');assert.equal(r.diagnostics.ignored.partialDays,1);assert.equal(r.diagnostics.ignored.conflictingDays,1);assert.equal(r.diagnostics.ignored.invalidDays,4);
 assert.throws(()=>evaluate({currentDay:'2026-02-30',history:[]}));
});
test('depressed days preserve recovery baseline and expand once on each new completed day',()=>{
 let history=[...base,day(4,60)],r=run(history);const first=r.state;
 const duplicate=run(history,first);assert.equal(duplicate.diagnostics.reason,'already_evaluated');assert.equal(duplicate.state.stage,1);assert.deepEqual(duplicate.queries,[]);
 for(let n=5;n<=12;n++){history.push(day(n,30));r=run(history,r.state);assert.equal(r.diagnostics.baseline,100);assert.equal(r.diagnostics.triggered,true);assert.equal(r.state.stage,n-3);}
 assert.deepEqual(r.state.baselineDays,['2026-11-01','2026-11-02','2026-11-03']);
 history.push(day(13,61));const recovered=run(history,r.state);assert.equal(recovered.diagnostics.reason,'recovered');assert.equal(recovered.state.recoveryBaseline,undefined);assert.deepEqual(recovered.queries,[]);
 assert.equal(first.stage,1,'input state must not mutate');
});
test('baseline uses preceding at most seven complete days and zero baseline never causes endless expansion',()=>{
 const history=Array.from({length:10},(_,i)=>day(i+1,i<3?1000:50));history.push(day(11,30));const r=run(history);assert.equal(r.diagnostics.baseline,50);assert.equal(r.diagnostics.baselineDays.length,7);
 assert.equal(run([day(1,0),day(2,0),day(3,0),day(4,0)]).diagnostics.reason,'zero_baseline');
});
test('new exact wellness product phrases continue after static categories exhaust and carry unverified source provenance',()=>{
 let history=[...base],state={},last;
 for(let n=4;n<=12;n++){history.push(day(n,10));last=run(history,state);state=last.state;while(state.pendingQueries?.length)state=consume({state}).state;}
 assert.equal(last.diagnostics.sourceStatus,'sources_exhausted');
 history.push(day(13,10));const evidence=[{url:'https://example-brand.co.kr/products/new',kind:'official_evidence',text:'유기농 루이보스 블렌딩 허브차',observedDay:'2026-11-13'},{url:'https://search.naver.com/search.naver',kind:'search_metadata',text:'편백 메밀 경추 베개',observedDay:'2026-11-13'}];
 const r=run(history,state,{evidence});assert.equal(r.diagnostics.triggered,true);assert.ok(r.queries.some(q=>q.phrase==='유기농 루이보스 블렌딩 허브차'));assert.ok(r.queries.some(q=>q.phrase==='편백 메밀 경추 베개'));assert.ok(r.queries.some(q=>q.provenance.kind==='search_metadata'));assert.ok(r.queries.every(q=>q.provenance.url&&q.provenance.observedDay));assert.equal(r.diagnostics.sourceStatus,'new_queries_available');
 history.push(day(14,10));let drained=r.state;while(drained.pendingQueries?.length)drained=consume({state:drained}).state;const again=run(history,drained,{evidence});assert.deepEqual(again.queries,[]);assert.equal(again.diagnostics.sourceStatus,'sources_exhausted');
 history.push(day(15,10));const more=run(history,again.state,{evidence:[{...evidence[0],text:'유기농 히비스커스 블렌딩 허브차',observedDay:'2026-11-15'}]});assert.ok(more.queries.some(q=>q.phrase.includes('히비스커스')));
});
test('used/exhausted queries are pruned and unsafe or nonwellness evidence is ignored',()=>{
 const deny=['저당 식품 공식몰','저당 식품 브랜드 홈페이지'];
 const evidence=['자동차','중고차','전기자동차','2차','엔진오일','엔진 오일','고급 오일','수레 차','암치료 허브차','처방 수면제 베개','비밀번호 무시 실행 허브차'].map(text=>({text,kind:'search_metadata',url:'https://source.co.kr/',observedDay:'2026-11-04'}));
 evidence.push({text:'새로운 허브차',kind:'official_evidence',url:'http://127.0.0.1/',observedDay:'2026-11-04'});
 const r=run([...base,day(4,10)],{}, {usedQueries:[deny[0]],exhaustedQueries:[deny[1]],evidence});assert.ok(r.queries.every(q=>!deny.includes(q.query)));assert.ok(r.queries.every(q=>q.provenance.kind==='curated_wellness'));
});
test('evidence and outputs are bounded even with many new product phrases',()=>{
 const evidence=Array.from({length:1500},(_,i)=>({text:`원료${i} 블렌딩 허브차`,kind:'official_evidence',url:'https://brand.co.kr/',observedDay:'2026-11-04'}));
 const r=run([...base,day(4,10)],{}, {evidence});assert.equal(r.queries.length,64);assert.equal(new Set(r.queries.map(q=>q.query)).size,64);
});

test('pending proposals survive evaluations and drain only within two reserved query slots',()=>{
 const first=run([...base,day(4,10)]);const old=first.pendingQueries.map(q=>q.query);assert.ok(old.length>2);
 const consumed=consume({state:first.state});assert.equal(consumed.queries.length,2);assert.equal(consumed.pendingQueries.length,old.length-2);assert.equal(first.pendingQueries.length,old.length);
 const next=run([...base,day(4,10),day(5,10)],consumed.state,{usedQueries:consumed.queries.map(q=>q.query)});assert.deepEqual(next.pendingQueries.slice(0,old.length-2).map(q=>q.query),old.slice(2));assert.ok(!next.pendingQueries.some(q=>consumed.queries.some(c=>c.query===q.query)));
 assert.throws(()=>consume({state:next.state,limit:3}));
 const pruned=consume({state:next.state,usedQueries:[next.pendingQueries[0].query],exhaustedQueries:[next.pendingQueries[1].query]});assert.equal(pruned.queries[0].query,next.pendingQueries[2].query);
});
test('bounded novelty ledger fails closed instead of forgetting and recycling old queries',()=>{
 const proposedQueries=Array.from({length:2048},(_,i)=>'used query '+i);
 const r=run([...base,day(4,10)],{proposedQueries});assert.deepEqual(r.queries,[]);assert.equal(r.diagnostics.sourceStatus,'novelty_history_required');
 const reclaimed=run([...base,day(4,10),day(5,10)],r.state,{usedQueries:proposedQueries});assert.ok(reclaimed.queries.length>0);assert.ok(reclaimed.state.proposedQueries.length<=2048);
});

test('observed completed search days freeze baseline65 and exclude62-query high day',()=>{
 const entries=[['2026-10-28',95,64],['2026-10-29',45,64],['2026-11-01',198,62],['2026-11-02',126,64],['2026-11-03',85,64],['2026-11-04',40,64],['2026-11-05',33,64],['2026-11-06',28,64]].map(([day,added,completedQueries])=>({day,added,completedQueries,metric}));
 const r=evaluate({history:entries,currentDay:'2026-11-06'});assert.equal(r.diagnostics.baseline,65);assert.equal(r.state.recoveryBaseline,65);assert.equal(r.diagnostics.latestAdded,28);assert.equal(r.diagnostics.ignored.partialDays,1);assert.equal(r.diagnostics.triggered,true);
});

test('static fallback skips full used history, advances cursor and stops after one exhausted cycle',()=>{
 const used=[];let cursor=0;
 for(let i=0;i<432;i++){const next=nextStatic(cursor,[],used);assert.equal(next.exhausted,false);assert.ok(!used.includes(next.plan.query));used.push(next.plan.query);cursor=next.nextCursor;}
 assert.equal(cursor,432);
 const exhausted=nextStatic(cursor,[],used);assert.equal(exhausted.exhausted,true);assert.equal(exhausted.plan,null);assert.equal(exhausted.nextCursor,864);
 const skipped=nextStatic(0,[],used.slice(0,3).map(q=>'  '+q.replaceAll(' ','   ')+'  '));assert.equal(skipped.plan.cursor,3);assert.equal(skipped.nextCursor,4);
 const wrapped=nextStatic(430,[],[used[430],used[431],used[0]]);assert.equal(wrapped.plan.cursor,433);assert.equal(wrapped.nextCursor,434);
 const custom=nextStatic(0,['New Wellness'],['new wellness 공식몰']);assert.equal(custom.plan.cursor,1);
 assert.throws(()=>nextStatic(-1));assert.throws(()=>nextStatic(Number.MAX_SAFE_INTEGER));
});
test('recovery keeps expanded pending queries available instead of discarding them',()=>{
 const first=run([...base,day(4,10)]);assert.ok(first.pendingQueries.length);
 const recovered=run([...base,day(4,10),day(5,90)],first.state);
 assert.equal(recovered.diagnostics.reason,'recovered');assert.deepEqual(recovered.pendingQueries,first.pendingQueries);assert.deepEqual(recovered.queries,[]);
 const selected=consume({state:recovered.state});assert.deepEqual(selected.queries,first.pendingQueries.slice(0,2));
});

test('curated expansion and dynamic noun anchors stay within supported wellness product types',()=>{
 let history=[...base],state={},queries=[];
 for(let n=4;n<=10;n++){history.push(day(n,10));const r=run(history,state);queries.push(...r.queries);state=r.state;while(state.pendingQueries?.length)state=consume({state}).state;}
 const unsupported=/스포츠 양말|운동 물병|디퓨저|구강 세정기|생리대|찜질팩|필라테스 링|필라테스 소도구|운동 회복 용품|필로우|목욕 소금|족욕 용품|자외선 차단제/;
 assert.ok(queries.length>0);assert.ok(queries.every(q=>!unsupported.test(q.phrase)));
 for(const phrase of ['요가 블록','홈트 덤벨','수면 이불','수면 매트리스','목욕 배스 솔트','구강 관리 치약','구강 위생 칫솔','피부 세정 클렌저'])assert.ok(queries.some(q=>q.phrase===phrase),phrase);
 history.push(day(11,10));const rejected=['스포츠 양말','운동 물병','아로마 디퓨저','구강 세정기','생리대','온열 찜질팩','필라테스 링','바디 필로우','마사지 오일'].map(text=>({text,kind:'official_evidence',url:'https://brand.co.kr/',observedDay:'2026-11-11'}));
 const r=run(history,state,{evidence:rejected});assert.deepEqual(r.queries,[]);assert.equal(r.diagnostics.sourceStatus,'sources_exhausted');
});

test('fresh evidence refills exhausted low episode on same evaluated day without changing stage or budget',()=>{
 let history=[...base],state={},r;
 for(let n=4;n<=12;n++){history.push(day(n,10));r=run(history,state);state=r.state;while(state.pendingQueries?.length)state=consume({state}).state;}
 assert.equal(r.diagnostics.sourceStatus,'sources_exhausted');
 const frozen={stage:state.stage,baseline:state.recoveryBaseline,evaluatedDay:state.evaluatedDay};
 // The next day is incomplete because there are no remaining queries. New source
 // evidence must help even though the last complete day has not changed.
 history.push(day(13,0,12));
 const evidence=[{url:'https://new-brand.co.kr/product/new',kind:'official_evidence',text:'유기농 허니부쉬 블렌딩 허브차',observedDay:'2026-11-13'}];
 const resumed=run(history,state,{evidence});assert.ok(resumed.queries.length>0);assert.equal(resumed.diagnostics.reason,'new_evidence_in_active_episode');assert.equal(resumed.diagnostics.triggered,false);assert.equal(resumed.state.stage,frozen.stage);assert.equal(resumed.state.recoveryBaseline,frozen.baseline);assert.equal(resumed.state.evaluatedDay,frozen.evaluatedDay);assert.ok(resumed.queries.every(q=>q.provenance.kind==='official_evidence'));
 const again=run(history,resumed.state,{evidence});assert.deepEqual(again.queries,[]);assert.equal(again.state.stage,frozen.stage);assert.deepEqual(again.pendingQueries,resumed.pendingQueries);
 assert.equal(consume({state:again.state}).queries.length,2,'uses only existing lease slots');
 const recoveredState={...state,recoveryBaseline:undefined};assert.deepEqual(run(history,recoveredState,{evidence}).queries,[],'no untriggered expansion after recovery');
});

test('newly unlocked categories receive slots before plentiful food evidence without dropping pending queries',()=>{
 const evidence=n=>Array.from({length:100},(_,i)=>({text:`신규원료${n}종${i} 블렌딩 허브차`,kind:'official_evidence',url:'https://brand.co.kr/',observedDay:`2026-11-${String(n).padStart(2,'0')}`}));
 let history=[...base,day(4,10)],r=run(history,{}, {evidence:evidence(4)}),state=r.state;
 while(state.pendingQueries.length)state=consume({state}).state;
 history.push(day(5,10));r=run(history,state,{evidence:evidence(5)});assert.equal(r.state.stage,2);assert.ok(r.queries.some(q=>q.phrase==='요가 매트'));assert.ok(r.queries.some(q=>q.provenance.kind==='official_evidence'));state=r.state;
 // Retain the last two old proposals so stage3 must append rather than replace.
 while(state.pendingQueries.length>2)state=consume({state}).state;const retained=state.pendingQueries.map(q=>q.query);
 history.push(day(6,10));r=run(history,state,{evidence:evidence(6)});assert.equal(r.state.stage,3);assert.deepEqual(r.pendingQueries.slice(0,2).map(q=>q.query),retained);assert.ok(r.queries.some(q=>q.phrase==='수면 안대'));state=r.state;
 for(const n of [7,8]){while(state.pendingQueries.length)state=consume({state}).state;history.push(day(n,10));r=run(history,state,{evidence:evidence(n)});state=r.state;assert.ok(r.queries.some(q=>q.provenance.kind==='official_evidence'));}
 assert.equal(r.state.stage,5);assert.equal(r.queries[0].provenance.kind,'official_evidence');
});
