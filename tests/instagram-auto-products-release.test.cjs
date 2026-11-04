const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const build=fs.readFileSync('scripts/build-supabase.cjs','utf8');
const html=fs.readFileSync('private/ui/index.html','utf8');
test('automatic product engine is bundled for Pages without changing the local Node app loader',()=>{
 assert.doesNotMatch(html,/instagram-auto-products\.js/);
 assert.match(build,/import "\.\.\/private\/ui\/instagram-auto-products\.js"/);
 assert.match(build,/creatorProposalContextApi/);
});
test('automatic product changes do not require a new service key or broader function URL',()=>{
 const config=fs.readFileSync('web/supabase-config.js','utf8').split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
 assert.doesNotMatch(config,/service.role|SERVICE_ROLE|PRIVATE_KEY|SECRET/);
 assert.match(config,/creatorManualNotesFunctionUrl/);
 const entry=fs.readFileSync('supabase/functions/creator-manual-notes/index.ts','utf8');
 assert.match(entry,/creatorManualNotesHandler/);
 assert.doesNotMatch(entry,/fetch\(|send|scheduler|webhook/i);
});
test('production side-effect bundle exposes the automatic selector instead of silently falling back',()=>{
 const esbuild=require('esbuild'),vm=require('node:vm');
 const built=esbuild.buildSync({stdin:{contents:'import "./private/ui/instagram-auto-products.js";',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false});
 const sandbox={URL};sandbox.globalThis=sandbox;
 vm.runInNewContext(built.outputFiles[0].text,sandbox);
 assert.equal(typeof sandbox.InstagramAutoProducts?.plan,'function');
 assert.equal(typeof sandbox.InstagramAutoProducts?.buildDraft,'function');
 assert.equal(sandbox.InstagramAutoProducts.plan({}).selected.length,0);
});
