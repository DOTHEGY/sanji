import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {creatorManualNotesHandler} from './handler.ts';
const env = (name: string) => Deno.env.get(name) || '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(creatorManualNotesHandler({sb,env}));
