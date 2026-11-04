// A bounded operator observation, never a live Google permission probe.
export const CATALOG_SHEET_PROVENANCE = 'operator_attested_public_read';
export function catalogSheetUrl(value) {
  if (typeof value !== 'string' || value.length > 600) return '';
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.username || u.password || u.port ||
        !/^\/spreadsheets\/d\/[A-Za-z0-9_-]{20,160}\/edit\/?$/.test(u.pathname) ||
        [...u.searchParams].some(([k,v]) => !((k === 'usp' && ['sharing','drive_link'].includes(v)) || (k === 'gid' && /^\d{1,20}$/.test(v)))) ||
        (u.hash && !/^#gid=\d{1,20}$/.test(u.hash))) return '';
    return 'https://docs.google.com' + u.pathname.replace(/\/$/,'');
  } catch { return ''; }
}
export function catalogSheetObservation(input, ownerId, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!['url','observedAt','attested','publicFieldsOnly','verificationMethod'].includes(k)) ||
      typeof ownerId !== 'string' || !ownerId || input.attested !== true || input.publicFieldsOnly !== true || !['owner_sharing_ui','anonymous_read'].includes(input.verificationMethod)) throw Error('공개 읽기와 공개할 자료 범위를 직접 확인해 주세요.');
  const url=catalogSheetUrl(input.url), at=Date.parse(input.observedAt || '');
  if (!url) throw Error('Google 스프레드시트의 편집 링크를 입력해 주세요. 로그인·권한·비밀값 링크는 사용할 수 없습니다.');
  if (typeof input.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.observedAt) || !Number.isFinite(at) || ![new Date(at).toISOString(),new Date(at).toISOString().replace('.000Z','Z')].includes(input.observedAt) || at > now || now-at > 86400000) throw Error('최근 24시간 안에 실제 확인한 시각을 입력해 주세요.');
  return Object.freeze({ownerId,url,access:'anyone_reader',verifiedAt:new Date(at).toISOString(),provenance:CATALOG_SHEET_PROVENANCE,publicFieldsOnly:true,verificationMethod:input.verificationMethod});
}
export function catalogSheetKstTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('실제 확인 시각을 한국시간으로 입력해 주세요.');
  const at=Date.parse(value+':00+09:00');
  if (!Number.isFinite(at) || new Date(at+9*3600000).toISOString().slice(0,16)!==value) throw Error('확인 시각을 다시 확인해 주세요.');
  return new Date(at).toISOString();
}
