const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../private/ui/instagram-auto-products.js');
const now = Date.parse('2026-11-04T08:00:00Z');
const makeCreator = (topics = ['home_cafe'], extra = {}) => ({
  id: 'synthetic-creator', handle: 'synthetic_creator', bio: '', category: '',
  publicResearch: { provenance: 'operator_attested', profileUrl: 'https://www.instagram.com/synthetic_creator/', observedAt: '2026-11-04T07:00:00Z', topics, sources: ['https://www.instagram.com/synthetic_creator/p/Synthetic123/'], captureSha256: 'a'.repeat(64) }, ...extra,
});
const product = (id, extra = {}) => ({ id, name: '합성 커피 ' + id, category: '커피', productUrl: 'https://shop.example.test/products/' + id, ...extra });
const run = (extra = {}) => engine.plan({ creator: makeCreator(), deals: ['a', 'b', 'c', 'd'].map(id => product(id)), reply: { text: '상품 목록 보내주세요.' }, catalog: { complete: true, expectedCount: 4 }, now, ...extra });

test('selects at most three supported distinct products and preserves every remaining row separately', () => {
  const r = run(); assert.equal(r.selected.length, 3); assert.equal(r.remaining.length, 1); assert.equal(r.blocked.length, 0);
  assert.deepEqual(r.counts, { loadedDeals: 4, distinctProducts: 4, selected: 3, remaining: 1, blocked: 0, eligible: 4, invalid: 0 });
  assert.equal(r.completeness.complete, true); assert.equal(r.intent.kind, 'products');
  assert.ok(r.selected.every(g => g.matchType === 'direct' && g.evidence.length >= 2));
  assert.match(r.draft, /아래 3개/); assert.doesNotMatch(r.draft, /합성 커피 d/);
});
test('does not invent filler to reach three; unknown category/source produces zero', () => {
  const r = run({ deals: [product('a'), { id: 'x', name: '무관한 제품' }, { id: 'y', name: '또 다른 제품' }] });
  assert.equal(r.selected.length, 1); assert.equal(r.remaining.length, 2); assert.match(r.warnings.join('\n'), /3개를 맞추기 위해 추가하지/);
  assert.equal(run({ creator: { handle: 'synthetic_creator' } }).selected.length, 0);
});
test('all 53 loaded rows are considered, not just the first page or first three', () => {
  const deals = Array.from({ length: 53 }, (_, i) => ({ id: 'item-' + i, name: '무관 상품 ' + i }));
  deals[52] = product('last'); const r = run({ deals, catalog: { complete: true, expectedCount: 53 } });
  assert.deepEqual(r.selected.map(g => g.id), ['last']); assert.equal(r.counts.loadedDeals, 53); assert.equal(r.remaining.length, 52); assert.equal(r.completeness.complete, true);
});
test('catalog completeness requires explicit completed load and matching expected total', () => {
  for (const catalog of [{}, { complete: false }, { complete: true, expectedCount: 5 }]) { const r = run({ catalog }); assert.equal(r.completeness.complete, false); assert.match(r.warnings.join('\n'), /전체 상품 목록/); }
});
test('source evidence exposes date, URL, hash, source type and direct-vs-inferred distinction', () => {
  const r = run(); assert.equal(r.creatorEvidence.observedAt, '2026-11-04T07:00:00Z'); assert.equal(r.creatorEvidence.captureSha256, 'a'.repeat(64));
  assert.equal(r.creatorEvidence.sources.length, 1); assert.match(r.selected[0].reason, /직접 주제 일치/);
  assert.ok(r.selected[0].evidence.some(e => e.kind === 'creator_public_topic' && e.observedAt && e.url));
  assert.ok(r.selected[0].evidence.some(e => e.kind === 'product_attribute' && e.field && e.value));
});
test('wrong-account, invalid-hash, private and future public observations do not become current evidence', () => {
  for (const patch of [{ observedAt: '2026-11-05T00:00:00Z' }, { captureSha256: 'wrong' }, { sources: ['https://www.instagram.com/other/p/Synthetic123/'] }, { topics: ['private_raw_text'] }, { profileUrl: 'https://www.instagram.com/other/' }, { sources: ['https://www.instagram.com/synthetic_creator/direct/123/'] }]) {
    const creator = makeCreator(); creator.publicResearch = { ...creator.publicResearch, ...patch }; creator.bio = '홈카페';
    const r = run({ creator }); assert.equal(r.selected.length, 0, JSON.stringify(patch)); assert.equal(r.creatorEvidence.kind, 'unverified');
  }
});
test('fresh public observations take precedence over older stored profile fields', () => {
  const r = run({ creator: makeCreator(['travel'], { bio: '홈카페', category: '커피', topics: ['커피'] }) }); assert.equal(r.selected.length, 0);
});
test('stored bio/category are labeled weaker and never support cross-topic speculation', () => {
  let r = run({ creator: { handle: 'synthetic_creator', bio: '홈카페 커피 기록', category: '홈카페' } });
  assert.equal(r.selected.length, 3); assert.equal(r.creatorEvidence.strength, 'weak'); assert.ok(r.selected.every(g => g.uncertainty.some(x => /현재 활동/.test(x))));
  r = run({ creator: { handle: 'synthetic_creator', category: '여행' }, deals: [product('a', { name: '휴대용 스틱 커피' })] }); assert.equal(r.selected.length, 0);
});
test('travel scene inference requires both source-dated activity and actual portable product attributes', () => {
  const r = run({ creator: makeCreator(['travel', 'drone_photography']), deals: [product('portable', { name: '휴대용 스틱 커피' }), product('bulk', { name: '원두 커피 1kg' }), { id: 'tripod', name: '촬영용 삼각대' }] });
  assert.deepEqual(r.selected.map(g => g.id).sort(), ['portable', 'tripod']); assert.ok(r.selected.every(g => g.matchType === 'inferred')); assert.ok(r.selected.every(g => g.uncertainty.length));
  assert.doesNotMatch(r.draft, /여행에서 드시는|선호하시는|건강|효능/);
});
test('explicit coffee-bag and pouch formats support a bounded portable scene', () => {
  for (const name of ['합성 커피백 31포', '합성 파우치 과채 주스', '합성 보리차 티백']) {
    const r = run({ creator: makeCreator(['travel']), deals: [product('a', { name, category: '미확인' })] }); assert.equal(r.selected.length, 1, name); assert.equal(r.selected[0].matchType, 'inferred');
  }
});
test('household and home content can support only explicit bounded product scenes', () => {
  const r = run({ creator: makeCreator(['parenting', 'home_interior']), deals: [{ id: 'soap', name: '합성 바디바' }, { id: 'meal', name: '합성 간편식' }, { id: 'mug', name: '합성 머그' }, { id: 'unrelated', name: '합성 금속 자재' }] });
  assert.equal(r.selected.length, 3); assert.ok(r.selected.every(g => g.matchType === 'inferred')); assert.equal(r.remaining[0].id, 'unrelated');
  assert.doesNotMatch(r.draft, /아이에게|아이들이|안전한|가족이|효과/);
});
test('beauty-to-cleansing scene is labeled inference without skin or efficacy claims', () => {
  const r = run({ creator: makeCreator(['beauty']), deals: [{ id: 'bar', name: '합성 페이셜&바디바' }] }); assert.equal(r.selected.length, 1); assert.equal(r.selected[0].matchType, 'inferred'); assert.match(r.selected[0].uncertainty.join(' '), /효능.*미확인/);
});
test('coffee-scented soap never matches coffee or drink activity', () => {
  const r = run({ deals: [product('a', { name: '커피 비누', category: '비누', topics: ['커피'] })] }); assert.equal(r.selected.length, 0);
});
test('health topics cannot be creator/product matching evidence', () => {
  for (const topic of ['당뇨 치료', '질환', 'pregnancy', 'medication', 'cancer', 'efficacy']) {
    const r = run({ creator: { topics: [topic], bio: topic, category: topic }, deals: [{ id: 'x', name: '합성 일반 상품', topics: [topic] }] }); assert.equal(r.selected.length, 0, topic);
  }
});
test('deduplicates same product name, canonical product URL and transitive option groups', () => {
  const deals = [product('a', { productName: '합성 원두', name: '합성 원두 옵션 A', productUrl: 'https://shop.example.test/products/one?variant=1' }), product('b', { productName: '합성 원두', name: '합성 원두 옵션 B', productUrl: 'https://shop.example.test/products/two' }), product('c', { productName: '합성 다른 표시', productUrl: 'https://shop.example.test/products/two?option_id=3' }), product('d')];
  const r = run({ deals }); assert.equal(r.selected.length, 2); assert.equal(r.selected.find(g => g.id === 'a').items.length, 3);
});
test('query product IDs deduplicate variants but generic homepage/catalog URLs do not', () => {
  let r = run({ deals: [product('a', { productUrl: 'https://shop.example.test/item.html?product_no=7&option=1' }), product('b', { productUrl: 'https://shop.example.test/item.html?product_no=7&option=2' })] }); assert.equal(r.selected.length, 1);
  for (const url of ['https://shop.example.test/', 'https://shop.example.test/catalog/all']) { r = run({ deals: [product('a', { productUrl: url }), product('b', { productUrl: url })] }); assert.equal(r.selected.length, 2); }
});
test('unlabeled size-only variants do not count as different products', () => {
  const r = run({ deals: [product('a', { name: '합성 커피 500ml', productUrl: '' }), product('b', { name: '합성 커피 1L', productUrl: '' })] }); assert.equal(r.selected.length, 1);
});
test('sold out, held, excluded product and excluded category are blocked before selection', () => {
  const deals = [product('a', { stock: 0 }), product('b', { held: true }), product('c', { excluded: true }), product('d', { category: '제외 분류' }), product('e')];
  const r = run({ deals, exclusions: { categories: ['제외 분류'], productIds: ['e'] } }); assert.equal(r.selected.length, 0); assert.equal(r.blocked.length, 5);
});
test('positive sold-out notes hold; negated or unknown stock is never invented', () => {
  for (const note of ['품절 표시 없음', '품절 아님', '품절 여부 미확인', '품절 확인 안됨']) { const r = run({ deals: [product('a', { sourceNote: note })] }); assert.equal(r.selected.length, 1, note); assert.equal(r.selected[0].items[0].stock, '재고 미확인'); }
  for (const note of ['현재 품절', '품절 표시 없음, 현재 옵션 품절']) assert.equal(run({ deals: [product('a', { sourceNote: note })] }).selected.length, 0);
});
test('a sold-out option may coexist with available unknown stock, but hold/exclusion applies to group', () => {
  const base = [product('a', { productName: '같은 커피', stock: 0 }), product('b', { productName: '같은 커피' })];
  let r = run({ deals: base }); assert.equal(r.selected.length, 1); assert.equal(r.selected[0].items.length, 2);
  r = run({ deals: [{ ...base[0], held: true }, base[1]] }); assert.equal(r.selected.length, 0);
  r = run({ deals: base, exclusions: { productIds: ['a'] } }); assert.equal(r.selected.length, 0);
});
test('explicit exact product and category exclusions in supplied reply are respected', () => {
  let r = run({ deals: [product('a'), product('b', { category: '뷰티', name: '뷰티 커피 상품' })], reply: { text: '뷰티는 제외하고 제안해주세요.' } }); assert.deepEqual(r.selected.map(g => g.id), ['a']);
  r = run({ reply: { text: '합성 커피 a 제외해주세요.' } }); assert.equal(r.selected.some(g => g.id === 'a'), false);
  r = run({ reply: { text: '커피 제외하지 않습니다.' } }); assert.equal(r.selected.length, 3);
});
test('hard refusal/stop has no selected candidates or outgoing draft', () => {
  for (const value of ['거절합니다.', '연락하지 마세요.', '관심 없습니다.', '안 보내주세요.', '진행 어렵습니다.', 'Please stop.', 'Not interested.']) {
    const r = run({ reply: { text: value } }); assert.equal(r.intent.kind, 'hold', value); assert.equal(r.selected.length, 0); assert.equal(r.draft, ''); assert.equal(r.blocked.length, 4);
  }
});
test('saved refusals and prior inbound stop cannot be erased by a later short positive', () => {
  for (const thread of [{ status: '거절' }, { conversationStatus: '회신 중단' }, { messages: [{ out: false, text: '연락하지 마세요.' }, { out: false, text: '네' }] }]) assert.equal(run({ thread }).intent.kind, 'hold');
});
test('negated, conditional, quoted refusal/request never becomes acceptance or product-request intent', () => {
  for (const value of ['거절은 아닙니다. 상품 보내주세요.', '관심 없지 않아요.', '"상품 보내주세요"라는 예시입니다.', '“거절합니다”라고 말하지 않았어요.', '만약 상품 보내주세요라고 하면요?', 'I did not decline.']) {
    const r = run({ reply: { text: value } }); assert.equal(r.intent.kind, 'ambiguous', value); assert.equal(r.intent.allowProductMention, false, value); assert.doesNotMatch(r.draft, /합성 커피/, value);
  }
});
test('method inquiry is answered first, then supported products offered as tentative examples', () => {
  const r = run({ reply: { text: '협업은 어떤 방식으로 진행하나요?' } }); assert.equal(r.intent.kind, 'inquiry'); assert.equal(r.selected.length, 3);
  assert.ok(r.draft.indexOf('협업 방식부터') < r.draft.indexOf('합성 커피 a')); assert.match(r.draft, /예시 검토 후보.*살펴봐 주실 수 있을까요/);
  assert.doesNotMatch(r.draft, /수락|확정되었습니다|관심 있으시니|진행하겠습니다/);
});
test('fee inquiry includes no fee percentages, commission terms or unsupported promises', () => {
  const r = run({ reply: { text: '비용과 수수료가 궁금합니다.' }, deals: [product('a', { sourceNote: '수수료 33% / private@example.test / https://mail.google.com/private' })] });
  assert.equal(r.intent.kind, 'inquiry'); assert.match(r.draft, /비용과 지원 범위는 아직 확인되지/); assert.doesNotMatch(r.draft, /수수료|커미션|commission|33|%|무료|지급|보장|private/);
});
test('historical notes do not become current consent, but create explicitly tentative useful draft', () => {
  const r = run({ reply: { text: '상품 목록 보내주세요.', historical: true, observedAt: '2026-10-01T00:00:00Z', sourceLabel: '수동 확인 과거 메모' } });
  assert.equal(r.intent.kind, 'inquiry'); assert.equal(r.intent.inquiry.materials, true); assert.equal(r.intent.historical, true); assert.match(r.intent.label, /과거/); assert.match(r.draft, /예시 검토 후보/); assert.doesNotMatch(r.draft, /요청하신 상품|수락/);
});
test('ambiguous acknowledgment never claims product acceptance', () => {
  const r = run({ reply: { text: '네 감사합니다.' } }); assert.equal(r.intent.kind, 'ambiguous'); assert.match(r.draft, /살펴봐 주실 수 있을까요/); assert.doesNotMatch(r.draft, /수락|관심 있으시니|요청하신 상품/);
});
test('registered product evidence is bounded and must be source-dated', () => {
  let r = run({ creator: makeCreator(['travel']), deals: [product('a', { registeredEvidence: [{ kind: 'attribute', value: '휴대용', url: 'https://shop.example.test/products/a', observedAt: '2026-11-03T00:00:00Z' }] })] }); assert.equal(r.selected.length, 1); assert.ok(r.selected[0].evidence.some(e => e.kind === 'registered_product_evidence'));
  r = run({ creator: makeCreator(['travel']), deals: [product('a', { sourceNote: '휴대용', registeredEvidence: [{ kind: 'attribute', value: '휴대용', url: 'https://shop.example.test/products/a' }] })] }); assert.equal(r.selected.length, 0);
});
test('private source notes, commercial terms and private links never leak into result or draft', () => {
  const r = run({ deals: [product('a', { sourceNote: 'SECRET_INBOX private@example.test commission 33%', note: 'SECRET_NOTE https://mail.google.com/private', productUrl: 'https://drive.google.com/file/private', attributes: ['휴대용 commission 33%'], registeredEvidence: [{ kind: 'attribute', value: '휴대용', url: 'https://docs.google.com/private', observedAt: '2026-11-03T00:00:00Z' }] })] });
  assert.doesNotMatch(JSON.stringify(r), /SECRET_|private@example|mail.google|drive.google|docs.google|commission 33/); assert.equal(r.selected[0].items[0].link, '');
});
test('unsafe URLs and credential query links are omitted while exact public product links survive', () => {
  for (const url of ['javascript:alert(1)', 'http://shop.example.test/product/a', 'https://user:password@shop.example.test/product/a', 'https://shop.example.test/product/a?token=secret']) assert.equal(run({ deals: [product('a', { productUrl: url })] }).selected[0].items[0].link, '');
  assert.equal(run().selected[0].items[0].link, 'https://shop.example.test/products/a');
});
test('buildDraft regenerates reviewed selected groups, omits blocked/unsupported and maxes at three', () => {
  const r = run(), draft = engine.buildDraft({ creator: makeCreator(), intent: r.intent, selected: [r.remaining[0], r.selected[0]] });
  assert.match(draft, /아래 2개/); assert.match(draft, /합성 커피 d/); assert.doesNotMatch(draft, /합성 커피 b/);
  assert.equal(engine.buildDraft({ creator: makeCreator(), intent: { kind: 'hold' }, selected: r.selected }), '');
});
test('invalid rows are counted without inventing missing products; inputs remain unchanged', () => {
  const input = { creator: makeCreator(), deals: [null, { name: '누락' }, product('a')], now }; const before = JSON.stringify(input), r = engine.plan(input);
  assert.equal(r.counts.invalid, 2); assert.equal(r.selected.length, 1); assert.equal(JSON.stringify(input), before);
});
test('stable ties preserve catalog order rather than arbitrary alphabetical fillers', () => {
  const r = run({ deals: [product('z'), product('c'), product('a'), product('b')] }); assert.deepEqual(r.selected.map(g => g.id), ['z', 'c', 'a']);
});
test('browser global and CommonJS share a pure engine without network, writes or dispatch', () => {
  const source = fs.readFileSync('private/ui/instagram-auto-products.js', 'utf8'), context = { URL }; vm.createContext(context); vm.runInContext(source, context);
  assert.equal(typeof context.InstagramAutoProducts.plan, 'function'); assert.equal(typeof context.InstagramAutoProducts.buildDraft, 'function');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.|navigator\.|clipboard|\/reply|\/dispatch/);
});

