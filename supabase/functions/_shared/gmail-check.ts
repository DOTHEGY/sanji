export async function checkGmail(c: any, request: (url: string, options?: any) => Promise<any>, sendingEnabled: boolean) {
  const profile = await request("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: "Bearer " + c.access_token },
  });
  const info = await request("https://oauth2.googleapis.com/tokeninfo?" + new URLSearchParams({access_token: c.access_token}));
  const scopes = new Set(String(info.scope || "").split(/\s+/));
  return {
    connected: true,
    accountMatches: profile.emailAddress?.toLowerCase() === c.email?.toLowerCase(),
    sendPermission: scopes.has("https://www.googleapis.com/auth/gmail.send"),
    readPermission: scopes.has("https://www.googleapis.com/auth/gmail.readonly"),
    sendingEnabled,
    emailSent: false,
    checkedAt: new Date().toISOString(),
  };
}
