// supabase/functions/instagram-inbox/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { Buffer } from "node:buffer";

// supabase/functions/_shared/instagram-token.ts
function instagramTokenResponse(response, requireExpiry = false) {
  const token = typeof response?.access_token === "string" ? response : Array.isArray(response?.data) ? response.data[0] : null;
  if (!token || typeof token.access_token !== "string" || !token.access_token.trim())
    throw new Error("Instagram \uC751\uB2F5\uC5D0 \uC720\uD6A8\uD55C \uD1A0\uD070\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uACC4\uC815 \uC5F0\uACB0\uC744 \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.");
  if (requireExpiry && (!Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0))
    throw new Error("Instagram \uC7A5\uAE30 \uD1A0\uD070\uC758 \uC720\uD6A8\uAE30\uAC04\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uC5F0\uACB0\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4.");
  return token;
}

// supabase/functions/instagram-inbox/session.ts
function instagramPermissions(value) {
  return Array.isArray(value) ? value.map(String) : String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}
async function instagramProfile(token, request, version) {
  const response = await request("https://graph.instagram.com/" + version + "/me?" + new URLSearchParams({ fields: "user_id,username", access_token: token.access_token }), { method: "GET" }, "Instagram \uACC4\uC815 \uC870\uD68C");
  const profile = Array.isArray(response?.data) && response.data.length === 1 ? response.data[0] : response;
  if (!/^\d+$/.test(String(profile?.user_id || "")) || !profile?.username) throw Error("Instagram \uACC4\uC815 ID\xB7\uC774\uB984\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return { ...profile, id: String(profile.user_id) };
}
async function resolveInstagramSession(response, request, appSecret, version, time = Date.now()) {
  const token = instagramTokenResponse(response);
  let session = token, warning = "", mode = "long";
  try {
    session = instagramTokenResponse(await request("https://graph.instagram.com/access_token?" + new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: token.access_token }), { method: "GET" }, "Instagram \uC7A5\uAE30 \uD1A0\uD070 \uAD50\uD658"), true);
  } catch (e) {
    mode = "short";
    warning = "\uC7A5\uAE30 \uD1A0\uD070 \uAD50\uD658 \uBBF8\uC644\uB8CC \xB7 \uC784\uC2DC \uC138\uC158 \uCD5C\uB300 15\uBD84. " + String(e?.message || "").slice(0, 350);
  }
  const profile = await instagramProfile({ ...token, ...session }, request, version);
  const duration = mode === "long" ? Number(session.expires_in) * 1e3 : Math.min(Number(token.expires_in) > 0 ? Number(token.expires_in) * 1e3 : 9e5, 9e5);
  return { ...token, ...session, ...profile, expires: time + duration, tokenMode: mode, warning, expiryKnown: mode === "long" || Number(token.expires_in) > 0, permissions: instagramPermissions(token.permissions), apiVerified: true, profileChecked: new Date(time).toISOString() };
}

// supabase/functions/_shared/function-route.ts
function functionRoute(requestUrl, projectUrl) {
  const url = new URL(requestUrl), parts = url.pathname.split("/").filter(Boolean);
  const offset = parts[0] === "functions" && parts[1] === "v1" ? 2 : 0;
  const name = parts[offset];
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error("Invalid function route");
  return {
    name,
    path: "/" + parts.slice(offset + 1).join("/"),
    base: projectUrl.replace(/\/$/, "") + "/functions/v1/" + name
  };
}

