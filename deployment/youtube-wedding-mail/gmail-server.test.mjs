import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT} from './partyum-mail.mjs';
import {createPartyumGmail,partyumMime} from './gmail-server.mjs';
const owner='00000000-0000-4000-8000-000000000001',intentId='00000000-0000-4000-8000-000000000002';
const from='owner@example.test',to='recipient@example.test';
const title='합성 제목 및 파일',body='원문 그대로\n\n개행과 닫는 말도 포함\r\n';
const secret='fixture-encryption-material-never-live';
const env=(name)=>({EMAIL_SENDING_ENABLED:'true',TOKEN_ENCRYPTION_KEY:secret,GOOGLE_CLIENT_ID:'fixture-id',GOOGLE_CLIENT_SECRET:'fixture-secret'})[name]??'';
function decode(raw){return Buffer.from(raw,'base64url').toString('utf8');}
async function encrypted(replacements={}){
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({email:from,
  access_token:'fixture-access',refresh_token:'fixture-refresh',expires:Date.now()-1000,...replacements})));
 return Buffer.concat([Buffer.from(iv),Buffer.from(data)]).toString('base64');
}
const parameters={actor:owner,projectId:PROJECT,to,subject:title,body,intentId};
test('MIME has unchanged UTF-8 body, safe headers, and opaque stable instance ID',()=>{
 const d=decode(partyumMime({from,to,subject:title,body,intentId}));
 const encoded=d.split('\r\n\r\n').at(-1).replaceAll('\r\n','');
 assert.equal(Buffer.from(encoded,'base64').toString('utf8'),body);
 assert.match(d,/Message-ID: <partyum-/);
 assert.doesNotMatch(d,/tracking|cc:/i);
 assert.throws(()=>partyumMime({from,to,subject:'bad\nBcc: someone',body,intentId}),/MIME_INVALID/);
});
test('current owner-only encrypted Gmail OAuth refresh and profile precede exact send; requires complete receipt',async()=>{
 const row={owner,provider:'gmail',summary:{email:from},encrypted:await encrypted()};
 const calls=[];
 const gmail=createPartyumGmail({env,isEnabled:async()=>true,readConnection:async(q,actor)=>{assert.equal(actor,owner);return row;},request:async(url,req)=>{
  calls.push(url);assert.equal(req.redirect,'error');
  if(url.endsWith('/token'))assert.equal(req.body.get('refresh_token'),'fixture-refresh');
  if(url.endsWith('/profile'))assert.equal(req.headers.Authorization,'Bearer fixture-fresh');
  if(url.endsWith('/send'))assert.equal(Buffer.from(decode(JSON.parse(req.body).raw).split('\r\n\r\n').at(-1).trim(),'base64').toString('utf8'),body);
  const x=url.endsWith('/token')?{access_token:'fixture-fresh',expires_in:3600}:url.endsWith('/profile')?{emailAddress:from}:{id:'fixture-provider',threadId:'fixture-thread'};
  return Response.json(x);
 }});
 const r=await gmail.resolveSender({},owner);
 const result=await gmail.deliver({...parameters,from:r.senderRef});
 assert.equal(result.kind,'accepted');assert.equal(result.intentId,intentId);
 assert.deepEqual(calls.map(x=>x.split('/').at(-1)),['token','profile','send']);
});
test('reconnect before send, bad owner/profile, or transport failures never become accepted',async()=>{
 const row={owner,provider:'gmail',summary:{email:from},encrypted:await encrypted({expires:Date.now()+3600000})};
 let sends=0;
 const g=createPartyumGmail({env,isEnabled:async()=>true,readConnection:async()=>row,request:async(url)=>{
  if(url.endsWith('/profile')){row.encrypted=await encrypted();return Response.json({emailAddress:from});}
  sends++;throw Error('network');
 }});
 const r=await g.resolveSender({},owner);
 await assert.rejects(()=>g.deliver({...parameters,from:r.senderRef}),{code:'GMAIL_ACCOUNT_CHANGED'});
 assert.equal(sends,0);
 const h=createPartyumGmail({env,isEnabled:async()=>true,readConnection:async()=>row,request:async url=>{
  if(url.endsWith('/token'))return Response.json({access_token:'fixture-fresh',expires_in:3600});
  if(url.endsWith('/profile'))return Response.json({emailAddress:from});
  sends++;throw Error('simulated lost response');
 }});
 const c=await h.resolveSender({},owner);
 await assert.rejects(()=>h.deliver({...parameters,from:c.senderRef}),{code:'GMAIL_OUTCOME_UNKNOWN'});
 assert.equal(sends,1);
});

test('429 preserves only bounded cooldown metadata, no receipt',async()=>{
 const row={owner,provider:'gmail',summary:{email:from},encrypted:await encrypted({expires:Date.now()+3600000})};
 const g=createPartyumGmail({env,isEnabled:async()=>true,readConnection:async()=>row,request:async url=>url.endsWith('/profile')
   ?Response.json({emailAddress:from}):new Response('{}',{status:429,headers:{'Retry-After':'999'}})});
 const r=await g.resolveSender({},owner);
 await assert.rejects(()=>g.deliver({...parameters,from:r.senderRef}),{code:'GMAIL_RATE_LIMIT',retryAfterSeconds:300});
});

test('Partyum off after provider-profile check prevents even a preexisting durable intent from sending',async()=>{
 let enabled=true,sends=0;
 const row={owner,provider:'gmail',summary:{email:from},encrypted:await encrypted({expires:Date.now()+3600000})};
 const g=createPartyumGmail({env,isEnabled:async()=>enabled,readConnection:async()=>row,request:async url=>{
  if(url.endsWith('/profile')){enabled=false;return Response.json({emailAddress:from});}
  sends++;return Response.json({id:'unexpected',threadId:'unexpected'});
 }});
 const r=await g.resolveSender({},owner);
 await assert.rejects(()=>g.deliver({...parameters,from:r.senderRef}),{code:'GMAIL_SEND_DISABLED'});
 assert.equal(sends,0);
});
