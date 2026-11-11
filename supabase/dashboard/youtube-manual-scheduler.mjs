// supabase/functions/youtube-manual-scheduler/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/youtube-manual-mail/sender-runtime.mjs
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash3, randomUUID as randomUUID3, timingSafeEqual } from "node:crypto";

// supabase/functions/creator-daily-outreach/domain.mjs
var DAILY_OUTREACH = Object.freeze({ campaign: "mara-jjamppong-bread", label: "\uB9C8\uB77C\uCAC0\uB4DD\uBE75\xB7\uC9EC\uBF55\uCAC0\uB4DD\uBE75", youtubeTarget: 50, instagramTarget: 10, audienceBounds: Object.freeze({ youtube: Object.freeze({ minimum: 3e4, maximum: 2e5 }), instagram: Object.freeze({ minimum: 3e4, maximum: 5e5 }) }), targetUnit: "distinct_verified_business_email", maxEmailsPerCreator: 1, dedupeScope: "cross_platform", activityDays: 90, evidenceDays: 30, timezone: "Asia/Seoul", sendingEnabled: false, schedulerEnabled: false });
var RECIPIENT_CRITERIA = Object.freeze({ version: 1, audienceBounds: DAILY_OUTREACH.audienceBounds, targets: Object.freeze({ youtube: DAILY_OUTREACH.youtubeTarget, instagram: DAILY_OUTREACH.instagramTarget }), targetUnit: DAILY_OUTREACH.targetUnit, maxEmailsPerCreator: DAILY_OUTREACH.maxEmailsPerCreator, dedupeScope: DAILY_OUTREACH.dedupeScope });
var clean = (v) => typeof v === "string" ? v.trim() : "";
var OutreachError = class extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
};
function sourceUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash && /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname) && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname) && !/^\d+(\.\d+){3}$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}
function emailIdentity(value) {
  const address = clean(value).toLowerCase(), parts = address.split("@");
  if (parts.length !== 2 || address.length > 254) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !domain.includes(".") || domain.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) || !/[.][a-z]{2,}$/.test(domain)) return null;
  if (["gmail.com", "googlemail.com"].includes(domain)) {
    const account = local.split("+")[0];
    return /^[a-z0-9.]+$/.test(account) && account.replaceAll(".", "") ? account.replaceAll(".", "") + "@gmail.com" : null;
  }
  return address;
}
function renderOutreachCopy({ template, channelName, signature, attachments = [], inlineImages = [] }) {
  const name = clean(channelName);
  if (!name || name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) throw new OutreachError("CHANNEL_NAME_INVALID", "\uC2E4\uC81C \uCC44\uB110\uBA85\uC744 \uD655\uC778\uD558\uC138\uC694.");
  if (template?.approved !== true || !clean(template.approvalSource) || typeof template.subject !== "string" || typeof template.body !== "string" || !template.subject || !template.body || template.subject.length > 200 || template.body.length > 2e4 || /[\r\n]/.test(template.subject)) throw new OutreachError("COPY_REVIEW_REQUIRED", "\uC0AC\uC6A9\uC790 \uC2B9\uC778 \uC81C\uBAA9\xB7\uBCF8\uBB38\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  if (signature?.verified !== true || signature.source !== "existing_gmail_signature" || !clean(signature.senderEmail) || !emailIdentity(signature.senderEmail) || !clean(signature.text) || !clean(signature.html)) throw new OutreachError("SIGNATURE_REQUIRED", "\uAE30\uC874 Gmail \uC11C\uBA85\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  const subject = template.subject.replaceAll("[\uCC44\uB110\uBA85]", () => name), body = template.body.replaceAll("[\uCC44\uB110\uBA85]", () => name);
  if (/\[채널명\]/.test(subject + body)) throw new OutreachError("PLACEHOLDER_UNRESOLVED", "\uCC44\uB110\uBA85 \uCE58\uD658\uC744 \uD655\uC778\uD558\uC138\uC694.");
  const occurrences = body.split(signature.text).length - 1;
  if (occurrences > 1) throw new OutreachError("SIGNATURE_DUPLICATE", "\uBCF8\uBB38\uC758 \uC11C\uBA85 \uC911\uBCF5\uC744 \uAC80\uD1A0\uD558\uC138\uC694.");
  const inlineIds = template.requiredInlineImageIds;
  if (inlineIds !== void 0) {
    if (occurrences !== 0) throw new OutreachError("SIGNATURE_ALREADY_IN_COPY", "\uC2B9\uC778 \uBCF8\uBB38\uC5D0 \uC774\uBBF8 \uC11C\uBA85\uC774 \uC788\uC5B4 \uBCF8\uBB38 \uC0AC\uC9C4 \uC704\uCE58\uC640 \uC11C\uBA85 \uC911\uBCF5\uC744 \uAC80\uD1A0\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (!Array.isArray(inlineIds) || inlineIds.length !== 2 || new Set(inlineIds).size !== 2 || inlineIds.some((id) => typeof id !== "string" || !id) || !clean(template.owner) || !Array.isArray(inlineImages) || inlineImages.length !== 2) throw new OutreachError("INLINE_IMAGES_REQUIRED", "\uC0AC\uC6A9\uC790\uAC00 \uC9C0\uC815\uD55C \uBCF8\uBB38 \uC0AC\uC9C4 \uB450 \uC7A5\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (inlineIds.some((id) => !inlineImages.some((image) => image.id === id && image.owner === template.owner && image.verified === true && image.sharingApproved === true && image.sha256?.match(/^[a-f0-9]{64}$/) && Number.isSafeInteger(image.bytes) && image.bytes > 0))) throw new OutreachError("INLINE_IMAGES_UNVERIFIED", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uC6D0\uBCF8\xB7\uACC4\uC815\xB7\uACF5\uC720 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (attachments.length) throw new OutreachError("UNEXPECTED_ATTACHMENTS", "\uC77C\uBC18 \uCCA8\uBD80 \uB300\uC2E0 \uBCF8\uBB38 \uC0AC\uC9C4 \uB450 \uC7A5\uB9CC \uC0AC\uC6A9\uD569\uB2C8\uB2E4.");
    return { subject, body, senderEmail: signature.senderEmail, signatureHtml: signature.html, signatureText: signature.text, inlineImages: inlineIds.map((id) => inlineImages.find((image) => image.id === id)), attachments: [], templateRevision: template.revision, approvalSource: template.approvalSource, sendingEnabled: false };
  }
  const ids = template.requiredAttachmentIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.some((id) => typeof id !== "string" || !id)) throw new OutreachError("PRODUCT_ATTACHMENTS_REQUIRED", "\uBCF8\uBB38\uC5D0 \uBA85\uC2DC\uD55C \uC81C\uD488 \uC790\uB8CC\uB97C \uC9C0\uC815\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (new Set(ids).size !== ids.length || !Array.isArray(attachments) || ids.some((id) => !attachments.some((a) => a.id === id && a.verified === true && a.sharingApproved === true && a.sha256?.match(/^[a-f0-9]{64}$/) && Number.isSafeInteger(a.bytes) && a.bytes > 0))) throw new OutreachError("PRODUCT_ATTACHMENTS_UNVERIFIED", "\uC2B9\uC778\uB41C \uC81C\uD488 \uCCA8\uBD80\uD30C\uC77C\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  return { subject, senderEmail: signature.senderEmail, body: occurrences === 1 ? body : body + "\n\n" + signature.text, signatureHtml: occurrences === 1 ? "" : signature.html, signatureText: occurrences === 1 ? "" : signature.text, attachments: ids.map((id) => attachments.find((a) => a.id === id)), templateRevision: template.revision, approvalSource: template.approvalSource, sendingEnabled: false };
}

// supabase/functions/creator-daily-outreach/private-config.mjs
import { createHash as createHash2 } from "node:crypto";

// supabase/functions/creator-daily-outreach/inline-mail.mjs
import { Buffer as Buffer2 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";

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
  const text = decode(html.replace(/<img\b[^>]*>/gi, "").replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => label + (decode(label.replace(/<[^>]*>/g, "")).trim() === decode(url).replace(/^(?:mailto:|tel:)/i, "").trim() ? "" : " (" + url + ")")).replace(/<br\s*\/?\s*>|<\/(?:div|p|tr)>/gi, "\n").replace(/<[^>]*>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  return { html, text };
}

// supabase/functions/_shared/mail-mime.ts
import { Buffer } from "node:buffer";
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

// supabase/functions/creator-daily-outreach/inline-mail.mjs
var fail = (code, text) => {
  throw new OutreachError(code, text);
};
var crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n >>> 1 ^ (n & 1 ? 3988292384 : 0);
  return n >>> 0;
});
function validPngPixels(bytes, width, height) {
  let offset = 8, seenHeader = false, seenData = false, closedData = false, seenEnd = false;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size, type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    let crc = 4294967295;
    for (let i = offset + 4; i < end - 4; i++) crc = crc >>> 8 ^ crcTable[(crc ^ bytes[i]) & 255];
    if ((crc ^ 4294967295) >>> 0 !== bytes.readUInt32BE(end - 4)) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uC6D0\uBCF8\uC758 \uAC80\uC0AC\uAC12\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    if (!seenHeader && type !== "IHDR" || type === "IHDR" && (seenHeader || size !== 13)) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD5E4\uB354\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (type === "IHDR") {
      seenHeader = true;
      if (bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) fail("INLINE_IMAGE_PNG_UNSUPPORTED", "8\uBE44\uD2B8 RGB/RGBA PNG \uC6D0\uBCF8\uC744 \uC0AC\uC6A9\uD558\uC138\uC694.");
    } else if (type === "IDAT") {
      if (closedData) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uBE14\uB85D \uC21C\uC11C\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      seenData = true;
      chunks.push(bytes.subarray(offset + 8, end - 4));
    } else {
      if (seenData) closedData = true;
      if (type === "IEND") {
        if (size !== 0 || end !== bytes.length || !seenData) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB05D\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
        seenEnd = true;
      } else if (type === "PLTE") {
        if (seenData || !size || size % 3 || size > 768) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uD314\uB808\uD2B8\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
      } else if (type[0] === type[0].toUpperCase()) fail("INLINE_IMAGE_PNG_UNSUPPORTED", "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 PNG \uC0AC\uC9C4 \uAD6C\uC870\uC785\uB2C8\uB2E4.");
    }
    offset = end;
  }
  if (!seenEnd) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4\uC774 \uC644\uC804\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const channels = bytes[25] === 6 ? 4 : 3, stride = width * channels + 1, expected = stride * height;
  if (expected > 80 * 1024 * 1024) fail("INLINE_IMAGE_PNG_TOO_LARGE", "PNG \uD574\uB3C5 \uD06C\uAE30\uAC00 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
  let pixels;
  try {
    pixels = inflateSync(Buffer2.concat(chunks), { maxOutputLength: expected + 1 });
  } catch {
    fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140\uC744 \uD574\uB3C5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (pixels.length !== expected) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140 \uD06C\uAE30\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) fail("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD544\uD130\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
}
function validateInlineImages(images, { owner, requiredIds }) {
  if (!Array.isArray(images) || images.length !== 2 || !Array.isArray(requiredIds) || requiredIds.length !== 2 || new Set(requiredIds).size !== 2 || !owner) fail("INLINE_IMAGES_REQUIRED", "\uC815\uD655\uD55C \uBCF8\uBB38 \uC0AC\uC9C4 \uB450 \uC7A5\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const result = [], hashes = /* @__PURE__ */ new Set();
  let total = 0;
  for (const id of requiredIds) {
    const matches = images.filter((x) => x.id === id);
    if (matches.length !== 1) fail("INLINE_IMAGE_ID_MISMATCH", "\uBCF8\uBB38 \uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const image = matches[0];
    if (image.owner !== owner || image.verified !== true || image.sharingApproved !== true || image.mimeType !== "image/png" || typeof image.content !== "string" || image.content.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content)) fail("INLINE_IMAGE_UNVERIFIED", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uC6D0\uBCF8\xB7\uACC4\uC815\xB7\uACF5\uC720 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const bytes = Buffer2.from(image.content, "base64");
    if (bytes.length !== image.bytes || bytes.length < 45 || bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer2.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(12, 16).toString() !== "IHDR" || !bytes.subarray(-8, -4).equals(Buffer2.from("IEND"))) fail("INLINE_IMAGE_BYTES_INVALID", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uD30C\uC77C \uD615\uC2DD\uACFC \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== image.sha256 || hashes.has(sha256)) fail("INLINE_IMAGE_HASH_MISMATCH", "\uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uBC14\uB00C\uC5C8\uAC70\uB098 \uC911\uBCF5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    hashes.add(sha256);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width !== image.width || height !== image.height || width < 32 || height < 32 || width * height > 2e7) fail("INLINE_IMAGE_DIMENSIONS", "\uBCF8\uBB38 \uC0AC\uC9C4 \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    validPngPixels(bytes, width, height);
    total += bytes.length;
    if (total > 10 * 1024 * 1024) fail("INLINE_IMAGES_TOO_LARGE", "\uBCF8\uBB38 \uC0AC\uC9C4 \uCD1D \uD06C\uAE30\uB97C \uC904\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
    result.push({ id, bytes, sha256, width, height, cid: "sanji-product-" + sha256 + "@sanji.local", name: "product-photo-" + (result.length + 1) + ".png", alt: typeof image.alt === "string" && image.alt.trim() ? image.alt.trim().slice(0, 150) : "\uC81C\uD488 \uC0AC\uC9C4 " + (result.length + 1) });
  }
  return result;
}

// supabase/functions/creator-daily-outreach/private-config.mjs
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var HASH = /^[a-f0-9]{64}$/;
var fail2 = (code) => {
  throw new OutreachError(code, "\uCEA0\uD398\uC778 \uC6D0\uBCF8\xB7\uC11C\uBA85\xB7\uC0AC\uC9C4\xB7\uAC80\uD1A0 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", 409);
};
var CAMPAIGN_CLASSIFICATIONS = Object.freeze(["solicited_non_marketing_proposal", "reviewed_non_marketing_business_proposal"]);
function stableJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail2("INVALID_PRIVATE_CONFIGURATION");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableJSON(value[k])).join(",") + "}";
  fail2("INVALID_PRIVATE_CONFIGURATION");
}
var hashValue = (value) => createHash2("sha256").update(typeof value === "string" ? value : stableJSON(value)).digest("hex");
var keys = (value, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) fail2("INVALID_PRIVATE_CONFIGURATION");
};
var safeText = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
function settingsSignature(settings, connection) {
  const d = settings?.data || {}, email = String(d.gmailSignatureEmail || "").trim().toLowerCase();
  if (!UUID.test(settings?.id || "") || !Number.isSafeInteger(settings.version) || settings.version < 1 || d.signatureSource !== "gmail" || d.gmailSignatureNeedsConsent === true || !emailIdentity(email) || email !== String(connection?.summary?.email || "").toLowerCase() || connection?.summary?.reauthRequired === true || !safeText(d.senderName, 200) || /[\r\n]/.test(d.senderName)) fail2("CURRENT_GMAIL_SIGNATURE_REQUIRED");
  const signature = gmailSignature(d.gmailSignatureHtml || "");
  if (!signature.text || signature.text !== d.emailSignature || signature.html !== d.gmailSignatureHtml) fail2("CURRENT_GMAIL_SIGNATURE_CHANGED");
  return { verified: true, source: "existing_gmail_signature", senderEmail: email, html: signature.html, text: signature.text, settingsId: settings.id, settingsVersion: settings.version, senderName: d.senderName };
}
function requireRecipientCriteria(snapshot) {
  if (snapshot?.version !== 2) fail2("RECIPIENT_CRITERIA_REVIEW_REQUIRED");
  const criteria = snapshot.recipientCriteria;
  keys(criteria, [...Object.keys(RECIPIENT_CRITERIA), "approvalSource"]);
  if (!safeText(criteria.approvalSource, 4e3)) fail2("RECIPIENT_CRITERIA_REVIEW_REQUIRED");
  const { approvalSource, ...scope } = criteria;
  if (stableJSON(scope) !== stableJSON(RECIPIENT_CRITERIA)) fail2("RECIPIENT_CRITERIA_CHANGED");
  return criteria;
}
function scopeOf(snapshot) {
  return { ...snapshot.version === 2 ? { recipientCriteria: snapshot.recipientCriteria } : {}, templateRevision: snapshot.template.revision, templateHash: hashValue(snapshot.template), signatureHash: hashValue(snapshot.signature), products: snapshot.products, ...snapshot.productMode === "approved_campaign_assets" ? { productMode: snapshot.productMode, campaignProducts: snapshot.campaignProducts } : {}, images: snapshot.template.requiredInlineImageIds.map((id) => {
    const x = snapshot.images.find((i) => i.id === id);
    return { id: x.id, sha256: x.sha256, bytes: x.bytes };
  }) };
}
function validateSnapshotData(data, owner) {
  keys(data, ["version", "owner", "template", "signature", "images", "products", "productMode", "campaignProducts", "recipientCriteria", "scopeHash", "contentHash"]);
  if (![1, 2].includes(data.version) || data.owner !== owner || !UUID.test(owner)) fail2("PRIVATE_SNAPSHOT_OWNER_MISMATCH");
  if (data.version === 2) requireRecipientCriteria(data);
  else if (data.recipientCriteria !== void 0) fail2("RECIPIENT_CRITERIA_CHANGED");
  keys(data.template, ["owner", "revision", "approved", "approvalSource", "subject", "body", "requiredInlineImageIds"]);
  if (data.template.owner !== owner || !Number.isSafeInteger(data.template.revision) || data.template.revision < 1) fail2("TEMPLATE_REVISION_REQUIRED");
  keys(data.signature, ["verified", "source", "senderEmail", "html", "text", "settingsId", "settingsVersion", "senderName"]);
  if (!UUID.test(data.signature.settingsId || "") || !Number.isSafeInteger(data.signature.settingsVersion) || data.signature.settingsVersion < 1 || !safeText(data.signature.senderName, 200) || /[\r\n]/.test(data.signature.senderName)) fail2("CURRENT_GMAIL_SIGNATURE_REQUIRED");
  if (!Array.isArray(data.images) || data.images.length !== 2) fail2("INLINE_IMAGES_REQUIRED");
  for (const image of data.images) keys(image, ["id", "owner", "verified", "sharingApproved", "mimeType", "content", "bytes", "sha256", "width", "height", "alt"]);
  validateInlineImages(data.images, { owner, requiredIds: data.template.requiredInlineImageIds });
  if (!Array.isArray(data.products) || ![0, 2].includes(data.products.length) || new Set(data.products.map((x) => x.id)).size !== data.products.length) fail2("PRODUCT_SCOPE_REQUIRED");
  for (const product of data.products) {
    keys(product, ["id", "version", "sha256"]);
    if (!UUID.test(product.id || "") || !Number.isSafeInteger(product.version) || product.version < 1 || !HASH.test(product.sha256 || "")) fail2("PRODUCT_SCOPE_REQUIRED");
  }
  if (data.productMode === "approved_campaign_assets") {
    if (data.products.length || !Array.isArray(data.campaignProducts) || data.campaignProducts.length !== 2 || new Set(data.campaignProducts.map((p) => p.name)).size !== 2) fail2("CAMPAIGN_PRODUCT_ASSETS_REQUIRED");
    for (const product of data.campaignProducts) {
      keys(product, ["name", "approvalSource"]);
      if (!["\uB9C8\uB77C\uCAC0\uB4DD\uBE75", "\uC9EC\uBF55\uCAC0\uB4DD\uBE75"].includes(product.name) || !safeText(product.approvalSource, 2e3)) fail2("CAMPAIGN_PRODUCT_ASSETS_CHANGED");
    }
  } else if (data.productMode !== void 0 && data.productMode !== "catalog" || data.campaignProducts !== void 0) fail2("PRODUCT_SCOPE_REQUIRED");
  renderOutreachCopy({ template: data.template, channelName: "\uAC80\uC99D \uCC44\uB110", signature: data.signature, inlineImages: data.images });
  const sanitized = gmailSignature(data.signature.html);
  if (sanitized.text !== data.signature.text || sanitized.html !== data.signature.html) fail2("CURRENT_GMAIL_SIGNATURE_CHANGED");
  if (data.scopeHash !== hashValue(scopeOf(data))) fail2("CAMPAIGN_SCOPE_CHANGED");
  const { contentHash, ...content } = data;
  if (!HASH.test(contentHash || "") || contentHash !== hashValue(content)) fail2("PRIVATE_SNAPSHOT_HASH_MISMATCH");
  return data;
}
function verifyPrivateSnapshot(row, owner) {
  if (row?.owner !== owner || !UUID.test(row.id || "") || !HASH.test(row.sha256 || "")) fail2("PRIVATE_SNAPSHOT_OWNER_MISMATCH");
  const data = validateSnapshotData(row.data, owner);
  if (row.sha256 !== hashValue(data)) fail2("PRIVATE_SNAPSHOT_HASH_MISMATCH");
  return data;
}

// supabase/functions/creator-daily-outreach/dispatch.mjs
import { randomUUID as randomUUID2 } from "node:crypto";

// supabase/functions/creator-daily-outreach/repository.mjs
var iso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00.000Z" : v;
function adaptYoutubeRecord(record) {
  const d = record.data || {}, r = d.youtubeResearch || {}, review = d.dailyOutreachEvidence || {};
  const channelId = r.channelId || String(d.profile || "").match(/\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
  if (!channelId) return null;
  const leads = (r.businessContacts || []).map((e) => ({ creatorKey: "youtube:" + channelId, address: e.email, sourceUrl: e.sourceUrl, sourceText: e.context || "", sourceKind: "unverified_secondary_source", checkedAt: iso(e.checked), verified: false }));
  return { platform: "youtube", externalId: channelId, name: d.name, profileUrl: d.profile, sourceRecordId: record.id, sourceRecordVersion: record.version, sourceRecordUpdated: record.updated, audience: d.followers, audienceSource: d.metricsSource, audienceCheckedAt: iso(review.audienceCheckedAt || r.subscriberObservationDate), lastActiveAt: review.lastActiveAt || r.observedActivity?.last_activity_date, activitySource: review.activitySource || r.observedActivity?.last_activity_url, activityCheckedAt: iso(review.activityCheckedAt), mukbang: review.mukbang, displayNameEvidence: review.displayNameEvidence, contactEvidence: Array.isArray(review.contactEvidence) ? review.contactEvidence : leads, excluded: ["\uAC70\uC808", "\uC218\uC2E0 \uAC70\uBD80", "\uC81C\uC678"].includes(d.status) };
}

// supabase/functions/youtube-manual-mail/sender-runtime.mjs
var error = (code) => new OutreachError(code, "\uD604\uC7AC Gmail \uC5F0\uACB0\uACFC \uC774\uB825 \uAC80\uD1A0\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.", 409);
var tokenURL = "https://oauth2.googleapis.com/token";
var base = "https://gmail.googleapis.com/gmail/v1/users/me";
function dailyGmailProvider({ sb: sb2, env: env2 = () => "", request = fetch, now = Date.now }) {
  const sessions = /* @__PURE__ */ new Map();
  const query = async (promise) => {
    const r = await promise;
    if (r.error) throw error("GMAIL_CONNECTION_UNAVAILABLE");
    return r.data;
  };
  async function remote(url, options = {}) {
    const u = new URL(url), token = url === tokenURL && options.method === "POST";
    const read = u.origin === "https://gmail.googleapis.com" && (!options.method || options.method === "GET") && (u.pathname === "/gmail/v1/users/me/messages" || /^\/gmail\/v1\/users\/me\/messages\/[A-Za-z0-9_-]{1,200}$/.test(u.pathname) || u.pathname === "/gmail/v1/users/me/profile");
    const send2 = url === base + "/messages/send" && options.method === "POST";
    if (!token && !read && !send2) throw error("PROVIDER_DESTINATION_NOT_ALLOWED");
    let response;
    try {
      response = await request(url, { ...options, redirect: "error", signal: AbortSignal.timeout(send2 ? 2e4 : 12e3) });
    } catch {
      throw error("PROVIDER_OUTCOME_UNKNOWN");
    }
    let data;
    try {
      data = await response.json();
    } catch {
      const e = error("PROVIDER_RESPONSE_INVALID");
      if (!response.ok) e.status = response.status;
      throw e;
    }
    if (!response.ok) {
      const e = error(token && data?.error === "invalid_grant" ? "GMAIL_REAUTH_REQUIRED" : "PROVIDER_REJECTED");
      e.status = response.status;
      throw e;
    }
    return data;
  }
  async function connection(owner) {
    const r = await query(sb2.from("sanji_connections").select("owner,encrypted,summary").eq("owner", owner).eq("provider", "gmail").maybeSingle());
    if (!r || r.owner !== owner || r.summary?.reauthRequired === true || !env2("TOKEN_ENCRYPTION_KEY")) throw error("GMAIL_REAUTH_REQUIRED");
    const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env2("TOKEN_ENCRYPTION_KEY"))), "AES-GCM", false, ["decrypt"]);
    try {
      const bytes = Buffer3.from(r.encrypted, "base64"), value = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))));
      if (!emailIdentity(value.email) || value.email.toLowerCase() !== r.summary.email?.toLowerCase()) throw error("GMAIL_ACCOUNT_CHANGED");
      return value;
    } catch {
      throw error("GMAIL_CONNECTION_UNAVAILABLE");
    }
  }
  async function account(owner, senderEmail) {
    const current = await query(sb2.from("sanji_connections").select("owner,summary").eq("owner", owner).eq("provider", "gmail").maybeSingle());
    if (current?.owner !== owner || current.summary?.reauthRequired === true || current.summary?.email?.toLowerCase() !== senderEmail) throw error("GMAIL_ACCOUNT_CHANGED");
    let session = sessions.get(owner);
    if (!session || session.email !== senderEmail || session.expires <= now() + 6e4) {
      let c = await connection(owner);
      if (c.email.toLowerCase() !== senderEmail) throw error("GMAIL_ACCOUNT_CHANGED");
      if (!c.access_token || !Number.isFinite(c.expires) || c.expires <= now() + 6e4) {
        if (!c.refresh_token || !env2("GOOGLE_CLIENT_ID") || !env2("GOOGLE_CLIENT_SECRET")) throw error("GMAIL_REAUTH_REQUIRED");
        const fresh = await remote(tokenURL, { method: "POST", body: new URLSearchParams({ client_id: env2("GOOGLE_CLIENT_ID"), client_secret: env2("GOOGLE_CLIENT_SECRET"), refresh_token: c.refresh_token, grant_type: "refresh_token" }) });
        if (typeof fresh.access_token !== "string" || !Number.isFinite(Number(fresh.expires_in)) || Number(fresh.expires_in) <= 0) throw error("GMAIL_REAUTH_REQUIRED");
        c = { ...c, access_token: fresh.access_token, expires: now() + Number(fresh.expires_in) * 1e3 };
      }
      session = { id: randomUUID3(), email: senderEmail, accessToken: c.access_token, expires: c.expires };
      sessions.set(owner, session);
    }
    const profile = await remote(base + "/profile", { headers: { Authorization: "Bearer " + session.accessToken } });
    if (profile?.emailAddress?.toLowerCase() !== senderEmail) throw error("GMAIL_ACCOUNT_CHANGED");
    return session;
  }
  function listResult(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data.messages !== void 0 && !Array.isArray(data.messages) || data.resultSizeEstimate !== void 0 && (!Number.isInteger(data.resultSizeEstimate) || data.resultSizeEstimate < 0) || data.messages === void 0 && data.resultSizeEstimate !== 0) throw error("GMAIL_HISTORY_UNVERIFIED");
    return data.messages || [];
  }
  async function history({ owner, address, senderEmail }) {
    const started = now();
    const emailKey = emailIdentity(address);
    if (!emailKey || address !== address.trim().toLowerCase() || !emailIdentity(senderEmail) || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) throw error("INVALID_EMAIL");
    const session = await account(owner, senderEmail), headers = { Authorization: "Bearer " + session.accessToken };
    const q = `in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`;
    const result = await remote(base + "/messages?" + new URLSearchParams({ q, maxResults: "1", includeSpamTrash: "true" }), { headers });
    if (listResult(result).length || result.nextPageToken || Number(result.resultSizeEstimate) > 0) throw error("EXISTING_GMAIL_CONTACT");
    if (emailKey.endsWith("@gmail.com")) {
      const broad = "in:anywhere {from:gmail.com to:gmail.com cc:gmail.com bcc:gmail.com from:googlemail.com to:googlemail.com cc:googlemail.com bcc:googlemail.com}";
      const aliases = await remote(base + "/messages?" + new URLSearchParams({ q: broad, maxResults: "100", includeSpamTrash: "true" }), { headers }), messages = listResult(aliases);
      if (aliases.nextPageToken || Number(aliases.resultSizeEstimate) > messages.length || messages.length > 100) throw error("GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED");
      for (const message of messages) {
        if (now() - started > 1e4) throw error("GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED");
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(message?.id || "")) throw error("GMAIL_HISTORY_UNVERIFIED");
        const params = new URLSearchParams({ format: "metadata" });
        for (const name of ["From", "To", "Cc", "Bcc", "Delivered-To"]) params.append("metadataHeaders", name);
        const detail = await remote(base + "/messages/" + message.id + "?" + params, { headers });
        if (detail?.id !== message.id || !Array.isArray(detail?.payload?.headers)) throw error("GMAIL_HISTORY_UNVERIFIED");
        const recipientHeaders = detail.payload.headers.filter((h) => ["from", "to", "cc", "bcc", "delivered-to"].includes(String(h.name).toLowerCase()));
        if (!recipientHeaders.length || recipientHeaders.some((h) => typeof h.value !== "string")) throw error("GMAIL_HISTORY_UNVERIFIED");
        const addresses = recipientHeaders.flatMap((h) => h.value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
        if (addresses.some((value) => emailIdentity(value) === emailKey)) throw error("EXISTING_GMAIL_CONTACT");
      }
    }
    return { session: session.id, proof: { checkedAt: new Date(started).toISOString(), address, emailKey, senderEmail, clear: true } };
  }
  async function historyFingerprint({ owner, address, senderEmail }) {
    const started = now(), key = emailIdentity(address);
    if (!key || address !== address.trim().toLowerCase() || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address) || !emailIdentity(senderEmail)) throw error("INVALID_EMAIL");
    const session = await account(owner, senderEmail), headers = { Authorization: "Bearer " + session.accessToken };
    const exact = `in:anywhere {from:${address} to:${address} cc:${address} bcc:${address}}`;
    const queries = [exact];
    if (key.endsWith("@gmail.com")) queries.push("in:anywhere {from:gmail.com to:gmail.com cc:gmail.com bcc:gmail.com from:googlemail.com to:googlemail.com cc:googlemail.com bcc:googlemail.com}");
    const ids = /* @__PURE__ */ new Set();
    for (const q of queries) {
      const list = await remote(base + "/messages?" + new URLSearchParams({ q, maxResults: "100", includeSpamTrash: "true" }), { headers }), messages = listResult(list);
      if (list.nextPageToken || Number(list.resultSizeEstimate) > messages.length || messages.length > 100) throw error("GMAIL_HISTORY_REVIEW_REQUIRED");
      for (const message of messages) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(message?.id || "")) throw error("GMAIL_HISTORY_UNVERIFIED");
        ids.add(message.id);
      }
    }
    if (ids.size > 100) throw error("GMAIL_HISTORY_REVIEW_REQUIRED");
    const matched = [];
    for (const id of ids) {
      if (now() - started > 1e4) throw error("GMAIL_HISTORY_REVIEW_REQUIRED");
      const params = new URLSearchParams({ format: "metadata" });
      for (const name of ["From", "To", "Cc", "Bcc", "Delivered-To"]) params.append("metadataHeaders", name);
      const detail = await remote(base + "/messages/" + id + "?" + params, { headers });
      if (detail?.id !== id || !Array.isArray(detail?.payload?.headers)) throw error("GMAIL_HISTORY_UNVERIFIED");
      const hs = detail.payload.headers.filter((h) => ["from", "to", "cc", "bcc", "delivered-to"].includes(String(h.name).toLowerCase()));
      if (!hs.length || hs.some((h) => typeof h.value !== "string")) throw error("GMAIL_HISTORY_UNVERIFIED");
      const addresses = hs.flatMap((h) => h.value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
      if (addresses.some((v) => emailIdentity(v) === key)) matched.push(id);
    }
    matched.sort();
    return { emailKey: key, senderEmail, messageIds: matched, fingerprint: hashValue({ owner, emailKey: key, senderEmail, ids: matched }), checkedAt: new Date(started).toISOString() };
  }
  const usedSessions = /* @__PURE__ */ new Set();
  async function send({ owner, raw, rawHash, senderEmail, session: sessionId, grant }) {
    if (!["CREATOR_DAILY_CONFIGURATION_ENABLED", "CREATOR_DAILY_DISPATCH_ENABLED", "CREATOR_DAILY_SCHEDULER_ENABLED", "EMAIL_SENDING_ENABLED"].every((name) => env2(name) === "true")) throw error("EMAIL_SENDING_DISABLED");
    const session = sessions.get(owner);
    if (!session || session.id !== sessionId || session.email !== senderEmail || session.expires <= now() + 2e4 || typeof raw !== "string" || hashValue(raw) !== rawHash || grant?.ready !== true || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now() || Date.parse(grant.expiresAt) > now() + 16e3) throw error("SEND_GRANT_EXPIRED");
    const key = hashValue({ owner, sessionId, rawHash, expiresAt: grant.expiresAt });
    if (usedSessions.has(key)) throw error("SEND_GRANT_REUSED");
    usedSessions.add(key);
    return remote(base + "/messages/send", { method: "POST", headers: { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  }
  async function manualSession({ owner, senderEmail }) {
    if (env2("YOUTUBE_MANUAL_SEND_ENABLED") !== "true" || env2("EMAIL_SENDING_ENABLED") !== "true") throw error("EMAIL_SENDING_DISABLED");
    if (typeof senderEmail !== "string" || senderEmail !== senderEmail.trim().toLowerCase() || !emailIdentity(senderEmail)) throw error("GMAIL_ACCOUNT_CHANGED");
    const s = await account(owner, senderEmail);
    return { session: s.id };
  }
  async function manualSend({ owner, raw, rawHash, senderEmail, session: sessionId, grant }) {
    if (env2("YOUTUBE_MANUAL_SEND_ENABLED") !== "true" || env2("EMAIL_SENDING_ENABLED") !== "true") throw error("EMAIL_SENDING_DISABLED");
    const session = sessions.get(owner), expiry = Date.parse(grant?.expiresAt);
    if (!session || session.id !== sessionId || session.email !== senderEmail || session.expires <= now() + 2e4 || typeof raw !== "string" || hashValue(raw) !== rawHash || grant?.ready !== true || grant.payloadHash !== rawHash || !Number.isFinite(expiry) || expiry <= now() || expiry > now() + 5e3) throw error("SEND_GRANT_EXPIRED");
    const key = hashValue({ owner, sessionId, rawHash, expiresAt: grant.expiresAt });
    if (usedSessions.has(key)) throw error("SEND_GRANT_REUSED");
    usedSessions.add(key);
    return remote(base + "/messages/send", { method: "POST", headers: { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  }
  return { history, historyFingerprint, send, manualSession, manualSend, resetSession() {
    sessions.clear();
    usedSessions.clear();
  } };
}

// supabase/functions/youtube-manual-mail/inline-mail.mjs
import { Buffer as Buffer4 } from "node:buffer";
import { createHash as createHash4, randomUUID as randomUUID4 } from "node:crypto";
import { inflateSync as inflateSync2 } from "node:zlib";
var fail3 = (code, text) => {
  throw new OutreachError(code, text);
};
var escape2 = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var encoded = (value) => Buffer4.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
var crcTable2 = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n >>> 1 ^ (n & 1 ? 3988292384 : 0);
  return n >>> 0;
});
function validPngPixels2(bytes, width, height) {
  let offset = 8, seenHeader = false, seenData = false, closedData = false, seenEnd = false;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size, type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    let crc = 4294967295;
    for (let i = offset + 4; i < end - 4; i++) crc = crc >>> 8 ^ crcTable2[(crc ^ bytes[i]) & 255];
    if ((crc ^ 4294967295) >>> 0 !== bytes.readUInt32BE(end - 4)) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uC6D0\uBCF8\uC758 \uAC80\uC0AC\uAC12\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    if (!seenHeader && type !== "IHDR" || type === "IHDR" && (seenHeader || size !== 13)) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD5E4\uB354\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (type === "IHDR") {
      seenHeader = true;
      if (bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) fail3("INLINE_IMAGE_PNG_UNSUPPORTED", "8\uBE44\uD2B8 RGB/RGBA PNG \uC6D0\uBCF8\uC744 \uC0AC\uC6A9\uD558\uC138\uC694.");
    } else if (type === "IDAT") {
      if (closedData) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uBE14\uB85D \uC21C\uC11C\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      seenData = true;
      chunks.push(bytes.subarray(offset + 8, end - 4));
    } else {
      if (seenData) closedData = true;
      if (type === "IEND") {
        if (size !== 0 || end !== bytes.length || !seenData) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB05D\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
        seenEnd = true;
      } else if (type === "PLTE") {
        if (seenData || !size || size % 3 || size > 768) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uD314\uB808\uD2B8\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
      } else if (type[0] === type[0].toUpperCase()) fail3("INLINE_IMAGE_PNG_UNSUPPORTED", "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 PNG \uC0AC\uC9C4 \uAD6C\uC870\uC785\uB2C8\uB2E4.");
    }
    offset = end;
  }
  if (!seenEnd) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4\uC774 \uC644\uC804\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const channels = bytes[25] === 6 ? 4 : 3, stride = width * channels + 1, expected = stride * height;
  if (expected > 80 * 1024 * 1024) fail3("INLINE_IMAGE_PNG_TOO_LARGE", "PNG \uD574\uB3C5 \uD06C\uAE30\uAC00 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
  let pixels;
  try {
    pixels = inflateSync2(Buffer4.concat(chunks), { maxOutputLength: expected + 1 });
  } catch {
    fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140\uC744 \uD574\uB3C5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (pixels.length !== expected) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140 \uD06C\uAE30\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) fail3("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD544\uD130\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
}
function validateInlineImages2(images, { owner, requiredIds }) {
  if (!Array.isArray(images) || images.length !== 2 || !Array.isArray(requiredIds) || requiredIds.length !== 2 || new Set(requiredIds).size !== 2 || !owner) fail3("INLINE_IMAGES_REQUIRED", "\uC815\uD655\uD55C \uBCF8\uBB38 \uC0AC\uC9C4 \uB450 \uC7A5\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const result = [], hashes = /* @__PURE__ */ new Set();
  let total = 0;
  for (const id of requiredIds) {
    const matches = images.filter((x) => x.id === id);
    if (matches.length !== 1) fail3("INLINE_IMAGE_ID_MISMATCH", "\uBCF8\uBB38 \uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const image = matches[0];
    if (image.owner !== owner || image.verified !== true || image.sharingApproved !== true || image.mimeType !== "image/png" || typeof image.content !== "string" || image.content.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content)) fail3("INLINE_IMAGE_UNVERIFIED", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uC6D0\uBCF8\xB7\uACC4\uC815\xB7\uACF5\uC720 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const bytes = Buffer4.from(image.content, "base64");
    if (bytes.length !== image.bytes || bytes.length < 45 || bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer4.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(12, 16).toString() !== "IHDR" || !bytes.subarray(-8, -4).equals(Buffer4.from("IEND"))) fail3("INLINE_IMAGE_BYTES_INVALID", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uD30C\uC77C \uD615\uC2DD\uACFC \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const sha256 = createHash4("sha256").update(bytes).digest("hex");
    if (sha256 !== image.sha256 || hashes.has(sha256)) fail3("INLINE_IMAGE_HASH_MISMATCH", "\uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uBC14\uB00C\uC5C8\uAC70\uB098 \uC911\uBCF5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    hashes.add(sha256);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width !== image.width || height !== image.height || width < 32 || height < 32 || width * height > 2e7) fail3("INLINE_IMAGE_DIMENSIONS", "\uBCF8\uBB38 \uC0AC\uC9C4 \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    validPngPixels2(bytes, width, height);
    total += bytes.length;
    if (total > 10 * 1024 * 1024) fail3("INLINE_IMAGES_TOO_LARGE", "\uBCF8\uBB38 \uC0AC\uC9C4 \uCD1D \uD06C\uAE30\uB97C \uC904\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
    result.push({ id, bytes, sha256, width, height, cid: "sanji-product-" + sha256 + "@sanji.local", name: "product-photo-" + (result.length + 1) + ".png", alt: typeof image.alt === "string" && image.alt.trim() ? image.alt.trim().slice(0, 150) : "\uC81C\uD488 \uC0AC\uC9C4 " + (result.length + 1) });
  }
  return result;
}
function bodyHtml(text) {
  return escape2(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\\\r?\n/g, "\n").split(/\r?\n/).map((line) => line === "---" ? "<hr>" : line).join("<br>");
}
function inlineContent({ copy, images, owner, requiredImageIds }, validatedImages) {
  if (!copy || copy.sendingEnabled !== false || typeof copy.body !== "string" || copy.body.length > 2e4) fail3("MAIL_PREVIEW_INVALID", "\uBCF8\uBB38\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (copy.attachments?.length) fail3("UNEXPECTED_ATTACHMENTS", "\uC77C\uBC18 \uCCA8\uBD80\uB97C \uCD94\uAC00\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const checked2 = validatedImages || validateInlineImages2(images, { owner, requiredIds: requiredImageIds });
  if (!Array.isArray(copy.inlineImages) || copy.inlineImages.length !== 2 || checked2.some((image, index) => copy.inlineImages[index]?.id !== image.id || copy.inlineImages[index]?.sha256 !== image.sha256)) fail3("INLINE_IMAGE_APPROVAL_MISMATCH", "\uC2B9\uC778\uD55C \uBCF8\uBB38 \uC0AC\uC9C4\uACFC \uC2E4\uC81C \uC6D0\uBCF8\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const signature = gmailSignature(copy.signatureHtml || "");
  if (!signature.text || signature.text !== copy.signatureText) fail3("SIGNATURE_CHANGED", "\uAE30\uC874 Gmail \uC11C\uBA85\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  let body = copy.body;
  const occurrences = body.split(signature.text).length - 1;
  if (occurrences > 1 || occurrences === 1 && !body.endsWith(signature.text)) fail3("SIGNATURE_PLACEMENT_REQUIRED", "\uC11C\uBA85\uC744 \uBCF8\uBB38 \uB9C8\uC9C0\uB9C9\uC5D0 \uD55C \uBC88\uB9CC \uBC30\uCE58\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (occurrences === 1) body = body.slice(0, -signature.text.length).replace(/\n\n$/, "");
  const imageHtml = checked2.map((image) => '<div style="margin:20px 0"><img src="cid:' + image.cid + '" alt="' + escape2(image.alt) + '" width="' + Math.min(image.width, 640) + '" style="display:block;width:100%;max-width:640px;height:auto;border:0"></div>').join("");
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial,sans-serif;line-height:1.6">' + bodyHtml(body) + "</div>" + imageHtml + "<div>" + signature.html + "</div></body></html>";
  const text = body + "\n\n" + signature.text;
  return { checked: checked2, html, text };
}
function createSharedInlinePreview({ images, owner, requiredImageIds }) {
  const checked2 = validateInlineImages2(images, { owner, requiredIds: requiredImageIds });
  const sharedImages = checked2.map((image) => ({ sha256: image.sha256, bytes: image.bytes.length, content: image.bytes.toString("base64") }));
  function render(copy) {
    const { html, text } = inlineContent({ copy, images, owner, requiredImageIds }, checked2);
    let result = html;
    const remoteSignatureImagesHidden = /<img\b[^>]*\bsrc="https?:/i.test(result);
    result = result.replace(/<img\b[^>]*\bsrc="https?:[^>]*>/gi, "");
    checked2.forEach((image, index) => {
      result = result.replace('src="cid:' + image.cid + '"', 'src="sanji-preview:' + index + '"');
    });
    return { html: result, text, remoteSignatureImagesHidden };
  }
  return { sharedImages, render };
}
function composeInlineOutreach2({ copy, images, owner, requiredImageIds, from, to, senderName, messageId = randomUUID4(), now = /* @__PURE__ */ new Date() }) {
  if (!copy || copy.sendingEnabled !== false || !emailIdentity(from) || !emailIdentity(to) || /[^\x21-\x7E]/.test(from + to) || !String(copy.subject || "").trim() || typeof copy.body !== "string" || copy.body.length > 2e4 || !String(senderName || "").trim() || !/^[-A-Za-z0-9_]{1,100}$/.test(messageId) || Number.isNaN(new Date(now).getTime())) fail3("MAIL_PREVIEW_INVALID", "\uBC1C\uC2E0\uC790\xB7\uC218\uC2E0\uC790\xB7\uBCF8\uBB38\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (typeof copy.senderEmail !== "string" || from !== copy.senderEmail.trim().toLowerCase()) fail3("SENDER_SIGNATURE_MISMATCH", "\uD604\uC7AC \uBC1C\uC2E0 \uACC4\uC815\uACFC \uC2B9\uC778\uB41C Gmail \uC11C\uBA85\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (copy.attachments?.length) fail3("UNEXPECTED_ATTACHMENTS", "\uC77C\uBC18 \uCCA8\uBD80\uB97C \uCD94\uAC00\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const { checked: checked2, html, text } = inlineContent({ copy, images, owner, requiredImageIds });
  const boundary = "sanji_alt_" + messageId, related = "sanji_related_" + messageId;
  const lines = [`From: ${encodedHeader(senderName)} <${from}>`, `To: ${to}`, `Subject: ${encodedHeader(copy.subject)}`, `Date: ${new Date(now).toUTCString()}`, `Message-ID: <${messageId}@sanji.local>`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encoded(text), `--${boundary}`, `Content-Type: multipart/related; boundary="${related}"; type="text/html"`, "", `--${related}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encoded(html)];
  for (const image of checked2) lines.push(`--${related}`, "Content-Type: image/png", `Content-ID: <${image.cid}>`, `Content-Disposition: inline; filename="${image.name}"`, "Content-Transfer-Encoding: base64", "", encoded(image.bytes));
  lines.push(`--${related}--`, `--${boundary}--`, "");
  const mime = lines.join("\r\n");
  if (Buffer4.byteLength(mime) > 20 * 1024 * 1024) fail3("MAIL_TOO_LARGE", "\uBA54\uC77C \uBCF8\uBB38 \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  return { raw: Buffer4.from(mime).toString("base64url"), html, text, imageCount: checked2.length, imageBytes: checked2.reduce((n, x) => n + x.bytes.length, 0), mimeBytes: Buffer4.byteLength(mime), sendingEnabled: false };
}

// supabase/functions/creator-daily-outreach/youtube-manual-review.mjs
import { createHash as createHash5 } from "node:crypto";
var fail4 = (code) => {
  throw Object.assign(new Error(code), { code });
};
var stable = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
var manualReviewHash = (s) => createHash5("sha256").update(stable(s)).digest("hex");
function buildManualReview({ owner, sender, snapshotHash, settingsId, settingsVersion, mailPolicy, rows, scope }) {
  if (typeof owner !== "string" || !owner || !emailIdentity(sender) || !/^[a-f0-9]{64}$/.test(snapshotHash || "") || typeof settingsId !== "string" || !settingsId || !Number.isSafeInteger(settingsVersion) || settingsVersion < 1 || !mailPolicy || typeof mailPolicy.classification !== "string" || typeof mailPolicy.classificationSource !== "string" || !mailPolicy.classificationSource || typeof mailPolicy.authorizationSource !== "string" || !mailPolicy.authorizationSource || !Array.isArray(rows) || !rows.length || rows.length > 100) fail4("REVIEW_INCOMPLETE");
  const ids = /* @__PURE__ */ new Set(), emails = /* @__PURE__ */ new Set(), channels = /* @__PURE__ */ new Set();
  const entries = rows.map((row) => {
    const key = emailIdentity(row?.email), channel = String(row?.channel || "");
    if (!row || row.owner !== owner || typeof row.name !== "string" || !row.name || typeof row.profileUrl !== "string" || !row.profileUrl || typeof row.sourceUrl !== "string" || !row.sourceUrl || typeof row.sourceCheckedAt !== "string" || !row.sourceCheckedAt || !Array.isArray(row.sources) || !row.sources.length || row.sources.length > 5 || row.sources.some((x) => !x || typeof x.url !== "string" || typeof x.checkedAt !== "string") || !/^[a-f0-9]{64}$/.test(row.sourceFingerprint || "") || row.reviewVersion !== "manual_source_review_v1" || !Number.isSafeInteger(row.audience) || typeof row.metricsSource !== "string" || typeof row.metricsCheckedAt !== "string" || typeof row.activitySource !== "string" || typeof row.activityCheckedAt !== "string" || typeof row.mukbangReason !== "string" || typeof row.id !== "string" || !row.id || !Number.isSafeInteger(row.version) || row.version < 1 || !/^UC[A-Za-z0-9_-]{22}$/.test(channel) || !key || typeof row.subject !== "string" || !row.subject.trim() || typeof row.body !== "string" || !row.body.trim() || ids.has(row.id) || emails.has(key) || channels.has(channel)) fail4("REVIEW_RECIPIENT_INVALID");
    ids.add(row.id);
    emails.add(key);
    channels.add(channel);
    return { id: row.id, version: row.version, channel, email: row.email.trim().toLowerCase(), emailKey: key, name: row.name, profileUrl: row.profileUrl, sourceUrl: row.sourceUrl, sourceCheckedAt: row.sourceCheckedAt, sources: row.sources, sourceFingerprint: row.sourceFingerprint, reviewVersion: row.reviewVersion, audience: row.audience, metricsSource: row.metricsSource, metricsCheckedAt: row.metricsCheckedAt, activitySource: row.activitySource, activityCheckedAt: row.activityCheckedAt, mukbangReason: row.mukbangReason, subject: row.subject, body: row.body };
  });
  const review = { owner, sender: sender.trim().toLowerCase(), snapshotHash, settingsId, settingsVersion, mailPolicy, entries, ...scope ? { scope } : {} };
  return { review, approvalHash: manualReviewHash(review) };
}

// supabase/functions/creator-daily-outreach/manual-email-cutoff.mjs
var MANUAL_EMAIL_START = "2026-11-09T15:00:00.000Z";
var normalizeEmail = (x) => emailIdentity(x) || "";
var acceptedStatus = /* @__PURE__ */ new Set(["reserved", "queued", "processing", "accepted", "sent", "outcome_unknown"]);
function classifyManualRecipient({ owner, creatorKey, email, records, suppressed, explicitRefusal, complete }) {
  if (typeof owner !== "string" || !owner || typeof creatorKey !== "string" || !creatorKey || !normalizeEmail(email) || complete !== true || !Array.isArray(records) || typeof suppressed !== "boolean" || typeof explicitRefusal !== "boolean") return { eligible: false, reason: "verification_incomplete" };
  if (suppressed || explicitRefusal) return { eligible: false, reason: "refusal_or_suppression" };
  for (const r of records) {
    if (!r || r.owner !== owner || r.scope !== "manual_creator_email" || typeof r.creatorKey !== "string" || !normalizeEmail(r.email) || !acceptedStatus.has(r.status) || !Number.isFinite(Date.parse(r.createdAt))) return { eligible: false, reason: "ledger_invalid" };
    if (Date.parse(r.createdAt) < Date.parse(MANUAL_EMAIL_START)) continue;
    if (r.creatorKey === creatorKey || normalizeEmail(r.email) === normalizeEmail(email)) return { eligible: false, reason: r.attribution === "unverified_prior_work" ? "history_origin_unverified" : "already_sent_or_pending" };
  }
  return { eligible: true, reason: "ready_for_review" };
}

// supabase/functions/creator-daily-outreach/youtube-manual-history.mjs
var fail5 = () => {
  throw Object.assign(new Error("HISTORY_INCOMPLETE"), { code: "HISTORY_INCOMPLETE" });
};
function verifiedManualHistory({ owner, ledger, suppression, refusals, identities, gmailReview, now = Date.now() }) {
  if (typeof owner !== "string" || !owner) fail5();
  for (const source of [ledger, suppression, refusals, identities, gmailReview]) if (!source || source.owner !== owner || source.complete !== true || !Array.isArray(source.rows)) fail5();
  const records = ledger.rows.map((r) => {
    if (r.owner !== owner || r.scope !== "manual_creator_email" || typeof r.creatorKey !== "string" || !r.creatorKey || !emailIdentity(r.email) || !["reserved", "queued", "processing", "accepted", "sent", "outcome_unknown"].includes(r.status) || !Number.isFinite(Date.parse(r.createdAt))) fail5();
    return { owner, scope: r.scope, creatorKey: r.creatorKey, email: r.email, status: r.status, createdAt: r.createdAt, ...r.attribution === "unverified_prior_work" ? { attribution: r.attribution } : {}, ...typeof r.id === "string" ? { id: r.id } : {}, ...typeof r.batchId === "string" ? { batchId: r.batchId } : {} };
  });
  const normalize = (rows) => [...new Set(rows.map((r) => {
    if (!r || r.owner !== owner || !emailIdentity(r.email)) fail5();
    return emailIdentity(r.email);
  }))];
  const suppressedKeys = normalize(suppression.rows), refusedKeys = normalize(refusals.rows), proof = /* @__PURE__ */ new Map();
  for (const row of gmailReview.rows) {
    const key = emailIdentity(row?.email);
    const t = Date.parse(row?.checkedAt);
    if (row?.owner !== owner || !key || !["no_refusal_confirmed", "refusal", "unknown"].includes(row.status) || !Number.isFinite(t) || t > now || now - t > 6e4 || !["provider_empty_history", "provider_existing_history", "provider_unavailable", "owner_reviewed"].includes(row.source) || row.status === "no_refusal_confirmed" && ["provider_existing_history", "provider_unavailable"].includes(row.source) || proof.has(key)) fail5();
    proof.set(key, row.status);
    if (row.status === "refusal") refusedKeys.push(key);
  }
  const creators = /* @__PURE__ */ new Map(), emails = /* @__PURE__ */ new Map();
  for (const row of identities.rows) {
    if (row?.owner !== owner || typeof row.creatorKey !== "string" || !/^youtube:UC[A-Za-z0-9_-]{22}$/.test(row.creatorKey) || !Array.isArray(row.emailKeys) || row.emailKeys.some((e) => emailIdentity(e) !== e)) fail5();
    creators.set(row.creatorKey, (creators.get(row.creatorKey) || 0) + 1);
    for (const e of new Set(row.emailKeys)) {
      const keys2 = emails.get(e) || /* @__PURE__ */ new Set();
      keys2.add(row.creatorKey);
      emails.set(e, keys2);
    }
  }
  const duplicateCreatorKeys = [...creators].filter(([, n]) => n > 1).map(([k]) => k), sharedEmailKeys = [...emails].filter(([, v]) => v.size > 1).map(([k]) => k);
  return { duplicateCreatorKeys, sharedEmailKeys, owner, complete: true, scope: "manual_youtube_since_2026_11_10", refusalsComplete: true, records, suppressedKeys, refusedKeys: [...new Set(refusedKeys)], gmailReviewByKey: proof };
}
function gmailRefusalReviewed(history, email) {
  const key = emailIdentity(email);
  return Boolean(key && history?.gmailReviewByKey instanceof Map && history.gmailReviewByKey.get(key) === "no_refusal_confirmed");
}

// supabase/functions/youtube-manual-mail/policy.mjs
function manualMailPolicy(policy, owner, revision) {
  const d = policy?.data, valid = policy?.owner === owner && policy.revision === revision && CAMPAIGN_CLASSIFICATIONS.includes(d?.classification) && typeof d.classificationSource === "string" && d.classificationSource.trim().length > 0 && d.classificationSource.length <= 2e3 && typeof d.authorizationSource === "string" && d.authorizationSource.trim().length > 0 && d.authorizationSource.length <= 2e3;
  if (!valid) throw Object.assign(new Error("MESSAGE_CLASSIFICATION_REVIEW_REQUIRED"), { code: "MESSAGE_CLASSIFICATION_REVIEW_REQUIRED" });
  return { classification: d.classification, classificationSource: d.classificationSource, authorizationSource: d.authorizationSource };
}

// supabase/functions/youtube-manual-mail/target.mjs
import { createHash as createHash6 } from "node:crypto";
var fail6 = (code = "RECIPIENT_REVIEW_REQUIRED") => {
  throw Object.assign(new Error(code), { code });
};
var checked = (value, now) => {
  const n = Date.parse(value);
  return Number.isFinite(n) && n <= now && now - n <= 30 * 864e5 ? new Date(n).toISOString() : null;
};
var publicUrl = (value) => {
  const url = sourceUrl(value);
  if (!url) return null;
  const u = new URL(url);
  if (!u.search) return url;
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname) && u.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get("v") || "")) return "https://www.youtube.com/watch?v=" + u.searchParams.get("v");
  return null;
};
var fingerprint = (x) => createHash6("sha256").update(JSON.stringify(x)).digest("hex");
function manualYoutubeTarget(resolved, owner, requestedEmail, now = Date.now()) {
  if (resolved?.complete !== true || resolved.owner !== owner || !resolved.candidate || resolved.candidate.platform !== "youtube" || !emailIdentity(requestedEmail) || requestedEmail !== requestedEmail.trim().toLowerCase()) fail6();
  const native = resolved.native;
  if (!native) fail6();
  const d = native.data || {}, c = resolved.candidate, key = "youtube:" + c.externalId, profile = sourceUrl(d.profile);
  if (native.owner !== owner || native.id !== resolved.id || native.version !== resolved.version || native.kind !== "candidate" || d.kind !== "\uD06C\uB9AC\uC5D0\uC774\uD130" || d.channels !== "YouTube" || !/^UC[A-Za-z0-9_-]{22}$/.test(c.externalId || "") || !profile || !new RegExp("^https://(?:www\\.)?youtube\\.com/channel/" + c.externalId + "/?$").test(profile) || typeof d.name !== "string" || !d.name.trim() || d.name.length > 150 || /[\u0000-\u001f\u007f]/.test(d.name) || ["\uAC70\uC808", "\uC218\uC2E0 \uAC70\uBD80", "\uC81C\uC678", "\uC0C1\uB300\uBC29 \uAC70\uC808", "\uC6B0\uB9AC \uCE21 \uAC70\uC808"].includes(d.status) || c.excluded === true) fail6();
  if (/(?:privacy|abuse|noreply|no-reply|support|careers|recruit|legal)@/i.test(requestedEmail)) fail6();
  const leads = [d.contact, ...Array.isArray(d.youtubeResearch?.businessContacts) ? d.youtubeResearch.businessContacts : []].filter(Boolean), matches = [];
  const sameMailboxSpellings = new Set(leads.map((x) => typeof x.email === "string" ? x.email.trim().toLowerCase() : "").filter((x) => x && emailIdentity(x) === emailIdentity(requestedEmail)));
  if (sameMailboxSpellings.size !== 1) fail6("PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED");
  const denial = /(?:수신\s*거부|연락.{0,12}(?:중단|그만|하지\s*마)|(?:협업|광고|제휴).{0,24}(?:거절|금지|불가|받지|원하지)|unsubscribe|please\s+stop|not\s+(?:for\s+)?(?:business|collab)|no\s+(?:business|collab))/i;
  for (const lead of leads) {
    if (emailIdentity(typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "") === emailIdentity(requestedEmail) && denial.test([lead.context, lead.purpose, lead.note].filter((x) => typeof x === "string").join(" "))) fail6("RECIPIENT_BLOCKED");
  }
  for (const lead of leads) {
    if (typeof lead.email !== "string" || lead.email.trim().toLowerCase() !== requestedEmail) continue;
    const url = publicUrl(lead.sourceUrl || lead.source), date = checked(lead.checked || lead.observedAt, now);
    if (!url || !date) continue;
    matches.push({ url, checkedAt: date, email: requestedEmail, context: typeof lead.context === "string" ? lead.context.slice(0, 4e3) : "" });
  }
  const unique = [...new Map(matches.map((m) => [m.url + "|" + m.checkedAt + "|" + m.context, m])).values()].sort((a, b) => (a.url + "|" + a.checkedAt + "|" + a.context).localeCompare(b.url + "|" + b.checkedAt + "|" + b.context));
  if (!unique.length || unique.length > 5 || unique.some((x) => /(?:not\s+(?:for\s+)?(?:business|collab)|no\s+(?:business|collab)|(?:협업|광고|제휴).{0,20}(?:거절|금지|불가|받지))/i.test(x.context))) fail6("PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED");
  const distinctEmails = new Set(leads.map((x) => emailIdentity(typeof x.email === "string" ? x.email.trim().toLowerCase() : "")).filter(Boolean));
  if (distinctEmails.size !== 1) fail6("PUBLIC_EMAIL_SOURCE_REVIEW_REQUIRED");
  const audience = d.followers, metricsSource = publicUrl(d.metricsSource), metricsCheckedAt = checked(d.metricsChecked, now), reason = typeof d.reason === "string" ? d.reason.trim() : "";
  const activities = (Array.isArray(d.evidence) ? d.evidence : []).filter((e) => /최근|활동|activity|recent/i.test(String(e.description || ""))).map((e) => ({ url: publicUrl(e.url), date: checked(e.checked, now) })).filter((e) => e.url && e.date).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.url.localeCompare(b.url));
  if (!Number.isSafeInteger(audience) || audience < 3e4 || audience > 2e5 || !metricsSource || !metricsCheckedAt) fail6("AUDIENCE_SOURCE_REVIEW_REQUIRED");
  if (reason.length > 4e3) fail6("RECIPIENT_REVIEW_REQUIRED");
  if (activities.length < 1) fail6("ACTIVITY_SOURCE_REVIEW_REQUIRED");
  return { creatorKey: key, platform: "youtube", externalId: c.externalId, name: d.name.trim(), profileUrl: profile, contact: { address: requestedEmail, key: emailIdentity(requestedEmail) }, sourceUrl: unique[0].url, sourceCheckedAt: unique[0].checkedAt, sources: unique.map(({ url, checkedAt }) => ({ url, checkedAt })), sourceFingerprint: fingerprint(unique), audience, metricsSource, metricsCheckedAt, activitySource: activities[0].url, activityCheckedAt: activities[0].date, mukbangReason: reason, reviewVersion: "manual_source_review_v1" };
}

// supabase/functions/youtube-manual-mail/project-scope.mjs
var project = "gs-bbangteojineunjip-chewy-bread";
function validateProjectScope(scope) {
  if (!scope || Object.keys(scope).some((k) => !["projectId", "day"].includes(k)) || scope.projectId !== project || typeof scope.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scope.day)) throw Error("PROJECT_SCOPE_INVALID");
  const date = /* @__PURE__ */ new Date(scope.day + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== scope.day) throw Error("PROJECT_SCOPE_INVALID");
  return { projectId: project, day: scope.day };
}
function belongsToProjectDay(data, scope) {
  const valid = validateProjectScope(scope), members = Array.isArray(data?.youtubeResearch?.projects) ? data.youtubeResearch.projects.filter((x) => x?.id === valid.projectId) : [];
  if (members.length !== 1) return false;
  const m = members[0], added = Date.parse(m.addedAt);
  if (!Number.isFinite(added)) return false;
  let day;
  if (m.assignedDay !== void 0) {
    if (typeof m.assignedDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.assignedDay)) return false;
    day = m.assignedDay;
  } else day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(added));
  return day === valid.day;
}

// supabase/functions/creator-daily-outreach/youtube-manual-prepare.mjs
var fail7 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function createYoutubeManualPrepare({ repository, now = Date.now }) {
  return async function prepare(owner, input) {
    if (typeof owner !== "string" || !owner || !input || Object.keys(input).some((k) => !["expectedRevision", "recipients", "scope"].includes(k)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 100) fail7("INVALID_SELECTION");
    const scope = input.scope === void 0 ? void 0 : validateProjectScope(input.scope);
    const ids = /* @__PURE__ */ new Set();
    for (const r of input.recipients) {
      if (!r || Object.keys(r).some((k) => !["id", "version", "email"].includes(k)) || typeof r.id !== "string" || !r.id || !Number.isSafeInteger(r.version) || r.version < 1 || typeof r.email !== "string" || ids.has(r.id)) fail7("INVALID_SELECTION");
      ids.add(r.id);
    }
    const policy = await repository.policy(owner);
    if (policy?.owner !== owner || policy.revision !== input.expectedRevision || !policy.snapshot_id) fail7("SNAPSHOT_CHANGED");
    const mailPolicy = manualMailPolicy(policy, owner, input.expectedRevision);
    const [stored, settings, connection, history] = await Promise.all([repository.snapshot(owner, policy.snapshot_id), repository.currentSettings(owner), repository.currentConnection(owner), repository.manualHistory(owner, input.recipients.map((r) => r.email.trim().toLowerCase()))]);
    const snapshot = verifyPrivateSnapshot(stored, owner);
    if (snapshot.products.length) {
      const products = await repository.currentProducts(owner, snapshot.products.map((p) => p.id));
      if (!Array.isArray(products) || stableJSON(products.map(({ id, version, sha256 }) => ({ id, version, sha256 })).sort((a, b) => a.id.localeCompare(b.id))) !== stableJSON([...snapshot.products].sort((a, b) => a.id.localeCompare(b.id)))) fail7("PRODUCT_SCOPE_CHANGED");
    }
    if (stableJSON(settingsSignature(settings, connection)) !== stableJSON(snapshot.signature)) fail7("SENDER_CHANGED");
    if (!history || history.owner !== owner || history.complete !== true || history.scope !== "manual_youtube_since_2026_11_10" || history.refusalsComplete !== true || !Array.isArray(history.records) || !Array.isArray(history.suppressedKeys) || !Array.isArray(history.refusedKeys) || !Array.isArray(history.duplicateCreatorKeys) || !Array.isArray(history.sharedEmailKeys)) fail7("HISTORY_INCOMPLETE");
    const rows = [], previews = [], shared = createSharedInlinePreview({ images: snapshot.images, owner, requiredImageIds: snapshot.template.requiredInlineImageIds });
    for (const choice of input.recipients) {
      const resolved = await repository.currentRecipient(owner, choice.id);
      if (resolved?.complete !== true || resolved.owner !== owner || resolved.id !== choice.id || resolved.version !== choice.version || resolved.candidate?.platform !== "youtube") fail7("RECIPIENT_CHANGED");
      if (scope && !belongsToProjectDay(resolved.native?.data, scope)) fail7("PROJECT_SCOPE_CHANGED");
      let target;
      try {
        target = manualYoutubeTarget(resolved, owner, choice.email.trim().toLowerCase(), now());
      } catch (error2) {
        error2.candidateId = resolved.id;
        throw error2;
      }
      const c = resolved.candidate, creatorKey = target.creatorKey;
      const email = target.contact.address, key = target.contact.key;
      if (history.duplicateCreatorKeys.includes(creatorKey) || history.sharedEmailKeys.includes(key)) {
        const error2 = Object.assign(new Error("IDENTITY_AMBIGUOUS"), { code: "IDENTITY_AMBIGUOUS", candidateId: resolved.id });
        throw error2;
      }
      if (!gmailRefusalReviewed(history, email)) {
        const error2 = Object.assign(new Error("GMAIL_REFUSAL_REVIEW_REQUIRED"), { code: "GMAIL_REFUSAL_REVIEW_REQUIRED", candidateId: resolved.id });
        throw error2;
      }
      const assessment = classifyManualRecipient({ owner, creatorKey, email, records: history.records, suppressed: history.suppressedKeys.includes(key), explicitRefusal: history.refusedKeys.includes(key), complete: true });
      if (!assessment.eligible) {
        const code = assessment.reason === "history_origin_unverified" ? "HISTORY_ORIGIN_UNVERIFIED" : assessment.reason === "already_sent_or_pending" ? "WORK_ALREADY_SENT_OR_PENDING" : "RECIPIENT_BLOCKED";
        throw Object.assign(new Error(code), { code, candidateId: resolved.id });
      }
      const copy = renderOutreachCopy({ template: snapshot.template, channelName: target.name, signature: snapshot.signature, inlineImages: snapshot.images });
      const rendered = shared.render(copy);
      rows.push({ owner, id: resolved.id, version: resolved.version, channel: c.externalId, email, name: target.name, profileUrl: target.profileUrl, sourceUrl: target.sourceUrl, sourceCheckedAt: target.sourceCheckedAt, sources: target.sources, sourceFingerprint: target.sourceFingerprint, reviewVersion: target.reviewVersion, audience: target.audience, metricsSource: target.metricsSource, metricsCheckedAt: target.metricsCheckedAt, activitySource: target.activitySource, activityCheckedAt: target.activityCheckedAt, mukbangReason: target.mukbangReason, subject: copy.subject, body: copy.body });
      previews.push({ id: resolved.id, channelName: target.name, profileUrl: target.profileUrl, sourceUrl: target.sourceUrl, sourceCheckedAt: target.sourceCheckedAt, sources: target.sources, audience: target.audience, metricsSource: target.metricsSource, metricsCheckedAt: target.metricsCheckedAt, activitySource: target.activitySource, activityCheckedAt: target.activityCheckedAt, mukbangReason: target.mukbangReason, recipient: email, subject: copy.subject, html: rendered.html });
    }
    const current = await repository.policy(owner);
    if (current?.owner !== owner || current.revision !== policy.revision || current.snapshot_id !== policy.snapshot_id) fail7("SNAPSHOT_CHANGED");
    const { review, approvalHash } = buildManualReview({ owner, sender: snapshot.signature.senderEmail, snapshotHash: stored.sha256, settingsId: settings.id, settingsVersion: settings.version, mailPolicy, rows, scope });
    return { previewOnly: true, sendingEnabled: false, policyRevision: policy.revision, snapshotId: stored.id, approvalHash, review, previews, sharedImages: shared.sharedImages, warning: "\uC218\uC2E0 \uAC70\uBD80 \uC7AC\uD655\uC778 \uD6C4 Gmail \uC694\uCCAD \uC804 \uBC1C\uC0DD\uD55C \uBCC0\uACBD\uC740 \uBC18\uC601\uB418\uC9C0 \uC54A\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4." };
  };
}

// supabase/functions/youtube-manual-mail/repository.mjs
var fail8 = () => {
  throw Object.assign(new Error("MANUAL_DATABASE_UNAVAILABLE"), { code: "MANUAL_DATABASE_UNAVAILABLE" });
};
function youtubeManualRepository({ sb: sb2, historySource }) {
  const query = async (q) => {
    let r;
    try {
      r = await q;
    } catch {
      fail8();
    }
    if (r?.error) fail8();
    return r.data;
  };
  const rpc = (name, args) => query(sb2.rpc("sanji_youtube_manual_" + name, args));
  return {
    policy: (owner) => query(sb2.from("sanji_daily_campaign_policy").select("*").eq("owner", owner).maybeSingle()),
    snapshot: (owner, id) => query(sb2.from("sanji_daily_campaign_snapshots").select("*").eq("owner", owner).eq("id", id).maybeSingle()),
    async currentSettings(owner) {
      const rows = await query(sb2.from("sanji_records").select("id,owner,version,data").eq("owner", owner).eq("kind", "settings").order("id").limit(1));
      return rows?.[0] || null;
    },
    currentConnection: (owner) => query(sb2.from("sanji_connections").select("owner,provider,summary").eq("owner", owner).eq("provider", "gmail").maybeSingle()),
    currentProducts: (owner, ids) => query(sb2.rpc("sanji_daily_campaign_products", { p_owner: owner, p_product_ids: ids })),
    async currentRecipient(owner, id) {
      const row = await query(sb2.from("sanji_records").select("id,owner,kind,data,version,updated").eq("owner", owner).eq("kind", "candidate").eq("id", id).maybeSingle());
      if (!row || row.owner !== owner || row.id !== id || row.kind !== "candidate" || row.data?.channels !== "YouTube") return { complete: false };
      const candidate = adaptYoutubeRecord(row);
      return { complete: Boolean(candidate), owner, id, version: row.version, candidate, native: row };
    },
    async manualHistory(owner, addresses) {
      if (typeof historySource !== "function") fail8();
      const sources = await historySource(owner, addresses);
      return verifiedManualHistory({ owner, ...sources });
    },
    async recordGmailReview({ owner, candidateId, version, email, sender, fingerprint: fingerprint2, count }) {
      return rpc("record_gmail_review", { p_owner: owner, p_candidate: candidateId, p_version: version, p_email: email, p_sender: sender, p_fingerprint: fingerprint2, p_count: count });
    },
    async createBatch({ owner, snapshotId, snapshotHash, settingsVersion, policyRevision, approvalHash, review }) {
      const id = await rpc("create_batch", { p_owner: owner, p_snapshot: snapshotId, p_snapshot_hash: snapshotHash, p_settings_version: settingsVersion, p_policy_revision: policyRevision, p_approval_hash: approvalHash, p_review: review });
      if (typeof id !== "string") fail8();
      return { id, owner };
    },
    async batch(owner, id) {
      const r = await query(sb2.from("sanji_youtube_manual_batches").select("id,owner,snapshot_id,snapshot_hash,policy_revision,approval_hash,review,created_at,expires_at,confirmed_at").eq("owner", owner).eq("id", id).maybeSingle());
      if (!r || r.owner !== owner || r.id !== id) return null;
      return { id: r.id, owner: r.owner, snapshotId: r.snapshot_id, snapshotHash: r.snapshot_hash, policyRevision: r.policy_revision, approvalHash: r.approval_hash, review: r.review, createdAt: r.created_at, expiresAt: r.expires_at, confirmedAt: r.confirmed_at };
    },
    async confirmBatch({ owner, batchId, approvalHash }) {
      return await rpc("confirm_batch", { p_owner: owner, p_batch: batchId, p_approval_hash: approvalHash }) === true;
    },
    async recentBatches(owner, offset = 0) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e4) fail8();
      const r = await sb2.from("sanji_youtube_manual_batches").select("id,owner,approval_hash,created_at,confirmed_at", { count: "exact" }).eq("owner", owner).not("confirmed_at", "is", null).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 9);
      if (r.error || !Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.data.length > 10 || r.data.some((x) => x.owner !== owner || !x.confirmed_at)) fail8();
      return { offset, more: r.count > offset + r.data.length, rows: r.data.map((x) => ({ id: x.id, approvalHash: x.approval_hash, createdAt: x.created_at })) };
    },
    async batchRows(owner, batchId) {
      const r = await sb2.from("sanji_youtube_manual_ledger").select("id,owner,batch_id,candidate_id,candidate_version,email,email_key,payload_hash,message_id,state", { count: "exact" }).eq("owner", owner).eq("batch_id", batchId).order("candidate_id").limit(101);
      if (r.error || !Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count !== r.data.length || r.data.length > 100 || r.data.some((x) => x.owner !== owner || x.batch_id !== batchId)) fail8();
      return r.data;
    },
    async scheduleStatus(owner, batchId) {
      const r = await query(sb2.from("sanji_youtube_manual_schedule").select("owner,batch_id,run_at,state").eq("owner", owner).eq("batch_id", batchId).maybeSingle());
      if (!r) return null;
      if (r.owner !== owner || r.batch_id !== batchId || !Number.isFinite(Date.parse(r.run_at)) || !["scheduled", "processing", "complete", "held", "outcome_unknown", "cancelled"].includes(r.state)) fail8();
      return { runAt: r.run_at, state: r.state };
    },
    async reserveBatch({ owner, batchId, approvalHash, items }) {
      return rpc("reserve_batch", { p_owner: owner, p_batch: batchId, p_approval: approvalHash, p_items: items });
    },
    async scheduleBatch({ owner, batchId, approvalHash, items, expectedRunAt }) {
      return rpc("schedule_batch", { p_owner: owner, p_batch: batchId, p_approval: approvalHash, p_items: items, p_expected_run_at: expectedRunAt });
    },
    async claimDue() {
      return rpc("claim_due", {});
    },
    async continueClaim({ token }) {
      return rpc("continue_schedule", { p_token: token });
    },
    async finishClaim({ token, result }) {
      await rpc("finish_schedule", { p_token: token, p_result: result });
    },
    async cancelPending({ owner, batchId }) {
      return rpc("cancel_pending", { p_owner: owner, p_batch: batchId });
    },
    async claimRow({ owner, id, approvalHash, payloadHash }) {
      return rpc("claim", { p_owner: owner, p_id: id, p_approval: approvalHash, p_payload: payloadHash });
    },
    async claimScheduledRow({ owner, id, approvalHash, payloadHash, schedulerToken }) {
      return rpc("claim_scheduled", { p_owner: owner, p_id: id, p_approval: approvalHash, p_payload: payloadHash, p_scheduler_token: schedulerToken });
    },
    async recheck({ owner, id, token }) {
      return rpc("recheck", { p_owner: owner, p_id: id, p_token: token });
    },
    async consume({ owner, id, token, payloadHash }) {
      return rpc("consume", { p_owner: owner, p_id: id, p_token: token, p_payload: payloadHash });
    },
    async finish({ owner, id, token, status, providerId, providerThread }) {
      return rpc("finish", { p_owner: owner, p_id: id, p_token: token, p_result: status, p_provider_id: providerId ?? null, p_provider_thread: providerThread ?? null });
    }
  };
}

// supabase/functions/youtube-manual-mail/gmail-refusal-review.mjs
async function gmailRefusalReview({ provider, owner, senderEmail, addresses, now = Date.now }) {
  if (!owner || !emailIdentity(senderEmail) || !Array.isArray(addresses) || addresses.length > 100 || new Set(addresses.map(emailIdentity)).size !== addresses.length || addresses.some((a) => !emailIdentity(a))) throw Error("GMAIL_REVIEW_INVALID");
  const rows = new Array(addresses.length), deadline = now() + 45e3;
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= addresses.length) return;
      const email = addresses[i];
      if (now() > deadline) {
        rows[i] = { owner, email, status: "unknown", source: "provider_unavailable", checkedAt: new Date(now()).toISOString() };
        continue;
      }
      try {
        const result = await provider.history({ owner, address: email.trim().toLowerCase(), senderEmail }), p = result?.proof, checked2 = Date.parse(p?.checkedAt), elapsed = now() - checked2;
        if (p?.clear !== true || p.address !== email.trim().toLowerCase() || p.emailKey !== emailIdentity(email) || p.senderEmail !== senderEmail || !Number.isFinite(checked2) || elapsed < 0 || elapsed > 1e4) throw Error("GMAIL_HISTORY_UNVERIFIED");
        rows[i] = { owner, email, status: "no_refusal_confirmed", source: "provider_empty_history", checkedAt: p.checkedAt };
      } catch (error2) {
        if (error2?.code !== "EXISTING_GMAIL_CONTACT" && error2?.code !== "GMAIL_ALIAS_HISTORY_REVIEW_REQUIRED") {
          rows[i] = { owner, email, status: "unknown", source: "provider_unavailable", checkedAt: new Date(now()).toISOString() };
          continue;
        }
        let fingerprint2 = null;
        try {
          fingerprint2 = await provider.historyFingerprint({ owner, address: email.trim().toLowerCase(), senderEmail });
        } catch {
        }
        rows[i] = { owner, email, status: "unknown", source: "provider_existing_history", checkedAt: fingerprint2?.checkedAt || new Date(now()).toISOString(), ...fingerprint2 ? { fingerprint: fingerprint2.fingerprint, messageCount: fingerprint2.messageIds.length } : {} };
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, addresses.length) }, () => worker()));
  if (results.some((r) => r.status === "rejected") || rows.some((x) => !x)) throw Error("GMAIL_HISTORY_UNAVAILABLE");
  return { owner, complete: true, rows };
}

// supabase/functions/youtube-manual-mail/history-source.mjs
var cutoff = Date.parse("2026-11-09T15:00:00.000Z");
var fail9 = () => {
  throw Object.assign(new Error("HISTORY_INCOMPLETE"), { code: "HISTORY_INCOMPLETE" });
};
var emailFrom = (x) => emailIdentity(String(x || "").replace(/^email:/i, ""));
function youtubeManualHistorySource({ readSnapshot, provider, connection, now = Date.now }) {
  return async function read(owner, addresses) {
    if (typeof readSnapshot !== "function" || !owner || !Array.isArray(addresses) || !addresses.length || addresses.length > 100) fail9();
    const result = await readSnapshot(owner, ["sanji_youtube_manual_ledger", "sanji_youtube_manual_gmail_reviews", "sanji_daily_campaign_queue", "sanji_outbox", "sanji_suppression", "sanji_records"]);
    const tables = result?.tables;
    if (result?.owner !== owner || result.complete !== true || !tables || Object.values(tables).some((rows) => !Array.isArray(rows) || rows.some((r) => r.owner !== owner))) fail9();
    for (const table of ["sanji_youtube_manual_ledger", "sanji_youtube_manual_gmail_reviews", "sanji_daily_campaign_queue", "sanji_outbox", "sanji_suppression", "sanji_records"]) if (!Array.isArray(tables[table])) fail9();
    const ledger = [], candidateById = new Map(tables.sanji_records.filter((r) => r.kind === "candidate").map((r) => [r.id, r]));
    const add = (r, creatorKey, email, status, createdAt, attribution, batchId, id) => {
      if (!emailIdentity(email) || typeof creatorKey !== "string" || !creatorKey || !Number.isFinite(Date.parse(createdAt))) fail9();
      ledger.push({ owner, scope: "manual_creator_email", creatorKey, email, status, createdAt, attribution, ...batchId ? { batchId } : {}, ...id ? { id } : {} });
    };
    for (const r of tables.sanji_youtube_manual_ledger) {
      if (r.state === "cancelled") continue;
      const status = { reserved: "reserved", sending: "processing", granted: "processing", accepted: "accepted", outcome_unknown: "outcome_unknown", held: "reserved" }[r.state];
      if (!status || typeof r.channel !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(r.channel)) fail9();
      add(r, "youtube:" + r.channel, r.email, status, r.created_at, "manual_youtube", r.batch_id, r.id);
    }
    for (const r of tables.sanji_daily_campaign_queue) {
      if (r.platform !== "youtube") continue;
      if (!Number.isFinite(Date.parse(r.created))) fail9();
      if (Date.parse(r.created) < cutoff) continue;
      if (["cancelled", "rejected"].includes(r.status)) continue;
      add(r, r.creator_key, r.recipient, "outcome_unknown", r.created, "unverified_prior_work");
    }
    for (const r of tables.sanji_outbox) {
      if (r.data?.proposalType === "youtube_manual_campaign" && tables.sanji_youtube_manual_ledger.some((l) => l.outbox_id === r.id && l.batch_id === r.data.manualBatchId)) continue;
      if (r.channel !== "email") continue;
      if (!Number.isFinite(Date.parse(r.created))) fail9();
      if (Date.parse(r.created) < cutoff || !["accepted", "reserved", "processing", "sending", "outcome_unknown"].includes(r.status)) continue;
      const emails = Array.isArray(r.data?.emails) && r.data.emails.length ? r.data.emails : [r.data?.email];
      if (!emails.length || emails.some((x) => !emailIdentity(x))) fail9();
      const c = candidateById.get(r.target), channel = String(c?.data?.profile || "").match(/\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
      for (const email of emails) add(r, channel ? "youtube:" + channel : "unattributed", email, "outcome_unknown", r.created, "unverified_prior_work");
    }
    const suppression = [];
    for (const r of tables.sanji_suppression) {
      const e = emailFrom(r.identity);
      if (e) suppression.push({ owner, email: e });
    }
    const refusals = [];
    const emailsFor = (c) => [c?.data?.contact?.email, ...Array.isArray(c?.data?.youtubeResearch?.businessContacts) ? c.data.youtubeResearch.businessContacts.map((x) => x.email) : []].filter(emailIdentity);
    for (const r of tables.sanji_records) {
      if (r.kind === "thread" && Array.isArray(r.data?.messages)) {
        for (const message of r.data.messages) for (const failure of Array.isArray(message?.bounceFailures) ? message.bounceFailures : []) if (failure?.kind === "permanent" && failure?.source === "delivery_status" && /^5\./.test(String(failure?.status || ""))) {
          if (!emailIdentity(failure.email)) fail9();
          refusals.push({ owner, email: failure.email });
        }
      }
      let c = null;
      if (r.kind === "candidate" && ["\uAC70\uC808", "\uC218\uC2E0 \uAC70\uBD80", "\uC0C1\uB300\uBC29 \uAC70\uC808", "\uC6B0\uB9AC \uCE21 \uAC70\uC808"].includes(r.data?.status)) c = r;
      else if (r.kind === "thread" && (["\uAC70\uC808", "\uC218\uC2E0 \uAC70\uBD80"].includes(r.data?.classification) || ["\uC0C1\uB300\uBC29 \uAC70\uC808", "\uC6B0\uB9AC \uCE21 \uAC70\uC808"].includes(r.data?.conversationStatus))) {
        c = candidateById.get(r.data?.target);
        if (!c) fail9();
      }
      if (c) for (const email of emailsFor(c)) refusals.push({ owner, email });
    }
    const sender = await connection(owner);
    if (sender?.owner !== owner || sender.summary?.reauthRequired === true || !emailIdentity(sender.summary?.email)) fail9();
    const gmail = await gmailRefusalReview({ provider, owner, senderEmail: sender.summary.email.toLowerCase(), addresses, now });
    for (const item of gmail.rows) {
      if (item.status !== "unknown" || !item.fingerprint || !item.messageCount) continue;
      const key = emailIdentity(item.email), matches = tables.sanji_youtube_manual_gmail_reviews.filter((r) => r.email_key === key && r.sender_email === sender.summary.email.toLowerCase());
      if (matches.some((r) => !Number.isFinite(Date.parse(r.created_at)))) fail9();
      matches.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || String(b.id).localeCompare(String(a.id)));
      const review = matches[0], candidate = candidateById.get(review?.candidate_id), created = Date.parse(review?.created_at), expires = Date.parse(review?.expires_at);
      if (review && !(matches[1] && Date.parse(matches[1].created_at) === created && matches[1].fingerprint !== review.fingerprint) && review.reviewed_by === owner && candidate?.version === review.candidate_version && review.fingerprint === item.fingerprint && review.message_count === item.messageCount && Number.isFinite(created) && created <= now() && Number.isFinite(expires) && expires > now() && expires - created <= 48 * 36e5 + 1e3) {
        item.status = "no_refusal_confirmed";
        item.source = "owner_reviewed";
      }
    }
    const identities = [];
    for (const c of candidateById.values()) {
      const m = String(c.data?.profile || "").match(/^https:\/\/(?:www\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/);
      if (!m || c.data?.channels !== "YouTube") continue;
      identities.push({ owner, creatorKey: "youtube:" + m[1], emailKeys: [...new Set(emailsFor(c).map(emailIdentity).filter(Boolean))] });
    }
    const source = (rows) => ({ owner, complete: true, rows });
    return { ledger: source(ledger), suppression: source(suppression), refusals: source(refusals), identities: source(identities), gmailReview: gmail };
  };
}

// supabase/functions/youtube-manual-mail/snapshot-reader.mjs
var KEYS = Object.freeze({ sanji_youtube_manual_ledger: "id", sanji_youtube_manual_gmail_reviews: "id", sanji_daily_campaign_queue: "creator_key", sanji_outbox: "id", sanji_suppression: "identity", sanji_records: "id" });
var fail10 = () => {
  throw Object.assign(new Error("HISTORY_INCOMPLETE"), { code: "HISTORY_INCOMPLETE" });
};
function youtubeHistorySnapshotReader(sb2) {
  async function tableOnce(owner, table) {
    const key = KEYS[table];
    if (!key) fail10();
    let rows = [], cursor = null, total = null;
    for (let page = 0; page < 100; page++) {
      let q = sb2.from(table).select("*", { count: "exact" }).eq("owner", owner).order(key, { ascending: true }).limit(500);
      if (cursor) q = q.gt(key, cursor);
      let r;
      try {
        r = await q;
      } catch {
        fail10();
      }
      if (r.error || !Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count < 0 || r.data.length > 500) fail10();
      if (total === null) total = r.count;
      if (total > 1e4 || rows.length + r.count !== total) fail10();
      for (const row of r.data) {
        if (row.owner !== owner || typeof row[key] !== "string" || !row[key] || cursor && row[key] <= cursor) fail10();
        cursor = row[key];
        rows.push(row);
      }
      if (rows.length === total) return rows;
      if (!r.data.length) fail10();
    }
    fail10();
  }
  return async (owner, tables) => {
    if (typeof owner !== "string" || !owner || !Array.isArray(tables) || tables.length !== Object.keys(KEYS).length || new Set(tables).size !== tables.length || tables.some((t) => !KEYS[t])) fail10();
    const read = async () => Object.fromEntries(await Promise.all(tables.map(async (name) => [name, await tableOnce(owner, name)])));
    const first = await read(), second = await read();
    if (JSON.stringify(first) !== JSON.stringify(second)) fail10();
    return { owner, complete: true, tables: first };
  };
}

// supabase/functions/youtube-manual-mail/payload.mjs
import { createHash as createHash7 } from "node:crypto";
var fail11 = () => {
  throw Object.assign(new Error("APPROVED_CONTENT_CHANGED"), { code: "APPROVED_CONTENT_CHANGED" });
};
function youtubeManualPayloadBuilder({ repository, now = Date.now }) {
  return async function build(owner, batch, candidateId) {
    if (!batch || batch.owner !== owner || !batch.confirmedAt || !Number.isFinite(Date.parse(batch.createdAt)) || !Number.isFinite(Date.parse(batch.expiresAt)) || Date.parse(batch.expiresAt) <= now() || !Array.isArray(batch.review?.entries)) fail11();
    const saved = batch.review;
    const rebuilt = buildManualReview({ owner, sender: saved.sender, snapshotHash: saved.snapshotHash, settingsId: saved.settingsId, settingsVersion: saved.settingsVersion, mailPolicy: saved.mailPolicy, rows: saved.entries.map((e) => ({ ...e, owner })), scope: saved.scope });
    if (rebuilt.approvalHash !== batch.approvalHash || stableJSON(rebuilt.review) !== stableJSON(saved)) fail11();
    const entries = saved.entries.filter((x) => x.id === candidateId);
    if (entries.length !== 1) fail11();
    const entry = entries[0];
    const [policy, stored, settings, connection, current] = await Promise.all([repository.policy(owner), repository.snapshot(owner, batch.snapshotId), repository.currentSettings(owner), repository.currentConnection(owner), repository.currentRecipient(owner, entry.id)]);
    if (policy?.owner !== owner || policy.revision !== batch.policyRevision || policy.snapshot_id !== batch.snapshotId || stored?.sha256 !== batch.snapshotHash || saved.snapshotHash !== batch.snapshotHash || settings?.id !== saved.settingsId || settings?.version !== saved.settingsVersion || current?.owner !== owner || current.id !== entry.id || current.version !== entry.version || current.complete !== true) fail11();
    if (stableJSON(manualMailPolicy(policy, owner, batch.policyRevision)) !== stableJSON(saved.mailPolicy)) fail11();
    const snapshot = verifyPrivateSnapshot(stored, owner);
    if (stableJSON(settingsSignature(settings, connection)) !== stableJSON(snapshot.signature) || snapshot.signature.senderEmail !== saved.sender) fail11();
    if (snapshot.products.length) {
      const products = await repository.currentProducts(owner, snapshot.products.map((p) => p.id));
      if (!Array.isArray(products) || stableJSON(products.map(({ id, version, sha256 }) => ({ id, version, sha256 })).sort((a, b) => a.id.localeCompare(b.id))) !== stableJSON([...snapshot.products].sort((a, b) => a.id.localeCompare(b.id)))) fail11();
    }
    const target = manualYoutubeTarget(current, owner, entry.email, now());
    if (target.creatorKey !== "youtube:" + entry.channel || target.name !== entry.name || target.profileUrl !== entry.profileUrl || target.sourceUrl !== entry.sourceUrl || target.sourceCheckedAt !== entry.sourceCheckedAt || stableJSON(target.sources) !== stableJSON(entry.sources) || target.sourceFingerprint !== entry.sourceFingerprint || target.reviewVersion !== entry.reviewVersion || target.audience !== entry.audience || target.metricsSource !== entry.metricsSource || target.metricsCheckedAt !== entry.metricsCheckedAt || target.activitySource !== entry.activitySource || target.activityCheckedAt !== entry.activityCheckedAt || target.mukbangReason !== entry.mukbangReason) fail11();
    const copy = renderOutreachCopy({ template: snapshot.template, channelName: target.name, signature: snapshot.signature, inlineImages: snapshot.images });
    if (copy.subject !== entry.subject || copy.body !== entry.body) fail11();
    const messageId = createHash7("sha256").update(batch.id + "|" + entry.id).digest("hex");
    const mime = composeInlineOutreach2({ copy, images: snapshot.images, owner, requiredImageIds: snapshot.template.requiredInlineImageIds, from: saved.sender, to: entry.email, senderName: snapshot.signature.senderName, messageId, now: batch.createdAt });
    return { raw: mime.raw, rawHash: createHash7("sha256").update(mime.raw).digest("hex"), senderEmail: saved.sender, messageId };
  };
}

// supabase/functions/youtube-manual-mail/provider.mjs
function youtubeManualProvider({ sb: sb2, env: env2, request, now }) {
  const gmail = dailyGmailProvider({ sb: sb2, env: env2, request, now });
  return {
    async prepare({ owner, senderEmail }) {
      return gmail.manualSession({ owner, senderEmail });
    },
    async send({ owner, senderEmail, session, raw, rawHash, grant }) {
      const r = await gmail.manualSend({ owner, senderEmail, session, raw, rawHash, grant });
      if (!r || typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(r.id) || typeof r.threadId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(r.threadId)) throw Error("receipt_invalid");
      return { accepted: true, providerId: r.id, providerThread: r.threadId };
    },
    clear() {
      gmail.resetSession();
    }
  };
}

// supabase/functions/youtube-manual-mail/review-flow.mjs
function createManualReviewFlow({ prepare, repository, now = Date.now }) {
  const fail15 = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  return {
    async preview(owner, input) {
      const result = await prepare(owner, input);
      if (result?.previewOnly !== true || result.sendingEnabled !== false || result.review?.owner !== owner || !/^[a-f0-9]{64}$/.test(result.approvalHash || "")) fail15("PREVIEW_INVALID");
      const saved = await repository.createBatch({ owner, snapshotId: result.snapshotId, snapshotHash: result.review.snapshotHash, settingsVersion: result.review.settingsVersion, approvalHash: result.approvalHash, review: result.review, policyRevision: result.policyRevision });
      if (!saved || typeof saved.id !== "string" || saved.owner !== owner) fail15("PREVIEW_SAVE_UNCERTAIN");
      return { batchId: saved.id, approvalHash: result.approvalHash, previews: result.previews, sharedImages: result.sharedImages, warning: result.warning, sendingEnabled: false };
    },
    async confirm(owner, input) {
      if (!input || Object.keys(input).some((k) => !["batchId", "approvalHash"].includes(k)) || typeof input.batchId !== "string" || !/^[a-f0-9]{64}$/.test(input.approvalHash || "")) fail15("CONFIRM_INVALID");
      const saved = await repository.batch(owner, input.batchId);
      if (!saved || saved.owner !== owner || saved.approvalHash !== input.approvalHash || !Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= now() || !Array.isArray(saved.review?.entries) || !Number.isSafeInteger(saved.policyRevision)) fail15("REVIEW_EXPIRED");
      const recipients = saved.review.entries.map(({ id, version, email }) => ({ id, version, email }));
      const current = await prepare(owner, { expectedRevision: saved.policyRevision, recipients, ...saved.review.scope ? { scope: saved.review.scope } : {} });
      if (current.approvalHash !== input.approvalHash || current.snapshotId !== saved.snapshotId) fail15("REVIEW_CHANGED");
      const confirmed = await repository.confirmBatch({ owner, batchId: input.batchId, approvalHash: input.approvalHash });
      if (confirmed !== true) fail15("CONFIRM_UNCERTAIN");
      return { status: "confirmed", sendingEnabled: false };
    }
  };
}

// supabase/functions/creator-daily-outreach/youtube-manual-dispatch.mjs
import { createHash as createHash8 } from "node:crypto";
var fail12 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function youtubeManualDispatch({ repository, provider, now = Date.now }) {
  if (!repository || !provider) fail12("DEPENDENCIES_REQUIRED");
  async function prepare({ owner, selection, snapshotRevision }) {
    if (typeof owner !== "string" || !owner || !Array.isArray(selection) || !selection.length || selection.length > 100 || !Number.isSafeInteger(snapshotRevision)) fail12("INVALID_SELECTION");
    const ids = /* @__PURE__ */ new Set();
    for (const row of selection) {
      if (!row || typeof row.id !== "string" || !row.id || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.email !== "string" || !row.email.trim() || ids.has(row.id)) fail12("INVALID_SELECTION");
      ids.add(row.id);
    }
    return repository.prepare({ owner, selection: selection.map(({ id, version, email }) => ({ id, version, email: email.trim().toLowerCase() })), snapshotRevision });
  }
  async function dispatchOne({ owner, batchId, approvalHash }) {
    if (!owner || !batchId || !approvalHash) fail12("APPROVAL_REQUIRED");
    const claim = await repository.claim({ owner, batchId, approvalHash, now: new Date(now()).toISOString() });
    if (!claim) return { status: "complete_or_held" };
    if (claim.owner !== owner || claim.batchId !== batchId || !claim.id || !claim.token || !claim.payload || typeof claim.payload.raw !== "string" || !/^[a-f0-9]{64}$/.test(claim.payloadHash || "") || createHash8("sha256").update(claim.payload.raw).digest("hex") !== claim.payloadHash) fail12("INVALID_CLAIM");
    let session;
    try {
      session = await provider.prepare({ owner, senderEmail: claim.payload.senderEmail });
      if (typeof session?.session !== "string" || !session.session) throw Error("session unavailable");
    } catch {
      try {
        await repository.finish({ owner, batchId, id: claim.id, token: claim.token, status: "held" });
        return { status: "held", id: claim.id };
      } catch {
        return { status: "outcome_unknown", id: claim.id };
      }
    }
    let checked2;
    try {
      checked2 = await repository.recheck({ owner, batchId, id: claim.id, token: claim.token });
    } catch {
      checked2 = null;
    }
    const checkedMs = Date.parse(checked2?.checkedAt), elapsed = now() - checkedMs;
    if (!checked2 || checked2.allowed !== true || !Number.isFinite(checkedMs) || elapsed < 0 || elapsed > 5e3) {
      try {
        await repository.finish({ owner, batchId, id: claim.id, token: claim.token, status: "held" });
      } catch {
        return { status: "outcome_unknown", id: claim.id };
      }
      return { status: "held", id: claim.id };
    }
    let grant;
    try {
      grant = await repository.consume({ owner, batchId, id: claim.id, token: claim.token, payloadHash: claim.payloadHash });
    } catch {
      return { status: "outcome_unknown", id: claim.id };
    }
    if (grant?.ready === false) return { status: "held", id: claim.id };
    if (grant?.ready !== true || grant.payloadHash !== claim.payloadHash || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now() || Date.parse(grant.expiresAt) > now() + 5e3) return { status: "outcome_unknown", id: claim.id };
    let result;
    try {
      result = await provider.send({ ...claim.payload, owner, session: session.session, rawHash: claim.payloadHash, grant });
    } catch {
      try {
        await repository.finish({ owner, batchId, id: claim.id, token: claim.token, status: "outcome_unknown" });
      } catch {
      }
      return { status: "outcome_unknown", id: claim.id };
    }
    const status = result?.accepted === true && /^[A-Za-z0-9_-]{1,200}$/.test(result.providerId || "") && /^[A-Za-z0-9_-]{1,200}$/.test(result.providerThread || "") ? "accepted" : "outcome_unknown";
    try {
      await repository.finish({ owner, batchId, id: claim.id, token: claim.token, status, providerId: status === "accepted" ? result.providerId : void 0, providerThread: status === "accepted" ? result.providerThread : void 0 });
    } catch {
      return { status: "outcome_unknown", id: claim.id };
    }
    return { status, id: claim.id };
  }
  return { prepare, dispatchOne };
}

// supabase/functions/youtube-manual-mail/send-flow.mjs
var fail13 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function youtubeManualSendFlow({ repository, payloadBuilder, providerFactory, env: env2 = () => "" }) {
  const gate = () => {
    if (env2("YOUTUBE_MANUAL_SEND_ENABLED") !== "true" || env2("EMAIL_SENDING_ENABLED") !== "true") fail13("SENDING_DISABLED");
  };
  async function currentBatch(owner, input) {
    if (!input || Object.keys(input).some((k) => !["batchId", "approvalHash"].includes(k)) || typeof input.batchId !== "string" || !/^[a-f0-9]{64}$/.test(input.approvalHash || "")) fail13("INVALID_SEND_REQUEST");
    const b = await repository.batch(owner, input.batchId);
    if (!b || b.owner !== owner || !b.confirmedAt || b.approvalHash !== input.approvalHash || !Array.isArray(b.review?.entries) || !b.review.entries.length || b.review.entries.length > 100) fail13("CONFIRM_REQUIRED");
    return b;
  }
  async function checkedHistory(owner, batch, entry, provided) {
    const history = provided || await repository.manualHistory(owner, [entry.email]);
    if (!gmailRefusalReviewed(history, entry.email)) fail13("GMAIL_REVIEW_INCOMPLETE");
    const emailKey = entry.emailKey;
    if (typeof emailKey !== "string" || !Array.isArray(history.duplicateCreatorKeys) || !Array.isArray(history.sharedEmailKeys)) fail13("BATCH_CHANGED");
    if (history.duplicateCreatorKeys.includes("youtube:" + entry.channel) || history.sharedEmailKeys.includes(emailKey)) fail13("IDENTITY_AMBIGUOUS");
    const check = classifyManualRecipient({ owner, creatorKey: "youtube:" + entry.channel, email: entry.email, records: history.records.filter((r) => r.batchId !== batch.id), suppressed: history.suppressedKeys.includes(emailKey), explicitRefusal: history.refusedKeys.includes(emailKey), complete: history.complete === true && history.refusalsComplete === true });
    if (!check.eligible) fail13("RECIPIENT_BLOCKED");
    return history;
  }
  async function reserve(owner, input) {
    gate();
    const batch = await currentBatch(owner, input), items = [], history = await repository.manualHistory(owner, batch.review.entries.map((e) => e.email));
    for (const entry of batch.review.entries) {
      await checkedHistory(owner, batch, entry, history);
      const payload = await payloadBuilder(owner, batch, entry.id);
      items.push({ id: entry.id, version: entry.version, email: entry.email, payloadHash: payload.rawHash, messageId: payload.messageId });
    }
    return { rows: await repository.reserveBatch({ owner, batchId: batch.id, approvalHash: batch.approvalHash, items }) };
  }
  async function schedule(owner, input) {
    if (!input || Object.keys(input).some((k) => !["batchId", "approvalHash", "expectedRunAt"].includes(k)) || typeof input.expectedRunAt !== "string" || !Number.isFinite(Date.parse(input.expectedRunAt))) fail13("INVALID_SEND_REQUEST");
    gate();
    if (env2("YOUTUBE_MANUAL_SCHEDULER_ENABLED") !== "true" || env2("YOUTUBE_MANUAL_SCHEDULER_TRIGGER_VERIFIED") !== "true") fail13("SCHEDULER_UNAVAILABLE");
    const batch = await currentBatch(owner, { batchId: input.batchId, approvalHash: input.approvalHash });
    validateProjectScope(batch.review.scope);
    const items = [], history = await repository.manualHistory(owner, batch.review.entries.map((e) => e.email));
    for (const entry of batch.review.entries) {
      await checkedHistory(owner, batch, entry, history);
      const payload = await payloadBuilder(owner, batch, entry.id);
      items.push({ id: entry.id, version: entry.version, email: entry.email, payloadHash: payload.rawHash, messageId: payload.messageId });
    }
    if (typeof repository.scheduleBatch !== "function") fail13("SCHEDULER_UNAVAILABLE");
    const result = await repository.scheduleBatch({ owner, batchId: batch.id, approvalHash: batch.approvalHash, items, expectedRunAt: input.expectedRunAt });
    if (!result || result.state !== "scheduled" || Date.parse(result.runAt) !== Date.parse(input.expectedRunAt) || !Array.isArray(result.rows) || result.rows.length !== items.length) fail13("SCHEDULE_UNCERTAIN");
    return result;
  }
  async function next(owner, input, schedulerToken) {
    gate();
    const batch = await currentBatch(owner, input), rows = await repository.batchRows(owner, batch.id);
    if (rows.length !== batch.review.entries.length) fail13("BATCH_INCOMPLETE");
    const row = rows.find((r) => r.state === "reserved");
    if (!row) return { status: "complete_or_held", counts: rows.reduce((x, r) => (x[r.state] = (x[r.state] || 0) + 1, x), {}) };
    const entry = batch.review.entries.find((e) => e.id === row.candidate_id);
    if (!entry || entry.version !== row.candidate_version || entry.email !== row.email) fail13("BATCH_CHANGED");
    const payload = await payloadBuilder(owner, batch, entry.id);
    if (payload.rawHash !== row.payload_hash) fail13("CONTENT_CHANGED");
    const isolated = providerFactory();
    let claimed = false;
    const bound = {
      async claim() {
        if (claimed) return null;
        claimed = true;
        const args = { owner, id: row.id, approvalHash: batch.approvalHash, payloadHash: payload.rawHash };
        const token = schedulerToken ? await repository.claimScheduledRow({ ...args, schedulerToken }) : await repository.claimRow(args);
        if (!token) return null;
        return { owner, batchId: batch.id, id: row.id, token, payload, payloadHash: payload.rawHash };
      },
      async recheck(args) {
        try {
          await checkedHistory(owner, batch, entry);
        } catch {
          return { allowed: false, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
        return repository.recheck(args);
      },
      consume: (args) => repository.consume(args),
      finish: (args) => repository.finish(args)
    };
    try {
      return await youtubeManualDispatch({ repository: bound, provider: isolated }).dispatchOne({ owner, batchId: batch.id, approvalHash: batch.approvalHash });
    } finally {
      isolated.clear?.();
    }
  }
  async function cancel(owner, input) {
    if (!input || Object.keys(input).some((k) => k !== "batchId") || typeof input.batchId !== "string") fail13("INVALID_REQUEST");
    const count = await repository.cancelPending({ owner, batchId: input.batchId });
    if (!Number.isSafeInteger(count) || count < 0) fail13("CANCEL_UNCERTAIN");
    return { cancelled: count };
  }
  async function status(owner, input) {
    const batch = await currentBatch(owner, input), rows = await repository.batchRows(owner, batch.id);
    if (rows.some((r) => !batch.review.entries.some((e) => e.id === r.candidate_id))) fail13("BATCH_CHANGED");
    return { rows: rows.map((r) => {
      const entry = batch.review.entries.find((e) => e.id === r.candidate_id);
      const status2 = ["sending", "granted"].includes(r.state) ? "outcome_unknown" : r.state;
      const sender = batch.review.sender;
      const searchUrl = status2 === "outcome_unknown" && /^[A-Za-z0-9_-]{1,100}$/.test(r.message_id || "") && typeof sender === "string" ? "https://mail.google.com/mail/?authuser=" + encodeURIComponent(sender) + "#search/" + encodeURIComponent("rfc822msgid:<" + r.message_id + "@sanji.local>") : null;
      return { candidateId: r.candidate_id, channel: entry.channel, email: entry.email, status: status2, ...searchUrl ? { searchUrl } : {} };
    }) };
  }
  async function recent(owner, input) {
    if (!input || Object.keys(input).some((k) => k !== "offset") || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1e4) fail13("INVALID_REQUEST");
    const batches = await repository.recentBatches(owner, input.offset), rows = [];
    for (const b of batches.rows) {
      const result = await status(owner, { batchId: b.id, approvalHash: b.approvalHash });
      let schedule2 = null;
      try {
        if (typeof repository.scheduleStatus === "function") schedule2 = await repository.scheduleStatus(owner, b.id);
      } catch {
      }
      rows.push({ batchId: b.id, createdAt: b.createdAt, rows: result.rows, schedule: schedule2 });
    }
    return { rows, more: batches.more, offset: batches.offset };
  }
  return { reserve, schedule, next, status, recent, cancel };
}

// supabase/functions/youtube-manual-mail/gmail-review-flow.mjs
var fail14 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function youtubeGmailReviewFlow({ repository, provider, now = Date.now }) {
  async function inspect(owner, input) {
    if (!owner || !input || Object.keys(input).some((k) => !["id", "version", "email"].includes(k)) || typeof input.id !== "string" || !Number.isSafeInteger(input.version) || input.version < 1 || typeof input.email !== "string" || input.email !== input.email.trim().toLowerCase() || !emailIdentity(input.email)) fail14("INVALID_REVIEW");
    const [resolved, connection] = await Promise.all([repository.currentRecipient(owner, input.id), repository.currentConnection(owner)]);
    if (resolved?.owner !== owner || resolved.id !== input.id || resolved.version !== input.version || resolved.complete !== true || connection?.owner !== owner || connection.summary?.reauthRequired === true || !emailIdentity(connection.summary?.email)) fail14("REVIEW_SOURCE_CHANGED");
    const target = manualYoutubeTarget(resolved, owner, input.email, now());
    const sender = connection.summary.email.trim().toLowerCase(), proof = await provider.historyFingerprint({ owner, address: input.email, senderEmail: sender });
    const t = Date.parse(proof?.checkedAt);
    if (!proof || proof.emailKey !== emailIdentity(input.email) || proof.senderEmail !== sender || !/^[a-f0-9]{64}$/.test(proof.fingerprint || "") || !Array.isArray(proof.messageIds) || proof.messageIds.length > 100 || proof.messageIds.some((id) => !/^[A-Za-z0-9_-]{1,200}$/.test(id)) || !Number.isFinite(t) || t > now() || now() - t > 15e3) fail14("GMAIL_HISTORY_UNAVAILABLE");
    return { sender, proof, name: target.name };
  }
  return {
    async prepare(owner, input) {
      const { sender, proof, name } = await inspect(owner, input);
      return { name, email: input.email, fingerprint: proof.fingerprint, count: proof.messageIds.length, links: proof.messageIds.map((id) => "https://mail.google.com/mail/?authuser=" + encodeURIComponent(sender) + "#all/" + encodeURIComponent(id)), note: "\uC6D0\uBCF8\uC744 \uC5F4\uC5B4 \uBAA8\uB450 \uD655\uC778\uD558\uC138\uC694. \uC774 \uAE30\uB85D\uC740 \uC0AC\uC6A9\uC790\uAC00 \uD655\uC778\uD55C \uC0AC\uC2E4\uC774\uBA70 Gmail\uC774 \uAC70\uC808 \uBD80\uC7AC\uB97C \uBCF4\uC99D\uD558\uB294 \uAC83\uC740 \uC544\uB2D9\uB2C8\uB2E4." };
    },
    async confirm(owner, input) {
      if (!input || Object.keys(input).some((k) => !["id", "version", "email", "fingerprint", "acknowledged"].includes(k)) || input.acknowledged !== true || !/^[a-f0-9]{64}$/.test(input.fingerprint || "")) fail14("INVALID_REVIEW");
      const selected = { id: input.id, version: input.version, email: input.email }, current = await inspect(owner, selected);
      if (current.proof.fingerprint !== input.fingerprint || !current.proof.messageIds.length) fail14("GMAIL_HISTORY_CHANGED");
      const id = await repository.recordGmailReview({ owner, candidateId: input.id, version: input.version, email: input.email, sender: current.sender, fingerprint: input.fingerprint, count: current.proof.messageIds.length });
      if (typeof id !== "string" || !id) fail14("REVIEW_SAVE_UNCERTAIN");
      return { status: "recorded", scope: "owner_attested", count: current.proof.messageIds.length };
    }
  };
}

// supabase/functions/youtube-manual-mail/scheduled-worker.mjs
function scheduledYoutubeWorker({ repository, dispatch, now = Date.now }) {
  if (typeof repository?.claimDue !== "function" || typeof repository?.finishClaim !== "function" || typeof repository?.continueClaim !== "function" || typeof dispatch !== "function") throw Error("SCHEDULER_DEPENDENCIES_REQUIRED");
  return { async runOne() {
    const claim = await repository.claimDue(new Date(now()).toISOString());
    if (claim === null) return { status: "idle" };
    const due = Date.parse(claim?.runAt), current = now();
    if (!claim || typeof claim.owner !== "string" || !claim.owner || typeof claim.batchId !== "string" || !claim.batchId || typeof claim.token !== "string" || !claim.token || !/^[a-f0-9]{64}$/.test(claim.approvalHash || "") || !Number.isFinite(due) || due > current) {
      if (claim?.token) await repository.finishClaim({ token: claim.token, result: "held" });
      return { status: "held" };
    }
    try {
      const started = now();
      for (let i = 0; i < 5; i++) {
        if (i > 0 && now() - started >= 15e3) break;
        const result = await dispatch({ owner: claim.owner, batchId: claim.batchId, approvalHash: claim.approvalHash, token: claim.token });
        if (result?.status === "accepted") continue;
        const status2 = result?.status === "complete_or_held" ? Object.entries(result.counts || {}).every(([key, count]) => ["accepted", "cancelled"].includes(key) || count === 0) ? "complete" : "held" : result?.status === "held" ? "held" : "outcome_unknown";
        await repository.finishClaim({ token: claim.token, result: status2 });
        return { status: status2 };
      }
      const status = await repository.continueClaim({ token: claim.token });
      if (!["scheduled", "complete"].includes(status)) throw Error("CONTINUE_UNCERTAIN");
      return { status };
    } catch {
      await repository.finishClaim({ token: claim.token, result: "outcome_unknown" });
      return { status: "outcome_unknown" };
    }
  } };
}

// supabase/functions/youtube-manual-mail/runtime.mjs
function youtubeManualRuntime({ sb: sb2, env: env2 = (_name) => "", request = fetch, now = Date.now }) {
  const historyProvider = dailyGmailProvider({ sb: sb2, env: env2, request, now });
  let repository;
  const historySource = youtubeManualHistorySource({ readSnapshot: youtubeHistorySnapshotReader(sb2), provider: historyProvider, connection: (owner) => repository.currentConnection(owner), now });
  repository = youtubeManualRepository({ sb: sb2, historySource });
  const prepare = createYoutubeManualPrepare({ repository, now }), review = createManualReviewFlow({ prepare, repository, now });
  const gmailReview = youtubeGmailReviewFlow({ repository, provider: historyProvider, now });
  const sender = youtubeManualSendFlow({ repository, payloadBuilder: youtubeManualPayloadBuilder({ repository, now }), providerFactory: () => youtubeManualProvider({ sb: sb2, env: env2, request, now }), env: env2 });
  const worker = scheduledYoutubeWorker({ repository, now, dispatch: ({ owner, batchId, approvalHash, token }) => sender.next(owner, { batchId, approvalHash }, token) });
  const runScheduledOne = () => env2("YOUTUBE_MANUAL_SCHEDULER_ENABLED") === "true" ? worker.runOne() : Promise.resolve({ status: "disabled" });
  return { gmailReviewPrepare: gmailReview.prepare, gmailReviewConfirm: gmailReview.confirm, preview: review.preview, confirm: review.confirm, reserve: sender.reserve, schedule: sender.schedule, next: sender.next, status: sender.status, recent: sender.recent, cancel: sender.cancel, runScheduledOne };
}

// supabase/functions/youtube-manual-scheduler/github-oidc.mjs
var ISSUER = "https://token.actions.githubusercontent.com";
var JWKS = ISSUER + "/.well-known/jwks";
var AUDIENCE = "sanji-youtube-scheduler-v1";
var WORKFLOW = "DOTHEGY/sanji/.github/workflows/youtube-manual-scheduler.yml@refs/heads/main";
var decode2 = (value) => {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error("invalid");
  const encoded2 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(encoded2 + "=".repeat((4 - encoded2.length % 4) % 4)), (c) => c.charCodeAt(0));
};
var parse = (value) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode2(value)));
var cachedKeys = null;
var cachedUntil = 0;
var pendingKeys = null;
async function readKeys(fetchKeys, now) {
  const cacheable = fetchKeys === fetch, time = now();
  if (cacheable && cachedKeys && time < cachedUntil) return cachedKeys;
  if (cacheable && pendingKeys) return pendingKeys;
  const load = async () => {
    const response = await fetchKeys(JWKS, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8e3) });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 65536) throw Error("unavailable");
    const text = await response.text();
    if (text.length > 65536) throw Error("invalid");
    const keys2 = JSON.parse(text)?.keys;
    if (!Array.isArray(keys2) || keys2.length > 100) throw Error("invalid");
    if (cacheable) {
      cachedKeys = keys2;
      cachedUntil = now() + 3e5;
    }
    return keys2;
  };
  if (!cacheable) return load();
  pendingKeys = load();
  try {
    return await pendingKeys;
  } finally {
    pendingKeys = null;
  }
}
async function authorizedGithubScheduler(request, { fetchKeys = fetch, now = Date.now, event = "schedule" } = {}) {
  try {
    if (!["schedule", "workflow_dispatch"].includes(event)) return false;
    const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
    if (!token || token.length > 8192) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = parse(parts[0]), payload = parse(parts[1]);
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid) || header.crit !== void 0 || header.jku !== void 0 || header.x5u !== void 0) return false;
    const time = Math.floor(now() / 1e3);
    if (!Number.isSafeInteger(time) || !payload || payload.iss !== ISSUER || payload.aud !== AUDIENCE || payload.repository_id !== "1427742371" || payload.repository_owner_id !== "92072050" || payload.repository !== "DOTHEGY/sanji" || payload.workflow_ref !== WORKFLOW || payload.ref !== "refs/heads/main" || payload.event_name !== event || payload.runner_environment !== "github-hosted" || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.nbf) || payload.iat > time + 30 || payload.nbf > time + 30 || payload.exp <= time || payload.exp - payload.iat > 600 || payload.exp <= payload.iat || !/^[0-9]{1,32}$/.test(payload.run_id || "")) return false;
    const keys2 = await readKeys(fetchKeys, now);
    const matches = keys2.filter((k) => k?.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256") && (!k.use || k.use === "sig") && typeof k.n === "string" && typeof k.e === "string");
    if (matches.length !== 1) return false;
    const key = await crypto.subtle.importKey("jwk", matches[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode2(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    const verifiedAt = Math.floor(now() / 1e3);
    return valid && Number.isSafeInteger(verifiedAt) && payload.exp > verifiedAt && payload.nbf <= verifiedAt + 30 && payload.iat <= verifiedAt + 30;
  } catch {
    return false;
  }
}

// supabase/functions/youtube-manual-mail/scheduler-handler.mjs
function schedulerHandler({ authenticate, runOne }) {
  if (typeof authenticate !== "function" || typeof runOne !== "function") throw Error("SCHEDULER_AUTH_REQUIRED");
  return async (request) => {
    const response = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method !== "POST") return response({ code: "NOT_FOUND" }, 404);
    try {
      if (await authenticate(request) !== true) return response({ code: "UNAUTHORIZED" }, 401);
      const result = await runOne();
      return response({ status: result?.status || "unknown" }, 200);
    } catch {
      return response({ code: "WORKER_UNAVAILABLE" }, 503);
    }
  };
}

// supabase/functions/youtube-manual-scheduler/endpoint.mjs
function schedulerEndpoint({ authorize, runOne }) {
  const worker = schedulerHandler({ authenticate: (request) => authorize(request, "schedule"), runOne });
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/auth-health")) {
      if (request.method !== "POST") return new Response(null, { status: 404 });
      try {
        if (await authorize(request, "workflow_dispatch") !== true) return new Response(null, { status: 401 });
        return Response.json({ status: "authenticated" }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return new Response(null, { status: 401 });
      }
    }
    if (!/\/youtube-manual-scheduler\/?$/.test(path)) return new Response(null, { status: 404 });
    return worker(request);
  };
}

// supabase/functions/youtube-manual-scheduler/index.ts
var env = (name) => Deno.env.get(name) || "";
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
var runtime = youtubeManualRuntime({ sb, env });
Deno.serve(schedulerEndpoint({ authorize: (request, event) => authorizedGithubScheduler(request, { event }), runOne: () => runtime.runScheduledOne() }));
