const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8'),decl=source.slice(source.indexOf('const routes ='),source.indexOf('const statuses =')),render=source.slice(source.indexOf('function render() {'),source.indexOf('function dashboardExistingSummary(')),panel=source.slice(source.indexOf('let youtubeWorkspaceOwner='),source.indexOf('async function discoveryPage()',source.indexOf('let youtubeWorkspaceOwner=')));
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
test('project-specific copy requires login and offers only two collapsed project panels',async()=>{
 const app={innerHTML:''},host={isConnected:true};
 const a=source.indexOf('let projectCopyView ='),b=source.indexOf('const pages =',a);
 const c={me:null,location:{hash:'#copy'},PROJECT_COPY_PURPOSE:'youtube_project_copy_primary',WEDDING_COPY_PURPOSE:'youtube_project_copy_wedding',privateYoutubeLabelState:null,$:selector=>selector==='#app'?app:host,head:(title,sub)=>title+sub};
 vm.createContext(c);vm.runInContext(source.slice(a,b)+';this.showCopy=projectCopyPage;',c);
 let reads=0;c.workspacePrimaryProjectCopy=async()=>{reads++;return {rows:[]}};
 await c.showCopy();assert.equal(app.innerHTML,'');assert.equal(reads,0);
 c.me={id:'owner-fixture'};await c.showCopy();assert.equal(reads,1);
 assert.equal([...app.innerHTML.matchAll(/<details class="panel"><summary(?: id="private-youtube-copy-label")?>([^<]+)<\/summary>/g)].map(m=>m[1]).join(','),'쫀득빵,별도 YouTube 프로젝트');
 assert.match(app.innerHTML,/id="youtube-wedding-copy"/);
 assert.match(host.textContent,/아직 기본 카피가 설정되지 않았습니다/);
 assert.doesNotMatch(app.innerHTML,/<details[^>]*\bopen\b|<a\b|<button|<form|<textarea|data-action|mailto:/);
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
test('native project panel only mounts after selecting a signed-in project and clears the old owner',()=>{
 const calls=[];
 const host={hidden:true,children:[],ownerDocument:{createElement(){return {dataset:{},hidden:false}}},replaceChildren(){this.children=[]},append(node){this.children.push(node)}};
 const c={YOUTUBE_DISCOVERY_AVAILABLE:true,me:null,AbortController,$:()=>host,
  mountYouTubeDiscovery:mount('primary'),mountYouTubeWedding:mount('private')};
 function mount(name){return (node,{owner,signal})=>{calls.push([name,owner,signal]);return ()=>calls.push(['cleanup',name]);}};
 vm.createContext(c);vm.runInContext(panel+';this.select=syncYoutubeEmailHost;this.dispose=disposeYoutubeWorkspace;',c);
 c.select('youtube-primary');assert.equal(host.hidden,true);assert.equal(calls.length,0);
 c.me={id:'owner-a'};c.select('brands');assert.equal(host.hidden,true);assert.equal(calls.length,0);
 c.select('youtube-primary');assert.equal(host.hidden,false);assert.equal(calls.length,1);
 const primary=host.children[0];
 c.select('youtube-private');const wedding=host.children[1];assert.equal(primary.hidden,true);assert.equal(wedding.hidden,false);assert.equal(calls.length,2);
 c.select('settings');assert.equal(host.hidden,true);
 c.select('youtube-primary');assert.equal(primary.hidden,false);assert.equal(wedding.hidden,true);assert.equal(calls.length,2);
 assert.equal(host.children[0],primary);
 c.me={id:'owner-b'};c.select('youtube-private');assert.equal(host.children.length,1);
 assert.ok(calls[0][2].aborted&&calls[1][2].aborted);
 assert.deepEqual(calls.slice(2).map(x=>x.slice(0,2)),[['cleanup','primary'],['cleanup','private'],['private','owner-b']]);
 c.dispose();assert.equal(host.children.length,0);assert.equal(host.hidden,true);
 c.YOUTUBE_DISCOVERY_AVAILABLE=false;c.select('youtube-private');assert.equal(host.children.length,0);
});
test('published bundle enables YouTube and links assets by matching hash',()=>{const build=fs.readFileSync('scripts/build-supabase.cjs','utf8');assert.match(build,/YouTube navigation capability marker missing/);const bundle=fs.readFileSync('public/workspace/app.js','utf8'),hash=require('node:crypto').createHash('sha256').update(bundle).digest('hex').slice(0,12);assert.ok(fs.readFileSync('public/workspace/index.html','utf8').includes('app.js?v='+hash));assert.match(fs.readFileSync('public/workspace/youtube/index.html','utf8'),/YouTube 크리에이터 이메일/)});
test('desktop and mobile navigate the native projects without a nested page and preserve unsaved values',async()=>{
 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const css=fs.readFileSync('private/ui/style.css','utf8');
  const markup='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><aside><nav id="nav"></nav></aside><main><span id="breadcrumb"></span><section id="youtube-email-host" hidden></section><section id="app"></section></main>';
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:850}});
   let documentRequests=0;
   await page.route('https://sanji.example.test/**',route=>{if(route.request().resourceType()==='document')documentRequests++;return route.fulfill({contentType:'text/html',body:markup});});
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
    window.mounts=[];
    function mount(kind){return (root,{owner,signal})=>{
     const input=document.createElement('textarea');input.setAttribute('aria-label',kind+' fixture');root.append(input);
     window.mounts.push({kind,owner,signal});return ()=>root.replaceChildren();
    };}
    window.mountYouTubeDiscovery=mount('primary');window.mountYouTubeWedding=mount('private');
    window.eval(decl+render+panel+';window.openWorkspace=render;');
    window.addEventListener('hashchange',()=>window.openWorkspace());
    window.openWorkspace();
   },{decl,render,panel});
   const nav=page.locator('#nav a'),host=page.locator('#youtube-email-host');
   const primary=host.getByRole('textbox',{name:'primary fixture'}),wedding=host.getByRole('textbox',{name:'private fixture'});
   assert.equal(await nav.count(),4);
   assert.equal(await nav.nth(0).getAttribute('aria-current'),'page');
   assert.equal(await host.locator('[data-youtube-project]').count(),1);
   await primary.fill('primary unsaved');
   await nav.nth(1).click();
   await page.waitForURL('**/#youtube-private');
   await wedding.fill('private unsaved');
   await nav.nth(3).click();
   await page.waitForURL('**/#settings');await host.waitFor({state:'hidden'});
   await nav.nth(0).click();
   await page.waitForURL('**/#youtube-primary');await primary.waitFor();assert.equal(await primary.inputValue(),'primary unsaved');
   await nav.nth(1).click();
   await page.waitForURL('**/#youtube-private');await wedding.waitFor();assert.equal(await wedding.inputValue(),'private unsaved');
   assert.equal(await page.locator('iframe').count(),0);
   assert.equal(documentRequests,1);
   await page.evaluate(()=>{window.me={id:'new-fixture-owner'};window.openWorkspace();});
   await wedding.waitFor();assert.equal(await wedding.inputValue(),'');
   assert.deepEqual(await page.evaluate(()=>window.mounts.map(({kind,owner,signal})=>[kind,owner,signal.aborted])),[['primary','fixture-owner',true],['private','fixture-owner',true],['private','new-fixture-owner',false]]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.close();
  }
 }finally{await browser.close()}
});