test('older valid public observations retain source date and weak status, never current verified evidence', () => {
  const creator = makeCreator(); creator.publicResearch.observedAt = '2026-10-01T00:00:00Z';
  const r = run({ creator }); assert.equal(r.selected.length, 3); assert.equal(r.creatorEvidence.kind, 'historical_public_research'); assert.equal(r.creatorEvidence.strength, 'historical'); assert.equal(r.creatorEvidence.observedAt, '2026-10-01T00:00:00Z'); assert.match(r.warnings.join(' '), /7일 초과/); assert.ok(r.selected.every(g => g.uncertainty.some(x => /현재 활동/.test(x))));
});
test('clear multi-pack quantities and discount variants count as one product even on root URLs', () => {
  for (const names of [['합성 커피 벌크 1봉 30티백', '합성 커피 벌크 3봉 90티백'], ['합성 커피 1박스 정상가', '합성 커피 1박스 할인가'], ['Synthetic coffee bulk1bag30teabags', 'Synthetic coffee bulk3bags90teabags']]) {
    const r = run({ deals: names.map((name, i) => product(String(i), { name, productUrl: 'https://shop.example.test/' })) }); assert.equal(r.selected.length, 1, names.join(' / '));
  }
});
test('shop_view product idx identifies variants but category idx never merges unrelated products', () => {
  let r = run({ deals: [product('a', { productUrl: 'https://shop.example.test/shop_view/?idx=185&option=1' }), product('b', { productUrl: 'https://shop.example.test/shop_view/?idx=185&option=2' })] }); assert.equal(r.selected.length, 1);
  r = run({ deals: [product('a', { productUrl: 'https://shop.example.test/category/?idx=185' }), product('b', { productUrl: 'https://shop.example.test/category/?idx=185' })] }); assert.equal(r.selected.length, 2);
});

