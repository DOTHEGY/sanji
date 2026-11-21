export const WEDDING_PROJECT = Object.freeze({
  id: 'private-wedding-research',
});
const uc = /^UC[A-Za-z0-9_-]{22}$/;
const ytHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
export function researchDay(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
}
function url(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch {}
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.port || !ytHosts.has(u.hostname)) throw Error('공식 YouTube 주소를 입력하세요.');
  return u;
}
export function weddingCandidate(owner, input, now = new Date(), projectDay = researchDay(now)) {
  if (typeof owner !== 'string' || !owner) throw Error('로그인이 필요합니다.');
  const name = String(input.name || '').trim(), note = String(input.note || '').trim();
  if (!name || name.length > 100 || !note || note.length > 500) throw Error('채널명과 확인 근거를 입력하세요.');
  if ([name,note].some(s=>/[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}/i.test(s))) throw Error('개인 연락처를 제외해 주세요.');
  const channel = url(input.channelUrl), channelID = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(channel.pathname)?.[1];
  if (channel.hostname === 'youtu.be' || !uc.test(channelID || '')) throw Error('채널 주소는 YouTube /channel/UC… 형식으로 입력하세요.');
  const evidence = url(input.evidenceUrl);
  const videoID = evidence.hostname === 'youtu.be'
    ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(evidence.pathname)?.[1]
    : evidence.pathname === '/watch' ? evidence.searchParams.get('v') : /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(evidence.pathname)?.[1];
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoID || '')) throw Error('확인한 YouTube 영상 주소를 입력하세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(projectDay)||new Date(projectDay+'T00:00:00Z').toISOString().slice(0,10)!==projectDay) throw Error('조사일을 확인할 수 없습니다.');
  const addedAt = now.toISOString();
  return {owner, projectId:WEDDING_PROJECT.id, channelID, videoID, name, note,
    channelUrl:'https://www.youtube.com/channel/'+channelID,
    evidenceUrl:'https://www.youtube.com/watch?v='+videoID, addedAt, projectDay};
}
export function weddingRows(rows, owner, day='') {
  if (!owner) return [];
  return rows.filter(r => r.owner === owner && r.projectId === WEDDING_PROJECT.id && (!day || r.projectDay === day))
    .sort((a,b) => b.projectDay.localeCompare(a.projectDay) || b.addedAt.localeCompare(a.addedAt) || a.channelID.localeCompare(b.channelID));
}
