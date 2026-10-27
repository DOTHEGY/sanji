const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function recoveryService({sb,query,audit}:any){
 const config=async(owner:string)=>await query(sb.from('sanji_creator_recovery_config').select('*').eq('owner',owner).maybeSingle())||{enabled:false,target:30,run_time:'09:00',daily_lookup_limit:0,retry_limit:0,paid_limit_usd:0};
 async function recommend(owner:string){const c=await config(owner),today=day();const added=await query(sb.rpc('sanji_creator_recommend',{p_owner:owner,p_day:today,p_target:c.target}));await audit(owner,'creator_recovery_recommended',{day:today,added});return {day:today,added};}
 async function handle(path:string,method:string,owner:string,input:any,params=new URLSearchParams()){
  if(path==='/creator-recovery'&&method==='GET'){
   const c=await config(owner),today=day(),requested=params.get('day')||today,selectedDay=/^\d{4}-\d{2}-\d{2}$/.test(requested)&&requested<=today?requested:today,preview=await query(sb.rpc('sanji_creator_preview',{p_owner:owner,p_target:c.target})),rec=await query(sb.from('sanji_creator_recommendations').select('creator_id').eq('owner',owner).eq('day',selectedDay));
   const ids=rec.map((r:any)=>r.creator_id),rows:any[]=[];for(let i=0;i<ids.length;i+=100)rows.push(...await query(sb.from('sanji_creator_recovery').select('*').eq('owner',owner).in('id',ids.slice(i,i+100))));const offset=Math.min(100000,Math.max(0,Number.parseInt(params.get('reviewOffset')||'0',10)||0));
   const review=await query(sb.from('sanji_creator_recovery').select('id,handle,profile_url,nickname,followers,emails,email_status,link_status,entity_type,assessment,reasons,status,source_file,source_created_at,last_verified,bio,category').eq('owner',owner).eq('assessment','review').eq('status','new').order('created').order('id').range(offset,offset+99));
   const managed=await query(sb.from('sanji_creator_recovery').select('id,handle,profile_url,nickname,followers,emails,email_status,link_status,entity_type,assessment,reasons,status,source_file,source_created_at,last_verified,bio,category').eq('owner',owner).in('status',['hold','excluded','contacted']).order('updated',{ascending:false}).limit(100));
   return {config:c,day:selectedDay,today,recommendations:rows,preview,review,managed,reviewOffset:offset,shortfall:Math.max(0,c.target-rows.filter((x:any)=>x.status==='new').length),shortfallReason:rows.filter((x:any)=>x.status==='new').length<c.target?'条件に合う未推薦候補が不足、または今日の推薦が未実行です。':'',sourceNotice:'復旧データの過去の紹介欄・数値。現在の活動・国籍・メールの有効性は未確認。'};
  }
  const b=await input();
  if(path==='/creator-recovery/recommend'&&method==='POST')return await recommend(owner);
  if(path==='/creator-recovery/settings'&&method==='POST'){
   const target=Number(b.target),lookup=Number(b.dailyLookupLimit),retry=Number(b.retryLimit),cost=Number(b.paidLimitUsd),time=String(b.runTime||'');
   if(!Number.isInteger(target)||target<1||target>500||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(lookup)||lookup<0||lookup>500||!Number.isInteger(retry)||retry<0||retry>5||!Number.isFinite(cost)||cost<0||cost>100)throw Error('설정값을 확인해 주세요.');
   await query(sb.from('sanji_creator_recovery_config').upsert({owner,target,run_time:time,enabled:b.enabled===true,daily_lookup_limit:lookup,retry_limit:retry,paid_limit_usd:cost,updated:new Date().toISOString()},{onConflict:'owner'}));return {ok:true};
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