test('historical absence of agreement is not a refusal and method/fee inquiry remains first', () => {
  const r = run({ reply: { text: '진행 방식과 비용이 어떻게 되나요?\n방식·비용 문의, 상품이나 비용에 합의하지 않음.', historical: true } });
  assert.equal(r.intent.kind, 'inquiry'); assert.equal(r.selected.length, 3); assert.match(r.draft, /협업 방식부터/); assert.match(r.draft, /비용과 지원 범위는 아직 확인되지/); assert.match(r.draft, /예시 검토 후보/); assert.doesNotMatch(r.draft, /합의하신|수락하신/);
});

test('scoped shampoo exclusion leaves unrelated supported products eligible', () => {
  const r = run({ creator: makeCreator(['beauty', 'home_cafe']), deals: [product('shampoo', { name: '합성 샴푸', category: '미확인' }), product('coffee')], reply: { text: '샴푸는 제외하고 상품 자료 보내주세요.' } });
  assert.notEqual(r.intent.kind, 'hold'); assert.deepEqual(r.selected.map(g => g.id), ['coffee']); assert.equal(r.blocked[0].id, 'shampoo'); assert.doesNotMatch(r.draft, /합성 샴푸/); assert.ok(r.sourceExclusions.some(e => e.label === '샴푸'));
});
test('scoped coffee refusal excludes coffee without silently blocking every other product', () => {
  const r = run({ creator: makeCreator(['beauty', 'home_cafe']), deals: [product('coffee'), product('soap', { name: '합성 비누', category: '미확인' })], reply: { text: '커피는 진행 안 해요. 다른 제품 자료 부탁해요.' } });
  assert.notEqual(r.intent.kind, 'hold'); assert.deepEqual(r.selected.map(g => g.id), ['soap']); assert.doesNotMatch(r.draft, /합성 커피/);
});
test('global refusal remains a hard hold even alongside scoped category exclusions', () => {
  for (const value of ['제안 보내지 마세요.', '연락하지 마세요.', '진행하지 않습니다.', '현재 제품 협업 안 함', '커피는 제외하고 연락하지 마세요.']) {
    const r = run({ reply: { text: value, historical: true } }); assert.equal(r.intent.kind, 'hold', value); assert.equal(r.selected.length, 0); assert.equal(r.draft, '');
  }
});

