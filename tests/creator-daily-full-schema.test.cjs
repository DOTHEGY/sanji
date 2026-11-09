const recipientCriteria=require('./helpers/creator-daily-recipient-criteria.cjs');
// All final pending schemas including criteria upgrade and execution paging, not dispatcher contact/supply stubs.
// Native legacy tables below are local-only fixtures. No Vault/net invocation or provider calls.
const zlib=require('node:zlib');
function png(color){function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}const b=Buffer.alloc(4);b.writeUInt32BE((n^0xffffffff)>>>0);return b;}function chunk(type,bytes){const t=Buffer.from(type),n=Buffer.alloc(4);n.writeUInt32BE(bytes.length);return Buffer.concat([n,t,bytes,crc(Buffer.concat([t,bytes]))]);}const h=Buffer.alloc(13);h.writeUInt32BE(40);h.writeUInt32BE(40,4);h[8]=8;h[9]=2;const rows=Buffer.concat(Array.from({length:40},()=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:120},(_,i)=>color[i%3]))])));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const sid='33333333-3333-4333-8333-333333333333',pid='44444444-4444-4444-8444-444444444444',pid2='55555555-5555-4555-8555-555555555555',cid='66666666-6666-4666-8666-666666666666';
const key='youtube:UC0000000000000000000001',recipient='first.last+campaign@gmail.com';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const settings={signatureSource:'gmail',gmailSignatureEmail:'owner@gmail.com',gmailSignatureHtml:'<b>서명</b>',emailSignature:'서명',senderName:'대표'};
const product={name:'마라쫀득빵',state:'확정',productUrl:'https://example.com/product'};
const policy={classification:'reviewed_non_marketing_business_proposal',classificationSource:'explicit individual content review',authorizationSource:'user explicit authorization',schedule:{timezone:'Asia/Seoul',hour:9,minute:0,confirmed:true}};
async function query(db,sql,args=[]){return (await db.query(sql,args)).rows;}
async function rpc(db,name,...args){return (await query(db,`select sanji_daily_campaign_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}
async function setup(){const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create table sanji_members(user_id uuid);insert into sanji_members values('${owner}'),('${other}');
 create table sanji_records(id uuid primary key default gen_random_uuid(),owner uuid,kind text,version int default 1,data jsonb,updated timestamptz default now());
 create unique index sanji_campaign_fixture_company_unique on sanji_records(owner,lower(data->>'companyKey')) where kind='candidate' and coalesce(data->>'companyKey','')<>'';create unique index sanji_campaign_fixture_email_unique on sanji_records(owner,lower(data#>>'{contact,email}')) where kind='candidate' and coalesce(data#>>'{contact,email}','')<>'';create unique index sanji_campaign_fixture_handle_unique on sanji_records(owner,lower(data->>'handle')) where kind='candidate' and coalesce(data->>'handle','')<>'';create unique index sanji_campaign_fixture_settings_unique on sanji_records(owner) where kind='settings';
 create table sanji_creator_recovery(id uuid primary key,owner uuid,handle text,nickname text,profile_url text,status text default 'new',entity_type text default 'creator_evidence',link_status text default 'source_confirmed',assessment text default 'candidate',followers bigint,followers_source text,followers_checked timestamptz,updated timestamptz default now(),unique(id,owner));
 create table sanji_creator_evidence(owner uuid,creator_id uuid,source_kind text,source_provider text not null default 'unknown',source_url text default '',source_ref text default '',observation_key text default '',detail jsonb,seen_at timestamptz default now(),primary key(owner,creator_id,source_kind,source_url,source_ref,observation_key));
 create table sanji_creator_contact_review(owner uuid,creator_id uuid,data jsonb);create table sanji_creator_inbound_messages(owner uuid,creator_id uuid,data jsonb);create table sanji_creator_manual_notes(owner uuid,creator_id uuid,handle text,payload jsonb);create table sanji_ig_manual_conversations(owner uuid,creator_id uuid,username text);create table sanji_creator_email_isolated_queue(owner uuid,creator_id uuid,snapshot jsonb);create table sanji_instagram_inbound(owner uuid,body text);create table sanji_instagram_reply_attempts(owner uuid,body text);
 create table sanji_connections(owner uuid,provider text,summary jsonb);create table sanji_suppression(owner uuid,identity text);create table sanji_audit(owner uuid,action text,data jsonb);
 create table sanji_outbox(id uuid primary key default gen_random_uuid(),owner uuid,target uuid not null,channel text,fingerprint text unique,status text,data jsonb,created timestamptz default now());
 create table sanji_drafts(id uuid primary key default gen_random_uuid(),owner uuid,data jsonb,hash text,expires timestamptz,used boolean default false);create table sanji_jobs(id uuid default gen_random_uuid(),owner uuid,draft_id uuid);
 create function sanji_blocked(uuid,jsonb) returns boolean language sql as 'select false';
 grant select,insert,update on all tables in schema public to service_role;
 `);for(const name of ['creator-daily-outreach','creator-daily-supply','creator-daily-instagram-review','creator-contact-enrichment','creator-daily-campaign','creator-daily-retention','creator-daily-supply-kick','creator-daily-recipient-criteria-upgrade','creator-daily-execution-reads']) await db.exec(fs.readFileSync('supabase/pending/'+name+'.sql','utf8'));
 for(const [id,kind,data] of [[sid,'settings',settings],[pid,'deal',product],[pid2,'deal',{...product,name:'짬뽕쫀득빵'}]])await query(db,'insert into sanji_records(id,owner,kind,data) values($1,$2,$3,$4)',[id,owner,kind,data]);
 await query(db,"insert into sanji_connections values($1,'gmail',$2)",[owner,{email:'owner@gmail.com'}]);return db;}
function snapshot(){const s={version:2,recipientCriteria,owner,template:{owner,revision:1,approved:true,approvalSource:'exact user copy',subject:'[채널명]님',body:'안녕하세요 [채널명]님. 협업 제안입니다.',requiredInlineImageIds:['image1','image2']},signature:{verified:true,source:'existing_gmail_signature',senderEmail:'owner@gmail.com',senderName:'대표',html:settings.gmailSignatureHtml,text:settings.emailSignature,settingsId:sid,settingsVersion:1},images:['image1','image2'].map((id,i)=>{const bytes=png(i?[0,255,0]:[255,0,0]);return {id,owner,verified:true,sharingApproved:true,mimeType:'image/png',content:bytes.toString('base64'),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),width:40,height:40};}),products:[{id:pid,version:1,sha256:hash(product)},{id:pid2,version:1,sha256:hash({...product,name:'짬뽕쫀득빵'})}],scopeHash:'a'.repeat(64),contentHash:'b'.repeat(64)};s.scopeHash=hash({...s.version===2?{recipientCriteria:s.recipientCriteria}:{},templateRevision:s.template.revision,templateHash:hash(s.template),signatureHash:hash(s.signature),products:s.products,images:s.images.map(({id,sha256,bytes})=>({id,sha256,bytes}))});delete s.contentHash;s.contentHash=hash(s);return s;}
async function prepare(db,{platform='youtube',transform=async x=>x.candidate}={}){const at=new Date(Date.now()-1000).toISOString(),k=platform==='youtube'?key:'instagram:foodperson',profile=platform==='youtube'?'https://www.youtube.com/channel/'+key.split(':')[1]:'https://www.instagram.com/foodperson/';
 const contact={creatorKey:k,address:recipient,sourceUrl:'https://example.com/contact',sourceText:'협업 '+recipient,sourceKind:'official_website',checkedAt:at,verified:true,accessMethod:'public_source_review',purpose:'business_collaboration',affiliation:{verified:true,creatorKey:k,sourceUrl:'https://example.com/creators',sourceText:'공식 소속',checkedAt:at}};
 const evidence={audienceCheckedAt:at,lastActiveAt:at,activitySource:'https://example.com/video',activityCheckedAt:at,mukbang:{verified:true,sourceUrl:'https://example.com/mukbang',sourceText:'먹방',checkedAt:at},contactEvidence:[contact]};
 if(platform==='youtube')await query(db,"insert into sanji_records(id,owner,kind,data) values($1,$2,'candidate',$3)",[cid,owner,{name:'Creator',channels:'YouTube',profile,followers:30000,metricsSource:'https://example.com/count',status:'미접촉',youtubeResearch:{channelId:key.split(':')[1]},dailyOutreachEvidence:evidence}]);
 else {await query(db,'insert into sanji_creator_recovery(id,owner,handle,nickname,profile_url,followers,followers_source,followers_checked) values($1,$2,$3,$4,$5,$6,$7,$8)',[cid,owner,'foodperson','Creator',profile,30000,'https://example.com/count',at]);await query(db,"insert into sanji_creator_evidence(owner,creator_id,source_kind,detail) values($1,$2,'daily_outreach_review',$3)",[owner,cid,evidence]);}
 const {buildDailyOutreachBatch}=await import('../supabase/functions/creator-daily-outreach/domain.mjs');const candidate=await transform({db,k,evidence,at,candidate:{platform,externalId:k.split(':')[1],name:'Creator',profileUrl:profile,sourceRecordId:cid,existingDatabaseRecord:true,audience:30000,audienceSource:'https://example.com/count',audienceCheckedAt:at,...evidence}});const batch=buildDailyOutreachBatch({history:{complete:true,creatorKeys:[],emailKeys:[]},candidates:[candidate]});assert.equal(batch.selected.length,1);await query(db,'select sanji_daily_outreach_prepare($1,$2,$3)',[owner,batch.day,batch]);return {k,evidence};}
