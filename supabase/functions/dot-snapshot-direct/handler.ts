import {functionRoute} from '../_shared/function-route.ts';
import {validateDotSnapshot} from '../_shared/dot-snapshot.ts';
import {projectDotSnapshot} from '../_shared/dot-snapshot-projection.ts';
// Aggregates only. No discovery, Gmail, Instagram, worker control, or send routes.
export function dotSnapshotHandler({sb,query,env,digest}:any){
 const origin=env('APP_ORIGIN')||'https://dothegy.github.io';
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 return async(req:Request)=>{try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return json({error:'허용되지 않은 출처'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const {path}=functionRoute(req.url,env('SUPABASE_URL')),auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
  const session=await sb.auth.getUser(auth.slice(7)),owner=session?.data?.user?.id;if(session?.error||!owner)return json({error:'로그인 세션을 확인하세요.'},401);
  const member=await query(sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle());if(!member)return json({error:'접근 권한이 없습니다.'},403);
  const input=async()=>{const max=300000,announced=Number(req.headers.get('content-length')||0);if(Number.isFinite(announced)&&announced>max)throw Error('스냅샷이 너무 큽니다.');if(!req.body)return {};const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw Error('스냅샷이 너무 큽니다.');}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}const raw=new TextDecoder().decode(bytes);return raw?JSON.parse(raw):{};};
  if(path==='/dot-snapshot'&&req.method==='GET'){
   const heads=await query(sb.from('sanji_dot_snapshot_head').select('snapshot_id,day').eq('owner',owner).order('day',{ascending:false}).limit(30));if(!Array.isArray(heads))throw Error('조회 실패');
   const rows=heads.length?await query(sb.from('sanji_dot_snapshot').select('snapshot_id,payload,received_at').eq('owner',owner).in('snapshot_id',heads.map((h:any)=>h.snapshot_id))):[];if(!Array.isArray(rows))throw Error('조회 실패');
   const now=new Date().toISOString(),items=rows.map((row:any)=>{const p=validateDotSnapshot(row.payload);const a=p.database_audit,observed=typeof a?.observed_at==='string'&&Number.isFinite(Date.parse(a.observed_at));return {...projectDotSnapshot(row,now),databaseTotal:observed&&Number.isSafeInteger(a?.total_creators)&&a.total_creators>=0?a.total_creators:null,databaseNewSaved:observed&&a?.day===p.day&&Number.isSafeInteger(a?.new_saved)&&a.new_saved>=0?a.new_saved:null,databaseObservedAt:observed?a.observed_at:null};}).sort((a:any,b:any)=>b.day.localeCompare(a.day));
   return json({items,checkedAt:now});
  }
  if(path==='/dot-snapshot/preview'&&req.method==='POST'){const snapshot=validateDotSnapshot(await input()),previewHash=await digest(owner+'\n'+JSON.stringify(snapshot));return json({snapshot,previewHash});}
  if(path==='/dot-snapshot/commit'&&req.method==='POST'){const b=await input(),snapshot=validateDotSnapshot(b.snapshot),hash=await digest(owner+'\n'+JSON.stringify(snapshot));if(b.previewHash!==hash)return json({error:'다시 미리보기를 확인하세요.'},409);return json(await query(sb.rpc('sanji_store_dot_snapshot',{p_owner:owner,p_data:snapshot})));}
  return json({error:'지원하지 않는 경로'},404);
 }catch{return json({error:'원장 요청을 완료하지 못했습니다. 자료와 연결 상태를 확인하세요.'},400);}};
}
