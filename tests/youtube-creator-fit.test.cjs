const {test}=require('node:test');const assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/youtube-discovery/discovery.mjs');
const cid='UC'+'a'.repeat(22),playlist='UU'+'a'.repeat(22),vid='b'.repeat(11),latest='c'.repeat(11);
test('commercial intent uses creator field before product and preserves spicy secondary signal',async()=>{
 const {searchPlan}=await mod();
 for(const brief of ['편의점에 호빵을 크리에이터랑 같이 납품하고싶다','편의점 호빵 출시 크리에이터']){
  const p=searchPlan({brief});assert.deepEqual(p.queries,['먹방 -게임 -gaming','먹방 리뷰 -게임 -gaming']);assert.equal(p.criteria.discoveryIntent.primaryCategory,'먹방');assert.deepEqual(p.criteria.discoveryIntent.productTerms,['호빵']);
 }
 assert.deepEqual(searchPlan({brief:'매운 호빵 출시 크리에이터'}).queries,['먹방 -게임 -gaming','매운 음식 먹방 -게임 -gaming']);
 const spicy=searchPlan({brief:'마라호빵 출시 크리에이터'});assert.deepEqual(spicy.queries,['먹방 -게임 -gaming','매운 음식 먹방 -게임 -gaming']);assert.deepEqual(spicy.criteria.discoveryIntent.modifiers,['매운맛']);
 assert.deepEqual(searchPlan({brief:'비건 호빵 출시 크리에이터'}).queries,['비건 먹방 -게임 -gaming','비건 먹방 리뷰 -게임 -gaming']);
 assert.deepEqual(searchPlan({brief:'호빵 요리 크리에이터'}).queries,['요리 -게임 -gaming','요리 리뷰 -게임 -gaming']);
 assert.deepEqual(searchPlan({brief:'호빵 출시 크리에이터',queries:['직접 지정']}).queries,['직접 지정']);
 assert.deepEqual(searchPlan({brief:'호빵'}).queries,['호빵']);
});
test('official raw counts and latest uploads are distinct from old search hits',async()=>{
 const {discover}=await mod();const calls=[];
 const result=await discover({brief:'호빵 크리에이터'},{apiKey:'test',fetchImpl:async u=>{
 const name=u.pathname.split('/').pop();calls.push(name);
 if(name==='search')return Response.json({items:[{id:{videoId:vid},snippet:{channelId:cid,title:'옛날 호빵',publishedAt:'2020-01-01'}}]});
 if(name==='channels'){assert.equal(u.searchParams.get('part'),'snippet,statistics,contentDetails');return Response.json({items:[{id:cid,snippet:{title:'먹방'},statistics:{subscriberCount:'30000',hiddenSubscriberCount:false},contentDetails:{relatedPlaylists:{uploads:playlist}}}]});}
 if(name==='playlistItems'){assert.equal(u.searchParams.get('maxResults'),'5');return Response.json({items:[{contentDetails:{videoId:latest}}]});}
 if(name==='videos')return Response.json({items:[{id:latest,snippet:{channelId:cid,title:'최신 먹방',publishedAt:'2026-11-01'},statistics:{viewCount:'12345'},contentDetails:{duration:'PT10M'}}]});
 assert.fail(name);
 }});
 assert.equal(result.channels[0].subscriberCount,30000);assert.equal(result.channels[0].videos[0].videoId,vid);assert.equal(result.channels[0].recentVideos[0].videoId,latest);assert.equal(result.channels[0].recentVideos[0].viewCount,12345);assert.deepEqual(result.quota,{searchCalls:2,readCalls:3});assert.equal(calls.length,5);assert.ok(!JSON.stringify(result).includes('averageViews'));
});
test('missing and malformed counts are null, never invented zeros',async()=>{
 const {publicCount}=await mod();for(const v of [undefined,null,'','-1','NaN','1e4','9007199254740993'])assert.equal(publicCount(v),null);assert.equal(publicCount('0'),0);assert.equal(publicCount('30000'),30000);
});
test('thresholds reversible, hidden counts separate, and recent window explicit',async()=>{
 const {reviewReasons,orderCandidates}=await import('../supabase/functions/youtube-discovery/review-filters.mjs');const now=Date.parse('2026-11-07');
 assert.deepEqual(reviewReasons({subscriberCount:1000}),[]);
 assert.match(reviewReasons({subscriberCount:null},{minimumSubscribers:30000})[0],/미확인/);
 assert.deepEqual(reviewReasons({subscriberCount:30000},{minimumSubscribers:30000}),[]);
 assert.equal(reviewReasons({subscriberCount:29999},{minimumSubscribers:30000}).length,1);
 const c={recentVideos:[{viewCount:999999,publishedAt:'2020-01-01'},{viewCount:1000,publishedAt:'2026-11-01'}]};assert.equal(reviewReasons(c,{minimumViews:30000,now}).length,1);
 c.recentVideos.push({viewCount:30000,publishedAt:'2026-11-02'});assert.deepEqual(reviewReasons(c,{minimumViews:30000,now}),[]);
 const rows=[{channel:{subscriberCount:null}},{channel:{subscriberCount:30000}},{channel:{subscriberCount:1000}}];assert.deepEqual(orderCandidates(rows),rows);assert.equal(orderCandidates(rows,'subscribers')[0],rows[1]);assert.equal(rows[0].channel.subscriberCount,null);
});
test('hidden subscribers do not expose a supplied count; failed recent request is not fake empty success',async()=>{
 const {discover}=await mod();const fetchImpl=async u=>Response.json({items:u.pathname.endsWith('/search')?[{id:{videoId:vid},snippet:{channelId:cid}}]:[{id:cid,statistics:{subscriberCount:'10000',hiddenSubscriberCount:true}}]});
 const r=await discover({brief:'먹방'},{apiKey:'test',fetchImpl});assert.equal(r.channels[0].subscriberCount,null);assert.equal(r.channels[0].recentStatus,'unavailable');
});
test('recent quota failure fails explicitly without pretending complete recent metrics',async()=>{
 const {discover}=await mod();let calls=0;
 await assert.rejects(discover({brief:'먹방'},{apiKey:'test',fetchImpl:async u=>{calls++;
  if(u.pathname.endsWith('/search'))return Response.json({items:[{id:{videoId:vid},snippet:{channelId:cid}}]});
  if(u.pathname.endsWith('/channels'))return Response.json({items:[{id:cid,contentDetails:{relatedPlaylists:{uploads:playlist}}}]});
  return Response.json({error:{errors:[{reason:'quotaExceeded'}]}},{status:403});
 }}),e=>e.code==='YOUTUBE_QUOTA');assert.equal(calls,3);
});

