const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
const owner='11111111-1111-4111-8111-111111111111',id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const build=esbuild.build({entryPoints:['web/supabase-api.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mock-client',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'mock',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__client',loader:'js'}));}}]});
const plain=x=>JSON.parse(JSON.stringify(x));
async function fixture(rows){
 const writes=[],client={auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'synthetic'}}})},from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},gt(_,cursor){q.cursor=cursor;return q},then(resolve){return Promise.resolve({data:table==='sanji_members'?[{user_id:owner}]:table==='sanji_records'?rows.filter(r=>!q.cursor||r.id>q.cursor):[],error:null}).then(resolve)}};return q},rpc(name,body){writes.push(plain({name,body}));return Promise.resolve({data:{id:body.p_id,version:body.p_version+1,updated:'later',data:body.p_data},error:null})}};
 const c={module:{exports:{}},exports:{},URL,URLSearchParams,console,Date,TextEncoder,__client:client,fetch:async()=>({ok:true,json:async()=>({jobs:[]})})};c.exports=c.module.exports;vm.createContext(c);vm.runInContext((await build).outputFiles[0].text,c);return {api:c.module.exports.workspaceApi,writes};
}
const row=(n,kind,data)=>({id:id(n),owner,kind,version:7,updated:'2026-11-04T10:00:00Z',data});
async function submit(record,api){
 const src=fs.readFileSync('private/ui/app.js','utf8'),helpers=src.slice(src.indexOf('const dealEditorSnapshots'),src.indexOf('function dealForm(')),section=src.slice(src.indexOf('} else if (form.id === "deal-form")')+'} else if (form.id === "deal-form") {'.length,src.indexOf('} else if (form.id === "template-form")'));
 const initial={claims:'old',topics:'a,b',retail:'0',price:'',supply:'',moq:'',stock:'',ownership:'unknown',feeBasis:'unknown',creatorPercent:'',companyPercent:'',companyUnit:'unknown'},c={WeakMap,form:{},fid:record.id,record,initial,f:{...initial,claims:'new'},listText:x=>x.split(','),api};vm.createContext(c);vm.runInContext(helpers+'\ndealEditorSnapshots.set(form,{record,initial});this.submit=async()=>{'+section+'}',c);await c.submit();
}
test('state partitions by row kind without adding _kind or overwriting existing values',async()=>{
 const values=[undefined,'deal','candidate','',null,{custom:['preserve']}],rows=values.map((value,n)=>row(n+1,'deal',{name:'synthetic',claims:'old',...(value===undefined?{}:{_kind:value}),unknown:{nested:[0,null,'']}}));rows.push(row(20,'candidate',{_kind:'deal'}),row(21,'template',{_kind:'settings'}),row(22,'thread',{_kind:'candidate'}),row(23,'settings',{_kind:'template'}));
 const f=await fixture(rows),state=await f.api('/state');assert.equal(state.deals.length,6);assert.equal(state.catalog.expectedCount,6);for(const r of rows){const bucket={deal:state.deals,candidate:state.candidates,template:state.templates,thread:state.threads,settings:[state.settings]}[r.kind];assert.deepEqual(plain(bucket.find(x=>x.id===r.id)),{...r.data,id:r.id,version:r.version,updated:r.updated});}assert.equal(f.writes.length,0);
});
test('actual state -> editor snapshot -> submit preserves unknown and original _kind fields exactly',async()=>{
 for(const extra of [{},{_kind:'deal'},{_kind:'candidate'},{_kind:null},{_kind:{legacy:true}}]){
  const originalData={name:'synthetic',claims:'old',topics:['a,b'],retail:0,stock:'unknown',productUrl:null,unknown:{id:'nested-id',version:99,_kind:'nested',updated:'keep'},feeTerms:{custom:'keep'},...extra};const r=row(1,'deal',originalData),f=await fixture([r]),state=await f.api('/state');await submit(state.deals[0],f.api);
  assert.equal(f.writes.length,1);const {body}=f.writes[0];assert.equal(body.p_id,r.id);assert.equal(body.p_version,7);assert.deepEqual(body.p_data,{...originalData,claims:'new',id:r.id,version:7,updated:r.updated});
  // Existing SQL owns these envelope keys. No other payload key is stripped.
  const {id:transportId,version,updated,...stored}=body.p_data;assert.deepEqual(stored,{...originalData,claims:'new'});assert.deepEqual(r.data,originalData);
 }
});
test('unpack projects envelope identity without deriving routing from payload identity',async()=>{const originalData={id:'legacy-payload-id',version:999,updated:'legacy-time',_kind:'candidate',unknown:'keep'},r=row(1,'deal',originalData),f=await fixture([r]),state=await f.api('/state');assert.deepEqual(plain(state.deals[0]),{...originalData,id:r.id,version:7,updated:r.updated});assert.equal(state.candidates.length,0);assert.deepEqual(r.data,originalData);});
