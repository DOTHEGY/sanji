import { publicUrl } from './discovery.ts';
import { searchPlan, searchTopics, searchSubtopics, searchVariants } from './discovery-search.ts';

export const adaptiveMetric='unique_homepage_candidates' as const;
export type CompletedSearchDay={day:string;completedQueries:number;added:number;metric:typeof adaptiveMetric};
export type AdaptiveEvidence={url:string;kind:'official_evidence'|'search_metadata';text:string;observedDay:string};
export type AdaptiveState={evaluatedDay?:string;stage?:number;recoveryBaseline?:number;baselineDays?:string[];proposedQueries?:string[];pendingQueries?:AdaptiveQuery[]};
export type AdaptiveQuery={query:string;phrase:string;stage:number;provenance:{kind:'curated_wellness'|'official_evidence'|'search_metadata';url?:string;observedDay?:string}};
export type AdaptiveInput={history:CompletedSearchDay[];currentDay:string;state?:AdaptiveState;evidence?:AdaptiveEvidence[];usedQueries?:string[];exhaustedQueries?:string[]};
const stages=[
 ['저당 식품','식물성 단백질','발효 식품','허브차','디카페인 커피','통곡물 간식','견과 버터','무카페인 차'],
 ['요가 매트','요가 블록','스트레칭 밴드','운동 폼롤러','운동 마사지 볼','홈트 덤벨','운동 아령','홈트 케틀벨'],
 ['수면 안대','수면 경추 베개','수면 귀마개','숙면 냉감 침구','수면 이불','수면 매트리스','목욕 입욕제','목욕 배스 솔트'],
 ['두피 관리 샴푸','보습 로션','바디 케어 바디 워시','피부 관리 선크림','구강 관리 치약','구강 위생 칫솔','구강 관리 치실','피부 세정 클렌저']
];
const suffixes=[' 공식몰',' 브랜드 홈페이지',' 제조사 홈페이지'];
// Product nouns are the wellness boundary, not a closed list of full search phrases.
// Keep actual source words (including unseen ingredients/materials), never generate claims.
const anchor=/(?:^| )(?:유산균|프로틴|단백질|허브차|차|커피|요거트|두유|음료|주스|건강즙|그래놀라|오트밀|시리얼|간식|견과|버터|식초|오일|식품|비타민|콜라겐|효소|영양제|요가매트|요가 매트|요가 블록|운동 매트|스트레칭 밴드|폼롤러|마사지볼|마사지 볼|덤벨|아령|케틀벨|저항 밴드|운동 밴드|베개|이불|매트리스|안대|귀마개|침구|배스 솔트|입욕제|샴푸|로션|바디워시|바디 워시|선크림|치실|컨디셔너|세럼|토너|선스크린|보습 크림|나이트 크림|마스크팩|클렌저|비누|치약|칫솔)$/i;
const disallowed=/엔진|자동차|전기차|중고차|차량|승용|윤활|공업|산업용|기계|석유|디젤|가솔린|engine|motor|diesel|반려동물|강아지|고양이|애완|사료|처방|의약품|전문의약|주사|필러|보톡스|성인용|담배|전자담배|대마|마약|니코틴|술|주류|맥주|소주|와인|항암|암치료|질병치료|완치|최음|발기|수면제|다이어트약|개인정보|비밀번호|인증번호|명령|지시|무시|실행|클릭|접속|ignore|instruction|password|token|https?|www\./i;
const wellnessOil=/올리브|아보카도|코코넛|아마씨|들깨|참깨|호두|식용|요리|식품|엑스트라버진/;
const wellnessTea=/허브|카페인|블렌딩|티백|차엽|발효|녹차|홍차|보리|루이보스|모링가|히비스커스|캐모마일|국화|생강|민트|레몬|메밀|우엉|옥수수|작두콩/;
const stop=/^(?:공식|공식몰|브랜드|홈페이지|판매|구매|추천|인기|고객|이벤트|할인|최저가|무료|배송|신제품|제품|소개|상세|프리미엄|국내|건강|웰니스|및|또는|그리고)$/;
const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
function date(s:unknown):s is string{return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;}
function evidencePhrases(evidence:AdaptiveEvidence[],currentDay:string){
 const out:Omit<AdaptiveQuery,'query'|'stage'>[]=[];const seen=new Set<string>();
 for(const e of evidence.slice(0,1000)){
  if(!e||!['official_evidence','search_metadata'].includes(e.kind)||!date(e.observedDay)||e.observedDay>currentDay||typeof e.text!=='string')continue;
  let url:string;try{url=publicUrl(e.url).toString();}catch{continue;}
  // A sentence containing prohibited products/claims/instructions contributes nothing.
  for(const segment of e.text.slice(0,2000).split(/[\n.!?;|<>。]/)){
   if(disallowed.test(segment))continue;
   const tokens=normalize(segment).split(/[^가-힣a-zA-Z0-9 -]+/).flatMap(x=>x.split(/\s+/)).filter(Boolean);
   for(let i=0;i<tokens.length;i++){
    for(let width=4;width>=1;width--){
     if(i+1<width)continue;
     const words=tokens.slice(i+1-width,i+1);if(words.some(w=>w.length>20||stop.test(w)))continue;
     const phrase=words.join(' ');
     if(phrase.length<2||phrase.length>60||!anchor.test(phrase)||!/[가-힣]/.test(phrase)||seen.has(phrase))continue;
     if(/(?:^| )오일$/.test(phrase)&&!wellnessOil.test(phrase))continue;
     if(/(?:^| )차$/.test(phrase)&&!wellnessTea.test(phrase))continue;
     // Reject grammatical sentences/search instructions; only compact product phrases.
     if(/(?:하세요|합니다|습니다|해줘|해주세요|하는|됩니다|입니다|하세요|검색|찾아|보내|전송)/.test(phrase))continue;
     seen.add(phrase);out.push({phrase,provenance:{kind:e.kind,url,observedDay:e.observedDay}});break;
    }
    if(out.length>=200)return out;
   }
  }
 }
 return out;
}

