import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {campaignHandler} from './campaign-controller.mjs';
import {createCampaignRuntime} from './campaign-runtime.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const runtime=createCampaignRuntime({sb,env});
// Every browser route authenticates membership. There is no browser send route.
Deno.serve(campaignHandler({sb,controller:runtime.controller,env}));
