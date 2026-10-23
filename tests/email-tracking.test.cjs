const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),esbuild=require('esbuild');
const {PGlite}=require('@electric-sql/pglite');
const compile=file=>{const c=esbuild.buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}),m={exports:{}};new Function('module','exports','require',c.outputFiles[0].text)(m,m.exports,require);return m.exports;};
const tracking=compile('supabase/functions/_shared/email-tracking.ts'),{mime}=compile('supabase/functions/_shared/mail-mime.ts');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',target='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const disclosure='이 메일에는 열람 추정용 이미지가 포함됩니다. 추적 중지는 운영자에게 요청하실 수 있습니다.';
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;`);
 for(const step of [1,2,3])await db.exec(fs.readFileSync(`public/setup/0${step}.sql`,'utf8'));
 const migration=fs.readFileSync('supabase/migrations/202610220006_email_tracking.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'owner@example.test',other,'other@example.test']);await db.query('insert into sanji_members(user_id) values($1),($2)',[owner,other]);
 await db.query('insert into sanji_tracking_policy(owner,enabled) values($1,true)',[owner]);
 const campaign=(await db.query("insert into sanji_email_campaigns(owner,name,scope,enabled,disclosure,basis_note) values($1,'브랜드 테스트','brand',true,$2,'적법 근거와 고지 검토 기록') returning id",[owner,disclosure])).rows[0].id;
 let counter=0;
 const addOutbox=async(email='receiver@brand.test',extra={})=>{const d={channel:'email',target,messageId:'message-'+(++counter),subject:'원문 제목',body:'원문 카피\n'+disclosure,signature:'서명',emails:[email],email,tracking:{eligible:true,campaignId:campaign},...extra};const row=(await db.query("insert into sanji_outbox(owner,target,channel,status,fingerprint,data) values($1,$2,'email','submitting',$3,$4::jsonb) returning *",[owner,target,'fingerprint-'+counter,JSON.stringify(d)])).rows[0];return {row,d};};
 class Q{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push([k,v]);return this;}maybeSingle(){this.single=true;return this;}single(){this.single=true;return this;}order(){return this;}update(v){this.value=v;return this;}}
 const sb={from:t=>new Q(t),rpc:(name,args={})=>({rpc:name,args})};
 const query=async q=>{if(q.rpc){const keys=Object.keys(q.args),values=Object.values(q.args);return (await db.query('select to_jsonb(public.'+q.rpc+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+')) value',values)).rows[0].value;}
  const values=q.filters.map(([k,v])=>v),where=q.filters.map(([k],i)=>k+'=$'+(i+1)).join(' and ');
  if(q.value){const keys=Object.keys(q.value);return (await db.query('update public.'+q.table+' set '+keys.map((k,i)=>k+'=$'+(values.length+i+1)).join(',')+' where '+where,[...values,...Object.values(q.value)])).rows;}
  const rows=(await db.query('select * from public.'+q.table+(where?' where '+where:''),values)).rows;return q.single?rows[0]||null:rows;};
 const env=n=>n==='EMAIL_TRACKING_ACTIVATION_APPROVED'?'true':n==='EMAIL_TRACKING_TEST_ONLY'?'false':'';
 const svc=tracking.emailTrackingService({sb,query,env,audit:async()=>{},baseUrl:'https://project.supabase.co/functions/v1/bright-function'});
 const register=async(out,token=tracking.newTrackingToken(),test=false,testOnly=false)=>({token,row:await query(sb.rpc('sanji_register_email_tracking',{p_owner:owner,p_outbox:out.row.id,p_hash:await tracking.tokenHash(token),p_campaign:campaign,p_policy_version:1,p_campaign_version:1,p_sender:'sender@example.test',p_test:test,p_test_only:testOnly}))});
 const report=async(include=false)=>query(sb.rpc('sanji_email_tracking_report',{p_owner:owner,p_from:new Date(Date.now()-86400000).toISOString(),p_to:new Date(Date.now()+60000).toISOString(),p_campaign:campaign,p_include_automated:include,p_target:null}));
 return {db,svc,sb,query,env,campaign,addOutbox,register,report};
}

test('Tracking schema is repeatable and private; approved notice, policy and campaign versions gate registration',async()=>{
 const f=await setup();try{
 const out=await f.addOutbox();await f.db.query('update sanji_tracking_policy set enabled=false');assert.equal((await f.register(out)).row,null);await f.db.query('update sanji_tracking_policy set enabled=true');
 await f.db.query('update sanji_email_campaigns set external_tracking=true');assert.equal((await f.register(out)).row,null);await f.db.query('update sanji_email_campaigns set external_tracking=false');
 await f.db.query("update sanji_outbox set data=jsonb_set(data,'{body}','\"고지 없음\"')");assert.equal((await f.register(out)).row,null);
 await f.db.exec("select set_config('request.jwt.claim.sub','"+other+"',false);set role authenticated");
 for(const table of ['sanji_email_tracking','sanji_email_image_events','sanji_tracking_policy','sanji_email_campaigns'])await assert.rejects(()=>f.db.query('select * from '+table),/permission denied/);
 await assert.rejects(()=>f.db.query("select sanji_record_image_request(repeat('a',64),'unknown','none')"),/permission denied/);
 await assert.rejects(()=>f.db.query('select sanji_email_tracking_report($1,now()-interval \'1 day\',now())',[owner]),/permission denied/);
 }finally{await f.db.close();}
});

test('Unique pixel mapping returns real transparent GIF; repeats and proxies are requests, not people; unknown tokens leak nothing',async()=>{
 const f=await setup();try{
 const a=await f.addOutbox(),b=await f.addOutbox(),ta=await f.register(a),tb=await f.register(b);assert.notEqual(ta.token,tb.token);assert.equal(ta.token.length,43);assert.equal(ta.row.token_hash.includes('receiver'),false);
 await f.db.query("update sanji_outbox set status='accepted'");
 const request=(token,headers={})=>f.svc.pixel(new Request('https://project.supabase.co/functions/v1/bright-function/email-events/pixel/'+token+'.gif',{headers}),token);
 const image=await request(ta.token,{'x-forwarded-for':'203.0.113.1','user-agent':'Mozilla'});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/gif');assert.match(image.headers.get('cache-control'),/no-store/);const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.subarray(0,6).toString(),'GIF89a');assert.equal(bytes.readUInt16LE(6),1);assert.equal(bytes.readUInt16LE(8),1);
 await request(ta.token);await request(ta.token,{'user-agent':'GoogleImageProxy'});await request(tb.token,{'purpose':'prefetch'});
 let report=await f.report();assert.equal(report.summary.tracked,2);assert.equal(report.summary.estimated,1);assert.equal(report.rows.find(r=>r.id===a.row.id).requests,3);assert.equal(report.rows.find(r=>r.id===b.row.id).suspected,1);assert.equal((await f.report(true)).summary.estimated,2);
 const before=(await f.db.query('select count(*) n from sanji_email_image_events')).rows[0].n;
 const unknown=await request(tracking.newTrackingToken());assert.deepEqual(Buffer.from(await unknown.arrayBuffer()),bytes);await f.svc.pixel(new Request('https://p.test',{method:'HEAD'}),ta.token);assert.equal((await f.db.query('select count(*) n from sanji_email_image_events')).rows[0].n,before);
 // A forwarded copy reuses the token: another request, never another unique sent message/person.
 await request(ta.token);assert.equal((await f.report()).summary.estimated,1);
 const columns=(await f.db.query("select column_name from information_schema.columns where table_name='sanji_email_image_events'")).rows.map(r=>r.column_name);assert.equal(columns.some(c=>/ip|agent|device|location|referrer/.test(c)),false);assert.equal(JSON.stringify(report).includes(ta.token),false);assert.equal(JSON.stringify(report).includes('token_hash'),false);
 }finally{await f.db.close();}
});

test('Internal/self tests and shared To lists are explicit; disabled collection and expiry never change sales state or cause resend',async()=>{
 const f=await setup();try{
 const self=await f.addOutbox('owner@example.test'),s=await f.register(self);assert.equal(s.row.is_test,true);
 const group=await f.addOutbox('first@brand.test',{emails:['first@brand.test','second@brand.test']}),g=await f.register(group);assert.equal(g.row.mode,'shared');assert.equal(g.row.recipient_count,2);assert.equal((await f.register(await f.addOutbox(),undefined,false,true)).row,null);
 await f.db.query("update sanji_outbox set status='accepted'");await f.svc.pixel(new Request('https://p.test'),s.token);await f.svc.pixel(new Request('https://p.test'),g.token);assert.equal((await f.report()).summary.tracked,1);assert.equal((await f.report()).summary.estimated,1);
 await f.db.query('update sanji_tracking_policy set enabled=false');await f.svc.pixel(new Request('https://p.test'),g.token);assert.equal((await f.report()).rows.find(r=>r.id===group.row.id).requests,1);
 await f.db.query("update sanji_email_tracking set expires=now()-interval '1 second'");await f.query(f.sb.rpc('sanji_purge_email_tracking'));assert.equal((await f.db.query('select count(*) n from sanji_email_image_events')).rows[0].n,0);
 assert.equal((await f.report()).summary.tracked,0);assert.equal((await f.report()).summary.expired,1);assert.equal((await f.db.query("select count(*) n from sanji_outbox where status='accepted'")).rows[0].n,3);
 }finally{await f.db.close();}
});

test('Preview is token-free; explicit activation and disclosure required; DB outages keep original MIME sending path',async()=>{
 const f=await setup();try{
 const out=await f.addOutbox(),input={...out.d,trackingRequested:true,trackingCampaignId:f.campaign,trackingNoticeAcknowledged:true};
 assert.equal((await f.svc.preview(owner,input,'brand')).eligible,true);assert.equal((await f.db.query('select count(*) n from sanji_email_tracking')).rows[0].n,0);
 assert.equal((await f.svc.preview(owner,{...input,trackingNoticeAcknowledged:false},'brand')).eligible,false);assert.equal((await f.svc.preview(owner,{...input,body:'고지 없음'},'brand')).eligible,false);assert.equal((await f.svc.preview(owner,{...input,channel:'instagram'},'brand')).eligible,false);
 const off=tracking.emailTrackingService({sb:f.sb,query:f.query,env:()=>'',audit:async()=>{},baseUrl:'https://p.test'});assert.equal((await off.preview(owner,input,'brand')).eligible,false);
 const approved=await f.svc.preview(owner,input,'brand'),d={...out.d,tracking:approved};const prepared=await f.svc.prepare(owner,out.row.id,d,'sender@example.test');assert.match(prepared.draft.trackingPixelUrl,/\/email-events\/pixel\/[A-Za-z0-9_-]{43}\.gif$/);assert.equal(prepared.draft.body,d.body);assert.equal(prepared.draft.subject,d.subject);
 const broken=tracking.emailTrackingService({sb:f.sb,query:async()=>{throw Error('database unavailable');},env:f.env,audit:async()=>{throw Error('audit down');},baseUrl:'https://project.supabase.co/functions/v1/bright-function'});const fallback=await broken.prepare(owner,out.row.id,d,'sender@example.test');assert.equal(fallback.draft,d);assert.equal(fallback.summary.applied,false);let mockProviderCalls=0;const send=raw=>{mockProviderCalls++;assert.match(Buffer.from(raw,'base64url').toString(),/Content-Type: text\/plain/);};send(mime(fallback.draft,'sender@example.test'));assert.equal(mockProviderCalls,1);
 assert.equal((await broken.pixel(new Request('https://p.test'),tracking.newTrackingToken())).status,200);
 }finally{await f.db.close();}
});

test('MIME adds one HTML alternative pixel while preserving plain copy, links, Korean headers, signature, references and binary attachments',()=>{
 const body='원본 카피 <이미지 아님>\nhttps://littledore.kr/?a=1&b=2\n남준혁 드림',d={email:'receiver@example.test',subject:'원본 제목',body,senderName:'두더지웍스',messageId:'unique-mail',inReplyTo:'<reply@example.test>',references:'<root@example.test>',attachments:[{name:'문서.pdf',content:Buffer.from('%PDF-test').toString('base64')},{name:'이미지.png',content:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}],trackingPixelUrl:'https://project.supabase.co/functions/v1/bright-function/email-events/pixel/'+tracking.newTrackingToken()+'.gif'};
 const raw=Buffer.from(mime(d,'sender@example.test'),'base64url').toString();assert.match(raw,/multipart\/mixed/);assert.match(raw,/multipart\/alternative/);assert.match(raw,/In-Reply-To: <reply@example.test>/);assert.match(raw,/References: <root@example.test> <reply@example.test>/);
 const plain=/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(raw)[1];assert.equal(Buffer.from(plain.replace(/\r\n/g,''),'base64').toString(),body);
 const html=/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(raw)[1];const decoded=Buffer.from(html.replace(/\r\n/g,''),'base64').toString();assert.equal((decoded.match(/<img\b/g)||[]).length,1);assert.match(decoded,/width="1" height="1"/);assert.match(decoded,/&lt;이미지 아님&gt;/);assert.ok(raw.includes(d.attachments[0].content));assert.ok(raw.includes(d.attachments[1].content));
 assert.equal(Buffer.from(mime({...d,trackingPixelUrl:undefined},'sender@example.test'),'base64url').toString().includes('text/html'),false);
 assert.equal(tracking.trackingLabel({}), '추적 미적용');assert.equal(tracking.trackingLabel({tracking_id:'id',is_test:false}), '감지 없음');assert.equal(tracking.classifyImageRequest(new Headers({'user-agent':'AppleWebKit'})).classification,'unknown');
});

test('Tracking UI prioritizes replies, labels shared/untouched mail honestly and never loads the live pixel for sender previews',async()=>{
 const express=require('express'),{chromium}=require('@playwright/test'),app=express();app.use(express.json());const outId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const state={candidates:[{id:target,name:'테스트 브랜드',kind:'브랜드',contact:{email:'recipient@brand.test',verified:true}}],templates:[],deals:[],outbox:[],threads:[],jobs:[],suppression:[],settings:{}};
 const row={id:outId,target,status:'accepted',subject:'원본 메일',emails:['first@brand.test','second@brand.test'],label:'열람 추정',tracking_id:'tracking-id',mode:'shared',requests:3,suspected:1,first_request:new Date().toISOString(),last_request:new Date().toISOString(),conversation_reply:true,human_reply:false,reasonLabels:['메일 이미지 프록시 패턴 · 자체 추정']};
 const report={from:new Date(Date.now()-86400000).toISOString(),to:new Date().toISOString(),includeAutomated:false,summary:{sent_targets:2,replied_targets:1,positive_targets:1,estimated:1,tracked:2,expired:0},rows:[row,{...row,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',label:'추적 미적용',tracking_id:null,mode:null,requests:0}]};
 app.all(/^\/api\/.*/,(req,res)=>{const p=req.path.slice(4);if(p==='/me')return res.json({email:'owner@example.test'});if(p==='/state')return res.json(state);if(p==='/connections')return res.json({gmail:{connected:true},instagram:{}});if(p==='/email-tracking')return res.json({policy:{enabled:false,retention_days:30},activationApproved:false,provider:'Gmail',campaigns:[]});if(p==='/email-tracking/report')return res.json({...report,includeAutomated:req.query.includeAutomated==='true'});if(p==='/email-tracking/messages/'+outId)return res.json(row);return res.status(404).json({error:'missing'});});app.use('/app',express.static('private/ui'));const server=app.listen(0,'127.0.0.1');let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[],pixels=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/email-events/pixel/'))pixels.push(r.url());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/#emailtracking');await page.waitForSelector('#tracking-report table');assert.match(await page.locator('#app').textContent(),/운영 활성화 승인 전/);assert.match(await page.locator('#tracking-report .stats .stat').first().textContent(),/사람의 회신율/);assert.match(await page.locator('#tracking-report').textContent(),/추적 미적용/);assert.match(await page.locator('#tracking-report').textContent(),/수신자별 구분 불가/);
 await page.locator('[data-action=tracking-detail]').first().click();await page.waitForSelector('#modal[open]');assert.match(await page.locator('#modal').textContent(),/이미지 요청 횟수 3회/);assert.match(await page.locator('#modal').textContent(),/해당 발송건 직접 귀속 미확인/);assert.match(await page.locator('#modal').textContent(),/사전 로딩/);assert.equal(pixels.length,0);
 await page.screenshot({path:'/tmp/sanji-tracking-detail-review.png',fullPage:true});await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/sanji-tracking-mobile-review.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test('Human replies outrank images and exclude auto replies; direct reply and conversation attribution remain separate',async()=>{
 const f=await setup();try{
 const out=await f.addOutbox();await f.register(out);await f.db.query("update sanji_outbox set status='accepted'");
 const sent={out:true,messageId:'<'+out.d.messageId+'@sanji.local>',at:new Date().toISOString()};
 const reply={out:false,automatic:true,at:new Date(Date.now()+1000).toISOString(),inReplyTo:sent.messageId};
 const record={target,channel:'email',classification:'관심 회신',messages:[sent,reply]};
 const id=(await f.db.query("insert into sanji_records(owner,kind,data) values($1,'thread',$2::jsonb) returning id",[owner,JSON.stringify(record)])).rows[0].id;
 assert.equal((await f.report()).summary.replied_targets,0);
 reply.automatic=false;await f.db.query('update sanji_records set data=$1::jsonb where id=$2',[JSON.stringify(record),id]);let r=await f.report();assert.equal(r.summary.replied_targets,1);assert.equal(r.summary.positive_targets,1);assert.equal(r.rows[0].human_reply,true);
 delete reply.inReplyTo;await f.db.query('update sanji_records set data=$1::jsonb where id=$2',[JSON.stringify(record),id]);r=await f.report();assert.equal(r.rows[0].human_reply,false);assert.equal(r.rows[0].conversation_reply,true);assert.equal(r.summary.estimated,0);
 }finally{await f.db.close();}
});
test('explicit operational activation appends the approved notice once after the original body and respects per-message opt-out',async()=>{
 const campaign={id:'campaign',scope:'brand',enabled:true,disclosure,basis_note:'운영자의 신규 메일 활성화 승인',external_tracking:false};
 class Q{constructor(t){this.t=t;}select(){return this;}eq(){return this;}order(){return Promise.resolve([campaign]);}maybeSingle(){return Promise.resolve({enabled:true,version:1,retention_days:30});}}
 const service=tracking.emailTrackingService({sb:{from:t=>new Q(t)},query:x=>x,env:n=>n==='EMAIL_TRACKING_ACTIVATION_APPROVED'?'true':'false',audit:async()=>{},baseUrl:'https://project.supabase.co/functions/v1/bright-function'}),original='내 본문\n\n내 서명';
 const r=await service.withNotice(owner,{channel:'email'},original,'brand');assert.equal(r.body,original+'\n\n'+disclosure);assert.equal(r.input.trackingRequested,true);assert.equal((await service.withNotice(owner,r.input,r.body,'brand')).body,r.body);assert.equal((await service.withNotice(owner,{channel:'email',trackingRequested:false},original,'brand')).body,original);
});
