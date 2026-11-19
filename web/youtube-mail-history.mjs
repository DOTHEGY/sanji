const scheduleLabels = Object.freeze({
  scheduled:'예약됨', processing:'발송 처리 중', complete:'묶음 처리 완료',
  held:'보류 · 남은 건은 자동 재개되지 않음',
  outcome_unknown:'결과 미확인 · 남은 건은 자동 재개되지 않음', cancelled:'취소',
});
const statusLabels = Object.freeze({
  reserved:'예약됨', accepted:'발송 완료 · Gmail 접수', processing:'처리 중',
  held:'보류', outcome_unknown:'결과 미확인', cancelled:'취소', failed:'발송 실패',
  unverified:'상태 확인 필요', bounced:'반송',
});
export const mailHistoryFilters = Object.freeze([
  ['all','전체'], ['reserved','예약됨'], ['accepted','발송 완료'], ['attention','확인 필요'],
]);

export function classifyMailHistoryRow(status, schedule) {
  if (status !== 'reserved') return Object.hasOwn(statusLabels,status) ? status : 'unverified';
  if (schedule?.state === 'scheduled' && formatTime(schedule.runAt)) return 'reserved';
  if (['processing','held','outcome_unknown'].includes(schedule?.state)) return schedule.state;
  return 'unverified';
}

const kstDateTime = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'});
function formatTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? kstDateTime.format(new Date(value))
    : null;
}

export function renderMailHistory({host, batches, filter, el, link, onCancel, offset}) {
  let count=0;
  const groups=[];
  for(const batch of batches) {
    if (!Array.isArray(batch?.rows)) continue;
    const rows=[];
    for (const row of batch.rows) {
      if (typeof row?.email !== 'string' || typeof row.status !== 'string') continue;
      const status=classifyMailHistoryRow(row.status,batch.schedule);
      if (filter !== 'all' && (filter === 'attention' ? ['reserved','accepted'].includes(status) : status !== filter)) continue;
      const line=el('li',undefined,'mail-history-row');
      line.append(el('span',row.email),el('span',statusLabels[status],'mail-history-badge mail-history-'+status));
      if (row.status === 'outcome_unknown' && typeof row.searchUrl === 'string') {
        try {
          const url=new URL(row.searchUrl);
          if(url.origin==='https://mail.google.com'&&!url.username&&!url.password&&url.pathname==='/mail/'&&url.hash.startsWith('#search/')) {
            line.append(link('Gmail에서 메시지 ID 검색',url.href));
          }
        } catch {}
      }
      rows.push(line);
      count++;
    }
    if (!rows.length) continue;
    const group=el('section',undefined,'mail-history-group');
    const runAt=formatTime(batch.schedule?.runAt), createdAt=formatTime(batch.createdAt);
    group.append(el('h4',runAt ? '예약 시각: '+runAt : createdAt ? '묶음 생성 시각: '+createdAt : '묶음 시각 미확인'));
    const state=batch.schedule?.state;
    if (Object.hasOwn(scheduleLabels,state)) group.append(el('p','묶음 상태: '+scheduleLabels[state]));
    const list=el('ul',undefined,'mail-history-list');
    list.append(...rows);
    group.append(list);
    if (filter==='all' && typeof batch.batchId==='string' && batch.rows.some(row=>['reserved','held'].includes(row?.status))) {
      const cancel=el('button','이 묶음의 대기·보류 취소');
      cancel.type='button';
      cancel.addEventListener('click',()=>onCancel(batch.batchId,cancel));
      group.append(cancel);
    }
    groups.push(group);
  }
  host.replaceChildren(el('p',count ? `이 페이지에 표시된 대상 ${count}명` : offset ? '이 페이지에서 조건에 맞는 발송 기록이 없습니다.' : '이 페이지에서 조건에 맞는 최근 발송 기록이 없습니다.'),...groups);
}
