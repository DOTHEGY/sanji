// These operations do not create jobs or retry an uncertain send.
export function instagramDirectInbox({sb,query,connection,remote,env}:any){
 async function account(owner:string){
  const rows=await query(sb.from('sanji_connections').select('provider,summary').eq('owner',owner).like('provider','instagram:%'));
  const valid=rows.filter((r:any)=>r.summary?.connected===true&&r.summary?.apiVerified===true&&String(r.summary?.username||'').toLowerCase()==='valu_est'&&r.provider==='instagram:'+r.summary?.accountId&&/^\d+$/.test(String(r.summary?.accountId)));
  if(valid.length!==1)throw Error('@valu_est 공식 연결을 확인하세요');
  const id=String(valid[0].summary.accountId),session=await connection(owner,valid[0].provider);
  if(!session?.access_token||String(session.id)!==id||String(session.username||'').toLowerCase()!=='valu_est'||!Number.isFinite(Number(session.expires))||Number(session.expires)<=Date.now())throw Error('Instagram 연결이 만료됐거나 계정이 다릅니다');
  return {id,token:session.access_token};
 }
 async function capture(owner:string,e:any){return query(sb.rpc('sanji_instagram_capture',{p_owner:owner,p_account:e.accountId,p_peer:e.peerId,p_mid:e.messageId,p_at:e.receivedAt,p_body:e.text}));}
 async function list(owner:string,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('잘못된 페이지');const a=await account(owner);
  const rows=await query(sb.from('sanji_instagram_inbound').select('account_id,peer_id,message_id,received_at,body').eq('owner',owner).eq('account_id',a.id).order('received_at',{ascending:false}).order('message_id',{ascending:false}).range(offset,offset+500));
  if(!Array.isArray(rows))throw Error('대화 목록 확인 실패');const hasMore=rows.length>500,items=rows.slice(0,500),ids=items.map((x:any)=>x.message_id);
  const attempts:any[]=[],enriched:any[]=[];for(let i=0;i<ids.length;i+=20){const page=await query(sb.from('sanji_instagram_reply_attempts').select('account_id,peer_id,inbound_id,body,status,created_at').eq('owner',owner).eq('account_id',a.id).in('inbound_id',ids.slice(i,i+20)));if(!Array.isArray(page))throw Error('답장 목록 확인 실패');attempts.push(...page);}const placeholders=items.filter((x:any)=>x.body==='본문 없음 또는 조회 불가 · Instagram에서 확인 필요').map((x:any)=>x.message_id);for(let i=0;i<placeholders.length;i+=20){const texts=await query(sb.from('sanji_instagram_inbound_enrichment').select('message_id,body').eq('owner',owner).eq('account_id',a.id).in('message_id',placeholders.slice(i,i+20)));if(!Array.isArray(texts))throw Error('보완된 메시지 확인 실패');enriched.push(...texts);}const confirmed=new Map(enriched.map((x:any)=>[x.message_id,x.body]));return {items:items.map((x:any)=>confirmed.has(x.message_id)?{...x,body:confirmed.get(x.message_id),bodyProvenance:'provider_rechecked'}:x),attempts,offset,hasMore,account:'valu_est',sendingEnabled:env('INSTAGRAM_DIRECT_REPLY_ENABLED')==='true'};
 }
 async function sync(owner:string,cursor?:string){
  let stage='account',reason='account_unavailable';const cursorKind=cursor===undefined?'initial':typeof cursor==='string'&&cursor.startsWith('r1.')?'resume':'provider';
  try{
  const a=await account(owner),version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');
  stage='cursor';reason='invalid_cursor';const validCursor=(x:any)=>typeof x==='string'&&!x.includes('://')&&/^[A-Za-z0-9._~:+\/=-]{1,512}$/.test(x);
  let page:string|undefined,offset=0,threadId:string|undefined,prefix:string[]=[];
  if(cursor?.startsWith('r1.')){try{const data=JSON.parse(atob(cursor.slice(3).replace(/-/g,'+').replace(/_/g,'/')));if((data.page!==null&&!validCursor(data.page))||typeof data.thread!=='string'||!data.thread||data.thread.length>500||!Number.isSafeInteger(data.offset)||data.offset<1||data.offset>19||!Array.isArray(data.prefix)||data.prefix.length!==data.offset||data.prefix.some((x:any)=>typeof x!=='string'||!x||x.length>500))throw Error('invalid');page=data.page||undefined;offset=data.offset;threadId=data.thread;prefix=data.prefix;}catch{throw Error('잘못된 이어보기');}}
  else if(cursor!==undefined){if(!validCursor(cursor))throw Error('잘못된 페이지');page=cursor;}
  const get=async(path:string,fields:URLSearchParams)=>remote('https://graph.instagram.com/'+version+'/'+(path==='me/conversations'?path:encodeURIComponent(path))+'?'+fields.toString(),{headers:{Authorization:'Bearer '+a.token},signal:AbortSignal.timeout(3500)},'Instagram 대화 조회');
  const params=new URLSearchParams({platform:'instagram',limit:'1'});if(page)params.set('after',page);
  stage='conversations';reason='provider_request';const conversations=await get('me/conversations',params);reason='invalid_provider_response';if(!Array.isArray(conversations?.data)||conversations.data.length>1)throw Error('대화 목록 확인 실패');
  reason='conversation_changed_or_invalid';const c=conversations.data[0];if(!c){if(offset||conversations?.paging?.next)throw Error('페이지가 변경되어 다시 확인해야 합니다');return {inserted:0,nextCursor:null,partialMessages:false};}
  if(typeof c.id!=='string'||!c.id||c.id.length>500||(threadId&&threadId!==c.id))throw Error('대화가 변경되어 다시 확인해야 합니다');
  stage='thread';reason='provider_request';const thread=await get(c.id,new URLSearchParams({fields:'messages'})),messages=thread?.messages?.data;reason='invalid_provider_response';if(!Array.isArray(messages))throw Error('메시지 목록 확인 실패');
  reason='messages_changed';if(prefix.some((id,i)=>messages[i]?.id!==id))throw Error('메시지가 변경되어 처음부터 다시 확인해야 합니다');
  let inserted=0,enriched=0,partialMessages=messages.length>20||!!thread.messages.paging?.next;const end=Math.min(messages.length,20,offset+5);
  for(let i=offset;i<end;i++){
   stage='detail';reason='invalid_provider_response';const m=messages[i];if(typeof m?.id!=='string'||!m.id||m.id.length>500)throw Error('메시지 식별자를 확인할 수 없습니다');
   reason='provider_request';const detail=await get(m.id,new URLSearchParams({fields:'id,created_time,from,to,message'}));
   reason='invalid_provider_response';const peer=String(detail.from?.id||''),at=Date.parse(detail.created_time),body=typeof detail.message==='string'?detail.message:'';
   if(detail.id!==m.id||!/^\d+$/.test(peer)||peer===a.id||!detail.to?.data?.some((x:any)=>String(x.id)===a.id)||!Number.isFinite(at)||at>Date.now()+300000)continue;
   if(at<Date.now()-90*86400000||body.length>10000){partialMessages=true;continue;}
   if(!body.trim()){const hasAttachmentField=Object.prototype.hasOwnProperty.call(detail,'attachments');const observation:any={event:'instagram_message_content_observation',message_field_present:Object.prototype.hasOwnProperty.call(detail,'message'),text_present:false,attachment_field_present:hasAttachmentField};if(hasAttachmentField&&Array.isArray(detail.attachments?.data))observation.attachment_present=detail.attachments.data.length>0;console.info(JSON.stringify(observation));}
   stage='store';reason='storage_failed';const receivedAt=new Date(at).toISOString(),stored=await capture(owner,{accountId:a.id,peerId:peer,messageId:detail.id,text:body.trim()?body:'본문 없음 또는 조회 불가 · Instagram에서 확인 필요',receivedAt});if(stored)inserted++;else if(body.trim()&&body!=='본문 없음 또는 조회 불가 · Instagram에서 확인 필요'&&await query(sb.rpc('sanji_instagram_enrich_inbound',{p_owner:owner,p_account:a.id,p_peer:peer,p_mid:detail.id,p_at:receivedAt,p_body:body})))enriched++;
  }
  stage='pagination';reason='invalid_provider_cursor';let nextCursor:string|null=null;
  if(end<Math.min(messages.length,20)){const ids=messages.slice(0,end).map((m:any)=>m?.id);if(ids.some((x:any)=>typeof x!=='string'||!x||x.length>500))throw Error('메시지 식별자를 확인할 수 없습니다');nextCursor='r1.'+btoa(JSON.stringify({page:page||null,thread:c.id,offset:end,prefix:ids})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  else if(conversations?.paging?.next){const after=conversations?.paging?.cursors?.after;if(!validCursor(after))throw Error('다음 페이지 확인 실패');nextCursor=after;}
  return {inserted,enriched,nextCursor,partialMessages};
  }catch(e){const error:any=Error('Instagram 수신 조회를 완료하지 못했습니다.');error.syncStage=stage;const source:any=e;error.syncReason=['TimeoutError','AbortError'].includes(source?.name)?'timeout':reason;error.syncCursorKind=cursorKind;if(Number.isSafeInteger(source?.status)&&source.status>=100&&source.status<=599)error.status=source.status;for(const key of ['httpStatus','metaCode','metaSubcode'])if(Number.isSafeInteger(source?.[key])&&source[key]>=0&&source[key]<=2147483647)error[key]=source[key];throw error;}
 }
 async function reply(owner:string,b:any){
  if(env('INSTAGRAM_DIRECT_REPLY_ENABLED')!=='true')throw Error('Instagram 답장 발송이 비활성화되어 있습니다.');
  if(typeof b.messageId!=='string'||!b.messageId||typeof b.body!=='string'||!b.body.trim()||b.body.length>1000||typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw Error('답장 내용을 확인하세요.');
  const a=await account(owner),r=await query(sb.rpc('sanji_instagram_reserve_reply',{p_owner:owner,p_account:a.id,p_mid:b.messageId,p_request:b.requestId,p_body:b.body}));
  if(!r.reserved)return {status:r.status,duplicate:true,sameRequest:r.sameRequest===true};
  let status='outcome_unknown',providerId=null;
  try{const version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');const res=await remote('https://graph.instagram.com/'+version+'/'+a.id+'/messages',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:r.peerId},message:{text:b.body}})},'Instagram 답장');if(typeof res?.message_id==='string'&&res.message_id){status='accepted';providerId=res.message_id;}}catch{/* Outcome is unknown; never retry automatically. */}
  await query(sb.rpc('sanji_instagram_finish_reply',{p_owner:owner,p_request:b.requestId,p_status:status,p_provider_id:providerId}));return {status};
 }
 return {list,sync,reply};
}
