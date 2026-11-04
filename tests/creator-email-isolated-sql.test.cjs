const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const owner='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',pid='33333333-3333-4333-8333-333333333333',checked=new Date().toISOString();
const creator={handle:'foodperson',nickname:'푸드',profile_url:'https://www.instagram.com/foodperson/',bio:'건강 식단 food@naver.com'};
const settings={signatureSource:'gmail',gmailSignatureEmail:'owner@gmail.com',gmailSignatureHtml:'<b>대표 서명</b>',emailSignature:'대표 서명',senderName:'대표',senderPhone:'010-0000-0000'};
const deal={name:'건강 단백질 식품',state:'협의 중',category:'식품',productUrl:'https://brand.example/product'};
const policy={senderEmail:'owner@gmail.com',signatureHtml:settings.gmailSignatureHtml,signatureText:settings.emailSignature,messageType:'non_marketing',classificationSource:'reviewed documented requested proposal',recipientClaimsConfirmed:true,claimsSource:'confirmed facts',subject:'[인플루언서명]님 제안',body:'안녕하세요, [인플루언서명]님. [상품명] 제안입니다.'};
const evidence={source_provider:'instagram_public',source_kind:'public_bio',source_url:creator.profile_url,detail:{bio:creator.bio,bio_source_url:creator.profile_url,bio_content_available:true,bio_checked_at:checked,emails:['food@naver.com']}};
const plan=()=>({eligible:true,email:{address:'food@naver.com',checkedAt:checked,sourceUrl:creator.profile_url,bio:creator.bio},product:{...deal,id:pid,version:1},subject:'푸드님 제안',body:'안녕하세요, 푸드님. 건강 단백질 식품 제안입니다.\n\n대표 서명',signatureText:settings.emailSignature,signatureHtml:settings.gmailSignatureHtml,marketing:false,match:['food'],gmailHistory:{checkedAt:new Date().toISOString(),address:'food@naver.com',senderEmail:'owner@gmail.com',clear:true}});
async function database(){
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table sanji_members(user_id uuid);insert into auth.users values('${owner}');insert into sanji_members values('${owner}');
 create table sanji_records(id uuid primary key default gen_random_uuid(),owner uuid,kind text,version int default 1,data jsonb,updated timestamptz default now());
 create table sanji_creator_recovery(id uuid primary key,owner uuid,handle text,nickname text,profile_url text,status text default 'new',bio_status text default 'not_checked',emails jsonb default '[]',bio text default '',entity_type text default 'creator_evidence',link_status text default 'source_confirmed',last_verified timestamptz,updated timestamptz default now());
 create table sanji_creator_contact_review(owner uuid,creator_id uuid,version int default 1,data jsonb,updated timestamptz default now(),primary key(owner,creator_id));
 create table sanji_creator_recommendations(owner uuid,creator_id uuid,day date,created timestamptz default now(),primary key(owner,creator_id));
 create table sanji_creator_evidence(owner uuid,creator_id uuid,source_provider text,source_kind text,source_url text,detail jsonb);
 create table sanji_creator_inbound_messages(owner uuid,creator_id uuid,data jsonb);
 create table sanji_connections(owner uuid,provider text,summary jsonb);
 create table sanji_drafts(id uuid primary key default gen_random_uuid(),owner uuid,used boolean default false,expires timestamptz,hash text,data jsonb);
 create table sanji_jobs(id uuid primary key default gen_random_uuid(),owner uuid,draft_id uuid unique,preview_hash text,run_at timestamptz,status text default 'queued');
 create table sanji_outbox(id uuid primary key default gen_random_uuid(),owner uuid,target uuid,channel text,fingerprint text,status text,data jsonb,created timestamptz default now());
 create table sanji_audit(owner uuid,action text,data jsonb);create table sanji_suppression(owner uuid,identity text);create function sanji_blocked(uuid,jsonb) returns boolean language sql as 'select false';`);
 for(const file of ['202610210001_workspace.sql','202610210002_automation.sql']){const s=fs.readFileSync('supabase/migrations/'+file,'utf8');for(const name of ['sanji_reserve_dispatch','sanji_schedule_dispatch']){const start=s.indexOf('create or replace function public.'+name+'(');if(start>=0)await db.exec(s.slice(start,s.indexOf('end $$;',start)+7));}}
 await db.exec(fs.readFileSync('supabase/migrations/202610290002_creator_proposal_guard.sql','utf8'));
 if(process.env.SANJI_RESERVATION_FIXTURE){
  const rows=JSON.parse(fs.readFileSync(process.env.SANJI_RESERVATION_FIXTURE,'utf8'));
  const names=new Set(['sanji_reserve_dispatch','sanji_validate_creator_proposal','sanji_creator_proposal_target']);
  assert.ok(Array.isArray(rows)&&rows.length===3,'exactly three approved existing routine definitions');
  for(const row of rows){assert.ok(names.delete(row.proname),'unexpected or duplicate fixture routine');assert.ok(row.definition.startsWith('CREATE OR REPLACE FUNCTION public.'+row.proname+'('),'routine definition mismatch');assert.equal(require('node:crypto').createHash('md5').update(row.definition).digest('hex'),row.definition_md5,'routine fingerprint mismatch');await db.exec(row.definition);}
 }
 const before=(await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in ('sanji_reserve_dispatch','sanji_schedule_dispatch','sanji_validate_creator_proposal') order by proname")).rows;
 await db.exec(fs.readFileSync('supabase/pending/creator-email-isolated.sql','utf8'));
 assert.deepEqual((await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in ('sanji_reserve_dispatch','sanji_schedule_dispatch','sanji_validate_creator_proposal') order by proname")).rows,before,'legacy functions unchanged');
 await db.query('insert into sanji_creator_recovery(id,owner,handle,nickname,profile_url,updated) values($1,$2,$3,$4,$5,$6)',[cid,owner,creator.handle,creator.nickname,creator.profile_url,checked]);
 await db.query('insert into sanji_records(id,owner,kind,data) values($1,$2,\'deal\',$3)',[pid,owner,deal]);
 await db.query('insert into sanji_records(owner,kind,data) values($1,\'settings\',$2)',[owner,settings]);
 await db.query('insert into sanji_creator_evidence values($1,$2,$3,$4,$5,$6)',[owner,cid,evidence.source_provider,evidence.source_kind,evidence.source_url,evidence.detail]);
 await db.query('insert into sanji_connections values($1,\'gmail\',$2)',[owner,{email:'owner@gmail.com'}]);
 return db;
}

async function enable(db,{send=true}={}){await db.query("insert into sanji_creator_email_isolated_policy(owner,enabled,send_enabled,enabled_at,authorization_source,data) values($1,true,$2,now()-interval '1 second','test-user-authorization',$3)",[owner,send,policy]);}
async function recommend(db){await db.query('insert into sanji_creator_recommendations(owner,creator_id,day) values($1,$2,current_date)',[owner,cid]);}
async function basis(db){await db.query("insert into sanji_creator_email_isolated_basis(owner,creator_id,recipient,status,kind,classification,classification_source,source_url,source_text,verified_at,expires_at,approved_by,approval_source,policy_revision,product_ids) values($1,$2,'food@naver.com','approved','solicited_proposal','solicited_non_marketing_proposal','scope manually reviewed','https://example.test/request','Please send this product proposal',now(),now()+interval '1 day',$1,'explicit owner approval',1,array[$3::uuid])",[owner,cid,pid]);}
async function sync(db){return (await db.query('select sanji_creator_email_isolated_sync($1) result',[owner])).rows[0].result;}
async function claim(db){return (await db.query('select * from sanji_creator_email_isolated_claim($1)',[owner])).rows[0];}
async function reserve(db,q,p=plan(),review=0){const d={channel:'email',proposalType:'creator_product_proposal',subject:p.subject,body:p.body,email:p.email.address,marketing:p.marketing,messageId:'stable-message-id',attachments:[{unapproved:'ignored'}],trackingPixelUrl:'https://unapproved.test/pixel'};return (await db.query('select sanji_creator_email_isolated_reserve($1,$2,$3,$4,$5,$6,$7) result',[owner,cid,q.lease_token,checked,review,p,d])).rows[0].result;}
async function ready(db){await enable(db);await recommend(db);await basis(db);await sync(db);return await claim(db);}
async function beginSend(db,r,proof=plan().gmailHistory){return (await db.query('select sanji_creator_email_isolated_begin_send($1,$2,$3,$4) result',[owner,cid,r.reservationToken,proof])).rows[0].result;}
async function finish(db,r,status,provider={}){return (await db.query('select sanji_creator_email_isolated_finalize($1,$2,$3,$4,$5) result',[owner,cid,r.reservationToken,status,provider])).rows[0].result;}

test('disabled default, explicit cutover, no legacy mutation/trigger/jobs, and owner-only RPC ACL',async()=>{const db=await database();try{
 await recommend(db);assert.equal((await sync(db)).queued,0);await enable(db);await db.query("update sanji_creator_email_isolated_policy set enabled_at=now()+interval '1 second'");assert.equal((await sync(db)).queued,0);
 await db.query("update sanji_creator_email_isolated_policy set enabled_at=now()-interval '1 second'");assert.equal((await sync(db)).queued,1);assert.equal((await sync(db)).queued,0);
 assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='sanji_creator_recommendations'::regclass and not tgisinternal")).rows[0].n,0);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from sanji_creator_email_isolated_queue'),/permission denied/);await assert.rejects(()=>db.query('select sanji_creator_email_isolated_sync($1)',[owner]),/permission denied/);await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from sanji_jobs')).rows[0].n,0);
 }finally{await db.close();}});

test('atomic reserve consumes internal draft, preserves DM, blocks reuse and excludes unapproved payload',async()=>{const db=await database();try{
 const q=await ready(db);assert.equal(await claim(db),undefined);await db.query('insert into sanji_creator_contact_review values($1,$2,1,$3,now())',[owner,cid,{dm:{body:'preserve'}}]);const r=await reserve(db,q,plan(),1);assert.equal(r.status,'reserved');assert.ok(r.reservationToken);assert.equal(r.draft.body,plan().body);assert.equal(r.draft.subject,'푸드님 제안');assert.deepEqual(r.draft.attachments,[]);assert.equal(r.draft.trackingPixelUrl,undefined);assert.equal(r.draft.creatorAuto,undefined);
 assert.equal((await db.query('select used from sanji_drafts')).rows[0].used,true);assert.equal((await db.query('select count(*)::int n from sanji_jobs')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from sanji_outbox')).rows[0].n,1);assert.deepEqual((await db.query('select data from sanji_creator_contact_review')).rows[0].data.dm,{body:'preserve'});
 const again=await reserve(db,q,plan(),1);assert.equal(again.duplicate,true);assert.equal(again.draft,undefined);assert.equal(again.reservationToken,undefined);assert.equal(await claim(db),undefined);
 const d=(await db.query('select * from sanji_drafts')).rows[0];await assert.rejects(()=>db.query('select sanji_reserve_dispatch($1,$2,$3,$4)',[owner,d.id,d.hash,'retry']),/중복/);
 }finally{await db.close();}});

test('reservation rejects invalid basis, identity, proof, policy, Gmail check and record races without partial writes',async()=>{const db=await database();try{const q=await ready(db);
 const changes=[
 ["update sanji_creator_email_isolated_policy set send_enabled=false",/authorization/],
 ["update sanji_creator_email_isolated_policy set revision=2",/authorization/],
 ["update sanji_creator_email_isolated_policy set enabled_at=now()+interval '1 day'",/authorization/],
 ["update sanji_creator_email_isolated_policy set data=jsonb_set(data,'{messageType}','\"marketing\"')",/marketing/],
 ["delete from sanji_creator_email_isolated_basis",/basis/],
 ["update sanji_creator_email_isolated_basis set status='revoked'",/basis/],
 ["update sanji_creator_email_isolated_basis set kind='explicit_consent'",/basis/],
 ["update sanji_creator_email_isolated_basis set product_ids='{}'",/basis/],
 ["update sanji_creator_email_isolated_basis set product_ids=array['44444444-4444-4444-8444-444444444444'::uuid]",/basis/],
 ["update sanji_creator_email_isolated_basis set classification=''",/basis/],
 ["update sanji_creator_email_isolated_basis set classification_source=''",/basis/],
 ["update sanji_creator_email_isolated_basis set source_url='http://example.test/request'",/basis/],
 ["update sanji_creator_email_isolated_basis set approved_by=null",/basis/],
 ["update sanji_creator_email_isolated_basis set expires_at=now()-interval '1 second'",/basis/],
 ["update sanji_creator_email_isolated_basis set policy_revision=2",/basis/],
 ["delete from sanji_creator_evidence",/publication/],
 ["update sanji_creator_evidence set detail=jsonb_set(detail,'{emails}','[\"food@naver.com\",\"second@naver.com\"]')",/publication/],
 ["update sanji_creator_evidence set detail=jsonb_set(detail,'{emails}','{}')",/publication/],
 ["update sanji_creator_recovery set link_status=null",/creator changed/],
 ["update sanji_creator_recovery set entity_type='noncreator_suspected'",/creator changed/],
 ["update sanji_records set data=data-'signatureSource' where kind='settings'",/signature/],
 ["update sanji_records set data=data||'{\"gmailSignatureNeedsConsent\":true}' where kind='settings'",/signature/],
 ["update sanji_records set version=2 where kind='deal'",/product/],
 ["update sanji_records set data=data-'productUrl' where kind='deal'",/product/],
 ["insert into sanji_suppression values('"+owner+"','email:food@naver.com')",/suppressed/],
 ["insert into sanji_creator_inbound_messages values('"+owner+"','"+cid+"','{}')",/prior reply/],
 ["delete from sanji_creator_recommendations",/recommendation changed/]
 ];
 for(const [sql,rx] of changes){await db.exec('begin');await db.exec(sql);await assert.rejects(()=>reserve(db,q),rx,sql);await db.exec('rollback');assert.equal((await db.query('select count(*)::int n from sanji_outbox')).rows[0].n,0);}
 for(const change of [p=>delete p.gmailHistory,p=>p.gmailHistory.clear=false,p=>p.gmailHistory.address='other@naver.com',p=>p.gmailHistory.checkedAt='2020-01-01',p=>p.gmailHistory.senderEmail='other@gmail.com']){const p=plan();change(p);await assert.rejects(()=>reserve(db,q,p),/Gmail history/);}
 }finally{await db.close();}});

test('finalization is idempotent, records accepted native thread, and unknown never requeues',async()=>{for(const status of ['accepted','rejected','outcome_unknown','cancelled']){const db=await database();try{const r=await reserve(db,await ready(db));const provider=status==='accepted'?{id:'gmail-id',threadId:'gmail-thread'}:{};if(status!=='cancelled')assert.equal((await beginSend(db,r)).ready,true);
 if(status==='accepted'){await assert.rejects(()=>finish(db,r,status,{}),/unverified/);await assert.rejects(()=>finish(db,r,status,{id:{bad:true},threadId:'thread'}),/unverified/);}
 assert.equal((await finish(db,r,status,provider)).status,status);assert.equal((await finish(db,r,status,provider)).duplicate,true);await assert.rejects(()=>finish(db,r,status==='accepted'?'outcome_unknown':'accepted',{id:'x',threadId:'y'}),/manual reconciliation/);
 assert.equal(await claim(db),undefined);await sync(db);assert.equal(await claim(db),undefined);assert.equal((await db.query("select count(*)::int n from sanji_records where kind='thread'")).rows[0].n,status==='accepted'?1:0);
 assert.equal((await db.query('select status from sanji_outbox')).rows[0].status,status==='rejected'?'provider_rejected':status);
 }finally{await db.close();}}});

test('only explicitly resolved pre-send holds resume; unrelated and uncertain outcomes stay held',async()=>{const db=await database();try{await ready(db);
 for(const reason of ['recipient_basis_required','sending_disabled','message_classification_required','preparation_failed','existing_gmail_contact']){await db.query("update sanji_creator_email_isolated_queue set status='held',reason=$1,snapshot=$2",[reason,plan()]);await sync(db);assert.equal((await db.query('select status from sanji_creator_email_isolated_queue')).rows[0].status,['recipient_basis_required','sending_disabled','message_classification_required'].includes(reason)?'pending':'held');}
 await db.query("update sanji_creator_email_isolated_queue set status='held',reason='recipient_basis_required'");await db.query("update sanji_creator_email_isolated_basis set status='pending'");await sync(db);assert.equal((await db.query('select status from sanji_creator_email_isolated_queue')).rows[0].status,'held');
 }finally{await db.close();}});

test('expired preparation lease reclaims with a new token, wrong owner/token never reserves',async()=>{const db=await database();try{const q=await ready(db);
 await db.query("update sanji_creator_email_isolated_queue set lease_until=now()-interval '1 second'");await assert.rejects(()=>reserve(db,q),/stale preparation lease/);const q2=await claim(db);assert.notEqual(q.lease_token,q2.lease_token);await assert.rejects(()=>reserve(db,q),/stale preparation lease/);
 const other='44444444-4444-4444-8444-444444444444',p=plan();await assert.rejects(()=>db.query('select sanji_creator_email_isolated_reserve($1,$2,$3,$4,$5,$6,$7)',[other,cid,q2.lease_token,checked,0,p,{}]),/missing recommendation/);
 const r=await reserve(db,q2);await assert.rejects(()=>db.query('select sanji_creator_email_isolated_finalize($1,$2,$3,$4,$5)',[owner,cid,other,'outcome_unknown',{}]),/reservation mismatch/);await assert.rejects(()=>db.query('select sanji_creator_email_isolated_finalize($1,$2,$3,$4,$5)',[other,cid,r.reservationToken,'outcome_unknown',{}]),/reservation mismatch/);
 await finish(db,r,'outcome_unknown');assert.equal(await claim(db),undefined);
 }finally{await db.close();}});

test('new policy defaults disabled; old recommendations excluded after explicit cutover and RPCs closed to public roles',async()=>{const db=await database();try{
 await db.query('insert into sanji_creator_email_isolated_policy(owner) values($1)',[owner]);const p=(await db.query('select * from sanji_creator_email_isolated_policy')).rows[0];assert.equal(p.enabled,false);assert.equal(p.send_enabled,false);assert.equal(p.enabled_at,null);
 await recommend(db);await db.query("update sanji_creator_recommendations set created=now()-interval '1 day'");await db.query("update sanji_creator_email_isolated_policy set enabled=true,enabled_at=now(),authorization_source='approved'");assert.equal((await sync(db)).queued,0);
 const acl=(await db.query("select proname,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service from pg_proc where proname like 'sanji_creator_email_isolated_%'")).rows;assert.equal(acl.length,5);for(const r of acl){assert.equal(r.anon,false,r.proname);assert.equal(r.authenticated,false,r.proname);assert.equal(r.service,true,r.proname);}
 }finally{await db.close();}});


test('poll inserts at most 500 unseen recommendations and continues without skipping older unseen rows',async()=>{const db=await database();try{
 await enable(db);
 await db.query("insert into sanji_creator_recovery(id,owner,handle,nickname,profile_url) select gen_random_uuid(),$1,'creator_'||n,'Creator','https://www.instagram.com/creator_'||n||'/' from generate_series(1,503) n",[owner]);
 await db.query('insert into sanji_creator_recommendations(owner,creator_id,day) select owner,id,current_date from sanji_creator_recovery where owner=$1',[owner]);
 assert.equal((await sync(db)).queued,500);assert.equal((await sync(db)).queued,4);assert.equal((await sync(db)).queued,0);
 assert.equal((await db.query('select count(*)::int n from sanji_creator_email_isolated_queue')).rows[0].n,504);
 }finally{await db.close();}});


test('SQL independently rejects ambiguous public bio even when a forged plan repeats its body',async()=>{const db=await database();try{const q=await ready(db),p=plan();p.email.bio+=' second@naver.com';await db.query("update sanji_creator_evidence set detail=jsonb_set(detail,'{bio}',$1::jsonb)",[JSON.stringify(p.email.bio)]);await assert.rejects(()=>reserve(db,q,p),/publication/);assert.equal((await db.query('select count(*)::int n from sanji_outbox')).rows[0].n,0);
 }finally{await db.close();}});


test('begin-send is single-use, final guards reject intervening changes and cannot renew a lost grant',async()=>{const db=await database();try{const r=await reserve(db,await ready(db));
 const changes=["update sanji_creator_email_isolated_policy set send_enabled=false","update sanji_creator_email_isolated_basis set status='revoked'","update sanji_creator_email_isolated_basis set product_ids='{}'","update sanji_creator_email_isolated_basis set expires_at=now()-interval '1 second'","delete from sanji_creator_evidence","update sanji_creator_recovery set entity_type='noncreator_suspected'","update sanji_records set version=version+1 where kind='settings'","update sanji_records set data=data-'signatureSource' where kind='settings'","update sanji_records set version=version+1 where kind='deal'","update sanji_records set data=jsonb_set(data,'{productUrl}','\"http://example.test/product\"') where kind='deal'","update sanji_creator_evidence set detail=jsonb_set(detail,'{emails}','[\"food@naver.com\",\"other@naver.com\"]')","update sanji_creator_contact_review set version=version+1","insert into sanji_suppression values('"+owner+"','email:food@naver.com')","insert into sanji_creator_inbound_messages values('"+owner+"','"+cid+"','{}')"];
 for(const sql of changes){await db.exec('begin');await db.exec(sql);await assert.rejects(()=>beginSend(db,r),/changed|requires review|publication|suppressed|basis/);await db.exec('rollback');}
 await assert.rejects(()=>beginSend(db,r,{...plan().gmailHistory,checkedAt:'2020-01-01'}),/Gmail/);
 await assert.rejects(()=>finish(db,r,'accepted',{id:'x',threadId:'y'}),/send grant/);
 const first=await beginSend(db,r);assert.equal(first.ready,true);assert.ok(Date.parse(first.expiresAt)>Date.now());const duplicate=await beginSend(db,r);assert.equal(duplicate.ready,false);assert.equal(duplicate.expiresAt,undefined);
 assert.equal((await finish(db,r,'cancelled')).status,'cancelled');assert.equal((await db.query('select status from sanji_outbox')).rows[0].status,'cancelled');assert.equal((await db.query("select count(*)::int n from sanji_records where kind='thread'")).rows[0].n,0);
 }finally{await db.close();}});

test('actual worker and SQL integrate end to end with one mocked Gmail send and zero legacy jobs',async()=>{const db=await database();try{
 await enable(db);await recommend(db);await basis(db);
 const bundle=require('esbuild').buildSync({entryPoints:['supabase/functions/_shared/creator-email-isolated-service.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,m={exports:{}};new Function('module','exports','require',bundle)(m,m.exports,require);
 const identifier=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/i);return '"'+x+'"';};
 class Q{
  constructor(table){this.table=identifier(table);this.filters=[];this.fields='*';this.sort='';this.bound='';}
  select(fields='*'){this.fields=fields==='*'?'*':fields.split(',').map(identifier).join(',');return this;}
  eq(k,v){this.filters.push({k,values:[v]});return this;}
  in(k,values){this.filters.push({k,values});return this;}
  order(k,{ascending=true}={}){this.sort=' order by '+identifier(k)+(ascending?' asc':' desc');return this;}
  limit(n){assert.ok(Number.isInteger(n)&&n>=0);this.bound=' limit '+n;return this;}
  maybeSingle(){this.single=true;return this;}
  update(data){this.patch=data;return this;}
  insert(data){this.inserted=data;return this;}
  async execute(){
   const params=[],bind=v=>{params.push(v);return '$'+params.length;};let sql;
   const where=()=>this.filters.length?' where '+this.filters.map(({k,values})=>identifier(k)+' in ('+values.map(bind).join(',')+')').join(' and '):'';
   if(this.patch)sql='update '+this.table+' set '+Object.entries(this.patch).map(([k,v])=>identifier(k)+'='+bind(v)).join(',')+where()+' returning '+this.fields;
   else if(this.inserted){const entries=Object.entries(this.inserted);sql='insert into '+this.table+'('+entries.map(([k])=>identifier(k)).join(',')+') values('+entries.map(([,v])=>bind(v)).join(',')+') returning '+this.fields;}
   else sql='select '+this.fields+' from '+this.table+where()+this.sort+this.bound;
   try{const rows=(await db.query(sql,params)).rows;return {data:this.single?(rows[0]||null):rows,error:null};}catch(error){return {data:null,error};}
  }
  then(resolve,reject){return this.execute().then(resolve,reject);}
 }
 const calls=[],sb={from:table=>new Q(table),rpc:async(name,args)=>{assert.match(name,/^sanji_creator_email_isolated_[a-z_]+$/);calls.push(name);const entries=Object.entries(args),params=entries.map(([,v])=>v),named=entries.map(([k],i)=>identifier(k)+'=> $'+(i+1)).join(',');try{const q=name.endsWith('_claim')?'select * from '+identifier(name)+'('+named+')':'select '+identifier(name)+'('+named+') result';const rows=(await db.query(q,params)).rows;return {data:name.endsWith('_claim')?rows:rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 let sent=0,history=0;
 const service=m.exports.isolatedCreatorEmailService({sb,query:async p=>{const r=await p;if(r.error)throw r.error;return r.data;},env:k=>k==='EMAIL_SENDING_ENABLED'?'true':'',connection:async()=>null,gmailToken:async()=>({email:'owner@gmail.com',access_token:'synthetic-local-token'}),remote:async(url,opts)=>{if(url.endsWith('/messages/send')){assert.equal(opts.method,'POST');assert.ok(JSON.parse(opts.body).raw);sent++;return {id:'gmail-e2e',threadId:'gmail-thread-e2e'};}assert.match(url,/messages\?/);assert.match(url,/includeSpamTrash=true/);history++;return {resultSizeEstimate:0};},digest:async()=>'',uuid:()=>crypto.randomUUID(),audit:async()=>{}});
 const result=await service.run();assert.equal(result.accepted,1,JSON.stringify(result));assert.equal(sent,1);assert.equal(history,2);assert.ok(calls.includes('sanji_creator_email_isolated_begin_send'));
 assert.equal((await db.query('select status from sanji_outbox')).rows[0].status,'accepted');assert.equal((await db.query('select used from sanji_drafts')).rows[0].used,true);assert.equal((await db.query('select count(*)::int n from sanji_jobs')).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from sanji_records where kind='thread'")).rows[0].n,1);
 await service.run();assert.equal(sent,1,'subsequent poll never resends');
 }finally{await db.close();}});


test('new foreign keys preserve existing deletion lifecycle without restricting owner or creator removal',async()=>{const db=await database();try{
 const fks=(await db.query("select conrelid::regclass::text relation,pg_get_constraintdef(oid) definition from pg_constraint where contype='f' and conrelid::regclass::text like 'sanji_creator_email_isolated_%'")).rows;
 assert.ok(fks.length>=6);for(const fk of fks){assert.match(fk.definition,fk.definition.includes('(approved_by)')?/ON DELETE SET NULL/:/ON DELETE CASCADE/);}
 }finally{await db.close();}});

test('release migration exactly matches reviewed isolated SQL',()=>{const names=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('_creator_email_isolated.sql'));assert.equal(names.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+names[0],'utf8'),fs.readFileSync('supabase/pending/creator-email-isolated.sql','utf8'));});
