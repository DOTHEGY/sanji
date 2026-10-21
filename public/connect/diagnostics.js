export function classifyEdgeResponse(status, data, endpoint) {
  const code = String(data?.code || "");
  const message = String(data?.error || data?.message || "");
  if (
    status === 404 &&
    (code === "NOT_FOUND" || /Requested function was not found/i.test(message))
  )
    return {
      kind: "missing",
      status,
      message: `함수를 찾을 수 없습니다(404). 앱 연결 주소: ${endpoint}. Supabase에 배포된 Function URL의 프로젝트와 함수 이름이 이 주소와 같은지 확인하세요.`,
    };
  if (status === 401 && data?.error === "로그인이 필요합니다.")
    return {
      kind: "routing",
      status,
      message:
        "함수는 실행되지만 상태 확인 경로가 로그인 경로로 처리됐습니다. 이전 코드가 함수 이름을 workspace로 고정한 경우 발생합니다. 기존 bright-function의 코드를 최신 전체 코드로 교체하세요. JWT 설정 오류로 단정할 수 없습니다.",
    };
  if (status === 401)
    return {
      kind: "gateway_auth",
      status,
      message:
        "함수의 공개 상태 확인 요청이 401로 차단됐습니다. Supabase 함수 설정의 Verify JWT / legacy JWT verification을 확인하세요. 이 앱 함수는 내부에서 사용자 로그인을 검증하므로 gateway JWT 검증은 꺼야 합니다.",
    };
  if (status >= 500)
    return {
      kind: "runtime",
      status,
      message: `함수 서버 오류(${status}${code ? ": " + code : ""}). 함수가 시작되지 않았거나 실행 중 실패했습니다. Supabase → Edge Functions → 해당 함수 → Logs의 최신 오류를 확인하세요. 비밀 값은 공유하지 마세요.`,
    };
  if (status === 403)
    return {
      kind: "origin",
      status,
      message:
        "요청 출처가 거부됐습니다(403). 함수 Secrets의 APP_ORIGIN이 https://dothegy.github.io인지 확인하세요. 경로나 마지막 /는 넣지 않습니다.",
    };
  if (status === 200 && data?.ok === true && Number(data?.version) >= 2)
    return {
      kind: "ready",
      status,
      message: `함수 연결 정상 · 버전 ${data.version}. 실제 Gmail·AI·Cron 설정 상태는 로그인 후 연동 설정에서 확인하세요.`,
    };
  return {
    kind: "unexpected",
    status,
    message: `서버는 응답했지만 산지 함수의 상태 응답이 아닙니다(${status}). 기본 Hello World 코드이거나 이전 코드일 수 있습니다. 배포된 함수 코드와 최신 전체 코드를 비교하세요.`,
  };
}
export async function probeEdge(endpoint, fetcher = fetch) {
  try {
    const response = await fetcher(endpoint.replace(/\/$/, "") + "/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    return classifyEdgeResponse(response.status, data, endpoint);
  } catch {
    return {
      kind: "network",
      status: 503,
      message: `브라우저에서 함수 상태 응답을 읽지 못했습니다. 연결 주소: ${endpoint}. 네트워크·CORS·APP_ORIGIN 설정을 확인하세요. 실제 Function URL이 다르면 배포한 URL을 알려주세요.`,
    };
  }
}