// supabase/functions/instagram-inbox/oauth.ts
var stages = /* @__PURE__ */ new Set(["state", "short_exchange", "long_exchange", "profile", "account", "save", "capabilities"]);
function fail(stage, cause) {
  const error = Error("Instagram \uC5F0\uACB0\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  error.oauthStage = stages.has(stage) ? stage : "state";
  if (["unsupported_user_id_field", "unsupported_username_field", "unsupported_get_request", "invalid_parameter", "invalid_access_token", "missing_access_token", "invalid_client_secret", "missing_client_secret", "invalid_grant_type", "unsupported_get_method"].includes(cause?.compatibility)) error.compatibility = cause.compatibility;
  if (Number.isSafeInteger(cause?.status) && cause.status >= 100 && cause.status <= 599) error.status = cause.status;
  for (const key2 of ["httpStatus", "metaCode", "metaSubcode"]) {
    const n = cause?.[key2];
    if (Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) error[key2] = n;
  }
  return error;
}
function tokenMeta(value) {
  const item = typeof value?.access_token === "string" ? value : Array.isArray(value?.data) && value.data.length === 1 ? value.data[0] : null;
  const shape = typeof value?.access_token === "string" ? "flat" : item && typeof item.access_token === "string" ? "single_data" : "other";
  const kind = typeof item?.token_type !== "string" ? "missing" : item.token_type.toLowerCase() === "bearer" ? "bearer" : "other";
  return { shape, kind };
}
async function at(stage, fn) {
  try {
    return await fn();
  } catch (e) {
    throw fail(stage, e);
  }
}
function creatorInstagramOauth({ sb: sb2, query: query2, env: env2, key: key2, digest: digest2, encrypt: encrypt2, remote: remote2, resolveSession, capabilities: capabilities2, audit: audit2, oauthStateProblem: oauthStateProblem2, oauthLifetimeMs: oauthLifetimeMs2 }) {
  const provider = "instagram_message_connect", expected = "valu_est";
  async function prepare(owner, base) {
    if (!env2("META_APP_ID") || !env2("META_APP_SECRET")) throw Error("Instagram \uACF5\uC2DD \uC571 \uC124\uC815 \uD655\uC778 \uD544\uC694");
    await key2();
    const state = crypto.randomUUID() + crypto.randomUUID();
    await query2(sb2.from("sanji_oauth_states").insert({ state: await digest2(state), owner, provider, verifier: crypto.randomUUID(), expires: new Date(Date.now() + oauthLifetimeMs2).toISOString() }));
    const params = new URLSearchParams({ enable_fb_login: "false", client_id: env2("META_APP_ID"), redirect_uri: base + "/oauth/instagram/callback", response_type: "code", scope: "instagram_business_basic,instagram_business_manage_messages", state });
    return { url: "https://www.instagram.com/oauth/authorize?" + params, expectedHandle: expected, scopes: ["instagram_business_basic", "instagram_business_manage_messages"], notice: "Meta\uC5D0\uC11C @valu_est\uC640 \uC694\uCCAD \uAD8C\uD55C\uC744 \uD655\uC778\uD55C \uB4A4 \uC9C1\uC811 \uC2B9\uC778\uD558\uC138\uC694. \uC2B9\uC778 \uC804 \uC5F0\uACB0\uC740 \uC0DD\uC131\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." };
  }
  async function callback(url, base, owner) {
    const row = await at("state", async () => {
      const state = url.searchParams.get("state") || "", r = await query2(sb2.from("sanji_oauth_states").select("*").eq("state", await digest2(state)).eq("provider", provider).maybeSingle());
      const problem = oauthStateProblem2(state, r);
      if (problem || !owner || r.owner !== owner) throw Error("invalid state");
      const consumed = await query2(sb2.from("sanji_oauth_states").delete().eq("state", r.state).eq("provider", provider).eq("owner", owner).select("state"));
      if (!consumed.length || !url.searchParams.get("code")) throw Error("invalid state");
      return r;
    });
    const form = new FormData();
    for (const [k, v] of Object.entries({ client_id: env2("META_APP_ID"), client_secret: env2("META_APP_SECRET"), code: url.searchParams.get("code"), grant_type: "authorization_code", redirect_uri: base + "/oauth/instagram/callback" })) form.set(k, String(v));
    let shortMeta = { shape: "other", kind: "missing" }, longMeta = null;
    const token = await at("short_exchange", async () => {
      const raw = await remote2("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }, "Instagram \uACF5\uC2DD \uC778\uC99D");
      shortMeta = tokenMeta(raw);
      return instagramTokenResponse(raw);
    });
    let longFailure = null, longAttempted = false;
    const sessionRemote = async (address, options, label) => {
      const requestUrl = new URL(address), stage = requestUrl.pathname === "/access_token" ? "long_exchange" : "profile";
      const longRequestMeta = stage === "long_exchange" ? { method: options?.method === "GET" ? "GET" : "other", host: requestUrl.hostname === "graph.instagram.com" ? "graph_instagram" : "other", grant_present: !!requestUrl.searchParams.get("grant_type"), secret_present: !!requestUrl.searchParams.get("client_secret"), token_present: !!requestUrl.searchParams.get("access_token") } : null;
      if (stage === "long_exchange") longAttempted = true;
      try {
        const result = await remote2(address, options, label);
        if (stage === "long_exchange") {
          longMeta = tokenMeta(result);
          try {
            instagramTokenResponse(result, true);
          } catch (e) {
            longFailure = fail(stage, e);
            longFailure.failureKind = "invalid_response";
            throw longFailure;
          }
        }
        return result;
      } catch (e) {
        const safe2 = fail(stage, e);
        if (stage === "long_exchange") {
          safe2.failureKind = e?.failureKind === "invalid_response" ? "invalid_response" : "provider_or_network_failure";
          safe2.longRequestMeta = longRequestMeta;
          longFailure = safe2;
        } else if (longAttempted) {
          safe2.profileTokenMode = longFailure ? "short" : "long";
          safe2.shortMeta = shortMeta;
          if (longMeta) safe2.longMeta = longMeta;
          if (longFailure) safe2.previousLongFailure = longFailure;
        }
        throw safe2;
      }
    };
    let session;
    try {
      session = await resolveSession(token, sessionRemote, env2("META_APP_SECRET"), env2("META_GRAPH_VERSION") || "v24.0");
    } catch (e) {
      const safe2 = e?.oauthStage ? e : fail("profile", e);
      if (safe2.oauthStage === "profile" && longAttempted && !safe2.profileTokenMode) {
        safe2.profileTokenMode = longFailure ? "short" : "long";
        safe2.shortMeta = shortMeta;
        if (longMeta) safe2.longMeta = longMeta;
        if (longFailure) safe2.previousLongFailure = longFailure;
      }
      throw safe2;
    }
    if (String(session.username || "").replace(/^@/, "").toLowerCase() !== expected || !/^\d+$/.test(String(session.id || ""))) throw fail("account", null);
    if (session.tokenMode === "short") throw longFailure || fail("long_exchange", null);
    const checked = await at("capabilities", () => capabilities2(session, remote2, env2("META_GRAPH_VERSION") || "v24.0"));
    const safe = { profileVerified: checked.profileVerified === true, messagesReadable: checked.messagesReadable === true, webhookSubscribed: false, webhookSubscriptionStatus: "unverified", checked: checked.checked || null };
    session.capabilities = safe;
    await at("save", async () => {
      await query2(sb2.from("sanji_connections").upsert({ owner: row.owner, provider: "instagram:" + session.id, encrypted: await encrypt2(session), summary: { username: session.username, accountId: session.id, connected: true, apiVerified: true, expires: session.expires || null, tokenMode: session.tokenMode || "long", warning: session.warning || "", expiryKnown: session.expiryKnown !== false, capabilities: safe, profileChecked: session.profileChecked || null, webhookSetupRequested: false } }, { onConflict: "owner,provider" }));
      await audit2(row.owner, "creator_instagram_connected", { username: expected, profileVerified: true, messagesReadable: safe.messagesReadable, webhookSetupRequested: false });
    });
    return { username: expected, messagesReadable: safe.messagesReadable };
  }
  return { prepare, callback };
}

// supabase/functions/_shared/instagram-direct-inbox.ts
function instagramDirectInbox({ sb: sb2, query: query2, connection: connection2, remote: remote2, env: env2 }) {
  async function account(owner) {
    const rows = await query2(sb2.from("sanji_connections").select("provider,summary").eq("owner", owner).like("provider", "instagram:%"));
    const valid = rows.filter((r) => r.summary?.connected === true && r.summary?.apiVerified === true && String(r.summary?.username || "").toLowerCase() === "valu_est" && r.provider === "instagram:" + r.summary?.accountId && /^\d+$/.test(String(r.summary?.accountId)));
    if (valid.length !== 1) throw Error("@valu_est \uACF5\uC2DD \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694");
    const id = String(valid[0].summary.accountId), session = await connection2(owner, valid[0].provider);
    if (!session?.access_token || String(session.id) !== id || String(session.username || "").toLowerCase() !== "valu_est" || !Number.isFinite(Number(session.expires)) || Number(session.expires) <= Date.now()) throw Error("Instagram \uC5F0\uACB0\uC774 \uB9CC\uB8CC\uB410\uAC70\uB098 \uACC4\uC815\uC774 \uB2E4\uB985\uB2C8\uB2E4");
    return { id, token: session.access_token };
  }
  const safePeer = (value) => {
    if (typeof value?.username === "string" && value.username.toLowerCase() === "valu_est") return { username: null, name: null };
    const username = typeof value?.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(value.username) && ![".", ".."].includes(value.username) && value.username.toLowerCase() !== "valu_est" ? value.username : null, name = typeof value?.name === "string" && value.name.trim() && value.name.length <= 100 && !/[\x00-\x1f\x7f]/.test(value.name) ? value.name.trim() : null;
    return { username, name };
  };
  async function observe(owner, accountId, peerId, messageId, value, observedAt) {
    const { username, name } = safePeer(value);
    if (!username && !name) return false;
    return query2(sb2.rpc("sanji_instagram_observe_peer", { p_owner: owner, p_account: accountId, p_peer: peerId, p_mid: messageId, p_username: username, p_name: name, p_observed_at: observedAt }));
  }
  async function capture(owner, e) {
    return query2(sb2.rpc("sanji_instagram_capture", { p_owner: owner, p_account: e.accountId, p_peer: e.peerId, p_mid: e.messageId, p_at: e.receivedAt, p_body: e.text }));
  }
  async function list(owner, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e5) throw Error("\uC798\uBABB\uB41C \uD398\uC774\uC9C0");
    const a = await account(owner);
    const rows = await query2(sb2.from("sanji_instagram_inbound").select("account_id,peer_id,message_id,received_at,body").eq("owner", owner).eq("account_id", a.id).order("received_at", { ascending: false }).order("message_id", { ascending: false }).range(offset, offset + 500));
    if (!Array.isArray(rows)) throw Error("\uB300\uD654 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328");
    const hasMore = rows.length > 500, items = rows.slice(0, 500), ids = items.map((x) => x.message_id);
    const attempts = [];
    for (let i = 0; i < ids.length; i += 20) {
      const page = await query2(sb2.from("sanji_instagram_reply_attempts").select("account_id,peer_id,inbound_id,body,status,created_at").eq("owner", owner).eq("account_id", a.id).in("inbound_id", ids.slice(i, i + 20)));
      if (!Array.isArray(page)) throw Error("\uB2F5\uC7A5 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328");
      attempts.push(...page);
    }
    const peers = [...new Set(items.map((x) => x.peer_id).filter((x) => typeof x === "string" && /^\d+$/.test(x)))], profiles = [];
    for (let i = 0; i < peers.length; i += 50) {
      const page = await query2(sb2.from("sanji_instagram_peer_profiles").select("peer_id,username,username_observed_at,display_name,display_name_observed_at").eq("owner", owner).eq("account_id", a.id).in("peer_id", peers.slice(i, i + 50)));
      if (!Array.isArray(page)) throw Error("\uC0C1\uB300 \uACC4\uC815 \uD655\uC778 \uC2E4\uD328");
      profiles.push(...page);
    }
    const byPeer = new Map(profiles.map((x) => [x.peer_id, x]));
    return { items: items.map((x) => ({ ...x, peerProfile: byPeer.get(x.peer_id) || null })), attempts, offset, hasMore, account: "valu_est", sendingEnabled: env2("INSTAGRAM_DIRECT_REPLY_ENABLED") === "true" };
  }
  async function sync(owner, cursor) {
    let stage = "account", reason = "account_unavailable";
    const cursorKind = cursor === void 0 ? "initial" : typeof cursor === "string" && cursor.startsWith("r1.") ? "resume" : "provider";
    try {
      const a = await account(owner), version = env2("META_GRAPH_VERSION") || "v24.0";
      if (!/^v\d+\.\d+$/.test(version)) throw Error("invalid version");
      stage = "cursor";
      reason = "invalid_cursor";
      const validCursor = (x) => typeof x === "string" && !x.includes("://") && /^[A-Za-z0-9._~:+\/=-]{1,512}$/.test(x);
      let page, offset = 0, threadId, prefix = [];
      if (cursor?.startsWith("r1.")) {
        try {
          const data = JSON.parse(atob(cursor.slice(3).replace(/-/g, "+").replace(/_/g, "/")));
          if (data.page !== null && !validCursor(data.page) || typeof data.thread !== "string" || !data.thread || data.thread.length > 500 || !Number.isSafeInteger(data.offset) || data.offset < 1 || data.offset > 19 || !Array.isArray(data.prefix) || data.prefix.length !== data.offset || data.prefix.some((x) => typeof x !== "string" || !x || x.length > 500)) throw Error("invalid");
          page = data.page || void 0;
          offset = data.offset;
          threadId = data.thread;
          prefix = data.prefix;
        } catch {
          throw Error("\uC798\uBABB\uB41C \uC774\uC5B4\uBCF4\uAE30");
        }
      } else if (cursor !== void 0) {
        if (!validCursor(cursor)) throw Error("\uC798\uBABB\uB41C \uD398\uC774\uC9C0");
        page = cursor;
      }
      const get = async (path, fields) => remote2("https://graph.instagram.com/" + version + "/" + (path === "me/conversations" ? path : encodeURIComponent(path)) + "?" + fields.toString(), { headers: { Authorization: "Bearer " + a.token }, signal: AbortSignal.timeout(3500) }, "Instagram \uB300\uD654 \uC870\uD68C");
      const params = new URLSearchParams({ platform: "instagram", limit: "1" });
      if (page) params.set("after", page);
      stage = "conversations";
      reason = "provider_request";
      const conversations = await get("me/conversations", params);
      reason = "invalid_provider_response";
      if (!Array.isArray(conversations?.data) || conversations.data.length > 1) throw Error("\uB300\uD654 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328");
      reason = "conversation_changed_or_invalid";
      const c = conversations.data[0];
      if (!c) {
        if (offset || conversations?.paging?.next) throw Error("\uD398\uC774\uC9C0\uAC00 \uBCC0\uACBD\uB418\uC5B4 \uB2E4\uC2DC \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4");
        const progress2 = { inputCursorKind: cursorKind, inputResumeOffset: offset, nextCursorKind: "none", hasMore: false, cursorStalled: false, detailsChecked: 0, detailsSkipped: 0, inserted: 0 };
        console.info(JSON.stringify({ event: "instagram_sync_progress", ...progress2 }));
        return { inserted: 0, nextCursor: null, partialMessages: false, progress: progress2 };
      }
      if (typeof c.id !== "string" || !c.id || c.id.length > 500 || threadId && threadId !== c.id) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB418\uC5B4 \uB2E4\uC2DC \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4");
      stage = "thread";
      reason = "provider_request";
      const thread = await get(c.id, new URLSearchParams({ fields: "messages" })), messages = thread?.messages?.data;
      reason = "invalid_provider_response";
      if (!Array.isArray(messages)) throw Error("\uBA54\uC2DC\uC9C0 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328");
      reason = "messages_changed";
      if (prefix.some((id, i) => messages[i]?.id !== id)) throw Error("\uBA54\uC2DC\uC9C0\uAC00 \uBCC0\uACBD\uB418\uC5B4 \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4");
      let inserted = 0, detailsChecked = 0, detailsSkipped = 0, partialMessages = messages.length > 20 || !!thread.messages.paging?.next;
      const end = Math.min(messages.length, 20, offset + 5);
      for (let i = offset; i < end; i++) {
        stage = "detail";
        reason = "invalid_provider_response";
        const m = messages[i];
        if (typeof m?.id !== "string" || !m.id || m.id.length > 500) throw Error("\uBA54\uC2DC\uC9C0 \uC2DD\uBCC4\uC790\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
        reason = "provider_request";
        const observedAt = (/* @__PURE__ */ new Date()).toISOString(), detail = await get(m.id, new URLSearchParams({ fields: "id,created_time,from,to,message" }));
        reason = "invalid_provider_response";
        detailsChecked++;
        const peer = typeof detail.from?.id === "string" ? detail.from.id : "", at2 = Date.parse(detail.created_time), body = typeof detail.message === "string" ? detail.message : "";
        if (detail.id !== m.id || !/^\d+$/.test(peer) || peer === a.id || !detail.to?.data?.some((x) => typeof x.id === "string" && x.id === a.id) || !Number.isFinite(at2) || at2 > Date.now() + 3e5) {
          detailsSkipped++;
          continue;
        }
        if (at2 < Date.now() - 90 * 864e5 || body.length > 1e4) {
          partialMessages = true;
          detailsSkipped++;
          continue;
        }
        if (!body.trim()) {
          const hasAttachmentField = Object.prototype.hasOwnProperty.call(detail, "attachments");
          const observation = { event: "instagram_message_content_observation", message_field_present: Object.prototype.hasOwnProperty.call(detail, "message"), text_present: false, attachment_field_present: hasAttachmentField };
          if (hasAttachmentField && Array.isArray(detail.attachments?.data)) observation.attachment_present = detail.attachments.data.length > 0;
          console.info(JSON.stringify(observation));
        }
        stage = "store";
        reason = "storage_failed";
        if (await capture(owner, { accountId: a.id, peerId: peer, messageId: detail.id, text: body.trim() ? body : "\uBCF8\uBB38 \uC5C6\uC74C \uB610\uB294 \uC870\uD68C \uBD88\uAC00 \xB7 Instagram\uC5D0\uC11C \uD655\uC778 \uD544\uC694", receivedAt: new Date(at2).toISOString() })) inserted++;
        await observe(owner, a.id, peer, detail.id, detail.from, observedAt);
      }
      stage = "pagination";
      reason = "invalid_provider_cursor";
      let nextCursor = null;
      if (end < Math.min(messages.length, 20)) {
        const ids = messages.slice(0, end).map((m) => m?.id);
        if (ids.some((x) => typeof x !== "string" || !x || x.length > 500)) throw Error("\uBA54\uC2DC\uC9C0 \uC2DD\uBCC4\uC790\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
        nextCursor = "r1." + btoa(JSON.stringify({ page: page || null, thread: c.id, offset: end, prefix: ids })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      } else if (conversations?.paging?.next) {
        const after = conversations?.paging?.cursors?.after;
        if (!validCursor(after)) throw Error("\uB2E4\uC74C \uD398\uC774\uC9C0 \uD655\uC778 \uC2E4\uD328");
        nextCursor = after;
      }
      const cursorStalled = !!cursor && nextCursor === cursor;
      if (cursorStalled) nextCursor = null;
      const nextCursorKind = nextCursor ? nextCursor.startsWith("r1.") ? "resume" : "provider" : "none", progress = { inputCursorKind: cursorKind, inputResumeOffset: offset, nextCursorKind, hasMore: !!nextCursor, cursorStalled, detailsChecked, detailsSkipped, inserted };
      console.info(JSON.stringify({ event: "instagram_sync_progress", ...progress }));
      return { inserted, nextCursor, partialMessages, progress };
    } catch (e) {
      const error = Error("Instagram \uC218\uC2E0 \uC870\uD68C\uB97C \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      error.syncStage = stage;
      const source = e;
      error.syncReason = ["TimeoutError", "AbortError"].includes(source?.name) ? "timeout" : reason;
      error.syncCursorKind = cursorKind;
      if (Number.isSafeInteger(source?.status) && source.status >= 100 && source.status <= 599) error.status = source.status;
      for (const key2 of ["httpStatus", "metaCode", "metaSubcode"]) if (Number.isSafeInteger(source?.[key2]) && source[key2] >= 0 && source[key2] <= 2147483647) error[key2] = source[key2];
      throw error;
    }
  }
  async function lookupPeer(owner, peerId) {
    if (typeof peerId !== "string" || !/^\d{1,100}$/.test(peerId)) throw Error("\uC0C1\uB300 \uACC4\uC815\uC744 \uD655\uC778\uD558\uC138\uC694");
    const a = await account(owner);
    if (peerId === a.id) throw Error("\uC0C1\uB300 \uACC4\uC815\uC744 \uD655\uC778\uD558\uC138\uC694");
    const inbound = await query2(sb2.from("sanji_instagram_inbound").select("message_id").eq("owner", owner).eq("account_id", a.id).eq("peer_id", peerId).limit(1));
    if (!Array.isArray(inbound) || !inbound.length || typeof inbound[0]?.message_id !== "string" || !inbound[0].message_id) throw Error("\uD655\uC778\uB41C \uC218\uC2E0 \uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    const version = env2("META_GRAPH_VERSION") || "v24.0";
    if (!/^v\d+\.\d+$/.test(version)) throw Error("invalid version");
    const observedAt = (/* @__PURE__ */ new Date()).toISOString(), profile = await remote2("https://graph.instagram.com/" + version + "/" + encodeURIComponent(peerId) + "?" + new URLSearchParams({ fields: "name,username" }), { method: "GET", headers: { Authorization: "Bearer " + a.token }, signal: AbortSignal.timeout(3500) }, "Instagram \uC0C1\uB300 \uACC4\uC815 \uC870\uD68C");
    if (profile?.id != null && (typeof profile.id !== "string" || profile.id !== peerId)) throw Error("\uC0C1\uB300 \uACC4\uC815\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4");
    const safe = safePeer(profile);
    if (!safe.username && !safe.name) return { found: false };
    const saved = await observe(owner, a.id, peerId, inbound[0].message_id, profile, observedAt);
    return { found: saved === true };
  }
  async function reply(owner, b) {
    if (env2("INSTAGRAM_DIRECT_REPLY_ENABLED") !== "true") throw Error("Instagram \uB2F5\uC7A5 \uBC1C\uC1A1\uC774 \uBE44\uD65C\uC131\uD654\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    if (typeof b.messageId !== "string" || !b.messageId || typeof b.body !== "string" || !b.body.trim() || b.body.length > 1e3 || typeof b.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId)) throw Error("\uB2F5\uC7A5 \uB0B4\uC6A9\uC744 \uD655\uC778\uD558\uC138\uC694.");
    const a = await account(owner), r = await query2(sb2.rpc("sanji_instagram_reserve_reply", { p_owner: owner, p_account: a.id, p_mid: b.messageId, p_request: b.requestId, p_body: b.body }));
    if (!r.reserved) return { status: r.status, duplicate: true, sameRequest: r.sameRequest === true };
    let status = "outcome_unknown", providerId = null;
    try {
      const version = env2("META_GRAPH_VERSION") || "v24.0";
      if (!/^v\d+\.\d+$/.test(version)) throw Error("invalid version");
      const res = await remote2("https://graph.instagram.com/" + version + "/" + a.id + "/messages", { method: "POST", headers: { Authorization: "Bearer " + a.token, "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: r.peerId }, message: { text: b.body } }) }, "Instagram \uB2F5\uC7A5");
      if (typeof res?.message_id === "string" && res.message_id) {
        status = "accepted";
        providerId = res.message_id;
      }
    } catch {
    }
    await query2(sb2.rpc("sanji_instagram_finish_reply", { p_owner: owner, p_request: b.requestId, p_status: status, p_provider_id: providerId }));
    return { status };
  }
  return { list, sync, reply, lookupPeer };
}

// supabase/functions/_shared/oauth-status.ts
var oauthLifetimeMs = 30 * 60 * 1e3;
function oauthStateProblem(state, row, time = Date.now()) {
  if (!state) return "\uC778\uC99D \uC694\uCCAD \uC815\uBCF4(state)\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uC758 \uACC4\uC815 \uC5F0\uACB0 \uBC84\uD2BC\uC5D0\uC11C \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.";
  if (!row) return "\uC774\uBBF8 \uCC98\uB9AC\uB410\uAC70\uB098 \uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uC778\uC99D \uC694\uCCAD\uC785\uB2C8\uB2E4. \uC5F0\uACB0\uC774 \uC644\uB8CC\uB410\uB294\uC9C0 \uC5F0\uB3D9 \uC124\uC815\uC5D0\uC11C \uD655\uC778\uD558\uACE0, \uD544\uC694\uD558\uBA74 \uC0C8\uB85C \uC5F0\uACB0\uD558\uC138\uC694.";
  if (!Number.isFinite(Date.parse(row.expires)) || Date.parse(row.expires) <= time)
    return "\uC778\uC99D \uC2DC\uC791 \uD6C4 30\uBD84\uC774 \uC9C0\uB0AC\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uC758 \uACC4\uC815 \uC5F0\uACB0 \uBC84\uD2BC\uC5D0\uC11C \uB2E4\uC2DC \uC2DC\uC791\uD558\uC138\uC694.";
  return "";
}

// supabase/functions/instagram-inbox/handler.ts
function instagramInboxHandler({ sb: sb2, query: query2, env: env2, key: key2, digest: digest2, encrypt: encrypt2, connection: connection2, remote: remote2, resolveSession, capabilities: capabilities2, audit: audit2 }) {
  const origin = env2("APP_ORIGIN") || "https://dothegy.github.io";
  const frontend = env2("APP_FRONTEND_URL") || origin + "/sanji/workspace/";
  const front = new URL(frontend);
  if (front.origin !== origin || front.protocol !== "https:" || front.username || front.password || front.search || front.hash) throw Error("invalid frontend");
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Vary": "Origin", "Cache-Control": "no-store" };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const oauth = creatorInstagramOauth({ sb: sb2, query: query2, env: env2, key: key2, digest: digest2, encrypt: encrypt2, remote: remote2, resolveSession, capabilities: capabilities2, audit: audit2, oauthStateProblem, oauthLifetimeMs });
  const inbox = instagramDirectInbox({ sb: sb2, query: query2, connection: connection2, remote: remote2, env: env2 });
  return async (req) => {
    try {
      const url = new URL(req.url), { path, base } = functionRoute(req.url, env2("SUPABASE_URL"));
      if (req.headers.get("origin") && req.headers.get("origin") !== origin) return json({ error: "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98" }, 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (path === "/health" && req.method === "GET") return json({ ok: true });
      if (path === "/oauth/instagram/callback") {
        if (req.method !== "GET") return json({ error: "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uC694\uCCAD \uBC29\uC2DD" }, 405);
        const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
        const destination = new URL(frontend);
        if (state && code && state.length <= 256 && code.length <= 4096) destination.hash = "instagram-connect?" + new URLSearchParams({ state, code });
        else {
          destination.searchParams.set("oauth_error", "Instagram \uC5F0\uACB0\uC774 \uCDE8\uC18C\uB418\uC5C8\uAC70\uB098 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
          destination.hash = "creators";
        }
        return new Response(null, { status: 302, headers: { Location: destination.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
      }
      const authorization = req.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ")) return json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 401);
      const auth = await sb2.auth.getUser(authorization.slice(7)), user = auth?.data?.user;
      if (auth?.error || !user) return json({ error: "\uB85C\uADF8\uC778 \uC138\uC158\uC744 \uD655\uC778\uD558\uC138\uC694." }, 401);
      const member = await query2(sb2.from("sanji_members").select("user_id").eq("user_id", user.id).maybeSingle());
      if (!member) return json({ error: "\uC811\uADFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
      const owner = user.id;
      const input = async () => {
        const raw = await req.text();
        if (new TextEncoder().encode(raw).length > 2e4) throw Error("\uC694\uCCAD \uD06C\uAE30 \uCD08\uACFC");
        return raw ? JSON.parse(raw) : {};
      };
      if (path === "/creator-instagram/oauth/prepare" && req.method === "POST") {
        if (!env2("META_APP_ID") || !env2("META_APP_SECRET") || !env2("TOKEN_ENCRYPTION_KEY")) return json({ error: "\uAD00\uB9AC\uC790\uC758 Instagram \uACF5\uC2DD \uC571\uACFC \uC554\uD638\uD654 \uC124\uC815\uC744 \uD655\uC778\uD558\uC138\uC694." }, 503);
        return json(await oauth.prepare(owner, base));
      }
      if (path === "/creator-instagram/oauth/complete" && req.method === "POST") {
        const b = await input();
        if (typeof b.state !== "string" || typeof b.code !== "string" || !b.state || !b.code || b.state.length > 256 || b.code.length > 4096) throw Error("\uC778\uC99D \uC694\uCCAD \uC624\uB958");
        const handoff = new URL(base + "/oauth/instagram/callback");
        handoff.searchParams.set("state", b.state);
        handoff.searchParams.set("code", b.code);
        return json(await oauth.callback(handoff, base, owner));
      }
      if (path === "/creator-instagram/message-status" && req.method === "GET") {
        const rows = await query2(sb2.from("sanji_connections").select("provider,summary").eq("owner", owner).like("provider", "instagram:%"));
        const matches = rows.filter((r) => r.summary?.connected === true && r.summary?.apiVerified === true && String(r.summary?.username || "").toLowerCase() === "valu_est" && r.provider === "instagram:" + r.summary?.accountId);
        const m = matches.length === 1 ? matches[0].summary : null;
        return json({ configured: !!env2("META_APP_ID") && !!env2("META_APP_SECRET") && !!env2("TOKEN_ENCRYPTION_KEY"), expectedHandle: "valu_est", accountMatched: !!m, profileVerified: !!m, messagesReadable: m?.capabilities?.messagesReadable === true, lastChecked: m?.capabilities?.checked || null, officialRoutesEnabled: true, sendEnabled: env2("INSTAGRAM_DIRECT_REPLY_ENABLED") === "true", notice: "\uC800\uC7A5\uB41C \uC5F0\uACB0 \uC0C1\uD0DC\uC785\uB2C8\uB2E4. \uD604\uC7AC \uAD8C\uD55C\uACFC \uB300\uD654\uB294 \uC9C1\uC811 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4." });
      }
      if (path === "/creator-instagram/inbox" && req.method === "GET") {
        const raw = url.searchParams.get("offset") || "0";
        if (!/^(0|[1-9]\d{0,5})$/.test(raw)) throw Error("invalid offset");
        return json(await inbox.list(owner, Number(raw)));
      }
      if (path === "/creator-instagram/sync" && req.method === "POST") {
        const b = await input();
        return json(await inbox.sync(owner, b.cursor));
      }
      if (path === "/creator-instagram/peer-lookup" && req.method === "POST") {
        const b = await input();
        return json(await inbox.lookupPeer(owner, b.peerId));
      }
      if (path === "/creator-instagram/reply" && req.method === "POST") return json(await inbox.reply(owner, await input()));
      return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C" }, 404);
    } catch (e) {
      const safe = e, status = Number(safe?.status), responseStatus = status === 429 ? 429 : status === 401 || status === 403 ? 403 : status >= 500 && status <= 599 ? 503 : 400;
      if (["account", "cursor", "conversations", "thread", "detail", "store", "pagination"].includes(safe?.syncStage) && ["initial", "resume", "provider"].includes(safe?.syncCursorKind) && ["account_unavailable", "invalid_cursor", "provider_request", "invalid_provider_response", "conversation_changed_or_invalid", "messages_changed", "storage_failed", "invalid_provider_cursor", "timeout"].includes(safe?.syncReason)) {
        const event = { event: "instagram_sync_failure", stage: safe.syncStage, reason: safe.syncReason, cursor_kind: safe.syncCursorKind, response_http_status: responseStatus };
        for (const [key3, name] of [["httpStatus", "provider_http_status"], ["metaCode", "meta_code"], ["metaSubcode", "meta_subcode"]]) if (Number.isSafeInteger(safe[key3]) && safe[key3] >= 0 && safe[key3] <= 2147483647) event[name] = safe[key3];
        console.error(JSON.stringify(event));
      }
      if (["state", "short_exchange", "long_exchange", "profile", "account", "save", "capabilities"].includes(safe?.oauthStage)) {
        const record = { event: "instagram_oauth_failure", stage: safe.oauthStage, response_http_status: responseStatus };
        if (safe.oauthStage === "profile") {
          if (["short", "long"].includes(safe.profileTokenMode)) record.profile_token_mode = safe.profileTokenMode;
          for (const [key3, prefix] of [["shortMeta", "short"], ["longMeta", "long"]]) {
            const m = safe[key3];
            if (m && ["flat", "single_data", "other"].includes(m.shape) && ["bearer", "other", "missing"].includes(m.kind)) {
              record[prefix + "_response_shape"] = m.shape;
              record[prefix + "_token_type"] = m.kind;
            }
          }
          const version = env2("META_GRAPH_VERSION") || "v24.0";
          record.profile_api_version = version.length <= 16 && /^v\d+\.\d+$/.test(version) ? version : "invalid_version";
          const previous = safe.previousLongFailure;
          if (previous && ["invalid_response", "provider_or_network_failure"].includes(previous.failureKind)) {
            record.long_exchange_failure_kind = previous.failureKind;
            const request = previous.longRequestMeta;
            if (request && ["GET", "other"].includes(request.method) && ["graph_instagram", "other"].includes(request.host)) {
              record.long_exchange_method = request.method;
              record.long_exchange_host = request.host;
              for (const k of ["grant_present", "secret_present", "token_present"]) if (typeof request[k] === "boolean") record["long_exchange_" + k] = request[k];
            }
            if (["invalid_access_token", "missing_access_token", "invalid_client_secret", "missing_client_secret", "invalid_grant_type", "unsupported_get_method", "invalid_parameter"].includes(previous.compatibility)) record.long_exchange_error_kind = previous.compatibility;
            for (const [key3, name] of [["httpStatus", "long_exchange_http_status"], ["metaCode", "long_exchange_meta_code"], ["metaSubcode", "long_exchange_meta_subcode"]]) if (Number.isSafeInteger(previous[key3]) && previous[key3] >= 0 && previous[key3] <= 2147483647) record[name] = previous[key3];
          }
          record.profile_request = "versioned_me_user_id_username";
          record.profile_version = !env2("META_GRAPH_VERSION") || env2("META_GRAPH_VERSION") === "v24.0" ? "v24_default_or_configured" : "configured_other";
          if (["unsupported_user_id_field", "unsupported_username_field", "unsupported_get_request", "invalid_parameter"].includes(safe.compatibility)) record.profile_error_kind = safe.compatibility;
        }
        if (safe.oauthStage === "long_exchange") {
          const request = safe.longRequestMeta;
          if (request && ["GET", "other"].includes(request.method) && ["graph_instagram", "other"].includes(request.host)) {
            record.long_exchange_method = request.method;
            record.long_exchange_host = request.host;
            for (const k of ["grant_present", "secret_present", "token_present"]) if (typeof request[k] === "boolean") record["long_exchange_" + k] = request[k];
          }
        }
        if (safe.oauthStage === "long_exchange" && ["invalid_access_token", "missing_access_token", "invalid_client_secret", "missing_client_secret", "invalid_grant_type", "unsupported_get_method", "invalid_parameter"].includes(safe.compatibility)) record.long_exchange_error_kind = safe.compatibility;
        for (const [key3, name] of [["httpStatus", "http_status"], ["metaCode", "meta_code"], ["metaSubcode", "meta_subcode"]]) if (Number.isSafeInteger(safe[key3]) && safe[key3] >= 0 && safe[key3] <= 2147483647) record[name] = safe[key3];
        console.error(JSON.stringify(record));
      }
      if (status === 429) return json({ error: "Meta \uC694\uCCAD \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uC9C1\uC811 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694." }, 429);
      if (status === 401 || status === 403) return json({ error: "Meta \uACC4\uC815 \uC5F0\uACB0 \uB610\uB294 \uBA54\uC2DC\uC9C0 \uAD8C\uD55C\uC744 \uD655\uC778\uD558\uC138\uC694." }, 403);
      if (status >= 500 && status <= 599) return json({ error: "Meta \uC11C\uBE44\uC2A4\uAC00 \uC77C\uC2DC\uC801\uC73C\uB85C \uC751\uB2F5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uC9C1\uC811 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694." }, 503);
      if (["messages_changed", "conversation_changed_or_invalid", "invalid_cursor", "invalid_provider_cursor"].includes(safe?.syncReason)) return json({ error: "\uB300\uD654 \uBAA9\uB85D\uC774 \uBC14\uB00C\uC5C8\uAC70\uB098 \uC774\uC5B4\uBCF4\uAE30 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. Instagram \uC218\uC2E0 \uD655\uC778\uC744 \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uB20C\uB7EC\uC8FC\uC138\uC694." }, 400);
      return json({ error: "Instagram \uC694\uCCAD\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uACC4\uC815 \uC5F0\uACB0\uACFC \uAD8C\uD55C\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
    }
  };
}

// supabase/functions/instagram-inbox/meta-compatibility.ts
function metaCompatibility(data) {
  const e = data?.error && typeof data.error === "object" ? data.error : data;
  const message = typeof e?.message === "string" ? e.message : e?.error_message;
  if (e?.code !== 100 || typeof message !== "string") return null;
  const s = message.slice(0, 300);
  if (/^\s*(?:\(#100\)\s*)?tried accessing nonexisting field\s*\(user_id\)\s+on node type\b/i.test(s)) return "unsupported_user_id_field";
  if (/^\s*(?:\(#100\)\s*)?tried accessing nonexisting field\s*\(username\)\s+on node type\b/i.test(s)) return "unsupported_username_field";
  if (/^\s*(?:\(#100\)\s*)?unsupported get request\b/i.test(s)) return "unsupported_get_request";
  if (/^\s*(?:\(#100\)\s*)?(?:unsupported (?:request )?method\s*:?\s*get|unsupported request\s*-\s*method type\s*:\s*get)\b/i.test(s)) return "unsupported_get_method";
  if (/^\s*(?:\(#100\)\s*)?invalid (?:oauth )?access[_ ]token\b/i.test(s) || /^\s*(?:\(#100\)\s*)?error validating access token\b/i.test(s)) return "invalid_access_token";
  if (/^\s*(?:\(#100\)\s*)?(?:missing (?:required )?access[_ ]token|access[_ ]token (?:is )?required)\b/i.test(s)) return "missing_access_token";
  if (/^\s*(?:\(#100\)\s*)?invalid client[_ ]secret\b/i.test(s)) return "invalid_client_secret";
  if (/^\s*(?:\(#100\)\s*)?(?:missing (?:required )?client[_ ]secret|client[_ ]secret (?:is )?required)\b/i.test(s)) return "missing_client_secret";
  if (/^\s*(?:\(#100\)\s*)?invalid grant[_ ]type\b/i.test(s)) return "invalid_grant_type";
  if (/^\s*(?:\(#100\)\s*)?invalid (?:parameter|argument)\b/i.test(s)) return "invalid_parameter";
  return null;
}

// supabase/functions/instagram-inbox/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
async function query(p) {
  const { data, error } = await p;
  if (error) throw Error("database request failed");
  return data;
}
var digest = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
async function key() {
  const secret = env("TOKEN_ENCRYPTION_KEY");
  if (!secret) throw Error("encryption key unavailable");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  return Buffer.concat([Buffer.from(iv), Buffer.from(bytes)]).toString("base64");
}
async function decrypt(value) {
  const b = Buffer.from(value, "base64");
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await key(), b.subarray(12))));
}
async function connection(owner, provider) {
  const r = await query(sb.from("sanji_connections").select("encrypted").eq("owner", owner).eq("provider", provider).maybeSingle());
  return r ? decrypt(r.encrypted) : null;
}
async function remote(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["graph.instagram.com", "api.instagram.com"].includes(target.hostname) || target.username || target.password) throw Error("invalid provider");
  const response = await fetch(url, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(2e4) });
  if (!response.ok) {
    const failure = Error("provider request failed");
    failure.status = response.status;
    failure.httpStatus = response.status;
    try {
      const data = await response.json();
      const compatibility = metaCompatibility(data);
      if (compatibility) failure.compatibility = compatibility;
      for (const [source, target2] of [["code", "metaCode"], ["error_subcode", "metaSubcode"]]) {
        const n = data?.error?.[source] ?? data?.[source];
        if (Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) failure[target2] = n;
      }
    } catch {
    }
    throw failure;
  }
  return response.json();
}
async function capabilities(session, request, version) {
  try {
    await request("https://graph.instagram.com/" + version + "/me/conversations?platform=instagram&limit=1", { headers: { Authorization: "Bearer " + session.access_token } });
    return { profileVerified: true, messagesReadable: true, checked: (/* @__PURE__ */ new Date()).toISOString() };
  } catch {
    return { profileVerified: true, messagesReadable: false, checked: (/* @__PURE__ */ new Date()).toISOString() };
  }
}
async function audit(owner, action, data) {
  await query(sb.from("sanji_audit").insert({ owner, action, data }));
}
Deno.serve(instagramInboxHandler({ sb, query, env, key, digest, encrypt, connection, remote, resolveSession: resolveInstagramSession, capabilities, audit }));
