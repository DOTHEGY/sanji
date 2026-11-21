const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8'),decl=source.slice(source.indexOf('const routes ='),source.indexOf('const statuses =')),render=source.slice(source.indexOf('function render() {'),source.indexOf('function dashboardExistingSummary(')),panel=source.slice(source.indexOf('function youtubeEmailPanel()'),source.indexOf('async function discoveryPage()',source.indexOf('function youtubeEmailPanel()')));
function navContext(raw='#brands',feature=true,reader){
 const n={innerHTML:''},bread={},label={},copy={},calls=[],nodes={'#nav':n,'#breadcrumb':bread,'#private-youtube-menu-label':label,'#private-youtube-copy-label':copy};
 const routes=['youtube-primary','youtube-private','copy','brands','settings','templates','inbox','deals','emailtracking'];
 const c={YOUTUBE_DISCOVERY_AVAILABLE:feature,location:{hash:raw,pathname:'/workspace/',search:''},history:{replaceState(_a,_b,url){c.location.hash=url.slice(url.indexOf('#'));}},
  me:{id:'fixture-owner'},manualNotesView:null,inboxRequestGeneration:0,inboxLifecycle:'active',catalogSheetSettingsDispose(){},inboxNotesDispose(){},
  syncYoutubeEmailHost(key){calls.push('host:'+key);},dashboard(){calls.push('page:dashboard');},pages:Object.fromEntries(routes.map(key=>[key,()=>calls.push('page:'+key)])),
  workspaceYoutubeProjectTitle:reader,$:x=>nodes[x]};
 vm.createContext(c);vm.runInContext(decl+render+';this.open=render;this.title=compactYoutubeLabel;',c);
 return {c,n,bread,label,copy,calls};
}
test('production workspace opens the existing project immediately with exactly four main menus',()=>{
 const {c,n,calls,bread}=navContext('');c.open();
 assert.equal(c.location.hash,'#youtube-primary');
 assert.deepEqual([...n.innerHTML.matchAll(/href="(#.*?)"/g)].map(m=>m[1]),['#youtube-primary','#youtube-private','#copy','#settings']);
 for(const name of ['쫀득빵','별도 YouTube 프로젝트','카피','Gmail 설정'])assert.ok(n.innerHTML.includes(name));
 assert.doesNotMatch(n.innerHTML,/브랜드 이메일|태그바이|Instagram|상품 딜|성과·추적/);
 assert.deepEqual(calls,['host:youtube-primary','page:youtube-primary']);
 assert.equal(bread.textContent,'워크스페이스 / 쫀득빵');
});
test('old supported direct links keep their routes; retired links keep prior redirect; local unsupported build unchanged',()=>{
 for(const route of ['brands','inbox','deals','emailtracking','templates','settings','youtube-private','copy']){
  const {c,calls}=navContext('#'+route);c.open();assert.equal(c.location.hash,'#'+route);
  assert.deepEqual(calls,['host:'+route,'page:'+route]);
 }
 const retired=navContext('#dashboard');retired.c.open();assert.equal(retired.c.location.hash,'#brands');
 assert.deepEqual(retired.calls,['host:brands','page:brands']);
 const local=navContext('',false);local.c.open();assert.equal(local.c.location.hash,'#brands');
 assert.match(local.n.innerHTML,/href="#brands"/);assert.match(local.n.innerHTML,/href="#inbox"/);
 assert.doesNotMatch(local.n.innerHTML,/href="#creators"|href="#matching"|태그바이|Instagram/);
});
test('private menu text uses only the current owner title and renders it as text',async()=>{
 const pending={},calls=[];
 const {c,label,copy,bread,n}=navContext('#youtube-private',true,owner=>{calls.push(owner);return new Promise(r=>pending[owner]=r);});
 c.open();assert.deepEqual(calls,['fixture-owner']);assert.doesNotMatch(n.innerHTML,/테스트홀/);
 c.me={id:'next-owner'};c.open();assert.deepEqual(calls,['fixture-owner','next-owner']);
 pending['fixture-owner']('가상지역 이전홀 웨딩');await Promise.resolve();
 assert.notEqual(label.textContent,'이전홀');
 pending['next-owner']('시험지역 테스트홀 웨딩');await Promise.resolve();
 assert.equal(label.textContent,'테스트홀');assert.equal(copy.textContent,'테스트홀');
 assert.equal(bread.textContent,'워크스페이스 / 테스트홀');
 assert.equal(c.title('<b>synthetic</b>'),'<b>synthetic</b>');
 c.me=null;c.open();assert.deepEqual(calls,['fixture-owner','next-owner']);
});
test('project-specific copy page links to real old preview without writing or implying a new copy',()=>{
 const app={innerHTML:''};
 const a=source.indexOf('function projectCopyPage()'),b=source.indexOf('const pages =',a);
 const c={me:null,privateYoutubeLabelState:null,$:()=>app,head:(title,sub)=>title+sub};
 vm.createContext(c);vm.runInContext(source.slice(a,b)+';projectCopyPage()',c);
 assert.match(app.innerHTML,/카피 보기/);assert.match(app.innerHTML,/href="#youtube-primary"/);
 assert.match(app.innerHTML,/아직 카피가 설정되지 않았습니다/);
 assert.match(app.innerHTML,/href="#templates"/);
 assert.doesNotMatch(app.innerHTML,/<form|<textarea|data-action|mailto:/);
});
test('private title query is read-only, scoped to the same member and pinned session',async()=>{
 const src=fs.readFileSync('web/supabase-api.js','utf8');
 const a=src.indexOf('export async function workspaceYoutubeProjectTitle('),b=src.indexOf('export async function workspaceApi(',a);
 const calls=[];let actor='fixture-owner',row={owner:'fixture-owner',title:'Synthetic saved title'};
 const query={select(...args){calls.push(['select',...args]);return query},eq(...args){calls.push(['eq',...args]);return query},
  setHeader(...args){calls.push(['header',...args]);return query},async maybeSingle(){return row}};
 const c={member:async()=>({user:{id:actor},access_token:'fixture-token'}),error:m=>Error(m),result:async p=>p,
  client:{from(t){calls.push(['from',t]);return query;}}};
 vm.createContext(c);vm.runInContext(src.slice(a,b).replace('export ','')+';this.read=workspaceYoutubeProjectTitle',c);
 assert.equal(await c.read('fixture-owner'),'Synthetic saved title');
 assert.deepEqual(calls,[['from','sanji_private_wedding_projects'],['select','owner,title'],['eq','owner','fixture-owner'],['header','Authorization','Bearer fixture-token']]);
 actor='other-owner';await assert.rejects(c.read('fixture-owner'));assert.equal(calls.length,4);
 actor='fixture-owner';row={owner:'other-owner',title:'Other fixture'};await assert.rejects(c.read('fixture-owner'));
});
test('YouTube panel uses the same-origin existing page, and is unavailable in unsupported builds',()=>{const c={YOUTUBE_DISCOVERY_AVAILABLE:true};vm.createContext(c);vm.runInContext(panel+';this.panel=youtubeEmailPanel;',c);assert.match(c.panel(),/<iframe[^>]+src="\.\/youtube\/"/);assert.match(c.panel(),/유튜브 크리에이터 이메일/);c.YOUTUBE_DISCOVERY_AVAILABLE=false;assert.equal(c.panel(),'');});
test('published bundle enables YouTube and links assets by matching hash',()=>{const build=fs.readFileSync('scripts/build-supabase.cjs','utf8');assert.match(build,/YouTube navigation capability marker missing/);const bundle=fs.readFileSync('public/workspace/app.js','utf8'),hash=require('node:crypto').createHash('sha256').update(bundle).digest('hex').slice(0,12);assert.ok(fs.readFileSync('public/workspace/index.html','utf8').includes('app.js?v='+hash));assert.match(fs.readFileSync('public/workspace/youtube/index.html','utf8'),/YouTube 크리에이터 이메일/)});
test('desktop and mobile email panel fits and toggles without destroying the brand draft',async()=>{const {chromium}=require('@playwright/test');const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const c={YOUTUBE_DISCOVERY_AVAILABLE:true};vm.createContext(c);vm.runInContext(panel+';this.panel=youtubeEmailPanel;',c);const css=fs.readFileSync('private/ui/style.css','utf8');for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:850}});await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main>'+c.panel()+'<textarea id="brand-draft">검토 중</textarea></main>');await page.locator('summary').first().click();assert.equal(await page.locator('iframe').count(),1);assert.equal(await page.locator('#brand-draft').inputValue(),'검토 중');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.close()}}finally{await browser.close()}});

test('brand rerender preserves YouTube frame and its unsaved contents',async()=>{const {chromium}=require('@playwright/test');const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const page=await browser.newPage();await page.setContent('<!doctype html><meta charset="utf-8"><section id="youtube-email-host" hidden></section><section id="app"></section>');await page.evaluate(code=>{window.$=q=>document.querySelector(q);window.me={email:'owner@example.test'};window.YOUTUBE_DISCOVERY_AVAILABLE=true;window.eval(code+';window.syncYoutubeEmailHost=syncYoutubeEmailHost');window.syncYoutubeEmailHost('brands');document.querySelector('iframe').srcdoc='<textarea>미저장 문안</textarea>';},panel);await page.locator('#youtube-email-host summary').click();await page.frameLocator('iframe').locator('textarea').waitFor();await page.frameLocator('iframe').locator('textarea').fill('편집 중');await page.evaluate(()=>{document.querySelector('#app').innerHTML='<p>브랜드 목록 갱신</p>';window.syncYoutubeEmailHost('brands');});assert.equal(await page.frameLocator('iframe').locator('textarea').inputValue(),'편집 중');await page.evaluate(()=>{window.syncYoutubeEmailHost('settings');window.syncYoutubeEmailHost('brands');});assert.equal(await page.frameLocator('iframe').locator('textarea').inputValue(),'편집 중');}finally{await browser.close()}});