// Pure planning only. Caller supplies AUDITED completed-query totals, never reserved
// lease counters, and persists state atomically. Returned queries replace slots in
// the unchanged 64-query daily allowance; they do not authorize additional calls.
export function evaluateAdaptiveSearch(input:AdaptiveInput){
 if(!date(input.currentDay))throw Error('Invalid current Korean day');
 const prior=input.state||{};
 const usedHistory=new Set((input.usedQueries||[]).map(normalize));
 const deniedHistory=new Set([...(input.usedQueries||[]),...(input.exhaustedQueries||[])].map(normalize));
 const state:AdaptiveState={...prior,stage:Number.isSafeInteger(prior.stage)&&prior.stage!>=0?prior.stage:0,proposedQueries:[...(prior.proposedQueries||[])].filter(q=>!usedHistory.has(normalize(q))),pendingQueries:[...(prior.pendingQueries||[])].filter(q=>!deniedHistory.has(normalize(q.query))),baselineDays:[...(prior.baselineDays||[])]};
 const diagnostics={metric:adaptiveMetric,stage:state.stage!,reason:'no_completed_day',baseline:null as number|null,baselineDays:[] as string[],completedDay:null as string|null,latestAdded:null as number|null,ratio:null as number|null,triggered:false,sourceStatus:'not_evaluated',proposed:0,ignored:{partialDays:0,invalidDays:0,conflictingDays:0}};
 const grouped=new Map<string,CompletedSearchDay[]>();
 for(const h of input.history){
  if(!h||!date(h.day)||h.day>input.currentDay||h.metric!==adaptiveMetric||!Number.isSafeInteger(h.added)||h.added<0||!Number.isSafeInteger(h.completedQueries)||h.completedQueries<0||h.completedQueries>64){diagnostics.ignored.invalidDays++;continue;}
  const group=grouped.get(h.day)||[];group.push(h);grouped.set(h.day,group);
 }
 const days:CompletedSearchDay[]=[];
 for(const group of grouped.values()){
  if(group.some(h=>h.added!==group[0].added||h.completedQueries!==group[0].completedQueries)){diagnostics.ignored.conflictingDays++;continue;}
  if(group[0].completedQueries!==64){diagnostics.ignored.partialDays++;continue;}
  days.push(group[0]);
 }
 days.sort((a,b)=>a.day.localeCompare(b.day));
 const latest=days.at(-1);const result=(queries:AdaptiveQuery[]=[])=>({state,diagnostics,queries,pendingQueries:state.pendingQueries!});
 if(!latest){if(diagnostics.ignored.partialDays)diagnostics.reason='partial_budget_excluded';return result();}
 diagnostics.completedDay=latest.day;diagnostics.latestAdded=latest.added;
 if(typeof prior.recoveryBaseline==='number'&&Number.isFinite(prior.recoveryBaseline)&&prior.recoveryBaseline>0){diagnostics.baseline=prior.recoveryBaseline;diagnostics.baselineDays=[...(prior.baselineDays||[])];diagnostics.ratio=latest.added/prior.recoveryBaseline;}
 if(prior.evaluatedDay&&latest.day<=prior.evaluatedDay){
  diagnostics.reason='already_evaluated';
  // A depleted pool can prevent completion of the next 64-query day. Fresh
  // observed evidence may refill the active episode without another daily trigger.
  if(diagnostics.baseline!==null&&state.stage!>0){
   const refilled=refill(false);
   if(refilled.queries.length)diagnostics.reason='new_evidence_in_active_episode';
   return refilled;
  }
  return result();
 }
 const baselineDays=days.slice(0,-1).slice(-7);
 const frozen=typeof prior.recoveryBaseline==='number'&&Number.isFinite(prior.recoveryBaseline)&&prior.recoveryBaseline>0?prior.recoveryBaseline:null;
 if(!frozen&&baselineDays.length<3){diagnostics.reason='insufficient_baseline';return result();}
 const baseline=frozen??median(baselineDays.map(h=>h.added));
 diagnostics.baseline=baseline;diagnostics.baselineDays=frozen?[...(prior.baselineDays||[])]:baselineDays.map(h=>h.day);
 state.evaluatedDay=latest.day;
 if(baseline<=0){diagnostics.reason='zero_baseline';return result();}
 diagnostics.ratio=latest.added/baseline;
 if(latest.added>baseline*0.6){diagnostics.reason=frozen?'recovered':'above_threshold';delete state.recoveryBaseline;state.baselineDays=[];return result();}
 diagnostics.triggered=true;diagnostics.reason='yield_at_or_below_60_percent';state.recoveryBaseline=baseline;state.baselineDays=[...diagnostics.baselineDays];state.stage=Math.min(Number.MAX_SAFE_INTEGER,state.stage!+1);diagnostics.stage=state.stage;
 return refill(true);
 function refill(includeCurated:boolean){
 const seen=new Set([...(state.pendingQueries||[]).map(q=>q.query),...(state.proposedQueries||[]),...(input.usedQueries||[]),...(input.exhaustedQueries||[])].map(normalize));
 // Give the newly unlocked category real slots before abundant food evidence can
 // fill the queue. Never replace pending proposals; after the final curated stage,
 // observed novelty again leads, so ongoing expansion is not a static loop.
 const curated=(list:string[])=>list.map(phrase=>({phrase,provenance:{kind:'curated_wellness' as const}}));
 const unlocked=includeCurated&&state.stage!>=1&&state.stage!<=stages.length?stages[state.stage!-1]:[];
 const older=includeCurated?stages.slice(0,Math.min(state.stage!-1,stages.length)):[];
 const phrases=[...curated(unlocked),...evidencePhrases(input.evidence||[],input.currentDay),...older.flatMap(curated)];
 const queries:AdaptiveQuery[]=[];
 const capacity=Math.min(64-state.pendingQueries!.length,2048-state.proposedQueries!.length);
 if(capacity<=0){diagnostics.sourceStatus=state.pendingQueries!.length?'pending_queries_available':'novelty_history_required';return result();}
 for(const candidate of phrases){
  for(const suffix of suffixes){const query=normalize(candidate.phrase+suffix);if(seen.has(query))continue;seen.add(query);queries.push({...candidate,query,stage:state.stage});if(queries.length>=capacity)break;}
  if(queries.length>=capacity)break;
 }
 state.proposedQueries!.push(...queries.map(q=>q.query));state.pendingQueries!.push(...queries);diagnostics.proposed=queries.length;diagnostics.sourceStatus=queries.length?'new_queries_available':state.pendingQueries!.length?'pending_queries_available':'sources_exhausted';
 return result(queries);
 }
}

