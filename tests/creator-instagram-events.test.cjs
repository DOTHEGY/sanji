const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {verifyInstagramSignature,instagramInboundEvents,instagramReplyAllowed}=require('../supabase/functions/_shared/creator-instagram-events.ts');
test('webhook requires authentic signature and correct business recipient',async()=>{
 const raw=new TextEncoder().encode('{"object":"instagram"}');
 const signature='sha256='+createHmac('sha256','secret').update(raw).digest('hex');
 assert.equal(await verifyInstagramSignature(raw,signature,'secret'),true);
 assert.equal(await verifyInstagramSignature(raw,signature,'other'),false);
 assert.equal(await verifyInstagramSignature(raw,'','secret'),false);
 const event={sender:{id:'12'},recipient:{id:'34'},timestamp:100000,message:{mid:'m1',text:'hello'}};
 const payload={object:'instagram',entry:[{id:'34',messaging:[event,{...event,recipient:{id:'99'}},{...event,message:{...event.message,is_echo:true}}]}]};
 assert.equal(instagramInboundEvents(payload,100001).length,1);
 assert.equal(instagramInboundEvents(payload,-300000).length,0);
});
test('manual replies are limited to a known inbound message within 24 hours',()=>{
 const now=Date.parse('2026-10-30T12:00:00Z');
 assert.equal(instagramReplyAllowed('2026-10-30T11:00:00Z',now),true);
 assert.equal(instagramReplyAllowed('2026-10-29T12:00:00Z',now),false);
 assert.equal(instagramReplyAllowed('2026-10-30T13:00:00Z',now),false);
 assert.equal(instagramReplyAllowed('',now),false);
});
