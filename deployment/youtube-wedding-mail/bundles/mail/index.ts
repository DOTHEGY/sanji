// edge/clients.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import pg from "npm:pg@8.16.3";

// partyum-mail.mjs
var PROJECT = "private-wedding-research";
var KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var UC = /^UC[A-Za-z0-9_-]{22}$/;
var ADDRESS = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
var enc = new TextEncoder();
var dec = new TextDecoder("utf-8", { fatal: true });
var FAIL = (code) => Object.assign(new Error(code), { code });
var validDay = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + "T00:00:00Z")) && (/* @__PURE__ */ new Date(x + "T00:00:00Z")).toISOString().startsWith(x);
var iso = (v) => new Date(v).toISOString();
var maxRows = 100;
var ttl = 12e4;
var canonical = (b) => JSON.stringify(b);
var dayAt = (t) => iso(t + 9 * 36e5).slice(0, 10);
var runAtFor = (mode, t) => mode === "now" ? iso(t) : iso(Date.parse(dayAt(t) + "T01:00:00Z") + 864e5);
var b64 = (a) => btoa(String.fromCharCode(...a)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
var unb64 = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
var bytes = (x) => typeof x === "string" ? enc.encode(x) : x;
var isDate = (x) => typeof x === "string" && Number.isFinite(Date.parse(x));
var tokenRE = /^[A-Za-z0-9_-]{12,1500}\.[A-Za-z0-9_-]{43}$/;
var normal = (x) => typeof x === "string" ? x.trim().toLowerCase() : "";
function partyumRecipientKey(value) {
  const email = normal(value);
  if (!ADDRESS.test(email) || email.length > 254) return "";
  const [local, domain] = email.split("@");
  if (!["gmail.com", "googlemail.com"].includes(domain)) return email;
  const base = local.split("+")[0].replaceAll(".", "");
  return base ? base + "@gmail.com" : "";
}
var hash = async (x) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(canonical(x)))));
var exact = (obj, keys) => obj && Object.getPrototypeOf(obj) === Object.prototype && Object.keys(obj).sort().join(",") === [...keys].sort().join(",");
function inputScope(v, action, now) {
  const keys = ["action", "projectId", "day", "channelIdsExcluded", "mode"];
  const submit = ["planId", "expectedRecipientCount", "expectedRunAt", "idempotencyKey"];
  if (!exact(v, action === "submit" ? [...keys, ...submit] : keys) || v.action !== action || v.projectId !== PROJECT || !["now", "tomorrow"].includes(v.mode) || !validDay(v.day) || v.day > dayAt(now) || !Array.isArray(v.channelIdsExcluded) || v.channelIdsExcluded.length > maxRows || !v.channelIdsExcluded.every((x) => typeof x === "string" && UC.test(x)) || new Set(v.channelIdsExcluded).size !== v.channelIdsExcluded.length) throw FAIL("SCOPE");
  if (action === "submit" && (!KEY.test(v.idempotencyKey) || !tokenRE.test(v.planId) || !Number.isSafeInteger(v.expectedRecipientCount) || v.expectedRecipientCount < 1 || v.expectedRecipientCount > maxRows || !isDate(v.expectedRunAt))) throw FAIL("SCOPE");
  return { projectId: PROJECT, day: v.day, mode: v.mode, channelIdsExcluded: [...v.channelIdsExcluded].sort() };
}
function auth(actor) {
  if (typeof actor !== "string" || !OWNER.test(actor)) throw FAIL("AUTH");
  return actor;
}
async function recomputePartyumEligibility(snapshot, scope, now) {
  const { actor, projectId, day, channelIdsExcluded } = scope;
  if (!snapshot || snapshot.actor !== actor || snapshot.projectId !== projectId || snapshot.day !== day || snapshot.complete !== true || snapshot.duplicatesComplete !== true || !Array.isArray(snapshot.rows) || snapshot.rows.length > maxRows || snapshot.mailerReady !== true) throw FAIL("SOURCE_UNVERIFIED");
  const c = snapshot.copy;
  if (!c || c.actor !== actor || c.projectId !== projectId || c.purpose !== "youtube_project_copy_wedding" || c.active !== true || !Number.isSafeInteger(c.version) || c.version < 1 || typeof c.id !== "string" || !c.id || typeof c.subject !== "string" || !c.subject.trim() || c.subject.length > 200 || /[\r\n]/.test(c.subject) || typeof c.body !== "string" || !c.body.trim() || c.body.length > 2e4) throw FAIL("COPY_UNAVAILABLE");
  const copyDigest = await hash([c.id, c.version, c.subject, c.body]);
  if (c.factualityReviewedDigest !== copyDigest) throw FAIL("COPY_REVIEW_REQUIRED");
  const all = /* @__PURE__ */ new Map();
  const byAddress = /* @__PURE__ */ new Map();
  for (const r of snapshot.rows) {
    if (!r || r.actor !== actor || r.projectId !== projectId || r.day !== day || typeof r.channelId !== "string" || !UC.test(r.channelId) || all.has(r.channelId)) throw FAIL("SOURCE_UNVERIFIED");
    all.set(r.channelId, r);
    const address2 = partyumRecipientKey(r.email);
    if (address2) {
      const matching = byAddress.get(address2) ?? [];
      matching.push(r.channelId);
      byAddress.set(address2, matching);
    }
  }
  if (channelIdsExcluded.some((id) => !all.has(id))) throw FAIL("INVALID_EXCLUSION");
  const skip = new Set(channelIdsExcluded);
  const recipients = [];
  for (const [channelId, r] of all) {
    if (skip.has(channelId)) continue;
    const email = normal(r.email), recipientKey = partyumRecipientKey(email);
    if (r.affiliation !== "independent" || r.contactVerified !== true || r.outreachState !== "found_only" || r.completeForCandidate !== true || r.recipientAvailable !== true || !recipientKey || byAddress.get(recipientKey)?.length !== 1 || !isDate(r.verifiedAt) || Date.parse(r.verifiedAt) > now || !isDate(r.expiresAt) || Date.parse(r.expiresAt) <= now || typeof r.contactRevision !== "string" || !r.contactRevision) continue;
    recipients.push({ channelId, email, recipientKey, contactRevision: r.contactRevision });
  }
  recipients.sort((a, b) => a.channelId.localeCompare(b.channelId, "en"));
  const senderRef = snapshot.senderRef ?? "";
  const digest = await hash([actor, day, channelIdsExcluded, copyDigest, senderRef, recipients]);
  return { recipients, digest, senderRef, copy: { id: c.id, version: c.version, digest: copyDigest, subject: c.subject, body: c.body } };
}
async function partyumCopyDigest(c) {
  return hash([c.id, c.version, c.subject, c.body]);
}
function createPartyumMail({ secret, loadSnapshot, admitAtomic, readReplay, now = Date.now }) {
  const keyBytes = bytes(secret);
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength < 32) throw FAIL("NOT_CONFIGURED");
  let keyPromise;
  const key = () => keyPromise ??= crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  async function sign(claim) {
    const p = b64(enc.encode(canonical(claim)));
    return p + "." + b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(p))));
  }
  async function verified(token) {
    try {
      const [p, s] = token.split(".");
      if (!await crypto.subtle.verify("HMAC", await key(), unb64(s), enc.encode(p))) throw FAIL("INVALID_PLAN");
      return JSON.parse(dec.decode(unb64(p)));
    } catch {
      throw FAIL("INVALID_PLAN");
    }
  }
  const runScope = (actor, input, current) => ({ ...inputScope(input, input?.action, current), actor });
  return async (actor, input) => {
    auth(actor);
    if (!["plan", "submit"].includes(input?.action)) throw FAIL("SCOPE");
    const t = now();
    const scope = runScope(actor, input, t), scopeDigest = await hash(scope);
    if (input.action === "plan") {
      const e2 = await recomputePartyumEligibility(await loadSnapshot(scope), scope, t);
      const runAt = runAtFor(scope.mode, t), expiresAt = iso(t + ttl), recipientCount = e2.recipients.length;
      const planId = await sign({ scopeDigest, runAt, expiresAt, recipientCount, digest: e2.digest });
      return { projectId: PROJECT, day: scope.day, mode: scope.mode, recipientCount, runAt, expiresAt, copyVersion: e2.copy.version, planId };
    }
    const claim = await verified(input.planId);
    if (claim.scopeDigest !== scopeDigest || claim.runAt !== input.expectedRunAt || claim.recipientCount !== input.expectedRecipientCount) throw FAIL("INVALID_PLAN");
    const fingerprint = await hash([scopeDigest, claim.digest, claim.runAt, claim.recipientCount]);
    const previous = await readReplay({ actor, projectId: PROJECT, idempotencyKey: input.idempotencyKey, fingerprint });
    if (previous) return projectResult(previous, scope, claim);
    if (!isDate(claim.expiresAt) || Date.parse(claim.expiresAt) <= t || scope.mode === "tomorrow" && claim.runAt !== runAtFor(scope.mode, t)) throw FAIL("PLAN_STALE");
    const e = await recomputePartyumEligibility(await loadSnapshot(scope), scope, t);
    if (e.digest !== claim.digest || e.recipients.length !== claim.recipientCount) throw FAIL("PLAN_STALE");
    const result = await admitAtomic({
      ...scope,
      runAt: claim.runAt,
      expiresAt: claim.expiresAt,
      fingerprint,
      idempotencyKey: input.idempotencyKey,
      snapshotDigest: e.digest,
      copy: e.copy,
      senderRef: e.senderRef,
      recipients: e.recipients
    });
    return projectResult(result, scope, claim);
  };
}
function projectResult(r, scope, claim) {
  if (!r || r.actor !== scope.actor || r.projectId !== PROJECT || r.day !== scope.day || r.mode !== scope.mode || r.runAt !== claim.runAt || r.recipientCount !== claim.recipientCount || typeof r.batchId !== "string" || !r.batchId || (scope.mode === "now" ? r.state !== "queued" : r.state !== "scheduled")) throw FAIL("ADMISSION_UNVERIFIED");
  return { projectId: PROJECT, day: r.day, mode: r.mode, recipientCount: r.recipientCount, runAt: r.runAt, batchId: r.batchId, state: r.state };
}