test('historical reported product-material request is tentative, not automatically declined or accepted', () => {
  const r = run({ reply: { text: '상품 자료를 보내달라고 답함. 연락처는 별도 원문 참조.', historical: true } }); assert.equal(r.intent.kind, 'inquiry'); assert.equal(r.intent.inquiry.materials, true); assert.equal(r.intent.allowProductMention, true); assert.match(r.draft, /예시 검토 후보/); assert.doesNotMatch(r.draft, /수락|발송했습니다/);
});
test('historical reported collaboration-method inquiry is answered first', () => {
  const r = run({ reply: { text: '어떤 협업으로 진행하는지 문의.', historical: true } }); assert.equal(r.intent.kind, 'inquiry'); assert.match(r.draft, /협업 방식부터/);
});
test('bounded category nonparticipation excludes that category while retaining other inquiry candidates', () => {
  const r = run({ deals: [product('supplement', { category: '건강식품' }), product('coffee')], reply: { text: '건강식품은 까다로워 잘 진행하지 않으나 다른 협업과 진행 방식은 궁금하다고 답함.', historical: true } });
  assert.equal(r.intent.kind, 'inquiry'); assert.deepEqual(r.selected.map(g => g.id), ['coffee']); assert.doesNotMatch(r.draft, /supplement/);
});
test('size/BOX and explicit percentage discount suffixes deduplicate without altering displayed source names', () => {
  const r = run({ deals: ['합성 블랙 커피 1L · 10% 할인', '합성 블랙 커피 BOX · 정상가', '합성 블랙 커피 500ml · 정상가'].map((name, i) => product(String(i), { name, productUrl: 'https://shop.example.test/' })) }); assert.equal(r.selected.length, 1); assert.equal(r.selected[0].items.length, 3); assert.equal(r.selected[0].product, '합성 블랙 커피 1L · 10% 할인');
});

