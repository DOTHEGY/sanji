// Produce the isolated creator-daily-outreach candidate for review only.
const fs=require('node:fs'),esbuild=require('esbuild');
fs.mkdirSync('supabase/dashboard',{recursive:true});
esbuild.buildSync({entryPoints:['supabase/functions/creator-daily-outreach/index.ts'],bundle:true,platform:'neutral',format:'esm',outfile:'supabase/dashboard/creator-daily-outreach-greeting.mjs',external:['npm:*','node:*']});
