import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createCampaignRuntime} from '../creator-daily-outreach/campaign-runtime.mjs';
import {dailyCampaignRunnerHandler} from '../creator-daily-outreach/sender-runtime.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const runtime=createCampaignRuntime({sb,env});
const handle=dailyCampaignRunnerHandler({run:()=>runtime.run(),env});
// Fixed route mapping, never owner/recipient/template fields from a runner body.
Deno.serve((request:Request)=>{
 const url=new URL(request.url);if(url.pathname!=='/creator-daily-outreach-worker/run'&&url.pathname!=='/functions/v1/creator-daily-outreach-worker/run')return new Response('Not found',{status:404});
 url.pathname='/creator-daily-outreach/run';return handle(new Request(url,request));
});
