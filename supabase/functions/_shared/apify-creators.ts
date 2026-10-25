const profileUrl=(h:string)=>'https://www.instagram.com/'+encodeURIComponent(h)+'/';
export function apifyCreator(raw:any,run:string,checked=new Date().toISOString()){
 const handle=String(raw.username||'').replace(/^@/,'').toLowerCase();
 const no=(reason:string)=>({accepted:false,handle,reason});
 if(!/^[a-z0-9._]{2,30}$/.test(handle)||raw.error)return no('유효한 공개 프로필 결과 아님');
 if(raw.isPrivate===true)return no('비공개 계정');
 const bio=String(raw.biography||''),name=String(raw.fullName||handle),posts=(Array.isArray(raw.latestPosts)?raw.latestPosts:[]).filter((p:any)=>p.url&&p.caption),korean=posts.filter((p:any)=>(String(p.caption).match(/[가-힣]/g)||[]).length>=15),text=[bio,...posts.map((p:any)=>p.caption)].join('\n');
 if(/유소년|축구성장기|초[1-6]\s*.*성장기|키즈모델/.test(name+' '+bio))return no('아동 중심 계정 · 성인 공동구매 협업 선별에서 제외');
 const identityPost=posts.find((p:any)=>/(?:저는\s*한국인|한국인인\s*저|한국인으로서|我是韓國人|身為韓國人|韓国人の私|\b(?:I'm|I am|as a|being a)\s+(?:a\s+)?Korean\b)/i.test(String(p.caption)));
 const selfHandle=/^korean[_.]?mom(?:[_.]|co+ks|life|diary|daily|blog|$)/i.test(handle);
 if(!identityPost&&!selfHandle&&!/(?:한국\s*(?:인(?!삼)|사람|엄마|아빠|여자|남자|크리에이터)|韓國(?:人|媽媽)|韓国(?:人|ママ)|대한민국\s*국적|Korean\s+(?:creator|mom|mother|dad|father|woman|man|influencer|chef|cook|baker|foodie)\b|(?:I'm|I am)\s+Korean)/i.test(name+' '+bio))return no('공개 자기소개에서 한국 크리에이터라는 근거 미확인 · 언어·이름·외모로 판정하지 않음');
 if(!posts.length)return no('실제 공개 콘텐츠 근거 부족');
 if(!/공동구매|공구|레시피|식단|요리|베이킹|푸드|홈카페|웰니스|운동|건강식|라이프스타일|살림|육아|책육아|집밥|먹방|홈쿡|recipe|cook|chef|food|baking|wellness|fitness|lifestyle|parenting|motherhood/i.test(text))return no('푸드·웰니스 공동구매 콘텐츠 적합성 근거 부족');
 if(/브랜드\s*공식|공식\s*(계정|스토어|쇼핑몰)|고객센터|주식회사|도매\s*문의/.test(bio))return no('기업·판매점 계정 가능성 · 개인 크리에이터 선별에서 제외');
 const dated=posts.map((p:any)=>Date.parse(p.timestamp)).filter(Number.isFinite),latest=dated.length?Math.max(...dated):null;
 if(!latest||Date.parse(checked)-latest>120*86400000)return no('최근 120일 공개 활동 확인 불가');
 const source=profileUrl(handle),emails=[...new Set((bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(s=>s.toLowerCase()))].filter(e=>!/(?:privacy|recruit|career|noreply|no-reply)/i.test(e));
 const businessEmails=emails.map(email=>({email,source,checked,context:bio,purpose:'공개 프로필에 게시 · 비즈니스 용도 추가 확인',verified:true}));
 const previewPosts=posts.slice(0,3).map((p:any)=>({url:p.url,caption:String(p.caption).slice(0,1000),timestamp:p.timestamp,thumbnailUrl:String(p.displayUrl||''),likesCount:Number.isFinite(p.likesCount)&&p.likesCount>=0?p.likesCount:null,commentsCount:Number.isFinite(p.commentsCount)&&p.commentsCount>=0?p.commentsCount:null,viewsCount:Number.isFinite(p.videoViewCount)&&p.videoViewCount>=0?p.videoViewCount:null}));
 const followers=Number.isFinite(raw.followersCount)?raw.followersCount:null;
 return {accepted:true,handle,record:{handle,profile:source,name,source_url:source,excerpt:bio,checked,status:'new',body:'',approved_hash:'',sender_handle:'',reasons:['공개 자기소개에서 한국인 정체성 명시 확인','푸드·웰니스·라이프스타일 관련 공개 주제 확인','최근 120일 내 공개 게시물 확인'],uncertainties:['공개 자기소개에 기반 · 법적 국적 서류와 한국 팔로워 비율은 확인하지 않음','공동구매 성과·거래 조건 미확인',...(posts.length<3?['콘텐츠 표본 3개 미만 · 추가 적합성 확인 필요']:[]),...(followers!==null&&followers<1000?['공개 팔로워 1천 명 미만 · 판매 적합성은 미확인']:[]),...(emails.length?['공개 이메일 용도·소유 관계는 제안 전 검토']:['공개 프로필 이메일 미발견 · DM 보류'])],result:{note:'Apify 선별 · 연락·발송 없음'},profile_preview:{status:'checked',checked,displayName:name,bio,avatarUrl:String(raw.profilePicUrlHD||raw.profilePicUrl||''),followersText:followers===null?'미확인':followers.toLocaleString('ko-KR')+'명',followersCount:followers,postsText:Number.isFinite(raw.postsCount)?raw.postsCount+'개 게시물':'게시물 수 미확인',businessEmails,previewPosts,lastPostAt:new Date(latest).toISOString(),source,provider:'apify',runId:run,followingCount:Number.isFinite(raw.followsCount)?raw.followsCount:null,isVerified:raw.verified===true,category:raw.businessCategoryName||null,koreanIdentityEvidence:{url:identityPost?.url||source,quote:identityPost?String(identityPost.caption).slice(0,1500):'@'+handle+'\n'+name+'\n'+bio,checked,method:'explicit_public_self_description'},koreanEvidence:korean.slice(0,3).map((p:any)=>({url:p.url,quote:String(p.caption).slice(0,300)}))}}};
}
export function apifyTrialService({sb,query,env,audit,request=fetch}:any){
 async function remote(path:string,body?:any){
  const token=env('APIFY_TOKEN');if(!token)throw Error('APIFY_TOKEN 설정 필요');
  const r=await request('https://api.apify.com/v2/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Apify HTTP '+r.status+' · 비밀 응답은 기록하지 않음');return await r.json();
 }
 async function tick(){
  const rows=await query(sb.from('sanji_apify_creator_trials').select('*').in('status',['pending','running']).order('created').limit(1));let t=rows[0];if(!t)return null;
  if(t.lease_until&&Date.parse(t.lease_until)>Date.now())return {status:'busy'};
  const claimed=await query(sb.from('sanji_apify_creator_trials').update({lease_until:new Date(Date.now()+90000).toISOString(),updated:new Date().toISOString()}).eq('id',t.id).eq('updated',t.updated).select('*'));if(!claimed.length)return {status:'busy'};t=claimed[0];
  const save=async(p:any)=>{await query(sb.from('sanji_apify_creator_trials').update({...p,lease_until:null,updated:new Date().toISOString()}).eq('id',t.id));return p;};
  try{
   let runs=t.runs||[],last=runs.at(-1);
   if(last?.status==='submitting')return await save({status:'submission_unknown',error:'실행 요청 결과 미확인 · 중복 과금 방지를 위해 자동 재시도 안 함'});
   if(last&&!last.ingested){
    const run=(await remote('actor-runs/'+last.id)).data;
    if(!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(run.status)){if(run.status!=='ABORTING'&&Date.now()-Date.parse(run.startedAt)>300000)await remote('actor-runs/'+last.id+'/abort',{});return await save({status:'running'});}
    if(!Number.isFinite(run.usageTotalUsd))throw Error('Apify 실제 사용액 확인 불가 · 추가 유료 실행 중지');
    last={...last,status:run.status,costUsd:run.usageTotalUsd,dataset:run.defaultDatasetId};runs=[...runs.slice(0,-1),last];
    const items=await remote('datasets/'+encodeURIComponent(run.defaultDatasetId)+'/items?format=json&limit=100');
    let accepted=Number(t.accepted),excluded=t.excluded||[];const used=new Set((await query(sb.from('sanji_creator_prospects').select('handle').eq('owner',t.owner))).map((r:any)=>r.handle));
    excluded=excluded.filter((r:any)=>!used.has(r.handle));
    const suppressed=new Set((await query(sb.from('sanji_suppression').select('identity').eq('owner',t.owner))).map((r:any)=>String(r.identity).toLowerCase()));
    for(const raw of items){const result=apifyCreator(raw,run.id);if(!result.accepted){excluded.push({handle:result.handle,reason:result.reason});continue;}if(suppressed.has('instagram:'+result.handle)||(result.record.profile_preview.businessEmails||[]).some((e:any)=>suppressed.has('email:'+e.email))){excluded.push({handle:result.handle,reason:'수신 거부·연락 제외 목록'});continue;}if(used.has(result.handle)||accepted>=t.target)continue;
     const r=await sb.from('sanji_creator_prospects').insert({owner:t.owner,...result.record});if(r.error)throw Error('선별 결과 저장 실패 · 유료 실행 추가 중지');used.add(result.handle);accepted++;
    }
    last.ingested=true;runs[runs.length-1]=last;const cost=Math.round(runs.reduce((n:number,r:any)=>n+Number(r.costUsd||0),0)*1000000)/1000000,status=accepted>=t.target?'complete':runs.length>=t.queries.length?'partial':'pending';
    await audit(t.owner,'apify_creator_run_ingested',{run:run.id,costUsd:run.usageTotalUsd,accepted,raw:items.length,noMessagesSent:true});return await save({status,runs,cost_usd:cost,accepted,reviewed:t.reviewed+items.length,excluded});
   }
   if(runs.length>=t.queries.length)return await save({status:'partial'});
   // Reserve the full provider-enforced per-run cap before making a paid request.
   if(runs.some((r:any)=>!Number.isFinite(Number(r.ingested?r.costUsd:r.capUsd))||Number(r.ingested?r.costUsd:r.capUsd)<0))throw Error('확정 사용액 확인 불가 · 추가 유료 실행 중지');
   const reserved=runs.reduce((n:number,r:any)=>n+Number(r.ingested?r.costUsd:r.capUsd),0),remaining=Number(t.budget_usd)-reserved,cap=Math.min(0.11,Math.floor(remaining*1000000)/1000000);
   if(cap<0.003)return await save({status:'budget_exhausted'});
   if(reserved+cap>Number(t.budget_usd)+0.000001)return await save({status:'budget_exhausted'});
   const keyword=t.queries[runs.length];runs=[...runs,{query:keyword,capUsd:cap,status:'submitting'}];
   await query(sb.from('sanji_apify_creator_trials').update({runs,status:'running',updated:new Date().toISOString()}).eq('id',t.id));
   const run=(await remote('acts/apify~instagram-scraper/runs?maxTotalChargeUsd='+cap+'&maxItems='+Math.min(35,Math.floor(cap/0.0027))+'&timeout=300',{search:keyword,searchType:'profile',searchLimit:Math.min(35,Math.floor(cap/0.0027)),resultsType:'details',resultsLimit:1,addParentData:false})).data;
   runs[runs.length-1]={...runs.at(-1),id:run.id,status:run.status};return await save({status:'running',runs});
  }catch(e){return await save({status:'failed',error:String(e.message).slice(0,160)});}
 }
 return {tick};
}
