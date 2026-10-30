const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const targetValue=(value:any)=>{const n=typeof value==='number'?value:typeof value==='string'&&/^[0-9]+$/.test(value)?Number(value):NaN;if(!Number.isInteger(n)||n<1||n>500)throw Error('추천 인원은 1~500 사이의 정수로 입력하세요.');return n;};
export function recoveryService({sb,query,audit}:any){
 const config=async(owner:string)=>await query(sb.from('sanji_creator_recovery_config').select('*').eq('owner',owner).maybeSingle())||{enabled:false,target:30,run_time:'09:00',explore_percent:20,daily_lookup_limit:0,retry_limit:0,paid_limit_usd:0};
 async function recommend(owner:string,target?:number){const c=await config(owner),today=day();const added=await query(sb.rpc('sanji_creator_recommend',{p_owner:owner,p_day:today,p_target:target??c.target}));await audit(owner,'creator_recovery_recommended',{day:today,added});return {day:today,added};}
 async function handle(path:string,method:string,owner:string,input:any,params=new URLSearchParams()){
  if(path==='/creator-recovery'&&method==='GET'){
   const c=await config(owner),today=day(),requested=params.get('day')||today,pool=await query(sb.rpc('sanji_creator_pool_counts',{p_owner:owner})),selectedDay=/^\d{4}-\d{2}-\d{2}$/.test(requested)&&requested<=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10)?requested:today,requestedTarget=params.has('target')?targetValue(params.get('target')):null,rec=await query(sb.from('sanji_creator_recommendations').select('creator_id').eq('owner',owner).eq('day',selectedDay));
   const ids=rec.map((r:any)=>r.creator_id),target=requestedTarget??(selectedDay===today?Math.max(c.target,ids.length):c.target),rows:any[]=[];for(let i=0;i<ids.length;i+=100)rows.push(...await query(sb.from('sanji_creator_recovery').select('*').eq('owner',owner).in('id',ids.slice(i,i+100))));const needed=selectedDay===today?Math.max(0,target-ids.length):0,preview=needed?await query(sb.rpc('sanji_creator_preview',{p_owner:owner,p_target:needed})):[];const offset=Math.min(100000,Math.max(0,Number.parseInt(params.get('reviewOffset')||'0',10)||0));
   const review=await query(sb.from('sanji_creator_recovery').select('id,handle,profile_url,nickname,followers,emails,bio_status,email_status,link_status,entity_type,assessment,reasons,status,source_provider,source_file,source_url,source_created_at,last_verified,followers_checked,followers_source,lookup_state,bio,category').eq('owner',owner).eq('assessment','review').eq('status','new').order('created').order('id').range(offset,offset+99));
   const managed=await query(sb.from('sanji_creator_recovery').select('id,handle,profile_url,nickname,followers,emails,bio_status,email_status,link_status,entity_type,assessment,reasons,status,source_provider,source_file,source_url,source_created_at,last_verified,followers_checked,followers_source,lookup_state,bio,category').eq('owner',owner).in('status',['hold','excluded','contacted']).order('updated',{ascending:false}).limit(100));
   const all=[...rows,...preview,...review,...managed],uniqueIds=[...new Set(all.map((x:any)=>x.id))] as string[],evidence:any[]=[];
   for(let i=0;i<uniqueIds.length;i+=100)evidence.push(...await query(sb.from('sanji_creator_evidence').select('creator_id,source_provider,source_kind,source_url,source_ref,batch_id,detail,seen_at').eq('owner',owner).in('creator_id',uniqueIds.slice(i,i+100))));
   for(const row of all)row.sourceEvidence=evidence.filter((x:any)=>x.creator_id===row.id);
   return {config:c,pool,day:selectedDay,today,target,recommendations:rows,preview:selectedDay===today?[...rows,...preview]:preview,review,managed,reviewOffset:offset,shortfall:Math.max(0,target-(selectedDay===today?rows.length+preview.length:rows.length)),shortfallReason:(selectedDay===today?rows.length+preview.length:rows.length)<target?'조건에 맞는 미추천 후보가 부족하거나 아직 추천을 실행하지 않았습니다.':'',sourceNotice:'복구 데이터의 과거 소개란과 수치입니다. 현재 활동·국적·이메일 유효성은 미확인입니다.'};
  }
  const b=await input();
  if(path==='/creator-recovery/recommend'&&method==='POST'){if(b.day!==undefined&&b.day!==day())throw Error('오늘 날짜만 추천을 확정할 수 있습니다.');return await recommend(owner,b.target===undefined?undefined:targetValue(b.target));}
  if(path==='/creator-recovery/settings'&&method==='POST'){
   const target=Number(b.target),explore=Number(b.explorePercent??20),lookup=Number(b.dailyLookupLimit),retry=Number(b.retryLimit),cost=Number(b.paidLimitUsd),time=String(b.runTime||'');
   if(!Number.isInteger(target)||target<1||target>500||!Number.isInteger(explore)||explore<0||explore>100||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(lookup)||lookup<0||lookup>500||!Number.isInteger(retry)||retry<0||retry>5||!Number.isFinite(cost)||cost<0||cost>100)throw Error('설정값을 확인해 주세요.');
   await query(sb.from('sanji_creator_recovery_config').upsert({owner,target,explore_percent:explore,run_time:time,enabled:b.enabled===true,daily_lookup_limit:lookup,retry_limit:retry,paid_limit_usd:cost,updated:new Date().toISOString()},{onConflict:'owner'}));return {ok:true};
  }
  if(path==='/creator-recovery/status'&&method==='POST'){
   if(!['new','hold','excluded','contacted'].includes(b.status))throw Error('상태가 올바르지 않습니다.');
   const rows=await query(sb.from('sanji_creator_recovery').update({status:b.status,updated:new Date().toISOString()}).eq('owner',owner).eq('id',b.id).select('id'));if(!rows.length)throw Error('대상을 찾을 수 없습니다.');return {ok:true};
  }
  throw Error('지원하지 않는 작업');
 }
 async function scheduled(){const rows=await query(sb.from('sanji_creator_recovery_config').select('*').eq('enabled',true));const now=new Date(),today=day(),clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);let completed=0;for(const c of rows){if(String(c.run_time).slice(0,5)>clock||c.last_run_day===today)continue;await recommend(c.owner);await query(sb.from('sanji_creator_recovery_config').update({last_run_day:today}).eq('owner',c.owner));completed++;}return {status:'checked',completed};}
 return {handle,scheduled};
}
