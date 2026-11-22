const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
const rootPath=require('node:path').resolve(__dirname,'..');

class Node{
  constructor(tag=''){this.tagName=tag;this.children=[];this.value='';this.dataset={};this.style={};this.handlers=new Map();this.hidden=true;}
  append(...nodes){for(const n of nodes){if(typeof n==='object')n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  addEventListener(event,handler){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(handler);}
  getElementById(id){return this.ids?.[id]??this.children.find(n=>n?.ids?.[id])?.ids[id]??null;}
  querySelectorAll(){return [];}
  setAttribute(){}
  reset(){}
  querySelector(selector){if(selector==='header > a[href="../"]')return this.back;return null;}
  attachShadow(){this.shadowRoot=new Node('#shadow');return this.shadowRoot;}
}
const tick=()=>new Promise(r=>setTimeout(r,5));
const bundle=esbuild.buildSync({
  stdin:{contents:"import {mountYouTubeDiscovery} from './web/youtube-discovery-mount.js';globalThis.mount=mountYouTubeDiscovery;",resolveDir:rootPath},
  bundle:true,write:false,platform:'browser',format:'iife',loader:{'.html':'text','.css':'text'},
}).outputFiles[0].text;

function harness(initialOwner='owner-a'){
 const outside=new Node('div'), doc={
  createElement:tag=>new Node(tag),createTextNode:t=>String(t),
  getElementById(){throw Error('Chewy escaped its mounted root');},
  importNode(node){return node;},
  defaultView:{DOMParser:class{parseFromString(markup){
   const main=new Node('main');
   main.ids=Object.fromEntries([...markup.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,new Node(id)]));
   main.back=new Node('legacy back');main.append(main.back);
   return {querySelector(selector){assert.equal(selector,'body > main');return main;}};
  }}},
 };
 outside.ownerDocument=doc;
 const log=[],callbacks=new Set();let owner=initialOwner;
 function session(){return owner?{user:{id:owner},access_token:'fake-'+owner}:null;}
 const client={
  auth:{async getSession(){return{data:{session:session()}}},onAuthStateChange(callback){callbacks.add(callback);return {data:{subscription:{unsubscribe(){callbacks.delete(callback)}}}};}},
  rpc:async name=>{log.push(['rpc',name]);return {data:true}},
  from(table){log.push(['from',table]);const q=new Proxy({},{
   get(_t,k){return k==='then'?(resolve,reject)=>Promise.resolve({data:[],count:0}).then(resolve,reject):()=>q;}
  });return q;},
 };
 const scope={document:doc,window:{},location:{search:''},setTimeout,clearTimeout,AbortController,URL,URLSearchParams,TextEncoder,Intl,fetch:async(url,options)=>{
   log.push(['fetch',new URL(url).pathname,options.body]);
   return {ok:true,json:async()=>({rows:[],more:false})};
 }};
 vm.runInNewContext(bundle,scope);
 const change=(next,event='SIGNED_IN')=>{owner=next;for(const cb of callbacks)cb(event,session());};
 return {mount:(options)=>scope.mount(outside,{client,...options}),outside,callbacks,log,change};
}

test('native Chewy uses its original panels and scoped styles, not a route iframe',async()=>{
 const h=harness(),abort=new AbortController(),cleanup=h.mount({owner:'owner-a',signal:abort.signal});
 await tick();
 const host=h.outside.children[0],root=host.shadowRoot;
 assert.equal(host.tagName,'div');
 assert.match(root.children[0].textContent,/^:host\{display:block\}:host\{/);
 const main=root.children[1];
 assert.ok(!main.children.includes(main.back));
 assert.ok(['saved-youtube','daily-outreach','research-advanced','search-form','subject','open-mail'].every(id=>root.getElementById(id)));
 assert.equal(root.getElementById('workspace').hidden,false);
 assert.equal(h.callbacks.size,1);
 assert.ok(h.log.filter(x=>x[0]==='fetch').every(x=>x[1].endsWith('/recent')));
 root.getElementById('brief').value='existing search draft';
 host.hidden=true;host.hidden=false;
 assert.equal(root.getElementById('brief').value,'existing search draft');
 abort.abort();
 assert.equal(h.outside.children.length,0);
 assert.equal(h.callbacks.size,0);
 assert.equal(root.getElementById('brief').value,'');
 cleanup();
});

test('native Chewy does not adopt a different session owner and refuses an already-aborted mount',async()=>{
 const h=harness('owner-b'),abort=new AbortController();
 h.mount({owner:'owner-a',signal:abort.signal});await tick();
 const child=h.outside.children[0].shadowRoot;
 assert.equal(child.getElementById('workspace').hidden,true);
 assert.deepEqual(h.log,[]);
 h.change('owner-a');await tick();
 assert.equal(child.getElementById('workspace').hidden,false);
 h.change('owner-b');
 assert.equal(child.getElementById('workspace').hidden,true);
 await tick();
 assert.ok(h.log.filter(x=>x[0]==='fetch').every(x=>x[1].endsWith('/recent')));
 abort.abort();
 h.mount({owner:'owner-a',signal:abort.signal});
 assert.equal(h.outside.children.length,0);
 assert.equal(h.callbacks.size,0);
});