test('new project does not create or navigate an iframe until first selection; both frames then stay mounted',async()=>{
 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:850}});
  let projectLoads=0;
  await page.route('https://sanji.example.test/**',route=>{
   if(new URL(route.request().url()).pathname==='/workspace/youtube/wedding/'){
    projectLoads++;
    return route.fulfill({contentType:'text/html',body:'<p id="new-project">Synthetic project</p>'});
   }
   return route.fulfill({contentType:'text/html',body:'<p>Mocked previous page</p>'});
  });
  const css=fs.readFileSync('private/ui/style.css','utf8');
  await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="https://sanji.example.test/workspace/"><style>'+css+'</style><section id="youtube-email-host" hidden></section><section id="app"></section>');
  await page.evaluate(code=>{
   window.$=q=>document.querySelector(q);
   window.me={email:'owner@example.test'};
   window.YOUTUBE_DISCOVERY_AVAILABLE=true;
   window.eval(code+';window.syncYoutubeEmailHost=syncYoutubeEmailHost');
   window.syncYoutubeEmailHost('brands');
   window.previousFrame=document.querySelector('#youtube-pane-existing iframe');
   window.previousFrame.srcdoc='<textarea id="draft"></textarea><div style="height:2000px"></div>';
  },panel);
  const host=page.locator('#youtube-email-host'), oldPanel=host.locator('#youtube-pane-existing'),newPanel=host.locator('#youtube-pane-empty');
  const oldTab=host.getByRole('tab',{name:'기존 프로젝트'}),newTab=host.getByRole('tab',{name:'별도 YouTube 프로젝트'});
  assert.equal(await host.locator('iframe').count(),1);
  assert.equal(await newPanel.locator('iframe').count(),0);
  assert.equal(projectLoads,0);
  await oldPanel.locator('summary').click();
  const draft=oldPanel.frameLocator('iframe').locator('#draft');
  await draft.fill('synthetic unsaved draft');
  await draft.evaluate(node=>node.ownerDocument.defaultView.scrollTo(0,150));
  assert.equal(await draft.evaluate(node=>node.ownerDocument.defaultView.scrollY),150);
  await newTab.click();
  await newPanel.frameLocator('iframe').locator('#new-project').waitFor();
  assert.equal(projectLoads,1);
  assert.equal(await host.locator('iframe').count(),2);
  assert.equal(await oldPanel.isHidden(),true);
  await page.evaluate(()=>{window.newFrame=document.querySelector('#youtube-pane-empty iframe');window.syncYoutubeEmailHost('settings');window.syncYoutubeEmailHost('brands');});
  assert.equal(await newTab.getAttribute('aria-selected'),'true');
  await newTab.press('ArrowLeft');
  assert.equal(await oldTab.getAttribute('aria-selected'),'true');
  assert.equal(await oldTab.evaluate(node=>node===document.activeElement),true);
  assert.equal(await draft.inputValue(),'synthetic unsaved draft');
  assert.equal(await draft.evaluate(node=>node.ownerDocument.defaultView.scrollY),150);
  await newTab.click();
  assert.equal(await host.locator('iframe').count(),2);
  assert.equal(projectLoads,1);
  assert.equal(await page.evaluate(()=>window.previousFrame===document.querySelector('#youtube-pane-existing iframe')&&window.newFrame===document.querySelector('#youtube-pane-empty iframe')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close()}
});