test('explicit exclusions and other creator fields take precedence over inferred food direction',async()=>{
 const {searchPlan}=await mod();
 for(const [brief,excluded] of [['호빵 출시 크리에이터 먹방 제외','먹방'],['호빵 출시 크리에이터 음식 제외','음식']]){
  const p=searchPlan({brief});assert.ok(p.criteria.excludedTerms.includes(excluded));assert.ok(p.queries.every(q=>!q.includes(excluded)));assert.equal(p.criteria.discoveryIntent,null);
 }
 for(const field of ['캠핑','여행','커피','제로웨이스트','친환경','게임','패션','스포츠','운동','육아']){const p=searchPlan({brief:`호빵 ${field} 크리에이터`});assert.ok(p.queries.some(q=>q.includes(field)));assert.equal(p.criteria.discoveryIntent,null);}
});

test('all automatic fallback expansions honor exclusions too',async()=>{
 const {searchPlan}=await mod();
 const p=searchPlan({brief:'급식 IP 먹방 크리에이터 음식 제외'});assert.deepEqual(p.queries,['급식 먹방']);assert.ok(p.queries.every(q=>!q.includes('음식')));
 const en=searchPlan({brief:'급식 IP 먹방 크리에이터 food 제외'});assert.ok(en.queries.every(q=>!q.includes('음식')));
});
test('twenty fixture candidates use bounded fifty-ID statistic batches',async()=>{
 const {discover}=await mod();let searches=0,reads=0;const known=[];
 const r=await discover({brief:'호빵 출시 크리에이터'},{apiKey:'test',fetchImpl:async u=>{
 const resource=u.pathname.split('/').pop();
 if(resource==='search'){const start=searches++*10;const items=Array.from({length:12},(_,i)=>{const id='UC'+String(start+i).padStart(22,'0');if(i<10)known.push(id);return {id:{videoId:String(start+i).padStart(11,'0')},snippet:{channelId:id}};});return Response.json({items});}
 reads++;
 if(resource==='channels')return Response.json({items:known.map(id=>({id,contentDetails:{relatedPlaylists:{uploads:'UU'+id.slice(2)}}}))});
 if(resource==='playlistItems'){const n=Number(u.searchParams.get('playlistId').slice(2));return Response.json({items:Array.from({length:7},(_,i)=>({contentDetails:{videoId:String(n*10+i).padStart(11,'0')}}))});}
 if(resource==='videos'){assert.ok(u.searchParams.get('id').split(',').length<=50);return Response.json({items:[]});}
 assert.fail(resource);
 }});assert.equal(r.channels.length,20);assert.equal(searches,2);assert.equal(reads,23);assert.deepEqual(r.quota,{searchCalls:2,readCalls:23});
});