test('operator exclusion notes supply bounded exclusions without supplying counterpart refusal', () => {
  const r = run({ deals: [product('a'), product('b')], reply: { text: '어떤 협업 방식인가요?', exclusionText: '합성 커피 a 제외. 상품 수락으로 단정하지 않음. 비용을 제시하지 않음.', historical: true } });
  assert.equal(r.intent.kind, 'inquiry'); assert.deepEqual(r.selected.map(g => g.id), ['b']); assert.ok(r.sourceExclusions.some(e => e.source === 'recorded_exclusions'));
});
test('draft keeps product identity but omits explicit discount/price suffix promises', () => {
  const r = run({ deals: [product('a', { name: '합성 커피 1L · 10% 할인' })] }); assert.equal(r.selected[0].product, '합성 커피 1L · 10% 할인'); assert.match(r.draft, /합성 커피 1L/); assert.doesNotMatch(r.draft, /10%|할인/);
});
test('explicit F&B stored category maps to food as weak evidence, not health or demographics', () => {
  const r = run({ creator: { handle: 'synthetic_creator', category: 'F&B' }, deals: [product('food', { category: '식품' }), { id: 'medicine', name: '의약품', category: '의약품' }] }); assert.deepEqual(r.selected.map(g => g.id), ['food']); assert.equal(r.creatorEvidence.strength, 'weak');
});

