// supabase/functions/creator-email-worker/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/_shared/creator-email-isolated-runtime.ts
import { Buffer as Buffer2 } from "node:buffer";

// supabase/functions/_shared/contact-safety.ts
function unsafeContactReason(email, context = "") {
  const value = String(email || "").trim().toLowerCase(), local = value.split("@")[0];
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return "\uC774\uBA54\uC77C \uD615\uC2DD \uC624\uB958";
  if (/^(?:user(?:name)?|your[._-]?email|example|sample|test|email|name)(?:[._-]?\d+)?$/.test(local) || /^(?:jumpit|saramin)[._-]id\d+$/i.test(local) || /@(?:example\.(?:com|org|net)|domain\.(?:com|co\.kr))$/.test(value)) return "\uC785\uB825 \uC608\uC2DC\xB7\uC0D8\uD50C \uC8FC\uC18C";
  if (/^(?:enquiries|line|directly)sales@/i.test(value) && /coherentmarketinsights\.com$/.test(value)) return "\uC8FC\uBCC0 \uC548\uB0B4 \uBB38\uAD6C\uC640 \uC774\uBA54\uC77C\uC774 \uACB0\uD569\uB41C \uCD94\uCD9C \uC624\uB958";
  const at = context.toLowerCase().indexOf(value), near = at < 0 ? context : context.slice(Math.max(0, at - 65), at + value.length + 85);
  const after = at < 0 ? "" : context.slice(at + value.length, at + value.length + 65), before = at < 0 ? "" : context.slice(Math.max(0, at - 60), at);
  if (/^(?:\s*(?:은|는|을|를))?\s*(?:형식|형태).{0,20}(?:입력|따라)/i.test(after) || /(?:예시|입력\s*예|샘플|example|e\.g\.|placeholder)\s*[:：]?\s*[^@\n]{0,40}$/i.test(before) || /(?:saramin_id\d+).{0,30}jumpit_id\d+/i.test(near)) return "\uC5F0\uB77D\uCC98\uAC00 \uC544\uB2CC \uC785\uB825 \uD615\uC2DD\xB7\uACC4\uC815 \uC608\uC2DC";
  return "";
}

