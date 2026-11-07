const {test}=require('node:test');const assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/youtube-discovery/discovery.mjs');
const cid='UC'+'a'.repeat(22),playlist='UU'+'a'.repeat(22),vid='b'.repeat(11),latest='c'.repeat(11);
test('commercial intent uses creator field before product and preserves spicy secondary signal',async()=>{
 const {searchPlan}=await mod();
 for(const brief of ['편의점에 호빵을 크리에이터랑 같이 납품하고싶다','편의점 호빵 출시 크리에이터']){
  const p=searchPlan({brief});assert.deepEqual(p.queries,['먹방','편의점 음식 리뷰']);assert.equal(p.criteria.discoveryIntent.primaryCategory,'먹방');assert.deepEqual(p.criteria.discoveryIntent.productTerms,['호빵']);
 }
 assert.deepEqual(searchPlan({brief:'매운 호빵 출시 크리에이터'}).queries,['먹방','매운 음식 먹방']);
 const spicy=searchPlan({brief:'마라호빵 출시 크리에이터'});assert.deepEqual(spicy.queries,['먹방','매운 음식 먹방']);assert.deepEqual(spicy.criteria.discoveryIntent.modifiers,['매운맛']);
 assert.deepEqual(searchPlan({brief:'비건 호빵 출시 크리에이터'}).queries,['비건 먹방','비건 음식 리뷰']);
 assert.deepEqual(searchPlan({brief:'호빵 요리 크리에이터'}).queries,['요리','음식 리뷰']);
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
test('two searches cap candidates at twenty and raw statistics at two fifty-ID reads',async()=>{
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