test('coffee brew bags do not become tea attributes and product model X suffix is retained', () => {
  assert.equal(engine.productFacts(product('coffee', { name: '합성 커피 티백' })).some(f => f.topic === 'tea'), false);
  const r = run({ deals: [product('a', { name: '합성 커피 모델 X', productUrl: '' }), product('b', { name: '합성 커피 모델', productUrl: '' })] }); assert.equal(r.selected.length, 2);
});
test('negative biography statement does not establish positive activity evidence', () => {
  const r = run({ creator: { handle: 'synthetic_creator', bio: '커피 안 마십니다.' } }); assert.equal(r.selected.length, 0);
});
test('regenerated drafts cannot count duplicate selected groups as three products', () => {
  const r = run(), draft = engine.buildDraft({ creator: makeCreator(), intent: r.intent, selected: [r.selected[0], r.selected[0], r.selected[0]] }); assert.match(draft, /아래 1개/);
});

test('identity-bound stored beauty activity supports only explicit low-confidence scene hypotheses', () => {
  const creator = { id: 'synthetic-creator', handle: 'synthetic_creator', profileUrl: 'https://www.instagram.com/synthetic_creator/', category: '뷰티' };
  const r = run({ creator, deals: [{ id: 'soap', name: '합성 바디바' }, { id: 'unrelated', name: '합성 금속 자재' }] }); assert.deepEqual(r.selected.map(g => g.id), ['soap']); assert.equal(r.selected[0].matchType, 'inferred'); assert.match(r.selected[0].reason, /낮은 신뢰도/); assert.match(r.selected[0].uncertainty.join(' '), /현재 활동/); assert.equal(r.creatorEvidence.kind, 'stored_profile');
  for (const patch of [{ id: '' }, { profileUrl: 'https://www.instagram.com/other/' }, { category: '라이프스타일' }]) assert.equal(run({ creator: { ...creator, ...patch }, deals: [{ id: 'soap', name: '합성 바디바' }] }).selected.length, 0);
});
test('prior scoped exclusions persist across later requests without becoming a global refusal', () => {
  for (const prior of ['커피는 제외해주세요.', '커피는 보내지 마세요.']) {
    const r = run({ creator: makeCreator(['beauty', 'home_cafe']), deals: [product('coffee'), { id: 'soap', name: '합성 바디바' }], thread: { messages: [{ out: false, text: prior }, { out: true, text: '확인했습니다.' }, { out: false, text: '상품 목록 보내주세요.' }] }, reply: {} });
    assert.notEqual(r.intent.kind, 'hold', prior); assert.deepEqual(r.selected.map(g => g.id), ['soap']); assert.equal(r.blocked[0].id, 'coffee'); assert.ok(r.sourceExclusions.some(e => e.source === 'reply_history'));
  }
});

