// supabase/functions/instagram-manual-inbox/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/_shared/instagram-manual-connection.ts
async function connectionRecord({ sb: sb2, query: query2 }, owner, provider) {
  const row = await query2(sb2.from("sanji_connections").select("encrypted").eq("owner", owner).eq("provider", provider).maybeSingle());
  if (!row) return null;
  if (typeof row.encrypted !== "string") throw Error("connection unavailable");
  return row;
}
async function fingerprint(encrypted) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encrypted))), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function readManualConnectionFingerprint(deps, owner, provider) {
  const row = await connectionRecord(deps, owner, provider);
  return row ? fingerprint(row.encrypted) : null;
}
async function readManualConnection(deps, owner, provider) {
  const row = await connectionRecord(deps, owner, provider);
  if (!row) return null;
  const bytes = Uint8Array.from(atob(row.encrypted), (c) => c.charCodeAt(0));
  const decoded = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, await deps.key(), bytes.subarray(12))));
  return { ...decoded, connectionFingerprint: await fingerprint(row.encrypted) };
}

// supabase/functions/_shared/instagram-manual-cursor.ts
var ERROR = "\uC800\uC7A5 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC774\uC5B4\uBCF4\uAE30 \uAE30\uD55C\uC774 \uC9C0\uB0AC\uC2B5\uB2C8\uB2E4. \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.";
var enc = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var digest = async (token) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (x) => x.toString(16).padStart(2, "0")).join("");
function manualCursor(sb2, query2) {
  async function issue(data) {
    const token = enc(crypto.getRandomValues(new Uint8Array(32))), hash = await digest(token), ok = await query2(sb2.rpc("sanji_ig_manual_cursor_issue", { p_owner: data.owner, p_account: data.account, p_kind: data.kind, p_creator: data.creator || null, p_creator_generation: data.creatorGeneration || null, p_hash: hash, p_payload: data }));
    if (ok !== true) throw Error(ERROR);
    return token;
  }
  async function read(token, expected) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error(ERROR);
    const value = await query2(sb2.rpc("sanji_ig_manual_cursor_take", { p_owner: expected.owner, p_account: expected.account, p_kind: expected.kind, p_hash: await digest(token) }));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(ERROR);
    for (const [k, v] of Object.entries(expected)) if (value[k] !== v) throw Error(ERROR);
    return value;
  }
  return { issue, read, error: ERROR };
}

