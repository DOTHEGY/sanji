/* Source-grounded, local-only product planning. No transport, persistence or send authorization. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.InstagramAutoProducts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const TOPICS = {
    travel: ['여행', 'travel'], drone_photography: ['드론', '드론 촬영', 'drone_photography'],
    travel_sponsorships: ['여행', 'travel_sponsorships'], packaged_vegetable_drink: ['과채음료', '과채 주스', 'packaged_vegetable_drink'],
    parenting: ['육아', 'parenting'], household_bath: ['욕실용품', '목욕용품', '샴푸', '비누', '바디바', '세정용품', 'household_bath'],
    food_easy_meals: ['간편식', '밀키트', 'food_easy_meals'], restaurants: ['음식점', '맛집', 'restaurants'],
    home_interior: ['인테리어', '홈인테리어', 'home_interior'], home_cafe: ['홈카페', '홈 카페', 'home_cafe'],
    dining: ['다이닝', '테이블웨어', 'dining'], household_lifestyle: ['생활용품', '리빙', '살림', 'household_lifestyle'],
    beauty: ['뷰티', 'beauty'], fashion: ['패션', 'fashion'], fitness: ['운동', 'fitness'],
    pets: ['반려동물', 'pets'], outdoors: ['아웃도어', '캠핑', 'outdoors'], baking: ['베이킹', 'baking'],
    coffee: ['커피', 'coffee'], food: ['식품', '음식', '푸드', 'f&b', 'food'], lifestyle: ['생활', '라이프스타일', 'lifestyle'],
    photography: ['사진', '촬영', 'photography']
  };
  const EXTRA = {
    drink: ['음료', 'drink'], tea: ['차', 'tea'], tableware: ['식기', '그릇', '테이블웨어', 'tableware'],
    kitchen_tools: ['주방용품', '조리도구', 'kitchen_tools'], snack: ['간식', '과자', '쿠키', 'snack'],
    photo_accessories: ['촬영용품', '삼각대', '카메라 액세서리', 'photo_accessories'],
    portable: ['휴대용', '휴대형', '개별포장', '개별 포장', '스틱형', '파우치', '티백', '캔음료', 'portable', 'single-serve']
  };
  const HEALTH_EXCLUSION_LABEL = '건강·웰니스';
  const HEALTH_EXCLUSION_ALIASES = ['건강·웰니스', '웰니스·건강', '건강 및 웰니스', '웰니스 및 건강', '건강/웰니스', '웰니스/건강', '건강식품', '건강기능식품', '건강 기능 식품', '건기식', '웰니스', '건강', 'wellness', 'health food', 'health supplements', 'dietary supplements'];
  function explicitlyHealthCategorized(deal) {
    const categoryLabels = [text(deal.category), ...strings(deal.topics)].flatMap(value => norm(value).split(/[,·/]/).map(text));
    return categoryLabels.some(label => HEALTH_EXCLUSION_ALIASES.includes(label)) || [deal.name, deal.productName].some(value => /건강\s*(?:기능\s*)?식품|건기식|웰니스|\bwellness\b|\bdietary\s+supplements?\b|\bhealth\s+(?:food|supplements?)\b/i.test(text(value)));
  }
  const ALIASES = { ...TOPICS, ...EXTRA };
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const norm = (value) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const strings = (value) => Array.isArray(value) ? value.filter(x => typeof x === 'string').map(text).filter(Boolean) : [];
  const unique = (value) => [...new Set(value)];
  const safeDescriptor = (value) => !!text(value) && text(value).length <= 300 && !/[\x00-\x1f@]/.test(value) && !/(?:수수료|커미션|commission|원고료|고료|지원금|https?:\/\/)/i.test(value);
  const safeTopic = (value) => value.length >= 2 && value.length <= 60 && !/[\x00-\x1f@]/.test(value) && !/\d{7}/.test(value) && !/(질병|질환|치료|진단|환자|복용|임신|불임|우울증|당뇨|암환|효능|효과|pregnan|diabet|disease|illness|patient|medicat|cancer|therapy|depress|efficacy)/i.test(value);
  function safeUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : ''; } catch { return ''; }
  }
  function productUrl(value) {
    const result = safeUrl(value);
    if (!result) return '';
    const u = new URL(result);
    if (/(?:^|\.)(?:mail\.google\.com|gmail\.com|drive\.google\.com|docs\.google\.com|outlook\.com|dropbox\.com|chatgpt\.com|supabase\.co)$/.test(u.hostname) || /\/(?:login|signin|admin|direct)(?:\/|$)/i.test(u.pathname) || [...u.searchParams.keys()].some(k => /token|secret|signature|password|auth|key/i.test(k))) return '';
    try { if (/commission|affiliate|payout|수수료|커미션|정산/i.test(decodeURIComponent(u.pathname + u.search + u.hash))) return ''; } catch { return ''; }
    return result;
  }
  function exactTopic(value) {
    const token = norm(value);
    if (!safeTopic(token) || !safeDescriptor(token)) return '';
    for (const [key, values] of Object.entries(ALIASES)) if (key === token || values.some(x => norm(x) === token)) return key === 'travel_sponsorships' ? 'travel' : key;
    return token;
  }
  function tokenContains(value, word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'iu').test(value);
  }
  function topicsInText(value) {
    const s = norm(value), found = [];
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (aliases.some(a => tokenContains(s, norm(a)))) found.push(key === 'travel_sponsorships' ? 'travel' : key);
    }
    return unique(found);
  }
  function evidence(kind, label, field, value, extra = {}) {
    return { kind, label, field, value, url: '', observedAt: '', strength: 'stored', ...extra };
  }
  function publicResearch(creator, now) {
    const r = creator.publicResearch, handle = norm(creator.handle), at = Date.parse(r?.observedAt || '');
    if (!r || r.revoked === true || text(r.revokedAt || r.revoked_at) || r.status === 'revoked' || r.researchStatus === 'revoked' || r.provenance !== 'operator_attested' || !/^[a-z0-9._]{1,30}$/.test(handle) || ['.', '..'].includes(handle) ||
        !Number.isFinite(at) || at > now + 300000 || !/^[a-f0-9]{64}$/.test(r.captureSha256 || '') ||
        !Array.isArray(r.topics) || !r.topics.length || r.topics.length > 10 || r.topics.some(t => !Object.hasOwn(TOPICS, t)) ||
        !Array.isArray(r.sources) || !r.sources.length || r.sources.length > 10) return null;
    try {
      const profile = new URL(r.profileUrl);
      if (profile.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(profile.hostname) || profile.username || profile.password || profile.port || profile.search || profile.hash || norm(profile.pathname.replace(/\/$/, '')) !== '/' + handle) return null;
      const path = new RegExp('^/' + handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(?:p|reel)/[A-Za-z0-9_-]{1,100}/?$', 'i');
      for (const value of r.sources) { const u = new URL(value); if (u.protocol !== 'https:' || u.hostname !== 'www.instagram.com' || u.username || u.password || u.port || u.search || u.hash || !path.test(u.pathname)) return null; }
    } catch { return null; }
    const stale = now - at > 7 * DAY;
    return { kind: stale ? 'historical_public_research' : 'public_research', label: stale ? '과거 운영자 확인 공개 관찰 · 7일 초과, 현재 활동 미확인' : '운영자 확인 공개 관찰', stale, observedAt: r.observedAt, sources: [...r.sources], captureSha256: r.captureSha256, topics: unique(r.topics.map(exactTopic)), strength: stale ? 'historical' : 'attested' };
  }
  function boundStoredProfile(creator) {
    if (!text(creator.id) || !/^[a-z0-9._]{1,30}$/i.test(text(creator.handle)) || ['.', '..'].includes(creator.handle)) return '';
    try { const u = new URL(creator.profileUrl); return u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname) && !u.username && !u.password && !u.port && !u.search && !u.hash && norm(u.pathname.replace(/\/$/, '')) === '/' + norm(creator.handle) ? u.toString() : ''; } catch { return ''; }
  }
  function creatorContext(creator, now) {
    const fresh = publicResearch(creator, now);
    if (fresh) return { ...fresh, evidence: fresh.topics.map(topic => evidence('creator_public_topic', fresh.stale ? '과거 공개 주제 · 현재 활동 미확인' : '운영자 확인 공개 주제', 'publicResearch.topics', topic, { strength: fresh.strength, observedAt: fresh.observedAt, url: '', sourceUrls: [...fresh.sources], sourceRelation: 'observation_bundle_unpaired' })) };
    // Invalid research must not silently turn into current verified evidence; valid older observations remain dated and weak.
    if (creator.publicResearch) return { kind: 'unverified', label: '공개 관찰의 시각·계정·출처 확인 필요', observedAt: '', sources: [], captureSha256: '', topics: [], evidence: [], strength: 'unknown' };
    const facts = [], profileUrl = boundStoredProfile(creator);
    for (const topic of strings(creator.topics)) if (exactTopic(topic)) facts.push(evidence('creator_stored_topic', '저장 주제 · 현재 활동 미확인', 'topics', exactTopic(topic), { strength: 'weak' }));
    for (const field of ['category', 'bio']) for (const topic of (field === 'bio' && /(?:안\s|않|없|아니|제외|\bnot\b|\bwithout\b)/i.test(text(creator.bio)) ? [] : topicsInText(creator[field]))) facts.push(evidence('creator_stored_' + field, '저장 ' + (field === 'bio' ? '소개' : '분류') + ' · 현재 활동 미확인', field, topic, { strength: 'weak' }));
    return { profileBound: !!profileUrl, kind: facts.length ? 'stored_profile' : 'unknown', label: facts.length ? '저장 소개·분류·주제 기준 · 약한 근거' : '활동 주제 근거 없음', observedAt: '', sources: profileUrl ? [profileUrl] : [], captureSha256: '', topics: unique(facts.map(f => f.value)), evidence: facts.map(f => ({ ...f, url: profileUrl })), strength: facts.length ? 'weak' : 'unknown' };
  }
  // Integrity of an operator-recorded source note, not independent truth/authorship.
  function claimsSha256(value) {
    if (typeof value !== 'string' || typeof TextEncoder !== 'function') return '';
    const data = new TextEncoder().encode(value), length = data.length;
    const bytes = new Uint8Array(Math.ceil((length + 9) / 64) * 64); bytes.set(data); bytes[length] = 128;
    const view = new DataView(bytes.buffer); view.setUint32(bytes.length - 4, length * 8, false);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64), rr = (x,n) => (x >>> n) | (x << (32-n));
    for (let offset=0; offset<bytes.length; offset+=64) {
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4,false);
      for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rr(a,7)^rr(a,18)^(a>>>3))+w[i-7]+(rr(b,17)^rr(b,19)^(b>>>10)))>>>0;}
      let [a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<64;i++){const t1=(j+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
      [a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
    }
    return h.map(v=>v.toString(16).padStart(8,'0')).join('');
  }
  function safeSellingPoint(value) {
    return !!text(value) && value.length <= 400 && !/[<>\x00-\x1f@]/.test(value) &&
      !/(?:[a-z0-9-]+\.)+[a-z]{2,63}(?=$|[^a-z0-9-])/i.test(value) &&
      !/(?:비용|가격|단가|판매가|공구가|정가|배송비|결제|견적|대금|추가금|계약금|보증금|제작비|\b(?:USD|KRW|EUR|JPY)\s*\d|[$€£¥₩]|\d[\d,. ]*(?:천|만|억)?\s*(?:원|달러|유로|엔|USD|KRW|EUR|JPY))/i.test(value) &&
      !/(?:수수료|커미션|commission|원고료|고료|지원금|정산|입금|환급|지급|할인|증정|무료|독점|매출\s*보장|(?:https?|ftp|file|mailto|tel|sms|data|javascript|vbscript|blob|smb):|www\.|\]\(|\d{2,3}[- ]\d{3,4}[- ]\d{4})/i.test(value) &&
      !/(?:질병|질환|치료|진단|효능|효과|항암|혈당|혈압|당뇨|면역력|다이어트|체중\s*감량|임산부|임신|아기|영유아|어린이.*안전|무독성|100%\s*안전|의학|복용|의약|cure|treat|diabet|disease|pregnan|weight.loss|safe.for.children|immunity)/i.test(value) &&
      !/(?:지시를|명령을|프롬프트|시스템\s*메시지|규칙을\s*무시|ignore\s+(?:previous|all|instructions)|system\s*:|assistant\s*:|fetch\s*\(|curl\s|<script)/i.test(value);
  }
  function savedSellingPoints(deal, now = Date.now()) {
    const empty = reason => ({ status:'withheld', provenance:'stored_operator_record', points:[], sourceUrls:[], checkedAt:'', reason });
    const claims = typeof deal.claims === 'string' ? deal.claims : '', note = text(deal.sourceNote);
    if(deal.claimsRevoked===true||deal.sellingPointsRevoked===true||[deal.claimsStatus,deal.sellingPointsStatus].some(status=>['revoked','rejected','pending','unverified','withdrawn','cancelled','canceled','철회','보류','취소','재검토','오류'].includes(text(status).toLowerCase())))return empty('소구점 확인이 철회되었거나 검토 중입니다.');
    if (!claims.trim()) return empty('저장된 확인 소구점이 없습니다.');
    if (claims.length > 4000 || note.length > 30000) return empty('소구점 확인 기록 형식을 검토해야 합니다.');
    const start='[상품 소구점 확인]', end='[/상품 소구점 확인]', from=note.lastIndexOf(start), to=note.lastIndexOf(end);
    if(from<0||to<from||note.slice(to+end.length).includes(start))return empty('소구점의 상품별 출처·확인일 기록이 없습니다.');
    const values=new Map();
    for(const line of note.slice(from+start.length,to).trim().split(/\r?\n/)){const m=/^([^:]+):\s*(.*)$/.exec(line);if(!m)return empty('소구점 확인 기록 형식을 검토해야 합니다.');const key=m[1].trim();values.set(key,[...(values.get(key)||[]),m[2].trim()]);}
    const one=key=>values.get(key)?.length===1?values.get(key)[0]:'';
    if(typeof deal.id!=='string'||!deal.id.trim()||deal.id.length>200||/[\x00-\x1f]/.test(deal.id)||!one('상품ID')||one('상품ID')!==text(deal.id))return empty('소구점 확인 기록의 상품 연결이 일치하지 않습니다.');
    if((values.has('상태')&&one('상태')!=='확인')||/철회|취소|보류|재검토|오류/.test(one('근거'))||(values.get('주의')||[]).some(v=>/소구점.{0,12}(?:철회|취소|오류|보류)/.test(v)))return empty('소구점 확인이 철회되었거나 검토 중입니다.');
    if(one('검증범위')!=='공식 상세페이지')return empty('상품 상세 소구점의 공식 출처 확인이 충분하지 않습니다.');
    const checked=one('확인일'), at=Date.parse(checked+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(checked)||!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==checked||at>now||now-at>90*DAY)return empty('소구점 확인일이 없거나 재확인이 필요합니다.');
    if(!/^[a-f0-9]{64}$/.test(one('소구점SHA256'))||claimsSha256(claims)!==one('소구점SHA256'))return empty('저장 소구점이 확인 당시 내용과 달라 재확인이 필요합니다.');
    const sourceUrl=url=>{const safe=productUrl(url);if(!safe)return '';const u=new URL(safe),host=u.hostname.toLowerCase().replace(/\.$/,'');return u.hash||u.port||!host.includes('.')||/^\d+(?:\.\d+){3}$/.test(host)||host.includes(':')||/(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host)?'':safe;};
    const urls=values.get('출처')||[];if(!urls.length||urls.length>10||urls.some(url=>!sourceUrl(url)))return empty('소구점의 공개 출처 주소를 확인해야 합니다.');
    if(!one('근거')||/미확인|확인\s*불가|확인하지\s*못|추정|목록만/.test(one('근거')))return empty('소구점 확인 근거가 충분하지 않습니다.');
    const pieces=claims.split(/\r?\n+|(?<=[.!?。])\s+/u).map(s=>text(s.replace(/^\s*[-•·]\s*/,''))).filter(Boolean), points=unique(pieces.filter(safeSellingPoint)).slice(0,3);
    if(!points.length)return empty('그대로 사용할 수 있는 확인 소구점이 없어 추가 검토가 필요합니다.');
    return {status:'verified_saved',provenance:'stored_operator_record',points,sourceUrls:unique(urls.map(productUrl)),checkedAt:checked,reason:'저장된 공식 상세페이지 확인 기록 · 현재 페이지 재조회 아님',omitted:pieces.length-points.length};
  }
  // Bounded preference review, not legal classification or a general food/health filter.
  function healthIngredientEvidence(deal, selling) {
    const identity = ['name', 'productName', 'category'].map(field => text(deal[field])).join(' ');
    const nonFood = /비누|샴푸|핸드워시|화장품|향수|바디\s*바|페이셜바|세정|세제|접시|식기|그릇|머그|도구|장식|향초|요리책|레시피북|\b(?:soap|shampoo|cosmetic|candle|cookbook|mug|plate|bowl|tool)\b/i;
    const foodCategory = /식품|커피|음료|주스|\b(?:food|coffee|drink|tea|juice)\b/i.test(text(deal.category));
    const foodName = /커피|콜드브루|음료|주스|\b(?:coffee|cold\s*brew|drink|tea|juice)\b/i.test(identity);
    const cosmetic = /비누|샴푸|핸드워시|화장품|향수|바디\s*바|페이셜바|세정|세제|\b(?:soap|shampoo|cosmetic)\b/i.test(identity);
    if (nonFood.test(text(deal.category)) || (!foodCategory && (cosmetic || (!foodName && nonFood.test(identity))))) return [];
    const rows = [];
    const inspect = (value, field, verified, urls = [], observedAt = '') => {
      // One ingredient's absence cannot cancel another's presence in the same record.
      for (const clause of text(value).slice(0, 4000).split(/[,;\n.!?。]/u)) {
        const mentions = [...clause.matchAll(/홍삼|인삼|\b(?:red\s+)?ginseng\b/giu)];
        for (let i = 0; i < mentions.length; i++) {
          const hit = mentions[i], before = clause.slice(i ? mentions[i - 1].index + mentions[i - 1][0].length : 0, hit.index), after = clause.slice(hit.index + hit[0].length, mentions[i + 1]?.index);
          const uncertain = /[?？`]/.test(value) || /["“”‘’「」『』]|라는|라고|표현|문구|인용|예시|않지\s*않|(?:없|않).{0,30}(?:아니|아님|아닙)|\bnot\s+without\b|\b(?:free|without).{0,20}(?:not|incorrect|wrong)\b|미확인|불명확|불확실|추정|여부|가능성|확인\s*(?:필요|불가|안|되지)|없지\s*않|(?:무첨가|미함유|불포함).{0,8}(?:아니|아님|아닙)|\b(?:unknown|uncertain|unverified|may|might|whether)\b/i.test(clause);
          const absentBefore = /(?:\b(?:no|without)|free\s+of|does\s+not\s+contain)\s*$/i.exec(before);
          const absentAfter = /^(?:\s*(?:추출물|추출액|농축액|분말|extract|powder))?\s*(?:은|는|이|가|을|를)?\s*(?:무첨가|미함유|불포함|없(?:음|습니다|어요|는|지만)|(?:함유|첨가|포함)(?:하지|되지)\s*않|넣지\s*않|[- ]free\b|is\s+not\s+(?:included|added|present))/i.exec(after);
          // Absence is only recognized as a complete statement or with a plain food noun.
          // Reporting, qualifications and double negatives stay unknown rather than clearing a hold.
          const remainder = absentAfter ? after.slice(absentAfter[0].length) : after;
          const clearEnding = /^(?:\s*(?:음|은|는|습니다|아요|입니다|이다))?\s*(?:(?:커피|콜드브루|음료|차|원액|제품|상품|coffee|cold\s*brew|drink|tea)(?:입니다|이다)?\s*)?$/i.test(remainder);
          const clearBeginning = !/\b(?:not|never|cannot)\b|n't\b|아니|아닌|아님|아닙/i.test(absentBefore ? before.slice(0, absentBefore.index) : before);
          const absent = !!(absentBefore || absentAfter) && clearEnding && clearBeginning;
          const present = !/풍미|향|맛|flavou?r|scent/i.test(clause) && (/^(?:\s*(?:추출물|추출액|농축액|분말|extract|powder))?\s*(?:은|는|이|가|을|를)?\s*(?:함유|포함|첨가|사용|넣(?:은|어|었)|더(?:한|해|했)|들어|원료|성분)/i.test(after) || /\b(?:contains?|with|added)\s*$/i.test(before));
          const polarity = !verified || uncertain || ((absentBefore || absentAfter) && (!clearEnding || !clearBeginning)) ? 'uncertain' : absent ? 'absent' : present ? 'present' : 'associated';
          const safeValue = verified && (field === 'claims' ? safeSellingPoint(text(clause)) : safeDescriptor(text(clause)));
          rows.push(evidence('health_exclusion_ingredient', verified ? '제외 요청 검토용 · 등록 상품·확인 소구점의 원료 표현' : '제외 요청 검토용 · 미확인 원료 관련 기록', field, safeValue ? text(clause) : '홍삼·인삼 관련 기록 · 함유 여부 미확인', { productId: text(deal.id), ingredient: 'ginseng', polarity, strength: verified ? 'stored' : 'unknown', url: verified ? urls[0] || '' : '', sourceUrls: verified ? urls : [], observedAt: verified ? observedAt : '', provenance: 'stored_operator_record' }));
        }
      }
    };
    for (const field of ['name', 'productName', 'category']) if (safeDescriptor(deal[field])) inspect(deal[field], field, true, productUrl(deal.productUrl) ? [productUrl(deal.productUrl)] : [], text(deal.observedAt || deal.sourceObservedAt || deal.updatedAt));
    // Validation binds the full claims string, including points beyond the three copied sentences.
    // Unusable/revoked/old claims may require review, but never prove presence or safe absence.
    const claims = text(deal.claims);
    if (claims.length > 4000 && /홍삼|인삼|\bginseng\b/i.test(claims)) inspect('홍삼·인삼 관련 기록 미확인', 'claims', false);
    else for (const point of claims.split(/\r?\n+|(?<=[.!?。])\s+/u)) inspect(point, 'claims', selling.status === 'verified_saved' && safeSellingPoint(point), selling.sourceUrls, selling.checkedAt);
    return rows;
  }
  function healthIngredientHold(rows) {
    const relevant = rows.filter(row => row.polarity !== 'absent');
    if (!relevant.length) return '';
    return '건강·웰니스 제외 요청 · 홍삼·인삼 ' + (relevant.some(row => row.polarity === 'present') ? '함유 표현 확인' : relevant.some(row => row.polarity === 'associated') ? '관련 표현의 원료 확인 필요' : '관련 기록 미확인') + ' · 상대 제외 기준과의 적합성 검토 보류';
  }
  function replyPreferences(reply) {
    const raw=text(reply.text);
    if(reply.historical===true||!raw||/["“”‘’「」『』]|(?:^|\n)\s*>/.test(raw)||/제외|지양|거절|싫|않|아니|말고|관심\s*없|안\s*(?:받|보|하|쓰|마시)|미확인|불명확|추정|\bnot\b|\bwithout\b/i.test(raw))return [];
    if(!/관심|궁금|검토|추천|보내\s*주세요|알려\s*주세요|please|interested|recommend/i.test(raw))return [];
    return topicsInText(raw);
  }
  function draftProductLine(group) {
    const name='- '+draftProductName(group.draftProduct||group.product), selling=group.sellingPoints;
    const points=selling?.status==='verified_saved'?strings(selling.points).filter(safeSellingPoint).slice(0,3):[];
    return name+(points.length?'\n  '+points.join(' '):'\n  구체적인 상품 소구점은 추가 확인이 필요합니다.')+(safeDescriptor(group.channelAngle)&&safeSellingPoint(group.channelAngle)?'\n  '+group.channelAngle:'');
  }
  function productFacts(deal, now = Date.now()) {
    const facts = [];
    const add = (topic, field, value) => { if (topic && safeDescriptor(value)) facts.push(evidence('product_attribute', '등록 상품 ' + field, field, value, { topic, url: productUrl(deal.productUrl), observedAt: text(deal.observedAt || deal.sourceObservedAt || deal.updatedAt) })); };
    for (const t of strings(deal.topics)) add(exactTopic(t), 'topics', t);
    for (const field of ['name', 'productName', 'category']) for (const topic of topicsInText(deal[field])) add(topic, field, text(deal[field]));
    const fields = ['name', 'productName', 'category'].map(f => norm(deal[f])).join(' ');
    // Concrete product nouns supplement, but never turn coffee-scented soap into a drink.
    const cosmetic = /비누|샴푸|핸드워시|화장품|향수|soap|shampoo|cosmetic/.test(fields);
    const nonFood = cosmetic || /바디\s*바|페이셜바|세정|세제|접시|식기|그릇|머그|주방용품|테이블웨어|나이프|포크|수저|몰드|도구|보관함|장식|인형|향초|요리책|레시피북|\b(?:plate|bowl|cup|mug|knife|mold|tool|decor|candle|cookbook)\b/i.test(fields);
    // Concrete food names are identity evidence, not proof of convenience, health or cooking suitability.
    if (!nonFood && /(?:바질\s*페스토|페스토|파스타|화덕\s*브레드|브레드|올리브(?:유|\s*오일)|\b(?:pesto|pasta|bread|olive\s+oil))(?=$|[\s\d·(/-])/i.test(fields)) add('food', 'name/category', text(deal.productName || deal.name));
    if (/과채|야채\s*주스|채소\s*주스/.test(fields) && !cosmetic) { add('packaged_vegetable_drink', 'name/category', text(deal.productName || deal.name)); add('drink', 'name/category', text(deal.productName || deal.name)); }
    if (/간편식|즉석식|밀키트/.test(fields)) add('food_easy_meals', 'name/category', text(deal.productName || deal.name));
    if (/커피|coffee|에스프레소/.test(fields) && !cosmetic) { add('coffee', 'name/category', text(deal.productName || deal.name)); add('home_cafe', 'name/category', text(deal.productName || deal.name)); }
    if (/비누|샴푸|핸드워시|욕실|soap|shampoo/.test(fields)) add('household_bath', 'name/category', text(deal.productName || deal.name));
    if (/식기|그릇|머그|접시|테이블웨어/.test(fields)) add('tableware', 'name/category', text(deal.productName || deal.name));
    for (const field of ['name', 'productName', 'category']) if (/커피백|티백|스틱|파우치|개별\s*포장|휴대용|(?:\d+\s*)포(?:입|\b|\s|$)/i.test(norm(deal[field]))) add('portable', field, text(deal[field]));
    if (/보리차|홍차|녹차|티백/.test(fields) && !cosmetic && !/커피|coffee/.test(fields)) add('tea', 'name/category', text(deal.productName || deal.name));
    if (/바디바|바디\s*바|페이셜바/.test(fields)) add('household_bath', 'name/category', text(deal.productName || deal.name));
    if (/삼각대|카메라\s*가방|카메라\s*스트랩/.test(fields)) add('photo_accessories', 'name/category', text(deal.productName || deal.name));
    for (const value of strings(deal.attributes)) for (const topic of topicsInText(value)) add(topic, 'attributes', value);
    // Registered evidence is an explicitly bounded fact object, not arbitrary source notes.
    for (const fact of Array.isArray(deal.registeredEvidence) ? deal.registeredEvidence : []) {
      if (!fact || typeof fact !== 'object' || !['attribute', 'topic', 'category'].includes(fact.kind) || !productUrl(fact.url) || !safeDescriptor(fact.value) || !Number.isFinite(Date.parse(fact.observedAt || ''))) continue;
      for (const topic of fact.kind === 'attribute' ? topicsInText(fact.value) : [exactTopic(text(fact.value))].filter(Boolean)) facts.push(evidence('registered_product_evidence', '등록 상품 근거', 'registeredEvidence', text(fact.value), { topic, url: productUrl(fact.url), observedAt: fact.observedAt }));
    }
    const selling=savedSellingPoints(deal,now);
    for(const value of selling.points)for(const topic of topicsInText(value))facts.push(evidence('stored_selling_point','저장된 공식 상세페이지 확인 소구점','claims',value,{topic,url:selling.sourceUrls[0]||'',observedAt:selling.checkedAt,sourceUrls:selling.sourceUrls,provenance:'stored_operator_record'}));
    return cosmetic ? facts.filter(f => !['coffee', 'home_cafe', 'drink', 'packaged_vegetable_drink', 'tea'].includes(f.topic)) : facts;
  }
  function productUrlKey(value) {
    try {
      const u = new URL(safeUrl(value));
      const hasPathId = /(?:^|\/)(?:product|products|goods|item|items)\/[^/]+/i.test(u.pathname);
      const hasQueryId = ['product_no', 'goodsNo', 'goods_no', 'item_id', 'product_id'].some(key => u.searchParams.has(key)) || (/\/shop_view\/?$/i.test(u.pathname) && u.searchParams.has('idx'));
      if (!hasPathId && !hasQueryId) return '';
      u.hash = ''; u.pathname = u.pathname.replace(/\/+$/, '');
      for (const key of [...u.searchParams.keys()]) if (/^(?:variant|variant_id|option|option_id|sku|utm_.+|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
      u.searchParams.sort(); return u.toString();
    } catch { return ''; }
  }
  function draftProductName(value) {
    return text(value).replace(/\s*[·|/-]\s*(?:\d+(?:\.\d+)?\s*%\s*)?(?:정상가|할인가|할인|정가|공구가|공동구매가|판매가)(?:\s*[\d,.]+\s*원)?\s*$/giu, '').trim();
  }
  function productNameKey(deal) {
    const original = norm(deal.productName || deal.name);
    // Strip explicit option/pack/price suffixes, not product descriptors or generic shared URLs.
    const name = original
      .replace(/(?:[·|/-]\s*)?(?:\d+(?:\.\d+)?\s*%\s*)?(?:정상가|할인가|할인|정가|공구가|공동구매가|판매가|discount|regular price)(?:\s*[\d,.]+\s*원)?\s*$/giu, '')
      .replace(/(?:\([^)]*(?:옵션|용량|색상)[^)]*\)|(?:옵션|색상)\s*[:：]?\s*[\p{L}\p{N}-]+)\s*$/giu, '')
      .replace(/(?:bulk|벌크)\s*(?=\d)/giu, '')
      .replace(/\d+(?:\.\d+)?\s*(?:teabags?|bags?|boxes?|packs?|bottles?|ml|kg|개입|티백|박스|봉지|세트|box|입|팩|개|봉|포|g|l)(?=$|[\s()/+,x×-]|\d)/giu, ' ')
      .replace(/\bBOX\s*$/giu, '').replace(/[()*/+,×·-]+\s*$/g, '').replace(/\s+/g, ' ').trim();
    return JSON.stringify([norm(deal.brand), name.length >= 2 ? name : original]);
  }
  function stockStatus(deal) {
    if (deal.soldOut === true || ['sold_out', 'out_of_stock'].includes(deal.availability) || deal.stock === 0) return { blocked: true, label: '품절 기록' };
    const notes = text(deal.sourceNote) + '\n' + text(deal.note);
    const positive = notes.replace(/품절(?:이|은|는)?\s*(?:(?:표시|상태|여부|기록)(?:가|는|이)?\s*)?(?:없음|없습니다|아님|아니|아닙|미확인|확인\s*(?:안|불가|되지))/gi, '');
    if (/품절|sold\s*out|out\s*of\s*stock/i.test(positive)) return { blocked: true, label: '품절 관련 기록 · 재확인 필요' };
    return { blocked: false, label: Number.isFinite(deal.stock) && deal.stock > 0 ? '저장 재고 기록 있음 · 현재 재고 미확인' : '재고 미확인' };
  }
  function recordedHold(...records) {
    return records.some(r => r && (['거절', '수신 거부', '보류', 'declined', 'opt_out', 'hold', 'stop'].includes(r.status) || ['거절', '수신 거부', 'declined', 'opt_out'].includes(r.classification) || ['상대방 거절', '우리 측 거절', '회신 중단', '종료'].includes(r.conversationStatus)));
  }
  function contactReviewContext(reply, raw) {
    const sources = [], kinds = [];
    for (const [source, value] of [['reply', raw], ['operator_note', text(reply.contactNotes || reply.exclusionText)]]) {
      for (const part of norm(value).split(/[,;\n]/)) {
        if (!/(?:이메일|메일|e-?mail|도메인|연락처|주소)/.test(part)) continue;
        // A resolved address does not resolve an explicitly uncertain domain (or vice versa).
        const residual = part
          .replace(/(?:이메일|메일|e-?mail)?\s*(?:주소|도메인)?\s*확인\s*완료/g, ' ')
          .replace(/(?:오타|불확실|불명확|미확인|확인\s*필요|재확인)(?:가|는|이|은)?\s*(?:없(?:음|습니다|어요)?|아니(?:에요|다)?|아님|아닙니다)/g, ' ');
        if (/오타|불확실|불명확|미확인|판독|확인\s*(?:필요|전|대기)|재확인|uncertain|unverified|typo/.test(residual)) { sources.push(source); kinds.push(/도메인|domain/.test(residual) ? 'domain' : 'address'); }
      }
    }
    return { needsConfirmation: sources.length > 0, kind: kinds.includes('domain') ? 'domain' : 'address', sources: unique(sources) };
  }
  function classifyIntent(reply = {}, thread = {}, creator = {}) {
    const inbound = (Array.isArray(thread.messages) ? thread.messages : []).filter(m => m && m.out === false && !m.automatic && text(m.text));
    const last = inbound[inbound.length - 1];
    const raw = text(reply.text || last?.text), historical = reply.historical === true, contactReview = contactReviewContext(reply, raw);
    const supportReview = { productionSupport: [raw, text(reply.exclusionText)].some(value => /제작비\s*지원/.test(value) && !/제작비\s*지원(?:은|는|이|가)?\s*(?:언급|조건)?\s*(?:없|아니|아님|아닙)/.test(value)) };
    const base = { supportReview, sourceLabel: text(reply.sourceLabel) || (historical ? '과거 기록 · 현재 원문 미확인' : '현재 제공된 상대 메시지'), observedAt: text(reply.observedAt || last?.at), text: raw, historical, contactReview, inquiry: { method: false, fee: false, terms: false, materials: false, email: false } };
    const result = (kind, label, reason, extra = {}) => ({ ...base, kind, label, reason, allowProductMention: kind !== 'hold', ...extra });
    if (recordedHold(thread, creator, reply)) return result('hold', '거절·중단 상태 · 제안 보류', '저장된 거절·중단·보류 상태가 우선합니다.');
    if (!raw) return result('ambiguous', '상대 의도 미확인', '확인할 상대 메시지가 없습니다.', { needsReferenceReview: contactReview.needsConfirmation });
    for (const earlier of inbound.slice(0, -1)) {
      if (classifyIntent({ text: earlier.text, decisionText: earlier.decisionText }, {}, {}).kind === 'hold') return result('hold', '이전 거절·중단 요청 · 재확인 필요', '제공된 대화의 이전 거절·중단 요청을 짧은 후속 회신으로 해제하지 않습니다.');
    }
    const s = norm(typeof reply.decisionText === 'string' ? reply.decisionText : raw), quoted = /["“”‘’「」『』]|(?:^|\n)\s*>/.test(raw);
    const negative = /거절|수신\s*거부|중단|연락\s*(?:하지|그만)|보내지|사양|관심\s*없|필요\s*없|안\s*보내|하지\s*마|진행\s*(?:안|않|어렵)|안\s*할|(?:제품\s*)?협업\s*안\s*(?:함|해|하)|(?:진행|협업|공동구매|연락|검토|동의)\s*하지\s*않|declin|unsubscribe|opt\s*out|stop|not\s*interested|do\s*not|don't/.test(s);
    const negatedOrReported = /제외(?:하지|는)?\s*(?:않|안)|아니|아닙|아님|아냐|없지\s*않|않.{0,5}(?:뜻|의미)|(?:거절|중단|사양).{0,8}(?:않|안\s*했|없)|(?:말|문구|표현|내용|예시|인용).{0,8}(?:했|있|보|뜻)|만약|이라면|라고|아닌|않는|not.{0,10}(?:refus|declin)|didn't|did\s*not/.test(s);
    if (negative && !quoted && !negatedOrReported) return result('hold', '거절·중단 요청 · 제안 보류', '상대 메시지에 거절·중단 표현이 있어 상품 제안을 멈춥니다.');
    const hasEmailAddress = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s), requestText = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[연락처]');
    const inquiry = {
      method: /어떻|어떤\s*방식|어떤\s*협업|진행\s*방식|협업\s*방식|진행\s*방법|절차|방식|how\s+(?:does|do|would)|process/.test(s),
      fee: /비용|수수료|커미션|보수|지원금|지원\s*범위|고료|원고료|수익\s*배분|정산|유료\s*(?:콘텐츠|컨텐츠|리뷰|협업|광고)|제작\s*비|촬영\s*비|단가|fee|commission|payment|paid\s*content|production\s*cost/.test(s),
      terms: /구체적(?:인)?\s*조건|(?:협업|진행|콘텐츠|컨텐츠|지원)\s*조건|조건(?:을|이|은|는|에|과|도)?\s*(?:문의|궁금|어떻|알려|확인|제시|협의|요청)|terms|conditions/.test(s),
      materials: /(?:상품|제품|제안|협업)\s*(?:자료|목록|리스트|정보|내용|안내|설명).{0,24}(?:보내|요청|부탁|받|전달)|(?:자료|목록|리스트)(?:를|을)?\s*(?:보내|요청|부탁)|(?:send|provide).{0,16}(?:product|proposal).{0,12}(?:details|list)/.test(s),
      email: /(?:이메일|메일|e-?mail)(?:로|을|를)?[^.!?]{0,35}(?:보내|전달|받|요청|부탁|검토)|(?:보내|전달|받|요청|부탁)[^.!?]{0,35}(?:이메일|메일|e-?mail)|(?:제안|협업|상품|제품)[^.!?]{0,25}(?:이메일|메일|e-?mail)[^.!?]{0,25}(?:제공|남김|알려)/.test(requestText) || (hasEmailAddress && /보내|전달|받|요청|부탁|\bsend\b|\bforward\b/.test(requestText))
    };
    const emailPolarityUnclear = /(?:이메일|메일|e-?mail)(?:은|는|로는|로|을|를)?[^.!?]{0,30}(?:받지|보내지|안\s*받|안\s*보내|원하지|말고|아니라|아닌|지양|제외)|(?:don['’]t|do\s*not|not|no)[^.!?]{0,12}\be-?mail\b/.test(requestText);
    if (emailPolarityUnclear) return result('ambiguous', '이메일 수신 의사·다른 채널 요청 확인 필요', '이메일 거부·부정·대체 채널 표현이 있어 이메일 자료 요청으로 단정하지 않습니다.', { inquiry: { ...inquiry, email: false }, allowProductMention: false, needsReferenceReview: true });
    if (inquiry.email) inquiry.materials = true;
    if (contactReview.needsConfirmation && !inquiry.email) return result('ambiguous', '연락처 확인 맥락 · 원문 검수 필요', '연락처 확인 기록은 있으나 현재 이메일 요청을 충분히 확인하지 못했습니다.', { inquiry, allowProductMention: false, needsReferenceReview: true });
    if (negative || quoted || (!historical && negatedOrReported) || /만약|이라면/.test(s)) return result('ambiguous', '의도 해석 불확실 · 원문 검수 필요', '부정·인용·조건부 표현을 상품 수락으로 해석하지 않습니다.', { inquiry, allowProductMention: false, needsReferenceReview: inquiry.email || contactReview.needsConfirmation });
    if (inquiry.email) return result('inquiry', historical ? '과거 이메일 자료 요청 기록 · 현재 상태 재확인' : '이메일 자료 요청 표현 · 수락 미확인', '이메일로 자료를 검토하려는 요청 기록입니다. 주소 확인과 실제 발송 승인은 별개입니다.', { inquiry });
    if (inquiry.method || inquiry.fee || inquiry.terms) return result('inquiry', [inquiry.method ? '방식' : '', inquiry.fee ? '비용' : '', inquiry.terms ? '조건' : ''].filter(Boolean).join('·') + ' 문의 우선', '문의는 상품 수락이 아닙니다. 문의에 먼저 답하고 상품 제안 동의를 별도로 확인합니다.', { inquiry });
    // Deliberately narrow: a standalone request, not a keyword anywhere in a narrative.
    const clean = s.replace(/^(?:네[,.!\s]*|안녕하세요[,.!\s]*|감사합니다[,.!\s]*)+/, '').replace(/[.!?。！]+$/, '').trim();
    const request = /^(?:(?:검토할|추천할|추천|가능한|다른|어떤)\s*)?(?:상품|제품)(?:\s*(?:목록|리스트|자료|정보|제안))?(?:을|를|이|은|는)?\s*(?:보내\s*주세요|알려\s*주세요|추천\s*해\s*주세요|제안\s*해\s*주세요|보여\s*주세요|궁금해요|궁금합니다)$/.test(clean) || /^(?:please\s+)?(?:send|show|recommend)\s+(?:me\s+)?(?:the\s+)?products?(?:\s+(?:list|details))?(?:\s+please)?$/.test(clean);
    if (request && !historical) return result('products', '상품 자료 요청 표현 확인', '명시적인 상품 자료 요청입니다. 구매·협업 수락이나 발송 승인을 뜻하지 않습니다.', { inquiry });
    if (inquiry.materials || (request && historical)) return result('inquiry', historical ? '과거 자료 요청 기록 · 현재 상태 재확인' : '상품 자료 요청 표현 · 수락 미확인', '자료 요청에 맞춘 검토 초안입니다. 현재 협업 수락이나 발송 승인을 뜻하지 않습니다.', { inquiry: { ...inquiry, materials: true } });
    return result('ambiguous', historical ? '과거 의도 · 현재 상태 재확인' : '상대 의도 미확인', historical ? '과거 메모만으로 현재 상품 제안 동의를 확정하지 않습니다.' : '짧은 긍정이나 일반 회신은 상품 수락으로 해석하지 않습니다.');
  }

  const SCENES = [
    { creator: ['travel', 'outdoors'], product: ['drink', 'packaged_vegetable_drink', 'coffee', 'tea', 'food_easy_meals', 'snack'], require: 'portable', label: '여행·야외 콘텐츠의 휴대 구성 장면', caveat: '휴대 속성만 연결한 장면 추론이며 실제 여행 사용·선호는 미확인' },
    { creator: ['photography', 'drone_photography', 'travel'], product: ['photo_accessories'], label: '촬영 콘텐츠의 장비 구성 장면', caveat: '촬영 활동과 용도만 연결했으며 보유 장비 호환성은 미확인' },
    { creator: ['beauty'], product: ['household_bath'], label: '뷰티 콘텐츠의 세정용품 소개 장면', caveat: '세정용품 소개 장면만 추론했으며 피부 상태·안전성·효능·사용 선호는 미확인' },
    { creator: ['parenting', 'household_lifestyle'], product: ['household_bath', 'kitchen_tools'], label: '가정 일상 콘텐츠의 생활용품 소개 장면', caveat: '가정 일상 연결만 추론했으며 아동 사용·안전성·가족 구성은 추정하지 않음' },
    { creator: ['parenting', 'household_lifestyle'], product: ['food_easy_meals'], label: '가정 일상 콘텐츠의 식사 준비 장면', caveat: '식사 준비 장면만 추론했으며 식단·기호·가족의 섭취 적합성은 미확인' },
    { creator: ['home_interior', 'home_cafe', 'dining'], product: ['tableware'], label: '집·홈카페 콘텐츠의 테이블 구성 장면', caveat: '테이블 구성 장면만 추론했으며 디자인 선호와 실제 공간은 미확인' },
    { creator: ['home_cafe', 'dining', 'baking'], product: ['coffee', 'tea', 'drink', 'snack'], label: '홈카페·다이닝 콘텐츠의 음료·간식 구성 장면', caveat: '음료·간식 구성 장면만 추론했으며 맛·식단·섭취 적합성은 미확인' }
  ];
  function matchProduct(deal, context, now) {
    const facts = productFacts(deal, now), topics = unique(facts.map(f => f.topic));
    const direct = context.topics.filter(topic => topics.includes(topic));
    if (direct.length) return { score: (context.strength === 'attested' ? 200 : 100) + Math.min(direct.length, 9), matchType: 'direct', reason: '직접 주제 일치: ' + direct.map(t => ALIASES[t]?.[0] || t).join(', '), evidence: [...context.evidence.filter(f => direct.includes(f.value)), ...facts.filter(f => direct.includes(f.topic))], uncertainty: context.strength === 'historical' ? ['7일이 지난 공개 관찰입니다. 현재 활동을 재확인해야 합니다.'] : context.strength === 'weak' ? ['저장 소개·분류·주제는 현재 활동을 확인한 근거가 아닙니다.'] : [] };
    // Stored profile scenes are explicitly weak hypotheses and require exact identity-bound profile pointers.
    if (context.strength === 'attested' || context.strength === 'historical' || (context.strength === 'weak' && context.profileBound)) for (const rule of SCENES) {
      const creatorTopics = rule.creator.filter(t => context.topics.includes(t)), productTopics = rule.product.filter(t => topics.includes(t));
      if (creatorTopics.length && productTopics.length && (!rule.require || topics.includes(rule.require))) return { score: (context.strength === 'attested' ? 50 : 25) + productTopics.length, matchType: 'inferred', reason: (context.strength === 'attested' ? '장면 연결 추론: ' : '과거·저장 소개 기반 장면 추론 · 낮은 신뢰도: ') + rule.label, evidence: [...context.evidence.filter(f => creatorTopics.includes(f.value)), ...facts.filter(f => productTopics.includes(f.topic) || f.topic === rule.require)], uncertainty: [rule.caveat, ...(context.strength !== 'attested' ? ['과거 관찰 또는 저장 소개만을 사용한 낮은 신뢰도 가설입니다. 현재 활동과 적합성을 직접 확인해야 합니다.'] : [])] };
    }
    return { score: 0, matchType: 'none', reason: '활동과 상품을 연결할 근거 부족', evidence: [], uncertainty: ['임의로 추천하거나 3개를 채우지 않습니다.'] };
  }
  function replyExclusions(deals, reply) {
    const raw = text(reply.text), empty = { productIds: [], categories: [], decisionText: raw, evidence: [], categoryLabels: [], healthExcluded: false };
    if (!raw || /[`"“”‘’「」『』]|(?:^|\n)\s*>/.test(raw) || /(?:^|[\s([{])'[^'\r\n]+'(?=$|[\s)\]},.!?:;]|라는|라고|란)/u.test(raw)) return empty;
    const productIds = [], categories = [], categoryLabels = [], source = norm(raw), spans = [], evidenceRows = [];
    const excluded = (label) => {
      const word = norm(label);
      if (!word || !safeDescriptor(label) || word === '미확인' || word.length > 100) return false;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = new RegExp('(?:^|[^\\p{L}\\p{N}_])(' + escaped + '(?:\\s*관련)?(?:\\s*(?:제품|상품|분야|분류|카테고리))?(?:은|는|을|를|만)?\\s*(?:(?:까다로워|까다로워서)\\s*)?(?:잘\\s*)?(?:지양(?:하고|합니다|해요|함)?|제외(?:해\\s*주세요|하고|해주세요)?|빼고|빼\\s*주세요|(?:제안|진행|검토)(?:은|는)?\\s*(?:하지\\s*(?:마세요|않(?:아요|습니다|음|으나|는다고))|안\\s*(?:해요|합니다|함))|원하지\\s*않(?:아요|습니다|음)|보내지\\s*마세요))', 'iu');
      const found = source.match(rule);
      if (!found) return false;
      const start = found.index + found[0].length - found[1].length, end = start + found[1].length;
      const after = source.slice(end, end + 20);
      // Opposite/reported continuations and questions are not affirmative exclusions.
      // Keep ordinary affirmative conjugations such as 제외합니다 and 제외할게요.
      if (/^(?:해\s*달라는|할\s*필요|하는\s*(?:건|것)).{0,20}(?:없|아니|아님|아닙|않|불필요)|^\s*[?？]|^[\s,.!?;]*(?:아니요|아니에요|아닙니다)/u.test(after)) return false;
      if (/^(?:하지|하지는|하는\s*것은|가)?\s*(?:않|안|아니|아님|아닙|말)/.test(after)) return false;
      if (/^(?:은|는|을|를)?\s*(?:원치|원하지|바라지|요청하지|말하지|뜻하지|의미하지|싫)/.test(after)) return false;
      // A quoted/reported or negated exclusion is never silently accepted as a current request.
      if (/^(?:라는|라고|한다고|한다는|하라는|했다고|했다는|하라고|가\s*아니|는\s*아니|한\s*적)/.test(after)) return false;
      spans.push([start, end]); evidenceRows.push({ label: text(label), phrase: found[1] }); return true;
    };
    const healthExcluded = HEALTH_EXCLUSION_ALIASES.some(excluded);
    if (healthExcluded) categoryLabels.push(HEALTH_EXCLUSION_LABEL);
    for (const d of deals) {
      if (!d) continue;
      if (healthExcluded && explicitlyHealthCategorized(d)) productIds.push(text(d.id));
      if (excluded(d.productName || d.name)) productIds.push(text(d.id));
      if (excluded(d.category)) { categories.push(text(d.category)); const canonical = exactTopic(d.category); if (ALIASES[canonical]) categoryLabels.push(ALIASES[canonical][0]); }
      const labels = unique([...strings(d.topics).flatMap(t => [t, ...(ALIASES[exactTopic(t)] || [])]), ...productFacts(d).flatMap(f => ALIASES[f.topic] || [])]);
      if (labels.some(excluded)) productIds.push(text(d.id));
    }
    // Regex indices count UTF-16 code units; slice/string replacement preserves that convention.
    let decisionText = source;
    for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) decisionText = decisionText.slice(0, start) + ' '.repeat(end - start) + decisionText.slice(end);
    return { productIds: unique(productIds), categories: unique(categories), decisionText, healthExcluded, categoryLabels: unique(categoryLabels), evidence: evidenceRows.filter((row, i) => evidenceRows.findIndex(other => other.phrase === row.phrase) === i) };
  }
  function catalogGroups(deals, context, exclusions, now, preferences = []) {
    const rows = [], invalid = [];
    for (let index = 0; index < deals.length; index++) {
      const d = deals[index];
      if (!d || !text(d.id) || !text(d.name) || text(d.name).length > 300) { invalid.push({ index, reason: '상품 ID·이름 누락 또는 형식 확인 필요' }); continue; }
      const stock = stockStatus(d), match = matchProduct(d, context, now), sellingPoints=savedSellingPoints(d,now), blockedReasons = [];
      const ingredientEvidence = exclusions.healthExcluded ? healthIngredientEvidence(d, sellingPoints) : [], ingredientHold = healthIngredientHold(ingredientEvidence);
      if (ingredientHold) blockedReasons.push(ingredientHold);
      for(const value of sellingPoints.points)if(!match.evidence.some(f=>f.kind==='stored_selling_point'&&f.value===value))match.evidence.push(evidence('stored_selling_point','저장된 공식 상세페이지 확인 소구점','claims',value,{url:sellingPoints.sourceUrls[0]||'',observedAt:sellingPoints.checkedAt,sourceUrls:sellingPoints.sourceUrls,provenance:'stored_operator_record'}));
      const preferred=match.score>0?preferences.filter(topic=>productFacts(d,now).some(f=>f.topic===topic)):[];
      if(preferred.length){match.score+=300;match.reason+=' · 현재 요청 분야 반영';match.evidence.push(...preferred.map(topic=>evidence('reply_preference','현재 회신의 관심 분야 · 수락 아님','reply.text',ALIASES[topic]?.[0]||topic,{topic})));}
      const restriction=text(d.sourceNote)+'\n'+text(d.note);
      if(/단독\s*(?:공구|제안)(?:가|는)?\s*(?:아님|아니|불가)|(?:^|[.\n])\s*(?:본|이)\s*상품.{0,12}(?:추가상품|업셀링)|add[ -]?on\s*(?:only|전용)/i.test(restriction.replace(/이 확인은 상품 특성에 한정하며[^\n]*/g,'')))blockedReasons.push('연계 추가상품 기록 · 단독 제안 조건 확인 필요');
      if (stock.blocked) blockedReasons.push(stock.label);
      if (d.held === true || d.hold === true || ['보류', '중단', '종료', 'held', 'hold', 'inactive', 'archived'].includes(d.state) || ['보류', '중단', '종료', 'held', 'hold', 'inactive', 'archived'].includes(d.status) || ['held', 'hold', 'on_hold', 'inactive', 'archived'].includes(d.availability)) blockedReasons.push('저장된 보류·중단 상품');
      if (d.excluded === true || d.excludeFromProposal === true || ['제외', 'excluded'].includes(d.state) || ['제외', 'excluded'].includes(d.status) || d.availability === 'excluded') blockedReasons.push('저장된 제외 상품');
      if (/[\r\n\x00-\x1f]/.test(text(d.productName || d.name)) || /수수료|커미션|commission|원고료|고료|지원금|@|https?:\/\//i.test(text(d.productName || d.name))) blockedReasons.push('상품명 검수 필요');
      const item = { id: d.id, name: safeDescriptor(d.name) ? text(d.name) : '상품명 검수 필요', product: safeDescriptor(d.productName || d.name) ? text(d.productName || d.name) : '상품명 검수 필요', brand: safeDescriptor(d.brand) ? text(d.brand) : '', category: safeDescriptor(d.category) ? text(d.category) : '미확인', link: productUrl(d.productUrl), stock: stock.label, state: safeDescriptor(d.state) ? text(d.state) : '미확인', retail: typeof d.retail === 'number' && Number.isFinite(d.retail) && d.retail >= 0 ? String(d.retail) + '원 · 저장 소비자가' : '미확인', price: '공구가 미확인', sellingPoints, options: strings(Array.isArray(d.options) ? d.options.map(o => typeof o === 'string' ? o : o?.name) : []).filter(safeDescriptor).join(' / ') || '옵션 확인 필요', ...match, ingredientEvidence, blockedReasons };
      rows.push({ item, index, keys: unique(['id:' + d.id, 'name:' + productNameKey(d), ...(productUrlKey(d.productUrl) ? ['url:' + productUrlKey(d.productUrl)] : []), ...(text(d.parentProductId || d.productId) ? ['parent:' + JSON.stringify([norm(d.brand), text(d.parentProductId || d.productId)])] : [])]) });
    }
    const parents = rows.map((_, i) => i), keys = new Map();
    const root = (i) => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
    rows.forEach((row, i) => row.keys.forEach(key => { if (keys.has(key)) parents[root(i)] = root(keys.get(key)); else keys.set(key, i); }));
    const grouped = new Map(); rows.forEach((row, i) => { const key = root(i); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); });
    const excludedIds = new Set(strings(exclusions.productIds)), excludedCategories = new Set(strings(exclusions.categories).map(norm));
    const groups = [...grouped.values()].map(rows => {
      const items = rows.map(r => r.item), eligible = items.filter(item => !item.blockedReasons.length).sort((a, b) => b.score - a.score || Number(b.sellingPoints.status==='verified_saved')-Number(a.sellingPoints.status==='verified_saved')), best = eligible[0] || items[0];
      const blockedReasons = [], ingredientEvidence = items.flatMap(item => item.ingredientEvidence), ingredientHold = healthIngredientHold(ingredientEvidence);
      if (ingredientHold) blockedReasons.push(ingredientHold);
      if (items.some(item => excludedIds.has(item.id))) blockedReasons.push('직접 제외한 상품 또는 같은 상품의 옵션');
      if (items.some(item => excludedCategories.has(norm(item.category)))) blockedReasons.push('직접 제외한 분류');
      if (!eligible.length) blockedReasons.push(...unique(items.flatMap(item => item.blockedReasons)));
      // A group-wide hold/exclusion applies across options; one sold-out option need not hide another.
      if (items.some(item => item.blockedReasons.some(reason => /보류|제외/.test(reason)))) blockedReasons.push('같은 상품에 보류·제외 기록 있음');
      const angleTopics=unique(best.evidence.filter(f=>f.kind.startsWith('creator_')).map(f=>f.value)).filter(t=>Object.hasOwn(TOPICS,t)).slice(0,2);
      const channelAngle=angleTopics.length?angleTopics.map(t=>TOPICS[t][0]).join('·')+' 콘텐츠에 곁들이는 방향으로 검토할 수 있습니다.':'';
      return { id: items[0].id, sellingPoints:best.sellingPoints, channelAngle, product: best.product, draftProduct: draftProductName(best.product), brand: best.brand, items, reason: best.reason, matchType: best.matchType, evidence: [...best.evidence, ...ingredientEvidence], uncertainty: unique([...best.uncertainty, best.sellingPoints.reason, '현재 재고·가격·협업 조건은 확인되지 않았습니다.', ...(items.length > 1 ? ['같은 상품의 옵션·구성 기록을 하나로 묶었습니다.'] : [])]), score: best.score, available: !blockedReasons.length, blockedReasons: unique(blockedReasons), index: Math.min(...rows.map(r => r.index)) };
    });
    return { groups: groups.sort((a, b) => b.score - a.score || a.index - b.index), invalid };
  }
  function sharedCatalogLink(catalog = {}, now = Date.now()) {
    const share=catalog.sharedSheet, at=Date.parse(share?.verifiedAt||'');
    if(!share||!text(catalog.ownerId)||share.ownerId!==catalog.ownerId||share.access!=='anyone_reader'||share.provenance!=='operator_attested_public_read'||share.publicFieldsOnly!==true||!['owner_sharing_ui','anonymous_read'].includes(share.verificationMethod)||share.revoked===true||!Number.isFinite(at)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(share.verifiedAt)||![new Date(at).toISOString(),new Date(at).toISOString().replace('.000Z','Z')].includes(share.verifiedAt)||at>now||now-at>DAY)return '';
    try { const u=new URL(share.url); return u.protocol==='https:'&&u.hostname==='docs.google.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/spreadsheets\/d\/[A-Za-z0-9_-]{20,160}\/edit$/.test(u.pathname)?u.toString():''; } catch { return ''; }
  }
  function proposalProductLine(group, index) {
    return draftProductLine(group).replace(/^- /,(index+1)+'. ').replace('\n  ','\n주요 특징: ');
  }
  function makeDraftText(creator, intent, selected, catalog = {}, now = Date.now()) {
    if (intent.kind === 'hold' || intent.needsReferenceReview) return '';
    const handle = text(creator.handle), greeting = (/^[A-Za-z0-9._]{1,30}$/.test(handle) ? '안녕하세요, @' + handle + '님!' : '안녕하세요!') + '\n\n먼저 바쁘실 텐데 답장 주셔서 정말 감사합니다! 😊';
    const allowedCategoryLabels = new Set([HEALTH_EXCLUSION_LABEL, ...Object.values(ALIASES).map(values => values[0])]), labels = strings(intent.excludedCategoryLabels).filter(label => allowedCategoryLabels.has(label));
    const introduction = greeting + (labels.length ? '\n\n' + labels.join(', ') + ' 분류를 제외하는 기준으로 검토했습니다.' : '');
    const supported = (Array.isArray(selected) ? selected : []).filter((g, i, all) => g && all.findIndex(other => other && (other.id === g.id || norm(other.draftProduct || other.product) === norm(g.draftProduct || g.product))) === i && g.available !== false && (!Array.isArray(g.blockedReasons) || !g.blockedReasons.length) && g.score > 0 && safeDescriptor(g.product)).slice(0, 3);
    const examples = supported.length && intent.allowProductMention !== false ? '예시 검토 후보로 아래 상품을 살펴봐 주실 수 있을까요?\n' + supported.map(draftProductLine).join('\n\n') : '';
    const inquiry = intent.inquiry || {};
    if (intent.kind === 'inquiry' || (intent.kind === 'ambiguous' && (inquiry.method || inquiry.fee || inquiry.terms))) {
      const lines = [introduction];
      if (inquiry.email) lines.push('협업 내용을 이메일로 검토하고 싶으시다는 요청을 확인했습니다.');
      if (inquiry.email && intent.contactReview?.needsConfirmation) lines.push(intent.contactReview.kind === 'domain' ? '자료를 받으실 이메일 주소의 도메인이 정확한지 확인해 주실 수 있을까요?' : '자료를 받으실 이메일 주소를 확인해 주실 수 있을까요?');
      if (inquiry.method) lines.push('문의하신 협업 방식부터 말씀드리겠습니다. 제안드리는 방향은 상품 자료를 검토하신 뒤 관심 있는 상품과 진행 방향을 함께 협의하는 공동구매 협업입니다.');
      if (inquiry.fee) lines.push('말씀해 주신 비용·진행 조건과 관련해, 구체적인 비용과 지원 범위는 아직 확인되지 않아 확정해서 안내드리기 어렵습니다.');
      if (intent.supportReview?.productionSupport) lines.push('제작비 지원 여부와 구체적인 지원 범위는 별도 확인과 협의가 필요합니다.');
      if (inquiry.terms) lines.push('말씀하신 구체적인 협업 조건은 아직 확인이 필요합니다. 가격과 지원 범위, 제작 내용 등은 확인한 뒤 별도로 협의할 사항입니다.');
      if (inquiry.materials && !(inquiry.email && intent.contactReview?.needsConfirmation)) lines.push(supported.length ? '상품 자료 문의에 참고하실 수 있도록 검토 후보를 정리했습니다.' : (inquiry.email ? '구체적인 상품 자료와 협업 내용은 추가 확인이 필요합니다.' : '상품 자료 문의를 확인했습니다. 현재 정보만으로는 적합한 상품을 제안하기 어려워, 관심 있는 분야나 제외할 품목을 알려주실 수 있을까요?'));
      if (examples) lines.push(examples);
      else if (!inquiry.materials) lines.push('상품 자료도 함께 받아보실지 말씀 부탁드립니다.');
      lines.push('가격·재고와 구체적인 진행 사항은 확인이 필요합니다.');
      return lines.join('\n\n');
    }
    if (intent.kind !== 'products') return introduction + '\n\n협업 진행 방식이나 검토하고 싶은 상품 분야가 있으실까요?' + (examples ? '\n\n' + examples + '\n\n가격·재고와 구체적인 진행 사항은 확인이 필요합니다.' : '\n상품 자료를 받아보실 의향이 있으신지 먼저 확인 부탁드립니다.');
    if (!supported.length) return introduction + '\n\n요청하신 상품 자료를 검토하고 있습니다. 현재 확인한 정보만으로는 적합한 상품을 제안하기 어려워, 관심 있는 상품 분야나 제외할 품목을 알려주실 수 있을까요?';
    const sheet=sharedCatalogLink(catalog,now);
    const lines=[introduction,
      '다양한 상품을 함께 소개하고 판매하는 협업을 제안드리고 싶습니다.',
      '채널의 콘텐츠 방향을 고려해, 요청하신 상품 자료로 아래 '+supported.length+'개 상품을 검토 후보로 정리했습니다.',
      supported.map(proposalProductLine).join('\n\n'),
      '꼭 이 상품들로 진행하지 않으셔도 괜찮습니다! 가격·재고와 구체적인 진행 사항은 확인이 필요합니다.'];
    if(sheet)lines.push('다른 상품도 살펴보실 수 있도록 목록을 정리해 두었습니다.\n상품 목록: '+sheet);
    lines.push('관심 가는 상품이나 평소에 판매해 보고 싶으셨던 제품이 있다면 편하게 알려주세요. 협업 가능한지 알아보겠습니다.',
      '더 자세한 이야기가 필요하시다면 줌 미팅 등으로 이야기 나눠도 좋습니다.',
      '서로 잘 맞는 상품을 찾아가며 장기적으로 좋은 협업을 만들어가고 싶습니다. 부담 없이 편하게 의견 주세요!');
    return lines.join('\n\n');
  }
  function makeDraft(creator, intent, selected, catalog = {}, now = Date.now()) {
    const full=makeDraftText(creator,intent,selected,catalog,now);
    if(full.length<=1000)return full;
    // Keep whole factual sentences. Never truncate a qualifier or claim mid-text.
    const compact=(Array.isArray(selected)?selected:[]).map(g=>({...g,channelAngle:'',sellingPoints:g.sellingPoints?{...g.sellingPoints,points:g.sellingPoints.points.slice(0,1)}:undefined}));
    const shortened=makeDraftText(creator,intent,compact,catalog,now);
    return shortened.length<=1000?shortened:'';
  }
  function buildDraft({ creator = {}, intent = {}, selected = [], catalog = {}, now = Date.now() } = {}) { return makeDraft(creator, intent, selected, catalog, now); }
  function plan(options = {}) {
    const creator = options.creator || {}, deals = Array.isArray(options.deals) ? options.deals : [], now = Number.isFinite(options.now) ? options.now : Date.now();
    const context = creatorContext(creator, now), catalog = options.catalog || {};
    const reply = options.reply || {}, inbound = (Array.isArray(options.thread?.messages) ? options.thread.messages : []).filter(m => m && m.out === false && !m.automatic && text(m.text)), rawReply = { ...reply, text: text(reply.text || inbound[inbound.length - 1]?.text) };
    const explicit = options.exclusions || {}, inferredExclusions = replyExclusions(deals, rawReply), recordedExclusions = replyExclusions(deals, { text: text(reply.exclusionText) });
    const historyExclusions = inbound.map(message => ({ message, exclusions: replyExclusions(deals, { text: message.text }) }));
    const intentThread = { ...(options.thread || {}), messages: historyExclusions.map(row => ({ ...row.message, decisionText: row.exclusions.decisionText })) };
    const intent = classifyIntent({ ...rawReply, decisionText: inferredExclusions.decisionText }, intentThread, creator);
    const exclusions = { healthExcluded: strings(explicit.categories).some(category => HEALTH_EXCLUSION_ALIASES.includes(norm(category))) || inferredExclusions.healthExcluded || recordedExclusions.healthExcluded || historyExclusions.some(row => row.exclusions.healthExcluded), productIds: unique([...strings(explicit.productIds), ...inferredExclusions.productIds, ...recordedExclusions.productIds, ...historyExclusions.flatMap(row => row.exclusions.productIds)]), categories: unique([...strings(explicit.categories), ...inferredExclusions.categories, ...recordedExclusions.categories, ...historyExclusions.flatMap(row => row.exclusions.categories)]) };
    intent.excludedCategoryLabels = unique([...inferredExclusions.categoryLabels, ...recordedExclusions.categoryLabels, ...historyExclusions.flatMap(row => row.exclusions.categoryLabels)]);
    const { groups, invalid } = catalogGroups(deals, context, exclusions, now, replyPreferences(rawReply));
    const blocked = [], candidates = [];
    for (const group of groups) {
      if (!group.available || intent.kind === 'hold') blocked.push({ ...group, available: false, blockedReasons: unique([...group.blockedReasons, ...(intent.kind === 'hold' ? [intent.label] : [])]) });
      else candidates.push(group);
    }
    const selected = candidates.filter(g => g.score > 0).slice(0, 3), selectedIds = new Set(selected.map(g => g.id)), remaining = candidates.filter(g => !selectedIds.has(g.id));
    const expectedCount = Number.isSafeInteger(catalog.expectedCount) && catalog.expectedCount >= 0 ? catalog.expectedCount : null;
    const complete = catalog.complete === true && (expectedCount === null || expectedCount === deals.length);
    const draftReview = intent.needsReferenceReview ? { status: 'reference_only', reason: '이메일 요청 또는 연락처 확인 맥락을 충분히 확인할 수 없어 새 문구를 만들지 않았습니다. 보존된 기존 참고 초안과 원문을 먼저 검토하세요.' } : { status: intent.kind === 'hold' ? 'held' : 'generated', reason: '' };
    const drafted=makeDraft(creator,intent,selected,catalog,now);
    if(!drafted&&draftReview.status==='generated'){draftReview.status='reference_only';draftReview.reason='초안이 메시지 길이 제한을 넘어 자동 문구를 만들지 않았습니다. 상품 수나 소구점 길이를 검토해 주세요. 기존 초안은 변경하지 않았습니다.';}
    const warnings = [];
    if(intent.kind==='products'&&!sharedCatalogLink(catalog,now))warnings.push('상품 시트의 현재 계정 연결과 최근 24시간 내 운영자의 공개 읽기 확인 기록이 없어 링크 문단을 넣지 않았습니다.');
    if (draftReview.reason) warnings.push(draftReview.reason);
    if (intent.contactReview?.needsConfirmation) warnings.push('연락처 확인 필요 · ' + (intent.contactReview.kind === 'domain' ? '이메일 도메인' : '이메일 주소') + ' 불확실성 기록을 반영했습니다. 주소를 추정하거나 보정하지 않았습니다.');
    if (!complete) warnings.push('전체 상품 목록 조회 완료가 확인되지 않았습니다. 불러온 목록 안에서만 선정했습니다.');
    if (context.kind !== 'public_research') warnings.push(context.label);
    if (intent.kind !== 'products') warnings.push('내부 검토 후보와 상대의 상품 수락은 다릅니다. 초안은 문의·의도 확인을 우선합니다.');
    if (selected.length < 3) warnings.push('근거와 제외 조건을 충족한 상품은 ' + selected.length + '개입니다. 3개를 맞추기 위해 추가하지 않습니다.');
    if (selected.some(g=>g.sellingPoints.status!=='verified_saved'))warnings.push('확인 소구점의 상품 연결·출처·내용이 일치하지 않는 상품은 이름만 제시하고 소구점 확인 필요를 표시했습니다.');
    if (invalid.length) warnings.push('형식을 확인할 수 없는 상품 기록 ' + invalid.length + '건은 자동 선정에서 제외했습니다.');
    return { selected, remaining, blocked, intent, draftReview, sourceExclusions: [...inferredExclusions.evidence.map(e => ({ ...e, source: 'reply' })), ...recordedExclusions.evidence.map(e => ({ ...e, source: 'recorded_exclusions' })), ...historyExclusions.flatMap(row => row.exclusions.evidence.map(e => ({ ...e, source: 'reply_history', observedAt: text(row.message.at) })))], creatorEvidence: context, warnings, invalid,
      counts: { loadedDeals: deals.length, distinctProducts: groups.length, selected: selected.length, remaining: remaining.length, blocked: blocked.length, eligible: candidates.filter(g => g.score > 0).length, invalid: invalid.length },
      completeness: { complete, expectedCount, loadedDeals: deals.length, label: complete ? '불러온 전체 저장 상품 검토 완료 · 현재 재고·조건은 별도 확인' : '전체 상품 조회 완료 미확인 · 불러온 목록 기준' },
      draft: drafted };
  }
  return Object.freeze({ plan, buildDraft, classifyIntent, publicResearch, creatorContext, productFacts, productUrlKey, savedSellingPoints, claimsSha256, sharedCatalogLink });
});
