import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createPartyumDayStatusHandler} from './partyum-handler.mjs';
import {createPartyumStatusReaders} from './partyum-source.mjs';

const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw Error('Status service is not configured');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createPartyumDayStatusHandler(createPartyumStatusReaders(client)));