async function ready(db,options={}){const data=options.snapshot||snapshot(),p=await rpc(db,'configure',owner,0,{data},policy);await rpc(db,'schedule',owner,p.revision);const {k,evidence}=await prepare(db,options);const review={creatorKey:k,recipient,kind:'documented_business_proposal',classification:policy.classification,classificationSource:'human reviewed',sourceUrl:'https://example.com/review',sourceText:'Documented individual business proposal reviewed as nonmarketing.',verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),approvalSource:'explicit owner confirmation',status:'approved'};await rpc(db,'review_basis',owner,p.revision,review);await rpc(db,'sync',owner);const q=(await query(db,'select * from sanji_daily_campaign_claim($1)',[owner]))[0];assert.equal(q.status,'processing');const plan={recipientCriteria:data.recipientCriteria,...(data.productMode?{productMode:data.productMode}:{}),...(data.productMode==='approved_campaign_assets'?{campaignProducts:data.campaignProducts}:{}),snapshotId:p.snapshot_id,snapshotHash:p.snapshot_sha256,scopeHash:data.scopeHash,subject:'Creator님',body:'안녕하세요 Creator님. 협업 제안입니다.',signatureText:data.signature.text,signatureHtml:data.signature.html,senderEmail:data.signature.senderEmail,senderName:data.signature.senderName,settingsId:sid,settingsVersion:1,products:data.products,inlineImages:data.images.map(({id,sha256,bytes})=>({id,sha256,bytes})),messageId:'campaign-test-message',rawHash:'c'.repeat(64),gmailHistory:{address:recipient,emailKey:'firstlast@gmail.com',senderEmail:'owner@gmail.com',checkedAt:new Date().toISOString(),clear:true}};return {p,q,plan,k,evidence,review};}
const reserve=(db,x)=>rpc(db,'reserve',owner,x.k,x.q.lease_token,x.plan);
const begin=(db,x,r)=>rpc(db,'begin_send',owner,x.k,r.reservationToken,{...x.plan.gmailHistory,checkedAt:new Date().toISOString()},x.plan.rawHash);
const finalize=(db,x,r,status,receipt={})=>rpc(db,'finalize',owner,x.k,r.reservationToken,status,receipt);

