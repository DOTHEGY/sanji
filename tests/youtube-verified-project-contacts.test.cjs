const {test}=require('node:test'),assert=require('node:assert/strict');
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', nonmember='33333333-3333-4333-8333-333333333333';
const id=n=>'UC'+String(n).padStart(22,'0');
const relation='sanji_private_wedding_contacts';
const fields='owner,channel_id,email,source_url,source_kind,verified_at,expires_at';

const projectId='private-wedding-research',candidate=(i,extra={})=>({owner,projectId,channelID:id(i),projectDay:'2026-11-21',addedAt:'2026-11-21T05:00:00Z',...extra});
const row=(i,extra={})=>({owner,channel_id:id(i),email:'partnership'+i+'@example.com',source_url:'https://creator.example.com/contact',source_kind:'official_website',verified_at:'2026-11-20T10:00:00Z',expires_at:'2026-11-30T10:00:00Z',...extra});
const now=()=>Date.parse('2026-11-21T10:00:00Z');
function client(rows){
 const calls=[];
 return {calls,from(table){assert.equal(table,relation);let ids;const q={select(keys){assert.equal(keys,fields);return q},eq(key,value){assert.equal(key,'owner');assert.equal(value,owner);return q},in(key,v){assert.equal(key,'channel_id');ids=v;return q},limit(n){assert.equal(n,ids.length+1);calls.push(ids);return Promise.resolve({data:rows.filter(r=>ids.includes(r.channel_id))});}};return q;}};
}

test('read projection joins exact owned shortlist, hides duplicate addresses, checks source and selected day',async()=>{
 const {readVerifiedProjectContacts,verifiedContactsForDay}=await import('../web/youtube-verified-project-contacts.mjs');
 const c=client([row(1),row(2,{email:'same@example.com'}),row(3,{email:'Same@example.com'}),row(4,{expires_at:'2026-11-20T12:00:00Z'})]);
 const shortlist=[1,2,3,4,5].map(i=>candidate(i));
 const visible=await readVerifiedProjectContacts({client:c,owner,shortlist,current:()=>true,now});
 assert.deepEqual(visible.map(r=>[r.channelID,r.email]),[[id(1),'partnership1@example.com']]);
 assert.equal(shortlist.length,5);
 assert.deepEqual(verifiedContactsForDay(visible,'2026-11-22',now()),[]);
 assert.deepEqual(verifiedContactsForDay(visible,'2026-11-21',Date.parse('2026-11-30T10:00:00Z')),[]);
 assert.equal(c.calls.length,1);
});

test('wrong owner/scope, malformed contacts, stale session and query errors fail closed',async()=>{
 const {readVerifiedProjectContacts}=await import('../web/youtube-verified-project-contacts.mjs');
 const run=(r,shortlist=[candidate(1)])=>readVerifiedProjectContacts({client:client(r),owner,shortlist,current:()=>true,now});
 for(const r of [row(1,{owner:other}),row(1,{email:'support@example.com'}),row(1,{source_url:'javascript:alert(1)'}),row(1,{source_url:'https://user@creator.example.com'}),row(1,{source_kind:'official_channel',source_url:'https://www.youtube.com/channel/'+id(2)+'/about'})])await assert.rejects(()=>run([r]));
 await assert.rejects(()=>run([row(1)],[candidate(1,{projectId:'gs-bbangteojineunjip-chewy-bread'})]));
 await assert.rejects(()=>run([row(1),row(1)]));
 let count=0;assert.equal(await readVerifiedProjectContacts({client:client([row(1)]),owner,shortlist:[candidate(1)],current:()=>++count<3,now}),null);
});


test('first-party video URLs require the exact canonical URL of this shortlist evidence',async()=>{
 const {readVerifiedProjectContacts}=await import('../web/youtube-verified-project-contacts.mjs');
 const videoID='F0000000001',url='https://www.youtube.com/watch?v='+videoID;
 const run=(source_url,source_kind='official_video',evidence=videoID)=>readVerifiedProjectContacts({
  client:client([row(1,{source_url,source_kind})]),owner,shortlist:[candidate(1,{videoID:evidence})],current:()=>true,now});
 assert.equal((await run(url))[0].sourceUrl,url);
 assert.equal((await run('https://www.youtube.com/channel/'+id(1)+'/about','official_channel'))[0].channelID,id(1));
 for(const wrong of [url+'&feature=shared',url+'#x','https://youtu.be/'+videoID,'https://m.youtube.com/watch?v='+videoID,'https://mirror.example.com/watch?v='+videoID,'https://www.youtube.com/watch?v=F0000000002'])
  await assert.rejects(()=>run(wrong));
 await assert.rejects(()=>run(url,'official_video','F0000000002'));
 await assert.rejects(()=>run(url,'official_website'));
 await assert.rejects(()=>run('https://www.youtube.com/channel/'+id(1)+'/about?x=1','official_channel'));
});