// partyum-controls.mjs
var query = "select send_enabled from sanji_partyum_internal.partyum_runtime_controls where project_id=$1";
var answer = (allowed2, code = null) => Object.freeze({ allowed: allowed2, code });
function createPartyumControls({ pool: pool2, initTx, env: env2 }) {
  if (!pool2?.connect || typeof initTx !== "function" || typeof env2 !== "function") throw Error("Partyum controls unavailable");
  async function read(q) {
    const { rows } = await q.query(query, [PROJECT]);
    if (rows.length !== 1 || typeof rows[0].send_enabled !== "boolean") return answer(false, "PARTYUM_CONTROL_UNAVAILABLE");
    return rows[0].send_enabled ? answer(true) : answer(false, "PARTYUM_DISABLED");
  }
  return async (existingTx = null) => {
    if (env2("EMAIL_SENDING_ENABLED") !== "true") return answer(false, "GLOBAL_EMAIL_DISABLED");
    if (existingTx) {
      try {
        return await read(existingTx);
      } catch {
        return answer(false, "PARTYUM_CONTROL_UNAVAILABLE");
      }
    }
    let q;
    try {
      q = await pool2.connect();
      await q.query("begin read only");
      await initTx(q);
      const value = await read(q);
      await q.query("commit");
      return value;
    } catch {
      if (q) try {
        await q.query("rollback");
      } catch {
      }
      return answer(false, "PARTYUM_CONTROL_UNAVAILABLE");
    } finally {
      q?.release();
    }
  };
}

// handler.mjs
var ORIGIN = "https://dothegy.github.io";
var headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Vary": "Origin",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var errors = Object.freeze({
  AUTH: 401,
  SCOPE: 400,
  INVALID_EXCLUSION: 400,
  INVALID_PLAN: 409,
  PLAN_STALE: 409,
  KEY_REUSED: 409,
  SOURCE_UNVERIFIED: 503,
  COPY_UNAVAILABLE: 409,
  COPY_REVIEW_REQUIRED: 409,
  ADMISSION_UNVERIFIED: 503,
  NOT_CONFIGURED: 503,
  PARTYUM_DISABLED: 503,
  GLOBAL_EMAIL_DISABLED: 503,
  PARTYUM_CONTROL_UNAVAILABLE: 503,
  DUPLICATE: 409,
  NOT_ENABLED: 503,
  REQUEST: 400,
  SIZE: 413
});
var response = (v, status = 200) => Response.json(v, { headers, status });
var MAX_BYTES = 12e3;
async function parse(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("REQUEST");
  const dec3 = new TextDecoder("utf-8", { fatal: true });
  let text = "", n = 0;
  for (; ; ) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_BYTES) {
      void reader.cancel().catch(() => {
      });
      throw new Error("SIZE");
    }
    text += dec3.decode(value, { stream: true });
  }
  return JSON.parse(text + dec3.decode());
}
function createPartyumMailHandler({ authenticate, mail }) {
  return async (request) => {
    const origin = request.headers.get("origin");
    if (origin && origin !== ORIGIN) return response({ error: "ORIGIN" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });
    if (request.method !== "POST") return response({ error: "METHOD" }, 405);
    const bearer2 = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s,]+$/i.test(bearer2) || bearer2.length > 8192) return response({ error: "AUTH" }, 401);
    let actor;
    try {
      actor = await authenticate(bearer2.slice(7));
    } catch {
      return response({ error: "AUTH" }, 401);
    }
    if (!actor) return response({ error: "AUTH" }, 401);
    let input;
    try {
      input = await parse(request);
    } catch (e) {
      return e?.message === "SIZE" ? response({ error: "SIZE" }, 413) : response({ error: "REQUEST" }, 400);
    }
    try {
      if (typeof mail !== "function") return response({ error: "NOT_ENABLED" }, 503);
      return response(await mail(actor, input));
    } catch (e) {
      const code = Object.hasOwn(errors, e?.code) ? e.code : "ADMISSION_UNVERIFIED";
      return response({ error: code }, errors[code]);
    }
  };
}

// worker-policy.mjs
var PARTYUM_WORK_POLICY = Object.freeze({
  nativeBatch: 6,
  parallelism: 3,
  immediateBatch: 2,
  dispatchRateMax: 12,
  dispatchWindowMs: 18e5
});

