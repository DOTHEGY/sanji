import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './supabase-config.js';

// Default Supabase session key matches the main workspace; no new authentication flow.
const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } });
const $ = (id) => document.getElementById(id);
let owner = null, epoch = 0, searchBusy = false, selectedEmail = '', disposed = false;
const pending = new Set();
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
  selectedEmail = ''; $('subject').value = ''; $('body').value = '';
  $('recipient').textContent = ''; $('draft').hidden = true;
  $('confirm').checked = false; $('open-mail').disabled = true;
  $('mail-status').textContent = '발송된 메일은 없습니다. 이 화면은 자동 발송하지 않습니다.';
}
function clearPrivate() {
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  $('results').replaceChildren(); $('status').textContent = ''; $('brief').value = ''; $('queries').value = '';
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
function selectContact(contact, channel) {
  selectedEmail = contact.email;
  $('recipient').replaceChildren(document.createTextNode(`수신자: ${selectedEmail} · ${channel.title} · `), link('직접 확인한 연락처 출처', contact.sourceUrl), el('span', ` · 공개 용도·확인 메모: ${contact.context}`));
  $('subject').value = `[협업 제안] ${channel.title}님께`;
  $('body').value = `안녕하세요, ${channel.title}님.\n\n${$('brief').value.trim()}\n\n채널 콘텐츠를 보고 협업 가능성을 문의드립니다. 관심 있으시면 협업 조건을 함께 논의하고 싶습니다.\n\n감사합니다.\n[담당자 이름 / 브랜드 / 연락처]`;
  $('confirm').checked = false; $('open-mail').disabled = true; $('draft').hidden = false;
  $('mail-status').textContent = '발송된 메일은 없습니다. 수신자와 초안 내용을 검토해 주세요.';
  $('draft').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderChannel(channel, ticket) {
  const card = el('article', undefined, 'card');
  const title = el('h2'); title.append(link(channel.title, channel.url)); card.append(title);
  card.append(el('p', channel.description || '', 'muted'));
  for (const video of channel.videos || []) { const p = el('p'); p.append(link(video.title, video.url)); card.append(p); }
  warnings(card, channel.reviewRequired);
  card.append(el('p', '수동 검토 필요: 최근 콘텐츠, 광고 이력, 논란 및 브랜드 적합성을 직접 확인하세요. 안전성 검증 완료를 의미하지 않습니다.', 'notice'));
  const manual = el('div', undefined, 'contact');
  manual.append(el('h3', '비즈니스 연락처로 초안 작성'), el('p', 'YouTube API를 통한 이메일 자동 수집과 고정 댓글 확인은 지원하지 않습니다. 채널 정보(About)나 공식 웹사이트의 비즈니스 연락처는 직접 확인할 수 있습니다. 공개된 문의 목적을 확인하세요. 공개 이메일이 모든 광고의 수신 동의를 의미하지는 않습니다.', 'notice'));
  const email = el('input'); email.type = 'email'; email.placeholder = '협업 문의용 이메일'; email.maxLength = 254; email.setAttribute('aria-label', '협업 문의용 이메일');
  const source = el('input'); source.type = 'url'; source.placeholder = '연락처 확인 출처 URL'; source.setAttribute('aria-label', '연락처 확인 출처 URL');
  const context = el('textarea'); context.rows = 2; context.maxLength = 500; context.placeholder = '공개 용도·확인 메모 (예: 광고·비즈니스 문의)'; context.setAttribute('aria-label', '공개 용도·확인 메모');
  const consent = el('input'); consent.type = 'checkbox';
  const label = el('label', undefined, 'confirm'); label.append(consent, document.createTextNode(' 협업 문의용으로 공개되었거나 이 목적의 연락에 동의받은 주소이며, 원문과 수신자를 확인했습니다.'));
  const choose = el('button', '입력한 주소로 초안 작성'); choose.disabled = true;
  function valid() {
    let url; try { url = new URL(source.value); } catch { return false; }
    return consent.checked && Boolean(context.value.trim()) && email.validity.valid && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.value) && url.protocol === 'https:' && !url.username && !url.password;
  }
  for (const field of [email, source, context]) field.addEventListener('input', () => { consent.checked = false; choose.disabled = true; clearDraft(); });
  consent.addEventListener('change', () => { choose.disabled = !valid(); if (!consent.checked) clearDraft(); });
  choose.addEventListener('click', () => { if (active(ticket) && valid()) selectContact({ email: email.value.trim(), sourceUrl: source.value, context: context.value.trim() }, channel); });
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
  manual.append(email, source, lookup, evidence, context, label, choose); card.append(manual);
  $('results').append(card);
}
$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const brief = $('brief').value.trim();
  if (!owner || searchBusy || !brief || disposed) return;
  // Invalidate all previous result handlers without clearing the submitted brief.
  epoch++; for (const controller of pending) controller.abort(); pending.clear();
  const ticket = { owner, epoch }; searchBusy = true; $('search').disabled = true;
  $('results').replaceChildren(); clearDraft(); $('status').textContent = '공개 YouTube 콘텐츠 검색 중…';
  try {
    const queries = $('queries').value.split('\n').map(value => value.trim()).filter(Boolean);
    if (queries.length > 2) throw new Error('검색어는 최대 2개까지 입력해 주세요.');
    const result = await api('/search', { brief, ...(queries.length ? { queries } : {}) }, ticket); if (!active(ticket)) return;
    $('status').textContent = result.channels?.length ? `${result.channels.length}개 채널 · 검색어: ${(result.queries || []).join(' / ')} · API 호출: 검색 ${result.quota?.searchCalls ?? '?'} / 조회 ${result.quota?.readCalls ?? '?'}` : '조건에 맞는 채널을 찾지 못했습니다. 주제나 조건을 바꿔 보세요.';
    warnings($('results'), result.warnings);
    for (const channel of result.channels || []) renderChannel(channel, ticket);
  } catch (error) { if (active(ticket)) $('status').textContent = errorText(error); }
  finally { if (active(ticket)) { searchBusy = false; $('search').disabled = false; } }
});
for (const button of $('samples').querySelectorAll('button')) button.addEventListener('click', () => { $('brief').value = button.textContent; $('brief').focus(); });
function invalidateConfirmation() { $('confirm').checked = false; $('open-mail').disabled = true; }
$('subject').addEventListener('input', invalidateConfirmation); $('body').addEventListener('input', invalidateConfirmation);
$('confirm').addEventListener('change', () => { $('open-mail').disabled = !$('confirm').checked || !selectedEmail; });
$('clear-draft').addEventListener('click', clearDraft);
$('open-mail').addEventListener('click', () => {
  if (!owner || disposed || !selectedEmail || !$('confirm').checked) return;
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
