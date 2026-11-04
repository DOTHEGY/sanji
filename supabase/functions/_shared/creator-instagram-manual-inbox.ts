import {manualCursor} from './instagram-manual-cursor.ts';
// Separate read-only Instagram inbox. Never sends a DM or accesses a message
// until the provider's conversation participants uniquely match a saved creator.
const LIMITATION='회당 대화 1개와 메시지 최대 4개를 확인하며 다음 보기를 통해 이어갑니다. Meta가 반환한 메시지 페이지를 이어서 확인합니다. Meta가 제공하는 범위만 표시됩니다. 요청함·첨부·오래된 메시지 또는 추가 페이지가 누락될 수 있습니다. Instagram에서 마지막 발신 여부를 확인하세요.';
// A bounded history detects every repeated provider cursor within this traversal.
// Stop at the bound rather than forgetting old entries and allowing longer cycles.
const CURSOR_HISTORY_LIMIT=100;
// JSONB adds separator whitespace; reserve a generous margin under the 20000-byte SQL cap.
export const syncCursorPayloadFits=(value:any)=>new TextEncoder().encode(JSON.stringify(value)).length<=19000;
const validGeneration=(s:any)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const validHandle=(s:any)=>typeof s==='string'&&/^[a-z0-9._]{1,30}$/.test(s)&&!['.','..'].includes(s);
export function koreanTenDayStart(now=Date.now()){return new Date(Math.floor((now+9*3600000)/86400000)*86400000-9*3600000-9*86400000).toISOString();}
export function creatorInstagramManualInbox({sb,query,connection,connectionFingerprint,remote,env}:any){
 async function account(owner:string,needToken=false){
  const rows=await query(sb.from('sanji_connections').select('provider,summary').eq('owner',owner).like('provider','instagram:%'));
  const valid=rows.filter((r:any)=>r.summary?.connected===true&&r.summary?.apiVerified===true&&String(r.summary?.username||'').toLowerCase()==='valu_est'&&r.provider==='instagram:'+r.summary?.accountId&&/^\d{1,100}$/.test(String(r.summary?.accountId)));
  if(valid.length!==1)throw Error('@valu_est 공식 연결을 확인하세요');
  const id=String(valid[0].summary.accountId);if(!needToken)return {id,token:''};
  const s=await connection(owner,valid[0].provider);
  if(!s?.access_token||String(s.id)!==id||String(s.username||'').toLowerCase()!=='valu_est'||!Number.isFinite(Number(s.expires))||Number(s.expires)<=Date.now()||typeof s.connectionFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.connectionFingerprint))throw Error('Instagram 연결이 만료됐거나 계정이 다릅니다');
  return {id,token:s.access_token,fingerprint:s.connectionFingerprint,expires:Number(s.expires)};
 }
 const cursors=manualCursor(sb,query);
 async function list(owner:string,cursor?:string){
  const a=await account(owner),since=koreanTenDayStart(),v=cursor?await cursors.read(cursor,{kind:'directory',owner,account:a.id,since}):null;
  if(v&&(!/^\d{1,100}$/.test(v.peer)||!validGeneration(v.creator)||!validGeneration(v.creatorGeneration)||!validGeneration(v.generation)))throw Error(cursors.error);
  const r=await query(sb.rpc('sanji_ig_manual_list',{p_owner:owner,p_account:a.id,p_since:since,p_after_peer:v?.peer||null,p_after_creator:v?.creator||null,p_after_generation:v?.generation||null}));
  if(r?.tooMany)throw Error('저장된 내용이 표시 한도를 초과해 목록을 불러오지 못했습니다.');
  if(!r||r.accountValid!==true||r.anchorValid!==true||typeof r.hasMore!=='boolean'||!Array.isArray(r.items)||!Array.isArray(r.draftConversations)||!Array.isArray(r.staleConversations))throw Error(cursors.error);
  let nextCursor=null;if(r.hasMore){const n=r.nextAnchor;if(!n||!/^\d{1,100}$/.test(n.peer)||!validGeneration(n.creator)||!validGeneration(n.creatorGeneration)||!validGeneration(n.generation))throw Error(cursors.error);nextCursor=await cursors.issue({kind:'directory',owner,account:a.id,since,...n});}
  return {items:r.items,draftConversations:r.draftConversations,account:'valu_est',sendingEnabled:false,expiredMatches:r.expiredMatches,staleConversations:r.staleConversations,nextCursor,complete:!r.hasMore,limitation:LIMITATION+' 페이지 사이 새 항목은 처음부터 새로고침해야 보일 수 있습니다.'};
 }
 async function thread(owner:string,b:any){
  if(!b||typeof b.peerId!=='string'||!/^\d{1,100}$/.test(b.peerId)||!validGeneration(b.conversationGeneration))throw Error(cursors.error);
  const a=await account(owner),since=koreanTenDayStart(),v=b.cursor?await cursors.read(b.cursor,{kind:'thread',owner,account:a.id,since,peer:b.peerId,generation:b.conversationGeneration}):null;
  if(v&&(!validGeneration(v.creator)||typeof v.at!=='string'||!Number.isFinite(Date.parse(v.at))||typeof v.messageId!=='string'||!v.messageId||v.messageId.length>500))throw Error(cursors.error);
  const r=await query(sb.rpc('sanji_ig_manual_thread',{p_owner:owner,p_account:a.id,p_since:since,p_peer:b.peerId,p_generation:b.conversationGeneration,p_creator:v?.creator||null,p_before_at:v?.at||null,p_before_id:v?.messageId||null}));
  if(r?.tooMany)throw Error('저장된 내용이 표시 한도를 초과해 목록을 불러오지 못했습니다.');
  if(!r||r.accountValid!==true||r.targetValid!==true||r.anchorValid!==true||typeof r.hasMore!=='boolean'||!Array.isArray(r.items)||!validGeneration(r.creatorId)||!validGeneration(r.creatorGeneration)||!validGeneration(r.conversationRevision)||!validHandle(r.username)||r.conversationGeneration!==b.conversationGeneration||r.peerId!==b.peerId)throw Error(cursors.error);
  let nextCursor=null;if(r.hasMore){const n=r.nextAnchor;if(!n||typeof n.at!=='string'||!Number.isFinite(Date.parse(n.at))||typeof n.messageId!=='string'||!n.messageId||n.messageId.length>500)throw Error(cursors.error);nextCursor=await cursors.issue({kind:'thread',owner,account:a.id,since,peer:b.peerId,generation:b.conversationGeneration,creator:r.creatorId,creatorGeneration:r.creatorGeneration,...n});}
  return {peerId:b.peerId,creatorId:r.creatorId,username:r.username,conversationGeneration:b.conversationGeneration,conversationRevision:r.conversationRevision,items:r.items,draft:r.draft||null,nextCursor,complete:!r.hasMore,limitation:LIMITATION+' 페이지 사이 새 메시지는 새로고침해야 보일 수 있습니다.'};
 }
 async function sync(owner:string,b:any={}){
  let consumed=false;try{
  const a=await account(owner,true),version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');
  const validCursor=(x:any)=>typeof x==='string'&&!x.includes('://')&&/^[A-Za-z0-9._~:+\/=-]{1,512}$/.test(x);
  const raw=b?.cursor,since=koreanTenDayStart();let providerCursor:string|undefined,threadId:string|undefined,messageCursor:string|undefined,offset=0,expectedHash='',resume:any=null,providerHistory:string[]=[],messageHistory:string[]=[];
  const validHistory=(h:any)=>Array.isArray(h)&&h.length<=CURSOR_HISTORY_LIMIT&&h.every((x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))&&new Set(h).size===h.length;
  const digest=async(value:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');
  if(raw!==undefined){const v=await cursors.read(raw,{kind:'sync',owner,account:a.id,since});consumed=true;if(!validHistory(v.providerHistory)||!validHistory(v.messageHistory))throw Error(cursors.error);providerHistory=v.providerHistory;messageHistory=v.messageHistory;if(v.phase==='provider'){if(messageHistory.length||!validCursor(v.page))throw Error(cursors.error);providerCursor=v.page;}else if(v.phase==='resume'){if((v.page!==null&&!validCursor(v.page))||typeof v.thread!=='string'||!v.thread||v.thread.length>500||!Number.isSafeInteger(v.offset)||v.offset<0||v.offset>996||v.offset%4!==0||(v.offset===0&&!validCursor(v.message))||(v.message!==null&&!validCursor(v.message))||!/^[a-f0-9]{64}$/.test(v.hash)||!/^[a-f0-9]{64}$/.test(v.providerNextHash)||!/^\d{1,100}$/.test(v.peer)||!validGeneration(v.creator)||!validGeneration(v.creatorGeneration)||!validGeneration(v.generation)||!validGeneration(v.syncId))throw Error(cursors.error);providerCursor=v.page||undefined;threadId=v.thread;messageCursor=v.message||undefined;offset=v.offset;expectedHash=v.hash;resume=v;}else throw Error(cursors.error);if(providerCursor&&!providerHistory.includes(await digest(providerCursor)))throw Error(cursors.error);if(messageCursor&&!messageHistory.includes(await digest(messageCursor)))throw Error(cursors.error);}
  let calls=0;const get=async(path:string,params:Record<string,string>,messageEdge=false)=>{if(++calls>7)throw Error('provider budget exceeded');return remote('https://graph.instagram.com/'+version+'/'+(path==='me/conversations'&&!messageEdge?path:encodeURIComponent(path)+(messageEdge?'/messages':''))+'?'+new URLSearchParams(params),{method:'GET',headers:{Authorization:'Bearer '+a.token},signal:AbortSignal.timeout(3500)},'Instagram 대화 조회');};
  const hashIds=digest;
  const params:any={platform:'instagram',limit:'1',fields:'id,updated_time,participants{id,username}'};if(providerCursor)params.after=providerCursor;
  const page=await get('me/conversations',params);if(!Array.isArray(page?.data)||page.data.length>1)throw Error('대화 목록 페이지 크기 오류');
  const more=!!page?.paging?.next,after=page?.paging?.cursors?.after,providerNextHash=await digest([more,validCursor(after)?after:null]);if(resume&&resume.providerNextHash!==providerNextHash)return {processed:0,matched:0,unverified:0,scanned:0,complete:false,partial:true,nextCursor:null,limitation:LIMITATION+' Meta 대화 목록이 조회 중 변경되어 중단했습니다. 결과가 불완전합니다.'};let nextCursor:string|null=null,partial=more&&!validCursor(after),processed=0,matched=0,unverified=0,stopReason='';
  const limitation=()=>LIMITATION+(stopReason?' '+stopReason:'');
  const issueSync=async(value:any)=>{if(!syncCursorPayloadFits(value)){partial=true;stopReason='페이지 이어보기 정보가 저장 한도를 넘어 조회를 중단했습니다. 결과가 불완전합니다.';return null;}return cursors.issue(value);};
  const addCursor=async(value:string,history:string[])=>{const hash=await digest(value);if(history.includes(hash)){partial=true;stopReason='Meta 페이지 커서가 반복되어 조회를 중단했습니다. 결과가 불완전합니다.';return null;}if(history.length>=CURSOR_HISTORY_LIMIT){partial=true;stopReason='안전한 페이지 확인 한도에 도달해 조회를 중단했습니다. 결과가 불완전합니다.';return null;}return [...history,hash];};
  const nextProviderHistory=more&&validCursor(after)?await addCursor(after,providerHistory):null;
  if(more&&validCursor(after)&&!nextProviderHistory)return {processed,matched,unverified,scanned:0,complete:false,partial:true,nextCursor:null,limitation:limitation()};
  const nextProvider=async()=>nextProviderHistory?await issueSync({kind:'sync',phase:'provider',owner,account:a.id,since,page:after,providerHistory:nextProviderHistory,messageHistory:[]}):null;
  const c=page.data[0];if(!c){if(threadId||more)throw Error('대화 목록이 변경됐습니다');return {processed,matched,unverified,scanned:0,complete:true,partial:false,nextCursor:null,limitation:limitation()};}
  if(typeof c.id!=='string'||!c.id||c.id.length>500||['.','..'].includes(c.id)||(threadId&&c.id!==threadId)||!Array.isArray(c.participants?.data)||c.participants.data.length!==2||!!c.participants?.paging?.next){if(threadId)throw Error('대화가 변경됐습니다');return {processed,matched,unverified:1,scanned:1,complete:false,partial:true,nextCursor:await nextProvider(),limitation:limitation()};}
  const ps=c.participants.data,own=ps.filter((x:any)=>String(x.id)===a.id),peers=ps.filter((x:any)=>String(x.id)!==a.id);
  if(own.length!==1||peers.length!==1){if(threadId)throw Error('대화가 변경됐습니다');return {processed,matched,unverified:1,scanned:1,complete:false,partial:true,nextCursor:await nextProvider(),limitation:limitation()};}
  const peer=peers[0],peerId=String(peer?.id||''),username=String(peer?.username||'').toLowerCase(),updated=Date.parse(c.updated_time),start=Date.parse(koreanTenDayStart());
  if(!/^\d{1,100}$/.test(peerId)||!validHandle(username)){if(threadId)throw Error('대화가 변경됐습니다');return {processed,matched,unverified:1,scanned:1,complete:false,partial:true,nextCursor:await nextProvider(),limitation:limitation()};}
  if(Number.isFinite(updated)&&updated<start){if(threadId)throw Error('대화가 변경됐습니다');return {processed,matched,unverified,scanned:1,complete:!more&&!partial,partial,nextCursor:await nextProvider(),limitation:limitation()};}
  if(resume&&peerId!==resume.peer)throw Error(cursors.error);
  const syncId=crypto.randomUUID(),target=await query(sb.rpc('sanji_ig_manual_acquire_target',{p_owner:owner,p_account:a.id,p_peer:peerId,p_username:username,p_conversation:c.id,p_updated:Number.isFinite(updated)?new Date(updated).toISOString():null,p_sync:syncId,p_expected_creator:resume?.creator||null,p_expected_creator_generation:resume?.creatorGeneration||null,p_expected_conversation_generation:resume?.generation||null,p_expected_sync:resume?.syncId||null}));
  if(!target){if(threadId)throw Error('대화가 변경됐습니다');return {processed,matched,unverified:1,scanned:1,complete:false,partial:true,nextCursor:await nextProvider(),limitation:limitation()};}if(!validGeneration(target.creatorId)||!validGeneration(target.creatorGeneration)||!validGeneration(target.conversationGeneration))throw Error('대화 상태가 변경됐습니다');matched++;const creator={id:target.creatorId},creatorGeneration=target.creatorGeneration,generation=target.conversationGeneration;
  const assertConnection=async()=>{const current=await connectionFingerprint(owner,'instagram:'+a.id);if(!current||current!==a.fingerprint||a.expires<=Date.now())throw Error('Instagram 연결 상태가 변경됐습니다');};
  const assertActive=async()=>{await assertConnection();if(!await query(sb.rpc('sanji_ig_manual_sync_active',{p_owner:owner,p_account:a.id,p_peer:peerId,p_creator:creator.id,p_creator_generation:creatorGeneration,p_generation:generation,p_sync:syncId})))throw Error('대화 상태가 변경됐습니다');};
  await assertActive();
  const thread=messageCursor?await get(c.id,{limit:'20',after:messageCursor},true):await get(c.id,{fields:'messages'}),messagePage=messageCursor?thread:thread?.messages,data=messagePage?.data;await assertActive();if(!Array.isArray(data)||data.length>1000)throw Error('메시지 목록 확인 실패');
  const limit=data.length,end=Math.min(limit,offset+4);
  if(offset>limit)throw Error('메시지 목록이 변경됐습니다');
  const prefix=data.slice(0,offset).map((x:any)=>x?.id);if(prefix.some((x:any)=>typeof x!=='string'||!x||x.length>500)||(threadId&&await hashIds(prefix)!==expectedHash))throw Error('메시지 목록이 변경됐습니다');
  const nextMessage=messagePage?.paging?.cursors?.after,messageRepeated=!!messagePage?.paging?.next&&validCursor(nextMessage)&&messageHistory.includes(await digest(nextMessage)),nextMessageHistory=messagePage?.paging?.next&&validCursor(nextMessage)?await addCursor(nextMessage,messageHistory):null;
  if(messagePage?.paging?.next&&validCursor(nextMessage)&&!nextMessageHistory){
   // Leave this conversation incomplete. Only a separate, explicit user action
   // may consume the independently validated provider continuation.
   const nextConversationCursor=messageRepeated?await nextProvider():null;
   return {processed,matched,unverified,scanned:1,complete:false,partial:true,nextCursor:null,...(nextConversationCursor?{nextConversationCursor,gap:{kind:'message_cursor_repeated',messagesComplete:false,incompleteConversations:1}}:{}),limitation:limitation()};
  }
  let uncertain=!!messagePage?.paging?.next||data.length>4||data.length===0||offset>0||!!messageCursor||!Number.isFinite(updated);const observed:any[]=[],pending:any[]=[];
  for(const m of data.slice(offset,end)){
   if(typeof m?.id!=='string'||!m.id||m.id.length>500||['.','..'].includes(m.id)){uncertain=true;continue;}
   await assertActive();const d=await get(m.id,{fields:'id,created_time,from,to,message'});await assertActive();const at=Date.parse(d?.created_time),from=String(d?.from?.id||''),to=Array.isArray(d?.to?.data)&&!d?.to?.paging?.next?d.to.data.map((x:any)=>String(x.id)):[],direction=from===peerId&&to.length===1&&to[0]===a.id?'inbound':from===a.id&&to.length===1&&to[0]===peerId?'outbound':'';
   if(d?.id!==m.id||!direction||!Number.isFinite(at)||at>Date.now()+300000||typeof d.message!=='string'||!d.message.trim()||d.message.length>10000){uncertain=true;continue;}
   observed.push({at,direction});if(at<start||direction!=='inbound')continue; // Never persist outbound body; direction remains review.
   pending.push({id:m.id,at:new Date(at).toISOString(),body:d.message,direction});
  }
  observed.sort((x,y)=>y.at-x.at);if(observed.length>1&&observed[0].at===observed[1].at&&observed[0].direction!==observed[1].direction)uncertain=true;
  if(Number.isFinite(updated)&&(!observed.length||updated>observed[0].at))uncertain=true;
  if(uncertain)partial=true;const last='review'; // Provider ordering/completeness is not a latest-direction guarantee.
  await assertActive();const verified=await get(c.id,{fields:'id,updated_time,participants{id,username}'});await assertActive();const vp=verified?.participants?.data,vu=Date.parse(verified?.updated_time);if(verified?.id!==c.id||!Array.isArray(vp)||vp.length!==2||!!verified?.participants?.paging?.next||vp.filter((x:any)=>String(x?.id)===a.id).length!==1||vp.filter((x:any)=>String(x?.id)===peerId&&String(x?.username||'').toLowerCase()===username).length!==1||!Number.isFinite(vu)||!Number.isFinite(updated)||vu!==updated)throw Error('대화 확인 상태가 변경됐습니다');for(const m of pending){await assertActive();const stored=await query(sb.rpc('sanji_ig_manual_store_sync',{p_owner:owner,p_account:a.id,p_peer:peerId,p_creator:creator.id,p_creator_generation:creatorGeneration,p_generation:generation,p_sync:syncId,p_mid:m.id,p_at:m.at,p_body:m.body,p_direction:m.direction}));if(!stored)throw Error('대화 상태가 변경됐습니다');processed++;}await assertActive();const finalized=await query(sb.from('sanji_ig_manual_conversations').update({last_direction:last,sync_in_progress:false,provider_updated_at:Number.isFinite(updated)?new Date(updated).toISOString():null,checked_at:new Date().toISOString(),conversation_revision:crypto.randomUUID()}).eq('owner',owner).eq('account_id',a.id).eq('peer_id',peerId).eq('creator_id',creator.id).eq('creator_generation_id',creatorGeneration).eq('generation_id',generation).eq('content_conflict',false).eq('sync_in_progress',true).eq('conversation_id',c.id).eq('sync_id',syncId).select('peer_id'));if(!Array.isArray(finalized)||finalized.length!==1)throw Error('대화 상태가 변경됐습니다');
  if(end<limit){const ids=data.slice(0,end).map((x:any)=>x?.id);if(ids.some((x:any)=>typeof x!=='string'||!x||x.length>500))throw Error('메시지 식별자 오류');nextCursor=await issueSync({kind:'sync',phase:'resume',owner,account:a.id,since,page:providerCursor||null,message:messageCursor||null,thread:c.id,offset:end,hash:await hashIds(ids),peer:peerId,creator:creator.id,creatorGeneration,generation,syncId,providerNextHash,providerHistory,messageHistory});}
  else if(messagePage?.paging?.next){if(nextMessageHistory)nextCursor=await issueSync({kind:'sync',phase:'resume',owner,account:a.id,since,page:providerCursor||null,message:nextMessage,thread:c.id,offset:0,hash:await hashIds([]),peer:peerId,creator:creator.id,creatorGeneration,generation,syncId,providerNextHash,providerHistory,messageHistory:nextMessageHistory});else{nextCursor=null;partial=true;}}
  else nextCursor=await nextProvider();
  return {processed,matched,unverified,scanned:1,complete:!nextCursor&&!partial&&!more,partial,nextCursor,limitation:limitation()};
  }catch(e:any){if(e?.status===429){e.retryCursor=null;e.restartRequired=consumed;}throw e;}
 }
 async function reverify(owner:string,b:any){
  if(!b||typeof b.peerId!=='string'||!/^\d{1,100}$/.test(b.peerId)||!validGeneration(b.conversationGeneration))throw Error('상대 계정을 확인하세요');
  const expectedGeneration=b.conversationGeneration;const a=await account(owner,true),c=await query(sb.from('sanji_ig_manual_conversations').select('peer_id,creator_id,creator_generation_id,username,conversation_id,generation_id,sync_id,provider_updated_at,sync_in_progress').eq('owner',owner).eq('account_id',a.id).eq('peer_id',b.peerId).maybeSingle());
  if(!c||c.sync_in_progress!==false||c.generation_id!==expectedGeneration||!validGeneration(c.creator_generation_id)||typeof c.conversation_id!=='string'||!c.conversation_id||c.conversation_id.length>500||['.','..'].includes(c.conversation_id))throw Error('일치 대화가 없습니다');
  const version=env('META_GRAPH_VERSION')||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('invalid version');
  const check=async()=>{const current=await connectionFingerprint(owner,'instagram:'+a.id);if(!current||current!==a.fingerprint||a.expires<=Date.now())throw Error('Instagram 연결 상태가 변경됐습니다');if(!await query(sb.rpc('sanji_ig_manual_sync_active',{p_owner:owner,p_account:a.id,p_peer:c.peer_id,p_creator:c.creator_id,p_creator_generation:c.creator_generation_id,p_generation:expectedGeneration,p_sync:c.sync_id})))throw Error('대화 상태가 변경됐습니다');};await check();
  const invalidated=await query(sb.from('sanji_ig_manual_conversations').update({checked_at:'1970-01-01T00:00:00.000Z',conversation_revision:crypto.randomUUID(),last_direction:'review'}).eq('owner',owner).eq('account_id',a.id).eq('peer_id',c.peer_id).eq('creator_id',c.creator_id).eq('creator_generation_id',c.creator_generation_id).eq('generation_id',expectedGeneration).eq('content_conflict',false).eq('sync_in_progress',false).eq('sync_id',c.sync_id).select('peer_id'));if(!Array.isArray(invalidated)||invalidated.length!==1)throw Error('대화 상태가 변경됐습니다');
  const metadata=await remote('https://graph.instagram.com/'+version+'/'+encodeURIComponent(c.conversation_id)+'?'+new URLSearchParams({fields:'id,updated_time,participants{id,username}'}),{method:'GET',headers:{Authorization:'Bearer '+a.token},signal:AbortSignal.timeout(3500)},'Instagram 참가자 확인');
  await check();const ps=metadata?.participants?.data;if(metadata?.id!==c.conversation_id||!Array.isArray(ps)||ps.length!==2||!!metadata?.participants?.paging?.next||ps.filter((x:any)=>String(x?.id)===a.id).length!==1||ps.filter((x:any)=>String(x?.id)===c.peer_id&&String(x?.username||'').toLowerCase()===c.username).length!==1)throw Error('참가자가 일치하지 않습니다');
  const updated=Date.parse(metadata.updated_time),previous=Date.parse(c.provider_updated_at);if(!Number.isFinite(updated)||!Number.isFinite(previous)||updated!==previous)throw Error('원문 변경 여부를 확인할 수 없습니다. 다시 동기화하세요');const rows=await query(sb.from('sanji_ig_manual_conversations').update({provider_updated_at:Number.isFinite(updated)?new Date(updated).toISOString():null,checked_at:new Date().toISOString(),last_direction:'review',sync_id:crypto.randomUUID(),conversation_revision:crypto.randomUUID()}).eq('owner',owner).eq('account_id',a.id).eq('peer_id',c.peer_id).eq('creator_id',c.creator_id).eq('username',c.username).eq('conversation_id',c.conversation_id).eq('generation_id',expectedGeneration).eq('content_conflict',false).eq('sync_in_progress',false).eq('sync_id',c.sync_id).select('peer_id'));
  if(!Array.isArray(rows)||rows.length!==1)throw Error('일치 대화가 변경됐습니다');return {verified:true,conversationGeneration:expectedGeneration};
 }
 async function saveDraft(owner:string,b:any){
  if(!b||!/^\d{1,100}$/.test(String(b.peerId||''))||typeof b.body!=='string'||b.body.length>10000||!validGeneration(b.conversationGeneration)||!Object.prototype.hasOwnProperty.call(b,'expectedUpdatedAt')||(b.expectedUpdatedAt!==null&&(typeof b.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(b.expectedUpdatedAt)))))throw Error('초안 또는 버전을 확인하세요');
  const a=await account(owner),r=await query(sb.rpc('sanji_ig_manual_save_draft',{p_owner:owner,p_account:a.id,p_peer:String(b.peerId),p_generation:b.conversationGeneration,p_body:b.body,p_expected:b.expectedUpdatedAt}));
  if(r?.conflict)throw Error('초안이 다른 곳에서 변경됐습니다. 다시 불러온 후 저장하세요.');return {conversationGeneration:b.conversationGeneration,draft:{body:r.body,updatedAt:r.updatedAt}};
 }
 async function reviewAudit(owner:string,b:any){
  if(!b||typeof b.peerId!=='string'||!/^\d{1,100}$/.test(b.peerId)||!validGeneration(b.creatorId)||!validGeneration(b.conversationGeneration))throw Error('검수 기록 대상을 확인하세요');
  const before=b.before;if(before!==undefined&&(!before||typeof before.savedAt!=='string'||!Number.isFinite(Date.parse(before.savedAt))||!validGeneration(before.auditId)))throw Error('검수 기록을 다시 불러오세요');
  const a=await account(owner),r=await query(sb.rpc('sanji_ig_manual_review_audit_list',{p_owner:owner,p_account:a.id,p_peer:b.peerId,p_creator:b.creatorId,p_generation:b.conversationGeneration,p_before:before?.savedAt||null,p_before_id:before?.auditId||null}));
  if(!r||r.targetValid!==true||typeof r.hasMore!=='boolean'||!Array.isArray(r.events)||r.events.length>20)throw Error('검수 기록을 다시 불러오세요');
  if(r.hasMore&&(!r.nextBefore||typeof r.nextBefore.savedAt!=='string'||!Number.isFinite(Date.parse(r.nextBefore.savedAt))||!validGeneration(r.nextBefore.auditId)))throw Error('검수 기록을 다시 불러오세요');
  return {creatorId:b.creatorId,conversationGeneration:b.conversationGeneration,events:r.events,nextBefore:r.hasMore?r.nextBefore:null,complete:!r.hasMore,limitation:'작업자와 원본 확인 여부는 요청자의 자기기재이며 실제 확인이나 권한의 증명이 아닙니다.'};
 }
 async function saveReviewedDraft(owner:string,b:any){
  if(!b||typeof b.peerId!=='string'||!/^\d{1,100}$/.test(b.peerId)||!validGeneration(b.creatorId)||!validGeneration(b.conversationGeneration)||!validGeneration(b.conversationRevision)||typeof b.body!=='string'||!b.body.trim()||b.body.length>10000||!Object.prototype.hasOwnProperty.call(b,'expectedUpdatedAt')||(b.expectedUpdatedAt!==null&&(typeof b.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(b.expectedUpdatedAt))))||!['user','assistant','other_authorized_worker'].includes(b.reviewerType)||b.sourceCheck!=='self_reported_checked'||b.policyCheck!=='self_reported_checked')throw Error('검수 내용을 확인하세요');
  const a=await account(owner),r=await query(sb.rpc('sanji_ig_manual_save_reviewed_draft',{p_owner:owner,p_account:a.id,p_peer:b.peerId,p_creator:b.creatorId,p_generation:b.conversationGeneration,p_revision:b.conversationRevision,p_body:b.body,p_expected:b.expectedUpdatedAt,p_reviewer:b.reviewerType,p_source_check:b.sourceCheck,p_policy_check:b.policyCheck}));
  if(!r||r.conflict||typeof r.body!=='string'||typeof r.updatedAt!=='string')throw Error('검수 상태가 변경됐습니다');
  return {creatorId:b.creatorId,conversationGeneration:b.conversationGeneration,conversationRevision:b.conversationRevision,draft:{body:r.body,updatedAt:r.updatedAt},reviewRequired:true,limitation:'Instagram 원문 확인은 자기기재이며 최신 상태를 보장할 수 없습니다.'};
 }
 return {list,thread,sync,reverify,saveDraft,saveReviewedDraft,reviewAudit};
}