test('recent source index retains every upload and does not infer channel type',async()=>{
 const {buildBriefReview,recentFieldEvidence}=await import('../supabase/functions/youtube-discovery/relevance.mjs');
 const plan=buildBriefReview('편의점에 호빵을 크리에이터랑 같이 납품하고싶다');
 assert.deepEqual(plan.topicTerms.map(x=>x.label),['편의점','호빵']);assert.deepEqual(plan.reviewFields.map(x=>x.label),['먹방']);
 const c={title:'먹방 전문',description:'먹방이 아닌 채널',url:'https://youtube.com/channel/test',videos:[{title:'검색에 걸린 먹방'}],recentVideos:[{videoId:'a',title:'오늘은 먹방이 아닙니다',url:'https://youtube.com/watch?v=a',publishedAt:'2026-11-06'},{videoId:'b',title:'게임 이야기',url:'https://youtube.com/watch?v=b',publishedAt:'2026-11-05'},{videoId:'c',title:'MUKBANG',url:'https://youtube.com/watch?v=c',publishedAt:'2026-11-04'}]};
 const e=recentFieldEvidence(c,plan);assert.equal(e.uploads.length,3);assert.equal(e.uploads[0].matches[0].field,'먹방');assert.ok(e.uploads[0].matches[0].contextWarning);assert.deepEqual(e.uploads[1].matches,[]);assert.equal(e.uploads[2].matches[0].matchedTerms[0],'MUKBANG');assert.ok(e.description.matches[0].contextWarning);assert.ok(!JSON.stringify(e).includes('score'));assert.equal(e.uploads[1].publishedAt,'2026-11-05');
 assert.deepEqual(recentFieldEvidence({...c,recentVideos:[]},plan).uploads,[]);
 assert.deepEqual(recentFieldEvidence({...c,recentVideos:[{title:'notmukbangish'}]},plan).uploads[0].matches,[]);
});
test('source-text focus protects explicit manual directions, exclusions and cooking',async()=>{
 const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');
 assert.deepEqual(buildBriefReview('편의점 호빵 요리 크리에이터').queries,['요리 -게임 -gaming','요리 리뷰 -게임 -gaming']);
 assert.deepEqual(buildBriefReview('호빵 크리에이터',['캠핑 요리']).reviewFields.map(t=>t.label),['요리','캠핑']);
 assert.deepEqual(buildBriefReview('호빵 크리에이터',['운동']).reviewFields,[]);
 assert.deepEqual(buildBriefReview('호빵 크리에이터 먹방 제외').reviewFields,[]);
 assert.deepEqual(buildBriefReview('호빵 캠핑 크리에이터').reviewFields.map(t=>t.label),['캠핑']);
});

