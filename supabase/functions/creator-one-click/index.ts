import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler, submitThroughEngine } from './handler.mjs';
import { processOne } from './processor.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const sb=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function query(p:PromiseLike<any>){const {data,error}=await p;if(error)throw Error('database operation failed');return data;}
const single=(v:any)=>Array.isArray(v)?v[0]:v;
async function fetchOwnedIds(table:string,fields:string,owner:string,ids:string[]){const all:any[]=[];for(let i=0;i<ids.length;i+=100)all.push(...await query(sb.from(table).select(fields).eq('owner',owner).in('id',ids.slice(i,i+100))));return all;}
async function loadRun(owner:string,id:string){
 const run=await query(sb.from('sanji_creator_one_click_runs').select('id,day,target,template_sha256,created,run_kind,paused').eq('owner',owner).eq('id',id).maybeSingle());if(!run)return null;
 const rows=await query(sb.from('sanji_creator_one_click_items').select('creator_id,status,reason,job_id').eq('owner',owner).eq('run_id',id).order('created').limit(500));
 const ids=(rows||[]).map((x:any)=>x.job_id).filter(Boolean),jobs=ids.length?await fetchOwnedIds('sanji_jobs','id,status,run_at',owner,ids):[];
 const byId=new Map((jobs||[]).map((j:any)=>[j.id,j]));
 const creatorIds=(rows||[]).map((x:any)=>x.creator_id),creators=creatorIds.length?await fetchOwnedIds('sanji_creator_recovery','id,handle',owner,creatorIds):[];
 const handles=new Map((creators||[]).map((c:any)=>[c.id,c.handle]));
 return {id:run.id,day:run.day,target:run.target,templateSha256:run.template_sha256,runKind:run.run_kind,paused:run.paused,items:(rows||[]).map((x:any)=>({...x,handle:handles.get(x.creator_id)||'',job:x.job_id?(byId.get(x.job_id)||null):null}))};
}
const loadTemplate=async(owner:string,sha:string)=>{const t=await query(sb.from('sanji_creator_one_click_templates').select('subject,body,sha256').eq('owner',owner).eq('sha256',sha).maybeSingle());return t?{...t,userApproved:true}:null};
const loadContext=async(owner:string,id:string,creatorId:string)=>{
  const item=await query(sb.from('sanji_creator_one_click_items').select('status').eq('owner',owner).eq('run_id',id).eq('creator_id',creatorId).maybeSingle());if(!item||item.status!=='pending')return null;
  const creator=await query(sb.from('sanji_creator_recovery').select('id,handle,emails,bio,bio_status,link_status,profile_url,status,category').eq('owner',owner).eq('id',creatorId).maybeSingle());if(!creator)return null;
  const review=await query(sb.from('sanji_creator_contact_review').select('creator_id,version,data').eq('owner',owner).eq('creator_id',creatorId).maybeSingle());
  const settings=await query(sb.from('sanji_records').select('data').eq('owner',owner).eq('kind','settings').order('updated',{ascending:false}).limit(1).maybeSingle());
  const gmail=await query(sb.from('sanji_connections').select('summary').eq('owner',owner).eq('provider','gmail').maybeSingle());
  let deals:any[]=[],complete=false;for(let start=0;start<2000;start+=500){const part=await query(sb.from('sanji_records').select('id,version,data').eq('owner',owner).eq('kind','deal').order('id').range(start,start+499));deals.push(...(part||[]).map((d:any)=>({...d.data,id:d.id,version:d.version})));if((part||[]).length<500){complete=true;break}}
  return {creator,review,deals,complete,settings:settings?.data||null,gmail:gmail?.summary||null};
 };
