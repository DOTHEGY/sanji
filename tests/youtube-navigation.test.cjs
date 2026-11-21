const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8'),decl=source.slice(source.indexOf('const routes ='),source.indexOf('const statuses =')),render=source.slice(source.indexOf('function render() {'),source.indexOf('function dashboardExistingSummary(')),panel=source.slice(source.indexOf('function youtubeEmailPanel()'),source.indexOf('async function discoveryPage()',source.indexOf('function youtubeEmailPanel()')));
function nav(key='brands'){const n={innerHTML:''},b={},c={YOUTUBE_DISCOVERY_AVAILABLE:true,location:{hash:'#'+key},me:{id:'owner'},manualNotesView:null,inboxRequestGeneration:0,inboxLifecycle:'active',catalogSheetSettingsDispose(){},inboxNotesDispose(){},syncYoutubeEmailHost(){},dashboard(){},pages:{},$:x=>x==='#nav'?n:b};vm.createContext(c);vm.runInContext(decl+render+';render()',c);return n.innerHTML;}
test('email navigation hides DM while retaining the email inbox',()=>{const html=nav();assert.match(html,/href="#brands"/);assert.match(html,/브랜드 이메일/);assert.match(html,/href="#inbox"/);assert.doesNotMatch(html,/href="#creators"|href="#matching"|태그바이|Instagram/)});
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