test('revoked public observations cannot rank or silently fall back to stored profile', () => {
  for (const patch of [{ revoked: true }, { revokedAt: '2026-11-04T07:30:00Z' }, { researchStatus: 'revoked' }]) {
    const creator = makeCreator(['home_cafe'], { category: '홈카페', profileUrl: 'https://www.instagram.com/synthetic_creator/' }); creator.publicResearch = { ...creator.publicResearch, ...patch };
    const r = run({ creator }); assert.equal(r.selected.length, 0); assert.equal(r.creatorEvidence.kind, 'unverified');
  }
});
test('availability/status holds and exclusions never rank as available', () => {
  for (const patch of [{ availability: 'on_hold' }, { availability: 'excluded' }, { status: '보류' }]) { const r = run({ deals: [product('a', patch)] }); assert.equal(r.selected.length, 0); assert.equal(r.blocked.length, 1); }
});

test('private commercial URLs are rejected rather than exposed or silently rewritten', () => {
  for (const url of ['https://shop.example.test/products/a?commission=33&affiliate=secret', 'https://shop.example.test/commission/private', 'https://shop.example.test/products/a#payout=private', 'https://shop.example.test/%63ommission/private']) {
    const r = run({ deals: [product('a', { productUrl: url, registeredEvidence: [{ kind: 'topic', value: '홈카페', url, observedAt: '2026-11-03T00:00:00Z' }] })] }); assert.equal(r.selected[0].items[0].link, ''); assert.doesNotMatch(JSON.stringify(r), /commission|affiliate|payout|private/);
  }
});
test('a blocked commercial-name variant cannot pollute selected group headings or evidence', () => {
  const url = 'https://shop.example.test/products/shared', r = run({ deals: [product('bad', { name: '합성 커피 수수료 33%', productUrl: url }), product('good', { name: '합성 커피', productUrl: url })] });
  assert.equal(r.selected.length, 1); assert.equal(r.selected[0].product, '합성 커피'); assert.doesNotMatch(JSON.stringify(r), /33%|수수료/); assert.equal(r.selected[0].items[0].name, '상품명 검수 필요');
});

