import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {youtubeManualRuntime} from './runtime.mjs';
import {youtubeManualHandler} from './controller.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const runtime=youtubeManualRuntime({sb,env});
Deno.serve(youtubeManualHandler({sb,prepare:runtime.preview,confirm:runtime.confirm,schedule:runtime.schedule,status:runtime.status,recent:runtime.recent,cancel:runtime.cancel,gmailReviewPrepare:runtime.gmailReviewPrepare,gmailReviewConfirm:runtime.gmailReviewConfirm,origin:env('APP_ORIGIN')||'https://dothegy.github.io'}));
