const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('persisted reservations match target or recipient after reload and cancelled jobs become drafts again',()=>{
 const source=fs.readFileSync('private/ui/app.js','utf8'),jobs=[{id:'reservation',status:'queued',target:'brand',email:'official@example.test',emails:['official@example.test'],run_at:'2026-10-26T00:00:00Z',subject:'Approved subject',body:'Approved copy',snapshotAvailable:true}];
 const ctx={data:{jobs},targetName:()=> '브랜드',esc:v=>String(v??''),tag:v=>v,button:(label,action,id)=>`<button data-action="${action}" data-id="${id}">${label}</button>`,localTime:()=> '2026. 10. 26. 오전 9:00'};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function mailLeadScheduled('),source.indexOf('function mailLeadManualReply(')),ctx);
 assert.equal(ctx.mailLeadScheduled({data:{candidateId:'brand',contacts:[]}}).id,'reservation');assert.equal(ctx.mailLeadScheduled({data:{contacts:[{email:'OFFICIAL@example.test'}]}}).id,'reservation');assert.equal(ctx.mailLeadScheduled({data:{candidateId:'different',contacts:[]}}),undefined);
 const html=ctx.scheduledMailCards();assert.match(html,/예약 완료 · 발송 대기/);assert.match(html,/Approved copy/);assert.match(html,/cancel-job/);assert.match(html,/오전 9:00/);assert.equal(html.includes('미예약 초안'),false);
 jobs[0].status='processing';assert.ok(ctx.mailLeadScheduled({data:{candidateId:'brand',contacts:[]}}));assert.equal(ctx.scheduledMailCards().includes('cancel-job'),false);
 jobs[0].status='outcome_unknown';assert.ok(ctx.mailLeadScheduled({data:{candidateId:'brand',contacts:[]}}));assert.match(ctx.scheduledMailCards(),/재전송 금지/);
 jobs[0].status='cancelled';assert.equal(ctx.mailLeadScheduled({data:{candidateId:'brand',contacts:[]}}),undefined);
});