test('all eight pending schemas install together, native dispatch lifecycle uses real private tables',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const x=await ready(db);
  await db.exec('begin');await query(db,'insert into sanji_creator_manual_notes(owner,payload) values($1,$2)',[owner,{nested:{channel_id:x.k.slice(8)}}]);
  await assert.rejects(()=>reserve(db,x),/history|suppression/);await db.exec('rollback');
  const r=await reserve(db,x);
  await assert.rejects(()=>rpc(db,'begin_send',other,x.k,r.reservationToken,x.plan.gmailHistory,x.plan.rawHash),/reservation/);
  assert.equal((await begin(db,x,r)).ready,true);
  assert.equal((await finalize(db,x,r,'accepted',{id:'local-mock-receipt',threadId:'local-mock-thread'})).status,'accepted');
  assert.equal((await query(db,"select count(*)::int n from sanji_records where kind='thread'"))[0].n,1);
  const tables=await query(db,"select tablename,rowsecurity,has_table_privilege('authenticated',tablename,'SELECT') allowed from pg_tables where schemaname='public' and (tablename like 'sanji_daily_%' or tablename like 'sanji_contact_%')");
  assert.equal(tables.length,15);assert.ok(tables.every(r=>r.rowsecurity&&!r.allowed));
  const functions=await query(db,"select proname,prosecdef,has_function_privilege('authenticated',oid,'EXECUTE') allowed from pg_proc where pronamespace='public'::regnamespace and (proname like 'sanji_daily_%' or proname like 'sanji_contact_%')");
  assert.ok(functions.every(r=>!r.prosecdef&&!r.allowed));
  assert.equal((await query(db,"select to_regclass('vault.decrypted_secrets') absent"))[0].absent,null);
 }finally{await db.close();}
});

