const esbuild=require('esbuild');
const fs=require('node:fs');
fs.mkdirSync('supabase/dashboard',{recursive:true});
esbuild.buildSync({entryPoints:['supabase/functions/dot-snapshot-direct/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/dot-snapshot-direct.ts',external:['npm:*','node:*']});
