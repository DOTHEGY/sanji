// Isolated notes function only; never rebuilds or replaces bright-function.
const fs=require('node:fs'),esbuild=require('esbuild');
fs.mkdirSync('supabase/dashboard',{recursive:true});
esbuild.buildSync({entryPoints:['supabase/functions/creator-manual-notes/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/creator-manual-notes.ts',external:['npm:*','node:*']});
console.log('Isolated creator historical notes function prepared.');
