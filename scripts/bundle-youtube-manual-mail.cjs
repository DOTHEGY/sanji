// Build only the independent YouTube manual function. No workspace server replacement.
const fs=require('node:fs'),esbuild=require('esbuild');
fs.mkdirSync('supabase/dashboard',{recursive:true});
// esbuild strips TypeScript types: emit JavaScript with its actual extension.
esbuild.buildSync({entryPoints:['supabase/functions/youtube-manual-mail/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/youtube-manual-mail.mjs',external:['npm:*','node:*']});
esbuild.buildSync({entryPoints:['supabase/functions/youtube-manual-scheduler/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/youtube-manual-scheduler.mjs',external:['npm:*','node:*']});
console.log('Isolated YouTube manual mail function prepared.');
