export const oauthLifetimeMs = 30 * 60 * 1000;
export function oauthStateProblem(state: string, row: any, time = Date.now()) {
  if (!state) return "인증 요청 정보(state)가 없습니다. 서비스의 계정 연결 버튼에서 다시 시작하세요.";
  if (!row) return "이미 처리됐거나 유효하지 않은 인증 요청입니다. 연결이 완료됐는지 연동 설정에서 확인하고, 필요하면 새로 연결하세요.";
  if (!Number.isFinite(Date.parse(row.expires)) || Date.parse(row.expires) <= time)
    return "인증 시작 후 30분이 지났습니다. 서비스의 계정 연결 버튼에서 다시 시작하세요.";
  return "";
}
export function oauthErrorRedirect(message: string, frontend: string) {
  const url = new URL(frontend);
  url.searchParams.set("oauth_error", message.slice(0, 500));
  url.hash = "settings";
  return url.toString();
}
export function providerErrorDetail(url: string, options: any, response: any) {
  let message = String(response.error?.message || response.error_description || (typeof response.error === "string" ? response.error : "") || "");
  const secretNames = ["client_secret", "access_token", "refresh_token", "code", "code_verifier"];
  const params = new URL(url).searchParams;
  const body = options.body instanceof URLSearchParams ? options.body : new URLSearchParams();
  for (const name of secretNames) for (const value of [params.get(name), body.get(name)])
    if (value && value.length >= 4) message = message.split(value).join("[redacted]");
  message = message.replace(/https?:\/\/\S+/g, "[provider URL]")
    .replace(/(?:access_token|client_secret|refresh_token|code_verifier)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/[\r\n]/g, " ").slice(0, 240);
  const code = response.error?.code;
  return (Number.isInteger(code) ? "코드 " + code + ": " : "") + message;
}