test('direct project routes mount only the selected workspace and retain both iframe documents',async()=>{
 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:850}});
  let newDocumentRequests=0;
  const css=fs.readFileSync('private/ui/style.css','utf8');
  const markup='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><aside><nav id="nav"></nav></aside><main><span id="breadcrumb"></span><section id="youtube-email-host" hidden></section><section id="app"></section></main>';
  await page.route('https://sanji.example.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/workspace/')return route.fulfill({contentType:'text/html',body:markup});
   const privateRoute=path.endsWith('/youtube/wedding/');
   if(privateRoute)newDocumentRequests++;
   return route.fulfill({contentType:'text/html',body:privateRoute?'<textarea id="private-fixture"></textarea>':'<textarea id="primary-fixture"></textarea>'});
  });
  await page.goto('https://sanji.example.test/workspace/');
  await page.evaluate(({decl,render,panel})=>{
   window.$=q=>document.querySelector(q);
   window.me={id:'fixture-owner',email:'owner@example.test'};
   window.YOUTUBE_DISCOVERY_AVAILABLE=true;
   window.inboxRequestGeneration=0;
   window.catalogSheetSettingsDispose=()=>{};
   window.inboxNotesDispose=()=>{};
   window.manualNotesView=null;
   window.pages={'youtube-primary':()=>{},'youtube-private':()=>{},settings:()=>{},copy:()=>{}};
   window.eval(decl+render+panel+';window.openWorkspace=render;');
   window.addEventListener('hashchange',()=>window.openWorkspace());
   window.openWorkspace();
  },{decl,render,panel});
  const menu=page.locator('#nav a'),host=page.locator('#youtube-email-host');
  const oldPane=host.locator('#youtube-pane-existing'),newPane=host.locator('#youtube-pane-empty');
  const oldDraft=oldPane.frameLocator('iframe').locator('#primary-fixture');
  assert.equal(await menu.count(),4);
  assert.equal(await menu.nth(0).getAttribute('aria-current'),'page');
  assert.equal(await oldPane.locator('details').evaluate(node=>node.open),true);
  assert.equal(await host.locator('[role=tablist]').isHidden(),true);
  assert.equal(await newPane.locator('iframe').count(),0);
  await oldDraft.fill('primary unsaved');
  await menu.nth(1).click();
  const newDraft=newPane.frameLocator('iframe').locator('#private-fixture');
  await newDraft.fill('private unsaved');
  assert.equal(newDocumentRequests,1);
  await menu.nth(3).click();
  await page.waitForURL('**/#settings',{timeout:5000});
  await host.waitFor({state:'hidden',timeout:5000});
  assert.equal(await menu.nth(3).getAttribute('aria-current'),'page');
  assert.equal(await host.isHidden(),true);
  await menu.nth(0).click();
  await page.waitForURL('**/#youtube-primary',{timeout:5000});
  await oldPane.waitFor({state:'visible',timeout:5000});
  assert.equal(await oldDraft.inputValue(),'primary unsaved');
  await menu.nth(1).click();
  await page.waitForURL('**/#youtube-private',{timeout:5000});
  await newPane.waitFor({state:'visible',timeout:5000});
  assert.equal(await newDraft.inputValue(),'private unsaved');
  assert.equal(newDocumentRequests,1);
  await page.evaluate(()=>{window.me={id:'new-fixture-owner',email:'new@example.test'};window.openWorkspace();});
  assert.equal(await newDraft.inputValue(),'');
  assert.equal(newDocumentRequests,2);
  await menu.nth(0).click();
  assert.equal(await oldDraft.inputValue(),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close()}
});
