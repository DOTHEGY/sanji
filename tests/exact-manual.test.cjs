const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const at=Date.parse('2026-11-12T07:00:00Z');
test('manual endpoint enforces method, fixed path, verified dispatch, exact body and expiry; existing schedule and health retained',async()=>{
 const {schedulerEndpoint}=await require('./helpers/exact-manual-release.cjs')();let manual=0,schedule=0,calls=[];
 let time=at;const h=schedulerEndpoint({authorize:async(req,event)=>{calls.push(event);return req.headers.get('authorization')==='Bearer '+event},runOne:async()=>{schedule++;return {status:'idle'}},runManualOne:async()=>{manual++;return {status:'scheduled'}},now:()=>time});
 const request=(suffix,token='workflow_dispatch',body='{}',method='POST')=>new Request('https://example.test/functions/v1/youtube-manual-scheduler'+suffix,{method,headers:{authorization:'Bearer '+token},...(method==='POST'?{body}:{})});
 assert.equal((await h(request('/manual-approved-20261112','schedule'))).status,401);
 for(const body of ['', '{ }','{"owner":"foreign"}','null','[]','{}x'])assert.equal((await h(request('/manual-approved-20261112','workflow_dispatch',body))).status,400);
 assert.equal((await h(request('/manual-approved-20261112','workflow_dispatch','{}','GET'))).status,404);
 assert.equal((await h(request('/manual-other'))).status,404);assert.equal(manual,0);
 assert.equal((await h(request('/auth-health'))).status,200);assert.equal(manual,0);assert.equal(schedule,0);
 assert.equal((await h(request('','schedule',''))).status,200);assert.equal(schedule,1);
 assert.equal((await h(request('/manual-approved-20261112'))).status,200);assert.equal(manual,1);
 time=Date.parse('2026-11-12T09:00:00Z');assert.equal((await h(request('/manual-approved-20261112'))).status,403);assert.equal(manual,1);
});
test('exact worker never invokes generic claim and fails closed on mismatched claim or exception',async()=>{
 const {exactManualWorker,MANUAL_EXACT,scheduledYoutubeWorker}=await require('./helpers/exact-manual-release.cjs')();let generic=0,exact=0,send=0,continued=0,finished=[];
 let claim={...MANUAL_EXACT,token:'synthetic-claim'};
 const repository={claimDue:async()=>{generic++;throw Error('wrong')},claimExactApproved:async()=>{exact++;return claim},continueClaim:async()=>{continued++;return 'scheduled'},finishClaim:async x=>finished.push(x.result)};
 let run=exactManualWorker({repository,workerFactory:scheduledYoutubeWorker,dispatch:async args=>{assert.equal(args.batchId,MANUAL_EXACT.batchId);send++;return {status:'accepted'}},env:()=> 'true',now:()=>at});
 assert.deepEqual(await run(),{status:'scheduled'});assert.equal(generic,0);assert.equal(exact,1);assert.equal(send,5);assert.equal(continued,1);
 claim={...claim,batchId:'different'};await assert.rejects(run,/MANUAL_SCOPE_CHANGED/);assert.equal(send,5);
 claim={...MANUAL_EXACT,token:'synthetic-claim'};run=exactManualWorker({repository,workerFactory:scheduledYoutubeWorker,dispatch:async()=>{send++;throw Error('uncertain')},env:()=> 'true',now:()=>at});
 assert.deepEqual(await run(),{status:'outcome_unknown'});assert.equal(send,6);assert.deepEqual(finished,['outcome_unknown']);assert.equal(continued,1);
 run=exactManualWorker({repository,workerFactory:scheduledYoutubeWorker,dispatch:()=>{throw Error('no')},env:()=> 'true',now:()=>Date.parse(MANUAL_EXACT.expiresAt)});await assert.rejects(run,/MANUAL_AUTH_EXPIRED/);assert.equal(exact,3);
});
test('fixed manual client stops on unknown outcomes, errors, and complete; only known scheduled continues',()=>{
 execFileSync('python3',['-c',`import importlib.util,json
s=importlib.util.spec_from_file_location('m','scripts/trigger-youtube-scheduler.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class R:
 status=200
 def __init__(self,x):self.x=x
 def read(self,n):return json.dumps(self.x).encode()
 def __enter__(self):return self
 def __exit__(self,*a):pass
class O:
 def __init__(self,values):self.values=iter(values);self.calls=0
 def open(self,req,timeout):
  self.calls+=1;assert req.full_url==m.URL+'/manual-approved-20261112';assert req.data==b'{}';x=next(self.values)
  if isinstance(x,Exception):raise x
  return R(x)
o=O([{'status':'scheduled'},{'status':'complete'}]);assert m.approved_batch('synthetic',o)=='complete' and o.calls==2
for value in [{'status':'outcome_unknown'},{'status':'held'},{'status':'processing'},{'extra':1,'status':'scheduled'},TimeoutError('secret')]:
 o=O([value,{'status':'complete'}])
 try:m.approved_batch('synthetic',o);raise AssertionError('not stopped')
 except (RuntimeError,TimeoutError):pass
 assert o.calls==1
`],{stdio:'pipe'});
 const workflow=fs.readFileSync('.github/workflows/youtube-manual-scheduler.yml','utf8');assert.match(workflow,/default: health/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/if: github.event_name == 'schedule'\n        run: python3 scripts\/trigger-youtube-scheduler.py\n/);assert.match(workflow,/inputs.mode == 'approved-nov12-54'/);
});

test('manual expiry prevents new dispatch during a previously claimed chunk',async()=>{
 const {exactManualWorker,MANUAL_EXACT,scheduledYoutubeWorker}=await require('./helpers/exact-manual-release.cjs')();let time=at,send=0,finish;
 const repository={claimExactApproved:async()=>({...MANUAL_EXACT,token:'synthetic'}),continueClaim:async()=>{throw Error('must not continue')},finishClaim:async x=>{finish=x.result}};
 const run=exactManualWorker({repository,workerFactory:scheduledYoutubeWorker,dispatch:async()=>{send++;time=Date.parse(MANUAL_EXACT.expiresAt);return {status:'accepted'}},env:()=> 'true',now:()=>time});
 // Keep wall elapsed below the existing 15-second chunk stop so expiry guard is exercised.
 time=Date.parse(MANUAL_EXACT.expiresAt)-1;assert.deepEqual(await run(),{status:'held'});assert.equal(send,1);assert.equal(finish,'held');
});
