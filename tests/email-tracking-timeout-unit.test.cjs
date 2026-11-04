const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8');
const functions=source.slice(source.indexOf('let trackingReportRequest=0;'),source.indexOf('function trackingCampaignForm'));
function fixture(){
 const app={innerHTML:'settings retained'},report={innerHTML:'',isConnected:true},details={open:false};
 const form={isConnected:true,values:{days:'30'},closest:()=>details};
 const pending=[],requests=[];
 const context=vm.createContext({
  $:selector=>({'#app':app,'#tracking-report':report,'#tracking-report-form':form})[selector],
  FormData:class{constructor(f){this.values={...f.values};}get(k){return this.values[k]||'';}has(k){return Object.hasOwn(this.values,k);}},
  Date,URLSearchParams,Number,String,Error,
  api:(url,method='GET')=>{requests.push({url,method});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  head:()=>'',field:()=>'',button:()=>'',tag:value=>value,targetName:value=>value,localTime:value=>value,
  trackingPercent:()=>'',trackingCaveat:'limits',trackingSelectedTarget:'',trackingSelectedCampaign:'',
  data:{candidates:[]},upcomingMeetings:()=>''
 });
 vm.runInContext(functions,context);
 return {context,app,report,form,details,pending,requests};
}
const result={summary:{sent:1,sent_targets:1},rows:[]};
test('tracking report timeout retains settings and retries with selected days',async()=>{
 const f=fixture(),first=f.context.trackingLoadReport(f.form);f.pending.shift().reject(Error('canceling statement due to statement timeout'));await first;
 assert.match(f.report.innerHTML,/조회 시간이 초과/);assert.doesNotMatch(f.report.innerHTML,/아직 적용되지/);assert.equal(f.app.innerHTML,'settings retained');assert.equal(f.details.open,true);
 f.form.values.days='7';const second=f.context.trackingLoadReport(f.form);f.pending.shift().resolve(result);await second;
 assert.match(f.report.innerHTML,/최근 7일/);assert.doesNotMatch(f.report.innerHTML,/조회 시간이 초과/);assert.equal(f.requests.length,2);assert.ok(f.requests.every(r=>r.method==='GET'));
});
test('tracking report generic errors do not invent missing infrastructure or expose raw HTML',async()=>{
 const f=fixture(),request=f.context.trackingLoadReport(f.form);f.pending.shift().reject(Error('<img src=x onerror=alert(1)>'));await request;
 assert.match(f.report.innerHTML,/조회에 실패했습니다/);assert.doesNotMatch(f.report.innerHTML,/아직 적용되지|조회 시간이 초과|onerror/);
});
test('older report successes and errors cannot replace newer results',async()=>{
 for(const fail of [false,true]){
  const f=fixture(),old=f.context.trackingLoadReport(f.form),oldRequest=f.pending.shift();f.form.values.days='7';const latest=f.context.trackingLoadReport(f.form);f.pending.shift().resolve(result);await latest;const expected=f.report.innerHTML;
  if(fail)oldRequest.reject(Error('statement timeout'));else oldRequest.resolve({...result,summary:{sent:999,sent_targets:999}});await old;
  assert.equal(f.report.innerHTML,expected);assert.match(f.report.innerHTML,/최근 7일/);assert.doesNotMatch(f.report.innerHTML,/999/);
 }
});
test('departed report cannot render stale success or failure after navigation',async()=>{
 for(const fail of [false,true]){
  const f=fixture(),request=f.context.trackingLoadReport(f.form);f.form.isConnected=false;f.report.isConnected=false;f.report.innerHTML='detached';
  if(fail)f.pending.shift().reject(Error('statement timeout'));else f.pending.shift().resolve(result);await request;
  assert.equal(f.report.innerHTML,'detached');assert.equal(f.app.innerHTML,'settings retained');
 }
});
test('tracking settings failure states a load failure rather than an absent database',async()=>{
 const f=fixture(),request=f.context.emailTrackingPage();f.pending.shift().reject(Error('network unavailable'));await request;
 assert.match(f.app.innerHTML,/추적 설정 조회에 실패했습니다/);assert.doesNotMatch(f.app.innerHTML,/아직 적용되지/);
});