// supabase/functions/_shared/gmail-signature.ts
var decode = (s) => s.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, v) => {
  const n = v[0].toLowerCase() === "x" ? parseInt(v.slice(1), 16) : Number(v);
  return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
}).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, k) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[k.toLowerCase()] || "");
var escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function gmailSignature(input) {
  if (typeof input !== "string" || input.length > 3e4) throw Error("Gmail \uC11C\uBA85 \uD06C\uAE30 \uC81C\uD55C");
  const allowed = new Set("div span p br b strong i em u small table tbody tr td th a img font hr".split(" "));
  const html = input.replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").split(/(<\/?[A-Za-z][^>]*>)/g).map((token) => {
    if (!token.startsWith("<")) return escape(decode(token));
    const match = /^<(\/?)([A-Za-z][\w:-]*)\b([^>]*)>$/.exec(token);
    if (!match) return escape(token);
    const name = match[2].toLowerCase();
    if (!allowed.has(name)) return "";
    if (match[1]) return ["img", "br", "hr"].includes(name) ? "" : "</" + name + ">";
    const attrs = {};
    for (const m of match[3].matchAll(/(?:^|\s)([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
    const out = [];
    if (name === "a" || name === "img") {
      const key = name === "a" ? "href" : "src", value = attrs[key] || "";
      try {
        const u = new URL(value);
        if (!(name === "img" ? ["https:"] : ["https:", "http:", "mailto:", "tel:"]).includes(u.protocol) || u.username || u.password || /\/email-events\/pixel\//.test(u.pathname)) return "";
        out.push(key + '="' + escape(u.toString()) + '"');
      } catch {
        return "";
      }
      if (name === "a") out.push('rel="noopener noreferrer"');
    }
    if (name === "img") {
      if (Number(attrs.width) === 1 && Number(attrs.height) === 1) return "";
      out.push('alt="' + escape(attrs.alt || "\uC11C\uBA85 \uC774\uBBF8\uC9C0") + '"');
      for (const k of ["width", "height"]) if (/^\d{1,4}$/.test(attrs[k] || "")) out.push(k + '="' + attrs[k] + '"');
    }
    const styles = [];
    for (const part of String(attrs.style || "").split(";")) {
      const [raw, ...rest] = part.split(":"), k = raw.trim().toLowerCase(), v = rest.join(":").trim();
      if (["color", "background-color"].includes(k) && /^(#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d., %]+\))$/i.test(v) || ["font-size", "line-height", "padding", "margin", "width", "height"].includes(k) && /^[\d.]+(?:px|pt|em|%)?$/.test(v) || k === "font-weight" && /^(normal|bold|[1-9]00)$/.test(v) || k === "text-align" && /^(left|right|center)$/.test(v) || k === "font-family" && /^[a-zA-Z0-9 ,'-]{1,100}$/.test(v)) styles.push(k + ":" + v);
    }
    if (styles.length) out.push('style="' + escape(styles.join(";")) + '"');
    return "<" + name + (out.length ? " " + out.join(" ") : "") + ">";
  }).join("");
  const text2 = decode(html.replace(/<img\b[^>]*>/gi, "").replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => label + (decode(label.replace(/<[^>]*>/g, "")).trim() === decode(url).replace(/^(?:mailto:|tel:)/i, "").trim() ? "" : " (" + url + ")")).replace(/<br\s*\/?\s*>|<\/(?:div|p|tr)>/gi, "\n").replace(/<[^>]*>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  return { html, text: text2 };
}

// supabase/functions/_shared/creator-email-plan.ts
var text = (v) => String(v || "").trim();
var fresh = (v, now) => Number.isFinite(Date.parse(v)) && Date.parse(v) <= now + 6e4 && Date.parse(v) >= now - 30 * 864e5;
function exactCreatorProfile(creator, url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && ["instagram.com", "www.instagram.com"].includes(u.hostname) && u.pathname.replace(/\/$/, "").toLowerCase() === "/" + text(creator.handle).toLowerCase();
  } catch {
    return false;
  }
}
function verifiedCreatorEmail(creator, evidence, now = Date.now()) {
  if (creator.status !== "new" || creator.link_status !== "source_confirmed" || !exactCreatorProfile(creator, creator.profile_url)) return { reason: "creator_identity_unverified" };
  const rows = evidence.filter((e) => e.creator_id === creator.id && e.owner === creator.owner && e.source_kind === "public_bio" && ["instagram_official", "instagram_public"].includes(e.source_provider) && e.source_url === creator.profile_url && e.detail?.bio_source_url === creator.profile_url && e.detail?.bio_content_available === true && fresh(e.detail?.bio_checked_at, now)).sort((a, b) => Date.parse(b.detail.bio_checked_at) - Date.parse(a.detail.bio_checked_at));
  if (!rows.length) return { reason: "fresh_public_bio_required" };
  const source = rows[0], bio = text(source.detail.bio), addresses = [...new Set((bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))].filter((e) => !unsafeContactReason(e, bio));
  if (addresses.length !== 1) return { reason: addresses.length ? "multiple_public_emails" : "email_not_public" };
  if (!Array.isArray(source.detail.emails) || !source.detail.emails.map((x) => text(x).toLowerCase()).includes(addresses[0])) return { reason: "email_evidence_mismatch" };
  return { address: addresses[0], sourceUrl: creator.profile_url, bio, checkedAt: source.detail.bio_checked_at, source };
}
var groups = [
  { key: "wellness", creator: /웰니스|건강|운동|헬스|식단|다이어트|피트니스|러닝|요가|필라테스|wellness|fitness|workout/i, product: /웰니스|건강|단백|프로틴|비타|유산균|영양|저당|식이섬유|오메가|효소|콜라겐|미네랄|발효밀|바이옴|뉴트라|코큐|메가3|옥타비|화이토/i },
  { key: "food", creator: /푸드|식품|요리|레시피|식단|주방|집밥|food|cook|recipe/i, product: /식품|푸드|건강|저당|곡물|견과|단백|영양|간식|음료|커피|차|티백|주스|그릭|프로틴|페스토|올리브유|파스타|브레드|발효밀|미네랄/i },
  { key: "beauty", creator: /뷰티|미용|피부|beauty|skincare/i, product: /콜라겐|미네랄|이너뷰티|비타/i },
  { key: "lifestyle", creator: /라이프|일상|살림|육아|엄마|living|lifestyle/i, product: /미네랄 워터|소금|올리브유|곡물|페스토|파스타/i },
  { key: "baking", creator: /베이킹|디저트|제과|제빵|baking/i, product: /베이킹|디저트|제과|제빵|쿠키|초콜릿/i },
  { key: "coffee", creator: /커피|카페|바리스타|coffee|barista/i, product: /커피|디카페인|티백|원두|coffee/i }
];
function selectCreatorProduct(creator, deals) {
  const context = [creator.category, creator.bio].map(text).join(" "), ranked = deals.filter((d) => ["\uD655\uC815", "\uD611\uC758 \uC911"].includes(d.state) && text(d.name) && !/[\[\]]|정기배송|정기구독|샴푸|비누|트리트먼트|페이셜|바디바|암 극복|도서/.test(d.name) && /^https:\/\//.test(text(d.productUrl))).map((d) => {
    const desc = [d.category, d.name, d.description, d.target, (d.topics || []).join(" ")].map(text).join(" "), matched = groups.filter((g) => g.creator.test(context) && g.product.test(desc));
    const score = matched.reduce((n, g) => n + (g.key === "wellness" ? 8 : ["food", "lifestyle"].includes(g.key) ? 3 : 6), 0) + (matched.length && /웰니스|건강|단백|프로틴|저당|영양/.test(desc) ? 2 : 0);
    return { deal: d, score, matched: matched.map((g) => g.key) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || Number(b.deal.state === "\uD655\uC815") - Number(a.deal.state === "\uD655\uC815") || String(a.deal.id).localeCompare(String(b.deal.id)));
  return ranked[0] || null;
}
function creatorEmailPlan({ creator, evidence, deals, settings, policy, now = Date.now(), requireClassification = true }) {
  const hold = (reason) => ({ eligible: false, reason });
  if (!policy?.enabled || !text(policy.authorization_source) || !Number.isInteger(policy.revision)) return hold("authorization_required");
  const p = policy.data || {};
  const classified = ["non_marketing", "marketing"].includes(p.messageType) && !!text(p.classificationSource);
  if (requireClassification && !classified) return hold("message_classification_required");
  if (p.recipientClaimsConfirmed !== true || !text(p.claimsSource)) return hold("recipient_claims_confirmation_required");
  if (creator.entity_type === "noncreator_suspected") return hold("not_creator");
  const email = verifiedCreatorEmail(creator, evidence, now);
  if (!email.address) return hold(email.reason);
  const selection = selectCreatorProduct({ ...creator, bio: email.bio }, deals);
  if (!selection) return hold("matching_live_product_required");
  if (settings.signatureSource !== "gmail" || text(settings.gmailSignatureEmail).toLowerCase() !== text(p.senderEmail).toLowerCase() || settings.gmailSignatureNeedsConsent) return hold("gmail_signature_required");
  const sig = gmailSignature(settings.gmailSignatureHtml || "");
  if (!sig.text || sig.text !== text(settings.emailSignature) || sig.html !== p.signatureHtml || sig.text !== p.signatureText) return hold("approved_signature_changed");
  if (!settings.senderName || !settings.senderPhone) return hold("sender_information_required");
  const name = text(creator.nickname) || text(creator.handle), product = selection.deal;
  if (/[\r\n\[\]{}<>]/.test(name + product.name) || name.length > 100 || text(product.name).length > 200) return hold("unsafe_personalization");
  const render = (v) => text(v).replaceAll("[\uC778\uD50C\uB8E8\uC5B8\uC11C\uBA85]", name).replaceAll("[\uC0C1\uD488\uBA85]", product.name);
  const subject = render(p.subject), base = render(p.body), body = base + "\n\n" + sig.text;
  if (!subject || !base || subject.length > 200 || body.length > 15e3 || /[\r\n]/.test(subject) || /\{\{|\[[^\]]+\]/.test(subject + body)) return hold("invalid_approved_template");
  if (/치료|예방|완치|항암|효능.{0,4}보장|혈당.{0,5}(낮|개선)/.test(subject + body)) return hold("unsupported_medical_claim");
  if (requireClassification && p.messageType === "marketing" && (!subject.startsWith("(\uAD11\uACE0)") || !settings.senderAddress || !body.includes(settings.senderAddress) || !body.includes(settings.optOut || "\uD68C\uC2E0\uC73C\uB85C \uC218\uC2E0 \uAC70\uBD80\uB97C \uC694\uCCAD\uD558\uC2E4 \uC218 \uC788\uC2B5\uB2C8\uB2E4."))) return hold("marketing_requirements_need_approval");
  return { eligible: true, email, product, match: selection.matched, name, subject, body, signatureText: sig.text, signatureHtml: sig.html, marketing: classified ? p.messageType === "marketing" : null, classificationPending: !classified, policyRevision: policy.revision };
}

// supabase/functions/_shared/creator-recovery-adapters.ts
function providerError(status, code) {
  if (status === 401 || code === 190) return { state: "login_expired", retry: false, message: "\uACF5\uC2DD \uC778\uC99D \uB9CC\uB8CC \xB7 \uB2E4\uC2DC \uC5F0\uACB0 \uD544\uC694" };
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) return { state: "rate_limited", retry: false, message: "\uC81C\uACF5\uC790 \uC870\uD68C \uC81C\uD55C \xB7 \uC790\uB3D9 \uC6B0\uD68C\xB7\uC7AC\uC2DC\uB3C4 \uC911\uC9C0" };
  if (status === 403 || code === 10 || code === 200) return { state: "permission_required", retry: false, message: "\uACF5\uC2DD \uAD8C\uD55C \uB610\uB294 \uACC4\uC815 \uC720\uD615 \uD655\uC778 \uD544\uC694" };
  return { state: "unavailable", retry: false, message: "\uD504\uB85C\uD544 \uC870\uD68C \uC2E4\uD328 \xB7 \uD655\uC778 \uD544\uC694" };
}
async function instagramBusinessDiscovery({ accountId, token, handle, request = fetch, version = "v24.0" }) {
  if (!/^\d+$/.test(String(accountId)) || !/^v\d+\.\d+$/.test(version) || !/^[a-z0-9._]{1,30}$/i.test(handle) || !token) throw Error("\uACF5\uC2DD \uACC4\uC815\xB7\uAD8C\uD55C \uC5F0\uACB0 \uD544\uC694");
  const url = new URL(`https://graph.facebook.com/${version}/${accountId}`);
  url.searchParams.set("fields", `business_discovery.username(${handle}){username,followers_count,media_count,biography,website}`);
  try {
    const response = await request(url.toString(), { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8e3) });
    const data = await response.json();
    if (!response.ok || data.error) return { ...providerError(response.status, data.error?.code), checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const p = data.business_discovery;
    if (!p || String(p.username || "").toLowerCase() !== handle.toLowerCase()) return { ...providerError(404), checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return { state: "verified", handle: p.username, followers: Number.isInteger(p.followers_count) && p.followers_count >= 0 ? p.followers_count : null, mediaCount: Number.isInteger(p.media_count) && p.media_count >= 0 ? p.media_count : null, biography: typeof p.biography === "string" ? p.biography.slice(0, 4e3) : null, website: typeof p.website === "string" ? p.website.slice(0, 2e3) : null, source: "Meta Business Discovery", checkedAt: (/* @__PURE__ */ new Date()).toISOString(), emailStatus: "\uAE30\uC874 \uC18C\uAC1C\uB780 \uC720\uC9C0 \xB7 \uC774 API\uC5D0\uC11C \uC774\uBA54\uC77C \uBBF8\uD655\uC778" };
  } catch {
    return { ...providerError(0), checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}

// supabase/functions/_shared/mail-mime.ts
import { Buffer } from "node:buffer";

// supabase/functions/_shared/mail-recipients.ts
function mailRecipients(d) {
  const input = Array.isArray(d.emails) && d.emails.length ? d.emails : [d.email];
  const out = [...new Set(input.map((x) => String(x || "").trim().toLowerCase()))];
  if (!out.length || out.length > 20 || out.some((x) => !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(x) || /[\r\n,<>]/.test(x))) throw Error("\uC218\uC2E0 \uC774\uBA54\uC77C \uBAA9\uB85D\uC744 \uD655\uC778\uD558\uC138\uC694.");
  return out;
}

// supabase/functions/_shared/mail-mime.ts
function attachmentType(content) {
  const b = Buffer.from(content, "base64");
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString())) return "image/gif";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}
function messageIds(v) {
  return (String(v || "").match(/<[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~@-]+>/g) || []).slice(-20).join(" ");
}
function encodedHeader(value) {
  const parts = [];
  let chunk = "";
  if (/[\r\n]/.test(value)) throw Error("\uBA54\uC77C \uC81C\uBAA9\xB7\uBC1C\uC2E0\uC790\uBA85\uC5D0 \uC904\uBC14\uAFC8\uC744 \uB123\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  for (const char of String(value || "")) {
    if (Buffer.byteLength(chunk + char, "utf8") > 42) {
      parts.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk || !parts.length) parts.push(chunk);
  return parts.map((p) => "=?UTF-8?B?" + Buffer.from(p).toString("base64") + "?=").join("\r\n ");
}
var base64Body = (text2) => Buffer.from(text2, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
function trackingHtml(d) {
  const escape2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let url = null;
  try {
    const u = new URL(d.trackingPixelUrl);
    if (u.protocol === "https:" && /^\/functions\/v1\/[^/]+\/email-events\/pixel\/[A-Za-z0-9_-]{43}\.gif$/.test(u.pathname) && !u.search && !u.hash && !u.username && !u.password) url = u;
  } catch {
  }
  let signature = null;
  if (d.signatureHtml && d.signatureText) {
    const clean2 = gmailSignature(d.signatureHtml);
    if (clean2.text === d.signatureText && String(d.body).includes(clean2.text)) signature = clean2;
  }
  if (!url && !signature) return null;
  const linkify = (text3) => {
    const parts = [];
    let last = 0;
    for (const m of text3.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      parts.push(escape2(text3.slice(last, m.index)));
      parts.push('<a href="' + escape2(m[0]) + '">' + escape2(m[0]) + "</a>");
      last = m.index + m[0].length;
    }
    parts.push(escape2(text3.slice(last)));
    return parts.join("");
  };
  const text2 = String(d.body), i = signature ? text2.lastIndexOf(signature.text) : -1;
  const content = i >= 0 ? '<div style="white-space:pre-wrap">' + linkify(text2.slice(0, i)) + "</div><div>" + signature.html + '</div><div style="white-space:pre-wrap">' + linkify(text2.slice(i + signature.text.length)) + "</div>" : '<div style="white-space:pre-wrap">' + linkify(text2) + "</div>";
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + content + (url ? '<img src="' + escape2(url.toString()) + '" width="1" height="1" alt="" referrerpolicy="no-referrer" style="width:1px;height:1px;border:0" />' : "") + "</body></html>";
}
function mime(d, from) {
  const lines = [
    `From: ${d.senderName ? encodedHeader(d.senderName) + " <" + from + ">" : from}`,
    `To: ${mailRecipients(d).join(", ")}`,
    `Subject: ${encodedHeader(d.subject)}`,
    `Message-ID: <${d.messageId}@sanji.local>`,
    "MIME-Version: 1.0"
  ];
  if (d.inReplyTo)
    lines.push(
      "In-Reply-To: " + messageIds(d.inReplyTo),
      "References: " + messageIds(d.references) + " " + messageIds(d.inReplyTo)
    );
  const html = trackingHtml(d), alternative = "sanji_alt_" + crypto.randomUUID();
  const bodyLines = html ? [
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(d.body),
    `--${alternative}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(html),
    `--${alternative}--`
  ] : ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Body(d.body)];
  const attachments = d.attachments || [];
  if (!attachments.length) return Buffer.from([...lines, ...bodyLines].join("\r\n")).toString("base64url");
  const boundary = "sanji_" + crypto.randomUUID();
  lines.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...bodyLines
  );
  for (const a of attachments)
    lines.push(
      `--${boundary}`,
      "Content-Type: " + attachmentType(a.content),
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.content.match(/.{1,76}/g)?.join("\r\n") || ""
    );
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// supabase/functions/_shared/creator-email-isolated-service.ts
var prefix = "sanji_creator_email_isolated_";
var clean = (v) => String(v ?? "").trim();
function creatorEmailBasis(b, owner, creator, recipient, revision, productId, now = Date.now()) {
  if (!Array.isArray(b?.product_ids) || !b.product_ids.includes(productId)) return false;
  if (!b || b.owner !== owner || b.creator_id !== creator || clean(b.recipient).toLowerCase() !== recipient.toLowerCase() || b.policy_revision !== revision) return false;
  if (b.status !== "approved" || b.kind !== "solicited_proposal" || b.classification !== "solicited_non_marketing_proposal" || b.approved_by !== owner) return false;
  if (!clean(b.approval_source) || !clean(b.classification_source) || !clean(b.source_text) || !/^https:\/\//i.test(clean(b.source_url))) return false;
  const checked = Date.parse(b.verified_at), expiry = Date.parse(b.expires_at);
  return Number.isFinite(checked) && checked <= now && checked >= now - 30 * 864e5 && Number.isFinite(expiry) && expiry > now;
}
function isolatedCreatorEmailService({ sb: sb2, query, env: env2, connection, gmailToken, remote, digest, uuid, audit, request = fetch, now = Date.now }) {
  async function config(owner) {
    return await query(sb2.from(prefix + "policy").select("*").eq("owner", owner).maybeSingle());
  }
  async function history(owner, address, sender) {
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) throw Error("invalid_email");
    const gmail = await gmailToken(owner);
    if (clean(gmail.email).toLowerCase() !== sender.toLowerCase()) throw Error("gmail_account_changed");
    const result = await remote("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + new URLSearchParams({ q: `in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`, maxResults: "1", includeSpamTrash: "true" }), { headers: { Authorization: "Bearer " + gmail.access_token } });
    if (!result || typeof result !== "object" || result.messages !== void 0 && !Array.isArray(result.messages) || result.resultSizeEstimate !== void 0 && (!Number.isInteger(result.resultSizeEstimate) || result.resultSizeEstimate < 0)) throw Error("gmail_history_unverified");
    if (result.nextPageToken || result.messages?.length || Number(result.resultSizeEstimate) > 0) throw Error("existing_gmail_contact");
    if (result.messages === void 0 && result.resultSizeEstimate !== 0) throw Error("gmail_history_unverified");
    return { gmail, proof: { checkedAt: new Date(now()).toISOString(), address, senderEmail: sender, clear: true } };
  }
  async function enrich(creator, evidence) {
    if (verifiedCreatorEmail(creator, evidence, now()).address) return evidence;
    if (creator.status !== "new" || creator.link_status !== "source_confirmed" || !exactCreatorProfile(creator, creator.profile_url)) return evidence;
    const c = await connection(creator.owner, "creator_meta");
    if (!c?.access_token || !c.selectedId || !Number.isFinite(Number(c.expires)) || Number(c.expires) <= now() || c.tokenMode !== "facebook_login") return evidence;
    await query(sb2.rpc("sanji_creator_meta_claim", { p_owner: creator.owner, p_tag: "profile_" + creator.handle.replace(/[^a-z0-9_]/g, "_").slice(0, 20), p_kind: "profile" }));
    const r = await instagramBusinessDiscovery({ accountId: c.selectedId, token: c.access_token, handle: creator.handle, request, version: env2("META_GRAPH_VERSION") || "v24.0" });
    if (r.state !== "verified" || typeof r.biography !== "string") throw Error("official_api_" + r.state);
    const emails = [...new Set((r.biography.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e2) => e2.toLowerCase()))];
    const e = { owner: creator.owner, creator_id: creator.id, source_provider: "instagram_official", source_kind: "public_bio", source_url: creator.profile_url, source_ref: "business_discovery", observation_key: await digest(r.biography + "|" + r.checkedAt), detail: { bio: r.biography, bio_source_url: creator.profile_url, bio_status: emails.length ? "email_present" : "email_not_in_bio", bio_checked_at: r.checkedAt, bio_content_available: true, emails } };
    await query(sb2.from("sanji_creator_evidence").upsert(e, { onConflict: "owner,creator_id,source_kind,source_url,source_ref,observation_key", ignoreDuplicates: true }));
    return [...evidence, e];
  }
  async function hold(job, reason, plan) {
    const patch = { status: "held", reason, lease_token: null, lease_until: null, updated: new Date(now()).toISOString() };
    if (plan) patch.snapshot = plan;
    await query(sb2.from(prefix + "queue").update(patch).eq("owner", job.owner).eq("creator_id", job.creator_id).eq("status", "processing").eq("lease_token", job.lease_token));
    return { status: "held", creator: job.creator_id, reason };
  }
  async function current(job) {
    return await query(sb2.from(prefix + "queue").select("status,outbox_id,reservation_token").eq("owner", job.owner).eq("creator_id", job.creator_id).maybeSingle());
  }
  async function finish(job, reservation, status, provider) {
    try {
      return await query(sb2.rpc(prefix + "finalize", { p_owner: job.owner, p_creator: job.creator_id, p_reservation: reservation.reservationToken, p_status: status, p_provider: provider }));
    } catch {
      try {
        const q = await current(job);
        if (["accepted", "rejected", "outcome_unknown", "cancelled"].includes(q?.status)) return { status: q.status, creator: job.creator_id, reconciled: true };
      } catch {
      }
      return { status: "outcome_unknown", creator: job.creator_id, reason: "receipt_reconciliation_required" };
    }
  }
  async function processOne(owner) {
    const rows = await query(sb2.rpc(prefix + "claim", { p_owner: owner })), job = Array.isArray(rows) ? rows[0] : rows;
    if (!job) return { status: "idle" };
    let reservation = null;
    try {
      const policy = await config(owner);
      if (!policy?.enabled || policy.revision !== job.policy_revision) return await hold(job, "authorization_changed");
      const creator = await query(sb2.from("sanji_creator_recovery").select("*").eq("owner", owner).eq("id", job.creator_id).maybeSingle());
      if (!creator || creator.status !== "new") return await hold(job, "creator_not_new");
      const review = await query(sb2.from("sanji_creator_contact_review").select("*").eq("owner", owner).eq("creator_id", creator.id).maybeSingle());
      if (review?.data?.email?.status === "hold" || ["scheduled", "sent", "unknown"].includes(review?.data?.email?.observation?.status) || review?.data?.email?.observation?.humanReply) return await hold(job, "existing_outreach_or_hold");
      let evidence = await query(sb2.from("sanji_creator_evidence").select("*").eq("owner", owner).eq("creator_id", creator.id).eq("source_kind", "public_bio"));
      evidence = await enrich(creator, evidence);
      const records = await query(sb2.from("sanji_records").select("id,kind,version,data").eq("owner", owner).in("kind", ["settings", "deal"]).limit(501));
      if (records.length > 500) return await hold(job, "catalog_requires_review");
      const settingsRows = records.filter((r) => r.kind === "settings").sort((a, b) => String(a.id).localeCompare(String(b.id))), settings = settingsRows[0]?.data || {};
      const deals = records.filter((r) => r.kind === "deal").map((r) => ({ ...r.data, id: r.id, version: r.version }));
      const plan = creatorEmailPlan({ creator, evidence, deals, settings, policy, now: now(), requireClassification: false });
      if (!plan.eligible) return await hold(job, plan.reason);
      if (review?.data?.email?.body && [review.data.email.body !== plan.body, review.data.email.subject !== plan.subject, clean(review.data.email.address).toLowerCase() !== plan.email.address, JSON.stringify(review.data.email.productIds) !== JSON.stringify([plan.product.id])].some(Boolean)) return await hold(job, "existing_draft_needs_review", plan);
      const basis = await query(sb2.from(prefix + "basis").select("*").eq("owner", owner).eq("creator_id", creator.id).eq("recipient", plan.email.address).maybeSingle());
      if (!creatorEmailBasis(basis, owner, creator.id, plan.email.address, policy.revision, plan.product.id, now())) return await hold(job, "recipient_basis_required", plan);
      if (policy.data.messageType !== "non_marketing" || !clean(policy.data.classificationSource)) return await hold(job, "message_classification_required", plan);
      if (policy.send_enabled !== true || env2("EMAIL_SENDING_ENABLED") !== "true") return await hold(job, "sending_disabled", plan);
      const second = await history(owner, plan.email.address, policy.data.senderEmail);
      plan.gmailHistory = second.proof;
      const draft = { channel: "email", proposalType: "creator_product_proposal", subject: plan.subject, body: plan.body, signature: "", signatureText: plan.signatureText, signatureHtml: plan.signatureHtml, attachments: [], attachmentSummary: [], dealIds: [plan.product.id], recipientMode: "primary", marketing: false, email: plan.email.address, emails: [plan.email.address], senderName: settings.senderName, targetName: plan.name, messageId: uuid(), replyRecipientNeedsReview: false, trackingRequested: false, tracking: { enabled: false, reason: "exact_approved_template" } };
      reservation = await query(sb2.rpc(prefix + "reserve", { p_owner: owner, p_creator: creator.id, p_lease: job.lease_token, p_expected_updated: creator.updated, p_review_version: review?.version || 0, p_plan: plan, p_draft: draft }));
      if (reservation?.duplicate || reservation?.status !== "reserved" || !reservation?.outbox?.id || !reservation?.draft || !reservation?.reservationToken) return { status: "held", creator: creator.id, reason: "reservation_reconciliation_required" };
      let ready;
      try {
        if (now() - Date.parse(second.proof.checkedAt) > 6e4 || Date.parse(basis.expires_at) <= now()) throw Error("preflight_expired");
        ready = await history(owner, plan.email.address, policy.data.senderEmail);
        const grant = await query(sb2.rpc(prefix + "begin_send", { p_owner: owner, p_creator: creator.id, p_reservation: reservation.reservationToken, p_gmail_history: ready.proof }));
        if (grant?.ready !== true || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now() || now() - Date.parse(ready.proof.checkedAt) > 6e4 || Date.parse(basis.expires_at) <= now()) throw Error("preflight_expired");
      } catch {
        return await finish(job, reservation, "cancelled", { reason: "preflight_changed_no_send" });
      }
      let provider;
      try {
        provider = await remote("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + ready.gmail.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ raw: mime(reservation.draft, ready.gmail.email) }) });
        if (!provider || !["id", "threadId"].every((k) => typeof provider[k] === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(provider[k]))) throw Error("provider_receipt_missing");
      } catch (error) {
        const rejected = [400, 401, 403, 404, 429].includes(error?.status);
        return await finish(job, reservation, rejected ? "rejected" : "outcome_unknown", { reason: rejected ? "provider_rejected" : "provider_outcome_unknown" });
      }
      return await finish(job, reservation, "accepted", { id: String(provider.id), threadId: clean(provider.threadId) });
    } catch (error) {
      try {
        const q = await current(job);
        if (q && ["reserved", "accepted", "rejected", "outcome_unknown"].includes(q.status)) return { status: q.status === "accepted" ? "accepted" : "outcome_unknown", creator: job.creator_id, reason: "reservation_reconciliation_required" };
      } catch {
        return { status: "outcome_unknown", creator: job.creator_id, reason: "queue_reconciliation_required" };
      }
      const reason = /^(official_api_|existing_gmail_contact$|gmail_account_changed$|gmail_history_unverified$|gmail_reauth_required$)/.test(clean(error?.message)) ? error.message : "preparation_failed";
      try {
        await audit(owner, "creator_email_isolated_held", { creator: job.creator_id, reason });
      } catch {
      }
      return await hold(job, reason);
    }
  }
  async function run(maxItems = 2, budgetMs = 2e4) {
    const started = now(), results = [];
    const policies = await query(sb2.from(prefix + "policy").select("owner").eq("enabled", true).order("owner").limit(2));
    if (policies.length > 1) return { processed: 0, accepted: 0, held: 0, uncertain: 0, reason: "owner_scope_requires_review" };
    for (const p of policies) {
      if (results.length >= maxItems || now() - started >= budgetMs) break;
      await query(sb2.rpc(prefix + "sync", { p_owner: p.owner }));
      while (results.length < maxItems && now() - started < budgetMs) {
        const r = await processOne(p.owner);
        if (r.status === "idle") break;
        results.push(r);
      }
    }
    return { processed: results.length, accepted: results.filter((r) => r.status === "accepted").length, held: results.filter((r) => ["held", "cancelled"].includes(r.status)).length, uncertain: results.filter((r) => r.status === "outcome_unknown").length };
  }
  return { processOne, run };
}

// supabase/functions/_shared/creator-email-isolated-runtime.ts
function creatorEmailRuntime({ sb: sb2, env: env2, request = fetch, now = Date.now }) {
  const query = async (p) => {
    const r = await p;
    if (r.error) throw Error("database_operation_failed");
    return r.data;
  };
  const digest = async (v) => Buffer2.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))).toString("hex");
  async function decrypt(value) {
    if (!env2("TOKEN_ENCRYPTION_KEY")) throw Error("connection_unavailable");
    const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env2("TOKEN_ENCRYPTION_KEY"))), "AES-GCM", false, ["decrypt"]);
    const bytes = Buffer2.from(value, "base64");
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))));
  }
  async function connection(owner, provider) {
    if (!["gmail", "creator_meta"].includes(provider)) throw Error("connection_provider_not_allowed");
    const row = await query(sb2.from("sanji_connections").select("encrypted,summary").eq("owner", owner).eq("provider", provider).maybeSingle());
    if (!row) return null;
    if (provider === "gmail" && row.summary?.reauthRequired) throw Error("gmail_reauth_required");
    return await decrypt(row.encrypted);
  }
  async function remote(url, options = {}) {
    const u = new URL(url), token = url === "https://oauth2.googleapis.com/token";
    const history = u.origin === "https://gmail.googleapis.com" && u.pathname === "/gmail/v1/users/me/messages" && (!options.method || options.method === "GET");
    const send = u.origin === "https://gmail.googleapis.com" && u.pathname === "/gmail/v1/users/me/messages/send" && options.method === "POST" && !u.search;
    if (!token && !history && !send) throw Error("remote_destination_not_allowed");
    let response;
    try {
      response = await request(url, { ...options, redirect: "error", signal: AbortSignal.timeout(send ? 2e4 : 12e3) });
    } catch {
      throw Error("provider_outcome_unknown");
    }
    let data;
    try {
      data = await response.json();
    } catch {
      const e = Error("provider_response_invalid");
      e.status = response.ok ? void 0 : response.status;
      throw e;
    }
    if (!response.ok) {
      const e = Error(token && data?.error === "invalid_grant" ? "gmail_reauth_required" : "provider_rejected");
      e.status = response.status;
      throw e;
    }
    return data;
  }
  const cached = /* @__PURE__ */ new Map();
  async function gmailToken(owner) {
    const stored = cached.get(owner);
    if (stored?.expires > now() + 6e4) return stored;
    const c = await connection(owner, "gmail");
    if (!c || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(c.email || ""))) throw Error("gmail_account_changed");
    if (c.access_token && c.expires > now() + 6e4) {
      cached.set(owner, c);
      return c;
    }
    if (!c.refresh_token || !env2("GOOGLE_CLIENT_ID") || !env2("GOOGLE_CLIENT_SECRET")) throw Error("gmail_reauth_required");
    const r = await remote("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: env2("GOOGLE_CLIENT_ID"), client_secret: env2("GOOGLE_CLIENT_SECRET"), refresh_token: c.refresh_token, grant_type: "refresh_token" }) });
    if (typeof r.access_token !== "string" || !Number.isFinite(Number(r.expires_in)) || Number(r.expires_in) <= 0) throw Error("gmail_reauth_required");
    const fresh2 = { ...c, access_token: r.access_token, expires: now() + Number(r.expires_in) * 1e3 };
    cached.set(owner, fresh2);
    return fresh2;
  }
  const audit = async (owner, action, data) => await query(sb2.from("sanji_audit").insert({ owner, action, data }));
  return isolatedCreatorEmailService({ sb: sb2, query, env: env2, connection, gmailToken, remote, digest, uuid: () => crypto.randomUUID(), audit, request, now });
}
async function sameSecret(a, b) {
  const encode = new TextEncoder(), x = new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(a))), y = new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(b)));
  let different = 0;
  for (let i = 0; i < x.length; i++) different |= x[i] ^ y[i];
  return different === 0;
}
function creatorEmailHandler({ run, env: env2 }) {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return async (req) => {
    if (req.method !== "POST" || !new URL(req.url).pathname.endsWith("/creator-email-worker/run")) return json({ error: "not_found" }, 404);
    const expected = env2("JOB_RUNNER_TOKEN") || "", provided = req.headers.get("x-job-token") || "";
    if (expected.length < 32) return json({ error: "runner_not_configured" }, 503);
    if (provided.length > 1024 || !await sameSecret(expected, provided)) return json({ error: "not_authorized" }, 401);
    if (Number(req.headers.get("content-length") || 0) > 1024) return json({ error: "invalid_request" }, 413);
    if (req.body) {
      let length = 0;
      const chunks = [], reader = req.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1024) {
          await reader.cancel();
          return json({ error: "invalid_request" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const body = new TextDecoder().decode(bytes);
      try {
        if (body.trim() && JSON.stringify(JSON.parse(body)) !== "{}") return json({ error: "invalid_request" }, 400);
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
    }
    try {
      return json(await run());
    } catch {
      return json({ error: "worker_unavailable" }, 503);
    }
  };
}

// supabase/functions/creator-email-worker/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
var worker = creatorEmailRuntime({ sb, env });
Deno.serve(creatorEmailHandler({ run: () => worker.run(), env }));
