import {instagramInboundEvents,verifyInstagramSignature} from './creator-instagram-events.ts';
// These operations do not create jobs or retry an uncertain send.
export function creatorInstagramInbox({sb,query,connection,remote,env}:any){
 async function account(owner:string){
  const rows=await query(sb.from('sanji_connections').select('provider,summary').eq('owner',owner).like('provider','instagram:%'));
  const valid=rows.filter((r:any)=>r.summary?.connected===true&&r.summary?.apiVerified===true&&String(r.summary?.username||'').toLowerCase()==='valu_est'&&r.provider==='instagram:'+r.summary?.accountId&&/^\d+$/.test(String(r.summary?.accountId)));
  if(valid.length!==1)throw Error('@valu_est 공식 연결을 확인하세요');
  const id=String(valid[0].summary.accountId),session=await connection(owner,valid[0].provider);
  if(!session?.access_token||String(session.id)!==id||String(session.username||'').toLowerCase()!=='valu_est'||!Number.isFinite(Number(session.expires))||Number(session.expires)<=Date.now())throw Error('Instagram 연결이 만료됐거나 계정이 다릅니다');
  return {id,token:session.access_token};
 }
 async function capture(owner:string,e:any){return query(sb.rpc('sanji_instagram_capture',{p_owner:owner,p_account:e.accountId,p_peer:e.peerId,p_mid:e.messageId,p_at:e.receivedAt,p_body:e.text}));}
 async function webhook(req:Request){
  const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>1048576||!await verifyInstagramSignature(raw,req.headers.get('x-hub-signature-256')||'',env('META_APP_SECRET')))throw Error('서명 검증 실패');
  let payload:any;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{throw Error('invalid event');}
  const events=instagramInboundEvents(payload);
  for(const e of events){
   const rows=await query(sb.from('sanji_connections').select('owner,provider,summary').eq('provider','instagram:'+e.accountId));
   const matches=rows.filter((r:any)=>r.summary?.connected===true&&r.summary?.apiVerified===true&&r.summary?.accountId===e.accountId&&String(r.summary?.username||'').toLowerCase()==='valu_est');
   if(matches.length!==1)continue;
   await capture(matches[0].owner,e);
  }
  return {ok:true};
 }
 async function list(owner:string){const a=await account(owner);const items=await query(sb.from('sanji_instagram_inbound').select('account_id,peer_id,message_id,received_at,body').eq('owner',owner).eq('account_id',a.id).order('received_at',{ascending:false}).limit(500));const attempts=await query(sb.from('sanji_instagram_reply_attempts').select('account_id,peer_id,inbound_id,body,status,created_at').eq('owner',owner).eq('account_id',a.id).order('created_at',{ascending:false}).limit(500));return {items,attempts,account:'valu_est',sendingEnabled:env('INSTAGRAM_SENDING_ENABLED')==='true'};}
 async function sync(owner:string){
  const a=await account(owner),version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');
  const get=async(path:string,fields:string)=>remote('https://graph.instagram.com/'+version+'/'+path.split('/').map(encodeURIComponent).join('/')+'?'+fields,{headers:{Authorization:'Bearer '+a.token}},'Instagram 대화 조회');
  const conversations=await get('me/conversations','platform=instagram&limit=10');let inserted=0;
  for(const c of (conversations.data||[]).slice(0,10)){
   if(typeof c.id!=='string'||c.id.length>500)continue;
   const thread=await get(c.id,'fields=messages');
   for(const m of (thread.messages?.data||[]).slice(0,10)){
    if(typeof m.id!=='string'||m.id.length>500)continue;
    const detail=await get(m.id,'fields=id,created_time,from,to,message');
    const peer=String(detail.from?.id||''),at=Date.parse(detail.created_time);
    if(detail.id!==m.id||!/^\d+$/.test(peer)||peer===a.id||!detail.to?.data?.some((x:any)=>String(x.id)===a.id)||typeof detail.message!=='string'||!detail.message.trim()||!Number.isFinite(at)||at>Date.now()+300000)continue;
    if(await capture(owner,{accountId:a.id,peerId:peer,messageId:detail.id,text:detail.message,receivedAt:new Date(at).toISOString()}))inserted++;
   }
  }
  return {inserted};
 }
 async function reply(owner:string,b:any){
  if(env('INSTAGRAM_SENDING_ENABLED')!=='true')throw Error('Instagram 답장 발송이 비활성화되어 있습니다.');
  if(typeof b.messageId!=='string'||!b.messageId||typeof b.body!=='string'||!b.body.trim()||b.body.length>1000||typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw Error('답장 내용을 확인하세요.');
  const a=await account(owner),r=await query(sb.rpc('sanji_instagram_reserve_reply',{p_owner:owner,p_account:a.id,p_mid:b.messageId,p_request:b.requestId,p_body:b.body}));
  if(!r.reserved)return {status:r.status,duplicate:true,sameRequest:r.sameRequest===true};
  let status='outcome_unknown',providerId=null;
  try{const version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');const res=await remote('https://graph.instagram.com/'+version+'/'+a.id+'/messages',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:r.peerId},message:{text:b.body}})},'Instagram 답장');if(typeof res?.message_id==='string'&&res.message_id){status='accepted';providerId=res.message_id;}}catch{/* Outcome is unknown; never retry automatically. */}
  await query(sb.rpc('sanji_instagram_finish_reply',{p_owner:owner,p_request:b.requestId,p_status:status,p_provider_id:providerId}));return {status};
 }
 return {webhook,list,sync,reply};
}