function sealSnapshot(s){const scope={...s.version===2?{recipientCriteria:s.recipientCriteria}:{},templateRevision:s.template.revision,templateHash:hash(s.template),signatureHash:hash(s.signature),products:s.products,images:s.template.requiredInlineImageIds.map(id=>{const {sha256,bytes}=s.images.find(i=>i.id===id);return {id,sha256,bytes};})};if(s.productMode==='approved_campaign_assets')Object.assign(scope,{productMode:s.productMode,campaignProducts:s.campaignProducts});s.scopeHash=hash(scope);delete s.contentHash;s.contentHash=hash(s);return s;}
function assetSnapshot(){const s=snapshot();s.productMode='approved_campaign_assets';s.products=[];s.campaignProducts=['마라쫀득빵','짬뽕쫀득빵'].map((name,i)=>({name,approvalSource:'exact user approved copy and two supplied product images'}));return sealSnapshot(s);}

const CAMPAIGN='mara-jjamppong-bread';
const jsonRow=row=>JSON.parse(JSON.stringify(row));
const sbFor=db=>({rpc:async(name,args)=>{try{return {data:(await query(db,'select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args)))[0].r};}catch(error){return {error};}}});

async function registerReviewedSource(db,k,candidate,{instagram=false}={}){
 const at=new Date(Date.now()-1000).toISOString();
 const url=instagram?candidate.profileUrl:'https://example.com/contact';
 const kind=instagram?'instagram_public_bio':'official_website';
 const request=async(o=owner)=>(await query(db,'select sanji_contact_source_request($1,$2,$3,$4) r',[o,k,url,kind]))[0].r;
 await assert.rejects(()=>request(other),/saved creator/);
 const pending=await request();assert.equal(pending.state,'pending');
 const affiliation={verified:true,independentlyVerified:true,creatorKey:k,officialUrl:url,sourceUrl:'https://example.com/creators',sourceText:'Creator official channel '+k.split(':')[1],checkedAt:at,reviewedBy:owner,method:'manual_cross_reference'};
 const storedLink={creatorKey:k,url,sourceRecordId:candidate.sourceRecordId||k,sourceUrl:affiliation.sourceUrl,sourceText:affiliation.sourceText,reviewedBy:owner,checkedAt:at};
 const review={exactUrl:url,decision:instagram?'allow_existing_official_bio':'allow_public_get',reviewedBy:owner,reviewedAt:at,expiresAt:new Date(Date.now()+3600000).toISOString(),noLoginOrChallenge:true,noAccessRestriction:true,maxRequestsPerDay:1,termsUrl:'https://example.com/terms',termsExcerpt:'Public business source review',robotsUrl:'https://example.com/robots.txt',robotsExcerpt:'Allow /contact',accessRationale:'Specific public collaboration contact'};
 const displayNameEvidence={name:candidate.name,creatorKey:k,sourceUrl:'https://example.com/new-identity',sourceText:candidate.name+' official channel '+k.split(':')[1],checkedAt:new Date().toISOString(),kind:'official_website',verified:true,independentlyVerified:true,reviewedBy:owner};
 const approve=link=>query(db,"insert into sanji_contact_source_versions(owner,source_id,revision,creator_key,source_url,source_kind,state,stored_link,policy_review,affiliation,display_name_evidence) values($1,$2,2,$3,$4,$5,'reviewed',$6,$7,$8,$9)",[owner,pending.sourceId,k,url,kind,link,review,affiliation,displayNameEvidence]);
 await assert.rejects(()=>approve({...storedLink,sourceRecordId:other}),/owner-bound/);
 await approve(storedLink);
 return {...pending,revision:2,url,kind,at};
}

async function enrichCandidate(db,k,candidate,{instagram=false,bioCheckedAt}={}){
 const source=await registerReviewedSource(db,k,candidate,{instagram});
 if(instagram)await query(db,"insert into sanji_creator_evidence(owner,creator_id,source_kind,source_provider,source_url,source_ref,detail) values($1,$2,'public_bio','instagram_official',$3,'business_discovery',$4)",[owner,cid,source.url,{bio:'먹방 크리에이터\n협업\n'+recipient,bio_source_url:source.url,bio_content_available:true,bio_checked_at:bioCheckedAt||source.at}]);
 const {createContactEnrichmentRepository}=await import('../supabase/functions/creator-daily-outreach/contact-enrichment-repository.mjs');
 const {createContactEnrichment}=await import('../supabase/functions/creator-daily-outreach/contact-enrichment.mjs');
 let networkCalls=0;
 const service=createContactEnrichment({enabled:true,repository:createContactEnrichmentRepository(sbFor(db)),network:{read:async url=>{networkCalls++;return {url,text:'협업 '+recipient,contentType:'text/plain'};}}});
 const result=await service.enrich(owner,{candidates:[candidate]});
 assert.equal(result.counts.verified,1,JSON.stringify(result.reasons));
 assert.equal(networkCalls,instagram?0:1);
 assert.equal(result.observations[0].sourceVersions[0].revision,2);
 if(candidate.displayNameEvidence)assert.deepEqual(result.candidates[0].displayNameEvidence,candidate.displayNameEvidence,'newer same-name registry proof must not replace current supply identity');
 return result.candidates[0];
}

async function nativeEnrichment({db,k,candidate}){
 await query(db,"update sanji_records set data=jsonb_set(data,'{dailyOutreachEvidence,contactEvidence}','[]') where id=$1",[cid]);
 return enrichCandidate(db,k,{...candidate,contactEvidence:[]});
}

async function stagedEnrichment({db,k,candidate,at}){
 await query(db,'delete from sanji_records where id=$1',[cid]);
 const api={channelId:candidate.externalId,source:'youtube_data_api',title:'UNREVIEWED API NAME',url:candidate.profileUrl,subscriberCount:40000,lastActiveAt:at,lastActivityUrl:'https://www.youtube.com/watch?v=abcdefghijk',observedAt:at,expiresAt:new Date(Date.now()+86400000).toISOString()};
 await query(db,'insert into sanji_daily_supply_snapshots(owner,campaign,channel_id,snapshot,observed_at,expires_at) values($1,$2,$3,$4,$5,$6)',[owner,CAMPAIGN,api.channelId,api,at,api.expiresAt]);
 await assert.rejects(()=>query(db,"select sanji_contact_source_request($1,$2,'https://example.com/contact','official_website')",[owner,k]),/saved creator/);
 const {validateSupplyReview}=await import('../supabase/functions/creator-daily-outreach/supply-review.mjs');
 const review=validateSupplyReview(owner,{creatorKey:k,snapshotObservedAt:at,displayNameEvidence:{name:'Creator',creatorKey:k,profileUrl:api.url,verified:true,kind:'official_website',sourceUrl:'https://example.com/identity',sourceText:'Creator official channel '+api.channelId,checkedAt:at},mukbang:candidate.mukbang,contactEvidence:[]},api);
 await query(db,'select sanji_daily_supply_review($1,$2,$3)',[owner,CAMPAIGN,review]);
 const {mergeSupplyCandidates}=await import('../supabase/functions/creator-daily-outreach/supply.mjs');
 const [staged]=mergeSupplyCandidates([],[{snapshot:api}],Date.now(),[{review}]);
 assert.equal(staged.sourceRecordId,null);
 return enrichCandidate(db,k,staged);
}

async function instagramEnrichment({db,k,candidate,at}){
 const native=jsonRow((await query(db,'select * from sanji_creator_recovery where id=$1',[cid]))[0]);
 const {adaptInstagramRecord}=await import('../supabase/functions/creator-daily-outreach/repository.mjs');
 const {validateInstagramReview,applyInstagramReview}=await import('../supabase/functions/creator-daily-outreach/supply-instagram-review.mjs');
 const row=adaptInstagramRecord(native,[]);
 const review=validateInstagramReview(owner,{creatorKey:k,sourceRecordId:cid,sourceRecordUpdated:row.sourceRecordUpdated,audience:40000,audienceSource:candidate.profileUrl,audienceCheckedAt:at,lastActiveAt:at,activitySource:'https://www.instagram.com/p/post1/',activityCheckedAt:at,mukbang:candidate.mukbang,contactEvidence:[]},row);
 await assert.rejects(()=>query(db,'select sanji_daily_supply_instagram_review($1,$2,$3)',[other,CAMPAIGN,{...review,reviewedBy:other}]),/source/);
 await query(db,'select sanji_daily_supply_instagram_review($1,$2,$3)',[owner,CAMPAIGN,review]);
 assert.deepEqual(jsonRow((await query(db,'select * from sanji_creator_recovery where id=$1',[cid]))[0]),native);
 const overlaid=applyInstagramReview(row,review);
 return enrichCandidate(db,k,overlaid,{instagram:true,bioCheckedAt:new Date(Date.now()-7*86400000+30000).toISOString()});
}

for(const [label,platform,transform] of [['native YouTube','youtube',nativeEnrichment],['staged YouTube','youtube',stagedEnrichment],['supplemental Instagram','instagram',instagramEnrichment]]){
 test('real schemas: '+label+' source approval → enrichment → prepare → recipient basis → one-use grant',async()=>{
  const db=await setup();try{
   await query(db,"delete from sanji_records where kind='deal'");
   const x=await ready(db,{platform,transform,snapshot:assetSnapshot()});
   const contact=(await query(db,'select snapshot from sanji_daily_outreach_candidates'))[0].snapshot.contact;
   assert.equal(contact.enrichment,undefined,'prepared contact is canonical, not raw registry metadata');
   const r=await reserve(db,x);
   await db.exec('begin');
   await query(db,"insert into sanji_contact_source_versions(owner,source_id,revision,creator_key,source_url,source_kind,state) select owner,source_id,3,creator_key,source_url,source_kind,'revoked' from sanji_contact_source_versions where revision=2");
   await assert.rejects(()=>begin(db,x,r),/publication|source/);
   await db.exec('rollback');
   if(platform==='instagram'){
    await db.exec('begin');
    await query(db,"update sanji_daily_supply_instagram_reviews set review=jsonb_set(review,'{mukbang,sourceText}','\"Changed independent review\"')");
    await assert.rejects(()=>begin(db,x,r),/evidence|review|mukbang|source/);await db.exec('rollback');
   }
   const grant=await begin(db,x,r);assert.equal(grant.ready,true);
   if(platform==='instagram')assert.ok(Date.parse(grant.expiresAt)<=Date.now()+30000);
   await assert.rejects(()=>begin(db,x,r),/one-use/);
   assert.equal((await finalize(db,x,r,'accepted',{id:'local-mock-receipt',threadId:'local-mock-thread'})).status,'accepted');
   assert.equal((await query(db,"select count(*)::int n from sanji_records where kind='thread'"))[0].n,1);
  }finally{await db.close();}
 });
}

test('combined YouTube retention physically removes expired API/review data and preserves independent prepared identity',async()=>{
 const db=await setup();try{
  await ready(db,{transform:stagedEnrichment,snapshot:assetSnapshot()});
  await query(db,"update sanji_daily_supply_snapshots set observed_at=clock_timestamp()-interval '30 days',expires_at=clock_timestamp()-interval '1 day'");
  await query(db,"update sanji_daily_supply_reviews set reviewed_at=clock_timestamp()-interval '30 days',expires_at=clock_timestamp()-interval '1 day'");
  await query(db,"update sanji_daily_outreach_candidates set snapshot=jsonb_set(snapshot,'{apiSnapshot,expiresAt}',to_jsonb((clock_timestamp()-interval '1 day')::text))");
  await db.exec('set role service_role');
  const supply=(await query(db,'select sanji_daily_supply_sweep() r'))[0].r;
  assert.equal(supply.snapshotsDeleted,1);assert.equal(supply.reviewsDeleted,1);
  const prepared=(await query(db,'select sanji_daily_outreach_sweep() r'))[0].r;
  assert.equal(prepared.preparedApiSnapshotsRemoved,1);
  const retained=(await query(db,'select snapshot from sanji_daily_outreach_candidates'))[0].snapshot;
  for(const field of ['apiSnapshot','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt'])assert.equal(Object.hasOwn(retained,field),false,field);
  assert.equal(retained.name,'Creator');assert.equal(retained.creatorKey,key);
  assert.equal(retained.displayNameEvidence.verified,true);assert.ok(retained.apiDataRemovedAt);
  assert.equal((await query(db,"select sanji_contact_creator_anchor($1,$2,null) allowed",[owner,key]))[0].allowed,false);
  assert.equal((await query(db,'select sanji_daily_outreach_sweep() r'))[0].r.preparedApiSnapshotsRemoved,0);
 }finally{await db.close();}
});

test('combined Instagram sweep keeps guard, blocks old native fallback and enforces native owner FK',async()=>{
 const db=await setup();try{
  const x=await ready(db,{platform:'instagram',transform:instagramEnrichment,snapshot:assetSnapshot()});
  await assert.rejects(()=>query(db,"insert into sanji_daily_supply_instagram_review_guards(owner,campaign,creator_id,last_reviewed_at) values($1,$2,$3,clock_timestamp())",[other,CAMPAIGN,cid]),/foreign key/);
  await query(db,"update sanji_daily_supply_instagram_reviews set reviewed_at=clock_timestamp()-interval '30 days',expires_at=clock_timestamp()-interval '1 day'");
  await db.exec('set role service_role');
  assert.equal((await query(db,'select sanji_daily_supply_instagram_sweep() r'))[0].r.instagramReviewsDeleted,1);
  assert.equal((await query(db,'select count(*)::int n from sanji_daily_supply_instagram_review_guards'))[0].n,1);
  await assert.rejects(()=>reserve(db,x),/expired|review/);
  assert.equal((await query(db,'select count(*)::int n from sanji_outbox'))[0].n,0);
  assert.equal((await query(db,'select sanji_daily_supply_instagram_sweep() r'))[0].r.instagramReviewsDeleted,0);
 }finally{await db.close();}
});

test('reviewed 1200-character mukbang evidence survives preparation and final grant on all source paths',async()=>{
 for(const [platform,baseTransform] of [['youtube',nativeEnrichment],['youtube',stagedEnrichment],['instagram',instagramEnrichment]]){
  const db=await setup();try{
   const sourceText='먹방 '.repeat(400).trim();
   const transform=async ctx=>{
    const mukbang={...ctx.candidate.mukbang,sourceText};
    if(baseTransform===nativeEnrichment)await query(db,"update sanji_records set data=jsonb_set(data,'{dailyOutreachEvidence,mukbang}',$1) where id=$2",[mukbang,cid]);
    return baseTransform({...ctx,candidate:{...ctx.candidate,mukbang}});
   };
   const x=await ready(db,{platform,transform,snapshot:assetSnapshot()});
   const prepared=(await query(db,'select snapshot from sanji_daily_outreach_candidates'))[0].snapshot;
   assert.equal(prepared.mukbang.sourceText,sourceText);
   const reservation=await reserve(db,x);
   assert.equal((await begin(db,x,reservation)).ready,true);
  }finally{await db.close();}
 }
});
test('forward criteria upgrade preserves stored rows, policies, RLS and exact function ACLs and is repeatable',async()=>{const db=await setup();try{const x=await ready(db),legacy=snapshot();legacy.version=1;delete legacy.recipientCriteria;sealSnapshot(legacy);await query(db,'insert into sanji_daily_campaign_snapshots(owner,data,sha256) values($1,$2,$3)',[owner,legacy,hash(legacy)]);const tableNames=['sanji_daily_campaign_snapshots','sanji_daily_campaign_policy','sanji_daily_campaign_basis','sanji_daily_campaign_queue','sanji_daily_outreach_candidates','sanji_daily_outreach_runs','sanji_records'];const rows=async()=>{const result={};for(const name of tableNames)result[name]=await query(db,'select to_jsonb(t) as row from '+name+' t order by to_jsonb(t)::text');return result;};const before=await rows(),acl=await query(db,"select p.oid,p.proname,p.proacl,p.prosecdef from pg_proc p where p.proname like 'sanji_daily_%' order by p.oid"),rls=await query(db,"select oid,relname,relrowsecurity from pg_class where relname like 'sanji_daily_%' order by oid");const sql=fs.readFileSync('supabase/pending/creator-daily-recipient-criteria-upgrade.sql','utf8');assert.equal((sql.match(/create or replace function public\./g)||[]).length,6);assert.ok(!/\b(?:grant|revoke|drop\s+(?:table|function)|alter\s+table|truncate)\b/i.test(sql));await db.exec(sql);await db.exec(sql);assert.deepEqual(await rows(),before);assert.deepEqual(await query(db,"select p.oid,p.proname,p.proacl,p.prosecdef from pg_proc p where p.proname like 'sanji_daily_%' order by p.oid"),acl);assert.deepEqual(await query(db,"select oid,relname,relrowsecurity from pg_class where relname like 'sanji_daily_%' order by oid"),rls);const r=await reserve(db,x);assert.equal((await begin(db,x,r)).ready,true);}finally{await db.close();}});
test('forward criteria upgrade is exactly the six reviewed existing function definitions',()=>{const upgrade=fs.readFileSync('supabase/pending/creator-daily-recipient-criteria-upgrade.sql','utf8');for(const [file,name]of [['creator-daily-outreach','sanji_daily_outreach_prepare'],['creator-daily-supply','sanji_daily_supply_finish'],['creator-daily-campaign','sanji_daily_campaign_snapshot_check'],['creator-daily-campaign','sanji_daily_campaign_configure'],['creator-daily-campaign','sanji_daily_campaign_schedule'],['creator-daily-campaign','sanji_daily_campaign_validate']]){const source=fs.readFileSync('supabase/pending/'+file+'.sql','utf8'),match=source.match(new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end \\$\\$;'));assert.ok(match,name);assert.ok(upgrade.includes(match[0].replace('create function','create or replace function')),name);}});
