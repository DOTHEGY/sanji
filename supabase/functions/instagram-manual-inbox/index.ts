import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {readManualConnection,readManualConnectionFingerprint} from '../_shared/instagram-manual-connection.ts';
import {instagramManualInboxHandler} from './handler.ts';
import {createManualRemote} from './runtime.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function query(p:any){const {data,error}=await p;if(error)throw Error('database request failed');return data;}
async function key(){const secret=env('TOKEN_ENCRYPTION_KEY');if(!secret)throw Error('encryption key unavailable');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['decrypt']);}
async function connection(owner:string,provider:string){return readManualConnection({sb,query,key},owner,provider);}
async function connectionFingerprint(owner:string,provider:string){return readManualConnectionFingerprint({sb,query},owner,provider);}
const remote=createManualRemote();
Deno.serve(instagramManualInboxHandler({sb,query,env,connection,connectionFingerprint,remote}));