test('basic project copy displays only the selected owner library slot as exact inert text',async()=>{
 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:850}});
  await page.route('https://sanji.example.test/workspace/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="app"></div>'}));
  await page.goto('https://sanji.example.test/workspace/#copy');
  const copy=source.slice(source.indexOf('let projectCopyView ='),source.indexOf('\nconst pages = {'));
  await page.evaluate(code=>{
   Object.assign(window,{$:s=>document.querySelector(s),me:{id:'owner-fixture'},privateYoutubeLabelState:null,PROJECT_COPY_PURPOSE:'youtube_project_copy_primary',WEDDING_COPY_PURPOSE:'youtube_project_copy_wedding',head:()=>'<h1>카피</h1>'});
   window.eval(code+';window.openCopy=projectCopyPage;window.hideCopy=clearProjectCopyView;');
  },copy);
  const display=page.locator('#youtube-primary-copy');
  const subject='[채널명] 예시 제목',body=' 첫 줄  \r\n\r\n[채널명] <img src=x onerror=alert(1)> & 마지막 줄  ';
  await page.evaluate(async({subject,body})=>{
   const row={archived:false,data:{purpose:window.PROJECT_COPY_PURPOSE,channel:'이메일',subject,body}};
   window.fixtureRow=row;
   window.workspacePrimaryProjectCopy=async(owner,current)=>{
    if(owner!=='owner-fixture'||!current())throw Error('owner');
    return {rows:[{archived:false,data:{...row.data,purpose:'creator_proposal',subject:'다른 용도'}},{...row,archived:true},row]};
   };await window.openCopy();
  },{subject,body});
  const panels=page.locator('#app details');
  assert.equal(await panels.count(),2);
  assert.deepEqual(await panels.locator('summary').allTextContents(),['쫀득빵','별도 YouTube 프로젝트']);
  assert.equal(await display.isHidden(),true);
  await panels.nth(0).locator('summary').click();
  assert.equal(await display.isVisible(),true);
  assert.equal(await panels.nth(1).evaluate(node=>node.open),false);
  assert.deepEqual(await display.locator('.message').allTextContents(),[subject,body]);
  await panels.nth(0).locator('summary').click();
  assert.equal(await display.isHidden(),true);
  await panels.nth(1).locator('summary').click();
  assert.match(await page.locator('#youtube-wedding-copy').innerText(),/아직 기본 카피가 설정되지/);
  assert.equal(await page.locator('#app a').count(),0);
  assert.equal(await display.locator('img, a, form, button').count(),0);
  assert.equal(await page.locator('#app button, #app form').count(),0);
  await page.evaluate(()=>window.hideCopy('계정 변경'));
  assert.equal(await display.textContent(),'계정 변경');
  await page.evaluate(async()=>{let finish;window.workspacePrimaryProjectCopy=()=>new Promise(resolve=>finish=resolve);const pending=window.openCopy();window.me={id:'new-owner'};finish({rows:[window.fixtureRow]});await pending;});
  assert.equal(await display.locator('.message').count(),0);
  await page.evaluate(async()=>{let finish;history.pushState(null,'','#copy');window.workspacePrimaryProjectCopy=()=>new Promise(resolve=>finish=resolve);const pending=window.openCopy();history.pushState(null,'','#settings');finish({rows:[window.fixtureRow]});await pending;});
  assert.equal(await display.locator('.message').count(),0);
  await page.evaluate(async()=>{history.pushState(null,'','#copy');window.workspacePrimaryProjectCopy=async()=>({rows:[window.fixtureRow,window.fixtureRow]});await window.openCopy();});
  assert.match(await display.textContent(),/확인하지 못했습니다/);
  await page.evaluate(async()=>{window.workspacePrimaryProjectCopy=async()=>({rows:[]});await window.openCopy();});
  assert.match(await display.textContent(),/아직 기본 카피가 설정되지/);
 }finally{await browser.close()}
});

