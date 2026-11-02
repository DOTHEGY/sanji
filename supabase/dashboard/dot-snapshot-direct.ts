// supabase/functions/dot-snapshot-direct/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";

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

// supabase/functions/_shared/dot-snapshot.ts
var metrics = ["target", "checked_attempts", "unique_handles", "new_saved", "existing_on_import", "duplicates_preskipped", "failed_attempts", "recovered_failures", "unresolved_failures", "pending_submissions", "reserved_remaining", "available_remaining"];
var id = /^[a-zA-Z0-9._:-]{1,128}$/;
function validateDotSnapshot(value, now = Date.now()) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw Error("\uC2A4\uB0C5\uC0F7 \uAC1D\uCCB4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const permitted = /* @__PURE__ */ new Set(["schema_version", "snapshot_id", "ledger_generation_id", "revision", "day", "timezone", "source_as_of", "last_profile_observed_at", "sources", "metrics", "coverage", "execution", "login", "database_audit", "warnings", "exported_at", "runs"]);
  if (Object.keys(value).some((k) => !permitted.has(k))) throw Error("\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uD544\uB4DC\uAC00 \uC788\uC2B5\uB2C8\uB2E4.");
  if (value.schema_version !== "sanji.collection.snapshot.v1" || value.timezone !== "Asia/Seoul" || !id.test(value.snapshot_id || "") || !id.test(value.ledger_generation_id || "") || !id.test(value.revision || "")) throw Error("\uC2A4\uB0C5\uC0F7 \uC2DD\uBCC4 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || (/* @__PURE__ */ new Date(value.day + "T00:00:00Z")).toISOString().slice(0, 10) !== value.day) throw Error("\uB0A0\uC9DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (!value.metrics || Array.isArray(value.metrics) || typeof value.metrics !== "object") throw Error("\uC9C0\uD45C\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const keys = [...metrics, "known_unique_handles", "usage_cost"];
  if (Object.keys(value.metrics).some((k) => !keys.includes(k))) throw Error("\uC54C \uC218 \uC5C6\uB294 \uC9C0\uD45C\uC785\uB2C8\uB2E4.");
  for (const k of keys) {
    const n = value.metrics[k];
    if (n !== null && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || k !== "usage_cost" && !Number.isSafeInteger(n))) throw Error(k + " \uAC12\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  const stamp = (s) => typeof s === "string" && Number.isFinite(Date.parse(s)) && /(Z|[+-]\d\d:\d\d)$/.test(s) && Date.parse(s) <= now + 3e5;
  if (!stamp(value.source_as_of) || !stamp(value.exported_at) || Date.parse(value.source_as_of) > Date.parse(value.exported_at)) throw Error("\uAD00\uCC30 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (value.last_profile_observed_at !== null && !stamp(value.last_profile_observed_at)) throw Error("\uD504\uB85C\uD544 \uAD00\uCC30 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (const k of ["coverage", "execution", "login"]) if (!value[k] || Array.isArray(value[k]) || typeof value[k] !== "object") throw Error(k + " \uC815\uBCF4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  if (value.database_audit !== null && (!value.database_audit || Array.isArray(value.database_audit) || typeof value.database_audit !== "object")) throw Error("database_audit \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (const t of [value.login.observed_at, value.database_audit?.observed_at]) if (t != null && (!stamp(t) || Date.parse(t) > Date.parse(value.exported_at))) throw Error("\uBCF4\uC644 \uAD00\uCC30 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (const k of ["sources", "warnings", "runs"]) if (!Array.isArray(value[k]) || value[k].length > 1e3) throw Error(k + " \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const inspect = (x, depth = 0) => {
    if (depth > 8) throw Error("\uC2A4\uB0C5\uC0F7 \uAD6C\uC870\uAC00 \uB108\uBB34 \uAE4A\uC2B5\uB2C8\uB2E4.");
    if (typeof x === "string" && (x.length > 1e3 || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(x) || /\b(?:sk-|bearer\s+|eyJ[a-zA-Z0-9_-]{16})/i.test(x) || /(?:\/workspace\/|\/home\/|\/tmp\/)/i.test(x))) throw Error("\uC9D1\uACC4\uC5D0 \uAC1C\uC778 \uC815\uBCF4\uB098 \uBE44\uBC00\uAC12\uC744 \uD3EC\uD568\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (Array.isArray(x)) {
      if (x.length > 1e3) throw Error("\uBAA9\uB85D\uC774 \uB108\uBB34 \uAE41\uB2C8\uB2E4.");
      for (const v of x) inspect(v, depth + 1);
    } else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      if (/token|secret|password|cookie|email|handle|path/i.test(k) && !["unique_handles", "known_unique_handles"].includes(k)) throw Error("\uAC1C\uC778\uC815\uBCF4\uB098 \uBE44\uBC00 \uD544\uB4DC\uB294 \uC800\uC7A5\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      inspect(v, depth + 1);
    }
  };
  inspect(value);
  if (JSON.stringify(value).length > 25e4) throw Error("\uC2A4\uB0C5\uC0F7\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
  return value;
}

// supabase/functions/_shared/dot-snapshot-projection.ts
var projectDotSnapshot = (snapshot, now) => {
  const p = snapshot.payload, m = p.metrics || {}, q = p.coverage || {}, group = (k) => ({ target: "checked_attempts", checked_attempts: "checked_attempts", pending_submissions: "checked_attempts", reserved_remaining: "checked_attempts", available_remaining: "checked_attempts", unique_handles: "unique_handles", known_unique_handles: "unique_handles", new_saved: "outcomes", existing_on_import: "outcomes", duplicates_preskipped: "outcomes", failed_attempts: "outcomes", recovered_failures: "outcomes", unresolved_failures: "outcomes", usage_cost: "usage_cost" })[k] || k, quality = (k) => {
    const entry = q[group(k)];
    return typeof entry === "string" ? entry : entry?.status || entry?.quality || "unavailable";
  }, v = (k) => quality(k) === "complete" && typeof m[k] === "number" && Number.isFinite(m[k]) ? m[k] : null, observed = p.login?.observed_at, age = observed ? Date.parse(now) - Date.parse(observed) : Infinity, loginState = age >= 0 && age <= 9e5 && !p.login?.stale ? p.login?.current_state : "unknown";
  return { day: p.day, checked: v("checked_attempts"), uniqueHandles: v("unique_handles"), failed: v("unresolved_failures"), goal: v("target"), remaining: v("available_remaining"), existing: v("existing_on_import"), preskipped: v("duplicates_preskipped"), newSaved: v("new_saved"), failedAttempts: v("failed_attempts"), recoveredFailures: v("recovered_failures"), pending: v("pending_submissions"), reserved: v("reserved_remaining"), state: Date.parse(now) - Date.parse(p.source_as_of) <= 9e5 ? p.execution?.state || "unavailable" : "unavailable", loginState, stateObservedAt: observed || null, sourceAsOf: p.source_as_of, receivedAt: snapshot.received_at, coverage: q };
};

// supabase/functions/dot-snapshot-direct/handler.ts
function dotSnapshotHandler({ sb: sb2, query: query2, env: env2, digest: digest2 }) {
  const origin = env2("APP_ORIGIN") || "https://dothegy.github.io";
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Vary": "Origin", "Cache-Control": "no-store" };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
  return async (req) => {
    try {
      if (req.headers.get("origin") && req.headers.get("origin") !== origin) return json({ error: "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98" }, 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const { path } = functionRoute(req.url, env2("SUPABASE_URL")), auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) return json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 401);
      const session = await sb2.auth.getUser(auth.slice(7)), owner = session?.data?.user?.id;
      if (session?.error || !owner) return json({ error: "\uB85C\uADF8\uC778 \uC138\uC158\uC744 \uD655\uC778\uD558\uC138\uC694." }, 401);
      const member = await query2(sb2.from("sanji_members").select("user_id").eq("user_id", owner).maybeSingle());
      if (!member) return json({ error: "\uC811\uADFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
      const input = async () => {
        const max = 3e5, announced = Number(req.headers.get("content-length") || 0);
        if (Number.isFinite(announced) && announced > max) throw Error("\uC2A4\uB0C5\uC0F7\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
        if (!req.body) return {};
        const reader = req.body.getReader(), chunks = [];
        let size = 0;
        for (; ; ) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > max) {
            await reader.cancel();
            throw Error("\uC2A4\uB0C5\uC0F7\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        const raw = new TextDecoder().decode(bytes);
        return raw ? JSON.parse(raw) : {};
      };
      if (path === "/dot-snapshot" && req.method === "GET") {
        const heads = await query2(sb2.from("sanji_dot_snapshot_head").select("snapshot_id,day").eq("owner", owner).order("day", { ascending: false }).limit(30));
        if (!Array.isArray(heads)) throw Error("\uC870\uD68C \uC2E4\uD328");
        const rows = heads.length ? await query2(sb2.from("sanji_dot_snapshot").select("snapshot_id,payload,received_at").eq("owner", owner).in("snapshot_id", heads.map((h) => h.snapshot_id))) : [];
        if (!Array.isArray(rows)) throw Error("\uC870\uD68C \uC2E4\uD328");
        const now = (/* @__PURE__ */ new Date()).toISOString(), items = rows.map((row) => {
          const p = validateDotSnapshot(row.payload);
          const a = p.database_audit, observed = typeof a?.observed_at === "string" && Number.isFinite(Date.parse(a.observed_at));
          return { ...projectDotSnapshot(row, now), databaseTotal: observed && Number.isSafeInteger(a?.total_creators) && a.total_creators >= 0 ? a.total_creators : null, databaseNewSaved: observed && a?.day === p.day && Number.isSafeInteger(a?.new_saved) && a.new_saved >= 0 ? a.new_saved : null, databaseObservedAt: observed ? a.observed_at : null };
        }).sort((a, b) => b.day.localeCompare(a.day));
        return json({ items, checkedAt: now });
      }
      if (path === "/dot-snapshot/preview" && req.method === "POST") {
        const snapshot = validateDotSnapshot(await input()), previewHash = await digest2(owner + "\n" + JSON.stringify(snapshot));
        return json({ snapshot, previewHash });
      }
      if (path === "/dot-snapshot/commit" && req.method === "POST") {
        const b = await input(), snapshot = validateDotSnapshot(b.snapshot), hash = await digest2(owner + "\n" + JSON.stringify(snapshot));
        if (b.previewHash !== hash) return json({ error: "\uB2E4\uC2DC \uBBF8\uB9AC\uBCF4\uAE30\uB97C \uD655\uC778\uD558\uC138\uC694." }, 409);
        return json(await query2(sb2.rpc("sanji_store_dot_snapshot", { p_owner: owner, p_data: snapshot })));
      }
      return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACBD\uB85C" }, 404);
    } catch {
      return json({ error: "\uC6D0\uC7A5 \uC694\uCCAD\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC790\uB8CC\uC640 \uC5F0\uACB0 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694." }, 400);
    }
  };
}

// supabase/functions/dot-snapshot-direct/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
async function query(p) {
  const { data, error } = await p;
  if (error) throw Error("database request failed");
  return data;
}
var digest = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
Deno.serve(dotSnapshotHandler({ sb, query, env, digest }));
