import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {Buffer} from 'node:buffer';
import {dotSnapshotHandler} from './handler.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function query(p:any){const {data,error}=await p;if(error)throw Error('database request failed');return data;}
const digest=async(s:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
Deno.serve(dotSnapshotHandler({sb,query,env,digest}));
