'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

test('release test command includes every manual, transient and draft review suite',()=>{
 const args=new Set(pkg.scripts.test.split(/\s+/));
 const files=fs.readdirSync('tests').filter(name=>/^(instagram-(manual|transient|reviewed|reply-policy)|prepare-transient-product-projection).*\.test\.cjs$/.test(name));
 for(const file of files)assert.ok(args.has('tests/'+file),'Missing release suite: '+file);
 assert.ok(args.has('--test-concurrency=1'),'Embedded SQL suites must run serially');
});

test('aggregate build includes isolated function and CI enables real browser fixtures',()=>{
 assert.match(pkg.scripts['build:supabase'],/node scripts\/bundle-instagram-manual\.cjs/);
 const workflow=fs.readFileSync('.github/workflows/test.yml','utf8');
 assert.match(workflow,/export SANJI_BROWSER_TEST=1\s+npm test/);
 for(const file of ['tests/instagram-transient-browser.test.cjs','tests/instagram-transient-products-browser.test.cjs']){
  const source=fs.readFileSync(file,'utf8');
  assert.match(source,/process\.env\.CHROMIUM_PATH\|\|chromium\.executablePath\(\)/);
  assert.doesNotMatch(source,/--no-sandbox/);
 }
});

test('compact inbox browser fixture defines capability globals before evaluating the real inbox',async()=>{
 const fixture=fs.readFileSync('tests/inbox-compact-ui.test.cjs','utf8');
 const marker='await page.evaluate(async code=>{';
 const start=fixture.indexOf(marker),end=fixture.indexOf('},source.slice(a,b));',start);
 assert.ok(start>=0&&end>start);
 const setup=fixture.slice(start+marker.length,end);
 const source=fs.readFileSync('private/ui/app.js','utf8');
 const a=source.indexOf('async function inboxPage()'),b=source.indexOf('function filterThreads()',a);
 const app={innerHTML:''};
 const context={document:{querySelector:()=>app},location:{hash:'#inbox'},Date,console};
 context.window=context;
 vm.createContext(context);
 context.eval=code=>vm.runInContext(code,context);
 const initialize=vm.runInContext('(async function(code){'+setup+'})',context);
 await initialize(source.slice(a,b));
 assert.equal(context.TRANSIENT_INBOX_AVAILABLE,false);
 assert.equal(typeof context.inboxNotesDispose,'function');
 assert.equal(typeof context.inboxNotesMount,'function');
 assert.match(app.innerHTML,/Instagram 대화 더 보기/);
 assert.match(app.innerHTML,/Instagram 이전 기록/);
});

test('deployed migration preserves reviewed schema and isolated function requires JWTs',()=>{
 const proposal=fs.readFileSync('supabase/proposals/instagram_manual_inbox.sql','utf8');
 const migration=fs.readFileSync('supabase/migrations/20261104013223_instagram_manual_inbox_durable.sql','utf8');
 assert.equal(migration.trim(),proposal.replace('begin;',"begin;\nset local lock_timeout = '3s';\nset local statement_timeout = '30s';").trim());
 const config=fs.readFileSync('supabase/config.toml','utf8');
 assert.match(config,/\[functions\.instagram-manual-inbox\][\s\S]*verify_jwt = true/);
});
