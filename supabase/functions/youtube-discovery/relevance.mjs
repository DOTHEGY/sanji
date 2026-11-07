// Navigation aids over visible source text, not suitability/reputation scores.
const topics = [
 {id:'convenience',label:'편의점',aliases:['편의점','convenience store']},
 {id:'bun',label:'호빵',aliases:['호빵'],related:['찐빵','steamed bun']},
 {id:'school_meals',label:'급식',aliases:['급식','school lunch','school meals']},
 {id:'mukbang',label:'먹방',aliases:['먹방','mukbang']},
 {id:'vegan',label:'비건',aliases:['비건','vegan']},
 {id:'coffee',label:'커피',aliases:['커피','coffee']},
 {id:'cooking',label:'요리',aliases:['요리','레시피','cooking','recipe','recipes']},
 {id:'food',label:'음식',aliases:['음식','푸드','food']},
 {id:'camping',label:'캠핑',aliases:['캠핑','camping']},
 {id:'travel',label:'여행',aliases:['여행','travel']},
 {id:'zero_waste',label:'제로웨이스트',aliases:['제로웨이스트','zero waste','zero-waste']},
 {id:'eco',label:'친환경',aliases:['친환경','eco-friendly']},
];
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function pattern(term){return /^[\x00-\x7f]+$/.test(term)?new RegExp('(?<![a-z0-9])'+escape(normalize(term))+'(?![a-z0-9])','iu'):new RegExp(escape(normalize(term)),'iu');}
const has=(text,term)=>pattern(term).test(normalize(text));
const unique=values=>[...new Set(values)];
const filler=new Set(['협업','크리에이터','유튜버','찾기','찾아줘','찾아주세요','추천','런칭','출시','브랜드','업체','업체의','되어줄','같이','함께','필요한','적합한','한국어','국내','한국','소개할','만드는','소개하는','찾는','찾고','있어','있어요','싶어','싶어요','개인','채널','콘텐츠','분야','모델','공동','ip','ip가','ip의','클린','논란','없는','안전한','건전한','제외','말고','빼고','아닌','섭외']);
export function buildBriefReview(brief, explicitQueries){
 const raw=String(brief||'').normalize('NFKC').trim();let positive=raw;
 const excludedTerms=[];
 // Ambiguous negation/quotation must never turn an exclusion into a positive query.
 const exclusionMention=/제외|말고|빼고|아닌|\b(?:not|without|exclude|excluding|except|no)\b/i.test(raw);
 let requiresQueryReview=exclusionMention&&(/["'“”‘’`?？]/.test(raw)||/\b(?:not|without|exclude|excluding|except|no)\b/i.test(raw)||/(?:제외|말고|빼고).{0,15}(?:안\s*(?:함|하|해)|않|아니|하지\s*마|불필요|필요\s*없)|아닌.{0,20}(?:제외|말고|빼고)|(?:제외|말고|빼고).{0,20}아닌/.test(raw));
 if(requiresQueryReview)positive='';
 else {
   const excludedVocabulary=unique(['뉴스 전문 채널','뉴스 채널','보도 채널','렌탈 업체','뉴스','업체','기업','회사','언론사','술',...topics.flatMap(t=>[...t.aliases,...(t.related||[])])]).sort((a,b)=>b.length-a.length);
   for(const phrase of excludedVocabulary){
     const p=new RegExp('(^|[\\s,.;])('+escape(phrase).replace(/ /g,'\\s+')+')(?:은|는|을|를|이|가)?\\s*(?:제외|말고|빼고|아닌)(?=$|[\\s,.;])','giu');
     positive=positive.replace(p,(whole,separator,term)=>{excludedTerms.push(term);return separator;});
   }
   // Unknown multiword exclusions cannot be safely reduced to their last token.
   if(/제외|말고|빼고|아닌/.test(positive)){requiresQueryReview=true;positive='';excludedTerms.length=0;}
 }
 const active=topics.filter(t=>t.aliases.some(a=>has(positive,a))&&!excludedTerms.some(e=>t.aliases.some(a=>has(e,a)))).sort((a,b)=>Math.min(...a.aliases.map(x=>normalize(positive).indexOf(normalize(x))).filter(x=>x>=0))-Math.min(...b.aliases.map(x=>normalize(positive).indexOf(normalize(x))).filter(x=>x>=0)));
 const known=active.flatMap(t=>[...t.aliases,...(t.related||[])]);
 const extras=positive.split(/[^\p{L}\p{N}_-]+/u).filter(v=>!filler.has(normalize(v))).map(v=>v.replace(/(?:에서|에게|으로|들을|들이|을|를|은|는|에)$/u,'')).filter(v=>v.length>=2&&v.length<=30&&!filler.has(normalize(v))&&!excludedTerms.some(e=>has(v,e))&&!known.some(a=>has(v,a))&&!/^(?:논란|클린|안전|건전|출시|런칭|협업|찾아|제외|추천|되어)/.test(v));
 const requested=active.map(t=>({...t,requestedAliases:t.aliases.filter(a=>has(positive,a))}));
 for(const value of unique(extras).slice(0,5))requested.push({id:'literal:'+normalize(value),label:value,aliases:[value],requestedAliases:[value]});
 const unknownSubject = extras.some(t=>!/^(?:마라|매운|매콤|불닭|spicy)$/i.test(t)&&!/^(?:크리에이터|유튜버|납품|판매|공급|런칭|출시|협업|찾아|원하|원해)/.test(t));
 const explicitOtherField = unknownSubject || active.some(t=>['camping','travel','coffee','zero_waste','eco'].includes(t.id));
 const excludedFoodDirection = excludedTerms.some(e=>['먹방','mukbang','음식','푸드','food','요리','레시피','cooking','recipe'].some(t=>has(e,t)));
 const foodCollaboration = !requiresQueryReview && !explicitOtherField && !excludedFoodDirection && active.some(t=>['bun','school_meals','food'].includes(t.id)) && /협업|크리에이터|유튜버|출시|런칭|납품|IP|ip/.test(positive);
 const primaryCategory = active.some(t=>t.id==='cooking') && !active.some(t=>t.id==='mukbang') ? '요리' : '먹방';
 const categoryQuery = [active.some(t=>t.id==='vegan')?'비건':null,primaryCategory].filter(Boolean).join(' ');
 const spicy = foodCollaboration && /마라|매운|매콤|불닭|spicy/i.test(positive);
 const discoveryIntent = foodCollaboration ? { primaryCategory, secondaryCategories:['음식 리뷰'], productTerms:active.filter(t=>t.id==='bun').map(t=>t.label), contextTerms:active.filter(t=>t.id==='convenience').map(t=>t.label), modifiers:spicy?['매운맛']:[], inferred:true, explanation:'상품명 일치보다 먹방·음식 리뷰 분야부터 찾습니다. 분야는 요청에서 제안한 검색 방향이며 채널 검증 결과가 아닙니다.' } : null;
 const manualChecks=['협업 의사·조건·현재 소속은 직접 확인해야 합니다.','근거는 이번 검색의 제목·설명 일부만 포함하며 전체 채널을 검토한 것이 아닙니다.'];
 if(/클린|논란|안전|건전|clean|brand.safe/i.test(raw))manualChecks.unshift('클린 이미지·논란 없음·브랜드 안전성은 제목이나 설명만으로 확인할 수 없습니다.');
 if(/급식|청소년|학생|어린이|아동|school/i.test(raw))manualChecks.push('시청자 연령·급식 대상 적합성·광고 적법성은 확인되지 않았습니다.');
 if(/\bIP\b|캐릭터|라이선스|모델|ip가|ip의/i.test(raw))manualChecks.push('IP·초상·상표 사용권과 계약 범위는 별도 확인이 필요합니다.');
 if(excludedTerms.length)manualChecks.push('명시한 제외 표현: '+unique(excludedTerms).join(', ')+' · 검색어에서만 뺐으며 후보를 자동 탈락시키지 않습니다. 접기 필터와 원문을 직접 확인하세요.');
 else if(exclusionMention)manualChecks.push('제외 조건의 의미를 자동 확정하지 않았습니다. 검색어와 후보 필터를 직접 확인하세요.');
 let queries;
 if(explicitQueries?.length)queries=[...explicitQueries];
 else {
   const base=unique([...active.map(t=>t.label),...extras]).join(' ').slice(0,100);
   queries=base?[base]:[];
   if(foodCollaboration) queries = [categoryQuery, [active.some(t=>t.id==='vegan')?'비건':null, spicy ? '매운 음식 '+primaryCategory : active.some(t=>t.id==='convenience') ? '편의점 음식 리뷰' : '음식 리뷰'].filter(Boolean).join(' ')];
   else if(active.some(t=>t.id==='school_meals')&&active.some(t=>t.id==='mukbang')&&/IP|ip|협업|업체/.test(raw))queries.push('먹방 음식 리뷰');
 }
 // Check every generated expansion, including legacy fallbacks, against explicit exclusions.
 if(!explicitQueries?.length)queries=queries.filter(q=>!excludedTerms.some(e=>has(q,e)||topics.some(t=>[...t.aliases,...(t.related||[])].some(a=>has(e,a))&&[...t.aliases,...(t.related||[])].some(a=>has(q,a)))));
 // Explicit user search terms are an alternative when the brief states only review requirements.
 if(!requested.length&&explicitQueries?.length)for(const q of explicitQueries)for(const value of q.split(/\s+/).filter(v=>v.length>=2&&!v.startsWith('-')).slice(0,5))requested.push({id:'literal:'+normalize(value),label:value,aliases:[value],requestedAliases:[value]});
 return {discoveryIntent,requiresQueryReview,topicTerms:requested,excludedTerms:unique(excludedTerms),unresolvedRequirements:manualChecks,queries:unique(queries).slice(0,2),notes:['검색어와 접기 필터는 검토 보조입니다. 적합도·평판 점수를 계산하지 않습니다.',...(queries.length>1&&!explicitQueries?['두 번째 검색은 상품명 직접 언급이 없는 관련 분야 채널도 검토하기 위한 확장 검색입니다.']:[])]};
}
function excerpt(text,index,length){const start=Math.max(0,index-45),end=Math.min(text.length,index+length+90);return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');}
function textSources(channel){return [
 {sourceType:'channel_title',text:channel.title||'',url:channel.url,sourceId:channel.channelId},
 {sourceType:'channel_description',text:channel.description||'',url:channel.url,sourceId:channel.channelId},
 ...(channel.videos||[]).flatMap(v=>[{sourceType:'video_title',text:v.title||'',url:v.url,sourceId:v.videoId},{sourceType:'video_description_preview',text:v.descriptionPreview||'',url:v.url,sourceId:v.videoId}]),
 ];}
function uncertainClause(text){return /["'“”‘’`?？]|(?:아니|아닌|아닙|않|없|제외|말고|인용|예시|전직|과거|출신|출연|게스트|소개되|비판|리뷰한)|\b(?:not|never|no|without|former|example|quote)\b/i.test(text);}
function flags(channel){
 const rows=[],description=String(channel.description||'');
 // Keep whole-description punctuation and history context before clause splitting.
 if(/[?？"'“”‘’`]/.test(description)||/과거|전직|출신|한때|이었|였던|이전에는|\b(?:former|formerly|used to)\b/i.test(description))return rows;
 const clauses=description.split(/[.!?。\n]|\s*[|｜]\s*/).filter(Boolean);
 const rules=[
  {kind:'news_language',label:'뉴스·보도 자기소개 표현',pattern:/뉴스\s*전문\s*채널|보도\s*전문|뉴스\s*방송사|언론사\s*(?:공식|채널)|공식\s*뉴스\s*채널|대표\s*뉴스\s*채널|\b(?:news organization|news broadcaster|official news channel|news channel)\b/iu},
  {kind:'business_language',label:'업체·서비스 자기소개 표현',pattern:/(?:렌탈|대여)\s*전문\s*(?:업체|회사|기업)|공식\s*(?:렌탈|대여)\s*서비스|(?:회사|기업|업체|식당|제조사|브랜드)의?\s*공식\s*(?:유튜브\s*)?채널|공식\s*(?:식당|제조사|업체|기업|브랜드)\s*채널|\b(?:official rental service|rental company|official company channel|official brand channel)\b/iu},
 ];
 for(const rule of rules){
   const affirmative=s=>{
     const m=rule.pattern.exec(s);if(!m||uncertainClause(s))return false;
     if(/(?:채널|업체|회사|서비스)(?:과|와|에서)|(?:채널|업체|회사|서비스)(?:을|를|에)?\s*(?:소개|비판|리뷰|분석|방문|출연|참고|비교|만나)|협업했던|\b(?:review|reviews|reviewing|coverage|react|reacting|critique|collaboration|interview|interviews)\b/i.test(s))return false;
     const before=s.slice(0,m.index),after=s.slice(m.index+m[0].length);
     return /^\s*(?:입니다|이다|이에요|예요)/.test(after)||/\b(?:we are|this channel is|i run|i operate)\b/i.test(before)||(!before.trim()&&!after.trim()&&/공식|대표|^official/i.test(m[0]));
   };
   const clause=clauses.find(affirmative);
   if(!clause)continue;
   // Contradictory self-description anywhere in the visible description stays unclassified.
   if(clauses.some(s=>rule.pattern.test(s)&&uncertainClause(s)))continue;
   const match=rule.pattern.exec(clause);rows.push({kind:rule.kind,label:rule.label,evidence:[{sourceType:'channel_description',url:channel.url,excerpt:excerpt(clause,match.index,match[0].length)}],note:'공개 자기소개 표현일 뿐 운영 주체·소속 검증이나 협업 부적합 판정은 아닙니다. 음식·개인 콘텐츠 근거와 함께 검토하세요.'});
 }
 return rows;
}
export function annotateCandidate(channel,criteria){
 const sources=textSources(channel),evidence=[],unconfirmedTerms=[];
 for(const topic of criteria.topicTerms){
   let found=false;
   for(const source of sources){
     const text=String(source.text).normalize('NFKC');if(!text)continue;
     for(const term of [...topic.aliases,...(topic.related||[])]){
       const match=pattern(term).exec(text.toLowerCase());if(!match)continue;
       found=true;evidence.push({term:topic.label,matchedText:text.slice(match.index,match.index+match[0].length),matchType:topic.related?.includes(term)?'related_term':topic.requestedAliases?.some(a=>normalize(a)===normalize(term))?'literal_term':'alias_term',sourceType:source.sourceType,sourceId:source.sourceId,url:source.url,excerpt:excerpt(text,match.index,match[0].length),contextWarning:uncertainClause(text.split(/[.!?。\n]/).find(s=>has(s,term))||'')?'부정·인용·조건 표현이 있어 원문의 의미를 직접 확인하세요.':null});break;
     }
     if(evidence.filter(e=>e.term===topic.label).length>=2)break;
   }
   if(!found)unconfirmedTerms.push(topic.label);
 }
 return {...channel,evidence:evidence.slice(0,16),unconfirmedTerms,contentFlags:flags(channel),evidenceNote:evidence.length?'요청 주제와 같은 표현 또는 표시된 관련어가 공개 원문에 있습니다. 협업 적합성은 미확인입니다.':'이번에 표시된 제목·설명 일부에서 요청 주제 근거를 찾지 못했습니다. 부적합하다는 뜻은 아닙니다.'};
}