const enqueueViaMail=async(owner:string,id:string,creator:string,draft:string,hash:string,at:string,token:string)=>{
  const anonKey=env('SUPABASE_ANON_KEY'),base=env('SUPABASE_URL');if(!anonKey||!base)throw Error('email engine unavailable');
  // Preserve the existing email engine's authorization, Gmail checks, sending gate,
  // suppression and full-history guards. Never call its SQL scheduler directly.
  return await submitThroughEngine({
   claim:async()=>single(await query(sb.rpc('sanji_creator_one_click_claim',{p_owner:owner,p_run:id,p_creator:creator,p_draft:draft,p_hash:hash,p_run_at:at}))),
   forward:async()=>{const response=await fetch(base.replace(/\/$/,'')+'/functions/v1/bright-function/schedule',{method:'POST',headers:{Authorization:'Bearer '+token,apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({draftId:draft,hash,approved:true,runAt:at}),signal:AbortSignal.timeout(20000)});await response.body?.cancel();},
   reconcile:async()=>single(await query(sb.rpc('sanji_creator_one_click_reconcile',{p_owner:owner,p_run:id,p_creator:creator})))
  });
 };
const handler=createHandler({
 origin:env('APP_ORIGIN')||'https://dothegy.github.io',
 auth:async(token:string)=>{const r=await sb.auth.getUser(token);return r.error?null:r.data.user?.id||null},
 member:async(owner:string)=>!!(await query(sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle())),
 getRun:loadRun,
 getLatest:async(owner:string)=>{const row=await query(sb.from('sanji_creator_one_click_runs').select('id').eq('owner',owner).order('created',{ascending:false}).limit(1).maybeSingle());return row?await loadRun(owner,row.id):null},
 getCurrentTemplate:async(owner:string)=>{const row=await query(sb.from('sanji_creator_one_click_templates').select('sha256').eq('owner',owner).order('approved_at',{ascending:false}).limit(1).maybeSingle());return row?await loadTemplate(owner,row.sha256):null},
 getTemplate:loadTemplate,
 getContext:loadContext,
 storeTemplate:async(owner:string,subject:string,body:string,approved:boolean)=>single(await query(sb.rpc('sanji_creator_one_click_template',{p_owner:owner,p_subject:subject,p_body:body,p_approved:approved}))),
 start:async(owner:string,id:string,day:string,target:number,sha:string)=>({count:single(await query(sb.rpc('sanji_creator_one_click_start',{p_owner:owner,p_run:id,p_day:day,p_target:target,p_template_sha256:sha})))}),
 adopt:async(owner:string,id:string,day:string,ids:string[],sha:string,approved:boolean)=>({count:single(await query(sb.rpc('sanji_creator_one_click_adopt',{p_owner:owner,p_run:id,p_day:day,p_ids:ids,p_template_sha256:sha,p_approved:approved})))}),
 skip:async(owner:string,id:string,creator:string,reason:string)=>single(await query(sb.rpc('sanji_creator_one_click_skip',{p_owner:owner,p_run:id,p_creator:creator,p_reason:reason}))),
 pause:async(owner:string,id:string,paused:boolean)=>single(await query(sb.rpc('sanji_creator_one_click_pause',{p_owner:owner,p_run:id,p_paused:paused}))),
 reconcile:async(owner:string,id:string,creator:string)=>single(await query(sb.rpc('sanji_creator_one_click_reconcile',{p_owner:owner,p_run:id,p_creator:creator}))),
 enqueue:enqueueViaMail,
 process:async(owner:string,id:string,creatorId:string,token:string)=>processOne({
  owner,runId:id,creatorId,loadRun,loadContext,loadTemplate,
  markSkip:async(o:string,r:string,c:string,reason:string)=>single(await query(sb.rpc('sanji_creator_one_click_skip',{p_owner:o,p_run:r,p_creator:c,p_reason:reason}))),
  callExisting:async(path:string,body:any)=>{const base=env('SUPABASE_URL'),key=env('SUPABASE_ANON_KEY');if(!base||!key)throw Error('email engine unavailable');const response=await fetch(base.replace(/\/$/,'')+'/functions/v1/bright-function'+path,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!response.ok){await response.body?.cancel();throw Error('mail preparation failed')}return await response.json()},
  queue:async(o:string,r:string,c:string,d:string,h:string,at:string)=>enqueueViaMail(o,r,c,d,h,at,token)
 }),
 // The SQL claim function rechecks exact body, one available deal, creator and
 // non-marketing type. The existing /schedule route performs all mail preflights.
 verifyApprovedDraft:async(input:any)=>{
  let sha=input.templateSha256;
  if(input.phase==='enqueue'){
   const run=await query(sb.from('sanji_creator_one_click_runs').select('template_sha256').eq('owner',input.owner).eq('id',input.runId).maybeSingle());if(!run)return false;sha=run.template_sha256;
  }
  if(!/^[a-f0-9]{64}$/.test(sha||''))return false;
  return !!(await query(sb.from('sanji_creator_one_click_templates').select('sha256').eq('owner',input.owner).eq('sha256',sha).maybeSingle()));
 }
});
Deno.serve(handler);
