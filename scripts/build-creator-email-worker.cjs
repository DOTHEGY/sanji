const esbuild=require('esbuild'),fs=require('node:fs');
fs.mkdirSync('supabase/dashboard',{recursive:true});
esbuild.buildSync({entryPoints:['supabase/functions/creator-email-worker/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/creator-email-worker.ts',external:['npm:*','node:*']});
console.log('Built separate creator-email-worker only. Existing workspace bundle unchanged.');
