export const oauthLifetimeMs = 30 * 60 * 1000;
export function oauthStateProblem(state: string, row: any, time = Date.now()) {
  if (!state) return "인증 요청 정보(state)가 없습니다. 서비스의 계정 연결 버튼에서 다시 시작하세요.";
  if (!row) return "이미 처리됐거나 유효하지 않은 인증 요청입니다. 연결이 완료됐는지 연동 설정에서 확인하고, 필요하면 새로 연결하세요.";
  if (!Number.isFinite(Date.parse(row.expires)) || Date.parse(row.expires) <= time)
    return "인증 시작 후 30분이 지났습니다. 서비스의 계정 연결 버튼에서 다시 시작하세요.";
  return "";
}
export function oauthErrorPage(message: string, frontend: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>산지 · 계정 연결 확인</title><main style="max-width:560px;margin:10vh auto;padding:24px;font-family:sans-serif;line-height:1.8"><h1>계정 연결을 확인해 주세요</h1><p>' + esc(message) + '</p><p>이 페이지를 새로고침하지 말고, 아래 버튼으로 돌아가 연결 상태를 확인하세요. 기존에 저장된 연결은 유지됩니다.</p><a href="' + esc(frontend + '#settings') + '">서비스 연동 설정으로 돌아가기 →</a></main></html>';
}
