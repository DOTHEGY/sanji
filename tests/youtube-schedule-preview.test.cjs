const {test}=require('node:test'),assert=require('node:assert/strict');
test('next day means 10:00 Seoul even at UTC midnight and year boundary',async()=>{const {tomorrowTenSeoul}=await import('../web/youtube-schedule-preview.mjs');assert.equal(tomorrowTenSeoul('2026-11-11T14:59:00Z'),'2026-11-12T01:00:00.000Z');assert.equal(tomorrowTenSeoul('2026-11-11T15:00:00Z'),'2026-11-13T01:00:00.000Z');assert.equal(tomorrowTenSeoul('2026-12-31T03:00:00Z'),'2027-01-01T01:00:00.000Z');});
test('review excludes selected recipients and mailbox aliases, other projects and out-of-range or unsourced rows',async()=>{const {reviewProjectReservation}=await import('../web/youtube-schedule-preview.mjs'),id='gs-bbangteojineunjip-chewy-bread';const row=(n,email)=>({id:String(n),version:1,data:{name:'channel'+n,profile:'https://www.youtube.com/channel/UC'+String(n).repeat(22),followers:50000,contact:{email,source:'https://example.test/',checked:'2026-11-10'},youtubeResearch:{projects:[{id,addedAt:'2026-11-11T00:00:00Z',assignedDay:'2026-11-12'}]}}});const a=row(1,'a.b+one@gmail.com'),alias=row(2,'ab@gmail.com'),keep=row(3,'keep@example.test'),missing=row(4,'');const result=reviewProjectReservation({rows:[a,alias,keep,missing],projectId:id,day:'2026-11-12',excludedIds:['1'],now:'2026-11-11T00:00:00Z'});assert.deepEqual(result.candidates.map(x=>x.id),['3']);assert.deepEqual(result.held,['4']);assert.equal(result.runAt,'2026-11-12T01:00:00.000Z');assert.equal(result.reviewOnly,true);});
test('exclusion includes every recorded mailbox and canonical channel across URL forms',async()=>{const {reviewProjectReservation}=await import('../web/youtube-schedule-preview.mjs'),id='gs-bbangteojineunjip-chewy-bread',channel='UC'+'a'.repeat(22),member={id,addedAt:'2026-11-11T00:00:00Z',assignedDay:'2026-11-12'},row=(key,profile,email,extra=[])=>({id:key,version:1,data:{name:key,profile,followers:50000,contact:{email,source:'https://example.test/',checked:'2026-11-10'},youtubeResearch:{projects:[member],businessContacts:extra}}}),excluded=row('excluded','https://youtube.com/channel/'+channel,'first@example.test',[{email:'second@example.test'}]),sameChannel=row('same-channel','https://www.youtube.com/channel/'+channel,'third@example.test'),sameSecondary=row('same-email','https://youtube.com/channel/UC'+'b'.repeat(22),'second@example.test'),ok=row('ok','https://youtube.com/channel/UC'+'c'.repeat(22),'ok@example.test');const out=reviewProjectReservation({rows:[excluded,sameChannel,sameSecondary,ok],projectId:id,day:'2026-11-12',excludedIds:['excluded'],now:'2026-11-11T00:00:00Z'});assert.deepEqual(out.candidates.map(x=>x.id),['ok']);});

test('explicit send day keeps November 12 10 KST after KST midnight and is independent of project day',async()=>{
 const {chosenTenSeoul,reviewProjectReservation}=await import('../web/youtube-schedule-preview.mjs');
 const now='2026-11-12T00:00:00Z';
 assert.equal(chosenTenSeoul('2026-11-12',now),'2026-11-12T01:00:00.000Z');
 const review=reviewProjectReservation({rows:[],projectId:'gs-bbangteojineunjip-chewy-bread',day:'2026-11-11',sendDay:'2026-11-12',now});
 assert.equal(review.day,'2026-11-11');assert.equal(review.runAt,'2026-11-12T01:00:00.000Z');
 for(const day of ['',null,'2026-02-30','2026-13-12','2026-11-11','2026-11-12T10:00:00'])assert.throws(()=>chosenTenSeoul(day,now));
 assert.throws(()=>chosenTenSeoul('2026-11-12','2026-11-12T01:00:00Z'),/지나지 않은/);
 assert.throws(()=>chosenTenSeoul('2026-11-12','invalid'),/현재 시각/);
});

test('reservation final action uses reviewed time, never promises tomorrow',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('web/youtube-discovery.js','utf8');
 assert.ok(source.includes("el('button','확인한 시각으로 예약')"));
 assert.ok(!source.includes('확인 후 내일 오전 10시 예약'));
 assert.ok(source.includes("format(new Date(expectedRunAt))"));
 assert.ok(source.includes("'/schedule',{...body,expectedRunAt}"));
});