// supabase/functions/_shared/creator-instagram-manual-inbox.ts
var LIMITATION = "\uD68C\uB2F9 \uB300\uD654 1\uAC1C\uC640 \uBA54\uC2DC\uC9C0 \uCD5C\uB300 4\uAC1C\uB97C \uD655\uC778\uD558\uBA70 \uB2E4\uC74C \uBCF4\uAE30\uB97C \uD1B5\uD574 \uC774\uC5B4\uAC11\uB2C8\uB2E4. Meta\uAC00 \uBC18\uD658\uD55C \uBA54\uC2DC\uC9C0 \uD398\uC774\uC9C0\uB97C \uC774\uC5B4\uC11C \uD655\uC778\uD569\uB2C8\uB2E4. Meta\uAC00 \uC81C\uACF5\uD558\uB294 \uBC94\uC704\uB9CC \uD45C\uC2DC\uB429\uB2C8\uB2E4. \uC694\uCCAD\uD568\xB7\uCCA8\uBD80\xB7\uC624\uB798\uB41C \uBA54\uC2DC\uC9C0 \uB610\uB294 \uCD94\uAC00 \uD398\uC774\uC9C0\uAC00 \uB204\uB77D\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4. Instagram\uC5D0\uC11C \uB9C8\uC9C0\uB9C9 \uBC1C\uC2E0 \uC5EC\uBD80\uB97C \uD655\uC778\uD558\uC138\uC694.";
var CURSOR_HISTORY_LIMIT = 100;
var syncCursorPayloadFits = (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 19e3;
var validGeneration = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
var validHandle = (s) => typeof s === "string" && /^[a-z0-9._]{1,30}$/.test(s) && ![".", ".."].includes(s);
function koreanTenDayStart(now = Date.now()) {
  return new Date(Math.floor((now + 9 * 36e5) / 864e5) * 864e5 - 9 * 36e5 - 9 * 864e5).toISOString();
}
function creatorInstagramManualInbox({ sb: sb2, query: query2, connection: connection2, connectionFingerprint: connectionFingerprint2, remote: remote2, env: env2 }) {
  async function account(owner, needToken = false) {
    const rows = await query2(sb2.from("sanji_connections").select("provider,summary").eq("owner", owner).like("provider", "instagram:%"));
    const valid = rows.filter((r) => r.summary?.connected === true && r.summary?.apiVerified === true && String(r.summary?.username || "").toLowerCase() === "valu_est" && r.provider === "instagram:" + r.summary?.accountId && /^\d{1,100}$/.test(String(r.summary?.accountId)));
    if (valid.length !== 1) throw Error("@valu_est \uACF5\uC2DD \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694");
    const id = String(valid[0].summary.accountId);
    if (!needToken) return { id, token: "" };
    const s = await connection2(owner, valid[0].provider);
    if (!s?.access_token || String(s.id) !== id || String(s.username || "").toLowerCase() !== "valu_est" || !Number.isFinite(Number(s.expires)) || Number(s.expires) <= Date.now() || typeof s.connectionFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(s.connectionFingerprint)) throw Error("Instagram \uC5F0\uACB0\uC774 \uB9CC\uB8CC\uB410\uAC70\uB098 \uACC4\uC815\uC774 \uB2E4\uB985\uB2C8\uB2E4");
    return { id, token: s.access_token, fingerprint: s.connectionFingerprint, expires: Number(s.expires) };
  }
  const cursors = manualCursor(sb2, query2);
  async function list(owner, cursor) {
    const a = await account(owner), since = koreanTenDayStart(), v = cursor ? await cursors.read(cursor, { kind: "directory", owner, account: a.id, since }) : null;
    if (v && (!/^\d{1,100}$/.test(v.peer) || !validGeneration(v.creator) || !validGeneration(v.creatorGeneration) || !validGeneration(v.generation))) throw Error(cursors.error);
    const r = await query2(sb2.rpc("sanji_ig_manual_list", { p_owner: owner, p_account: a.id, p_since: since, p_after_peer: v?.peer || null, p_after_creator: v?.creator || null, p_after_generation: v?.generation || null }));
    if (r?.tooMany) throw Error("\uC800\uC7A5\uB41C \uB0B4\uC6A9\uC774 \uD45C\uC2DC \uD55C\uB3C4\uB97C \uCD08\uACFC\uD574 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    if (!r || r.accountValid !== true || r.anchorValid !== true || typeof r.hasMore !== "boolean" || !Array.isArray(r.items) || !Array.isArray(r.draftConversations) || !Array.isArray(r.staleConversations)) throw Error(cursors.error);
    let nextCursor = null;
    if (r.hasMore) {
      const n = r.nextAnchor;
      if (!n || !/^\d{1,100}$/.test(n.peer) || !validGeneration(n.creator) || !validGeneration(n.creatorGeneration) || !validGeneration(n.generation)) throw Error(cursors.error);
      nextCursor = await cursors.issue({ kind: "directory", owner, account: a.id, since, ...n });
    }
    return { items: r.items, draftConversations: r.draftConversations, account: "valu_est", sendingEnabled: false, expiredMatches: r.expiredMatches, staleConversations: r.staleConversations, nextCursor, complete: !r.hasMore, limitation: LIMITATION + " \uD398\uC774\uC9C0 \uC0AC\uC774 \uC0C8 \uD56D\uBAA9\uC740 \uCC98\uC74C\uBD80\uD130 \uC0C8\uB85C\uACE0\uCE68\uD574\uC57C \uBCF4\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4." };
  }
  async function thread(owner, b) {
    if (!b || typeof b.peerId !== "string" || !/^\d{1,100}$/.test(b.peerId) || !validGeneration(b.conversationGeneration)) throw Error(cursors.error);
    const a = await account(owner), since = koreanTenDayStart(), v = b.cursor ? await cursors.read(b.cursor, { kind: "thread", owner, account: a.id, since, peer: b.peerId, generation: b.conversationGeneration }) : null;
    if (v && (!validGeneration(v.creator) || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || typeof v.messageId !== "string" || !v.messageId || v.messageId.length > 500)) throw Error(cursors.error);
    const r = await query2(sb2.rpc("sanji_ig_manual_thread", { p_owner: owner, p_account: a.id, p_since: since, p_peer: b.peerId, p_generation: b.conversationGeneration, p_creator: v?.creator || null, p_before_at: v?.at || null, p_before_id: v?.messageId || null }));
    if (r?.tooMany) throw Error("\uC800\uC7A5\uB41C \uB0B4\uC6A9\uC774 \uD45C\uC2DC \uD55C\uB3C4\uB97C \uCD08\uACFC\uD574 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    if (!r || r.accountValid !== true || r.targetValid !== true || r.anchorValid !== true || typeof r.hasMore !== "boolean" || !Array.isArray(r.items) || !validGeneration(r.creatorId) || !validGeneration(r.creatorGeneration) || !validGeneration(r.conversationRevision) || !validHandle(r.username) || r.conversationGeneration !== b.conversationGeneration || r.peerId !== b.peerId) throw Error(cursors.error);
    let nextCursor = null;
    if (r.hasMore) {
      const n = r.nextAnchor;
      if (!n || typeof n.at !== "string" || !Number.isFinite(Date.parse(n.at)) || typeof n.messageId !== "string" || !n.messageId || n.messageId.length > 500) throw Error(cursors.error);
      nextCursor = await cursors.issue({ kind: "thread", owner, account: a.id, since, peer: b.peerId, generation: b.conversationGeneration, creator: r.creatorId, creatorGeneration: r.creatorGeneration, ...n });
    }
    return { peerId: b.peerId, creatorId: r.creatorId, username: r.username, conversationGeneration: b.conversationGeneration, conversationRevision: r.conversationRevision, items: r.items, draft: r.draft || null, nextCursor, complete: !r.hasMore, limitation: LIMITATION + " \uD398\uC774\uC9C0 \uC0AC\uC774 \uC0C8 \uBA54\uC2DC\uC9C0\uB294 \uC0C8\uB85C\uACE0\uCE68\uD574\uC57C \uBCF4\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4." };
  }
  async function sync(owner, b = {}) {
    let consumed = false;
    try {
      const a = await account(owner, true), version = env2("META_GRAPH_VERSION") || "v24.0";
      if (!/^v\d+\.\d+$/.test(version)) throw Error("invalid version");
      const validCursor = (x) => typeof x === "string" && !x.includes("://") && /^[A-Za-z0-9._~:+\/=-]{1,512}$/.test(x);
      const raw = b?.cursor, since = koreanTenDayStart();
      let providerCursor, threadId, messageCursor, offset = 0, expectedHash = "", resume = null, providerHistory = [], messageHistory = [];
      const validHistory = (h) => Array.isArray(h) && h.length <= CURSOR_HISTORY_LIMIT && h.every((x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x)) && new Set(h).size === h.length;
      const digest2 = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (x) => x.toString(16).padStart(2, "0")).join("");
      if (raw !== void 0) {
        const v = await cursors.read(raw, { kind: "sync", owner, account: a.id, since });
        consumed = true;
        if (!validHistory(v.providerHistory) || !validHistory(v.messageHistory)) throw Error(cursors.error);
        providerHistory = v.providerHistory;
        messageHistory = v.messageHistory;
        if (v.phase === "provider") {
          if (messageHistory.length || !validCursor(v.page)) throw Error(cursors.error);
          providerCursor = v.page;
        } else if (v.phase === "resume") {
          if (v.page !== null && !validCursor(v.page) || typeof v.thread !== "string" || !v.thread || v.thread.length > 500 || !Number.isSafeInteger(v.offset) || v.offset < 0 || v.offset > 996 || v.offset % 4 !== 0 || v.offset === 0 && !validCursor(v.message) || v.message !== null && !validCursor(v.message) || !/^[a-f0-9]{64}$/.test(v.hash) || !/^[a-f0-9]{64}$/.test(v.providerNextHash) || !/^\d{1,100}$/.test(v.peer) || !validGeneration(v.creator) || !validGeneration(v.creatorGeneration) || !validGeneration(v.generation) || !validGeneration(v.syncId)) throw Error(cursors.error);
          providerCursor = v.page || void 0;
          threadId = v.thread;
          messageCursor = v.message || void 0;
          offset = v.offset;
          expectedHash = v.hash;
          resume = v;
        } else throw Error(cursors.error);
        if (providerCursor && !providerHistory.includes(await digest2(providerCursor))) throw Error(cursors.error);
        if (messageCursor && !messageHistory.includes(await digest2(messageCursor))) throw Error(cursors.error);
      }
      let calls = 0;
      const get = async (path, params2, messageEdge = false) => {
        if (++calls > 7) throw Error("provider budget exceeded");
        return remote2("https://graph.instagram.com/" + version + "/" + (path === "me/conversations" && !messageEdge ? path : encodeURIComponent(path) + (messageEdge ? "/messages" : "")) + "?" + new URLSearchParams(params2), { method: "GET", headers: { Authorization: "Bearer " + a.token }, signal: AbortSignal.timeout(3500) }, "Instagram \uB300\uD654 \uC870\uD68C");
      };
      const hashIds = digest2;
      const params = { platform: "instagram", limit: "1", fields: "id,updated_time,participants{id,username}" };
      if (providerCursor) params.after = providerCursor;
      const page = await get("me/conversations", params);
      if (!Array.isArray(page?.data) || page.data.length > 1) throw Error("\uB300\uD654 \uBAA9\uB85D \uD398\uC774\uC9C0 \uD06C\uAE30 \uC624\uB958");
      const more = !!page?.paging?.next, after = page?.paging?.cursors?.after, providerNextHash = await digest2([more, validCursor(after) ? after : null]);
      if (resume && resume.providerNextHash !== providerNextHash) return { processed: 0, matched: 0, unverified: 0, scanned: 0, complete: false, nextCursor: null, limitation: LIMITATION + " Meta \uB300\uD654 \uBAA9\uB85D\uC774 \uC870\uD68C \uC911 \uBCC0\uACBD\uB418\uC5B4 \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uBD88\uC644\uC804\uD569\uB2C8\uB2E4." };
      let nextCursor = null, partial = more && !validCursor(after), processed = 0, matched = 0, unverified = 0, stopReason = "";
      const limitation = () => LIMITATION + (stopReason ? " " + stopReason : "");
      const issueSync = async (value) => {
        if (!syncCursorPayloadFits(value)) {
          partial = true;
          stopReason = "\uD398\uC774\uC9C0 \uC774\uC5B4\uBCF4\uAE30 \uC815\uBCF4\uAC00 \uC800\uC7A5 \uD55C\uB3C4\uB97C \uB118\uC5B4 \uC870\uD68C\uB97C \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uBD88\uC644\uC804\uD569\uB2C8\uB2E4.";
          return null;
        }
        return cursors.issue(value);
      };
      const addCursor = async (value, history) => {
        const hash = await digest2(value);
        if (history.includes(hash)) {
          partial = true;
          stopReason = "Meta \uD398\uC774\uC9C0 \uCEE4\uC11C\uAC00 \uBC18\uBCF5\uB418\uC5B4 \uC870\uD68C\uB97C \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uBD88\uC644\uC804\uD569\uB2C8\uB2E4.";
          return null;
        }
        if (history.length >= CURSOR_HISTORY_LIMIT) {
          partial = true;
          stopReason = "\uC548\uC804\uD55C \uD398\uC774\uC9C0 \uD655\uC778 \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD574 \uC870\uD68C\uB97C \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uBD88\uC644\uC804\uD569\uB2C8\uB2E4.";
          return null;
        }
        return [...history, hash];
      };
      const nextProviderHistory = more && validCursor(after) ? await addCursor(after, providerHistory) : null;
      if (more && validCursor(after) && !nextProviderHistory) return { processed, matched, unverified, scanned: 0, complete: false, nextCursor: null, limitation: limitation() };
      const nextProvider = async () => nextProviderHistory ? await issueSync({ kind: "sync", phase: "provider", owner, account: a.id, since, page: after, providerHistory: nextProviderHistory, messageHistory: [] }) : null;
      const c = page.data[0];
      if (!c) {
        if (threadId || more) throw Error("\uB300\uD654 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified, scanned: 0, complete: true, nextCursor: null, limitation: limitation() };
      }
      if (typeof c.id !== "string" || !c.id || c.id.length > 500 || [".", ".."].includes(c.id) || threadId && c.id !== threadId || !Array.isArray(c.participants?.data) || c.participants.data.length !== 2 || !!c.participants?.paging?.next) {
        if (threadId) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified: 1, scanned: 1, complete: false, nextCursor: await nextProvider(), limitation: limitation() };
      }
      const ps = c.participants.data, own = ps.filter((x) => String(x.id) === a.id), peers = ps.filter((x) => String(x.id) !== a.id);
      if (own.length !== 1 || peers.length !== 1) {
        if (threadId) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified: 1, scanned: 1, complete: false, nextCursor: await nextProvider(), limitation: limitation() };
      }
      const peer = peers[0], peerId = String(peer?.id || ""), username = String(peer?.username || "").toLowerCase(), updated = Date.parse(c.updated_time), start = Date.parse(koreanTenDayStart());
      if (!/^\d{1,100}$/.test(peerId) || !validHandle(username)) {
        if (threadId) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified: 1, scanned: 1, complete: false, nextCursor: await nextProvider(), limitation: limitation() };
      }
      if (Number.isFinite(updated) && updated < start) {
        if (threadId) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified, scanned: 1, complete: !more && !partial, nextCursor: await nextProvider(), limitation: limitation() };
      }
      if (resume && peerId !== resume.peer) throw Error(cursors.error);
      const syncId = crypto.randomUUID(), target = await query2(sb2.rpc("sanji_ig_manual_acquire_target", { p_owner: owner, p_account: a.id, p_peer: peerId, p_username: username, p_conversation: c.id, p_updated: Number.isFinite(updated) ? new Date(updated).toISOString() : null, p_sync: syncId, p_expected_creator: resume?.creator || null, p_expected_creator_generation: resume?.creatorGeneration || null, p_expected_conversation_generation: resume?.generation || null, p_expected_sync: resume?.syncId || null }));
      if (!target) {
        if (threadId) throw Error("\uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        return { processed, matched, unverified: 1, scanned: 1, complete: false, nextCursor: await nextProvider(), limitation: limitation() };
      }
      if (!validGeneration(target.creatorId) || !validGeneration(target.creatorGeneration) || !validGeneration(target.conversationGeneration)) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      matched++;
      const creator = { id: target.creatorId }, creatorGeneration = target.creatorGeneration, generation = target.conversationGeneration;
      const assertConnection = async () => {
        const current = await connectionFingerprint2(owner, "instagram:" + a.id);
        if (!current || current !== a.fingerprint || a.expires <= Date.now()) throw Error("Instagram \uC5F0\uACB0 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      };
      const assertActive = async () => {
        await assertConnection();
        if (!await query2(sb2.rpc("sanji_ig_manual_sync_active", { p_owner: owner, p_account: a.id, p_peer: peerId, p_creator: creator.id, p_creator_generation: creatorGeneration, p_generation: generation, p_sync: syncId }))) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      };
      await assertActive();
      const thread2 = messageCursor ? await get(c.id, { limit: "20", after: messageCursor }, true) : await get(c.id, { fields: "messages" }), messagePage = messageCursor ? thread2 : thread2?.messages, data = messagePage?.data;
      await assertActive();
      if (!Array.isArray(data) || data.length > 1e3) throw Error("\uBA54\uC2DC\uC9C0 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328");
      const limit = data.length, end = Math.min(limit, offset + 4);
      if (offset > limit) throw Error("\uBA54\uC2DC\uC9C0 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      const prefix = data.slice(0, offset).map((x) => x?.id);
      if (prefix.some((x) => typeof x !== "string" || !x || x.length > 500) || threadId && await hashIds(prefix) !== expectedHash) throw Error("\uBA54\uC2DC\uC9C0 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      const nextMessage = messagePage?.paging?.cursors?.after, nextMessageHistory = messagePage?.paging?.next && validCursor(nextMessage) ? await addCursor(nextMessage, messageHistory) : null;
      if (messagePage?.paging?.next && validCursor(nextMessage) && !nextMessageHistory) return { processed, matched, unverified, scanned: 1, complete: false, nextCursor: null, limitation: limitation() };
      let uncertain = !!messagePage?.paging?.next || data.length > 4 || data.length === 0 || offset > 0 || !!messageCursor || !Number.isFinite(updated);
      const observed = [], pending = [];
      for (const m of data.slice(offset, end)) {
        if (typeof m?.id !== "string" || !m.id || m.id.length > 500 || [".", ".."].includes(m.id)) {
          uncertain = true;
          continue;
        }
        await assertActive();
        const d = await get(m.id, { fields: "id,created_time,from,to,message" });
        await assertActive();
        const at = Date.parse(d?.created_time), from = String(d?.from?.id || ""), to = Array.isArray(d?.to?.data) && !d?.to?.paging?.next ? d.to.data.map((x) => String(x.id)) : [], direction = from === peerId && to.length === 1 && to[0] === a.id ? "inbound" : from === a.id && to.length === 1 && to[0] === peerId ? "outbound" : "";
        if (d?.id !== m.id || !direction || !Number.isFinite(at) || at > Date.now() + 3e5 || typeof d.message !== "string" || !d.message.trim() || d.message.length > 1e4) {
          uncertain = true;
          continue;
        }
        observed.push({ at, direction });
        if (at < start || direction !== "inbound") continue;
        pending.push({ id: m.id, at: new Date(at).toISOString(), body: d.message, direction });
      }
      observed.sort((x, y) => y.at - x.at);
      if (observed.length > 1 && observed[0].at === observed[1].at && observed[0].direction !== observed[1].direction) uncertain = true;
      if (Number.isFinite(updated) && (!observed.length || updated > observed[0].at)) uncertain = true;
      if (uncertain) partial = true;
      const last = "review";
      await assertActive();
      const verified = await get(c.id, { fields: "id,updated_time,participants{id,username}" });
      await assertActive();
      const vp = verified?.participants?.data, vu = Date.parse(verified?.updated_time);
      if (verified?.id !== c.id || !Array.isArray(vp) || vp.length !== 2 || !!verified?.participants?.paging?.next || vp.filter((x) => String(x?.id) === a.id).length !== 1 || vp.filter((x) => String(x?.id) === peerId && String(x?.username || "").toLowerCase() === username).length !== 1 || !Number.isFinite(vu) || !Number.isFinite(updated) || vu !== updated) throw Error("\uB300\uD654 \uD655\uC778 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      for (const m of pending) {
        await assertActive();
        const stored = await query2(sb2.rpc("sanji_ig_manual_store_sync", { p_owner: owner, p_account: a.id, p_peer: peerId, p_creator: creator.id, p_creator_generation: creatorGeneration, p_generation: generation, p_sync: syncId, p_mid: m.id, p_at: m.at, p_body: m.body, p_direction: m.direction }));
        if (!stored) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
        processed++;
      }
      await assertActive();
      const finalized = await query2(sb2.from("sanji_ig_manual_conversations").update({ last_direction: last, sync_in_progress: false, provider_updated_at: Number.isFinite(updated) ? new Date(updated).toISOString() : null, checked_at: (/* @__PURE__ */ new Date()).toISOString(), conversation_revision: crypto.randomUUID() }).eq("owner", owner).eq("account_id", a.id).eq("peer_id", peerId).eq("creator_id", creator.id).eq("creator_generation_id", creatorGeneration).eq("generation_id", generation).eq("content_conflict", false).eq("sync_in_progress", true).eq("conversation_id", c.id).eq("sync_id", syncId).select("peer_id"));
      if (!Array.isArray(finalized) || finalized.length !== 1) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      if (end < limit) {
        const ids = data.slice(0, end).map((x) => x?.id);
        if (ids.some((x) => typeof x !== "string" || !x || x.length > 500)) throw Error("\uBA54\uC2DC\uC9C0 \uC2DD\uBCC4\uC790 \uC624\uB958");
        nextCursor = await issueSync({ kind: "sync", phase: "resume", owner, account: a.id, since, page: providerCursor || null, message: messageCursor || null, thread: c.id, offset: end, hash: await hashIds(ids), peer: peerId, creator: creator.id, creatorGeneration, generation, syncId, providerNextHash, providerHistory, messageHistory });
      } else if (messagePage?.paging?.next && data.length === 0) {
        nextCursor = null;
        partial = true;
      } else if (messagePage?.paging?.next) {
        if (nextMessageHistory) nextCursor = await issueSync({ kind: "sync", phase: "resume", owner, account: a.id, since, page: providerCursor || null, message: nextMessage, thread: c.id, offset: 0, hash: await hashIds([]), peer: peerId, creator: creator.id, creatorGeneration, generation, syncId, providerNextHash, providerHistory, messageHistory: nextMessageHistory });
        else {
          nextCursor = null;
          partial = true;
        }
      } else nextCursor = await nextProvider();
      return { processed, matched, unverified, scanned: 1, complete: !nextCursor && !partial && !more, nextCursor, limitation: limitation() };
    } catch (e) {
      if (e?.status === 429) {
        e.retryCursor = null;
        e.restartRequired = consumed;
      }
      throw e;
    }
  }
  async function reverify(owner, b) {
    if (!b || typeof b.peerId !== "string" || !/^\d{1,100}$/.test(b.peerId) || !validGeneration(b.conversationGeneration)) throw Error("\uC0C1\uB300 \uACC4\uC815\uC744 \uD655\uC778\uD558\uC138\uC694");
    const expectedGeneration = b.conversationGeneration;
    const a = await account(owner, true), c = await query2(sb2.from("sanji_ig_manual_conversations").select("peer_id,creator_id,creator_generation_id,username,conversation_id,generation_id,sync_id,provider_updated_at,sync_in_progress").eq("owner", owner).eq("account_id", a.id).eq("peer_id", b.peerId).maybeSingle());
    if (!c || c.sync_in_progress !== false || c.generation_id !== expectedGeneration || !validGeneration(c.creator_generation_id) || typeof c.conversation_id !== "string" || !c.conversation_id || c.conversation_id.length > 500 || [".", ".."].includes(c.conversation_id)) throw Error("\uC77C\uCE58 \uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    const version = env2("META_GRAPH_VERSION") || "v24.0";
    if (!/^v\d+\.\d+$/.test(version)) throw Error("invalid version");
    const check = async () => {
      const current = await connectionFingerprint2(owner, "instagram:" + a.id);
      if (!current || current !== a.fingerprint || a.expires <= Date.now()) throw Error("Instagram \uC5F0\uACB0 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
      if (!await query2(sb2.rpc("sanji_ig_manual_sync_active", { p_owner: owner, p_account: a.id, p_peer: c.peer_id, p_creator: c.creator_id, p_creator_generation: c.creator_generation_id, p_generation: expectedGeneration, p_sync: c.sync_id }))) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
    };
    await check();
    const invalidated = await query2(sb2.from("sanji_ig_manual_conversations").update({ checked_at: "1970-01-01T00:00:00.000Z", conversation_revision: crypto.randomUUID(), last_direction: "review" }).eq("owner", owner).eq("account_id", a.id).eq("peer_id", c.peer_id).eq("creator_id", c.creator_id).eq("creator_generation_id", c.creator_generation_id).eq("generation_id", expectedGeneration).eq("content_conflict", false).eq("sync_in_progress", false).eq("sync_id", c.sync_id).select("peer_id"));
    if (!Array.isArray(invalidated) || invalidated.length !== 1) throw Error("\uB300\uD654 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
    const metadata = await remote2("https://graph.instagram.com/" + version + "/" + encodeURIComponent(c.conversation_id) + "?" + new URLSearchParams({ fields: "id,updated_time,participants{id,username}" }), { method: "GET", headers: { Authorization: "Bearer " + a.token }, signal: AbortSignal.timeout(3500) }, "Instagram \uCC38\uAC00\uC790 \uD655\uC778");
    await check();
    const ps = metadata?.participants?.data;
    if (metadata?.id !== c.conversation_id || !Array.isArray(ps) || ps.length !== 2 || !!metadata?.participants?.paging?.next || ps.filter((x) => String(x?.id) === a.id).length !== 1 || ps.filter((x) => String(x?.id) === c.peer_id && String(x?.username || "").toLowerCase() === c.username).length !== 1) throw Error("\uCC38\uAC00\uC790\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4");
    const updated = Date.parse(metadata.updated_time), previous = Date.parse(c.provider_updated_at);
    if (!Number.isFinite(updated) || !Number.isFinite(previous) || updated !== previous) throw Error("\uC6D0\uBB38 \uBCC0\uACBD \uC5EC\uBD80\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB3D9\uAE30\uD654\uD558\uC138\uC694");
    const rows = await query2(sb2.from("sanji_ig_manual_conversations").update({ provider_updated_at: Number.isFinite(updated) ? new Date(updated).toISOString() : null, checked_at: (/* @__PURE__ */ new Date()).toISOString(), last_direction: "review", sync_id: crypto.randomUUID(), conversation_revision: crypto.randomUUID() }).eq("owner", owner).eq("account_id", a.id).eq("peer_id", c.peer_id).eq("creator_id", c.creator_id).eq("username", c.username).eq("conversation_id", c.conversation_id).eq("generation_id", expectedGeneration).eq("content_conflict", false).eq("sync_in_progress", false).eq("sync_id", c.sync_id).select("peer_id"));
    if (!Array.isArray(rows) || rows.length !== 1) throw Error("\uC77C\uCE58 \uB300\uD654\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
    return { verified: true, conversationGeneration: expectedGeneration };
  }
  async function saveDraft(owner, b) {
    if (!b || !/^\d{1,100}$/.test(String(b.peerId || "")) || typeof b.body !== "string" || b.body.length > 1e4 || !validGeneration(b.conversationGeneration) || !Object.prototype.hasOwnProperty.call(b, "expectedUpdatedAt") || b.expectedUpdatedAt !== null && (typeof b.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(b.expectedUpdatedAt)))) throw Error("\uCD08\uC548 \uB610\uB294 \uBC84\uC804\uC744 \uD655\uC778\uD558\uC138\uC694");
    const a = await account(owner), r = await query2(sb2.rpc("sanji_ig_manual_save_draft", { p_owner: owner, p_account: a.id, p_peer: String(b.peerId), p_generation: b.conversationGeneration, p_body: b.body, p_expected: b.expectedUpdatedAt }));
    if (r?.conflict) throw Error("\uCD08\uC548\uC774 \uB2E4\uB978 \uACF3\uC5D0\uC11C \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uBD88\uB7EC\uC628 \uD6C4 \uC800\uC7A5\uD558\uC138\uC694.");
    return { conversationGeneration: b.conversationGeneration, draft: { body: r.body, updatedAt: r.updatedAt } };
  }
  async function reviewAudit(owner, b) {
    if (!b || typeof b.peerId !== "string" || !/^\d{1,100}$/.test(b.peerId) || !validGeneration(b.creatorId) || !validGeneration(b.conversationGeneration)) throw Error("\uAC80\uC218 \uAE30\uB85D \uB300\uC0C1\uC744 \uD655\uC778\uD558\uC138\uC694");
    const before = b.before;
    if (before !== void 0 && (!before || typeof before.savedAt !== "string" || !Number.isFinite(Date.parse(before.savedAt)) || !validGeneration(before.auditId))) throw Error("\uAC80\uC218 \uAE30\uB85D\uC744 \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694");
    const a = await account(owner), r = await query2(sb2.rpc("sanji_ig_manual_review_audit_list", { p_owner: owner, p_account: a.id, p_peer: b.peerId, p_creator: b.creatorId, p_generation: b.conversationGeneration, p_before: before?.savedAt || null, p_before_id: before?.auditId || null }));
    if (!r || r.targetValid !== true || typeof r.hasMore !== "boolean" || !Array.isArray(r.events) || r.events.length > 20) throw Error("\uAC80\uC218 \uAE30\uB85D\uC744 \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694");
    if (r.hasMore && (!r.nextBefore || typeof r.nextBefore.savedAt !== "string" || !Number.isFinite(Date.parse(r.nextBefore.savedAt)) || !validGeneration(r.nextBefore.auditId))) throw Error("\uAC80\uC218 \uAE30\uB85D\uC744 \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694");
    return { creatorId: b.creatorId, conversationGeneration: b.conversationGeneration, events: r.events, nextBefore: r.hasMore ? r.nextBefore : null, complete: !r.hasMore, limitation: "\uC791\uC5C5\uC790\uC640 \uC6D0\uBCF8 \uD655\uC778 \uC5EC\uBD80\uB294 \uC694\uCCAD\uC790\uC758 \uC790\uAE30\uAE30\uC7AC\uC774\uBA70 \uC2E4\uC81C \uD655\uC778\uC774\uB098 \uAD8C\uD55C\uC758 \uC99D\uBA85\uC774 \uC544\uB2D9\uB2C8\uB2E4." };
  }
  async function saveReviewedDraft(owner, b) {
    if (!b || typeof b.peerId !== "string" || !/^\d{1,100}$/.test(b.peerId) || !validGeneration(b.creatorId) || !validGeneration(b.conversationGeneration) || !validGeneration(b.conversationRevision) || typeof b.body !== "string" || !b.body.trim() || b.body.length > 1e4 || !Object.prototype.hasOwnProperty.call(b, "expectedUpdatedAt") || b.expectedUpdatedAt !== null && (typeof b.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(b.expectedUpdatedAt))) || !["user", "assistant", "other_authorized_worker"].includes(b.reviewerType) || b.sourceCheck !== "self_reported_checked" || b.policyCheck !== "self_reported_checked") throw Error("\uAC80\uC218 \uB0B4\uC6A9\uC744 \uD655\uC778\uD558\uC138\uC694");
    const a = await account(owner), r = await query2(sb2.rpc("sanji_ig_manual_save_reviewed_draft", { p_owner: owner, p_account: a.id, p_peer: b.peerId, p_creator: b.creatorId, p_generation: b.conversationGeneration, p_revision: b.conversationRevision, p_body: b.body, p_expected: b.expectedUpdatedAt, p_reviewer: b.reviewerType, p_source_check: b.sourceCheck, p_policy_check: b.policyCheck }));
    if (!r || r.conflict || typeof r.body !== "string" || typeof r.updatedAt !== "string") throw Error("\uAC80\uC218 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4");
    return { creatorId: b.creatorId, conversationGeneration: b.conversationGeneration, conversationRevision: b.conversationRevision, draft: { body: r.body, updatedAt: r.updatedAt }, reviewRequired: true, limitation: "Instagram \uC6D0\uBB38 \uD655\uC778\uC740 \uC790\uAE30\uAE30\uC7AC\uC774\uBA70 \uCD5C\uC2E0 \uC0C1\uD0DC\uB97C \uBCF4\uC7A5\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  return { list, thread, sync, reverify, saveDraft, saveReviewedDraft, reviewAudit };
}

// supabase/functions/instagram-manual-inbox/handler.ts
function instagramManualInboxHandler({ sb: sb2, query: query2, connection: connection2, connectionFingerprint: connectionFingerprint2, remote: remote2, env: env2, makeInbox = creatorInstagramManualInbox }) {
  const origin = env2("APP_ORIGIN") || "https://dothegy.github.io";
  const allowed = new URL(origin);
  if (allowed.origin !== origin || allowed.protocol !== "https:" || allowed.username || allowed.password) throw Error("invalid origin");
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Vary": "Origin", "Cache-Control": "no-store" };
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const inbox = makeInbox({ sb: sb2, query: query2, connection: connection2, connectionFingerprint: connectionFingerprint2, remote: remote2, env: env2 });
  return async (req) => {
    try {
      if (req.headers.get("origin") && req.headers.get("origin") !== origin) return json({ error: "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98" }, 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const parts = new URL(req.url).pathname.split("/").filter(Boolean), i = parts[0] === "functions" && parts[1] === "v1" ? 2 : 0;
      if (parts[i] !== "instagram-manual-inbox") return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C" }, 404);
      const path = "/" + parts.slice(i + 1).join("/");
      if (path === "/health" && req.method === "GET") return json({ ok: true });
      const authorization = req.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ")) return json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 401);
      const auth = await sb2.auth.getUser(authorization.slice(7)), user = auth?.data?.user;
      if (auth?.error || !user) return json({ error: "\uB85C\uADF8\uC778 \uC138\uC158\uC744 \uD655\uC778\uD558\uC138\uC694." }, 401);
      const member = await query2(sb2.from("sanji_members").select("user_id").eq("user_id", user.id).maybeSingle());
      if (!member) return json({ error: "\uC811\uADFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
      const input = async () => {
        const declared = req.headers.get("content-length");
        if (declared && /^\d+$/.test(declared) && Number(declared) > 65536) {
          req.body?.cancel().catch(() => {
          });
          throw Error("\uC694\uCCAD \uD06C\uAE30 \uCD08\uACFC");
        }
        if (!req.body) return {};
        const reader = req.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
        let raw = "", size = 0;
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              reader.cancel().catch(() => {
              });
              throw Error("\uC694\uCCAD \uD06C\uAE30 \uCD08\uACFC");
            }
            raw += decoder.decode(value, { stream: true });
          }
          raw += decoder.decode();
          return raw ? JSON.parse(raw) : {};
        } finally {
          reader.releaseLock();
        }
      };
      if (path === "/creator-instagram/manual-inbox" && req.method === "POST") {
        try {
          const b = await input();
          return json(await inbox.list(user.id, b.cursor));
        } catch (e) {
          if (e?.message === "\uC800\uC7A5\uB41C \uB0B4\uC6A9\uC774 \uD45C\uC2DC \uD55C\uB3C4\uB97C \uCD08\uACFC\uD574 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.") return json({ error: "\uC800\uC7A5\uB41C \uB0B4\uC6A9\uC774 \uD45C\uC2DC \uD55C\uB3C4\uB97C \uCD08\uACFC\uD574 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }, 409);
          throw e;
        }
      }
      if (path === "/creator-instagram/manual-thread" && req.method === "POST") return json(await inbox.thread(user.id, await input()));
      if (path === "/creator-instagram/manual-sync" && req.method === "POST") return json(await inbox.sync(user.id, await input()));
      if (path === "/creator-instagram/manual-reverify" && req.method === "POST") return json(await inbox.reverify(user.id, await input()));
      if (path === "/creator-instagram/manual-review-audit" && req.method === "POST") return json(await inbox.reviewAudit(user.id, await input()));
      if (path === "/creator-instagram/manual-reviewed-draft" && req.method === "POST") {
        try {
          return json(await inbox.saveReviewedDraft(user.id, await input()));
        } catch {
          return json({ error: "\uAC80\uC218 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB410\uAC70\uB098 \uAE30\uC874 \uCD08\uC548\uC744 \uB36E\uC5B4\uC4F8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC6D0\uBB38\uACFC \uCD08\uC548\uC744 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694." }, 409);
        }
      }
      if (path === "/creator-instagram/manual-draft" && req.method === "POST") {
        try {
          return json(await inbox.saveDraft(user.id, await input()));
        } catch (e) {
          if (e?.status === 429) return json({ error: "Instagram \uC870\uD68C \uC81C\uD55C\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4. \uC790\uB3D9 \uC7AC\uC2DC\uB3C4\uD558\uC9C0 \uB9D0\uACE0 \uB098\uC911\uC5D0 \uD655\uC778\uD558\uC138\uC694.", retryCursor: typeof e.retryCursor === "string" && /^[A-Za-z0-9_-]{43}$/.test(e.retryCursor) ? e.retryCursor : null, restartRequired: e.restartRequired === true, retryAfterSeconds: Number.isInteger(e.retryAfterSeconds) && e.retryAfterSeconds >= 0 && e.retryAfterSeconds <= 86400 ? e.retryAfterSeconds : null }, 429);
          return json({ error: e?.message === "\uCD08\uC548\uC774 \uB2E4\uB978 \uACF3\uC5D0\uC11C \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uBD88\uB7EC\uC628 \uD6C4 \uC800\uC7A5\uD558\uC138\uC694." ? "\uCD08\uC548\uC774 \uB2E4\uB978 \uACF3\uC5D0\uC11C \uBCC0\uACBD\uB410\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uBD88\uB7EC\uC628 \uD6C4 \uC800\uC7A5\uD558\uC138\uC694." : "\uCD08\uC548\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uB300\uD654 \uD655\uC778 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694." }, 409);
        }
      }
      return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C" }, 404);
    } catch (e) {
      if (e?.status === 429) return json({ error: "Instagram \uC870\uD68C \uC81C\uD55C\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4. \uC790\uB3D9 \uC7AC\uC2DC\uB3C4\uD558\uC9C0 \uB9D0\uACE0 \uB098\uC911\uC5D0 \uD655\uC778\uD558\uC138\uC694.", retryCursor: typeof e.retryCursor === "string" && /^[A-Za-z0-9_-]{43}$/.test(e.retryCursor) ? e.retryCursor : null, restartRequired: e.restartRequired === true, retryAfterSeconds: Number.isInteger(e.retryAfterSeconds) && e.retryAfterSeconds >= 0 && e.retryAfterSeconds <= 86400 ? e.retryAfterSeconds : null }, 429);
      return json({ error: e?.message === "\uC800\uC7A5 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC774\uC5B4\uBCF4\uAE30 \uAE30\uD55C\uC774 \uC9C0\uB0AC\uC2B5\uB2C8\uB2E4. \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694." ? "\uC800\uC7A5 \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC774\uC5B4\uBCF4\uAE30 \uAE30\uD55C\uC774 \uC9C0\uB0AC\uC2B5\uB2C8\uB2E4. \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694." : "Instagram \uC694\uCCAD\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uACC4\uC815 \uC5F0\uACB0\uACFC \uC870\uD68C \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694." }, 409);
    }
  };
}

// supabase/functions/instagram-manual-inbox/runtime.ts
var MAX_PROVIDER_BYTES = 1024 * 1024;
function createManualRemote(fetchImpl = fetch) {
  return async (url, options = {}) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.hostname !== "graph.instagram.com" || target.username || target.password || options.method !== "GET") throw Error("invalid provider");
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(3500) });
    if (response.status === 429) {
      const header = response.headers.get("retry-after"), n = header && /^\d{1,5}$/.test(header) ? Number(header) : null;
      throw Object.assign(new Error("provider rate limited"), { status: 429, retryAfterSeconds: n !== null && n <= 86400 ? n : null });
    }
    if (!response.ok) throw Error("provider request failed");
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > MAX_PROVIDER_BYTES) {
      response.body?.cancel().catch(() => {
      });
      throw Error("provider response too large");
    }
    if (!response.body) throw Error("provider response unavailable");
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, text = "";
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PROVIDER_BYTES) {
          reader.cancel().catch(() => {
          });
          throw Error("provider response too large");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } finally {
      reader.releaseLock();
    }
  };
}

// supabase/functions/instagram-manual-inbox/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
async function query(p) {
  const { data, error } = await p;
  if (error) throw Error("database request failed");
  return data;
}
async function key() {
  const secret = env("TOKEN_ENCRYPTION_KEY");
  if (!secret) throw Error("encryption key unavailable");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["decrypt"]);
}
async function connection(owner, provider) {
  return readManualConnection({ sb, query, key }, owner, provider);
}
async function connectionFingerprint(owner, provider) {
  return readManualConnectionFingerprint({ sb, query }, owner, provider);
}
var remote = createManualRemote();
Deno.serve(instagramManualInboxHandler({ sb, query, env, connection, connectionFingerprint, remote }));