test('explicit terms inquiry is answered before tentative product candidates', () => {
  for (const value of ['구체적인 조건이 궁금합니다.', '콘텐츠 조건 문의.', '협업 조건을 알려주세요.']) {
    const r = run({ reply: { text: value, historical: true } }); assert.equal(r.intent.kind, 'inquiry', value); assert.equal(r.intent.inquiry.terms, true); assert.match(r.draft, /구체적인 협업 조건은 아직 확인이 필요/); assert.ok(r.draft.indexOf('협업 조건') < r.draft.indexOf('합성 커피')); assert.doesNotMatch(r.draft, /협업 진행 방식이나 검토하고 싶은/);
  }
});
test('paid-content and production-cost cues get a fee-first answer without numeric rates or promises', () => {
  for (const value of ['유료콘텐츠만 검토하며 단가는 123만원이라고 설명함.', '제작비와 콘텐츠 조건 문의.', '유료 콘텐츠 비용은 456만원이라고 안내함.']) {
    const r = run({ reply: { text: value, historical: true } }); assert.equal(r.intent.kind, 'inquiry', value); assert.equal(r.intent.inquiry.fee, true); assert.match(r.draft, /비용과 지원 범위는 아직 확인되지/); assert.ok(r.draft.indexOf('비용과 지원 범위') < r.draft.indexOf('합성 커피')); assert.doesNotMatch(r.draft, /123|456|만원|수수료|커미션|지급|보장|합의했습니다/);
  }
});
test('historical materials request is answered with tentative materials without repeating method question', () => {
  for (const value of ['제안 자료를 보내달라고 요청함.', '제품 정보를 이메일로 보내달라고 답함.', '상품 목록 보내주세요.']) {
    const r = run({ reply: { text: value, historical: true } }); assert.equal(r.intent.kind, 'inquiry'); assert.equal(r.intent.inquiry.materials, true); assert.match(r.intent.label, /자료 요청 기록/); assert.match(r.draft, /상품 자료 문의에 참고/); assert.match(r.draft, /합성 커피/); assert.doesNotMatch(r.draft, /협업 진행 방식이나|받아보실 의향|이메일로 보내|수락|승인/);
  }
});
test('historical materials request with insufficient product evidence honestly asks for missing direction', () => {
  const r = run({ creator: { handle: 'synthetic_creator' }, reply: { text: '상품 자료 요청.', historical: true } }); assert.equal(r.selected.length, 0); assert.equal(r.intent.inquiry.materials, true); assert.match(r.draft, /적합한 상품을 제안하기 어려워/); assert.doesNotMatch(r.draft, /후보를 정리했습니다|합성 커피/);
});
test('quoted or negated materials requests remain ambiguous and never establish permission', () => {
  for (const value of ['"상품 자료 보내주세요"라는 예시입니다.', '상품 자료를 보내달라는 뜻은 아닙니다.']) {
    const r = run({ reply: { text: value } }); assert.equal(r.intent.kind, 'ambiguous'); assert.equal(r.intent.allowProductMention, false); assert.doesNotMatch(r.draft, /후보를 정리했습니다|합성 커피/);
  }
});
test('nondefault Instagram ports never provide creator identity or public source evidence', () => {
  const profile = { id: 'synthetic-creator', handle: 'synthetic_creator', profileUrl: 'https://www.instagram.com:8443/synthetic_creator/', category: '뷰티' };
  assert.equal(run({ creator: profile, deals: [{ id: 'soap', name: '합성 비누' }] }).selected.length, 0);
  for (const patch of [{ profileUrl: profile.profileUrl }, { sources: ['https://www.instagram.com:8443/synthetic_creator/p/Synthetic123/'] }]) { const creator = makeCreator(); creator.publicResearch = { ...creator.publicResearch, ...patch }; assert.equal(run({ creator }).selected.length, 0); }
});
