import { createClient } from '@supabase/supabase-js';
import { reviewReasons, orderCandidates } from '../supabase/functions/youtube-discovery/review-filters.mjs';
import { buildBriefReview } from '../supabase/functions/youtube-discovery/relevance.mjs';
import { supabaseUrl, supabaseKey } from './supabase-config.js';

// Default Supabase session key matches the main workspace; no new authentication flow.
const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } });
const $ = (id) => document.getElementById(id);
let owner = null, epoch = 0, searchBusy = false, selectedEmail = '', selectedChannelId = '', disposed = false;
const pending = new Set();
let resultCards = [];
let queryOrigin = 'empty';
let submittedBrief = null;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function link(text, value) {
  const node = el('a', text);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return el('span', text);
    node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer';
  } catch { return el('span', text); }
  return node;
}
function clearDraft() {
  selectedEmail = ''; selectedChannelId = ''; $('subject').value = ''; $('body').value = '';
  $('recipient').textContent = ''; $('draft').hidden = true;
  $('confirm').checked = false; $('open-mail').disabled = true;
  $('mail-status').textContent = '발송된 메일은 없습니다. 이 화면은 자동 발송하지 않습니다.';
}
function clearPrivate() {
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  $('results').replaceChildren(); $('kept-results').replaceChildren(); $('excluded-results').replaceChildren(); $('status').textContent = ''; $('brief').value = ''; $('queries').value = ''; queryOrigin = 'empty'; $('query-origin').textContent = '';
  $('minimum-subscribers').value='0';$('minimum-views').value='0';$('result-order').value='source';
  submittedBrief = null; $('results-purpose').replaceChildren(); $('previous-results-note').textContent = '';
  resultCards = []; $('brief-plan').replaceChildren(); $('result-criteria').replaceChildren(); $('fold-news').checked = true; $('fold-business').checked = false; updateFolds();
  clearDraft(); searchBusy = false; $('search').disabled = false;
}
function sessionChanged(session) {
  const next = session?.user?.id || null;
  if (next !== owner) { clearPrivate(); owner = next; }
  $('workspace').hidden = !owner || disposed;
  const login = el('a', '기존 워크스페이스에서 로그인하세요'); login.href = '../';
  $('auth-state').replaceChildren(owner ? el('span', '워크스페이스 계정 연결됨') : login);
}
function active(ticket) { return !disposed && owner === ticket.owner && epoch === ticket.epoch; }
async function api(path, payload, ticket) {
  const { data, error } = await client.auth.getSession();
  if (!active(ticket)) throw new Error('STALE');
  if (error || !data.session || data.session.user.id !== ticket.owner) {
    sessionChanged(null); throw new Error('STALE');
  }
  const controller = new AbortController(); pending.add(controller);
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/youtube-discovery${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: controller.signal,
    });
    const result = await response.json();
    if (!active(ticket)) throw new Error('STALE');
    if (!response.ok) {
      if (response.status === 401) { sessionChanged(null); throw new Error('STALE'); }
      throw new Error(response.status === 403 ? '워크스페이스 접근 권한이 필요합니다.' : result.error?.message || result.message || (typeof result.error === 'string' && result.error) || `요청 실패 (${response.status})`);
    }
    return result;
  } finally { clearTimeout(timeout); pending.delete(controller); }
}
function errorText(error) {
  return error.name === 'AbortError' ? '요청 시간이 초과되었습니다. 다시 시도해 주세요.' : error.message;
}
function warnings(container, values) {
  if (Array.isArray(values)) for (const value of values) container.append(el('p', value, 'notice'));
}
function showCriteria(container, criteria) {
  container.replaceChildren(); if (!criteria) return;
  container.append(el('h3', '검색 조건과 확인이 필요한 항목'));
  container.append(el('p','공식 API 요청: 검색 최대 2회, 공개 통계·최근 업로드 조회 최대 23회. 검색은 별도 검색 한도, 조회는 일반 할당량을 사용합니다. 호출 횟수는 금전 비용이나 프로젝트 잔여량이 아닙니다. 자동 재시도하지 않습니다.','muted'));
  if(criteria.discoveryIntent){const intent=criteria.discoveryIntent;container.append(el('p', `우선 탐색 분야: ${intent.primaryCategory} · ${intent.secondaryCategories.join(' · ')} / 상품: ${intent.productTerms.join(' · ') || '요청 참조'} / 부가 특성: ${intent.modifiers.join(' · ') || '없음'}`),el('p',intent.explanation));}
  container.append(el('p', `검색 주제: ${(criteria.topicTerms || []).map(term => term.label).join(' · ') || '자동 분류하지 못함'}`));
  container.append(el('p', `검색어: ${(criteria.queries || []).join(' / ') || '직접 입력해 주세요'}`));
  if (criteria.requiresQueryReview || !criteria.queries?.length) container.append(el('p', '검색어 확인이 필요합니다. 조건을 자동 확정하지 않았으므로 검색어를 직접 입력하거나 요청을 명확하게 수정해 주세요.', 'notice'));
  if (criteria.excludedTerms?.length) container.append(el('p', `검색어에서 제외한 표현: ${criteria.excludedTerms.join(' · ')} (후보 자동 탈락 아님)`));
  warnings(container, criteria.unresolvedRequirements); warnings(container, criteria.notes);
}
function updateFolds() {
  const folded = [];
  for (const { card, channel } of resultCards) {
    const reasons = (channel.contentFlags || []).filter(flag => (flag.kind === 'news_language' && $('fold-news').checked) || (flag.kind === 'business_language' && $('fold-business').checked));
    const thresholdReasons = reviewReasons(channel,{minimumSubscribers:Number($('minimum-subscribers').value)||0,minimumViews:Number($('minimum-views').value)||0});
    for(const label of thresholdReasons)reasons.push({label});
    card.hidden = reasons.length > 0;
    if (card.hidden) folded.push(`${channel.title}: ${reasons.map(flag => flag.label).join(' · ')}`);
  }
  for(const row of orderCandidates(resultCards,$('result-order').value))$(row.reviewState==='kept'?'kept-results':row.reviewState==='excluded'?'excluded-results':'results').append(row.card);
  $('review-summary').textContent=`내 검토 상태: 확인 전 ${resultCards.filter(r=>r.reviewState==='pending').length} · 직접 확인 후 남김 ${resultCards.filter(r=>r.reviewState==='kept').length} · 직접 제외 ${resultCards.filter(r=>r.reviewState==='excluded').length}`;
  $('fold-summary').textContent = `표시 필터: ${resultCards.length - folded.length}개 통과 · ${folded.length}개 접힘 (내 검토 상태별 목록)`;
  $('fold-reasons').replaceChildren(...folded.map(reason => el('p', reason)));
  $('show-all').hidden = folded.length === 0;
  $('fold-empty').hidden = resultCards.length === 0 || folded.length !== resultCards.length;
}
function updateQueryNotice() {
  $('query-origin').textContent = queryOrigin === 'manual' ? '직접 입력·수정한 검색어를 우선 사용합니다. 요청을 바꾸어도 유지되므로 새 요청과 맞는지 확인하세요.' : queryOrigin === 'generated' ? '현재 요청으로 만든 검색어 제안입니다. 요청을 바꾸면 이 제안은 지워집니다.' : '';
}
function updatePreviousResultsNotice() {
  $('previous-results-note').textContent = submittedBrief !== null && $('brief').value.trim() !== submittedBrief ? '요청이 변경되었습니다. 아래 결과와 여기서 만드는 초안은 이전 검색의 협업 목적을 기준으로 합니다. 새 목적을 반영하려면 다시 검색하세요.' : '';
}
function briefChanged() {
  updatePreviousResultsNotice();
  $('brief-plan').replaceChildren();
  if (queryOrigin === 'generated') { $('queries').value = ''; queryOrigin = 'empty'; }
  updateQueryNotice();
}
$('preview-queries').addEventListener('click', () => {
  const plan = buildBriefReview($('brief').value);
  if (queryOrigin !== 'manual') {
    $('queries').value = (plan.queries || []).join('\n');
    queryOrigin = $('queries').value ? 'generated' : 'empty';
  }
  updateQueryNotice(); showCriteria($('brief-plan'), plan);
});
$('brief').addEventListener('input', briefChanged);
$('queries').addEventListener('input', () => { queryOrigin = $('queries').value.trim() ? 'manual' : 'empty'; $('brief-plan').replaceChildren(); updateQueryNotice(); });
$('use-30k').addEventListener('click',()=>{$('minimum-subscribers').value='30000';updateFolds();});
for (const id of ['minimum-subscribers','minimum-views','result-order','fold-news', 'fold-business']) $(id).addEventListener('change', updateFolds);
$('show-all').addEventListener('click', () => { $('minimum-subscribers').value='0';$('minimum-views').value='0'; $('fold-news').checked = false; $('fold-business').checked = false; updateFolds(); });
function selectedCandidateExcluded(){return resultCards.some(row=>row.channel.channelId===selectedChannelId&&row.reviewState==='excluded');}
function selectContact(contact, channel, brief) {
  if(resultCards.some(row=>row.channel.channelId===channel.channelId&&row.reviewState==='excluded'))return;
  selectedChannelId=channel.channelId;
  selectedEmail = contact.email;
  $('recipient').replaceChildren(document.createTextNode(`수신자: ${selectedEmail} · ${channel.title} · `), link('직접 확인한 연락처 출처', contact.sourceUrl), el('span', ` · 공개 용도·확인 메모: ${contact.context}`));
  $('subject').value = `[협업 제안] ${channel.title}님께`;
  $('body').value = `안녕하세요, ${channel.title}님.\n\n${channel.videos?.[0]?.title ? `공개된 「${channel.videos[0].title}」 영상과 관련해 협업 가능성을 문의드립니다.` : '협업 가능성을 문의드립니다.'}\n\n${brief}\n\n관심 있으시면 협업 조건을 함께 논의하고 싶습니다.\n\n감사합니다.\n[담당자 이름 / 브랜드 / 연락처]`;
  $('confirm').checked = false; $('open-mail').disabled = true; $('draft').hidden = false;
  $('mail-status').textContent = '발송된 메일은 없습니다. 수신자와 초안 내용을 검토해 주세요.';
  $('draft').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderChannel(channel, ticket) {
  const card = el('article', undefined, 'card');
  const title = el('h2'); title.append(link(channel.title, channel.url)); card.append(title);
  const reviewRow={card,channel,reviewState:'pending'};
  const reviewSelect=el('select');reviewSelect.setAttribute('aria-label',`내 검토 상태: ${channel.title}`);
  for(const [value,label] of [['pending','영상 확인 전'],['kept','사람 중심 영상 직접 확인 · 후보로 남김'],['excluded','직접 검토 제외']]){const option=el('option',label);option.value=value;reviewSelect.append(option);}
  reviewSelect.addEventListener('change',()=>{if(!active(ticket))return;reviewRow.reviewState=reviewSelect.value;choose.disabled=!valid();if(selectedChannelId===channel.channelId){invalidateConfirmation();$('mail-status').textContent=reviewRow.reviewState==='excluded'?'직접 제외한 후보입니다. 초안 내용은 보존했지만 메일 앱 열기는 차단했습니다. 후보 상태를 복원한 뒤 수신자를 다시 확인하세요.':'후보 상태가 변경되었습니다. 수신자와 초안을 다시 확인하세요.';}updateFolds();});
  card.append(el('p','내 검토 상태 (사용자 입력, YouTube 데이터·자동 판정 아님)'),reviewSelect);
  card.append(el('p', `이 결과의 협업 목적: ${ticket.brief}`, 'result-purpose'));
  const focus=channel.fieldEvidence;
  if(focus?.fields?.length){
    const section=el('section',undefined,'field-evidence');section.append(el('h3',`최근 제목에서 탐색 표현 찾기: ${focus.fields.join(' · ')}`),el('p',focus.note));
    section.append(el('p',`표시된 자기소개 일부에서 찾은 표현: ${focus.description.matches.map(m=>m.field+' ('+m.matchedTerms.join(', ')+')').join(' · ')||'미확인'}`));
    if(focus.description.matches.length)section.append(el('p',focus.description.text,'evidence'),link('채널 원문',focus.description.url));
    for(const match of focus.description.matches)if(match.contextWarning)section.append(el('p',match.contextWarning,'notice'));
    if(!focus.uploads.length)section.append(el('p','최근 업로드 원문 미확인. 제목 원문을 확인할 자료가 부족합니다.'));
    for(const video of focus.uploads){const row=el('p');row.append(link(video.title,video.url),document.createTextNode(` · ${video.publishedAt||'게시일 미확인'} · 찾은 표현: ${video.matches.map(m=>m.field+' ('+m.matchedTerms.join(', ')+')').join(' · ')||'미확인'}`));section.append(row);for(const match of video.matches)if(match.contextWarning)section.append(el('p',match.contextWarning,'notice'));}
    card.append(section);
  }
  card.append(el('p', `공개 구독자: ${channel.subscriberCount == null ? '비공개·미확인' : channel.subscriberCount.toLocaleString('ko-KR') + '명 (YouTube 공개 표시 수치, 세 자리 유효숫자로 내림)'}`));
  const recent=el('section');recent.append(el('h3','최근 업로드 최대 5개 · YouTube 공개 조회수'));
  recent.append(el('p','검색어와 무관하게 최신 업로드 목록에서 확인합니다. Shorts·일반 영상·라이브가 섞일 수 있으며 기간이 다른 누적 조회수입니다. 평균·참여율·종합 점수로 환산하지 않습니다.'));
  if(!channel.recentVideos?.length)recent.append(el('p','최근 업로드 지표 미확인'));
  for(const video of channel.recentVideos||[]){const row=el('p');row.append(link(video.title,video.url),document.createTextNode(` · ${video.publishedAt||'게시일 미확인'} · 조회 ${video.viewCount==null?'미확인':video.viewCount.toLocaleString('ko-KR')} · 길이 ${video.duration||'미확인'}`));recent.append(row);}
  card.append(recent);
  card.append(el('p', channel.description || '', 'muted'));
  card.append(el('p', `이 후보를 가져온 검색어 (원문 근거와 별개): ${(channel.matchedQueries || []).join(' / ') || '응답에 없음'}`, 'muted'));
  for (const video of channel.videos || []) { const p = el('p'); p.append(link(video.title, video.url)); card.append(p, el('p', `게시: ${video.publishedAt || '알 수 없음'}`, 'muted'), el('p', video.descriptionPreview || '', 'evidence')); }
  const briefEvidence = el('section', undefined, 'brief-evidence'); briefEvidence.append(el('h3', '공개 문구에서 찾은 근거'));
  if (!channel.evidence?.length) briefEvidence.append(el('p', '이번 검색의 공개 문구에서 연결 근거를 확인하지 못했습니다. 부적합 판정이 아닙니다.'));
  for (const item of channel.evidence || []) {
    const row = el('div', undefined, 'evidence'); row.append(el('strong', `${item.term} · ${item.matchType === 'related_term' ? '관련 표현' : item.matchType === 'alias_term' ? '별칭/번역 표현' : '직접 표현'}: ${item.matchedText}`), el('p', item.excerpt || ''), link(`${item.sourceType || '공개 출처'} 원문`, item.url));
    if (item.contextWarning) row.append(el('p', item.contextWarning, 'notice context-warning'));
    briefEvidence.append(row);
  }
  briefEvidence.append(el('p', channel.evidenceNote || '공개된 제목·설명 일부의 표현 연결이며 실제 협업 적합성을 검증하지 않습니다.', 'muted'));
  if (channel.unconfirmedTerms?.length) briefEvidence.append(el('p', `이번 근거에서 확인되지 않은 주제: ${channel.unconfirmedTerms.map(term => typeof term === 'string' ? term : term.label).join(' · ')}. 미확인은 부적합을 뜻하지 않습니다.`, 'notice'));
  for (const flag of channel.contentFlags || []) {
    const detail = el('details'); detail.append(el('summary', flag.label));
    for (const item of flag.evidence || []) detail.append(el('p', item.excerpt || '', 'evidence'), link(`${item.sourceType || '공개 출처'} 원문`, item.url));
    detail.append(el('p', flag.note || '문구에 따른 검토 보조이며 채널 유형을 확정하지 않습니다.')); briefEvidence.append(detail);
  }
  card.append(briefEvidence);
  warnings(card, channel.reviewRequired);
  card.append(el('p', '수동 검토 필요: 최근 콘텐츠, 광고 이력, 논란·클린 이미지, 시청자 연령, IP·초상 사용권과 브랜드 적합성을 직접 확인하세요. 안전성 검증 완료를 의미하지 않습니다.', 'notice'));
  const manual = el('div', undefined, 'contact');
  manual.append(el('h3', '비즈니스 연락처로 초안 작성'), el('p','연락처 상태: 이 검색에서 이메일을 자동 확보하지 않았습니다. 원문에서 확인한 업무용 주소와 출처를 입력하세요.','notice'), el('p', 'YouTube API를 통한 이메일 자동 수집과 고정 댓글 확인은 지원하지 않습니다. 채널 정보(About)나 공식 웹사이트의 비즈니스 연락처는 직접 확인할 수 있습니다. 공개된 문의 목적을 확인하세요. 공개 이메일이 모든 광고의 수신 동의를 의미하지는 않습니다.', 'notice'));
  const email = el('input'); email.type = 'email'; email.placeholder = '협업 문의용 이메일'; email.maxLength = 254; email.setAttribute('aria-label', '협업 문의용 이메일');
  const source = el('input'); source.type = 'url'; source.placeholder = '연락처 확인 출처 URL'; source.setAttribute('aria-label', '연락처 확인 출처 URL');
  const context = el('textarea'); context.rows = 2; context.maxLength = 500; context.placeholder = '공개 용도·확인 메모 (예: 광고·비즈니스 문의)'; context.setAttribute('aria-label', '공개 용도·확인 메모');
  const consent = el('input'); consent.type = 'checkbox';
  const label = el('label', undefined, 'confirm'); label.append(consent, document.createTextNode(' 협업 문의용으로 공개되었거나 이 목적의 연락에 동의받은 주소이며, 원문과 수신자를 확인했습니다.'));
  const choose = el('button', '입력한 주소로 초안 작성'); choose.disabled = true;
  function valid() {
    let url; try { url = new URL(source.value); } catch { return false; }
    return reviewRow.reviewState!=='excluded' && consent.checked && Boolean(context.value.trim()) && email.validity.valid && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.value) && url.protocol === 'https:' && !url.username && !url.password;
  }
  for (const field of [email, source, context]) field.addEventListener('input', () => { consent.checked = false; choose.disabled = true; clearDraft(); });
  consent.addEventListener('change', () => { choose.disabled = !valid(); if (!consent.checked) clearDraft(); });
  choose.addEventListener('click', () => { if (active(ticket) && valid()) selectContact({ email: email.value.trim(), sourceUrl: source.value, context: context.value.trim() }, channel, ticket.brief); });
  const lookup = el('button', '공식 사이트 업무 연락처 확인');
  const evidence = el('div'); evidence.className = 'business-evidence'; evidence.setAttribute('role', 'status');
  let lookupBusy = false, sourceRevision = 0;
  source.addEventListener('input', () => { sourceRevision++; evidence.replaceChildren(); });
  lookup.addEventListener('click', async () => {
    if (lookupBusy || !active(ticket)) return;
    let url;
    try { url = new URL(source.value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { evidence.replaceChildren(el('p', '자격증명이 없는 HTTPS 원문 URL을 입력하세요.', 'notice')); return; }
    const revision = sourceRevision, requestedSource = source.value;
    const current = () => active(ticket) && revision === sourceRevision && requestedSource === source.value;
    lookupBusy = true; lookup.disabled = true; evidence.replaceChildren(el('p', '공식 사이트 업무 연락처 지원 여부 확인 중…'));
    try {
      const response = await api('/business-contacts', { channelId: channel.channelId, sourceUrl: url.href }, ticket);
      if (!current()) return;
      evidence.replaceChildren(el('p', response.reason || '원문과 업무 용도, 크리에이터 소속을 직접 확인하세요.', 'notice'));
      if (response.status !== 'review_required') {
        evidence.append(link('입력한 원문에서 직접 확인', url.href)); return;
      }
      for (const candidate of response.candidates || []) {
        const item = el('div', undefined, 'evidence');
        item.append(el('strong', candidate.email), el('p', `업무 용도: ${candidate.purpose || '직접 확인 필요'}`), el('p', `수신자: ${candidate.agencyName || '소속사 확인 필요'} · 소속사 업무 수신함 (크리에이터 개인 주소 아님)`), link('업무 연락처 출처', candidate.sourceUrl), el('p', `연락처 확인 시각: ${candidate.observedAt || '알 수 없음'}`));
        item.append(el('p', candidate.affiliation?.excerpt || '소속 근거를 직접 확인하세요.'), link('소속 근거 원문', candidate.affiliation?.url), el('p', `소속 근거 검토일: ${candidate.affiliation?.reviewedAt || '알 수 없음'}`));
        const fill = el('button', '검토용으로 입력');
        fill.addEventListener('click', () => {
          if (!current()) return;
          email.value = String(candidate.email || ''); source.value = String(candidate.sourceUrl || '');
          context.value = `${candidate.purpose || ''} · ${candidate.agencyName || ''} 소속사 업무 수신함. 소속 근거: ${candidate.affiliation?.excerpt || '직접 확인 필요'} (검토일: ${candidate.affiliation?.reviewedAt || '알 수 없음'})`.slice(0, 500);
          consent.checked = false; choose.disabled = true; clearDraft(); sourceRevision++;
          evidence.replaceChildren(el('p', '검토용으로 입력했습니다. 크리에이터 소속, 공개 용도, 원문과 수신자를 직접 확인한 후 체크해 주세요.', 'notice'));
        });
        item.append(fill); evidence.append(item);
      }
    } catch (error) { if (current()) evidence.replaceChildren(el('p', errorText(error), 'notice')); }
    finally { if (active(ticket)) { lookupBusy = false; lookup.disabled = false; } }
  });
  if (/^UC[A-Za-z0-9_-]{22}$/.test(channel.channelId || '')) {
    const aboutUrl = `https://www.youtube.com/channel/${channel.channelId}/about`;
    const useAbout = el('button', '채널 정보 주소를 출처에 입력');
    useAbout.addEventListener('click', () => { if (!active(ticket)) return; source.value = aboutUrl; source.dispatchEvent(new Event('input')); });
    manual.append(link('채널 정보(About)에서 직접 확인', aboutUrl), useAbout, el('p', '주소 입력은 이메일 조회, 원문 열람 또는 연락 동의 확인을 의미하지 않습니다.', 'muted'));
  }
  manual.append(email, source, lookup, evidence, context, label, choose); card.append(manual);
  $('results').append(card); resultCards.push(reviewRow);
}
$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const brief = $('brief').value.trim();
  if (!owner || searchBusy || !brief || disposed) return;
  // Invalidate all previous result handlers without clearing the submitted brief.
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  const ticket = { owner, epoch, brief }; searchBusy = true; $('search').disabled = true;
  $('results').replaceChildren(); $('kept-results').replaceChildren(); $('excluded-results').replaceChildren(); resultCards = []; submittedBrief = null; $('results-purpose').replaceChildren(); updatePreviousResultsNotice(); updateFolds(); $('result-criteria').replaceChildren(); clearDraft(); $('status').textContent = '공개 YouTube 콘텐츠 검색 중…';
  try {
    const queries = $('queries').value.split('\n').map(value => value.trim()).filter(Boolean);
    if (queries.length > 2) throw new Error('검색어는 최대 2개까지 입력해 주세요.');
    const plan = buildBriefReview(brief, queries);
    if (!queries.length && (plan.requiresQueryReview || !plan.queries?.length)) { showCriteria($('brief-plan'), plan); throw new Error('검색어를 직접 확인·입력한 뒤 다시 검색해 주세요.'); }
    const result = await api('/search', { brief, ...(queries.length ? { queries } : {}) }, ticket); if (!active(ticket)) return;
    $('status').textContent = result.channels?.length ? `${result.channels.length}개 채널 · 검색어: ${(result.queries || []).join(' / ')} · API 호출: 검색 ${result.quota?.searchCalls ?? '?'} / 조회 ${result.quota?.readCalls ?? '?'}` : '이번 검색에서 표시할 채널이 없습니다. 검색어를 바꿔 다시 확인해 보세요.';
    submittedBrief = ticket.brief; $('results-purpose').textContent = `이 결과의 협업 목적: ${submittedBrief}`; updatePreviousResultsNotice();
    showCriteria($('result-criteria'), result.criteria);
    $('result-criteria').append(el('p',`공개 지표 조회 시각: ${result.observedAt || '미확인'}`));
    warnings($('results'), result.warnings);
    for (const channel of result.channels || []) renderChannel(channel, ticket);
    updateFolds();
  } catch (error) { if (active(ticket)) $('status').textContent = errorText(error); }
  finally { if (active(ticket)) { searchBusy = false; $('search').disabled = false; } }
});
for (const button of $('samples').querySelectorAll('button')) button.addEventListener('click', () => { $('brief').value = button.textContent; briefChanged(); $('brief').focus(); });
function invalidateConfirmation() { $('confirm').checked = false; $('open-mail').disabled = true; }
$('subject').addEventListener('input', invalidateConfirmation); $('body').addEventListener('input', invalidateConfirmation);
$('confirm').addEventListener('change', () => { $('open-mail').disabled = !$('confirm').checked || !selectedEmail || selectedCandidateExcluded(); });
$('clear-draft').addEventListener('click', clearDraft);
$('open-mail').addEventListener('click', () => {
  if (!owner || disposed || !selectedEmail || !$('confirm').checked || selectedCandidateExcluded()) return;
  const uri = `mailto:${encodeURIComponent(selectedEmail)}?subject=${encodeURIComponent($('subject').value)}&body=${encodeURIComponent($('body').value)}`;
  invalidateConfirmation();
  $('mail-status').textContent = '메일 앱에 초안 열기를 요청했습니다. 이 화면에서 발송된 메일은 없습니다. 메일 앱에서 수신자와 내용을 다시 확인하세요.';
  window.location.href = uri;
});
client.auth.onAuthStateChange((event, session) => { if (!disposed) { if (event === 'SIGNED_OUT') clearPrivate(); sessionChanged(session); } });
const initialEpoch = epoch;
client.auth.getSession().then(({ data, error }) => { if (!disposed && initialEpoch === epoch) { sessionChanged(error ? null : data.session); } });
window.addEventListener('pagehide', () => { disposed = true; clearPrivate(); owner = null; $('workspace').hidden = true; });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
