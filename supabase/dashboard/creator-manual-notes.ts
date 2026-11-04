// supabase/functions/creator-manual-notes/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/creator-manual-notes/handler.ts
var ManualNoteError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
  status;
  code;
};
var invalid = (message = "\uC218\uB3D9 \uBA54\uBAA8 \uC785\uB825\uC744 \uD655\uC778\uD558\uC138\uC694.") => new ManualNoteError(400, "INVALID_NOTE", message);
var validUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}
function handle(value) {
  if (typeof value !== "string") throw invalid();
  const result = value.replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(result) || [".", ".."].includes(result)) throw invalid("\uD06C\uB9AC\uC5D0\uC774\uD130 \uC544\uC774\uB514\uB97C \uD655\uC778\uD558\uC138\uC694.");
  return result;
}
function noteText(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim() || value.includes("\0")) throw invalid();
  return value;
}
function validateManualNote(body, now = Date.now()) {
  keys(body, ["noteId", "creatorId", "handle", "observedAt", "sourceUrl", "inboundWhen", "summary", "draft", "intent", "afterInboundOutbound", "recorderType", "supersedesId"]);
  if (!validUuid(body.noteId) || !validUuid(body.creatorId) || body.supersedesId != null && !validUuid(body.supersedesId) || body.supersedesId === body.noteId) throw invalid();
  const observedAt = noteText(body.observedAt, 40, true);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(observedAt);
  const full = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(observedAt);
  const parsed = Date.parse(observedAt);
  const calendar = /* @__PURE__ */ new Date(observedAt.slice(0, 10) + "T00:00:00.000Z");
  if (!dateOnly && !full || !Number.isFinite(parsed) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== observedAt.slice(0, 10) || Number(observedAt.slice(0, 4)) < 2e3 || parsed > now) throw invalid("\uC2E4\uC81C\uB85C \uD655\uC778\uD55C \uACFC\uAC70 \uB0A0\uC9DC\uB098 \uC2DC\uAC01\uC744 \uC785\uB825\uD558\uC138\uC694.");
  let source;
  try {
    source = new URL(body.sourceUrl);
  } catch {
    throw invalid("\uD655\uC778\uD55C Instagram \uC6D0\uBB38 \uB300\uD654 \uC8FC\uC18C\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  }
  if (typeof body.sourceUrl !== "string" || source.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(source.hostname) || source.port || source.username || source.password || source.search || source.hash || !/^\/direct\/t\/\d{1,100}\/?$/.test(source.pathname)) throw invalid("\uD655\uC778\uD55C Instagram \uC6D0\uBB38 \uB300\uD654 \uC8FC\uC18C\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  if (!["user", "assistant", "other_authorized_worker"].includes(body.recorderType)) throw invalid();
  return {
    noteId: body.noteId.toLowerCase(),
    creatorId: body.creatorId.toLowerCase(),
    handle: handle(body.handle),
    supersedesId: body.supersedesId?.toLowerCase() || null,
    payload: { observedAt, sourceUrl: source.toString(), inboundWhen: noteText(body.inboundWhen ?? "", 500), summary: noteText(body.summary, 4e3, true), draft: noteText(body.draft ?? "", 5e3), intent: noteText(body.intent ?? "", 500), afterInboundOutbound: noteText(body.afterInboundOutbound ?? "", 500), recorderType: body.recorderType }
  };
}
function publicManualNote(row) {
  if (!row || !validUuid(row.note_id) || !validUuid(row.creator_id) || typeof row.handle !== "string" || !object(row.payload) || !Number.isFinite(Date.parse(row.recorded_at))) throw new ManualNoteError(503, "NOTE_READ_FAILED", "\uC218\uB3D9 \uBA54\uBAA8\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  const p = row.payload;
  return { id: row.note_id, creatorId: row.creator_id, handle: row.handle, recordedAt: row.recorded_at, supersedesId: row.supersedes_id || null, observedAt: p.observedAt, sourceUrl: p.sourceUrl, inboundWhen: p.inboundWhen, summary: p.summary, draft: p.draft, intent: p.intent, afterInboundOutbound: p.afterInboundOutbound, recorderType: p.recorderType, recordType: "manual_historical_note", latestVerified: false, dispatchState: "not_sent" };
}
var publicTopics = /* @__PURE__ */ new Set(["travel", "drone_photography", "travel_sponsorships", "packaged_vegetable_drink", "parenting", "household_bath", "food_easy_meals", "restaurants", "home_interior", "home_cafe", "dining", "household_lifestyle", "beauty", "fashion", "fitness", "pets", "outdoors", "baking", "coffee", "food", "lifestyle", "photography"]);
function publicProfile(value, target) {
  if (typeof value !== "string" || value.length > 200) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash && u.pathname.replace(/\/$/, "").toLowerCase() === "/" + target;
  } catch {
    return false;
  }
}
function publicText(value, max) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return "";
  if (/(?:password|access[ _-]?token|refresh[ _-]?token|api[ _-]?key|client[ _-]?secret|authorization\s*:|bearer\s+)/i.test(value)) return "";
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "").trim();
}
function storedPublicResearch(row, owner, target, now) {
  if (!object(row) || row.owner !== owner || row.attested_by !== owner || row.handle !== target || row.revoked_at !== null || !publicProfile(row.profile_url, target)) return null;
  const at = typeof row.observed_at === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(row.observed_at) ? Date.parse(row.observed_at) : NaN;
  const calendar = Number.isFinite(at) ? /* @__PURE__ */ new Date(row.observed_at.slice(0, 10) + "T00:00:00Z") : null;
  if (!Number.isFinite(at) || !calendar || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== row.observed_at.slice(0, 10) || at > now || !/^[a-f0-9]{64}$/.test(row.capture_sha256 || "") || !Array.isArray(row.topics) || !row.topics.length || row.topics.length > 10 || row.topics.some((v) => typeof v !== "string" || !publicTopics.has(v)) || !Array.isArray(row.sources) || !row.sources.length || row.sources.length > 10) return null;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (row.sources.some((value) => {
    if (typeof value !== "string" || value.length > 300) return true;
    try {
      const u = new URL(value);
      return u.protocol !== "https:" || u.hostname !== "www.instagram.com" || !!u.port || !!u.username || !!u.password || !!u.search || !!u.hash || !new RegExp("^/" + escaped + "/(?:p|reel)/[A-Za-z0-9_-]{1,100}/?$", "i").test(u.pathname);
    } catch {
      return true;
    }
  })) return null;
  return { profileUrl: row.profile_url, observedAt: row.observed_at, topics: [...new Set(row.topics)], sources: [...new Set(row.sources)], captureSha256: row.capture_sha256, provenance: "operator_attested", researchStatus: now - at > 7 * 864e5 ? "historical" : "current_observation_record" };
}
function noteRecordedRank(value) {
  const m = typeof value === "string" && /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|([+-])(\d\d):(\d\d))$/.exec(value);
  const day = m && /* @__PURE__ */ new Date(m[1] + "T00:00:00Z");
  if (!m || !day || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== m[1] || +m[2] > 23 || +m[3] > 59 || +m[4] > 59 || m[8] && (+m[8] > 14 || +m[9] > 59 || +m[8] === 14 && +m[9] !== 0)) return null;
  const millis = Date.parse(m[1] + "T" + m[2] + ":" + m[3] + ":" + m[4] + m[6]);
  return Number.isFinite(millis) ? BigInt(millis) * 1000000n + BigInt((m[5] || "").padEnd(9, "0")) : null;
}
function contextCorrectionPath(rows, owner, body) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) return null;
  const byId = /* @__PURE__ */ new Map(), children = /* @__PURE__ */ new Map();
  for (const n of rows) {
    if (!object(n) || n.owner !== owner || n.creator_id !== body.creatorId || n.handle !== body.handle || !validUuid(n.note_id) || n.note_id !== n.note_id.toLowerCase() || byId.has(n.note_id) || n.supersedes_id !== null && (!validUuid(n.supersedes_id) || n.supersedes_id !== n.supersedes_id.toLowerCase())) return null;
    byId.set(n.note_id, n);
    if (n.supersedes_id !== null) {
      const siblings = children.get(n.supersedes_id) || [];
      siblings.push(n);
      children.set(n.supersedes_id, siblings);
    }
  }
  const path = [], seen = /* @__PURE__ */ new Set();
  let id = body.noteId, expectedChild = null;
  for (let depth = 0; depth < 32; depth++) {
    const n = byId.get(id), rank = n && noteRecordedRank(n.recorded_at);
    if (!n || rank === null || rank === void 0 || seen.has(id)) return null;
    const descendants = children.get(id) || [];
    if (expectedChild === null ? descendants.length !== 0 : descendants.length !== 1 || descendants[0].note_id !== expectedChild.note_id || rank > noteRecordedRank(expectedChild.recorded_at)) return null;
    seen.add(id);
    path.push({ owner: n.owner, noteId: n.note_id, creatorId: n.creator_id, handle: n.handle, supersedesId: n.supersedes_id, recordedAt: n.recorded_at });
    if (n.supersedes_id === null) return path;
    expectedChild = n;
    id = n.supersedes_id;
  }
  return null;
}
async function readInput(req, maxBytes = 65536) {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await req.body?.cancel().catch(() => {
    });
    throw new ManualNoteError(413, "INPUT_TOO_LARGE", "\uBA54\uBAA8 \uC785\uB825 \uD06C\uAE30\uB97C \uC904\uC5EC \uC8FC\uC138\uC694.");
  }
  if (!req.body) return {};
  const reader = req.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "", size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {
        });
        throw new ManualNoteError(413, "INPUT_TOO_LARGE", "\uBA54\uBAA8 \uC785\uB825 \uD06C\uAE30\uB97C \uC904\uC5EC \uC8FC\uC138\uC694.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw invalid();
    }
  } finally {
    reader.releaseLock();
  }
}
function creatorManualNotesHandler({ sb: sb2, env: env2, now = () => Date.now() }) {
  const origin = env2("APP_ORIGIN") || "https://dothegy.github.io";
  const configured = new URL(origin);
  if (configured.origin !== origin || configured.protocol !== "https:" || configured.username || configured.password) throw Error("invalid origin");
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", Vary: "Origin", "Cache-Control": "no-store" };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const query = async (request) => {
    const { data, error } = await request;
    if (error) throw new ManualNoteError(503, "NOTE_STORAGE_UNAVAILABLE", "\uC218\uB3D9 \uBA54\uBAA8 \uC800\uC7A5\uC18C\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC785\uB825\uC744 \uBCF4\uC874\uD55C \uB4A4 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
    return data;
  };
  return async (req) => {
    try {
      if (req.headers.get("origin") && req.headers.get("origin") !== origin) throw new ManualNoteError(403, "ORIGIN_DENIED", "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98\uC785\uB2C8\uB2E4.");
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const parts = new URL(req.url).pathname.split("/").filter(Boolean), offset = parts[0] === "functions" && parts[1] === "v1" ? 2 : 0;
      if (parts[offset] !== "creator-manual-notes") return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C\uC785\uB2C8\uB2E4." }, 404);
      const path = "/" + parts.slice(offset + 1).join("/");
      if (path === "/health" && req.method === "GET") return json({ ok: true, capability: "manual_historical_notes", sendingEnabled: false });
      if (req.method !== "POST" || !["/creator-manual-notes/targets", "/creator-manual-notes/list", "/creator-manual-notes/save", "/creator-manual-notes/context"].includes(path)) return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C\uC785\uB2C8\uB2E4." }, 404);
      const authorization = req.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ") || !authorization.slice(7)) throw new ManualNoteError(401, "AUTH_REQUIRED", "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
      const auth = await sb2.auth.getUser(authorization.slice(7)), user = auth?.data?.user;
      if (auth?.error || !user || !validUuid(user.id)) throw new ManualNoteError(401, "AUTH_REQUIRED", "\uB85C\uADF8\uC778 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.");
      const member = await query(sb2.from("sanji_members").select("user_id").eq("user_id", user.id).maybeSingle());
      if (!member || member.user_id !== user.id) throw new ManualNoteError(403, "MEMBERSHIP_REQUIRED", "\uC811\uADFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const owner = user.id, body = await readInput(req, path.endsWith("/context") ? 1024 : 65536);
      if (path.endsWith("/context")) {
        keys(body, ["noteId", "creatorId", "handle"]);
        if (!validUuid(body.noteId) || !validUuid(body.creatorId) || body.noteId !== body.noteId.toLowerCase() || body.creatorId !== body.creatorId.toLowerCase() || body.handle !== handle(body.handle)) throw invalid();
        const unavailable = () => new ManualNoteError(404, "CONTEXT_UNAVAILABLE", "\uC800\uC7A5\uB41C \uBA54\uBAA8\uC640 \uD06C\uB9AC\uC5D0\uC774\uD130\uB97C \uC815\uD655\uD788 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
        const gate = async () => {
          const metadata = await sb2.from("sanji_creator_manual_notes").select("owner,note_id,creator_id,handle,supersedes_id,recorded_at", { count: "exact" }).eq("owner", owner).eq("creator_id", body.creatorId).order("note_id", { ascending: true }).limit(201);
          if (metadata.error) throw new ManualNoteError(503, "NOTE_STORAGE_UNAVAILABLE", "\uC218\uB3D9 \uBA54\uBAA8 \uC800\uC7A5\uC18C\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC785\uB825\uC744 \uBCF4\uC874\uD55C \uB4A4 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
          if (!Number.isSafeInteger(metadata.count) || metadata.count < 1 || metadata.count > 200 || !Array.isArray(metadata.data) || metadata.data.length !== metadata.count) throw unavailable();
          const chain = contextCorrectionPath(metadata.data, owner, body);
          if (!chain) throw unavailable();
          const rows2 = await query(sb2.from("sanji_creator_recovery").select("owner,id,handle,nickname,bio,category,profile_url,link_status,last_verified,entity_type,assessment,status").eq("owner", owner).ilike("handle", body.handle.replace(/[\\%_]/g, "\\$&")).limit(2));
          const c = Array.isArray(rows2) && rows2.length === 1 ? rows2[0] : null;
          if (!c || c.owner !== owner || c.id !== body.creatorId || c.handle !== body.handle || c.entity_type !== "creator_evidence" || !["candidate", "explore", "review"].includes(c.assessment) || !["new", "hold", "contacted"].includes(c.status) || c.link_status !== "source_confirmed" || !publicProfile(c.profile_url, body.handle)) throw unavailable();
          return { creator: c, chain };
        };
        const initial = await gate(), creator = initial.creator;
        const readResearch = async () => {
          const rows2 = await query(sb2.from("sanji_instagram_public_research").select("owner,attested_by,handle,profile_url,observed_at,topics,sources,capture_sha256,revoked_at").eq("owner", owner).eq("handle", body.handle).is("revoked_at", null).order("observed_at", { ascending: false }).limit(2));
          if (!Array.isArray(rows2)) throw unavailable();
          return rows2;
        };
        const rows = await readResearch();
        const latest = await gate();
        if (JSON.stringify(initial) !== JSON.stringify(latest)) throw unavailable();
        const latestResearch = await readResearch();
        if (JSON.stringify(rows) !== JSON.stringify(latestResearch)) throw unavailable();
        const research = rows.length && !(rows.length > 1 && rows[0]?.observed_at === rows[1]?.observed_at) ? storedPublicResearch(rows[0], owner, body.handle, now()) : null;
        return json({ matched: true, noteId: body.noteId, creator: { id: creator.id, handle: creator.handle, nickname: publicText(creator.nickname, 200), bio: publicText(creator.bio, 4e3), category: publicText(creator.category, 1e3), profileUrl: creator.profile_url, lastVerified: typeof creator.last_verified === "string" && Number.isFinite(Date.parse(creator.last_verified)) && Date.parse(creator.last_verified) <= now() ? creator.last_verified : null, publicResearch: research, status: creator.status, assessment: creator.assessment } });
      }
      if (path.endsWith("/targets")) {
        keys(body, ["handle"]);
        const targetHandle = handle(body.handle);
        const rows = await query(sb2.from("sanji_creator_recovery").select("id,handle,nickname,profile_url,entity_type,assessment,status").eq("owner", owner).ilike("handle", targetHandle.replace(/[\\%_]/g, "\\$&")).limit(2));
        const target = rows?.length === 1 ? rows[0] : null;
        if (!target || handle(target.handle) !== targetHandle || target.entity_type !== "creator_evidence" || !target.assessment || !target.status || target.assessment === "excluded" || target.status === "excluded") throw new ManualNoteError(404, "TARGET_UNAVAILABLE", "\uC77C\uCE58\uD558\uB294 \uAE30\uC874 \uD06C\uB9AC\uC5D0\uC774\uD130\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
        return json({ target: { creatorId: target.id, handle: targetHandle, displayName: target.nickname || targetHandle, profileUrl: target.profile_url || "" } });
      }
      if (path.endsWith("/list")) {
        keys(body, ["creatorId", "noteId", "before"]);
        if (body.creatorId !== void 0 && !validUuid(body.creatorId) || body.noteId !== void 0 && !validUuid(body.noteId)) throw invalid();
        if (body.noteId !== void 0 && body.before !== void 0) throw invalid();
        let before = null;
        if (body.before !== void 0) {
          keys(body.before, ["recordedAt", "id"]);
          if (!validUuid(body.before.id) || typeof body.before.recordedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|\+00:00)$/.test(body.before.recordedAt) || !Number.isFinite(Date.parse(body.before.recordedAt))) throw invalid();
          before = body.before;
        }
        let request = sb2.from("sanji_creator_manual_notes").select("note_id,creator_id,handle,payload,recorded_at,supersedes_id").eq("owner", owner);
        if (body.creatorId !== void 0) request = request.eq("creator_id", body.creatorId);
        if (body.noteId !== void 0) request = request.eq("note_id", body.noteId);
        if (before) request = request.or("recorded_at.lt." + before.recordedAt + ",and(recorded_at.eq." + before.recordedAt + ",note_id.lt." + before.id + ")");
        const rows = await query(request.order("recorded_at", { ascending: false }).order("note_id", { ascending: false }).limit(21));
        if (!Array.isArray(rows)) throw new ManualNoteError(503, "NOTE_READ_FAILED", "\uC218\uB3D9 \uBA54\uBAA8\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        const items = rows.slice(0, 20).map(publicManualNote), last = items[items.length - 1];
        return json({ items, nextBefore: rows.length > 20 ? { recordedAt: last.recordedAt, id: last.id } : null, complete: rows.length <= 20 });
      }
      const value = validateManualNote(body, now());
      const result = await sb2.rpc("sanji_creator_manual_note_save", { p_owner: owner, p_creator: value.creatorId, p_handle: value.handle, p_note: value.noteId, p_payload: value.payload, p_supersedes: value.supersedesId });
      if (result.error) {
        if (["22023", "23503", "23505", "40001", "P0001"].includes(result.error.code)) throw new ManualNoteError(409, "NOTE_CONFLICT", "\uB300\uC0C1\uC774\uB098 \uAC19\uC740 \uBA54\uBAA8\uC758 \uC800\uC7A5 \uB0B4\uC6A9\uC774 \uB2EC\uB77C\uC84C\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uBA54\uBAA8\uB97C \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
        if (result.error.code === "42501") throw new ManualNoteError(403, "MEMBERSHIP_REQUIRED", "\uC811\uADFC \uAD8C\uD55C\uC744 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
        throw new ManualNoteError(503, "NOTE_SAVE_UNCERTAIN", "\uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uBA54\uBAA8\uB97C \uB2E4\uC2DC \uC800\uC7A5\uD558\uAE30 \uC804\uC5D0 \uBAA9\uB85D\uC5D0\uC11C \uD655\uC778\uD558\uC138\uC694.");
      }
      const saved = result.data;
      if (!saved || !object(saved.note) || typeof saved.duplicate !== "boolean") throw new ManualNoteError(503, "NOTE_SAVE_UNCERTAIN", "\uC800\uC7A5 \uACB0\uACFC\uB97C \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
      if (saved.note.id !== value.noteId || saved.note.creatorId !== value.creatorId || saved.note.handle !== value.handle || (saved.note.supersedesId || null) !== value.supersedesId) throw new ManualNoteError(503, "NOTE_SAVE_UNCERTAIN", "\uC800\uC7A5 \uB300\uC0C1\uACFC \uACB0\uACFC\uB97C \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
      const note = publicManualNote({ note_id: saved.note.id, creator_id: saved.note.creatorId, handle: saved.note.handle, recorded_at: saved.note.recordedAt, supersedes_id: saved.note.supersedesId, payload: saved.note.payload });
      if (Object.entries(value.payload).some(([key, value2]) => note[key] !== value2)) throw new ManualNoteError(503, "NOTE_SAVE_UNCERTAIN", "\uC800\uC7A5 \uB0B4\uC6A9\uACFC \uACB0\uACFC\uB97C \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.");
      return json({ note, duplicate: saved.duplicate });
    } catch (e) {
      if (e instanceof ManualNoteError) return json({ error: e.message, code: e.code }, e.status);
      return json({ error: "\uC218\uB3D9 \uBA54\uBAA8 \uC694\uCCAD \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC785\uB825\uC744 \uBCF4\uC874\uD55C \uB4A4 \uBAA9\uB85D\uC744 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.", code: "NOTE_REQUEST_UNCERTAIN" }, 503);
    }
  };
}

// supabase/functions/creator-manual-notes/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(creatorManualNotesHandler({ sb, env }));