test('negative manual query terms never become positive review expressions',async()=>{const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');for(const q of ['캠핑 -먹방','camping -mukbang','캠핑 -먹방뉴스','캠핑 -"먹방"']){const p=buildBriefReview('호빵 크리에이터',[q]);assert.deepEqual(p.queries,[q]);assert.deepEqual(p.reviewFields.map(t=>t.label),['캠핑']);}});

test('preview then submit and direct submit select identical source-text expressions',async()=>{const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');for(const brief of ['비건 호빵 출시 크리에이터','편의점 호빵 크리에이터','마라호빵 출시 크리에이터','호빵 요리 크리에이터']){const p=buildBriefReview(brief);assert.deepEqual(buildBriefReview(brief,p.queries).reviewFields,p.reviewFields);}});


test('food distribution and taste intent search expressions, never infer trust or visible faces',async()=>{
 const {buildBriefReview,annotateCandidate}=await import('../supabase/functions/youtube-discovery/relevance.mjs');
 for(const brief of ['음식을 유통할 먹방 크리에이터','음식에 대한 취향에 대한 신뢰를 가진 크리에이터']){const p=buildBriefReview(brief);assert.deepEqual(p.queries,['먹방 -게임 -gaming','먹방 리뷰 -게임 -gaming']);assert.deepEqual(p.discoveryIntent.productTerms,[]);}
 const p=buildBriefReview('음식 취향을 보여주는 쫀득 먹방 크리에이터');assert.deepEqual(p.queries,['먹방 -게임 -gaming','쫀득 먹방 -게임 -gaming']);assert.deepEqual(p.discoveryIntent.modifiers,['쫀득']);assert.ok(p.topicTerms.every(t=>!['보여주','취향','신뢰'].includes(t.label)));
 assert.deepEqual(buildBriefReview('음식을 유통할 쫀득 요리 크리에이터').queries,['요리 -게임 -gaming','쫀득 요리 -게임 -gaming']);
 for(const field of ['운동','게임','캠핑'])assert.equal(buildBriefReview(`음식을 유통할 ${field} 크리에이터`).discoveryIntent,null);
 const excluded=buildBriefReview('음식을 유통할 쫀득 크리에이터 먹방 제외');assert.ok(excluded.queries.every(q=>!q.includes('먹방')));assert.equal(excluded.discoveryIntent,null);
 const c=annotateCandidate({title:'저는 사람입니다',description:'믿을 수 있는 맛집 먹방',videos:[],recentVideos:[]},p);assert.ok(!('faceVisible' in c));assert.ok(!('trustworthy' in c));assert.ok(!('reviewState' in c));assert.match(p.unresolvedRequirements.join(' '),/직접 확인/);
});

test('texture and spicy modifiers coexist in the secondary query',async()=>{const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');const p=buildBriefReview('매운 쫀득 호빵 출시 크리에이터');assert.deepEqual(p.queries,['먹방 -게임 -gaming','쫀득 매운 음식 먹방 -게임 -gaming']);assert.deepEqual(p.discoveryIntent.modifiers,['쫀득','매운맛']);});

test('person and credibility review requirements do not become API keywords',async()=>{const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');for(const brief of ['음식 취향에 신뢰가 있는 크리에이터','음식을 유통할 얼굴 나오는 크리에이터','음식을 유통할 사람이 주인공인 크리에이터']){const p=buildBriefReview(brief);assert.deepEqual(p.queries,['먹방 -게임 -gaming','먹방 리뷰 -게임 -gaming']);assert.deepEqual(p.topicTerms.map(t=>t.label),['음식']);}});


test('food defaults visibly exclude gaming words without overwriting explicit gaming or manual queries',async()=>{
 const {buildBriefReview}=await import('../supabase/functions/youtube-discovery/relevance.mjs');
 const p=buildBriefReview('음식을 유통할 쫀득 크리에이터');assert.ok(p.queries.every(q=>q.endsWith(' -게임 -gaming')));assert.ok(p.reviewFields.every(f=>f.id!=='gaming'));assert.match(p.notes.join(' '),/게임 채널 전체를 식별하지는/);
 const manual=['먹방','쫀득 먹방'];assert.deepEqual(buildBriefReview('음식을 유통할 쫀득 크리에이터',manual).queries,manual);
 const game=buildBriefReview('음식 게임 크리에이터');assert.equal(game.discoveryIntent,null);assert.ok(game.queries.some(q=>q.includes('게임')));assert.ok(game.queries.every(q=>!q.includes('-게임')));
 const excluded=buildBriefReview('음식 쫀득 크리에이터 게임 제외');assert.ok(excluded.excludedTerms.includes('게임'));assert.ok(excluded.queries.length);assert.ok(excluded.reviewFields.every(f=>f.id!=='gaming'));
});