test('project copy uses verbatim text instead of HTML and fails closed on stale or ambiguous reads',async()=>{
 const script=source.slice(source.indexOf('let projectCopyView ='),source.indexOf('\nconst pages = {'));
 const app={},host={isConnected:true,ownerDocument:{createElement:tag=>({tag})},removeAttribute(){},replaceChildren(...nodes){this.nodes=nodes}},wedding={...host};
 const c={me:{id:'a'},location:{hash:'#copy'},PROJECT_COPY_PURPOSE:'youtube_project_copy_primary',WEDDING_COPY_PURPOSE:'youtube_project_copy_wedding',privateYoutubeLabelState:null,head:()=>'',$:selector=>selector==='#app'?app:selector==='#youtube-primary-copy'?host:wedding};
 vm.createContext(c);vm.runInContext(script+';this.openCopy=projectCopyPage;',c);
 const row={archived:false,data:{purpose:'youtube_project_copy_primary',channel:'이메일',subject:'[채널명] 테스트',body:'  본문\r\n\r\n<img src=x> [채널명]  '}};
 c.workspacePrimaryProjectCopy=async(owner,active)=>{assert.equal(owner,'a');assert.equal(active(),true);return {rows:[row]}};
 await c.openCopy();
 assert.equal(host.nodes[1].textContent,row.data.subject);assert.equal(host.nodes[3].textContent,row.data.body);
 assert.equal(host.nodes[3].innerHTML,undefined);
 c.workspacePrimaryProjectCopy=async()=>({rows:[row,row]});await c.openCopy();assert.match(host.textContent,/확인하지 못했습니다/);
 delete host.nodes;let finish;
 c.workspacePrimaryProjectCopy=()=>new Promise(resolve=>finish=resolve);
 const pending=c.openCopy();c.me={id:'b'};finish({rows:[row]});await pending;assert.equal(host.nodes,undefined);
});