// partyum-postgres.mjs
var fail = (code) => Object.assign(Error(code), { code });
var iso2 = (v) => new Date(v).toISOString();
var clearTime = (v) => v == null ? null : iso2(v);
var norm = (v) => typeof v === "string" ? v.trim().toLowerCase() : "";
var sched = (mode) => mode === "now" ? "queued" : "scheduled";
var tables = "sanji_partyum_internal.";
var str = (x) => typeof x === "string" && x.length > 0 && x.length <= 256;
var pgtime = async (q) => new Date((await q.query("select clock_timestamp() as now")).rows[0].now).getTime();
var channel = /^UC[A-Za-z0-9_-]{22}$/;
var makeResult = (r) => ({ actor: r.owner, projectId: r.project_id, day: r.day, mode: r.mode, runAt: iso2(r.run_at), recipientCount: r.recipient_count, batchId: r.id, state: sched(r.mode) });
var allowed = (r) => r && r.projectId === PROJECT && typeof r.actor === "string";
var sinceSql = "checked_at > clock_timestamp()-interval '90 seconds'";
var lockOwner = (q, owner) => q.query("select pg_advisory_xact_lock(hashtextextended('sanji-partyum-mail:'||$1::text,0))", [owner]);
function identitiesFor(channelId, email) {
  const key = partyumRecipientKey(email);
  return [email, "email:" + email, key, "email:" + key, channelId.toLowerCase(), "youtube:" + channelId.toLowerCase()].filter((x) => x && x !== "email:");
}
function suppression(identities, channelId, email) {
  return identitiesFor(channelId, email).some((x) => identities.has(x));
}
function contactRevision(r) {
  return JSON.stringify([r.channel_id, norm(r.email), clearTime(r.verified_at), clearTime(r.expires_at), clearTime(r.affiliation_checked_at), r.source_kind, r.source_url, r.affiliation_source_url]);
}
function trustedContact(r, t) {
  return !!r && !r.revoked_at && r.affiliation_status === "reviewed_no_agency_found" && ["official_channel", "official_website", "official_video"].includes(r.source_kind) && typeof r.source_url === "string" && r.source_url.startsWith("https://") && typeof r.affiliation_source_url === "string" && r.affiliation_source_url.startsWith("https://") && Date.parse(r.affiliation_checked_at) <= t && Date.parse(r.verified_at) <= t && Date.parse(r.expires_at) > t;
}
function createPartyumPostgres({
  pool: pool2,
  resolveSender,
  reviewedCopyDigest,
  readHoldingLegacyEvidence,
  initTx = async () => {
  }
}) {
  if (!pool2?.connect || typeof resolveSender !== "function" || typeof reviewedCopyDigest !== "function" || typeof readHoldingLegacyEvidence !== "function") throw fail("NOT_CONFIGURED");
  async function tx(fn, serializable = true) {
    const q = await pool2.connect();
    try {
      await q.query(serializable ? "begin isolation level serializable" : "begin isolation level read committed");
      await initTx(q);
      const result = await fn(q);
      await q.query("commit");
      return result;
    } catch (e) {
      try {
        await q.query("rollback");
      } catch {
      }
      if (e?.code === "40001") throw fail("PLAN_STALE");
      if (e?.code === "23505") throw fail("DUPLICATE");
      throw e;
    } finally {
      q.release();
    }
  }
  async function members(q, owner) {
    const { rows } = await q.query("select user_id from public.sanji_members where user_id=$1 for share", [owner]);
    if (rows.length !== 1 || rows[0].user_id !== owner) throw fail("AUTH");
  }
  async function sender(q, scope) {
    const proof = await resolveSender(q, scope.actor);
    return proof?.verified === true && proof.owner === scope.actor && str(proof.senderRef) ? proof.senderRef : null;
  }
  async function activeCopy(q, scope) {
    const { rows } = await q.query(`select id, owner, version, data->>'purpose' as purpose,
   data->>'subject' as subject,data->>'body' as body from public.sanji_template_library
   where owner=$1 and not archived and data->>'purpose'='youtube_project_copy_wedding' limit 2 for share`, [scope.actor]);
    if (rows.length !== 1) return null;
    const x = rows[0], copy = { id: x.id, actor: x.owner, projectId: PROJECT, active: true, version: x.version, purpose: x.purpose, subject: x.subject, body: x.body };
    const digest = await partyumCopyDigest(copy);
    copy.factualityReviewedDigest = await reviewedCopyDigest(q, scope.actor, digest);
    return copy;
  }
  async function verifiedContacts(q, { actor, day }, ids) {
    if (!ids.length) return [];
    return (await q.query(`select channel_id,email,source_kind,source_url,verified_at,expires_at,revoked_at,
    affiliation_status,affiliation_source_url,affiliation_checked_at
    from ${tables}read_partyum_verified_contacts($1,$2,$3::date,$4::text[])`, [PROJECT, actor, day, ids])).rows;
  }
  async function readLocked(q, scope, t) {
    if (!allowed(scope)) throw fail("SCOPE");
    await members(q, scope.actor);
    const { rows: people } = await q.query(`select channel_id from public.sanji_private_wedding_shortlist
       where owner=$1 and project_day=$2::date order by channel_id limit 101 for share`, [scope.actor, scope.day]);
    if (people.length > 100) throw fail("SOURCE_UNVERIFIED");
    const ids = people.map((x) => x.channel_id);
    if (!ids.every((x) => channel.test(x))) throw fail("SOURCE_UNVERIFIED");
    const records = await verifiedContacts(q, scope, ids);
    const contacts = new Map(records.map((x) => [x.channel_id, x]));
    const addresses = records.map((x) => partyumRecipientKey(x.email)).filter(Boolean);
    const { rows: prior } = await q.query(`select channel_id,recipient_key,state from ${tables}attempts
       where owner=$1 and project_id=$2 and (channel_id=any($3::text[]) or recipient_key=any($4::text[]))`, [scope.actor, PROJECT, ids, addresses]);
    const allKeys = [...new Set(ids.flatMap((id) => identitiesFor(id, norm(contacts.get(id)?.email))))];
    const { rows: holds } = await q.query(`select identity from public.sanji_suppression where owner=$1 and lower(identity)=any($2::text[]) for share`, [scope.actor, allKeys]);
    const holdSet = new Set(holds.map((x) => x.identity.toLowerCase()));
    const legacy = await readHoldingLegacyEvidence(q, { ...scope, channelIds: ids });
    if (legacy?.complete !== true || !Array.isArray(legacy.channels) || !legacy.channels.every((x) => ids.includes(x))) throw fail("SOURCE_UNVERIFIED");
    const legacyIds = new Set(legacy.channels);
    const [copy, senderRef] = [await activeCopy(q, scope), await sender(q, scope)];
    const wakeOk = !!(await q.query(`select 1 from ${tables}worker_health where project_id=$1 and wake_ready and ${sinceSql}`, [PROJECT])).rows.length;
    return {
      scope,
      copy,
      actor: scope.actor,
      projectId: PROJECT,
      day: scope.day,
      complete: true,
      duplicatesComplete: true,
      mailerReady: !!senderRef && wakeOk,
      senderRef,
      rows: people.map(({ channel_id: channelId }) => {
        const c = contacts.get(channelId), email = norm(c?.email), verified = trustedContact(c, t);
        const used = legacyIds.has(channelId) || prior.some((x) => x.channel_id === channelId || x.recipient_key === partyumRecipientKey(email));
        return {
          actor: scope.actor,
          projectId: PROJECT,
          day: scope.day,
          channelId,
          email,
          affiliation: verified ? "independent" : "unknown",
          contactVerified: verified,
          completeForCandidate: true,
          outreachState: used ? "unknown" : "found_only",
          recipientAvailable: !used && !suppression(holdSet, channelId, email),
          verifiedAt: clearTime(c?.verified_at),
          expiresAt: clearTime(c?.expires_at),
          contactRevision: c ? contactRevision(c) : null
        };
      })
    };
  }
  async function replay(q, x) {
    if (!allowed(x)) throw fail("SCOPE");
    const { rows } = await q.query(`select *,day::text as day from ${tables}batches
   where owner=$1 and project_id=$2 and idempotency_key=$3`, [x.actor, PROJECT, x.idempotencyKey]);
    const r = rows[0];
    if (!r) return null;
    if (r.fingerprint !== x.fingerprint) throw fail("KEY_REUSED");
    return makeResult(r);
  }
  async function assertWorker(q, ready) {
    await q.query(`insert into ${tables}worker_health(project_id,wake_ready,checked_at) values($1,$2,clock_timestamp())
   on conflict(project_id) do update set wake_ready=excluded.wake_ready,checked_at=excluded.checked_at`, [PROJECT, ready]);
  }
  const joined = (q, ids, lock = false) => q.query(`select a.*,a.day::text as day,b.run_at,b.copy_id,b.copy_version,b.copy_digest,b.sender_ref,b.selection_digest
  from ${tables}attempts a join ${tables}batches b on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
  where a.id=any($1::uuid[]) and a.project_id=$2${lock ? " for update of a" : ""}`, [ids, PROJECT]);
  const sameClaim = (r, x) => r && r.owner === x.actor && r.project_id === x.projectId && r.day === x.day && r.channel_id === x.channelId && r.batch_id === x.batchId && r.claim_id === x.claimId && r.id === x.attemptId;
  function viewClaim(r, copy) {
    return {
      actor: r.owner,
      projectId: PROJECT,
      day: r.day,
      channelId: r.channel_id,
      batchId: r.batch_id,
      attemptId: r.id,
      claimId: r.claim_id,
      runAt: iso2(r.run_at),
      snapshotDigest: r.selection_digest,
      copyDigest: r.copy_digest,
      senderRef: r.sender_ref,
      email: r.recipient,
      subject: copy?.subject,
      body: copy?.body
    };
  }
  async function validateDispatch(q, r) {
    try {
      await members(q, r.owner);
    } catch {
      return null;
    }
    const t = await pgtime(q);
    if (!r.claim_expires_at || Date.parse(r.claim_expires_at) <= t || Date.parse(r.run_at) > t || // Avoid surprise blasts after multi-hour outages. Requires manual disposition.
    t - Date.parse(r.run_at) > PARTYUM_WORK_POLICY.dispatchWindowMs) return null;
    const x = { actor: r.owner, projectId: PROJECT, day: r.day };
    const { rows: member } = await q.query("select 1 from public.sanji_private_wedding_shortlist where owner=$1 and channel_id=$2 and project_day=$3::date for share", [r.owner, r.channel_id, r.day]);
    if (member.length !== 1) return null;
    const rows = await verifiedContacts(q, x, [r.channel_id]);
    const c = rows[0];
    if (!trustedContact(c, t) || contactRevision(c) !== r.contact_revision || norm(c.email) !== r.recipient) return null;
    const suppress = identitiesFor(r.channel_id, r.recipient);
    if ((await q.query("select 1 from public.sanji_suppression where owner=$1 and lower(identity)=any($2::text[]) limit 1 for share", [r.owner, suppress])).rows.length) return null;
    const legacy = await readHoldingLegacyEvidence(q, { ...x, channelIds: [r.channel_id] });
    if (legacy?.complete !== true || !Array.isArray(legacy.channels) || legacy.channels.length) return null;
    const cpy = await activeCopy(q, x);
    if (!cpy || cpy.id !== r.copy_id || cpy.version !== r.copy_version || cpy.factualityReviewedDigest !== r.copy_digest || await partyumCopyDigest(cpy) !== r.copy_digest || await sender(q, x) !== r.sender_ref) return null;
    return cpy;
  }
  return {
    heartbeat: ({ ready = true } = {}) => tx((q) => assertWorker(q, ready === true)),
    loadSnapshot: (scope) => tx(async (q) => readLocked(q, scope, await pgtime(q))),
    readReplay: (x) => tx(async (q) => {
      await members(q, x.actor);
      return replay(q, x);
    }),
    admitAtomic: (x) => tx(async (q) => {
      if (!allowed(x)) throw fail("SCOPE");
      await lockOwner(q, x.actor);
      await members(q, x.actor);
      const prior = await replay(q, x);
      if (prior) return prior;
      const t = await pgtime(q);
      if (Date.parse(x.expiresAt) <= t) throw fail("PLAN_STALE");
      if (x.mode === "tomorrow") {
        const next = await q.query("select (((clock_timestamp() at time zone 'Asia/Seoul')::date+1+time '10:00') at time zone 'Asia/Seoul') as due");
        if (iso2(next.rows[0].due) !== x.runAt) throw fail("PLAN_STALE");
      }
      const again = await recomputePartyumEligibility(await readLocked(q, x, t), x, t);
      if (again.digest !== x.snapshotDigest || again.recipients.length !== x.recipients.length || again.senderRef !== x.senderRef) throw fail("PLAN_STALE");
      const id = crypto.randomUUID();
      const { rows } = await q.query(
        `insert into ${tables}batches(id,owner,project_id,day,mode,run_at,recipient_count,selection_digest,copy_id,copy_version,copy_digest,sender_ref,idempotency_key,fingerprint)
    values($1,$2,$3,$4::date,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14) returning *,day::text as day`,
        [id, x.actor, PROJECT, x.day, x.mode, x.runAt, again.recipients.length, again.digest, again.copy.id, again.copy.version, again.copy.digest, again.senderRef, x.idempotencyKey, x.fingerprint]
      );
      for (const r of again.recipients) await q.query(`insert into ${tables}attempts(id,owner,project_id,day,batch_id,channel_id,recipient,recipient_key,contact_revision,state)
    values($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), x.actor, PROJECT, x.day, id, r.channelId, r.email, r.recipientKey, r.contactRevision, sched(x.mode)]);
      if (x.mode === "now") await q.query("select pg_notify('sanji_partyum_due',$1)", [id]);
      return makeResult(rows[0]);
    }),
    async claimDue({ projectId, limit }) {
      if (projectId !== PROJECT || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw fail("SCOPE");
      return tx(async (q) => {
        if ((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`, [PROJECT])).rows.length) return [];
        const { rows: due } = await q.query(`select a.id from ${tables}attempts a join ${tables}batches b
     on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
     where a.project_id=$1 and b.run_at<=clock_timestamp()
     and (a.state in ('queued','scheduled') or (a.state='claimed' and a.intent_id is null and a.claim_expires_at<clock_timestamp()))
     order by b.run_at, a.id limit $2 for update of a skip locked`, [PROJECT, limit]);
        if (!due.length) return [];
        for (const { id } of due) await q.query(`update ${tables}attempts set state='claimed',claim_id=$1,claim_expires_at=clock_timestamp()+interval '90 seconds',
     state_at=clock_timestamp() where id=$2 and project_id=$3`, [crypto.randomUUID(), id, PROJECT]);
        const { rows } = await joined(q, due.map((x) => x.id));
        return Promise.all(rows.map(async (r) => viewClaim(r, await validateDispatch(q, r))));
      });
    },
    reverify: (x) => tx(async (q) => {
      const r = (await joined(q, [x.attemptId])).rows[0];
      if (!sameClaim(r, x) || r.state !== "claimed") return { verified: false };
      const copy = await validateDispatch(q, r);
      if (!copy) return { verified: false };
      return { ...viewClaim(r, copy), verified: true, duplicatesComplete: true, recipientAvailable: true };
    }),
    startDispatch: async (x) => {
      const admittedRate = await tx(async (q) => {
        await q.query("select pg_advisory_xact_lock(hashtextextended('sanji-partyum-dispatch-rate',0))");
        if ((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`, [PROJECT])).rows.length) return false;
        await q.query(`delete from ${tables}dispatch_rate_slots where project_id=$1 and started_at<clock_timestamp()-interval '2 minutes'`, [PROJECT]);
        const recent = await q.query(`select count(*)::int as n from ${tables}dispatch_rate_slots where project_id=$1 and started_at>clock_timestamp()-interval '1 minute'`, [PROJECT]);
        if (recent.rows[0]?.n >= PARTYUM_WORK_POLICY.dispatchRateMax) return false;
        await q.query(`insert into ${tables}dispatch_rate_slots(project_id,id,started_at) values($1,$2,clock_timestamp())`, [PROJECT, crypto.randomUUID()]);
        return true;
      }, false);
      if (!admittedRate) return null;
      return tx(async (q) => {
        const r = (await joined(q, [x.attemptId], true)).rows[0];
        if (!sameClaim(r, x) || r.state !== "claimed" || r.intent_id || x.snapshotDigest !== r.selection_digest || !await validateDispatch(q, r)) return null;
        if ((await q.query(`select 1 from ${tables}worker_health where project_id=$1 and cooldown_until>clock_timestamp()`, [PROJECT])).rows.length) return null;
        const id = crypto.randomUUID();
        const y = await q.query(`update ${tables}attempts set state='dispatching',intent_id=$1,dispatch_started_at=clock_timestamp(),state_at=clock_timestamp()
     where id=$2 and project_id=$3 and owner=$4 and claim_id=$5 and state='claimed' returning id`, [id, r.id, PROJECT, r.owner, x.claimId]);
        return y.rows.length ? { committed: true, id, attemptId: r.id } : null;
      }).catch((e) => {
        if (e.code === "PLAN_STALE") return null;
        throw e;
      });
    },
    cooldown: (seconds) => tx(async (q) => {
      const safe = Number.isFinite(seconds) ? Math.max(30, Math.min(300, Math.floor(seconds))) : 60;
      await q.query(`update ${tables}worker_health set cooldown_until=greatest(coalesce(cooldown_until,clock_timestamp()),clock_timestamp()+make_interval(secs=>$2::int))
    where project_id=$1`, [PROJECT, safe]);
    }),
    finalize: (x) => tx(async (q) => {
      const r = (await joined(q, [x.attemptId], true)).rows[0];
      if (!sameClaim(r, x)) throw fail("ADMISSION_UNVERIFIED");
      const review = x.state === "review_required" && r.state === "claimed" && !r.intent_id && !x.intentId;
      const dispatched = ["accepted", "failed", "unknown"].includes(x.state) && r.state === "dispatching" && x.intentId && x.intentId === r.intent_id;
      if (!review && !dispatched) throw fail("ADMISSION_UNVERIFIED");
      const provider = x.state === "accepted" ? x.providerId : null, acceptedAt = x.state === "accepted" ? x.at : null;
      await q.query(`update ${tables}attempts set state=$1,provider_id=$2,provider_accepted_at=$3,state_at=clock_timestamp()
    where id=$4 and project_id=$5 and owner=$6 and claim_id=$7`, [x.state, provider, acceptedAt, r.id, PROJECT, r.owner, r.claim_id]);
    }),
    readStatusEvidence: (x) => tx(async (q) => {
      if (!allowed(x) || !Array.isArray(x.channelIds) || x.channelIds.length < 1 || x.channelIds.length > 100 || !x.channelIds.every((id) => typeof id === "string" && channel.test(id))) throw fail("SCOPE");
      await members(q, x.actor);
      const { rows: short } = await q.query("select channel_id from public.sanji_private_wedding_shortlist where owner=$1 and project_day=$2::date and channel_id=any($3::text[])", [x.actor, x.day, x.channelIds]);
      if (short.length !== x.channelIds.length) throw fail("SCOPE");
      const { rows } = await q.query(`select a.channel_id,a.state,a.state_at,a.intent_id,a.provider_id,a.provider_accepted_at,b.run_at
     from ${tables}attempts a join ${tables}batches b on b.owner=a.owner and b.project_id=a.project_id and b.id=a.batch_id and b.day=a.day
     where a.owner=$1 and a.project_id=$2 and a.day=$3::date and a.channel_id=any($4::text[])`, [x.actor, PROJECT, x.day, x.channelIds]);
      const t = await pgtime(q);
      return new Map(rows.map((r) => {
        if (r.state === "accepted" && r.intent_id && r.provider_id && r.provider_accepted_at) return [r.channel_id, { status: "sent", at: iso2(r.provider_accepted_at), completeForCandidate: true }];
        if (r.state === "scheduled" && Date.parse(r.run_at) > t) return [r.channel_id, { status: "scheduled", at: iso2(r.run_at), completeForCandidate: true }];
        if (r.state === "failed" && r.intent_id) return [r.channel_id, { status: "failed", at: iso2(r.state_at), completeForCandidate: true }];
        return [r.channel_id, { status: "unknown", at: null, completeForCandidate: false }];
      }));
    })
  };
}

// partyum-runner.mjs
var iso3 = (x) => typeof x === "string" && Number.isFinite(Date.parse(x));
var ID = /^[a-z0-9:_-]{1,128}$/i;
var equal = (a, b) => typeof a === "string" && a.length > 0 && a === b;
function createPartyumDueExecutor({ claimDue, reverify, startDispatch, finalize, deliver, cooldown = async () => {
}, now = Date.now, parallelism = 1 }) {
  return async ({ limit = 1 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw Error("Invalid claim bound");
    const claims = await claimDue({ projectId: PROJECT, at: new Date(now()).toISOString(), limit });
    if (!Array.isArray(claims) || claims.length > limit) throw Error("Invalid claims");
    for (const claim of claims) {
      if (claim?.projectId !== PROJECT || !iso3(claim.runAt) || Date.parse(claim.runAt) > now() || !ID.test(claim.attemptId ?? "") || !ID.test(claim.batchId ?? "") || !ID.test(claim.claimId ?? "")) throw Error("Invalid claim");
    }
    if (new Set(claims.map((c) => c.attemptId)).size !== claims.length) throw Error("Duplicate claim");
    if (!Number.isSafeInteger(parallelism) || parallelism < 1 || parallelism > 3) throw Error("Invalid dispatch concurrency");
    const dispatch = async (c) => {
      const binding = { actor: c.actor, projectId: PROJECT, day: c.day, channelId: c.channelId, batchId: c.batchId, attemptId: c.attemptId, claimId: c.claimId };
      let check;
      try {
        check = await reverify(binding);
      } catch {
      }
      if (check?.verified !== true || !equal(check.actor, c.actor) || check.projectId !== PROJECT || !equal(check.day, c.day) || !equal(check.channelId, c.channelId) || !equal(check.snapshotDigest, c.snapshotDigest) || !equal(check.copyDigest, c.copyDigest) || !equal(check.email, c.email) || !equal(check.senderRef, c.senderRef) || check.duplicatesComplete !== true || check.recipientAvailable !== true || typeof check.subject !== "string" || !check.subject || typeof check.body !== "string" || !check.body) {
        await finalize({ ...binding, state: "review_required" });
        return "review_required";
      }
      const intent = await startDispatch({ ...binding, snapshotDigest: c.snapshotDigest });
      if (!intent?.committed || !ID.test(intent.id ?? "") || !equal(intent.attemptId, c.attemptId)) {
        return "not_started";
      }
      let proof;
      try {
        proof = await deliver({ actor: c.actor, projectId: PROJECT, from: c.senderRef, to: c.email, subject: check.subject, body: check.body, intentId: intent.id });
      } catch (e) {
        if (e?.code === "GMAIL_RATE_LIMIT") {
          try {
            await cooldown(e.retryAfterSeconds);
          } catch {
          }
        }
      }
      const accepted = proof?.kind === "accepted" && ID.test(proof.providerId ?? "") && iso3(proof.at) && Math.abs(Date.parse(proof.at) - now()) < 3e5 && equal(proof.intentId, intent.id);
      const failure = proof?.kind === "rejected_before_acceptance" && equal(proof.intentId, intent.id);
      const state = accepted ? "accepted" : failure ? "failed" : "unknown";
      await finalize({ ...binding, intentId: intent.id, state, ...accepted ? { providerId: proof.providerId, at: proof.at } : {} });
      return state;
    };
    const results = [];
    for (let i = 0; i < claims.length; i += parallelism) results.push(...await Promise.all(claims.slice(i, i + parallelism).map(dispatch)));
    return results;
  };
}

// gmail-server.mjs
var TOKEN = "https://oauth2.googleapis.com/token";
var API = "https://gmail.googleapis.com/gmail/v1/users/me";
var address = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
var providerId = /^[A-Za-z0-9_-]{1,128}$/;
var localId = /^[0-9a-f-]{36}$/i;
var enc2 = new TextEncoder();
var dec2 = new TextDecoder("utf-8", { fatal: true });
var err = (code) => Object.assign(Error(code), { code });
var norm2 = (x) => typeof x === "string" ? x.trim().toLowerCase() : "";
var byte64 = (x) => btoa(Array.from(x, (c) => String.fromCharCode(c)).join(""));
var unbase64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
var b64url = (x) => byte64(x).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
var allowedMailbox = (x) => address.test(x) && x.length <= 254;
var nonempty = (x) => typeof x === "string" && x.length > 0;
var encodeMime = (value) => byte64(enc2.encode(value));
function encodedSubject(subject) {
  const words = [];
  let part = "";
  for (const c of subject) {
    if (part && enc2.encode(part + c).length > 42) {
      words.push("=?UTF-8?B?" + encodeMime(part) + "?=");
      part = "";
    }
    part += c;
  }
  if (part) words.push("=?UTF-8?B?" + encodeMime(part) + "?=");
  return words.join("\r\n ");
}
function partyumMime({ from, to, subject, body, intentId }) {
  if (!allowedMailbox(from) || !allowedMailbox(to) || !localId.test(intentId ?? "") || !nonempty(subject) || subject.length > 200 || /[\r\n\0]/.test(subject) || !nonempty(body) || body.length > 2e4 || /\0/.test(body)) throw err("MIME_INVALID");
  const folded = (encodeMime(body).match(/.{1,76}/g) || []).join("\r\n");
  return b64url(enc2.encode([
    "From: " + from,
    "To: " + to,
    "Subject: " + encodedSubject(subject),
    // Stable reconciliation identifier, no new ads/tracking or copy changes.
    "Message-ID: <partyum-" + intentId.toLowerCase() + "@sanji.invalid>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    folded,
    ""
  ].join("\r\n")));
}
function createPartyumGmail({ env: env2, readConnection, isEnabled, request = fetch, now = Date.now }) {
  if (typeof env2 !== "function" || typeof readConnection !== "function" || typeof isEnabled !== "function") throw err("GMAIL_UNCONFIGURED");
  async function remote(url2, options = {}) {
    if (![TOKEN, API + "/profile", API + "/messages/send"].includes(url2)) throw err("GMAIL_DESTINATION_DENIED");
    let response2;
    try {
      response2 = await request(url2, { ...options, redirect: "error", signal: AbortSignal.timeout(12e3) });
    } catch {
      throw err("GMAIL_OUTCOME_UNKNOWN");
    }
    if (url2 === API + "/messages/send" && response2.status === 429) {
      const raw = response2.headers.get("retry-after");
      const retry = raw !== null && /^\d{1,6}$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw ?? "") - now()) / 1e3);
      throw Object.assign(err("GMAIL_RATE_LIMIT"), { retryAfterSeconds: Number.isFinite(retry) ? Math.max(30, Math.min(300, retry)) : 60 });
    }
    let data;
    try {
      data = await response2.json();
    } catch {
      throw err("GMAIL_OUTCOME_UNKNOWN");
    }
    if (!response2.ok) throw err(url2 === TOKEN && data?.error === "invalid_grant" ? "GMAIL_REAUTH_REQUIRED" : "GMAIL_OUTCOME_UNKNOWN");
    return data;
  }
  async function checkedConnection(q, owner) {
    const r = await readConnection(q, owner);
    const email = norm2(r?.summary?.email);
    if (r?.owner !== owner || r.provider !== "gmail" || r.summary?.reauthRequired === true || !allowedMailbox(email) || !nonempty(r.encrypted) || r.encrypted.length > 24e3) return null;
    const rev = await crypto.subtle.digest("SHA-256", enc2.encode(r.encrypted));
    return { ...r, email, senderRef: "gmail:" + b64url(new Uint8Array(rev)) };
  }
  const resolveSender = async (q, owner) => {
    const r = await checkedConnection(q, owner);
    const ready = r && await isEnabled(q) && nonempty(env2("TOKEN_ENCRYPTION_KEY")) && nonempty(env2("GOOGLE_CLIENT_ID")) && nonempty(env2("GOOGLE_CLIENT_SECRET"));
    return ready ? { owner, verified: true, senderRef: r.senderRef } : null;
  };
  async function tokenFor(r) {
    const secret = env2("TOKEN_ENCRYPTION_KEY");
    const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc2.encode(secret)), "AES-GCM", false, ["decrypt"]);
    let value;
    try {
      const raw = unbase64(r.encrypted);
      value = JSON.parse(dec2.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12))));
    } catch {
      throw err("GMAIL_CONNECTION_UNAVAILABLE");
    }
    if (norm2(value?.email) !== r.email) throw err("GMAIL_ACCOUNT_CHANGED");
    if (nonempty(value.access_token) && Number.isFinite(value.expires) && value.expires > now() + 6e4) return value.access_token;
    if (!nonempty(value.refresh_token)) throw err("GMAIL_REAUTH_REQUIRED");
    const fresh = await remote(TOKEN, { method: "POST", body: new URLSearchParams({
      client_id: env2("GOOGLE_CLIENT_ID"),
      client_secret: env2("GOOGLE_CLIENT_SECRET"),
      refresh_token: value.refresh_token,
      grant_type: "refresh_token"
    }) });
    if (!nonempty(fresh?.access_token) || !Number.isFinite(Number(fresh.expires_in)) || Number(fresh.expires_in) <= 60) throw err("GMAIL_REAUTH_REQUIRED");
    return fresh.access_token;
  }
  async function deliver({ actor, projectId, from, to, subject, body, intentId }) {
    if (projectId !== PROJECT || !await isEnabled() || !localId.test(intentId ?? "")) throw err("GMAIL_SEND_DISABLED");
    const row = await checkedConnection(null, actor);
    if (!row || row.senderRef !== from) throw err("GMAIL_ACCOUNT_CHANGED");
    const accessToken = await tokenFor(row), headers2 = { Authorization: "Bearer " + accessToken };
    const profile = await remote(API + "/profile", { headers: headers2 });
    if (norm2(profile?.emailAddress) !== row.email) throw err("GMAIL_ACCOUNT_CHANGED");
    if ((await checkedConnection(null, actor))?.senderRef !== from) throw err("GMAIL_ACCOUNT_CHANGED");
    const raw = partyumMime({ from: row.email, to, subject, body, intentId });
    if (!await isEnabled()) throw err("GMAIL_SEND_DISABLED");
    const receipt = await remote(API + "/messages/send", { method: "POST", headers: { ...headers2, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
    if (!providerId.test(receipt?.id ?? "") || !providerId.test(receipt?.threadId ?? "")) throw err("GMAIL_OUTCOME_UNKNOWN");
    return { kind: "accepted", intentId, providerId: receipt.id, at: new Date(now()).toISOString() };
  }
  return { resolveSender, deliver };
}

// partyum-holding-evidence.mjs
async function readPartyumHoldingLegacyEvidence(q, x) {
  if (x?.projectId !== PROJECT || !Array.isArray(x.channelIds) || x.channelIds.length > 100) return { complete: false };
  const keys = x.channelIds.map((id) => "youtube:" + id);
  const { rows: [r] } = await q.query(`select
    exists(select 1 from public.sanji_youtube_manual_batches where owner=$1 and review#>>'{scope,projectId}'=$2) as batches,
    exists(select 1 from public.sanji_drafts where owner=$1 and (data->>'projectId'=$2 or data#>>'{scope,projectId}'=$2)) as drafts,
    exists(select 1 from public.sanji_outbox where owner=$1 and channel='email' and data->>'projectId'=$2
      and (data->>'creatorKey' is null or data->>'creatorKey'=any($3::text[]))) as outbox,
    exists(select 1 from public.sanji_records where owner=$1 and kind='thread' and data->>'projectId'=$2
      and (data->>'creatorKey' is null or data->>'creatorKey'=any($3::text[]))) as thread`, [x.actor, PROJECT, keys]);
  if (!r || [r.batches, r.drafts, r.outbox, r.thread].some((v) => v !== false)) return { complete: false };
  return { complete: true, channels: [] };
}

// partyum-combined-status.mjs
var UC2 = /^UC[A-Za-z0-9_-]{22}$/;
var unknown = (channelId) => ({ channelId, status: "unknown", at: null, completeForCandidate: false });
var states = /* @__PURE__ */ new Set(["found_only", "scheduled", "sent", "failed", "unknown"]);
function clean(item, channelId) {
  if (!item || !states.has(item.status) || item.completeForCandidate !== true || item.status === "unknown") return unknown(channelId);
  if (item.status === "found_only") return { channelId, status: "found_only", at: null, completeForCandidate: true };
  if (typeof item.at !== "string" || !Number.isFinite(Date.parse(item.at))) return unknown(channelId);
  return { channelId, status: item.status, at: new Date(item.at).toISOString(), completeForCandidate: true };
}
function createPartyumCombinedStatus({ readLegacy, readLedger }) {
  return async (scope) => {
    const { actor, projectId, day, channelIds } = scope;
    if (projectId !== PROJECT || typeof actor !== "string" || !Array.isArray(channelIds) || !channelIds.length || channelIds.length > 100 || !channelIds.every((x) => typeof x === "string" && UC2.test(x)) || new Set(channelIds).size !== channelIds.length) throw Error("Status scope mismatch");
    const fallback = () => ({ projectId, day, items: channelIds.map(unknown) });
    let legacy, logged;
    try {
      [legacy, logged] = await Promise.all([readLegacy(scope), readLedger(scope)]);
    } catch {
      return fallback();
    }
    if (legacy?.projectId !== projectId || legacy.day !== day || !Array.isArray(legacy.items) || !(logged instanceof Map) || new Set(legacy.items.map((x) => x?.channelId)).size !== legacy.items.length || legacy.items.some((x) => !channelIds.includes(x?.channelId)) || [...logged.keys()].some((x) => !channelIds.includes(x))) return fallback();
    const old = new Map(legacy.items.map((x) => [x.channelId, x]));
    return { projectId, day, items: channelIds.map((channelId) => {
      const previous = clean(old.get(channelId), channelId);
      if (!logged.has(channelId)) return previous;
      const current = clean(logged.get(channelId), channelId);
      return previous.status === "found_only" ? current : unknown(channelId);
    }) };
  };
}

// legacy/partyum-day-status.mjs
var project = "private-wedding-research";
var channel2 = /^UC[A-Za-z0-9_-]{22}$/;
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var civilDate = /^\d{4}-\d{2}-\d{2}$/;
var timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
var sources = Object.freeze({
  scheduled: "confirmed-current-reservation",
  sent: "accepted-provider-receipt",
  failed: "recorded-terminal-failure"
});
var maximum = 100;
function bad(message) {
  return Object.assign(new Error(message), { code: message });
}
var isDate2 = (x) => typeof x === "string" && civilDate.test(x) && Number.isFinite(Date.parse(x + "T00:00:00Z")) && (/* @__PURE__ */ new Date(x + "T00:00:00Z")).toISOString().slice(0, 10) === x;
var isStamp = (x) => typeof x === "string" && timestamp.test(x) && isDate2(x.slice(0, 10)) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 19) === x.slice(0, 19);
var isChannel = (x) => typeof x === "string" && channel2.test(x);
async function readPartyumDayStatus({
  actor,
  input,
  readShortlist,
  readSnapshot,
  now = Date.now
}) {
  if (typeof actor !== "string" || !uuid.test(actor)) throw bad("AUTH");
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).sort().join(",") !== "channelIds,day,projectId" || input.projectId !== project || !isDate2(input.day) || !Array.isArray(input.channelIds) || input.channelIds.length < 1 || input.channelIds.length > maximum || !input.channelIds.every(isChannel) || new Set(input.channelIds).size !== input.channelIds.length) {
    throw bad("SCOPE");
  }
  if (typeof readShortlist !== "function") throw bad("READ");
  const { day, channelIds } = input;
  const requested = new Set(channelIds);
  const scope = Object.freeze({ owner: actor, projectId: project, day, channelIds: Object.freeze([...requested]) });
  const matches = await readShortlist(scope);
  const inScope = (x) => x?.owner === actor && x.projectId === project && x.day === day && requested.has(x.channelId);
  if (!Array.isArray(matches) || !matches.every(inScope) || new Set(matches.map((m) => m.channelId)).size !== matches.length) throw bad("READ");
  if (matches.length !== requested.size) throw bad("SCOPE");
  const unknown2 = (channelId) => ({ channelId, status: "unknown", at: null, completeForCandidate: false });
  const result = (items) => ({ projectId: project, day, items });
  const failClosed = () => result([...requested].map(unknown2));
  if (typeof readSnapshot !== "function") return failClosed();
  let snapshot;
  try {
    snapshot = await readSnapshot(scope);
  } catch {
    return failClosed();
  }
  if (snapshot?.owner !== actor || snapshot?.projectId !== project || snapshot?.day !== day || !Array.isArray(snapshot?.entries) || !snapshot.entries.every(inScope) || snapshot.entries.length > maximum * 2) return failClosed();
  const evidence = /* @__PURE__ */ new Map();
  const conflicting = /* @__PURE__ */ new Set();
  for (const row of snapshot.entries) {
    if (evidence.has(row.channelId)) conflicting.add(row.channelId);
    evidence.set(row.channelId, row);
  }
  const claimants = /* @__PURE__ */ new Map();
  for (const row of evidence.values()) {
    if (!Array.isArray(row.events) || row.events.length !== 1) continue;
    const event2 = row.events[0];
    if (!inScope(event2) || typeof event2.proofId !== "string") continue;
    const claim = claimants.get(event2.proofId);
    if (claim && claim !== row.channelId) {
      conflicting.add(claim);
      conflicting.add(row.channelId);
    }
    claimants.set(event2.proofId, row.channelId);
  }
  let t;
  try {
    t = now();
  } catch {
    return failClosed();
  }
  if (!Number.isFinite(t)) return failClosed();
  return result([...requested].map((id) => {
    const row = evidence.get(id);
    if (conflicting.has(id) || !row || row.exhaustive !== true || !Array.isArray(row.events)) return unknown2(id);
    if (row.events.length === 0) return { channelId: id, status: "found_only", at: null, completeForCandidate: true };
    if (row.events.length !== 1) return unknown2(id);
    const e = row.events[0];
    if (!inScope(e) || e.channelId !== id || !Object.hasOwn(sources, e.status) || sources[e.status] !== e.source || !isStamp(e.at) || typeof e.proofId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(e.proofId)) return unknown2(id);
    const when = Date.parse(e.at);
    if (e.status === "scheduled" && when <= t || e.status !== "scheduled" && when > t) return unknown2(id);
    return { channelId: id, status: e.status, at: e.at, completeForCandidate: true };
  }));
}

// legacy/partyum-source.mjs
var idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var isId = (x) => typeof x === "string" && idPattern.test(x);
var isText = (x) => typeof x === "string" && x.length > 0 && x.length <= 256;
var validStamp = (x) => typeof x === "string" && /T.*(Z|[+-][0-9]{2}:[0-9]{2})$/.test(x) && Number.isFinite(Date.parse(x));
var stamp = (x) => new Date(x).toISOString();
var identical = (a, b) => isText(a) && a === b;
var unique = (items, key) => new Set(items.map(key)).size === items.length;
function unready() {
  return new Error("Status source unavailable");
}
async function bounded(query2, maximum2) {
  maximum2 = Math.min(499, maximum2);
  const { data, error } = await query2.limit(maximum2 + 1);
  if (error || !Array.isArray(data) || data.length > maximum2) throw unready();
  return data;
}
async function openCount(q) {
  const { count, error } = await q;
  if (error || !Number.isSafeInteger(count) || count < 0) throw unready();
  return count;
}
var event = (scope, channelId, status, source, at, proofId) => ({
  owner: scope.owner,
  projectId: scope.projectId,
  day: scope.day,
  channelId,
  status,
  source,
  at: stamp(at),
  proofId
});
function createPartyumStatusReaders(client) {
  const atOwner = (table, fields, scope) => client.from(table).select(fields).eq("owner", scope.owner);
  const batches = (scope) => atOwner("sanji_youtube_manual_batches", "owner,id,approval_hash,review,confirmed_at", scope).eq("review->scope->>projectId", scope.projectId);
  const count = (table, scope) => client.from(table).select("id", { head: true, count: "exact" }).eq("owner", scope.owner);
  const relatedCounts = (scope, channelKeys) => Promise.all([
    openCount(count("sanji_drafts", scope).eq("data->>projectId", scope.projectId)),
    openCount(count("sanji_drafts", scope).eq("data->scope->>projectId", scope.projectId)),
    openCount(count("sanji_outbox", scope).eq("channel", "email").eq("data->>projectId", scope.projectId).in("data->>creatorKey", channelKeys)),
    openCount(count("sanji_records", scope).eq("kind", "thread").eq("data->>projectId", scope.projectId).in("data->>creatorKey", channelKeys)),
    openCount(count("sanji_outbox", scope).eq("channel", "email").eq("data->>projectId", scope.projectId).is("data->>creatorKey", null)),
    openCount(count("sanji_records", scope).eq("kind", "thread").eq("data->>projectId", scope.projectId).is("data->>creatorKey", null))
  ]);
  return {
    async authenticate(token) {
      const { data, error } = await client.auth.getUser(token);
      const user = data?.user?.id;
      if (error || !isId(user)) return null;
      const membership = await client.from("sanji_members").select("user_id").eq("user_id", user).maybeSingle();
      return !membership.error && membership.data?.user_id === user ? user : null;
    },
    async readShortlist(scope) {
      const shortlist = await bounded(atOwner("sanji_private_wedding_shortlist", "owner,channel_id,project_day", scope).eq("project_day", scope.day).in("channel_id", scope.channelIds), scope.channelIds.length);
      return shortlist.map((r) => ({ owner: r.owner, projectId: scope.projectId, day: r.project_day, channelId: r.channel_id }));
    },
    async readSnapshot(scope) {
      const scopeHeader = { owner: scope.owner, projectId: scope.projectId, day: scope.day };
      const out = (entries) => ({ ...scopeHeader, entries });
      const rc = scope.channelIds, channelKeys = rc.map((id) => "youtube:" + id);
      const [projectBatches, tagged] = await Promise.all([bounded(batches(scope), 500), relatedCounts(scope, channelKeys)]);
      if (projectBatches.some((b) => b.owner !== scope.owner || !isId(b.id) || b.review?.scope?.projectId !== scope.projectId) || !unique(projectBatches, (b) => b.id)) return out([]);
      if (projectBatches.length === 0) {
        if (tagged.some(Boolean)) return out([]);
        const [batchAgain, taggedAgain] = await Promise.all([bounded(batches(scope), 500), relatedCounts(scope, channelKeys)]);
        return out(!batchAgain.length && !taggedAgain.some(Boolean) ? rc.map((channelId) => ({ ...scopeHeader, channelId, exhaustive: true, events: [] })) : []);
      }
      if (tagged[0] || tagged[1] || tagged[4] || tagged[5]) return out([]);
      const today = projectBatches.filter((b) => b.review?.scope?.day === scope.day);
      const byBatch = new Map(today.map((b) => [b.id, b]));
      const batchIds = [...byBatch.keys()];
      if (!batchIds.length) return out([]);
      const [ledgers, schedules] = await Promise.all([
        bounded(atOwner("sanji_youtube_manual_ledger", "id,owner,batch_id,candidate_id,channel,approval_hash,state,provider_id,outbox_id,thread_id,updated_at", scope).in("batch_id", batchIds).in("channel", rc), rc.length * 10),
        bounded(atOwner("sanji_youtube_manual_schedule", "owner,batch_id,approval_hash,run_at,state", scope).in("batch_id", batchIds), batchIds.length * 2)
      ]);
      if (ledgers.some((l) => l.owner !== scope.owner || !isId(l.id) || !byBatch.has(l.batch_id) || !rc.includes(l.channel)) || schedules.some((s) => s.owner !== scope.owner || !byBatch.has(s.batch_id)) || !unique(ledgers, (l) => l.id)) return out([]);
      const selectExact = (table, fields, ids) => ids.length ? bounded(atOwner(table, fields, scope).in("id", ids), ids.length) : Promise.resolve([]);
      const accepted = ledgers.filter((l) => l.state === "accepted");
      const uniqueIds = (rows2, key) => [...new Set(rows2.map((r) => r[key]).filter(isId))];
      const [outbox, threads] = await Promise.all([
        selectExact("sanji_outbox", "owner,id,target,channel,status,created,projectId:data->>projectId,manualBatchId:data->>manualBatchId,providerId:data->>providerId,creatorKey:data->>creatorKey,proposalType:data->>proposalType", uniqueIds(accepted, "outbox_id")),
        selectExact("sanji_records", "owner,id,kind,projectId:data->>projectId,target:data->>target,creatorKey:data->>creatorKey,messages:data->messages", uniqueIds(accepted, "thread_id"))
      ]);
      if (tagged[2] !== outbox.length || tagged[3] !== threads.length) return out([]);
      if (!unique(outbox, (r) => r.id) || !unique(threads, (r) => r.id) || [...outbox, ...threads].some((r) => r.owner !== scope.owner)) return out([]);
      const outById = new Map(outbox.map((r) => [r.id, r]));
      const threadById = new Map(threads.map((r) => [r.id, r]));
      const rows = [];
      for (const cid of rc) {
        const matched = ledgers.filter((l2) => l2.channel === cid && l2.state !== "cancelled");
        if (matched.length !== 1) continue;
        const l = matched[0], b = byBatch.get(l.batch_id), entries = b.review?.entries;
        if (!validStamp(b.confirmed_at) || !identical(b.approval_hash, l.approval_hash) || !isId(l.candidate_id) || !Array.isArray(entries) || entries.length > 100 || entries.filter((e) => e?.id === l.candidate_id && e.channel === cid).length !== 1) continue;
        let proof;
        if (l.state === "accepted" && isText(l.provider_id)) {
          const o = outById.get(l.outbox_id), t = threadById.get(l.thread_id);
          if (o?.projectId !== scope.projectId || o.target !== l.candidate_id || o.manualBatchId !== b.id || o.channel !== "email" || o.status !== "accepted" || !identical(o.providerId, l.provider_id) || o.proposalType !== "youtube_manual_campaign" || o.creatorKey !== "youtube:" + cid || t?.projectId !== scope.projectId || t?.kind !== "thread" || t?.target !== l.candidate_id || t?.creatorKey !== "youtube:" + cid || !Array.isArray(t.messages) || !validStamp(o.created)) continue;
          const m = t.messages.filter((m2) => m2?.id === l.provider_id && m2.outboxId === o.id && m2.out === true && (m2.status === void 0 || m2.status === "accepted") && validStamp(m2.at) && Math.abs(Date.parse(m2.at) - Date.parse(o.created)) <= 3e5);
          if (m.length === 1) proof = event(scope, cid, "sent", "accepted-provider-receipt", m[0].at, "provider:" + l.provider_id);
        } else if (l.state === "reserved") {
          const live = schedules.filter((s) => s.batch_id === b.id && identical(s.approval_hash, b.approval_hash) && s.state === "scheduled" && validStamp(s.run_at));
          if (live.length === 1) proof = event(scope, cid, "scheduled", "confirmed-current-reservation", live[0].run_at, "ledger:" + l.id);
        } else if (l.state === "failed" && validStamp(l.updated_at)) {
          proof = event(scope, cid, "failed", "recorded-terminal-failure", l.updated_at, "ledger:" + l.id);
        }
        if (proof) rows.push({ ...scopeHeader, channelId: cid, exhaustive: true, events: [proof] });
      }
      return out(rows);
    }
  };
}

// production-runtime.mjs
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var encode = new TextEncoder();
var HEAD = { "Cache-Control": "no-store", "Content-Type": "application/json" };
var exactOwner = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var date = /^\d{4}-\d{2}-\d{2}$/;
var channel3 = /^UC[A-Za-z0-9_-]{22}$/;
var ORIGIN2 = "https://dothegy.github.io";
var cors = {
  ...HEAD,
  Vary: "Origin",
  "Access-Control-Allow-Origin": ORIGIN2,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var ROLE = "set local role service_role";
async function deriveKey(master) {
  if (typeof master !== "string" || master.length < 16) throw Error("Partyum signing unavailable");
  const base = await crypto.subtle.importKey("raw", encode.encode(master), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "HKDF",
    hash: "SHA-256",
    salt: encode.encode("sanji internal partyum v1"),
    info: encode.encode("ui plan authentication")
  }, base, 256));
}
function makePartyumPulseConsumer({ pool: pool2, initTx = (q) => q.query(ROLE) }) {
  return async () => {
    const q = await pool2.connect();
    try {
      await q.query("begin");
      await initTx(q);
      await q.query("set local statement_timeout='3000ms'");
      const { rows } = await q.query(`with g as (
      select minute_bucket from sanji_partyum_internal.worker_pulses
       where project_id=$1 and minute_bucket=date_trunc('minute',clock_timestamp())
        and consumed_at is null and expires_at>clock_timestamp()
       limit 1 for update skip locked
     ), claimed as (
      update sanji_partyum_internal.worker_pulses p set consumed_at=clock_timestamp() from g
      where p.project_id=$1 and p.minute_bucket=g.minute_bucket returning p.project_id
     ) insert into sanji_partyum_internal.worker_health(project_id,wake_ready,checked_at)
       select project_id,true,clock_timestamp() from claimed
       on conflict(project_id) do update set wake_ready=true,checked_at=excluded.checked_at
       returning project_id`, [PROJECT]);
      const got = rows.length === 1 && rows[0].project_id === PROJECT;
      await q.query("commit");
      return got;
    } catch {
      try {
        await q.query("rollback");
      } catch {
      }
      return false;
    } finally {
      q.release();
    }
  };
}
async function boundedRead(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(len) || len > 12e3) throw Error("REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw Error("REQUEST");
  let size = 0, s = "";
  const d = new TextDecoder("utf-8", { fatal: true });
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12e3) {
      void reader.cancel().catch(() => {
      });
      throw Error("SIZE");
    }
    s += d.decode(value, { stream: true });
  }
  return JSON.parse(s + d.decode());
}
function bearer(request) {
  const a = request.headers.get("authorization") ?? "";
  return a.length <= 8192 ? /^Bearer ([^\s,]+)$/i.exec(a)?.[1] : null;
}
function deferPartyumWork(waitUntil2, run, onError = async () => {
}) {
  if (typeof waitUntil2 !== "function") return false;
  let launch;
  const tracked = new Promise((resolve) => {
    launch = resolve;
  }).then((go) => go ? run() : void 0).catch(async (e) => {
    try {
      await onError(e);
    } catch {
    }
  });
  try {
    waitUntil2(tracked);
  } catch {
    launch(false);
    return false;
  }
  launch(true);
  return true;
}
function createPartyumNativeWorkerHandler({ consume, enabled, runDue, markUnhealthy, waitUntil: waitUntil2 }) {
  return async (request) => {
    const json = (body, code = 200) => Response.json(body, { headers: HEAD, status: code });
    const target = new URL(request.url);
    if (request.method !== "POST" || request.headers.has("origin") || target.search || !target.pathname.endsWith("/youtube-wedding-mail-worker") || request.headers.get("x-sanji-partyum-wake") !== "native-v1") return json({ error: "METHOD" }, 405);
    let hint;
    try {
      hint = await boundedRead(request);
    } catch {
      return json({ error: "REQUEST" }, 400);
    }
    if (!hint || Object.getPrototypeOf(hint) !== Object.prototype || Object.keys(hint).length !== 0) return json({ error: "REQUEST" }, 400);
    if (typeof waitUntil2 !== "function") return json({ error: "WORKER" }, 503);
    try {
      if (!await consume()) return new Response(null, { status: 202, headers: HEAD });
    } catch {
      return json({ error: "WORKER" }, 503);
    }
    if (await enabled() && !deferPartyumWork(waitUntil2, () => runDue({ limit: PARTYUM_WORK_POLICY.nativeBatch }), markUnhealthy)) {
      try {
        await markUnhealthy();
      } catch {
      }
      return json({ error: "WORKER" }, 503);
    }
    return new Response(null, { status: 202, headers: HEAD });
  };
}
async function createPartyumProductionRuntime({
  pool: pool2,
  sb: sb2,
  env: env2,
  waitUntil: waitUntil2,
  request = fetch,
  initTx = (q) => q.query(ROLE),
  now = Date.now
}) {
  if (!pool2?.connect || !sb2?.auth?.getUser || typeof env2 !== "function") throw Error("Partyum service missing");
  const readControl = createPartyumControls({ pool: pool2, initTx, env: env2 });
  const enabled = async (q) => (await readControl(q)).allowed;
  const legacy = createPartyumStatusReaders(sb2);
  const authenticate = async (token) => {
    const who = await legacy.authenticate(token);
    return exactOwner.test(who ?? "") ? who : null;
  };
  const gmail = createPartyumGmail({ env: env2, request, now, isEnabled: enabled, readConnection: async (q, owner) => {
    if (!UUID.test(owner ?? "")) return null;
    if (q) {
      const { rows } = await q.query(`select owner,provider,encrypted,summary from public.sanji_connections
    where owner=$1 and provider='gmail' limit 2 for share`, [owner]);
      return rows.length === 1 ? rows[0] : null;
    }
    const r = await sb2.from("sanji_connections").select("owner,provider,encrypted,summary").eq("owner", owner).eq("provider", "gmail").maybeSingle();
    return r.error ? null : r.data;
  } });
  const db = createPartyumPostgres({
    pool: pool2,
    initTx,
    resolveSender: gmail.resolveSender,
    readHoldingLegacyEvidence: readPartyumHoldingLegacyEvidence,
    reviewedCopyDigest: async (q, owner, digest) => (await q.query(`select content_digest from sanji_partyum_internal.copy_attestations
   where owner=$1 and content_digest=$2`, [owner, digest])).rows[0]?.content_digest ?? null
  });
  const runDue = createPartyumDueExecutor({ ...db, now, deliver: gmail.deliver, parallelism: PARTYUM_WORK_POLICY.parallelism });
  const consume = makePartyumPulseConsumer({ pool: pool2, initTx });
  let signingKey;
  const mail = createPartyumMailHandler({ authenticate, mail: async (actor, input) => {
    const project2 = await sb2.from("sanji_private_wedding_projects").select("owner").eq("owner", actor).maybeSingle();
    if (project2.error || project2.data?.owner !== actor) throw Object.assign(Error("AUTH"), { code: "AUTH" });
    const decision = await readControl();
    if (!decision.allowed) throw Object.assign(Error(decision.code), { code: decision.code });
    signingKey ??= deriveKey(env2("TOKEN_ENCRYPTION_KEY"));
    const mail2 = createPartyumMail({ secret: await signingKey, loadSnapshot: db.loadSnapshot, admitAtomic: db.admitAtomic, readReplay: db.readReplay, now });
    const answer2 = await mail2(actor, input);
    if (answer2.state === "queued") {
      deferPartyumWork(waitUntil2, async () => {
        if (await enabled()) await runDue({ limit: PARTYUM_WORK_POLICY.immediateBatch });
      }, () => db.heartbeat({ ready: false }));
    }
    return answer2;
  } });
  const combined = createPartyumCombinedStatus({
    readLegacy: (scope) => readPartyumDayStatus({
      actor: scope.actor,
      input: { projectId: scope.projectId, day: scope.day, channelIds: scope.channelIds },
      readShortlist: legacy.readShortlist,
      readSnapshot: legacy.readSnapshot,
      now
    }),
    readLedger: db.readStatusEvidence
  });
  const status = async (request2) => {
    const json = (body, code = 200) => Response.json(body, { headers: cors, status: code });
    const origin = request2.headers.get("origin");
    if (origin && origin !== ORIGIN2) return json({ error: "ORIGIN" }, 403);
    if (request2.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
    if (request2.method !== "POST") return json({ error: "METHOD" }, 405);
    const token = bearer(request2);
    if (!token) return json({ error: "AUTH" }, 401);
    let actor, input;
    try {
      actor = await authenticate(token);
    } catch {
    }
    if (!actor) return json({ error: "AUTH" }, 401);
    try {
      input = await boundedRead(request2);
    } catch (e) {
      return json({ error: e?.message === "SIZE" ? "SIZE" : "REQUEST" }, e?.message === "SIZE" ? 413 : 400);
    }
    if (!input || Object.keys(input).sort().join(",") !== "channelIds,day,projectId" || input.projectId !== PROJECT || typeof input.day !== "string" || !date.test(input.day) || !Array.isArray(input.channelIds) || input.channelIds.length < 1 || input.channelIds.length > 100 || !input.channelIds.every((x) => typeof x === "string" && channel3.test(x)) || new Set(input.channelIds).size !== input.channelIds.length) return json({ error: "SCOPE" }, 400);
    try {
      return json(await combined({ actor, ...input }));
    } catch {
      return json({ error: "READ" }, 503);
    }
  };
  const worker = createPartyumNativeWorkerHandler({
    consume,
    enabled,
    waitUntil: waitUntil2,
    runDue: async (options) => {
      if (await enabled()) return runDue(options);
    },
    markUnhealthy: () => db.heartbeat({ ready: false })
  });
  return { handleMail: mail, handleStatus: status, handleWorker: worker };
}

// edge/clients.ts
var env = (name) => Deno.env.get(name) || "";
var url = env("SUPABASE_URL");
var role = env("SUPABASE_SERVICE_ROLE_KEY");
var dsn = env("SUPABASE_DB_URL");
if (!url || !role || !dsn) throw Error("Partyum standard service environment is absent");
var sb = createClient(url, role, { auth: { persistSession: false, autoRefreshToken: false } });
var connection = new URL(dsn);
if (!["postgres:", "postgresql:"].includes(connection.protocol)) throw Error("Invalid standard Partyum connection scheme");
for (const k of [...connection.searchParams.keys()]) {
  if (["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslcertmode", "uselibpqcompat"].includes(k.toLowerCase())) connection.searchParams.delete(k);
}
var pool = new pg.Pool({
  connectionString: connection.toString(),
  max: 2,
  idleTimeoutMillis: 5e3,
  connectionTimeoutMillis: 3200,
  statement_timeout: 12e3,
  ssl: { rejectUnauthorized: true }
});
var scheduler = globalThis.EdgeRuntime;
var waitUntil = typeof scheduler?.waitUntil === "function" ? (p) => scheduler.waitUntil(p) : void 0;
var clients_default = await createPartyumProductionRuntime({ pool, sb, env, waitUntil });

// edge/mail.ts
Deno.serve(clients_default.handleMail);
