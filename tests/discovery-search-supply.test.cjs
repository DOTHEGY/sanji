const {test}=require('node:test');
const assert=require('node:assert/strict');
const esbuild=require('esbuild');
function load(file){const m={exports:{}};const b=esbuild.buildSync({entryPoints:['supabase/functions/_shared/'+file+'.ts'],bundle:true,platform:'node',format:'cjs',write:false});new Function('module','exports','require',b.outputFiles[0].text)(m,m.exports,require);return m.exports;}
const search=load('discovery-search'),source=load('discovery-sources');
function accounted(a){assert.equal(a.input,a.accepted+Object.values(a.rejected).reduce((a,b)=>a+b,0));}
test('search plan exhausts all 432 food topic/variant pairs and does not restart at day boundaries',()=>{
 const length=(search.searchTopics.length+search.searchSubtopics.length)*search.searchVariants.length;
 assert.equal(length,432);
 const queries=Array.from({length},(_,i)=>search.searchQuery(i));
 assert.equal(new Set(queries).size,length);
 assert.equal(search.searchQuery(length),queries[0]);
 assert.equal(search.searchPlan(length).cycle,1);
 const saved=Date.now;
 try{Date.now=()=>Date.parse('2026-11-04T14:59:59Z');const before=search.searchQuery(64);Date.now=()=>Date.parse('2026-11-04T15:00:01Z');assert.equal(search.searchQuery(64),before);}finally{Date.now=saved;}
 assert.notEqual(search.searchQuery(64),search.searchQuery(0));
 assert.equal(search.searchQuery(0,['  추가 식품  ','추가 식품','']), '추가 식품 공식몰');
 assert.equal(search.searchPlan(1,['  추가 식품  ','추가 식품','']).topic,search.searchTopics[0]);
 for(const cursor of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>search.searchQuery(cursor));
});
test('search audit accounts for every candidate link without treating snippets as verified contacts',()=>{
 const a={};const rows=search.searchResults([
 '<a href="https://brand.co.kr/shop">브랜드 공식몰</a>',
 '<a href="https://www.brand.co.kr/about">같은 브랜드</a>',
 '<a href="https://news.naver.com/">건강 뉴스</a>',
 '<a href="http://127.0.0.1/">비공개 업체</a>',
 '<a href="https://other.co.kr/">블로그 리뷰</a>',
 '<a href="https://empty.co.kr/">새 창 열림</a>',
 '<a href="https://nameless.co.kr/">공식몰</a>',
 'contact@brand.co.kr'
 ].join(''),'https://www.google.com/search?q=food','food',a);
 assert.equal(rows.length,1);assert.equal(rows[0].website,'https://brand.co.kr/');assert.equal(rows[0].contacts,undefined);
 assert.deepEqual(a,{input:7,accepted:1,rejected:{duplicate_host:1,excluded_destination:1,invalid_destination:1,non_company_title:1,empty_title:1,empty_name:1}});accounted(a);
 assert.throws(()=>search.searchResults('<title>captcha</title>','https://www.google.com/','food',{}),/우회하지 않음/);
});
test('search cap remains 15 and reports rather than silently drops overflow',()=>{
 const a={};const rows=search.searchResults(Array.from({length:20},(_,i)=>`<a href="https://brand${i}.co.kr/">브랜드${i} 공식몰</a>`).join(''),'https://search.naver.com/','food',a);
 assert.equal(rows.length,15);assert.equal(a.rejected.result_cap,5);accounted(a);
});
test('source audit retains full-history name/host dedup and candidate provenance',()=>{
 const a={};const known=[{identity:'기존브랜드',data:{website:'https://old.co.kr/'}},{identity:'별개회사',data:{website:'https://used.co.kr/'}}];
 const rows=source.sourceProspects([
 {name:'기존브랜드',website:'https://different.co.kr/'},
 {name:'새 이름',website:'https://www.used.co.kr/'},
 {name:'식품브랜드',website:'https://food.co.kr/',searchQuery:'유산균 공식몰',source:'https://search.naver.com/',searchResultUrl:'https://food.co.kr/about',searchEngine:'Naver',searchCursor:64,searchPlanVersion:search.searchPlanVersion},
 {name:'식품브랜드',website:'https://other-food.co.kr/'},
 {name:'다른 표기',website:'https://www.food.co.kr/'},
 {name:'플랫폼',website:'https://coupang.com/'},
 {name:'레스토랑',website:'https://restaurant.co.kr/',industry:'restaurant'},
 {name:'Q123',website:'https://unknown.co.kr/'},
 {name:'비공개',website:'https://127.0.0.1/'}
 ],known,'2026-11-05',a);
 assert.equal(rows.length,1);assert.deepEqual(a,{input:9,accepted:1,rejected:{duplicate_identity:2,duplicate_host:2,excluded_destination:1,excluded_industry:1,invalid_name:1,invalid_destination:1}});accounted(a);
 const data=rows[0].data;assert.equal(data.searchCursor,64);assert.equal(data.searchEngine,'Naver');assert.equal(data.searchPlanVersion,'food-topics-v2');assert.equal(data.searchResultUrl,'https://food.co.kr/about');assert.equal(data.officialVerified,false);assert.deepEqual(data.contacts,[]);
});
test('SQL search lease resumes across Korean days and preserves owner, cooldown, pending and 64-query caps',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table public.sanji_discovery_config(owner uuid primary key,enabled boolean,target integer,search_state jsonb default '{}');
   create table public.sanji_discovery_leads(owner uuid,status text);
   create table public.test_qualified(owner uuid,day date,n integer);
   create function public.sanji_discovery_qualified_count(p_owner uuid,p_day date) returns integer language sql as $$select coalesce((select n from public.test_qualified where owner=p_owner and day=p_day),0)$$;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261105010012_discovery_search_supply.sql','utf8'));
  await db.query('insert into sanji_discovery_config(owner,enabled,target) values($1,true,70),($2,false,70)',[owner,other]);
  const claim=async(id=owner)=>(await db.query('select public.sanji_claim_qualified_search_sources($1) s',[id])).rows[0].s;
  const reset=async s=>db.query('update sanji_discovery_config set search_state=$1 where owner=$2',[JSON.stringify(s),owner]);
  const expire=async()=>db.query("update sanji_discovery_config set search_state=search_state||jsonb_build_object('leaseUntil',null,'checked',now()-interval '16 minutes') where owner=$1",[owner]);
  assert.equal(await claim(other),null);
  assert.equal(await claim('33333333-3333-4333-8333-333333333333'),null);
  const first=await claim();assert.equal(first.cursor,0);assert.equal(first.nextCursor,2);assert.equal(first.queries,2);assert.equal(await claim(),null);
  await expire();const second=await claim();assert.equal(second.cursor,2);assert.equal(second.nextCursor,4);assert.equal(second.queries,4);
  await reset({...second,day:'2000-01-01',leaseUntil:null,checked:'2000-01-01'});
  const nextDay=await claim();assert.equal(nextDay.cursor,4);assert.equal(nextDay.queries,2);
  // Legacy states do not have nextCursor. Preserve their last claimed position.
  await reset({cursor:62,queries:64,day:'2000-01-01',checked:'2000-01-01'});
  const migrated=await claim();assert.equal(migrated.cursor,64);assert.equal(migrated.nextCursor,66);assert.equal(migrated.queries,2);
  await reset({...migrated,day:'2000-01-01'});assert.equal(await claim(),null,'midnight cannot bypass an active lease');
  await reset({...migrated,day:'2000-01-01',leaseUntil:null});assert.equal(await claim(),null,'midnight cannot bypass cooldown');
  await reset({...migrated,queries:62,leaseUntil:null,checked:'2000-01-01'});assert.equal((await claim()).queries,64);await expire();assert.equal(await claim(),null);
  await reset({...migrated,queries:63,leaseUntil:null,checked:'2000-01-01'});assert.equal(await claim(),null);
  await reset({});await db.query("insert into sanji_discovery_leads select $1,'new' from generate_series(1,8)",[owner]);assert.equal(await claim(),null);
  await db.query('delete from sanji_discovery_leads where owner=$1',[owner]);
  await db.query("insert into sanji_discovery_leads select $1,'new' from generate_series(1,8)",[other]);assert.notEqual(await claim(),null,'another owner pending queue must not block');
  await expire();await db.query("insert into test_qualified values($1,(now() at time zone 'Asia/Seoul')::date,70)",[owner]);assert.equal(await claim(),null,'qualified target stops supply');
  await db.query('update test_qualified set n=69 where owner=$1',[owner]);assert.notEqual(await claim(),null);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>claim(),/permission denied/);await db.exec('reset role');}
  await expire();await db.exec('set role service_role');assert.notEqual(await claim(),null);await db.exec('reset role');
 }finally{await db.close();}
});
