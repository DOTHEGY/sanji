// New isolated worker candidate. Deployment, secret setup and a recurring
// trigger require separate review; this code does not create any of them.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {youtubeManualRuntime} from '../youtube-manual-mail/runtime.mjs';
import {authorizedGithubScheduler} from './github-oidc.mjs';
import {schedulerEndpoint} from './endpoint.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const runtime=youtubeManualRuntime({sb,env});
Deno.serve(schedulerEndpoint({authorize:(request:Request,event:string)=>authorizedGithubScheduler(request,{event}),runOne:()=>runtime.runScheduledOne()}));