// Call in the same atomic reservation that consumes the normal search lease slots.
// Keep returned state even on failed/blocked requests. The caller's full audited
// used-query history lets the bounded reservation ledger discard completed items.
export function consumeAdaptiveQueries(input:{state:AdaptiveState;limit?:number;usedQueries?:string[];exhaustedQueries?:string[]}){
 const limit=input.limit??2;if(!Number.isInteger(limit)||limit<0||limit>2)throw Error('Adaptive queries must use at most two existing lease slots');
 const used=new Set([...(input.usedQueries||[]),...(input.exhaustedQueries||[])].map(normalize));
 const unique=new Set<string>();
 const pending=(input.state.pendingQueries||[]).filter(q=>{const key=normalize(q.query);if(used.has(key)||unique.has(key))return false;unique.add(key);return true;});
 const queries=pending.slice(0,limit);
 const state:AdaptiveState={...input.state,pendingQueries:pending.slice(limit),proposedQueries:[...(input.state.proposedQueries||[])].filter(q=>!used.has(normalize(q)))};
 return {state,queries,pendingQueries:state.pendingQueries};
}

// Select a fallback without replaying the finite static pool. Skips advance the
// planning cursor, not the daily query count; only an actual selected query uses
// one of the existing lease slots. The caller must persist nextCursor atomically.
export function nextUnusedStaticSearch(cursor:number,keywords:string[]=[],usedQueries:string[]=[]){
 if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid search cursor');
 const topics=new Set([...keywords,...searchTopics,...searchSubtopics].map(x=>x.trim()).filter(Boolean));
 const cycle=topics.size*searchVariants.length;
 if(!Number.isSafeInteger(cursor+cycle))throw Error('Search cursor exceeds safe range');
 const used=new Set(usedQueries.map(q=>normalize(q).toLowerCase()));
 for(let offset=0;offset<cycle;offset++){
  const plan=searchPlan(cursor+offset,keywords);
  if(!used.has(normalize(plan.query).toLowerCase()))return {plan,nextCursor:cursor+offset+1,exhausted:false};
 }
 return {plan:null,nextCursor:cursor+cycle,exhausted:true};
}
