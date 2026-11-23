const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isId=x=>typeof x==='string'&&idPattern.test(x);
const isText=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const validStamp=x=>typeof x==='string'&&/T.*(Z|[+-][0-9]{2}:[0-9]{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const stamp=x=>new Date(x).toISOString();
const identical=(a,b)=>isText(a)&&a===b;
const unique=(items,key)=>new Set(items.map(key)).size===items.length;
function unready(){return new Error('Status source unavailable');}
async function bounded(query,maximum){
 maximum=Math.min(499,maximum);
 const {data,error}=await query.limit(maximum+1);
 if(error||!Array.isArray(data)||data.length>maximum)throw unready();
 return data;
}
async function openCount(q){
 const {count,error}=await q;
 if(error||!Number.isSafeInteger(count)||count<0)throw unready();
 return count;
}
const event=(scope,channelId,status,source,at,proofId)=>({
 owner:scope.owner,projectId:scope.projectId,day:scope.day,channelId,status,source,at:stamp(at),proofId,
});

/**
 * Production sources: existing server-side Supabase client only. No writes.
 * A zero refers solely to records actually linked to this project inside Sanji.
 * Untagged external mail cannot be attributed. Generic tagged drafts/receipts
 * with no canonical producer are treated as unresolved, not as evidence.
 */
export function createPartyumStatusReaders(client){
 const atOwner=(table,fields,scope)=>client.from(table).select(fields).eq('owner',scope.owner);
 const batches=scope=>atOwner('sanji_youtube_manual_batches','owner,id,approval_hash,review,confirmed_at',scope)
   .eq('review->scope->>projectId',scope.projectId);
 // Exact historical markers under separate counters instead of pulling private copy.
 const count=(table,scope)=>client.from(table).select('id',{head:true,count:'exact'}).eq('owner',scope.owner);
 const relatedCounts=(scope,channelKeys)=>Promise.all([
  openCount(count('sanji_drafts',scope).eq('data->>projectId',scope.projectId)),
  openCount(count('sanji_drafts',scope).eq('data->scope->>projectId',scope.projectId)),
  openCount(count('sanji_outbox',scope).eq('channel','email').eq('data->>projectId',scope.projectId).in('data->>creatorKey',channelKeys)),
  openCount(count('sanji_records',scope).eq('kind','thread').eq('data->>projectId',scope.projectId).in('data->>creatorKey',channelKeys)),
  openCount(count('sanji_outbox',scope).eq('channel','email').eq('data->>projectId',scope.projectId).is('data->>creatorKey',null)),
  openCount(count('sanji_records',scope).eq('kind','thread').eq('data->>projectId',scope.projectId).is('data->>creatorKey',null)),
 ]);
 return {
  async authenticate(token){
   const {data,error}=await client.auth.getUser(token);
   const user=data?.user?.id;
   if(error||!isId(user))return null;
   const membership=await client.from('sanji_members').select('user_id').eq('user_id',user).maybeSingle();
   return !membership.error&&membership.data?.user_id===user?user:null;
  },
  async readShortlist(scope){
   const shortlist=await bounded(atOwner('sanji_private_wedding_shortlist','owner,channel_id,project_day',scope)
    .eq('project_day',scope.day).in('channel_id',scope.channelIds),scope.channelIds.length);
   return shortlist.map(r=>({owner:r.owner,projectId:scope.projectId,day:r.project_day,channelId:r.channel_id}));
  },
  async readSnapshot(scope){
   const scopeHeader={owner:scope.owner,projectId:scope.projectId,day:scope.day};
   const out=entries=>({...scopeHeader,entries});
   const rc=scope.channelIds, channelKeys=rc.map(id=>'youtube:'+id);
   const [projectBatches,tagged]=await Promise.all([bounded(batches(scope),500),relatedCounts(scope,channelKeys)]);
   if(projectBatches.some(b=>b.owner!==scope.owner||!isId(b.id)||b.review?.scope?.projectId!==scope.projectId)||
     !unique(projectBatches,b=>b.id))return out([]);
   if(projectBatches.length===0){
    // Recheck absence so concurrent additions during the first interval do not
    // produce a false discovery-only status in the obvious transition case.
    if(tagged.some(Boolean))return out([]);
    const [batchAgain,taggedAgain]=await Promise.all([bounded(batches(scope),500),relatedCounts(scope,channelKeys)]);
    return out(!batchAgain.length&&!taggedAgain.some(Boolean)
      ?rc.map(channelId=>({...scopeHeader,channelId,exhaustive:true,events:[]}))
      :[]);
   }

   // Positive proof only from the dedicated confirmed ledger. Outer-scope
   // batches cannot claim a channel in this discovery cohort.
   if(tagged[0]||tagged[1]||tagged[4]||tagged[5])return out([]);
   const today=projectBatches.filter(b=>b.review?.scope?.day===scope.day);
   const byBatch=new Map(today.map(b=>[b.id,b]));
   const batchIds=[...byBatch.keys()];
   if(!batchIds.length)return out([]);
   const [ledgers,schedules]=await Promise.all([
    bounded(atOwner('sanji_youtube_manual_ledger','id,owner,batch_id,candidate_id,channel,approval_hash,state,provider_id,outbox_id,thread_id,updated_at',scope)
     .in('batch_id',batchIds).in('channel',rc),rc.length*10),
    bounded(atOwner('sanji_youtube_manual_schedule','owner,batch_id,approval_hash,run_at,state',scope).in('batch_id',batchIds),batchIds.length*2),
   ]);
   if(ledgers.some(l=>l.owner!==scope.owner||!isId(l.id)||!byBatch.has(l.batch_id)||!rc.includes(l.channel))||
      schedules.some(s=>s.owner!==scope.owner||!byBatch.has(s.batch_id))||!unique(ledgers,l=>l.id))return out([]);
   const selectExact=(table,fields,ids)=>ids.length
    ?bounded(atOwner(table,fields,scope).in('id',ids),ids.length)
    :Promise.resolve([]);
   const accepted=ledgers.filter(l=>l.state==='accepted');
   const uniqueIds=(rows,key)=>[...new Set(rows.map(r=>r[key]).filter(isId))];
   const [outbox,threads]=await Promise.all([
    selectExact('sanji_outbox','owner,id,target,channel,status,created,projectId:data->>projectId,manualBatchId:data->>manualBatchId,providerId:data->>providerId,creatorKey:data->>creatorKey,proposalType:data->>proposalType',uniqueIds(accepted,'outbox_id')),
    selectExact('sanji_records','owner,id,kind,projectId:data->>projectId,target:data->>target,creatorKey:data->>creatorKey,messages:data->messages',uniqueIds(accepted,'thread_id')),
   ]);
   // A tagged item outside the bounded reconciled set could be an unmapped
   // attempt for this project. Never silently drop it and claim an outcome.
   if(tagged[2]!==outbox.length||tagged[3]!==threads.length)return out([]);
   if(!unique(outbox,r=>r.id)||!unique(threads,r=>r.id)||[...outbox,...threads].some(r=>r.owner!==scope.owner))return out([]);
   const outById=new Map(outbox.map(r=>[r.id,r]));
   const threadById=new Map(threads.map(r=>[r.id,r]));
   const rows=[];
   for(const cid of rc){
    const matched=ledgers.filter(l=>l.channel===cid&&l.state!=='cancelled');
    if(matched.length!==1)continue;
    const l=matched[0],b=byBatch.get(l.batch_id),entries=b.review?.entries;
    if(!validStamp(b.confirmed_at)||!identical(b.approval_hash,l.approval_hash)||!isId(l.candidate_id)||
        !Array.isArray(entries)||entries.length>100||
        entries.filter(e=>e?.id===l.candidate_id&&e.channel===cid).length!==1)continue;
    let proof;
    if(l.state==='accepted'&&isText(l.provider_id)){
     const o=outById.get(l.outbox_id),t=threadById.get(l.thread_id);
     if(o?.projectId!==scope.projectId||o.target!==l.candidate_id||o.manualBatchId!==b.id||
         o.channel!=='email'||o.status!=='accepted'||!identical(o.providerId,l.provider_id)||
         o.proposalType!=='youtube_manual_campaign'||o.creatorKey!=='youtube:'+cid||
         t?.projectId!==scope.projectId||t?.kind!=='thread'||t?.target!==l.candidate_id||t?.creatorKey!=='youtube:'+cid||
         !Array.isArray(t.messages)||!validStamp(o.created))continue;
     const m=t.messages.filter(m=>m?.id===l.provider_id&&m.outboxId===o.id&&m.out===true&&(m.status===undefined||m.status==='accepted')&&
       validStamp(m.at)&&Math.abs(Date.parse(m.at)-Date.parse(o.created))<=300000);
     if(m.length===1)proof=event(scope,cid,'sent','accepted-provider-receipt',m[0].at,'provider:'+l.provider_id);
    }else if(l.state==='reserved'){
     const live=schedules.filter(s=>s.batch_id===b.id&&identical(s.approval_hash,b.approval_hash)&&s.state==='scheduled'&&validStamp(s.run_at));
     if(live.length===1)proof=event(scope,cid,'scheduled','confirmed-current-reservation',live[0].run_at,'ledger:'+l.id);
    }else if(l.state==='failed'&&validStamp(l.updated_at)){
     proof=event(scope,cid,'failed','recorded-terminal-failure',l.updated_at,'ledger:'+l.id);
    }
    if(proof)rows.push({...scopeHeader,channelId:cid,exhaustive:true,events:[proof]});
   }
   return out(rows);
  },
 };
}
