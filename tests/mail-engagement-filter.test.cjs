const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('private/ui/app.js','utf8'),a=source.indexOf('function sentMailCards() {'),b=source.indexOf('\nasync function discoveryPage()',a),code=source.slice(a,b)+';sentMailCards();';
function render(tab,report=[],threads=[]){return vm.runInNewContext(code,{brandTab:tab,mailOpenReport:report,mailOpenReportAvailable:report.length>0,sentMailRows:()=>['one','two','three'].map(id=>({id,target:id,created:'2026-10-23T00:00:00Z',data:{subject:id}})),candidate:id=>({name:id}),data:{threads},esc:x=>String(x??''),tag:x=>'<span>'+x+'</span>',localTime:x=>x,button:()=>''});}
test('estimated-open filter excludes untracked, internal tests, automated-only events and shared recipients',()=>{
 const html=render('opened',[{id:'one',label:'열람 추정',mode:'individual',is_test:false,first_included:'2026-10-23T01:00:00Z',last_included:'2026-10-23T01:00:00Z'},{id:'two',label:'열람 추정',is_test:true,first_included:'2026-10-23'},{id:'three',label:'열람 추정',mode:'shared',first_included:'2026-10-23'}]);assert.match(html,/<h3>one<\/h3>/);assert.ok(!html.includes('<h3>two</h3>'));assert.ok(!html.includes('<h3>three</h3>'));assert.match(html,/실제로 읽었다는 확정 정보가 아닙니다/);
 assert.match(render('opened'),/소급 확인할 수 없습니다/);assert.ok(!render('opened').includes('<h3>one</h3>'));
});
test('reply filter requires an incoming, nonautomatic message after the send time',()=>{
 const html=render('replied',[],[{target:'one',channel:'email',messages:[{out:false,automatic:false,at:'2026-10-23T01:00:00Z'}]},{target:'two',channel:'email',messages:[{out:false,automatic:true,at:'2026-10-23T01:00:00Z'}]}]);assert.match(html,/<h3>one<\/h3>/);assert.ok(!html.includes('<h3>two</h3>'));assert.ok(!html.includes('<h3>three</h3>'));
});
