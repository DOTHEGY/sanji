// supabase/functions/creator-one-click/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/creator-one-click/handler.mjs
var uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function createHandler({ origin, auth, member, getRun, getCurrentTemplate, getLatest, start, adopt, verifyExistingManifest, storeTemplate, skip, pause, enqueue, process, reconcile, verifyApprovedDraft }) {
  if (typeof origin !== "string" || ![auth, member, getRun, start, skip, enqueue].every((x) => typeof x === "function")) throw Error("missing trusted adapter");
  const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,apikey,content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Cache-Control": "no-store", "Vary": "Origin" };
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...headers, "Content-Type": "application/json" } });
  return async (req) => {
    try {
      const requestOrigin = req.headers.get("origin");
      if (requestOrigin && requestOrigin !== origin) return json({ error: "\uCD9C\uCC98\uB97C \uD655\uC778\uD558\uC138\uC694." }, 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      const bearer = req.headers.get("authorization") || "";
      if (!bearer.startsWith("Bearer ")) return json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 401);
      const owner = await auth(bearer.slice(7));
      if (!uuid(owner)) return json({ error: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 401);
      if (!await member(owner)) return json({ error: "\uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
      const url = new URL(req.url), action = url.pathname.split("/").filter(Boolean).at(-1);
      if (req.method === "GET" && action === "run") {
        const run = url.searchParams.get("id");
        if (!uuid(run)) return json({ error: "\uC2E4\uD589\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        const data = await getRun(owner, run);
        return data ? json(data) : json({ error: "\uC2E4\uD589\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }, 404);
      }
      if (req.method === "GET" && action === "latest") {
        if (typeof getLatest !== "function") return json({ error: "\uC870\uD68C\uAC00 \uBD88\uAC00\uB2A5\uD569\uB2C8\uB2E4." }, 503);
        return json(await getLatest(owner));
      }
      if (req.method === "GET" && action === "template-current") {
        if (typeof getCurrentTemplate !== "function") return json({ error: "\uC870\uD68C\uAC00 \uBD88\uAC00\uB2A5\uD569\uB2C8\uB2E4." }, 503);
        return json(await getCurrentTemplate(owner));
      }
      if (req.method !== "POST" || !["template", "start", "adopt", "skip", "pause", "process", "reconcile"].includes(action)) return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC694\uCCAD" }, 404);
      const announced = Number(req.headers.get("content-length") || 0);
      if (Number.isFinite(announced) && announced > 65536) return json({ error: "\uC694\uCCAD\uC774 \uB108\uBB34 \uAE41\uB2C8\uB2E4." }, 413);
      let size = 0, chunks = [];
      if (req.body) {
        const reader = req.body.getReader();
        for (; ; ) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            return json({ error: "\uC694\uCCAD\uC774 \uB108\uBB34 \uAE41\uB2C8\uB2E4." }, 413);
          }
          chunks.push(part.value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let b;
      try {
        b = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ error: "\uC694\uCCAD\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
      }
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "\uC694\uCCAD\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
      if (action === "template") {
        if (Object.keys(b).some((k) => !["subject", "body", "approved"].includes(k)) || b.approved !== true || b.subject !== "\uB3C4\uD569 300\uB9CC \uD06C\uB9AC\uC5D0\uC774\uD130\uC640 \uD568\uAED8 \uC77C\uD558\uB294 \uB0A8\uC900\uD601 \uBCC0\uB9AC\uC0AC\uC785\uB2C8\uB2E4" || typeof b.body !== "string" || b.body.length > 15e3 || !b.body.includes("{{\uC544\uC774\uB514}}") || !b.body.includes("{{\uC0C1\uD488\uBA85}}") || typeof storeTemplate !== "function") return json({ error: "\uC2B9\uC778\uB41C \uD15C\uD50C\uB9BF\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        return json({ sha256: await storeTemplate(owner, b.subject, b.body, true) });
      }
      if (!uuid(b.runId)) return json({ error: "\uC2E4\uD589\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
      if (action === "pause") {
        if (Object.keys(b).some((k) => !["runId", "paused"].includes(k)) || typeof b.paused !== "boolean" || typeof pause !== "function") return json({ error: "\uC9C4\uD589 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694." }, 400);
        return json({ ok: await pause(owner, b.runId, b.paused) });
      }
      if (action === "start") {
        if (Object.keys(b).some((k) => !["runId", "day", "target", "templateSha256", "approved"].includes(k)) || b.approved !== true || !/^\d{4}-\d{2}-\d{2}$/.test(b.day || "") || !Number.isInteger(b.target) || b.target < 1 || b.target > 500 || !/^[a-f0-9]{64}$/.test(b.templateSha256 || "")) return json({ error: "\uCD94\uCC9C \uC124\uC815\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        if (typeof verifyApprovedDraft !== "function" || !await verifyApprovedDraft({ owner, templateSha256: b.templateSha256, phase: "start" })) return json({ error: "\uC2B9\uC778\uB41C \uD15C\uD50C\uB9BF \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 409);
        return json(await start(owner, b.runId, b.day, b.target, b.templateSha256));
      }
      if (action === "adopt") {
        if (Object.keys(b).some((k) => !["runId", "day", "creatorIds", "templateSha256", "approved"].includes(k)) || b.approved !== true || !/^\d{4}-\d{2}-\d{2}$/.test(b.day || "") || !Array.isArray(b.creatorIds) || b.creatorIds.length < 1 || b.creatorIds.length > 500 || b.creatorIds.some((x) => !uuid(x)) || new Set(b.creatorIds).size !== b.creatorIds.length || !/^[a-f0-9]{64}$/.test(b.templateSha256 || "") || typeof adopt !== "function") return json({ error: "\uD655\uC815\uB41C \uCD94\uCC9C \uBAA9\uB85D\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        if (typeof verifyApprovedDraft !== "function" || !await verifyApprovedDraft({ owner, templateSha256: b.templateSha256, phase: "start" })) return json({ error: "\uC2B9\uC778\uB41C \uD15C\uD50C\uB9BF \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 409);
        if (typeof verifyExistingManifest !== "function" || !await verifyExistingManifest(owner, b.creatorIds)) return json({ error: "\uAE30\uC874 \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4." }, 409);
        return json(await adopt(owner, b.runId, b.day, b.creatorIds, b.templateSha256, true));
      }
      if (!uuid(b.creatorId)) return json({ error: "\uB300\uC0C1\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
      if (action === "process") {
        if (Object.keys(b).some((k) => !["runId", "creatorId"].includes(k)) || typeof process !== "function") return json({ error: "\uCC98\uB9AC \uB300\uC0C1\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        return json(await process(owner, b.runId, b.creatorId, bearer.slice(7)));
      }
      if (action === "reconcile") {
        if (Object.keys(b).some((k) => !["runId", "creatorId"].includes(k)) || typeof reconcile !== "function") return json({ error: "\uC0C1\uD0DC \uD655\uC778 \uC694\uCCAD\uC744 \uD655\uC778\uD558\uC138\uC694." }, 400);
        return json({ status: await reconcile(owner, b.runId, b.creatorId) });
      }
      if (action === "skip") {
        if (Object.keys(b).some((k) => !["runId", "creatorId", "reason"].includes(k)) || !["identity_unverified", "contact_status", "email_unverified", "product_evidence_missing", "draft_unavailable", "review_existing", "address_conflict", "signature_unavailable", "tracking_notice_unavailable", "external_contact"].includes(b.reason)) return json({ error: "\uC81C\uC678 \uC0AC\uC720\uB97C \uD655\uC778\uD558\uC138\uC694." }, 400);
        return json({ ok: await skip(owner, b.runId, b.creatorId, b.reason) });
      }
      return json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC694\uCCAD" }, 404);
    } catch {
      return json({ error: "\uCC98\uB9AC \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694. \uACB0\uACFC\uAC00 \uBD88\uBA85\uD655\uD558\uBA74 \uB2E4\uC2DC \uBC1C\uC1A1\uD558\uC9C0 \uB9C8\uC138\uC694." }, 503);
    }
  };
}
async function submitThroughEngine({ claim, forward, reconcile }) {
  const state = await claim();
  if (state !== "claimed") return { status: state };
  try {
    await forward();
  } catch {
  }
  return { status: await reconcile() };
}

// supabase/functions/creator-one-click/plan.mjs
var topics = (x) => new Set((Array.isArray(x) ? x : []).filter((v) => typeof v === "string").map((v) => v.trim().toLocaleLowerCase()).filter((v) => v.length >= 2 && v.length <= 40 && !/[\x00-\x1f]/.test(v) && !/(질병|질환|치료|진단|환자|복용|임신|불임|우울증|pregnan|diabet|disease|illness|patient|medicat|cancer|therapy|depress)/i.test(v)));
function validLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !!u.hostname;
  } catch {
    return false;
  }
}
function planCreator(row, deals) {
  const handle = String(row?.handle || "").replace(/^@/, "").toLowerCase();
  if (!row?.id || !/^[a-z0-9._]{1,30}$/.test(handle)) return { status: "skip", reason: "\uACC4\uC815 \uD655\uC778 \uD544\uC694" };
  if (row.status !== "new") return { id: row.id, handle, status: "skip", reason: "\uC5F0\uB77D \uC0C1\uD0DC \uD655\uC778 \uD544\uC694" };
  if (row.bio_status !== "email_present" || row.link_status !== "source_confirmed" || !Array.isArray(row.emails) || row.emails.length !== 1 || !/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(row.emails[0]) || !String(row.bio || "").toLowerCase().includes(row.emails[0].toLowerCase())) return { id: row.id, handle, status: "skip", reason: "\uACF5\uAC1C \uC774\uBA54\uC77C \uD655\uC778 \uD544\uC694" };
  let source;
  try {
    source = new URL(row.profile_url);
  } catch {
  }
  if (!source || source.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(source.hostname) || source.username || source.password || source.search || source.hash || source.pathname.replace(/\/$/, "").toLowerCase() !== "/" + handle) return { id: row.id, handle, status: "skip", reason: "\uC774\uBA54\uC77C \uCD9C\uCC98 \uD655\uC778 \uD544\uC694" };
  const category = typeof row.category === "string" ? row.category.split(/[,·/]/) : [];
  const match = topics([...Array.isArray(row.topics) ? row.topics : [], ...category]), found = [];
  for (const d of Array.isArray(deals) ? deals : []) {
    const productTopics = topics(d?.topics), overlap = [...productTopics].filter((t) => match.has(t));
    if (!d?.id || !d.name || !validLink(d.productUrl) || !["\uD655\uC815", "\uD611\uC758 \uC911"].includes(d.state) || !overlap.length || d.stock === 0 || d.soldOut === true || d.availability === "sold_out" || /품절/.test(String(d.sourceNote || "") + " " + String(d.note || ""))) continue;
    found.push({ id: d.id, name: d.name, productUrl: d.productUrl, overlap });
  }
  const unique = [...new Map(found.map((d) => [d.id, d])).values()];
  unique.sort((a, b) => b.overlap.length - a.overlap.length || String(a.id).localeCompare(String(b.id)));
  if (!unique.length) return { id: row.id, handle, status: "skip", reason: "\uC801\uD569\uD55C \uC0C1\uD488 \uC5F0\uAD00 \uADFC\uAC70 \uD544\uC694" };
  return { id: row.id, handle, status: "ready_for_verification", email: row.emails[0], sourceUrl: row.profile_url, products: [unique[0]] };
}

// supabase/functions/creator-one-click/template.mjs
import { createHash } from "node:crypto";
var SUBJECT = "\uB3C4\uD569 300\uB9CC \uD06C\uB9AC\uC5D0\uC774\uD130\uC640 \uD568\uAED8 \uC77C\uD558\uB294 \uB0A8\uC900\uD601 \uBCC0\uB9AC\uC0AC\uC785\uB2C8\uB2E4";
function renderApprovedTemplate(template, plan) {
  if (!template || template.userApproved !== true || template.subject !== SUBJECT || typeof template.body !== "string" || !/^[a-f0-9]{64}$/.test(template.sha256 || "")) throw Error("\uC0AC\uC6A9\uC790\uAC00 \uC2B9\uC778\uD55C \uD15C\uD50C\uB9BF \uD655\uC778 \uD544\uC694");
  const digest = createHash("sha256").update(template.subject + "\n" + template.body, "utf8").digest("hex");
  if (digest !== template.sha256) throw Error("\uD15C\uD50C\uB9BF \uBC84\uC804 \uBD88\uC77C\uCE58");
  if (!plan?.handle || plan?.products?.length !== 1) throw Error("\uACC4\uC815\uACFC \uC0C1\uD488 1\uAC1C \uD655\uC778 \uD544\uC694");
  const body = template.body;
  if (!body.includes("{{\uC544\uC774\uB514}}") || !body.includes("{{\uC0C1\uD488\uBA85}}")) throw Error("\uD15C\uD50C\uB9BF \uBCC0\uC218 \uD655\uC778 \uD544\uC694");
  if (/\{\{(?!아이디\}\}|상품명\}\})[^{}]+\}\}/.test(body)) throw Error("\uBBF8\uC9C0\uC6D0 \uD15C\uD50C\uB9BF \uBCC0\uC218");
  return { subject: SUBJECT, body: body.replaceAll("{{\uC544\uC774\uB514}}", () => plan.handle).replaceAll("{{\uC0C1\uD488\uBA85}}", () => plan.products[0].name), templateSha256: digest };
}

// supabase/functions/creator-one-click/processor.mjs
async function processOne({ owner, runId, creatorId, loadRun: loadRun2, loadContext: loadContext2, loadTemplate: loadTemplate2, verifyExternalHistory, callExisting, queue, markSkip, now = () => Date.now() }) {
  const run = await loadRun2(owner, runId), item = run?.items?.find((x) => x.creator_id === creatorId);
  if (!item) return { status: "unavailable" };
  if (run.paused === true) return { status: "paused" };
  if (item.status !== "pending") return { status: item.status, job: item.job || null };
  const ctx = await loadContext2(owner, runId, creatorId);
  if (!ctx || ctx.complete !== true) return { status: "stopped", reason: "\uC0C1\uD488 \uC804\uCCB4 \uBAA9\uB85D \uD655\uC778 \uD544\uC694" };
  const plan = planCreator(ctx.creator, ctx.deals);
  if (plan.status !== "ready_for_verification") {
    const reason = plan.reason === "\uACF5\uAC1C \uC774\uBA54\uC77C \uD655\uC778 \uD544\uC694" ? "email_unverified" : plan.reason === "\uC801\uD569\uD55C \uC0C1\uD488 \uC5F0\uAD00 \uADFC\uAC70 \uD544\uC694" ? "product_evidence_missing" : plan.reason === "\uC5F0\uB77D \uC0C1\uD0DC \uD655\uC778 \uD544\uC694" ? "contact_status" : "identity_unverified";
    const saved2 = await markSkip(owner, runId, creatorId, reason);
    return { status: saved2 ? "skipped" : "stopped", reason };
  }
  if (typeof verifyExternalHistory !== "function") return { status: "stopped", reason: "\uAE30\uC874 Gmail \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  let history;
  try {
    history = await verifyExternalHistory(owner, plan.email);
  } catch {
    return { status: "stopped", reason: "\uAE30\uC874 Gmail \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  }
  if (!history || history.complete !== true || history.account !== "valuest24@gmail.com" || !/^[a-f0-9]{64}$/.test(history.connectionFingerprint || "")) return { status: "stopped", reason: "\uAE30\uC874 Gmail \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  if (history.contacted !== false) {
    const saved2 = await markSkip(owner, runId, creatorId, "external_contact");
    return { status: saved2 ? "skipped" : "stopped", reason: "\uAE30\uC874 \uC5F0\uB77D \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  }
  const settings = ctx.settings || {}, signature = String(settings.emailSignature || "").trim(), mailbox = String(ctx.gmail?.email || "").toLowerCase();
  if (settings.signatureSource !== "gmail" || !signature || !settings.gmailSignatureHtml || mailbox !== "valuest24@gmail.com" || String(settings.gmailSignatureEmail || "").toLowerCase() !== mailbox) {
    const saved2 = await markSkip(owner, runId, creatorId, "signature_unavailable");
    return { status: saved2 ? "skipped" : "stopped", reason: "Gmail \uC11C\uBA85 \uD655\uC778 \uD544\uC694" };
  }
  const template = await loadTemplate2(owner, run.templateSha256);
  let proposal;
  try {
    proposal = renderApprovedTemplate(template, plan);
  } catch {
    return { status: "stopped", reason: "\uC2B9\uC778 \uD15C\uD50C\uB9BF \uD655\uC778 \uD544\uC694" };
  }
  const prior = ctx.review, prev = prior?.data || {}, old = prev.email || {};
  if (prior && (old.status && old.status !== "not_prepared" || old.subject || old.body || (old.productIds || []).length || old.observation)) {
    const saved2 = await markSkip(owner, runId, creatorId, "review_existing");
    return { status: saved2 ? "skipped" : "stopped", reason: "\uAE30\uC874 \uAC80\uD1A0 \uC790\uB8CC \uD655\uC778 \uD544\uC694" };
  }
  if (old.address && String(old.address).toLowerCase() !== plan.email.toLowerCase()) {
    const saved2 = await markSkip(owner, runId, creatorId, "address_conflict");
    return { status: saved2 ? "skipped" : "stopped", reason: "\uAE30\uC874 \uC8FC\uC18C \uD655\uC778 \uD544\uC694" };
  }
  const reviewData = { ...prev, email: { ...old, address: plan.email, sourceUrl: plan.sourceUrl, productIds: [plan.products[0].id], subject: proposal.subject, body: proposal.body, status: "reviewed" }, dm: prev.dm || {} };
  let saved;
  try {
    saved = await callExisting("/creator-contact-review", { creatorId, version: prior?.version || 0, data: reviewData });
  } catch {
    return { status: "stopped", reason: "\uAC80\uD1A0 \uC800\uC7A5 \uACB0\uACFC \uD655\uC778 \uD544\uC694" };
  }
  if (!Number.isInteger(saved?.version) || saved.version < 1) return { status: "stopped", reason: "\uAC80\uD1A0 \uC800\uC7A5 \uACB0\uACFC \uD655\uC778 \uD544\uC694" };
  let target, preview;
  try {
    target = await callExisting("/creator-proposal/target", { creatorId, version: saved.version });
    if (!target?.target) throw Error("target unavailable");
    preview = await callExisting("/drafts", { target: target.target, proposalType: "creator_product_proposal", creatorReviewId: creatorId, creatorReviewVersion: saved.version, dealIds: [plan.products[0].id], channel: "email", subject: proposal.subject, body: proposal.body, signature: "", attachments: [], recipientMode: "primary", marketing: false });
  } catch {
    return { status: "stopped", reason: "\uCD08\uC548 \uC900\uBE44 \uACB0\uACFC \uD655\uC778 \uD544\uC694" };
  }
  if (!preview?.id || !preview?.hash || String(preview.email || "").toLowerCase() !== plan.email.toLowerCase() || preview.subject !== proposal.subject || !preview.body) return { status: "stopped", reason: "\uCD08\uC548 \uAC80\uC99D \uD544\uC694" };
  const count = (text, part) => part ? text.split(part).length - 1 : 0, disclosure = String(preview.tracking?.disclosure || "");
  if (count(preview.body, signature) !== 1 || preview.tracking?.eligible !== true || preview.tracking?.testOnly !== false || !disclosure || count(preview.body, disclosure) !== 1) {
    const saved2 = await markSkip(owner, runId, creatorId, "tracking_notice_unavailable");
    return { status: saved2 ? "skipped" : "stopped", reason: "\uC11C\uBA85 \uB610\uB294 \uCD94\uC801 \uC548\uB0B4 \uD655\uC778 \uD544\uC694" };
  }
  try {
    history = await verifyExternalHistory(owner, plan.email);
  } catch {
    return { status: "stopped", reason: "\uAE30\uC874 Gmail \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  }
  if (!history || history.complete !== true || history.account !== "valuest24@gmail.com" || !/^[a-f0-9]{64}$/.test(history.connectionFingerprint || "")) return { status: "stopped", reason: "\uAE30\uC874 Gmail \uBC1C\uC1A1 \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  if (history.contacted !== false) {
    const saved2 = await markSkip(owner, runId, creatorId, "external_contact");
    return { status: saved2 ? "skipped" : "stopped", reason: "\uAE30\uC874 \uC5F0\uB77D \uC774\uB825 \uD655\uC778 \uD544\uC694" };
  }
  const runAt = new Date(now() + 12e4).toISOString();
  try {
    return await queue(owner, runId, creatorId, preview.id, preview.hash, runAt, history.connectionFingerprint);
  } catch {
    return { status: "outcome_unknown", reason: "\uC608\uC57D \uACB0\uACFC \uD655\uC778 \uD544\uC694 \xB7 \uC7AC\uC2DC\uB3C4 \uAE08\uC9C0" };
  }
}

// supabase/functions/creator-one-click/external-history.mjs
var validEmail = (x) => typeof x === "string" && x.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x);
async function safeJson(response) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(announced) && announced > 32768) return null;
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (; ; ) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      return null;
    }
    chunks.push(p.value);
  }
  const all = new Uint8Array(size);
  let n = 0;
  for (const c of chunks) {
    all.set(c, n);
    n += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return null;
  }
}
async function verifyGmailHistory({ owner, address, readConnection, decrypt, fetcher = fetch, now = Date.now }) {
  if (!owner || !validEmail(address) || typeof readConnection !== "function" || typeof decrypt !== "function") return null;
  try {
    const row = await readConnection(owner);
    if (!row || row.summary?.reauthRequired || String(row.summary?.email || "").toLowerCase() !== "valuest24@gmail.com" || typeof row.encrypted !== "string") return null;
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.encrypted))), (x) => x.toString(16).padStart(2, "0")).join("");
    const session = await decrypt(row.encrypted);
    if (String(session?.email || "").toLowerCase() !== "valuest24@gmail.com" || typeof session.access_token !== "string" || !session.access_token || !Number.isFinite(Number(session.expires)) || Number(session.expires) <= now() + 6e4) return null;
    const profile = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + session.access_token }, signal: AbortSignal.timeout(12e3) });
    if (!profile.ok) return null;
    const profileData = await safeJson(profile);
    if (String(profileData?.emailAddress || "").toLowerCase() !== "valuest24@gmail.com") return null;
    const email = address.toLowerCase(), query2 = 'in:sent {to:"' + email + '" cc:"' + email + '" bcc:"' + email + '"}', params = new URLSearchParams({ q: query2, maxResults: "1", includeSpamTrash: "true" });
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + params.toString(), { headers: { Authorization: "Bearer " + session.access_token }, signal: AbortSignal.timeout(12e3) });
    if (!response.ok) return null;
    const result = await safeJson(response);
    if (!result || typeof result !== "object" || Array.isArray(result) || !Number.isInteger(result.resultSizeEstimate) || result.resultSizeEstimate < 0 || result.messages !== void 0 && !Array.isArray(result.messages)) return null;
    const messages = result.messages || [];
    if (messages.length > 1 || messages.some((x) => !x || typeof x.id !== "string" || !x.id)) return null;
    if (messages.length > 0) return { complete: true, account: "valuest24@gmail.com", contacted: true, connectionFingerprint: fingerprint };
    if (result.resultSizeEstimate !== 0 || result.nextPageToken) return null;
    return { complete: true, account: "valuest24@gmail.com", contacted: false, connectionFingerprint: fingerprint };
  } catch {
    return null;
  }
}
async function decryptGmailConnection(encrypted, keyText) {
  if (!keyText || typeof encrypted !== "string") throw Error("unavailable");
  const packed = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  if (packed.length < 29) throw Error("unavailable");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyText)), key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.subarray(0, 12) }, key, packed.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

// supabase/functions/creator-one-click/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
async function query(p) {
  const { data, error } = await p;
  if (error) throw Error("database operation failed");
  return data;
}
var single = (v) => Array.isArray(v) ? v[0] : v;
async function fetchOwnedIds(table, fields, owner, ids) {
  const all = [];
  for (let i = 0; i < ids.length; i += 100) all.push(...await query(sb.from(table).select(fields).eq("owner", owner).in("id", ids.slice(i, i + 100))));
  return all;
}
async function loadRun(owner, id) {
  const run = await query(sb.from("sanji_creator_one_click_runs").select("id,day,target,template_sha256,created,run_kind,paused").eq("owner", owner).eq("id", id).maybeSingle());
  if (!run) return null;
  const rows = await query(sb.from("sanji_creator_one_click_items").select("creator_id,status,reason,job_id").eq("owner", owner).eq("run_id", id).order("created").limit(500));
  const ids = (rows || []).map((x) => x.job_id).filter(Boolean), jobs = ids.length ? await fetchOwnedIds("sanji_jobs", "id,status,run_at,result", owner, ids) : [];
  const byId = new Map((jobs || []).map((j) => [j.id, j]));
  const creatorIds = (rows || []).map((x) => x.creator_id), creators = creatorIds.length ? await fetchOwnedIds("sanji_creator_recovery", "id,handle", owner, creatorIds) : [];
  const handles = new Map((creators || []).map((c) => [c.id, c.handle]));
  return { id: run.id, day: run.day, target: run.target, templateSha256: run.template_sha256, runKind: run.run_kind, paused: run.paused, items: (rows || []).map((x) => {
    const j = x.job_id ? byId.get(x.job_id) : null;
    return { ...x, handle: handles.get(x.creator_id) || "", job: j ? { status: j.status, run_at: j.run_at, providerAccepted: j.status === "completed" && j.result?.status === "accepted" } : null };
  }) };
}
var loadTemplate = async (owner, sha) => {
  const t = await query(sb.from("sanji_creator_one_click_templates").select("subject,body,sha256,active").eq("owner", owner).eq("sha256", sha).maybeSingle());
  return t ? { ...t, userApproved: t.active === true } : null;
};
var loadContext = async (owner, id, creatorId) => {
  const item = await query(sb.from("sanji_creator_one_click_items").select("status").eq("owner", owner).eq("run_id", id).eq("creator_id", creatorId).maybeSingle());
  if (!item || item.status !== "pending") return null;
  const creator = await query(sb.from("sanji_creator_recovery").select("id,handle,emails,bio,bio_status,link_status,profile_url,status,category").eq("owner", owner).eq("id", creatorId).maybeSingle());
  if (!creator) return null;
  const review = await query(sb.from("sanji_creator_contact_review").select("creator_id,version,data").eq("owner", owner).eq("creator_id", creatorId).maybeSingle());
  const settings = await query(sb.from("sanji_records").select("data").eq("owner", owner).eq("kind", "settings").order("updated", { ascending: false }).limit(1).maybeSingle());
  const gmail = await query(sb.from("sanji_connections").select("summary").eq("owner", owner).eq("provider", "gmail").maybeSingle());
  let deals = [], complete = false;
  for (let start = 0; start < 2e3; start += 500) {
    const part = await query(sb.from("sanji_records").select("id,version,data").eq("owner", owner).eq("kind", "deal").order("id").range(start, start + 499));
    deals.push(...(part || []).map((d) => ({ ...d.data, id: d.id, version: d.version })));
    if ((part || []).length < 500) {
      complete = true;
      break;
    }
  }
  return { creator, review, deals, complete, settings: settings?.data || null, gmail: gmail?.summary || null };
};
var enqueueViaMail = async (owner, id, creator, draft, hash, at, token, connectionFingerprint) => {
  const anonKey = env("SUPABASE_ANON_KEY"), base = env("SUPABASE_URL");
  if (!anonKey || !base) throw Error("email engine unavailable");
  return await submitThroughEngine({
    claim: async () => single(await query(sb.rpc("sanji_creator_one_click_claim", { p_owner: owner, p_run: id, p_creator: creator, p_draft: draft, p_hash: hash, p_run_at: at, p_connection_fingerprint: connectionFingerprint }))),
    forward: async () => {
      const response = await fetch(base.replace(/\/$/, "") + "/functions/v1/bright-function/schedule", { method: "POST", headers: { Authorization: "Bearer " + token, apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ draftId: draft, hash, approved: true, runAt: at }), signal: AbortSignal.timeout(2e4) });
      await response.body?.cancel();
    },
    reconcile: async () => single(await query(sb.rpc("sanji_creator_one_click_reconcile", { p_owner: owner, p_run: id, p_creator: creator })))
  });
};
var handler = createHandler({
  origin: env("APP_ORIGIN") || "https://dothegy.github.io",
  auth: async (token) => {
    const r = await sb.auth.getUser(token);
    return r.error ? null : r.data.user?.id || null;
  },
  member: async (owner) => !!await query(sb.from("sanji_members").select("user_id").eq("user_id", owner).maybeSingle()),
  getRun: loadRun,
  getLatest: async (owner) => {
    const row = await query(sb.from("sanji_creator_one_click_runs").select("id").eq("owner", owner).order("created", { ascending: false }).limit(1).maybeSingle());
    return row ? await loadRun(owner, row.id) : null;
  },
  getCurrentTemplate: async (owner) => {
    const row = await query(sb.from("sanji_creator_one_click_templates").select("sha256").eq("owner", owner).eq("active", true).order("approved_at", { ascending: false }).limit(1).maybeSingle());
    return row ? await loadTemplate(owner, row.sha256) : null;
  },
  storeTemplate: async (owner, subject, body, approved) => single(await query(sb.rpc("sanji_creator_one_click_template", { p_owner: owner, p_subject: subject, p_body: body, p_approved: approved }))),
  start: async (owner, id, day, target, sha) => ({ count: single(await query(sb.rpc("sanji_creator_one_click_start", { p_owner: owner, p_run: id, p_day: day, p_target: target, p_template_sha256: sha }))) }),
  adopt: async (owner, id, day, ids, sha, approved) => ({ count: single(await query(sb.rpc("sanji_creator_one_click_adopt", { p_owner: owner, p_run: id, p_day: day, p_ids: ids, p_template_sha256: sha, p_approved: approved }))) }),
  skip: async (owner, id, creator, reason) => single(await query(sb.rpc("sanji_creator_one_click_skip", { p_owner: owner, p_run: id, p_creator: creator, p_reason: reason }))),
  pause: async (owner, id, paused) => single(await query(sb.rpc("sanji_creator_one_click_pause", { p_owner: owner, p_run: id, p_paused: paused }))),
  reconcile: async (owner, id, creator) => single(await query(sb.rpc("sanji_creator_one_click_reconcile", { p_owner: owner, p_run: id, p_creator: creator }))),
  enqueue: enqueueViaMail,
  process: async (owner, id, creatorId, token) => processOne({
    owner,
    runId: id,
    creatorId,
    loadRun,
    loadContext,
    loadTemplate,
    verifyExternalHistory: async (o, address) => verifyGmailHistory({ owner: o, address, readConnection: async (verifiedOwner) => query(sb.from("sanji_connections").select("encrypted,summary").eq("owner", verifiedOwner).eq("provider", "gmail").maybeSingle()), decrypt: async (encrypted) => decryptGmailConnection(encrypted, env("TOKEN_ENCRYPTION_KEY")) }),
    markSkip: async (o, r, c, reason) => single(await query(sb.rpc("sanji_creator_one_click_skip", { p_owner: o, p_run: r, p_creator: c, p_reason: reason }))),
    callExisting: async (path, body) => {
      const base = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
      if (!base || !key) throw Error("email engine unavailable");
      const response = await fetch(base.replace(/\/$/, "") + "/functions/v1/bright-function" + path, { method: "POST", headers: { Authorization: "Bearer " + token, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2e4) });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("mail preparation failed");
      }
      return await response.json();
    },
    queue: async (o, r, c, d, h, at, fingerprint) => enqueueViaMail(o, r, c, d, h, at, token, fingerprint)
  }),
  // The SQL claim function rechecks exact body, one available deal, creator and
  // non-marketing type. The existing /schedule route performs all mail preflights.
  verifyApprovedDraft: async (input) => {
    let sha = input.templateSha256;
    if (input.phase === "enqueue") {
      const run = await query(sb.from("sanji_creator_one_click_runs").select("template_sha256").eq("owner", input.owner).eq("id", input.runId).maybeSingle());
      if (!run) return false;
      sha = run.template_sha256;
    }
    if (!/^[a-f0-9]{64}$/.test(sha || "")) return false;
    return !!await query(sb.from("sanji_creator_one_click_templates").select("sha256").eq("owner", input.owner).eq("sha256", sha).eq("active", true).maybeSingle());
  }
});
Deno.serve(handler);
