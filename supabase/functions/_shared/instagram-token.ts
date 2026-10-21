// Instagram Login may return either a top-level token or {data:[token]}.
export function instagramTokenResponse(response: any, requireExpiry = false) {
  const token = typeof response?.access_token === "string"
    ? response : Array.isArray(response?.data) ? response.data[0] : null;
  if (!token || typeof token.access_token !== "string" || !token.access_token.trim())
    throw new Error("Instagram 응답에 유효한 토큰이 없습니다. 계정 연결을 다시 시작하세요.");
  if (requireExpiry && (!Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0))
    throw new Error("Instagram 장기 토큰의 유효기간을 확인할 수 없습니다. 기존 연결은 유지됩니다.");
  return token;
}

// Code exchange success is recorded separately from verified API access.
// Persist no access token in this long-lived status record.
export function instagramLoginPending(token: any, detail: string, time = Date.now()) {
  return { connected:false, apiVerified:false, authorizationResponseReceived:true,
    subject:/^\d+$/.test(String(token.user_id||""))?String(token.user_id):"",
    stage:"code_exchanged_profile_pending", checked:new Date(time).toISOString(),
    detail:String(detail||"").slice(0,500) };
}
