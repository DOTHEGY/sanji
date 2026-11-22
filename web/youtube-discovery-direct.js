import {createClient} from '@supabase/supabase-js';
import {supabaseUrl,supabaseKey} from './supabase-config.js';
import {mountYouTubeDiscoveryController} from './youtube-discovery.js';

// The legacy direct URL keeps its existing shared persisted session contract.
const client=createClient(supabaseUrl,supabaseKey,{auth:{
  persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce',
}});
const stop=mountYouTubeDiscoveryController(document,{client});
window.addEventListener('pagehide',stop,{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
