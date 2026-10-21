import { instagramTokenResponse } from "./instagram-token.ts";
// A short token is accepted only after a successful profile lookup. If its
// expiry is absent, 15 minutes is our local session limit, not a provider claim.
export async function resolveInstagramSession(response: any, request: any, appSecret: string, version: string, time = Date.now()) {
  const token = instagramTokenResponse(response);
  let profile: any, error: any;
  // Both documented profile forms are read-only. Try the unversioned form only
  // for the specific unsupported-method response, never for revoked tokens.
  const paths = [version + "/me", "me"];
  for (const path of paths) {
    try {
      profile = await request("https://graph.instagram.com/" + path + "?" + new URLSearchParams({fields:"user_id,username",access_token:token.access_token}), {}, "Instagram 단기 토큰 계정 검증");
      break;
    } catch (e) {
      error = e;
      if (!String(e?.message || "").includes("Unsupported request - method type: get")) throw e;
    }
  }
  if (!profile) throw error;
  if (!/^\d+$/.test(String(profile.user_id || profile.id || "")) || !profile.username)
    throw new Error("Instagram 계정 ID·이름을 확인할 수 없습니다. 기존 연결은 유지됩니다.");
  try {
    const result = await request("https://graph.instagram.com/access_token?" + new URLSearchParams({grant_type:"ig_exchange_token",client_secret:appSecret,access_token:token.access_token}), {}, "Instagram 장기 토큰 교환");
    const long = instagramTokenResponse(result, true);
    return { ...long, ...profile, id:String(profile.user_id || profile.id), expires:time + Number(long.expires_in)*1000, tokenMode:"long", warning:"", expiryKnown:true };
  } catch (e) {
    const reported = Number(token.expires_in);
    const duration = Number.isFinite(reported) && reported > 0 ? Math.min(reported*1000, 15*60*1000) : 15*60*1000;
    return { ...token, ...profile, id:String(profile.user_id || profile.id), expires:time+duration, tokenMode:"short", expiryKnown:Number.isFinite(reported) && reported > 0,
      warning:"단기 토큰으로 계정 확인은 완료됐지만 장기 인증은 실패했습니다. 서비스 임시 세션은 최대 15분이며 실제 토큰이 먼저 만료될 수 있습니다. 재인증이 필요합니다. " + String(e?.message || "장기 토큰 오류").slice(0,350) };
  }
}