test('built workspace routes both real project panels and the private copy without a document load or outbound writes',async()=>{
 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const origin='https://workspace.test',owner='a2abaa22-5b41-4fb7-9966-45e24f08bf3a';
  const user={id:owner,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
  const exp=Math.floor(Date.now()/1000)+3600;
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:owner,exp,aud:'authenticated'}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture';
  const session={access_token:jwt,refresh_token:'fixture-only',expires_at:exp,expires_in:3600,token_type:'bearer',user};
  const subject='[채널명] / synthetic saved subject';
  const body='  [채널명] original\n\nfixture  ';
  const page=await browser.newPage({viewport:{width:390,height:880}});
  await page.addInitScript(({session})=>localStorage.setItem('sb-ofasbfpeapbdcotnptvz-auth-token',JSON.stringify(session)),{session});
  const documentRequests=[],writes=[],partyumRead=[],recoveryRead=[];
  const channels=['UC'+'A'.repeat(22),'UC'+'B'.repeat(22),'UC'+'C'.repeat(22)];
  const dates=['2026-11-21','2026-11-22','2026-11-22'];
  const shortlist=channels.map((channel_id,i)=>({owner,channel_id,video_id:'ZXCVbnm1234',channel_name:'Fixture Channel '+i,evidence_note:'Test evidence',project_day:dates[i],added_at:'2026-11-23T01:00:00Z'}));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(req.resourceType()==='document')documentRequests.push(path);
   if(url.origin===origin){
    const files={'/workspace/':['public/workspace/index.html','text/html'], '/workspace/app.js':['public/workspace/app.js','text/javascript'], '/workspace/style.css':['public/workspace/style.css','text/css']};
    if(files[path])return route.fulfill({contentType:files[path][1],body:fs.readFileSync(files[path][0],'utf8')});
    return route.fulfill({status:404,body:'unexpected page asset'});
   }
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'*'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.hostname!=='ofasbfpeapbdcotnptvz.supabase.co')return route.abort();
   if(req.method()==='POST'&&path==='/functions/v1/youtube-wedding-mail'){
    let data;
    try{data=req.postDataJSON();}catch{}
    if(data?.action==='recovery_availability'&&data.projectId==='private-wedding-research'&&Object.keys(data).length===2){
     recoveryRead.push(data);
     return route.fulfill({headers,json:{available:false}});
    }
   }
   const readPosts=['/rest/v1/rpc/sanji_is_member','/rest/v1/rpc/sanji_connection_status','/functions/v1/youtube-manual-mail/recent','/functions/v1/youtube-wedding-day-status'];
   if(req.method()!=='GET'&&!readPosts.includes(path)){writes.push(path);return route.fulfill({status:400,headers,json:{error:'unexpected write'}})}
   let response=[];
   if(path==='/auth/v1/user')response=user;
   else if(path==='/rest/v1/sanji_members')response=[{user_id:owner}];
   else if(path==='/rest/v1/rpc/sanji_is_member')response=true;
   else if(path==='/rest/v1/rpc/sanji_connection_status')response={gmail:null,instagram:null};
   else if(path==='/rest/v1/sanji_private_wedding_projects')response=[{owner,title:'샘플 지역 테스트홀 웨딩'}];
   else if(path==='/rest/v1/sanji_private_wedding_shortlist')response=shortlist;
   else if(path==='/rest/v1/sanji_private_wedding_contacts')response=channels.map((channel_id,i)=>({owner,channel_id,email:'channel'+i+'@example.test',source_url:'https://www.youtube.com/channel/'+channel_id,source_kind:'official_channel',verified_at:'2026-11-20T01:00:00Z',expires_at:'2031-12-01T01:00:00Z'}));
   else if(path==='/functions/v1/youtube-wedding-day-status'){
     const scope=req.postDataJSON();
     partyumRead.push(scope);
     assert.equal(scope.projectId,'private-wedding-research');
     const outcome=['found_only','scheduled','sent'];
     response={projectId:scope.projectId,day:scope.day,items:scope.channelIds.map(channelId=>{
       const i=channels.indexOf(channelId);
       return {channelId,status:outcome[i],at:i===0?null:'2026-11-24T01:00:00Z',completeForCandidate:true,
         subscriberEligibility:i===2?'below_minimum':'eligible',subscriberCount:[50000,50100,49900][i]};
     })};
   }
   else if(path.endsWith('/template-library'))response={rows:[{archived:false,data:{purpose:'youtube_project_copy_primary',channel:'이메일',subject,body}},{archived:false,data:{purpose:'youtube_project_copy_wedding',channel:'이메일',subject:'가상 웨딩 카피 제목',body:'가상 웨딩 원문 <img src=x>'}}]};
   else if(path.endsWith('/recent'))response={rows:[],more:false};
   else if(path.endsWith('/schedule-status'))response={jobs:[]};
   else if(path.endsWith('/connections'))response={gmail:{connected:false,enabled:false,reauthRequired:false},instagram:{connected:false,enabled:false}};
   else if(path.startsWith('/functions/v1/'))response={};
   return route.fulfill({headers,json:response});
  });
  await page.goto(origin+'/workspace/');
  const host=page.locator('#youtube-email-host'),primary=host.locator('[data-youtube-project="youtube-primary"]'),nav=page.locator('#nav a');
  try{await primary.locator('#workspace').waitFor({timeout:12000});}
  catch(e){throw new Error(`Workspace boot fixture: ${(await page.locator('#toast,#connection-banner,#app').allTextContents()).join(' | ').slice(0,1000)}`,{cause:e});}
  await primary.getByText('최근 이메일 발송 상태',{exact:true}).waitFor({timeout:12000});
  const recoveryResponse=page.waitForResponse(resp=>new URL(resp.url()).pathname==='/functions/v1/youtube-wedding-mail'&&
   resp.request().method()==='POST',{timeout:12000});
  await nav.nth(1).click();
  const wedding=host.locator('[data-youtube-project="youtube-private"]');
  await wedding.locator('#wedding-panel').waitFor({timeout:12000});
  assert.equal((await recoveryResponse).status(),200);
  assert.equal(await wedding.locator('#wedding-optional-recovery').isHidden(),true);
  assert.equal(await wedding.locator('#wedding-heading').textContent(),'샘플 지역 테스트홀 웨딩');
  await wedding.locator('.creator-mail-scheduled').waitFor({timeout:12000});
  const sent=wedding.locator('.creator-mail-sent');
  assert.equal(await sent.count(),1);
  assert.equal(await sent.isHidden(),true);
  await wedding.locator('.creator-history > summary').click();
  await sent.waitFor({timeout:12000});
  assert.deepEqual(await wedding.locator('.creator-project-day h4').allTextContents(),['2026-11-22 · 발굴일 (KST)','2026-11-21 · 발굴일 (KST)']);
  assert.equal(await wedding.locator('.creator-mail-scheduled').textContent(),'발송 예약');
  assert.equal(await wedding.locator('.creator-mail-found_only').textContent(),'찾기만 함');
  assert.equal(await wedding.locator('.creator-mail-sent').textContent(),'발송 완료');
  assert.equal(partyumRead.length,2);
  await wedding.locator('#wedding-copy-panel summary').click();
  const weddingInline=wedding.locator('#wedding-copy-panel .message');
  await weddingInline.first().waitFor({timeout:12000});
  assert.deepEqual(await weddingInline.allTextContents(),['가상 웨딩 카피 제목','가상 웨딩 원문 <img src=x>']);
  assert.equal(await wedding.locator('#wedding-copy-panel img').count(),0);
  assert.equal(await primary.isHidden(),true);
  await nav.nth(2).click();await page.locator('#app summary').first().click();
  const saved=page.locator('#youtube-primary-copy .message');
  await saved.first().waitFor({timeout:12000});
  assert.deepEqual(await saved.allTextContents(),[subject,body]);
  await page.locator('#private-youtube-copy-label').click();
  const weddingCopy=page.locator('#youtube-wedding-copy .message');
  await weddingCopy.first().waitFor({timeout:12000});
  assert.deepEqual(await weddingCopy.allTextContents(),['가상 웨딩 카피 제목','가상 웨딩 원문 <img src=x>']);
  assert.equal(await page.locator('#app a').count(),0);
  assert.equal(await host.isHidden(),true);
  await nav.nth(0).click();await primary.locator('#workspace').waitFor({timeout:12000});
  assert.equal(await wedding.isHidden(),true);
  assert.equal(await host.locator('iframe').count(),0);
  assert.deepEqual(documentRequests,['/workspace/']);
  assert.deepEqual(recoveryRead,[{action:'recovery_availability',projectId:'private-wedding-research'}]);
  assert.deepEqual(writes,[]);
 }finally{await browser.close()}
});

test('a stale BFCache session check cannot log out a newer workspace account',async()=>{
 const start=source.indexOf("window.addEventListener('pageshow',event=>{",source.indexOf("boot();\nwindow.addEventListener('pagehide'"));
 const end=source.indexOf('if(typeof manualClient',start);
 const callbacks={};let reject,resolve,auth=0,renders=0;
 const c={YOUTUBE_DISCOVERY_AVAILABLE:true,me:{id:'same-id'},youtubeIdentityEpoch:0,youtubeBlockedOwner:null,
  window:{addEventListener:(name,callback)=>{callbacks[name]=callback}},
  manualClient:{auth:{getSession:()=>new Promise((a,b)=>{resolve=a;reject=b})}},authPage:()=>{auth++;},render:()=>{renders++;}};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 callbacks.pageshow({persisted:true});await Promise.resolve();
 c.me={id:'same-id'};reject(Error('former account transport error'));
 await new Promise(r=>setImmediate(r));assert.equal(auth,0);
 callbacks.pageshow({persisted:true});await Promise.resolve();
 resolve({data:{session:{user:{id:'same-id'}}}});
 await new Promise(r=>setImmediate(r));assert.equal(renders,1);
});
