import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {youtubeDiscoveryHandler} from './handler.mjs';
const env = (name: string) => Deno.env.get(name) || '';
// Existing server credential only; never sent to YouTube or the frontend.
const sb = createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(youtubeDiscoveryHandler({sb,env}));
