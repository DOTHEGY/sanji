// The isolated function is built separately; this never rewrites the workspace bundle.
const fs=require('fs'),esbuild=require('esbuild');
fs.mkdirSync('supabase/dashboard',{recursive:true});
esbuild.buildSync({entryPoints:['supabase/functions/instagram-manual-inbox/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/instagram-manual-inbox.ts',external:['npm:*','node:*']});
console.log('Isolated manual Instagram inbox function prepared.');
