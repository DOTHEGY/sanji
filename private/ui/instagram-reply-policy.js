/* Pure draft preparation. This module cannot authenticate evidence, save or send. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SanjiInstagramReplyPolicy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const negative = /(거절|사양|불가|어렵|어려|힘들|원하지|관심\s*없|진행\s*안|협업\s*안|declin|not interested|no thanks)/i;
  const paid = /(유료|광고비|원고료|출연료|비용|페이|단가|paid|\bfee\b)/i;
  const forbidden = /(수수료|커미션|commission|리베이트|보수|매출|수익|수입|이익|분배|지급|판매가|원가|할증|운영비|대행비|중개료|중개비|기여금|리워드|성과급|보너스|royalt|revenue|profit|rebate|payout|광고비|원고료|출연료|제작비|비용|페이|단가|배분|정산|마진|할인|가격|공구가|소비자가|무료|\bfees?\b|\bprice\b|\bpayment\b|\bcost\b|₩|\$|€|%|퍼센트|\d\s*원)/i;
  // Only these neutral factual phrases can appear in generated copy. Other submitted
  // claims remain unconfirmed and are not echoed; future additions require review.
  const safeClaims = new Set(['개별 포장','상온 보관','카페인 함유','디카페인','무가당','병 포장','분말 형태','액상 형태','바 형태']);
  const sensitive = /(질병|질환|치료|진단|환자|복용|임신|불임|우울증|pregnan|diabet|disease|illness|patient|medicat|cancer|therapy|depress)/i;
  const cleanText = (v,max) => typeof v==='string' && v.trim().length>0 && v.trim().length<=max && !/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(v) && !forbidden.test(v.normalize('NFKC')) && !sensitive.test(v.normalize('NFKC'));
  const cleanTopic = v => cleanText(v,60) && v.trim().length>=2 && !/[\/@]/.test(v);
  const topics = values => new Set((Array.isArray(values)?values:[]).filter(cleanTopic).map(x=>x.trim().normalize('NFKC').toLocaleLowerCase()));
  function sourceUrl(value){
    if(typeof value!=='string'||value.length>1000)return '';
    try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.hostname.endsWith('.test')||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||/^[\d.]+$/.test(u.hostname)||forbidden.test(decodeURIComponent(u.hostname+u.pathname).normalize('NFKC')))return '';return u.toString();}catch{return '';}
  }
  // A caller must independently resolve these review records in a trusted system.
  // The structure, timestamps and URL are NOT proof of truth, ownership or authorization.
  function evidence(e,productId,now){
    if(!e||e.status!=='reviewed'||(productId!==null&&e.productId!==productId)||typeof e.reviewId!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(e.reviewId)||typeof e.reviewedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(e.reviewedAt)||typeof e.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(e.observedAt))return null;
    const at=Date.parse(e.reviewedAt),observed=Date.parse(e.observedAt),url=sourceUrl(e.sourceUrl);if(!url||!Number.isFinite(at)||!Number.isFinite(observed)||at>now+300000||observed>at||now-at>365*86400000||now-observed>365*86400000)return null;
    return {sourceUrl:url,observedAt:e.observedAt,reviewedAt:e.reviewedAt,provenance:'reviewer_submitted'};
  }
  function validContext(messages,c){
    return c?.contextReviewed===true&&c?.contextComplete===true&&c?.latestDirection==='inbound'&&Array.isArray(messages)&&messages.length>0&&messages.every(m=>m&&typeof m.out==='boolean'&&typeof m.text==='string'&&m.text.trim()&&m.text.length<=10000)&&messages[messages.length-1].out===false;
  }
  // Text patterns can add holds but cannot establish intent or guarantee detection.
  function replyMode(intent,messages,c={}){
    const text=(Array.isArray(messages)?messages:[]).filter(m=>m&&m.out===false&&typeof m.text==='string').map(m=>m.text.normalize('NFKC')).join('\n');
    if(intent==='declined'||negative.test(text))return 'declined';
    if(intent==='paid'||paid.test(text))return 'paid';
    return intent==='interested'&&validContext(messages,c)?'interested':'review';
  }
  function prepare(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))input={};
    const source=Array.isArray(input.products)?input.products:[],expectedCount=37;
    // No production trust source is wired. This deliberately admits ONLY test fixtures.
    // The flag is not an authorization mechanism or proof of evidence.
    const withinLimits=source.length<=37&&(!Array.isArray(input.messages)||input.messages.length<=100)&&(!Array.isArray(input.creatorTopics)||input.creatorTopics.length<=20)&&source.every(p=>!p||(!Array.isArray(p.claims)||p.claims.length<=10)&&(!Array.isArray(p.topics)||p.topics.length<=20));
    const synthetic=withinLimits&&input.testOnly===true&&source.every(p=>p&&typeof p.id==='string'&&/^fixture-[0-9]{1,5}$/.test(p.id)&&typeof p.name==='string'&&/^가상 상품 [0-9]{1,5}$/.test(p.name));
    if(!synthetic)return {mode:'review',draft:'',recommended:[],remaining:[],invalidCount:0,expectedCount,complete:false,catalogNotice:'실제 출처 확인 체계가 연결되지 않아 추천을 보류합니다.',reason:'trusted_evidence_unavailable'};
    const now=Date.now(),messages=input.messages,mode=replyMode(input.intent,messages,input),contextOK=validContext(messages,input);
    const seen=new Map();for(const p of source)if(p&&typeof p.id==='string'&&p.id.trim())seen.set(p.id.trim(),(seen.get(p.id.trim())||0)+1);
    const creatorEvidence=evidence(input.creatorEvidence,null,now),creatorTopics=creatorEvidence?topics(input.creatorTopics):new Set();
    let invalidCount=0;const valid=[];
    for(const p of source){
      const id=typeof p?.id==='string'?p.id.trim():'';
      if(!/^[A-Za-z0-9_.:-]{1,100}$/.test(id)||forbidden.test(id)||seen.get(id)!==1||!cleanText(p?.name,100)){invalidCount++;continue;}
      const nameEvidence=evidence(p.nameEvidence,id,now),topicEvidence=evidence(p.topicsEvidence,id,now);
      const productTopics=topicEvidence?topics(p.topics):new Set(),matchedTopics=[...productTopics].filter(x=>creatorTopics.has(x));
      const availabilityEvidence=p.availability?.status==='available'?evidence(p.availability.evidence,id,now):null,available=!!availabilityEvidence;
      const claims=(Array.isArray(p.claims)?p.claims:[]).flatMap(c=>{const e=evidence(c?.evidence,id,now);return e&&cleanText(c.text,160)&&safeClaims.has(c.text.trim())?[{text:c.text.trim(),...e}]:[]});
      valid.push({id,name:p.name.trim(),nameEvidence,topicEvidence,availabilityEvidence,available,matchedTopics,claims});
    }
    const complete=input.catalogComplete===true&&source.length===expectedCount&&invalidCount===0;
    const ranked=valid.filter(p=>p.nameEvidence&&p.available&&p.matchedTopics.length>0&&p.claims.length>0).sort((a,b)=>b.matchedTopics.length-a.matchedTopics.length||a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
    const recommended=mode==='interested'&&complete?ranked.slice(0,3):[],selected=new Set(recommended.map(p=>p.id));
    // In a hold state no product names or claims are returned, even for internal display.
    const remaining=mode==='interested'?valid.filter(p=>!selected.has(p.id)).map(p=>({id:p.id,name:p.name,nameEvidence:p.nameEvidence,status:p.nameEvidence&&p.available&&p.claims.length?'검토 자료 제출됨':'자료 확인 필요',missing:[...(!p.nameEvidence?['상품명 출처']:[]),...(!p.available?['진행 조건']:[]),...(!p.claims.length?['소구점']:[]),...(!p.matchedTopics.length?['적합성']:[])]})):[];
    let draft='';
    if(contextOK&&mode==='declined')draft='답장 주셔서 감사합니다. 말씀해 주신 내용 확인했습니다.';
    else if(contextOK&&mode==='paid')draft='답장 주셔서 감사합니다. 말씀해 주신 협업 조건을 확인했습니다.';
    else if(mode==='interested'&&recommended.length)draft='답장 주셔서 감사합니다.\n\n함께 검토해 볼 상품을 안내드립니다.\n'+recommended.map(p=>'- '+p.name+' · '+p.claims[0].text).join('\n')+'\n\n관심 있는 방향을 말씀해 주시면 확인 후 안내드리겠습니다.';
    if(draft)draft='[합성 테스트 전용]\n'+draft;
    return {mode,draft,recommended,remaining,invalidCount,expectedCount,complete,syntheticOnly:true,catalogNotice:complete?'합성 테스트 전용 · 입력 목록 기준 37개입니다. 출처와 개별 조건은 다시 확인해야 합니다.':'합성 테스트 전용 · 상품 목록이 불완전하거나 전체 여부가 확인되지 않았습니다.'};
  }
  // Display-only submissions. They are untrusted strings, never fetched or verified.
  // Consumers MUST escape every string and must not automatically follow or load URLs.
  function displaySource(value){
    if(typeof value!=='string'||value.length>1200||/[\x00-\x20\x7f]/.test(value))return null;
    try{
      const u=new URL(value),host=u.hostname.toLowerCase();
      if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||/^[\d.]+$/.test(host)||host.includes(':')||host.split('.').some(label=>label.startsWith('xn--'))||forbidden.test(host.normalize('NFKC')))return null;
      const path=decodeURIComponent(u.pathname).normalize('NFKC');
      if(/[\x00-\x1f\x7f]/.test(path)||/(password|passwd|secret|token|credential|session|authorization|api[_-]?key)/i.test(path)||/[a-f0-9]{32,}/i.test(path)||forbidden.test(path))return null;
      for(const [k,v] of u.searchParams){if(!/^(?:product_no|product_id|goodsNo|item_id|id|idx|no)$/i.test(k)||!/^\d{1,18}$/.test(v))return null;}
      return u.toString();
    }catch{return null;}
  }
  function observedTimestamp(value,now){
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))return null;
    const at=Date.parse(value);if(!Number.isFinite(at)||at>now+300000)return null;
    const iso=new Date(at).toISOString(),normalized=value.includes('.')?value.replace(/\.(\d{1,3})Z$/,(_,n)=>'.'+n.padEnd(3,'0')+'Z'):value.replace(/Z$/,'.000Z');
    return iso===normalized?value:null;
  }
  function previewCatalog(input={}){
    const base={items:[],count:0,complete:false,recommendationEnabled:false,draftEnabled:false};
    if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.products))return {...base,reason:'invalid_input',notice:'제출 자료 형식을 확인해 주세요.'};
    const source=input.products;if(source.length>37)return {...base,count:source.length,reason:'too_many_items',notice:'상품은 최대 37개까지 표시할 수 있습니다.'};
    const idOf=p=>typeof p?.id==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(p.id.trim())&&!forbidden.test(p.id.trim())?p.id.trim().toLowerCase():null;
    const nameOf=p=>typeof p?.name==='string'&&p.name.trim().length>0&&p.name.trim().length<=100&&!/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(p.name)&&!forbidden.test(p.name.normalize('NFKC'))&&!/(?:\d\s*(?:만|천|백)?\s*원|(?:십|백|천|만|억)원)/.test(p.name.normalize('NFKC'))?p.name.trim():null;
    const nameKey=n=>n?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' '),ids=new Map(),names=new Map();
    for(const p of source){const id=idOf(p),name=nameKey(nameOf(p));if(id)ids.set(id,(ids.get(id)||0)+1);if(name)names.set(name,(names.get(name)||0)+1);}
    const now=Date.now(),items=Array.from(source,(p,index)=>{
      const id=idOf(p),name=nameOf(p),sourceUrl=displaySource(p?.nameEvidence?.sourceUrl),observedAt=observedTimestamp(p?.nameEvidence?.observedAt,now),issues=[];
      if(!id)issues.push('식별자 미확인');else if(ids.get(id)>1)issues.push('식별자 중복');
      if(!name)issues.push('상품명 미확인');else if(names.get(nameKey(name))>1)issues.push('이름 중복 가능 · 구성 확인 필요');
      if(!sourceUrl)issues.push('출처 미확인');if(!observedAt)issues.push('관측 시각 미확인');
      return {index:index+1,id,name,sourceUrl,observedAt,status:issues.length?'미확인':'제출됨 · 진위 미확인',issues};
    });
    const formatComplete=source.length===37&&items.every(x=>x.issues.length===0);
    return {items,count:source.length,complete:false,formatComplete,recommendationEnabled:false,draftEnabled:false,notice:'제출 자료 표시만 가능합니다. 전체 목록 여부와 출처·관측 시각의 진위는 확인되지 않았습니다.'};
  }
  return {replyMode,prepare,previewCatalog};
});
