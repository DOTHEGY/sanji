// Additive worker only. Do not import or deploy the workspace/bright-function app.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {creatorEmailRuntime,creatorEmailHandler} from '../_shared/creator-email-isolated-runtime.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const worker=creatorEmailRuntime({sb,env});
Deno.serve(creatorEmailHandler({run:()=>worker.run(),env}));
