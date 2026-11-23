import {PROJECT} from './partyum-mail.mjs';
const query='select send_enabled from sanji_partyum_internal.partyum_runtime_controls where project_id=$1';
const answer=(allowed,code=null)=>Object.freeze({allowed,code});
export function createPartyumControls({pool,initTx,env}){
 if(!pool?.connect||typeof initTx!=='function'||typeof env!=='function')throw Error('Partyum controls unavailable');
 async function read(q){
  const {rows}=await q.query(query,[PROJECT]);
  if(rows.length!==1||typeof rows[0].send_enabled!=='boolean')return answer(false,'PARTYUM_CONTROL_UNAVAILABLE');
  return rows[0].send_enabled?answer(true):answer(false,'PARTYUM_DISABLED');
 }
 return async (existingTx=null)=>{
  if(env('EMAIL_SENDING_ENABLED')!=='true')return answer(false,'GLOBAL_EMAIL_DISABLED');
  if(existingTx){try{return await read(existingTx);}catch{return answer(false,'PARTYUM_CONTROL_UNAVAILABLE');}}
  let q;
  try{
   q=await pool.connect();await q.query('begin read only');await initTx(q);
   const value=await read(q);await q.query('commit');return value;
  }catch{
   if(q)try{await q.query('rollback');}catch{}
   return answer(false,'PARTYUM_CONTROL_UNAVAILABLE');
  }finally{q?.release();}
 };
}
