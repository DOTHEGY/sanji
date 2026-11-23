// Separate Partyum privileged Edge runtime; no injected CT secret values.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import pg from 'npm:pg@8.16.3';
import {createPartyumProductionRuntime} from '../production-runtime.mjs';

const env=(name:string)=>Deno.env.get(name)||'';
const url=env('SUPABASE_URL'),role=env('SUPABASE_SERVICE_ROLE_KEY'),dsn=env('SUPABASE_DB_URL');
if(!url||!role||!dsn)throw Error('Partyum standard service environment is absent');
const sb=createClient(url,role,{auth:{persistSession:false,autoRefreshToken:false}});
// Production rollout must independently confirm TLS and that the existing DSN
// can SET LOCAL ROLE service_role. No new privileged direct-client permission.
const connection=new URL(dsn);
if(!['postgres:','postgresql:'].includes(connection.protocol))throw Error('Invalid standard Partyum connection scheme');
// pg's DSN TLS query options can override the explicit ssl object. Use only
// our verified-TLS configuration; do not silently allow sslmode downgrades.
for(const k of [...connection.searchParams.keys()]){
 if(['ssl','sslmode','sslrootcert','sslcert','sslkey','sslcertmode','uselibpqcompat'].includes(k.toLowerCase()))connection.searchParams.delete(k);
}
const pool=new pg.Pool({connectionString:connection.toString(),max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:3200,
 statement_timeout:12000,ssl:{rejectUnauthorized:true}});
const scheduler=(globalThis as unknown as {EdgeRuntime?:{waitUntil(p:Promise<unknown>):void}}).EdgeRuntime;
const waitUntil=typeof scheduler?.waitUntil==='function'
 ?(p:Promise<unknown>)=>scheduler.waitUntil(p)
 :undefined;
export default await createPartyumProductionRuntime({pool,sb,env,waitUntil});
