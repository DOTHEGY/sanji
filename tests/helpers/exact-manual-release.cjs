const fs=require('node:fs'),path=require('node:path');
let pending;
module.exports=()=>pending??=(async()=>{
 let source=fs.readFileSync(path.join(__dirname,'../../deployment/youtube-manual-scheduler-exact-20261112.mjs'),'utf8').replace('import { createClient } from "npm:@supabase/supabase-js@2.118.0";','');
 source=source.slice(0,source.lastIndexOf('// supabase/functions/youtube-manual-scheduler/index.ts'))+'\nexport {schedulerEndpoint,schedulerHandler,authorizedGithubScheduler,exactManualWorker,exactManualHandler,scheduledYoutubeWorker,MANUAL_EXACT};';
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
})();
