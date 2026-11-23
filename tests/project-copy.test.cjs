const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('private/ui/app.js','utf8');
const fragment=source.slice(source.indexOf('async function renderProjectCopies('),source.indexOf('async function projectCopyPage('));
const p='youtube_project_copy_primary',w='youtube_project_copy_wedding';
const mk=(purpose,subject,body,archived=false)=>({archived,data:{purpose,subject,body,channel:'이메일'}});
const host=()=>({ownerDocument:{createElement(tag){return {tag}}},removeAttribute(){},replaceChildren(...children){this.children=children;}});
function read(reader){const c={workspacePrimaryProjectCopy:reader,PROJECT_COPY_PURPOSE:p};vm.createContext(c);vm.runInContext(fragment,c);return c.renderProjectCopies}
test('owner-scoped one read shows exact literals in both distinct slots',async()=>{
 const to=[host(),host()],fixture=[mk(w,'Wedding <b>','First\nSecond'),mk(p,'Chewy','[채널명]'),mk(w,'Archived','ignore',true)];
 const f=read(async (o,live)=>{assert.equal(o,'fixture-owner');assert.equal(live(),true);return {rows:fixture}});
 await f('fixture-owner',()=>true,[[p,to[0]],[w,to[1]]]);assert.equal(to[0].children[3].textContent,'[채널명]');assert.equal(to[1].children[1].textContent,'Wedding <b>');assert.equal(to[1].children[3].textContent,'First\nSecond');
});
test('two active wedding rows fail closed while primary works',async()=>{
 const to=[host(),host()];await read(async()=>({rows:[mk(w,'a','b'),mk(w,'c','d'),mk(p,'Chewy','[채널명]')]}))('fixture-owner',()=>true,[[p,to[0]],[w,to[1]]]);assert.equal(to[0].children[3].textContent,'[채널명]');assert.match(to[1].textContent,/확인하지 못했습니다/);
});
test('account change drops delayed copy before painting',async()=>{
 let current=true;const to=host();await read(async()=>{current=false;return {rows:[mk(w,'Wedding','Private')]}})('fixture-owner',()=>current,[[w,to]]);assert.equal(to.children,undefined);
});
