// supabase/functions/creator-daily-outreach/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// supabase/functions/creator-daily-outreach/domain.mjs
var DAILY_OUTREACH = Object.freeze({ campaign: "mara-jjamppong-bread", label: "\uB9C8\uB77C\uCAC0\uB4DD\uBE75\xB7\uC9EC\uBF55\uCAC0\uB4DD\uBE75", youtubeTarget: 50, instagramTarget: 10, audienceBounds: Object.freeze({ youtube: Object.freeze({ minimum: 3e4, maximum: 2e5 }), instagram: Object.freeze({ minimum: 3e4, maximum: 5e5 }) }), targetUnit: "distinct_verified_business_email", maxEmailsPerCreator: 1, dedupeScope: "cross_platform", activityDays: 90, evidenceDays: 30, timezone: "Asia/Seoul", sendingEnabled: false, schedulerEnabled: false });
var audienceBounds = (platform) => DAILY_OUTREACH.audienceBounds[platform] || null;
var RECIPIENT_CRITERIA = Object.freeze({ version: 1, audienceBounds: DAILY_OUTREACH.audienceBounds, targets: Object.freeze({ youtube: DAILY_OUTREACH.youtubeTarget, instagram: DAILY_OUTREACH.instagramTarget }), targetUnit: DAILY_OUTREACH.targetUnit, maxEmailsPerCreator: DAILY_OUTREACH.maxEmailsPerCreator, dedupeScope: DAILY_OUTREACH.dedupeScope });
function hasCurrentRecipientGoal(value) {
  return Boolean(value && value.targetUnit === DAILY_OUTREACH.targetUnit && value.maxEmailsPerCreator === 1 && value.dedupeScope === DAILY_OUTREACH.dedupeScope && ["youtube", "instagram"].every((platform) => value.audienceBounds?.[platform]?.minimum === audienceBounds(platform).minimum && value.audienceBounds?.[platform]?.maximum === audienceBounds(platform).maximum));
}
var DAY = 864e5;
var clean = (v) => typeof v === "string" ? v.trim() : "";
var OutreachError = class extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
};
function outreachDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_OUTREACH.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
function fresh(value, now, days = 30) {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now && at >= now - days * DAY;
}
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
function profileMatches(row, value) {
  const url = sourceUrl(value);
  if (!url) return false;
  const u = new URL(url);
  if (u.search) return false;
  return row.platform === "youtube" ? ["youtube.com", "www.youtube.com"].includes(u.hostname) && u.pathname.replace(/\/$/, "") === "/channel/" + row.externalId : row.platform === "instagram" && ["instagram.com", "www.instagram.com"].includes(u.hostname) && u.pathname.replace(/\/$/, "").toLowerCase() === "/" + clean(row.externalId).toLowerCase();
}
function creatorIdentity(row) {
  if (row?.platform === "youtube" && /^UC[A-Za-z0-9_-]{22}$/.test(row.externalId)) return "youtube:" + row.externalId;
  if (row?.platform === "instagram" && /^[a-z0-9._]{1,30}$/.test(clean(row.externalId).toLowerCase())) return "instagram:" + clean(row.externalId).toLowerCase();
  return null;
}
function contactEvidence(row, now) {
  const evidence = Array.isArray(row.contactEvidence) ? row.contactEvidence : [];
  const items = evidence.filter((e2) => e2 && e2.creatorKey === creatorIdentity(row));
  if (!items.length) return { reason: "public_email_evidence_required" };
  if (items.some((e2) => !Number.isFinite(Date.parse(e2.checkedAt)) || Date.parse(e2.checkedAt) > now)) return { reason: "contact_observation_time_invalid" };
  items.sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  if (!fresh(items[0].checkedAt, now) || !sourceUrl(items[0].sourceUrl)) return { reason: "public_email_evidence_required" };
  if (items.some((e2) => Date.parse(e2.checkedAt) === Date.parse(items[0].checkedAt) && JSON.stringify(e2) !== JSON.stringify(items[0]))) return { reason: "ambiguous_contact_observation" };
  const e = items[0], email = clean(e.address).toLowerCase(), key3 = emailIdentity(email), url = sourceUrl(e.sourceUrl);
  if (e.verified !== true || e.purpose !== "business_collaboration" || e.accessMethod !== "public_source_review" || !["official_website", "instagram_public_bio", "provided_by_creator"].includes(e.sourceKind)) return { reason: "contact_source_review_required" };
  if (row.platform === "youtube" && (e.sourceKind === "instagram_public_bio" || /(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname))) return { reason: "youtube_contact_harvesting_not_supported" };
  if (e.sourceKind === "instagram_public_bio" && !profileMatches(row, url)) return { reason: "contact_creator_affiliation_required" };
  const affiliation = e.affiliation;
  if (e.sourceKind !== "instagram_public_bio" && (!affiliation || affiliation.verified !== true || affiliation.creatorKey !== creatorIdentity(row) || !sourceUrl(affiliation.sourceUrl) || !clean(affiliation.sourceText) || !fresh(affiliation.checkedAt, now))) return { reason: "contact_creator_affiliation_required" };
  if (!key3 || typeof e.sourceText !== "string" || e.sourceText.length > 4e3 || !e.sourceText.toLowerCase().includes(email) || e.ambiguous === true) return { reason: "published_email_not_verified" };
  const found = [...new Set((e.sourceText.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((x) => x.toLowerCase()))];
  if (found.length !== 1 || found[0] !== email) return { reason: "ambiguous_public_email" };
  const purposeText = e.sourceText.toLowerCase().replaceAll(email, "");
  if (!/협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor/i.test(purposeText) || /개인정보|채용|입사|고객\s*(?:센터|지원)|팬\s*(?:레터|메일)|privacy|recruit|career|support|customer|fan\s*mail|not\s+(?:for\s+)?(?:business|commercial|advertis|collab)|no\s+(?:business|commercial|advertis|collab)|(?:협업|광고|사업|제휴).{0,30}(?:거절|금지|받지|불가|아닙|아님|제외)/i.test(purposeText)) return { reason: "collaboration_purpose_unverified" };
  if (/(?:privacy|abuse|noreply|no-reply|support|careers|recruit|legal)@/.test(email)) return { reason: "non_collaboration_address" };
  return { address: email, key: key3, sourceUrl: url, sourceText: e.sourceText, sourceKind: e.sourceKind, checkedAt: e.checkedAt, purpose: e.purpose, verified: true, accessMethod: e.accessMethod, affiliation: e.sourceKind === "instagram_public_bio" ? null : affiliation };
}
function qualifyOutreachCandidate(row, now = Date.now()) {
  const creatorKey = creatorIdentity(row), reasons = [];
  if (!creatorKey) return { eligible: false, reasons: ["creator_identity_required"] };
  const audience = row.audience, bounds = audienceBounds(row.platform);
  if (!Number.isSafeInteger(audience) || !bounds || audience < bounds.minimum || audience > bounds.maximum) reasons.push("audience_out_of_range_or_unknown");
  if (!sourceUrl(row.audienceSource) || !fresh(row.audienceCheckedAt, now)) reasons.push("fresh_audience_evidence_required");
  if (!sourceUrl(row.activitySource) || !fresh(row.activityCheckedAt, now) || !fresh(row.lastActiveAt, now, DAILY_OUTREACH.activityDays)) reasons.push("recent_activity_unverified");
  if (row.mukbang?.verified !== true || !sourceUrl(row.mukbang?.sourceUrl) || !fresh(row.mukbang?.checkedAt, now) || (!clean(row.mukbang?.sourceText) || clean(row.mukbang?.sourceText).length > 2e3)) reasons.push("mukbang_evidence_required");
  if (row.displayNameReviewRequired === true) reasons.push("manual_display_name_review_required");
  if (row.platform === "instagram" && row.existingDatabaseRecord !== true) reasons.push("existing_instagram_record_required");
  if (row.excluded === true || row.priorContact === true || row.suppressed === true) reasons.push("existing_contact_or_suppression");
  const contact = contactEvidence(row, now);
  let supplyReview = null;
  if (row.supplyReview !== void 0) {
    const r = row.supplyReview;
    if (row.platform !== "instagram" || r.source !== "existing_instagram_database" || r.sourceRecordUpdated !== row.sourceRecordUpdated || !fresh(r.reviewedAt, now, 29) || !Number.isFinite(Date.parse(r.expiresAt)) || Date.parse(r.expiresAt) <= now || Date.parse(r.expiresAt) > Date.parse(r.reviewedAt) + 29 * DAY) reasons.push("instagram_source_review_invalid_or_expired");
    else supplyReview = { source: r.source, sourceRecordUpdated: r.sourceRecordUpdated, reviewedAt: r.reviewedAt, expiresAt: r.expiresAt };
  }
  const api = row.apiSnapshot;
  let apiSnapshot = null, displayNameEvidence = null;
  if (api !== void 0) {
    const fields2 = ["creatorKey", "externalId", "profileUrl", "name", "audience", "audienceSource", "audienceCheckedAt", "lastActiveAt", "activitySource", "activityCheckedAt"];
    if (row.platform !== "youtube" || api.channelId !== row.externalId || !fresh(api.observedAt, now, 29) || !Number.isFinite(Date.parse(api.expiresAt)) || Date.parse(api.expiresAt) <= now || Date.parse(api.expiresAt) > Date.parse(api.observedAt) + 29 * DAY || !Array.isArray(api.fieldNames) || api.fieldNames.some((k) => !fields2.includes(k)) || typeof api.titleFromApi !== "boolean") reasons.push("api_snapshot_invalid_or_expired");
    else apiSnapshot = { channelId: api.channelId, observedAt: api.observedAt, expiresAt: api.expiresAt, fieldNames: [...api.fieldNames], titleFromApi: api.titleFromApi };
  }
  const e = row.displayNameEvidence, url = sourceUrl(e?.sourceUrl);
  if (e && e.verified === true && e.name === clean(row.name) && ["official_website", "provided_by_creator"].includes(e.kind) && url && !/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname) && clean(e.sourceText).includes(e.name) && fresh(e.checkedAt, now, 29)) {
    displayNameEvidence = { name: e.name, sourceUrl: url, sourceText: e.sourceText, checkedAt: e.checkedAt, verified: true, kind: e.kind, ...e.creatorKey ? { creatorKey: e.creatorKey } : {}, ...e.profileUrl ? { profileUrl: e.profileUrl } : {} };
  }
  if (apiSnapshot?.fieldNames.some((k) => ["creatorKey", "externalId", "profileUrl"].includes(k)) && (!displayNameEvidence || displayNameEvidence.creatorKey !== creatorKey || displayNameEvidence.profileUrl !== row.profileUrl || !displayNameEvidence.sourceText.includes(row.externalId))) reasons.push("independent_creator_identity_required");
  if (apiSnapshot?.titleFromApi === true && !displayNameEvidence) reasons.push("manual_display_name_required");
  const candidate = { creatorKey, platform: row.platform, externalId: row.externalId, name: clean(row.name).slice(0, 200), profileUrl: sourceUrl(row.profileUrl), sourceRecordId: row.sourceRecordId || null, audience, audienceSource: sourceUrl(row.audienceSource), audienceCheckedAt: row.audienceCheckedAt, lastActiveAt: row.lastActiveAt, activitySource: sourceUrl(row.activitySource), activityCheckedAt: row.activityCheckedAt, mukbang: { sourceUrl: sourceUrl(row.mukbang?.sourceUrl), sourceText: clean(row.mukbang?.sourceText), checkedAt: row.mukbang?.checkedAt }, contact: contact.address ? contact : null, ...apiSnapshot ? { apiSnapshot } : {}, ...displayNameEvidence ? { displayNameEvidence } : {}, ...supplyReview ? { supplyReview } : {} };
  if (!candidate.name || !profileMatches(row, candidate.profileUrl)) reasons.push("creator_profile_required");
  return { eligible: reasons.length === 0, reasons, contactReason: contact.reason || null, candidate };
}
function buildDailyOutreachBatch({ candidates, history, now = Date.now() }) {
  if (!Array.isArray(candidates) || candidates.length > 5e3) throw new OutreachError("SOURCE_INVALID", "\uD6C4\uBCF4 \uC6D0\uBCF8\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
  if (!history || history.complete !== true || !Array.isArray(history.creatorKeys) || !Array.isArray(history.emailKeys)) throw new OutreachError("HISTORY_INCOMPLETE", "\uC804\uCCB4 \uBC1C\uC1A1\xB7\uC911\uBCF5 \uC774\uB825\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD574 \uC900\uBE44\uB97C \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4.", 503);
  const creatorKeys = new Set(history.creatorKeys), emailKeys = new Set(history.emailKeys.map(emailIdentity).filter(Boolean));
  const selected = [], held = [], counts = { youtube: 0, instagram: 0 }, seen = /* @__PURE__ */ new Set();
  const sourceCounts = /* @__PURE__ */ new Map();
  for (const row of candidates) {
    const key3 = creatorIdentity(row);
    if (key3) sourceCounts.set(key3, (sourceCounts.get(key3) || 0) + 1);
  }
  const candidatesQualified = candidates.map((row) => qualifyOutreachCandidate(row, now));
  candidatesQualified.sort((a, b) => Number(Boolean(b.candidate?.contact)) - Number(Boolean(a.candidate?.contact)) || String(a.candidate?.creatorKey).localeCompare(String(b.candidate?.creatorKey)));
  for (const q of candidatesQualified) {
    const c = q.candidate;
    if (!c) {
      held.push({ creatorKey: null, reasons: q.reasons });
      continue;
    }
    if (seen.has(c.creatorKey)) continue;
    seen.add(c.creatorKey);
    const reasons = [...q.reasons];
    if (sourceCounts.get(c.creatorKey) > 1) reasons.push("duplicate_source_records_require_review");
    if (creatorKeys.has(c.creatorKey)) reasons.push("duplicate_creator");
    if (c.contact && emailKeys.has(c.contact.key)) reasons.push("duplicate_email");
    if (q.contactReason) reasons.push(q.contactReason);
    if (reasons.length) {
      held.push({ creatorKey: c.creatorKey, platform: c.platform, reasons });
      continue;
    }
    const target = c.platform === "youtube" ? DAILY_OUTREACH.youtubeTarget : DAILY_OUTREACH.instagramTarget;
    if (counts[c.platform] >= target) continue;
    selected.push({ ...c, status: "awaiting_dispatch_review", expiresAt: new Date(Math.min(...[c.contact.checkedAt, c.audienceCheckedAt, c.activityCheckedAt, c.mukbang.checkedAt, ...c.contact.affiliation ? [c.contact.affiliation.checkedAt] : []].map((at) => Date.parse(at) + 30 * DAY), Date.parse(c.lastActiveAt) + 90 * DAY, c.apiSnapshot ? Date.parse(c.apiSnapshot.expiresAt) : Infinity, c.displayNameEvidence ? Date.parse(c.displayNameEvidence.checkedAt) + 29 * DAY : Infinity, c.supplyReview ? Date.parse(c.supplyReview.expiresAt) : Infinity)).toISOString() });
    counts[c.platform]++;
    creatorKeys.add(c.creatorKey);
    emailKeys.add(c.contact.key);
  }
  const holdReasons = {};
  for (const h of held) for (const reason of new Set(h.reasons)) holdReasons[reason] = (holdReasons[reason] || 0) + 1;
  return { holdReasons, campaign: DAILY_OUTREACH.campaign, day: outreachDay(now), timezone: DAILY_OUTREACH.timezone, preparedAt: new Date(now).toISOString(), targetUnit: DAILY_OUTREACH.targetUnit, maxEmailsPerCreator: DAILY_OUTREACH.maxEmailsPerCreator, dedupeScope: DAILY_OUTREACH.dedupeScope, audienceBounds: DAILY_OUTREACH.audienceBounds, targets: { youtube: 50, instagram: 10 }, selected, held: held.slice(0, 5e3), counts, shortfall: { youtube: 50 - counts.youtube, instagram: 10 - counts.instagram }, sendingEnabled: false, schedulerEnabled: false, copyStatus: "private_template_required", note: "\uD50C\uB7AB\uD3FC \uAC04 \uC911\uBCF5\uC744 \uC81C\uC678\uD55C \uAC80\uC99D\uB41C \uACF5\uAC1C \uC5C5\uBB34 \uC774\uBA54\uC77C \uC8FC\uC18C \uC218\uC785\uB2C8\uB2E4. \uD06C\uB9AC\uC5D0\uC774\uD130\uB2F9 \uD55C \uC8FC\uC18C\uB9CC \uC120\uD0DD\uD569\uB2C8\uB2E4. \uBC1C\uC1A1\xB7\uC218\uC2E0 \uB3D9\uC758\xB7\uC804\uB2EC \uC131\uACF5\uC744 \uC758\uBBF8\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." };
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

// supabase/functions/creator-daily-outreach/execution-service.mjs
var fail = (code) => {
  throw new OutreachError(code, "\uD6C4\uBCF4 \uC900\uBE44 \uD398\uC774\uC9C0\uB97C \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC800\uC7A5\uB41C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.", 503);
};
function createExecutionPreparation({ repository, execution, enrichment, now = () => Date.now() }) {
  return { async prepare(owner) {
    const day = outreachDay(now()), existing = await repository.findRun(owner, day);
    const previous = existing ? null : await repository.latest(owner);
    const loaded = await execution.page(owner, { existing, previous });
    if (loaded?.complete !== true || !Array.isArray(loaded.candidates) || loaded.candidates.length > 60) fail("EXECUTION_PAGE_INCOMPLETE");
    const enriched = await enrichment.enrich(owner, { candidates: loaded.candidates });
    if (enriched?.complete !== true || !Array.isArray(enriched.candidates) || enriched.candidates.length !== loaded.candidates.length) fail("CONTACT_ENRICHMENT_INCOMPLETE");
    const history = await execution.historyFor(owner, enriched.candidates);
    const plan = buildDailyOutreachBatch({ candidates: enriched.candidates, history, now: now() });
    const result = await execution.savePage(owner, plan, loaded);
    if (!result || result.day !== day || result.sendingEnabled !== false || !result.executionProgress || typeof result.morePreparationRequired !== "boolean") fail("SAVE_UNCERTAIN");
    return result;
  } };
}

// supabase/functions/creator-daily-outreach/service.mjs
function dailyOutreachService({ repository, now = () => Date.now() }) {
  async function status(owner) {
    const latest = await repository.latest(owner);
    return { ...DAILY_OUTREACH, state: "preparation_only", copyStatus: "private_template_required", latest, blockers: ["production_activation_required", "approved_recipient_basis_required", "verified_inline_product_images_required", "daily_discovery_adapter_required", "dispatch_not_implemented", "existing_gmail_signature_required", "private_template_required", "live_gmail_preflight_required"], sendingEnabled: false, schedulerEnabled: false };
  }
  async function prepare(owner) {
    const day = outreachDay(now());
    const existing = await repository.findRun(owner, day);
    if (existing && (!existing.counts || hasCurrentRecipientGoal(existing) && existing.counts.youtube >= 50 && existing.counts.instagram >= 10)) return { ...existing, duplicate: true };
    const [sources, history] = await Promise.all([repository.candidates(owner), repository.history(owner)]);
    if (!sources || sources.complete !== true || !Array.isArray(sources.candidates)) throw new OutreachError("SOURCES_INCOMPLETE", "\uD6C4\uBCF4 \uC6D0\uBCF8\uC744 \uBAA8\uB450 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
    const plan = buildDailyOutreachBatch({ candidates: sources.candidates, history, now: now() });
    const result = await repository.save(owner, plan);
    if (!result || result.day !== day || result.sendingEnabled !== false) throw new OutreachError("SAVE_UNCERTAIN", "\uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.", 503);
    return result;
  }
  return { status, prepare };
}

// supabase/functions/creator-daily-outreach/review-pages.mjs
var uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
var fail2 = (code) => {
  throw new OutreachError(code, "\uAC80\uD1A0 \uBAA9\uB85D\uC758 \uBC94\uC704\uC640 \uD604\uC7AC \uC6D0\uBCF8\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.", 503);
};
function reviewCursor(value = null) {
  if (value !== null && !uuid(value)) throw new OutreachError("REVIEW_CURSOR_INVALID", "\uAC80\uD1A0 \uBAA9\uB85D\uC758 \uD398\uC774\uC9C0 \uC704\uCE58\uB97C \uD655\uC778\uD558\uC138\uC694.", 400);
  return value;
}
async function readReviewPage(sb2, { table, owner, key: key3 = "id", columns, scope, cursor = null, pageSize = 50, filter }) {
  reviewCursor(cursor);
  if (!uuid(owner) || ![20, 50].includes(pageSize)) fail2("REVIEW_PAGE_INVALID");
  const once = async () => {
    let totalQuery = sb2.from(table).select(key3, { count: "exact", head: true }).eq("owner", owner);
    let pageQuery = sb2.from(table).select(columns, { count: "exact" }).eq("owner", owner).order(key3, { ascending: true }).limit(pageSize);
    if (filter) {
      totalQuery = filter(totalQuery);
      pageQuery = filter(pageQuery);
    }
    if (cursor) pageQuery = pageQuery.gt(key3, cursor);
    const [all, page] = await Promise.all([totalQuery, pageQuery]), rows = page.data, total = all.count, remaining = page.count;
    if (all.error || page.error) fail2("REVIEW_PAGE_READ_FAILED");
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(remaining) || remaining < 0 || remaining > total || !Array.isArray(rows) || rows.length > pageSize || remaining < rows.length || !cursor && remaining !== total || !rows.length && remaining > 0) fail2("REVIEW_PAGE_INCOMPLETE");
    let prior = cursor || "";
    for (const row of rows) {
      if (row.owner !== owner || !uuid(row[key3]) || row[key3] <= prior) fail2("REVIEW_PAGE_INCOMPLETE");
      prior = row[key3];
    }
    const hasMore = remaining > rows.length;
    return { rows, pagination: { scope, cursor, nextCursor: hasMore ? prior : null, pageSize, total, remaining, returned: rows.length, hasMore } };
  };
  const first = await once(), second = await once();
  if (JSON.stringify(first) !== JSON.stringify(second)) fail2("REVIEW_PAGE_CHANGED");
  return first;
}

// supabase/functions/creator-daily-outreach/campaign-controller.mjs
function createOutreachController({ repository, supply, enrichment, dispatch, sourceReviews, preview, preparedRecipients, execution, env: env2 = () => "", now = () => Date.now() }) {
  const paged = execution ? createExecutionPreparation({ repository, execution, enrichment, now }) : null;
  const prepared = dailyOutreachService({ repository: { ...repository, async candidates(owner) {
    const sources = await supply.sourceCandidates(owner);
    if (sources?.complete !== true || !Array.isArray(sources.candidates)) throw new OutreachError("SOURCES_INCOMPLETE", "\uD604\uC7AC \uD6C4\uBCF4 \uC6D0\uBCF8\uC744 \uC644\uC804\uD558\uAC8C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
    const enriched = await enrichment.enrich(owner, { candidates: sources.candidates });
    if (enriched?.complete !== true || !Array.isArray(enriched.candidates)) throw new OutreachError("CONTACT_ENRICHMENT_INCOMPLETE", "\uACF5\uAC1C \uC5C5\uBB34 \uC5F0\uB77D\uCC98\uC758 \uCD5C\uC2E0 \uD655\uC778\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
    return { complete: true, candidates: enriched.candidates };
  } }, now });
  async function status(owner) {
    const [base2, discovery, campaign] = await Promise.all([prepared.status(owner), supply.status(owner), dispatch.configuration(owner)]);
    return {
      ...DAILY_OUTREACH,
      state: "campaign",
      preparationEnabled: env2("CREATOR_DAILY_PREPARATION_ENABLED") === "true" && discovery.enabled === true && discovery.configurationReady !== false && env2("CREATOR_DAILY_RETENTION_ENABLED") === "true",
      latest: base2.latest,
      discovery,
      campaign,
      // These flags describe capability, not a promise that an external timer exists.
      sendingEnabled: campaign.sendingEnabled === true && env2("EMAIL_SENDING_ENABLED") === "true",
      schedulerEnabled: campaign.schedulerEnabled === true && env2("CREATOR_DAILY_WORKER_ENABLED") === "true",
      recurringTriggerVerified: campaign.recurringTriggerVerified === true,
      blockers: Array.isArray(campaign.blockers) ? campaign.blockers : [],
      copyStatus: campaign.snapshotId ? "private_template_saved" : "private_template_required"
    };
  }
  async function prepare(owner) {
    if (env2("CREATOR_DAILY_PREPARATION_ENABLED") !== "true") throw new OutreachError("PREPARATION_DISABLED", "\uC77C\uC77C \uD6C4\uBCF4 \uC900\uBE44\uAC00 \uC544\uC9C1 \uC6B4\uC601 \uD65C\uC131\uD654 \uC804\uC785\uB2C8\uB2E4.", 503);
    if (env2("CREATOR_DAILY_RETENTION_ENABLED") !== "true") throw new OutreachError("RETENTION_REQUIRED", "API \uC790\uB8CC \uC815\uB9AC \uC791\uC5C5\uC744 \uBA3C\uC800 \uC5F0\uACB0\uD574\uC57C \uD569\uB2C8\uB2E4.", 503);
    const existing = await repository.findRun(owner, outreachDay(now()));
    if (!execution && existing && (!existing.counts || hasCurrentRecipientGoal(existing) && existing.counts.youtube >= 50 && existing.counts.instagram >= 10)) return { ...existing, duplicate: true };
    const discovery = await supply.status(owner), latest = discovery.latest;
    if (latest?.day !== outreachDay(now()) || latest?.state !== "completed") throw new OutreachError("COLLECTION_REQUIRED", "\uC624\uB298 \uC2E0\uADDC \uD6C4\uBCF4 \uD0D0\uC0C9\uC744 \uBA3C\uC800 \uC644\uB8CC\uD558\uACE0 \uADFC\uAC70\uB97C \uAC80\uD1A0\uD558\uC138\uC694.", 409);
    return paged ? paged.prepare(owner) : prepared.prepare(owner);
  }
  async function collect(owner) {
    if (env2("CREATOR_DAILY_PREPARATION_ENABLED") !== "true") throw new OutreachError("PREPARATION_DISABLED", "\uC77C\uC77C \uD6C4\uBCF4 \uC900\uBE44\uAC00 \uC544\uC9C1 \uC6B4\uC601 \uD65C\uC131\uD654 \uC804\uC785\uB2C8\uB2E4.", 503);
    if (env2("CREATOR_DAILY_RETENTION_ENABLED") !== "true") throw new OutreachError("RETENTION_REQUIRED", "API \uC790\uB8CC \uC815\uB9AC \uC791\uC5C5\uC744 \uBA3C\uC800 \uC5F0\uACB0\uD574\uC57C \uD569\uB2C8\uB2E4.", 503);
    const result = await supply.run(owner);
    if (result?.state === "busy") throw new OutreachError("DAILY_SUPPLY_BUSY", "\uC624\uB298\uC758 \uD6C4\uBCF4 \uD0D0\uC0C9\uC774 \uC774\uBBF8 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.", 409);
    if (result?.state !== "completed") throw new OutreachError("DAILY_SUPPLY_FAILED", "\uC624\uB298\uC758 \uD6C4\uBCF4 \uD0D0\uC0C9\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC800\uC7A5\uB41C \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC138\uC694.", 503);
    return result;
  }
  return { status, prepare, collect, preparedRecipients: (owner) => {
    if (typeof preparedRecipients !== "function") throw new OutreachError("PREPARED_RECIPIENTS_UNAVAILABLE", "\uC624\uB298 \uC900\uBE44\uD55C \uC218\uC2E0 \uC8FC\uC18C \uC870\uD68C\uAC00 \uC544\uC9C1 \uC5F0\uACB0\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", 503);
    return preparedRecipients(owner);
  }, preview: (owner, input) => {
    if (typeof preview !== "function") throw new OutreachError("PREVIEW_UNAVAILABLE", "\uAC1C\uBCC4 \uBB38\uC548 \uBBF8\uB9AC\uBCF4\uAE30\uAC00 \uC544\uC9C1 \uC5F0\uACB0\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", 503);
    return preview(owner, input);
  }, currentPlan: (owner) => repository.findRun(owner, outreachDay(now())), configuration: (owner) => dispatch.configuration(owner), configure: (owner, input) => dispatch.configure(owner, input), schedule: (owner, input) => dispatch.schedule(owner, input), pause: (owner, input) => dispatch.pause(owner, input), runs: (owner) => dispatch.runs(owner), recipientReviews: (owner) => dispatch.recipientReviews(owner), reviewRecipient: (owner, input) => dispatch.reviewRecipient(owner, input), supplyReview: (owner, options) => supply.listReview(owner, options), reviewCandidate: (owner, input) => supply.review(owner, input), sourceReviewList: (owner, options) => sourceReviews?.list(owner, options) || Promise.resolve({ items: [], registrationEnabled: false }), registerSourceReview: (owner, input) => {
    if (!sourceReviews?.register) throw new OutreachError("SOURCE_REGISTRATION_DISABLED", "\uCD9C\uCC98 \uAC80\uD1A0 \uB4F1\uB85D\uC774 \uC544\uC9C1 \uC5F0\uACB0\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", 503);
    return sourceReviews.register(owner, input);
  } };
}
var routes = {
  "/prepared-recipients": ["GET", "preparedRecipients", 0],
  "/status": ["GET", "status", 0],
  "/configuration": ["GET", "configuration", 0],
  "/runs": ["GET", "runs", 0],
  "/recipient-reviews": ["GET", "recipientReviews", 0],
  "/supply-review": ["GET", "supplyReview", 0],
  "/source-reviews": ["GET", "sourceReviewList", 0],
  "/preview": ["POST", "preview", 512],
  "/collect": ["POST", "collect", 32],
  "/review-candidate": ["POST", "reviewCandidate", 24e3],
  "/prepare": ["POST", "prepare", 32],
  "/configure": ["POST", "configure", 5 * 1024 * 1024],
  "/schedule": ["POST", "schedule", 512],
  "/pause": ["POST", "pause", 512],
  "/review-recipient": ["POST", "reviewRecipient", 16e3],
  "/register-source-review": ["POST", "registerSourceReview", 24e3]
};
async function jsonBody(req, max) {
  if (Number(req.headers.get("Content-Length") || 0) > max) throw new OutreachError("BODY_TOO_LARGE", "\uC694\uCCAD \uD30C\uC77C \uB610\uB294 \uB0B4\uC6A9\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.", 413);
  const reader = req.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new OutreachError("BODY_TOO_LARGE", "\uC694\uCCAD \uD30C\uC77C \uB610\uB294 \uB0B4\uC6A9\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.", 413);
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    raw.set(chunk, at);
    at += chunk.length;
  }
  let body;
  try {
    body = size ? JSON.parse(new TextDecoder().decode(raw)) : {};
  } catch {
    throw new OutreachError("INVALID_JSON", "\uC785\uB825 \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OutreachError("INVALID_INPUT", "\uC785\uB825 \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.");
  if (["owner", "sendEnabled", "enabled", "sendingEnabled", "serviceRole", "token"].some((key3) => Object.hasOwn(body, key3))) throw new OutreachError("CALLER_SCOPE_DENIED", "\uACC4\uC815\xB7\uBC1C\uC1A1 \uAD8C\uD55C\xB7\uC778\uC99D\uC815\uBCF4\uB97C \uC694\uCCAD\uC73C\uB85C \uC9C0\uC815\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return body;
}
function campaignHandler({ sb: sb2, controller, env: env2 = () => "" }) {
  return async (req) => {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers });
    const origin = req.headers.get("Origin"), allowed = (env2("APP_ORIGIN") || "https://dothegy.github.io").split(",").map((v) => v.trim());
    if (origin && !allowed.includes(origin)) return json({ code: "ORIGIN_DENIED" }, 403);
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.get("Authorization") || "")?.[1];
      if (!token) throw new OutreachError("AUTH_REQUIRED", "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.", 401);
      const auth = await sb2.auth.getUser(token), owner = auth.data?.user?.id;
      if (auth.error || !owner) throw new OutreachError("AUTH_REQUIRED", "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.", 401);
      const member = await sb2.from("sanji_members").select("user_id").eq("user_id", owner).maybeSingle();
      if (member.error || member.data?.user_id !== owner) throw new OutreachError("MEMBERSHIP_REQUIRED", "\uD604\uC7AC Sanji \uD68C\uC6D0 \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.", 403);
      const path = new URL(req.url).pathname.replace(/^.*\/creator-daily-outreach/, ""), route = routes[path];
      if (!route || req.method !== route[0]) throw new OutreachError("NOT_FOUND", "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC694\uCCAD\uC785\uB2C8\uB2E4.", 404);
      if (req.method === "GET") {
        const params = new URL(req.url).searchParams, paged = ["/supply-review", "/source-reviews"].includes(path);
        if ([...params.keys()].some((key3) => !paged || key3 !== "cursor") || params.getAll("cursor").length > 1) throw new OutreachError("REVIEW_QUERY_INVALID", "\uAC80\uD1A0 \uBAA9\uB85D\uC758 \uC870\uD68C \uC870\uAC74\uC744 \uD655\uC778\uD558\uC138\uC694.", 400);
        return json(await controller[route[1]](owner, ...paged ? [{ cursor: reviewCursor(params.get("cursor")) }] : []));
      }
      const body = await jsonBody(req, route[2]);
      if (["/prepare", "/collect"].includes(path)) {
        if (Object.keys(body).length) throw new OutreachError("INVALID_INPUT", "\uC900\uBE44 \uC694\uCCAD\uC740 \uBE48 \uAC1D\uCCB4\uB9CC \uD5C8\uC6A9\uD569\uB2C8\uB2E4.");
        if (env2("CREATOR_DAILY_PREPARATION_ENABLED") !== "true") throw new OutreachError("PREPARATION_DISABLED", "\uC77C\uC77C \uD6C4\uBCF4 \uC900\uBE44\uAC00 \uC544\uC9C1 \uC6B4\uC601 \uD65C\uC131\uD654 \uC804\uC785\uB2C8\uB2E4.", 503);
      }
      if (["/schedule", "/pause"].includes(path) && (Object.keys(body).some((key3) => key3 !== "expectedRevision") || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 1)) throw new OutreachError("REVISION_REQUIRED", "\uD604\uC7AC \uC124\uC815 \uBC84\uC804\uC744 \uD655\uC778\uD558\uC138\uC694.");
      return json(await controller[route[1]](owner, body));
    } catch (error2) {
      return json({ code: error2 instanceof OutreachError ? error2.code : "CAMPAIGN_UNAVAILABLE", error: error2 instanceof OutreachError ? error2.message : "\uCEA0\uD398\uC778 \uCC98\uB9AC \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694." }, error2 instanceof OutreachError ? error2.status : 503);
    }
  };
}

// supabase/functions/creator-daily-outreach/repository.mjs
var fail3 = (code) => {
  throw new OutreachError(code, "\uC6D0\uBCF8\xB7\uC911\uBCF5 \uC774\uB825\uC744 \uC644\uC804\uD558\uAC8C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
};
var iso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00.000Z" : v;
function adaptYoutubeRecord(record) {
  const d = record.data || {}, r = d.youtubeResearch || {}, review = d.dailyOutreachEvidence || {};
  const channelId = r.channelId || String(d.profile || "").match(/\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
  if (!channelId) return null;
  const leads = (r.businessContacts || []).map((e) => ({ creatorKey: "youtube:" + channelId, address: e.email, sourceUrl: e.sourceUrl, sourceText: e.context || "", sourceKind: "unverified_secondary_source", checkedAt: iso(e.checked), verified: false }));
  return { platform: "youtube", externalId: channelId, name: d.name, profileUrl: d.profile, sourceRecordId: record.id, sourceRecordVersion: record.version, sourceRecordUpdated: record.updated, audience: d.followers, audienceSource: d.metricsSource, audienceCheckedAt: iso(review.audienceCheckedAt || r.subscriberObservationDate), lastActiveAt: review.lastActiveAt || r.observedActivity?.last_activity_date, activitySource: review.activitySource || r.observedActivity?.last_activity_url, activityCheckedAt: iso(review.activityCheckedAt), mukbang: review.mukbang, displayNameEvidence: review.displayNameEvidence, contactEvidence: Array.isArray(review.contactEvidence) ? review.contactEvidence : leads, excluded: ["\uAC70\uC808", "\uC218\uC2E0 \uAC70\uBD80", "\uC81C\uC678"].includes(d.status) };
}
function adaptInstagramRecord(record, evidence) {
  const review = evidence.filter((e) => e.creator_id === record.id && e.source_kind === "daily_outreach_review").sort((a, b) => Date.parse(b.seen_at) - Date.parse(a.seen_at))[0]?.detail || {};
  return { platform: "instagram", externalId: record.handle, name: record.nickname || record.handle, profileUrl: record.profile_url, sourceRecordId: record.id, sourceRecordUpdated: record.updated, existingDatabaseRecord: true, audience: record.followers, audienceSource: record.followers_source, audienceCheckedAt: record.followers_checked, lastActiveAt: review.lastActiveAt, activitySource: review.activitySource, activityCheckedAt: review.activityCheckedAt, mukbang: review.mukbang, displayNameEvidence: review.displayNameEvidence, contactEvidence: Array.isArray(review.contactEvidence) ? review.contactEvidence : [], excluded: record.status !== "new" || record.assessment === "excluded" || record.entity_type === "noncreator_suspected" || record.link_status !== "source_confirmed" };
}
function historicalIdentities(rows, directory = []) {
  const creatorKeys = /* @__PURE__ */ new Set(), emailKeys = /* @__PURE__ */ new Set();
  const byId = new Map(directory.filter((r) => r.id && r.creatorKey).map((r) => [r.id, r.creatorKey]));
  function walk(value, key3 = "") {
    if (typeof value === "string") {
      for (const address of value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) {
        const identity = emailIdentity(address);
        if (identity) emailKeys.add(identity);
      }
      if (["target", "sourceRecordId", "creator_id", "creatorId", "creatorReviewId"].includes(key3) && byId.has(value)) creatorKeys.add(byId.get(value));
      if (["channelId", "channel_id"].includes(key3) && /^UC[A-Za-z0-9_-]{22}$/.test(value)) creatorKeys.add("youtube:" + value);
      const youtube = value.match(/(?:youtube:|youtube\.com\/channel\/)(UC[A-Za-z0-9_-]{22})(?:$|[/?#\s])/);
      if (youtube) creatorKeys.add("youtube:" + youtube[1]);
      if (["creator_key", "creatorKey"].includes(key3) && /^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value)) creatorKeys.add(value);
      if (["identity", "creator_key", "creatorKey"].includes(key3) && /^instagram:[a-z0-9._]{1,30}$/i.test(value)) creatorKeys.add(value.toLowerCase());
      if (["handle", "username"].includes(key3) && /^[a-z0-9._]{1,30}$/i.test(value.replace(/^@/, ""))) creatorKeys.add("instagram:" + value.replace(/^@/, "").toLowerCase());
      const instagram = value.match(/instagram\.com\/([a-z0-9._]{1,30})(?:\/|$)/i);
      if (instagram) creatorKeys.add("instagram:" + instagram[1].toLowerCase());
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key3));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  }
  rows.forEach(walk);
  return { complete: true, creatorKeys: [...creatorKeys], emailKeys: [...emailKeys] };
}
function createOutreachRepository(sb2) {
  const query = async (promise) => {
    const r = await promise;
    if (r.error) fail3("SOURCE_READ_FAILED");
    return r.data;
  };
  async function scan(table, owner, { key: key3 = "id", columns = "*", filter } = {}) {
    const scanOnce = async () => {
      const rows2 = [];
      let cursor = "", total = null;
      for (let page = 0; page < 100; page++) {
        let q = sb2.from(table).select(columns, { count: "exact" }).eq("owner", owner).order(key3, { ascending: true }).limit(500);
        if (filter) q = filter(q);
        if (cursor) q = q.gt(key3, cursor);
        const response = await q, part = response.data, count = response.count;
        if (response.error) fail3("SOURCE_READ_FAILED");
        if (!Array.isArray(part) || part.length > 500 || !Number.isSafeInteger(count) || count < part.length) fail3("SOURCES_INCOMPLETE");
        if (total === null) total = count;
        if (total > 1e4 || rows2.length + count !== total) fail3("SOURCES_INCOMPLETE");
        for (const row of part) {
          if (row.owner !== owner || typeof row[key3] !== "string" || !row[key3] || cursor && row[key3] <= cursor) fail3("SOURCE_READ_FAILED");
          cursor = row[key3];
          rows2.push(row);
        }
        if (rows2.length === total) return rows2;
        if (!part.length) fail3("SOURCES_INCOMPLETE");
      }
      fail3("SOURCES_INCOMPLETE");
    };
    const rows = await scanOnce(), check = await scanOnce();
    if (JSON.stringify(rows) !== JSON.stringify(check)) fail3("SOURCES_CHANGED");
    return rows;
  }
  async function compositeScan(table, owner, { columns = "*", keys: keys2, filter } = {}) {
    const once = async () => {
      let q = sb2.from(table).select(columns, { count: "exact" }).eq("owner", owner);
      if (filter) q = filter(q);
      for (const key3 of keys2) q = q.order(key3, { ascending: true });
      const response = await q.limit(10001), rows2 = response.data;
      if (response.error) fail3("SOURCE_READ_FAILED");
      if (!Array.isArray(rows2) || !Number.isSafeInteger(response.count) || response.count !== rows2.length || rows2.length > 1e4 || rows2.some((row) => row.owner !== owner)) fail3("SOURCES_INCOMPLETE");
      return rows2;
    };
    const rows = await once(), check = await once();
    if (JSON.stringify(rows) !== JSON.stringify(check)) fail3("SOURCES_CHANGED");
    return rows;
  }
  async function candidates(owner) {
    const [saved, instagram] = await Promise.all([scan("sanji_records", owner, { filter: (q) => q.eq("kind", "candidate") }), scan("sanji_creator_recovery", owner)]);
    const evidence = await compositeScan("sanji_creator_evidence", owner, { columns: "owner,creator_id,source_kind,source_url,source_ref,observation_key,detail,seen_at", keys: ["creator_id", "source_kind", "source_url", "source_ref", "observation_key"], filter: (q) => q.eq("source_kind", "daily_outreach_review") });
    const candidates2 = [...saved.filter((r) => r.data?.channels === "YouTube").map(adaptYoutubeRecord).filter(Boolean), ...instagram.map((r) => adaptInstagramRecord(r, evidence))];
    if (candidates2.length > 5e3) fail3("SOURCES_INCOMPLETE");
    return { complete: true, candidates: candidates2 };
  }
  async function reviewCandidates(owner, { cursor = null } = {}) {
    const page = await readReviewPage(sb2, { table: "sanji_creator_recovery", owner, columns: "owner,id,handle,nickname,profile_url,updated,followers,followers_source,followers_checked,status,assessment,entity_type,link_status", scope: "existing_instagram_database", cursor });
    const ids = page.rows.map((row) => row.id);
    const evidence = ids.length ? await compositeScan("sanji_creator_evidence", owner, { columns: "owner,creator_id,source_kind,source_url,source_ref,observation_key,detail,seen_at", keys: ["creator_id", "source_kind", "source_url", "source_ref", "observation_key"], filter: (q) => q.eq("source_kind", "daily_outreach_review").in("creator_id", ids) }) : [];
    if (evidence.some((row) => !ids.includes(row.creator_id) || row.source_kind !== "daily_outreach_review")) fail3("REVIEW_PAGE_INCOMPLETE");
    return { pageComplete: true, candidates: page.rows.map((row) => adaptInstagramRecord(row, evidence)), pagination: page.pagination };
  }
  async function history(owner) {
    const [outbox, records, suppression, reserved, reviews, drafts, jobs, inbound, notes, manual, queue, instagramInbound, instagramReplies, recovery] = await Promise.all([
      scan("sanji_outbox", owner),
      scan("sanji_records", owner),
      scan("sanji_suppression", owner, { key: "identity" }),
      scan("sanji_daily_outreach_candidates", owner, { key: "creator_key" }),
      scan("sanji_creator_contact_review", owner, { key: "creator_id" }),
      scan("sanji_drafts", owner),
      scan("sanji_jobs", owner),
      compositeScan("sanji_creator_inbound_messages", owner, { keys: ["mailbox", "provider_thread_id", "provider_message_id"] }),
      scan("sanji_creator_manual_notes", owner, { key: "note_id" }),
      compositeScan("sanji_ig_manual_conversations", owner, { keys: ["account_id", "peer_id"] }),
      scan("sanji_creator_email_isolated_queue", owner, { key: "creator_id" }),
      compositeScan("sanji_instagram_inbound", owner, { keys: ["account_id", "message_id"] }),
      scan("sanji_instagram_reply_attempts", owner, { key: "request_id" }),
      scan("sanji_creator_recovery", owner)
    ]);
    const draftById = new Map(drafts.map((r) => [r.id, r]));
    if (jobs.some((r) => !draftById.has(r.draft_id))) fail3("HISTORY_INCOMPLETE");
    const directory = [...records.filter((r) => r.kind === "candidate").map((r) => ({ id: r.id, creatorKey: r.data?.channels === "YouTube" ? creatorIdentity(adaptYoutubeRecord(r)) : creatorIdentity({ platform: "instagram", externalId: r.data?.handle }) })), ...recovery.map((r) => ({ id: r.id, creatorKey: creatorIdentity({ platform: "instagram", externalId: r.handle }) }))];
    return { ...historicalIdentities([...outbox, ...records.filter((r) => r.kind === "thread"), ...suppression, ...reserved, ...reviews, ...jobs, ...jobs.map((r) => draftById.get(r.draft_id)), ...inbound, ...notes, ...manual, ...queue, ...instagramInbound, ...instagramReplies], directory), scope: "saved_sanji_history", gmailProviderHistoryChecked: false };
  }
  const findRun = async (owner, day) => {
    const row = await query(sb2.from("sanji_daily_outreach_runs").select("summary").eq("owner", owner).eq("day", day).maybeSingle());
    return row?.summary || null;
  };
  return { candidates, reviewCandidates, history, findRun, async latest(owner) {
    const rows = await query(sb2.from("sanji_daily_outreach_runs").select("summary").eq("owner", owner).order("day", { ascending: false }).limit(1));
    return rows?.[0]?.summary || null;
  }, async save(owner, plan) {
    return query(sb2.rpc("sanji_daily_outreach_prepare", { p_owner: owner, p_day: plan.day, p_plan: plan }));
  } };
}

// supabase/functions/creator-daily-outreach/supply-instagram-review.mjs
var DAY2 = 864e5;
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var fields = ["creatorKey", "sourceRecordId", "sourceRecordUpdated", "audience", "audienceSource", "audienceCheckedAt", "lastActiveAt", "activitySource", "activityCheckedAt", "mukbang", "contactEvidence"];
var fail4 = (code = "INSTAGRAM_REVIEW_INVALID") => {
  throw new OutreachError(code, "\uAE30\uC874 Instagram \uC6D0\uBCF8\uACFC \uCD5C\uC2E0 \uD314\uB85C\uC6CC\xB7\uD65C\uB3D9\xB7\uBA39\uBC29\xB7\uACF5\uAC1C \uC5F0\uB77D\uCC98 \uADFC\uAC70\uB97C \uD655\uC778\uD558\uC138\uC694.", 400);
};
function instagramReviewState(row, review, now = Date.now(), guard = false) {
  if (row.excluded === true || row.priorContact === true || row.suppressed === true || row.assessment === "excluded") return "excluded";
  if (!review) return guard ? "stale" : "pending";
  if (row.existingDatabaseRecord !== true || row.platform !== "instagram" || review.creatorKey !== creatorIdentity(row) || review.sourceRecordId !== row.sourceRecordId || review.sourceRecordUpdated !== row.sourceRecordUpdated || !Number.isFinite(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= now) return "stale";
  return "reviewed";
}
function validateInstagramReview(owner, input, row, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !fields.includes(k)) || JSON.stringify(input).length > 16e3) fail4();
  if (row?.platform !== "instagram" || row.existingDatabaseRecord !== true || !UUID.test(row.sourceRecordId || "") || !Number.isFinite(Date.parse(row.sourceRecordUpdated)) || input.creatorKey !== creatorIdentity(row) || input.sourceRecordId !== row.sourceRecordId || input.sourceRecordUpdated !== row.sourceRecordUpdated || !profileMatches(row, row.profileUrl)) fail4("INSTAGRAM_REVIEW_SOURCE_CHANGED");
  if (instagramReviewState(row, null, now) === "excluded") fail4("INSTAGRAM_REVIEW_NATIVE_EXCLUDED");
  if (!Number.isSafeInteger(input.audience) || input.audience < audienceBounds("instagram").minimum || input.audience > audienceBounds("instagram").maximum || !sourceUrl(input.audienceSource) || !fresh(input.audienceCheckedAt, now, 29)) fail4("INSTAGRAM_REVIEW_AUDIENCE_REQUIRED");
  if (!sourceUrl(input.activitySource) || !fresh(input.activityCheckedAt, now, 29) || !fresh(input.lastActiveAt, now, 90)) fail4("INSTAGRAM_REVIEW_ACTIVITY_REQUIRED");
  const m = input.mukbang;
  if (!m || m.verified !== true || !sourceUrl(m.sourceUrl) || typeof m.sourceText !== "string" || !m.sourceText.trim() || m.sourceText.length > 2e3 || !fresh(m.checkedAt, now, 29)) fail4("INSTAGRAM_REVIEW_MUKBANG_REQUIRED");
  if (input.contactEvidence !== void 0 && (!Array.isArray(input.contactEvidence) || input.contactEvidence.length > 5)) fail4();
  const contactEvidence2 = input.contactEvidence || [];
  const evidence = { audience: input.audience, audienceSource: sourceUrl(input.audienceSource), audienceCheckedAt: input.audienceCheckedAt, lastActiveAt: input.lastActiveAt, activitySource: sourceUrl(input.activitySource), activityCheckedAt: input.activityCheckedAt, mukbang: { verified: true, sourceUrl: sourceUrl(m.sourceUrl), sourceText: m.sourceText, checkedAt: m.checkedAt }, contactEvidence: contactEvidence2 };
  const qualified = qualifyOutreachCandidate({ ...row, ...evidence }, now);
  if (!qualified.eligible) fail4("INSTAGRAM_REVIEW_EVIDENCE_REQUIRED");
  if (contactEvidence2.length && qualified.contactReason) fail4("INSTAGRAM_REVIEW_CONTACT_REQUIRED");
  const times = [input.audienceCheckedAt, input.activityCheckedAt, m.checkedAt, ...contactEvidence2.flatMap((e) => [e.checkedAt, ...e.affiliation ? [e.affiliation.checkedAt] : []])].map(Date.parse);
  if (times.some((t) => !Number.isFinite(t) || t > now)) fail4();
  const expiry = Math.min(...times.map((t) => t + 29 * DAY2), Date.parse(input.lastActiveAt) + 90 * DAY2);
  if (!Number.isFinite(expiry) || expiry <= now) fail4("INSTAGRAM_REVIEW_EXPIRED");
  return { creatorKey: creatorIdentity(row), sourceRecordId: row.sourceRecordId, sourceRecordUpdated: row.sourceRecordUpdated, ...evidence, reviewedBy: owner, reviewedAt: new Date(now).toISOString(), expiresAt: new Date(expiry).toISOString() };
}
function applyInstagramReview(row, review, now = Date.now(), guard = false) {
  const state = instagramReviewState(row, review, now, guard);
  if (state === "stale") return { ...row, excluded: true, reviewRequired: [...row.reviewRequired || [], "instagram_review_required"] };
  if (state !== "reviewed") return { ...row };
  return { ...row, audience: review.audience, audienceSource: review.audienceSource, audienceCheckedAt: review.audienceCheckedAt, lastActiveAt: review.lastActiveAt, activitySource: review.activitySource, activityCheckedAt: review.activityCheckedAt, mukbang: review.mukbang, contactEvidence: review.contactEvidence, supplyReview: { source: "existing_instagram_database", sourceRecordUpdated: review.sourceRecordUpdated, reviewedAt: review.reviewedAt, expiresAt: review.expiresAt } };
}

// supabase/functions/creator-daily-outreach/supply-review.mjs
var DAY3 = 864e5;
var clean2 = (v) => typeof v === "string" ? v.trim() : "";
var fail5 = (code = "SUPPLY_REVIEW_INVALID") => {
  throw new OutreachError(code, "\uD06C\uB9AC\uC5D0\uC774\uD130\xB7\uB3C5\uB9BD \uCD9C\uCC98\xB7\uBA39\uBC29\xB7\uACF5\uAC1C \uC5F0\uB77D\uCC98 \uADFC\uAC70\uB97C \uD655\uC778\uD558\uC138\uC694.", 400);
};
var nonIndependent = (url) => /(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname);
function validateSupplyReview(owner, input, snapshot, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["creatorKey", "snapshotObservedAt", "mukbang", "displayNameEvidence", "contactEvidence"].includes(k)) || JSON.stringify(input).length > 16e3) fail5();
  const row = { platform: "youtube", externalId: snapshot.channelId }, key3 = creatorIdentity(row), profile = "https://www.youtube.com/channel/" + snapshot.channelId;
  if (!key3 || input.creatorKey !== key3 || input.snapshotObservedAt !== snapshot.observedAt || Date.parse(snapshot.expiresAt) <= now) fail5("SUPPLY_REVIEW_STALE");
  const d = input.displayNameEvidence, m = input.mukbang;
  if (!d || d.verified !== true || !["official_website", "provided_by_creator"].includes(d.kind) || d.creatorKey !== key3 || d.profileUrl !== profile || !profileMatches(row, d.profileUrl) || !clean2(d.name) || d.name.length > 150 || /[\r\n<>\[\]{}]/.test(d.name) || !sourceUrl(d.sourceUrl) || nonIndependent(sourceUrl(d.sourceUrl)) || !clean2(d.sourceText) || d.sourceText.length > 4e3 || !d.sourceText.includes(clean2(d.name)) || !(d.sourceText.includes(profile) || d.sourceText.includes(snapshot.channelId)) || !fresh(d.checkedAt, now, 29)) fail5("SUPPLY_INDEPENDENT_IDENTITY_REQUIRED");
  if (!m || m.verified !== true || !sourceUrl(m.sourceUrl) || !clean2(m.sourceText) || m.sourceText.length > 2e3 || !fresh(m.checkedAt, now, 29)) fail5("SUPPLY_MUKBANG_REVIEW_REQUIRED");
  if (input.contactEvidence !== void 0 && (!Array.isArray(input.contactEvidence) || input.contactEvidence.length > 5)) fail5();
  const contactEvidence2 = input.contactEvidence || [];
  const q = qualifyOutreachCandidate({ ...row, name: clean2(d.name), profileUrl: profile, audience: snapshot.subscriberCount, audienceSource: profile, audienceCheckedAt: snapshot.observedAt, lastActiveAt: snapshot.lastActiveAt, activitySource: snapshot.lastActivityUrl, activityCheckedAt: snapshot.observedAt, mukbang: m, contactEvidence: contactEvidence2 }, now);
  if (q.reasons.includes("audience_out_of_range_or_unknown")) fail5("SUPPLY_REVIEW_AUDIENCE_REQUIRED");
  if (contactEvidence2.length && q.contactReason) fail5("SUPPLY_CONTACT_REVIEW_REQUIRED");
  const times = [Date.parse(d.checkedAt), Date.parse(m.checkedAt), ...contactEvidence2.flatMap((e) => [Date.parse(e.checkedAt), ...e.affiliation ? [Date.parse(e.affiliation.checkedAt)] : []])];
  if (times.some((t) => !Number.isFinite(t) || t > now)) fail5();
  const expiresAt = new Date(Math.min(Date.parse(snapshot.expiresAt), ...times.map((t) => t + 29 * DAY3))).toISOString();
  if (Date.parse(expiresAt) <= now) fail5("SUPPLY_REVIEW_STALE");
  return { creatorKey: key3, snapshotObservedAt: snapshot.observedAt, displayNameEvidence: { name: clean2(d.name), sourceUrl: sourceUrl(d.sourceUrl), sourceText: d.sourceText, checkedAt: d.checkedAt, verified: true, kind: d.kind, creatorKey: key3, profileUrl: profile }, independentlyReviewed: true, mukbang: { verified: true, sourceUrl: sourceUrl(m.sourceUrl), sourceText: m.sourceText, checkedAt: m.checkedAt, independentlyReviewed: true, independentSource: !nonIndependent(sourceUrl(m.sourceUrl)) }, contactEvidence: contactEvidence2, reviewedBy: owner, reviewedAt: new Date(now).toISOString(), expiresAt };
}
function applySupplyReview(candidate, review, now = Date.now()) {
  if (!review || review.snapshotObservedAt !== candidate.apiSnapshot?.observedAt || review.creatorKey !== creatorIdentity(candidate) || !Number.isFinite(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= now) return candidate;
  const d = review.displayNameEvidence;
  if (d?.verified !== true || review.independentlyReviewed !== true || d.creatorKey !== creatorIdentity(candidate) || d.profileUrl !== candidate.profileUrl) return candidate;
  return { ...candidate, name: d.name, displayNameEvidence: d, independentIdentityEvidence: d, mukbang: review.mukbang, contactEvidence: review.contactEvidence, reviewRequired: [], apiSnapshot: { ...candidate.apiSnapshot, titleFromApi: true, nameIndependentlySourced: true, identityIndependentlySourced: true, fieldNames: candidate.apiSnapshot.fieldNames.filter((k) => !["name", "creatorKey", "externalId", "profileUrl"].includes(k)) } };
}

// supabase/functions/youtube-discovery/discovery.mjs
var publicCount = (value) => /^(?:0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
var channelIdValid = (value) => typeof value === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(value);
function publicText(value, max = 600) {
  return String(value || "").normalize("NFKC").replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[\uC5F0\uB77D\uCC98 \uD45C\uC2DC \uC548 \uD568]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

// supabase/functions/creator-daily-outreach/supply.mjs
var SUPPLY_LIMITS = Object.freeze({ searchCalls: 4, readCalls: 112, candidates: 100, pageSize: 50, recentDays: 90, snapshotDays: 29, cursorDays: 7, projectSearchCalls: 20, projectReadUnits: 500, leaseSeconds: 300, timeoutMs: 12e4 });
var DAY4 = 864e5;
var CAMPAIGN = DAILY_OUTREACH.campaign;
var QUERIES = ["\uBA39\uBC29", "\uBE75 \uBA39\uBC29"];
var videoIdValid = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v);
var validDate = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
var fail6 = (code, message, status = 503) => {
  throw new OutreachError(code, message, status);
};
function supplyConfig(env2 = () => void 0) {
  return { enabled: env2("CREATOR_DAILY_SUPPLY_ENABLED") === "true", apiKey: env2("YOUTUBE_API_KEY") || "", projectId: env2("YOUTUBE_QUOTA_PROJECT_ID") || "" };
}
function initialCursor(now) {
  return { version: 1, anchor: new Date(now).toISOString(), expiresAt: new Date(now + SUPPLY_LIMITS.cursorDays * DAY4).toISOString(), next: 0, queries: QUERIES.map((query) => ({ query, pageToken: null, done: false, seenTokens: [] })) };
}
function continuationCursor(prior, now) {
  if (!prior || prior.version !== 1 || !validDate(prior.anchor) || Date.parse(prior.anchor) > now || !validDate(prior.expiresAt) || Date.parse(prior.expiresAt) <= now || !Array.isArray(prior.queries) || prior.queries.length !== QUERIES.length || prior.queries.some((s, i) => s.query !== QUERIES[i] || !(s.pageToken === null || typeof s.pageToken === "string" && s.pageToken.length <= 512) || !Array.isArray(s.seenTokens) || s.seenTokens.length > 32 || s.seenTokens.some((t) => typeof t !== "string" || t.length > 512)) || prior.queries.every((q) => q.done)) return initialCursor(now);
  return structuredClone(prior);
}
function snapshotCandidate(row) {
  const c = row.snapshot || row;
  return { platform: "youtube", externalId: c.channelId, name: c.title, profileUrl: c.url, sourceRecordId: null, audience: c.subscriberCount, audienceSource: c.url, audienceCheckedAt: c.observedAt, lastActiveAt: c.lastActiveAt, activitySource: c.lastActivityUrl, activityCheckedAt: c.observedAt, mukbang: null, contactEvidence: [], apiSnapshot: { channelId: c.channelId, observedAt: c.observedAt, expiresAt: c.expiresAt, fieldNames: ["creatorKey", "externalId", "profileUrl", "name", "audience", "audienceSource", "audienceCheckedAt", "lastActiveAt", "activitySource", "activityCheckedAt"], titleFromApi: true }, reviewRequired: ["mukbang_evidence_required", "public_email_evidence_required"] };
}
function mergeSupplyCandidates(manual, snapshots, now = Date.now(), reviews = [], instagramReviews = [], instagramReviewGuards = []) {
  const fresh2 = snapshots.filter((r) => {
    const c = r.snapshot || r;
    return channelIdValid(c.channelId) && validDate(c.observedAt) && Date.parse(c.observedAt) <= now && validDate(c.expiresAt) && Date.parse(c.expiresAt) > now && Date.parse(c.expiresAt) <= Date.parse(c.observedAt) + 30 * DAY4;
  });
  const byKey = new Map(fresh2.map((r) => {
    const candidate = snapshotCandidate(r), review = reviews.find((v) => (v.review || v).creatorKey === creatorIdentity(candidate));
    return [creatorIdentity(candidate), applySupplyReview(candidate, review?.review || review, now)];
  }));
  const result = manual.map((row) => {
    if (row.platform === "instagram") {
      const review = instagramReviews.find((r) => (r.review || r).sourceRecordId === row.sourceRecordId);
      return applyInstagramReview(row, review?.review || review, now, instagramReviewGuards.some((g) => g.creator_id === row.sourceRecordId));
    }
    if (row.platform !== "youtube") return { ...row };
    const api = byKey.get(creatorIdentity(row));
    return api ? { ...row, audience: api.audience, audienceSource: api.audienceSource, audienceCheckedAt: api.audienceCheckedAt, lastActiveAt: api.lastActiveAt, activitySource: api.activitySource, activityCheckedAt: api.activityCheckedAt, apiSnapshot: { ...api.apiSnapshot, fieldNames: api.apiSnapshot.fieldNames.filter((name) => !["name", "creatorKey", "externalId", "profileUrl"].includes(name)), titleFromApi: false } } : { ...row };
  });
  const manualKeys = new Set(manual.map(creatorIdentity).filter(Boolean));
  for (const [key3, row] of byKey) if (!manualKeys.has(key3)) result.push(row);
  if (result.length > 5e3) fail6("SOURCES_INCOMPLETE", "\uD6C4\uBCF4 \uC6D0\uBCF8\uC758 \uC548\uC804 \uC870\uD68C \uD55C\uB3C4\uB97C \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.");
  return result;
}
function createDailySupply({ repository, sourceRepository, apiKey = "", projectId = "", enabled: enabled2 = false, fetchImpl = fetch, now = () => Date.now(), uuid: uuid3 = () => crypto.randomUUID(), sweepDownstream, executionRepository }) {
  async function status(owner) {
    const configurationReady = Boolean(apiKey && /^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId));
    return { enabled: enabled2, configurationReady, state: enabled2 ? configurationReady ? "ready" : "blocked" : "stopped", blockers: [...!apiKey ? ["existing_youtube_key_required"] : [], ...!/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId) ? ["existing_google_project_id_required"] : []], campaign: CAMPAIGN, recentActivityDays: 90, provisionalActivityWindow: true, audienceBounds: DAILY_OUTREACH.audienceBounds, targetUnit: DAILY_OUTREACH.targetUnit, targets: { youtube: 50, instagram: 10 }, quotaScope: "daily_supply_worker_only", quotaTimezone: "America/Los_Angeles", limits: SUPPLY_LIMITS, latest: await repository.latest(owner, CAMPAIGN), sendingEnabled: false, schedulerEnabled: false };
  }
  async function sourceCandidates(owner) {
    const [source2, snapshots, reviews, instagramReviews, instagramReviewGuards] = await Promise.all([sourceRepository.candidates(owner), repository.snapshots(owner, CAMPAIGN), repository.reviews ? repository.reviews(owner, CAMPAIGN) : [], repository.instagramReviews ? repository.instagramReviews(owner, CAMPAIGN) : [], repository.instagramReviewGuards ? repository.instagramReviewGuards(owner, CAMPAIGN) : []]);
    if (source2?.complete !== true || !Array.isArray(source2.candidates)) fail6("SOURCES_INCOMPLETE", "\uAE30\uC874 \uD6C4\uBCF4 \uC6D0\uBCF8\uC744 \uC644\uC804\uD558\uAC8C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    return { complete: true, candidates: mergeSupplyCandidates(source2.candidates, snapshots, now(), reviews, instagramReviews, instagramReviewGuards) };
  }
  async function listReview(owner, options = {}) {
    const source2 = await sourceRepository.reviewCandidates(owner, options);
    if (source2?.pageComplete !== true || !Array.isArray(source2.candidates) || source2.candidates.length > 50 || !source2.pagination) fail6("REVIEW_PAGE_INCOMPLETE", "\uAE30\uC874 \uD6C4\uBCF4 \uAC80\uD1A0 \uD398\uC774\uC9C0\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    const ids = source2.candidates.map((row) => row.sourceRecordId);
    const [snapshots, reviews, instagramReviews, instagramReviewGuards] = await Promise.all([repository.snapshots(owner, CAMPAIGN), repository.reviews ? repository.reviews(owner, CAMPAIGN) : [], repository.instagramReviews ? repository.instagramReviews(owner, CAMPAIGN, ids) : [], repository.instagramReviewGuards ? repository.instagramReviewGuards(owner, CAMPAIGN, ids) : []]);
    const youtube = snapshots.map((row) => ({ ...row, platform: "youtube", review: reviews.find((r) => r.creator_key === "youtube:" + (row.snapshot || row).channelId)?.review || null }));
    const instagram = source2.candidates.filter((row) => row.platform === "instagram" && row.existingDatabaseRecord === true).map((row) => {
      const review2 = instagramReviews.find((r) => (r.review || r).sourceRecordId === row.sourceRecordId)?.review || null;
      return { platform: "instagram", creator_key: creatorIdentity(row), creator_id: row.sourceRecordId, candidate: row, review: review2, reviewState: instagramReviewState(row, review2, now(), instagramReviewGuards.some((g) => g.creator_id === row.sourceRecordId)) };
    });
    return { source: "youtube_data_api", sources: ["youtube_data_api", "existing_instagram_database"], scope: "paged_native_instagram_and_current_youtube_snapshots", preparationEligibilityChecked: false, pagination: source2.pagination, requiresHumanReview: true, items: [...youtube, ...instagram], contactCollectionSupported: false };
  }
  async function review(owner, input) {
    if (!enabled2) fail6("DAILY_SUPPLY_DISABLED", "\uC77C\uC77C \uD6C4\uBCF4 \uADFC\uAC70 \uAC80\uD1A0\uB294 \uC544\uC9C1 \uC6B4\uC601 \uD65C\uC131\uD654 \uC804\uC785\uB2C8\uB2E4.");
    if (typeof input?.creatorKey === "string" && input.creatorKey.startsWith("instagram:")) {
      const source2 = executionRepository ? await executionRepository.instagramReviewSource(owner, input.creatorKey, input.sourceRecordId) : await sourceRepository.candidates(owner);
      if (source2?.complete !== true || !Array.isArray(source2.candidates)) fail6("SOURCES_INCOMPLETE", "\uAE30\uC874 \uD6C4\uBCF4 \uC6D0\uBCF8\uC744 \uC644\uC804\uD558\uAC8C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      const matched = source2.candidates.filter((row2) => row2.platform === "instagram" && row2.sourceRecordId === input.sourceRecordId && creatorIdentity(row2) === input.creatorKey);
      if (matched.length !== 1) fail6("INSTAGRAM_REVIEW_SOURCE_CHANGED", "\uAE30\uC874 Instagram \uD6C4\uBCF4\uB97C \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694.", 409);
      const evidence2 = validateInstagramReview(owner, input, matched[0], now());
      const saved2 = await repository.saveInstagramReview({ owner, campaign: CAMPAIGN, review: evidence2 });
      if (saved2?.saved !== true) fail6("INSTAGRAM_REVIEW_SAVE_UNCERTAIN", "\uADFC\uAC70 \uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.");
      return { ...saved2, platform: "instagram", sendingEnabled: false, reviewed: true, contactEvidenceReady: evidence2.contactEvidence.length > 0 };
    }
    const snapshots = executionRepository && repository.snapshot ? await repository.snapshot(owner, CAMPAIGN, input?.creatorKey) : await repository.snapshots(owner, CAMPAIGN), row = snapshots.find((r) => "youtube:" + (r.snapshot || r).channelId === input?.creatorKey);
    if (!row) fail6("SUPPLY_REVIEW_STALE", "\uAC80\uD1A0\uD560 \uCD5C\uC2E0 \uD6C4\uBCF4\uB97C \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694.", 409);
    const evidence = validateSupplyReview(owner, input, row.snapshot || row, now());
    const saved = await repository.saveReview({ owner, campaign: CAMPAIGN, review: evidence });
    if (saved?.saved !== true) fail6("SUPPLY_REVIEW_SAVE_UNCERTAIN", "\uADFC\uAC70 \uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.");
    return { ...saved, sendingEnabled: false, reviewed: true, contactEvidenceReady: evidence.contactEvidence.length > 0 };
  }
  async function sweepExpired() {
    const own = await repository.sweepExpired();
    return typeof sweepDownstream === "function" ? { ...own, downstream: await sweepDownstream() } : own;
  }
  async function run(owner) {
    if (!enabled2) fail6("DAILY_SUPPLY_DISABLED", "\uC77C\uC77C \uD6C4\uBCF4 \uC218\uC9D1\uC740 \uC544\uC9C1 \uC6B4\uC601 \uD65C\uC131\uD654 \uC804\uC785\uB2C8\uB2E4.");
    if (!apiKey || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(projectId)) fail6("DAILY_SUPPLY_NOT_CONFIGURED", "\uAE30\uC874 YouTube \uD0A4\uC640 \uB3D9\uC77C \uD504\uB85C\uC81D\uD2B8 \uD560\uB2F9\uB7C9 \uC2DD\uBCC4\uC790\uB97C \uD655\uC778\uD558\uC138\uC694.");
    const start = now(), day = outreachDay(start), token = uuid3();
    await sweepExpired();
    const claim = await repository.claim({ owner, campaign: CAMPAIGN, day, token });
    if (claim?.state === "completed" || claim?.state === "failed") return { ...claim.summary, state: claim.state, duplicate: true, newlyCollected: false };
    if (claim?.state === "busy") return { state: "busy", day, campaign: CAMPAIGN, newlyCollected: false, sendingEnabled: false };
    if (claim?.state !== "claimed") fail6("SUPPLY_CLAIM_UNCERTAIN", "\uC218\uC9D1 \uC2E4\uD589 \uC7A0\uAE08\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.");
    const context = { owner, campaign: CAMPAIGN, day, token };
    const quota = { searchCalls: claim.searchCalls || 0, readCalls: claim.readCalls || 0 };
    let cursor = continuationCursor(claim.cursor, start), staged = 0, examined = 0, skippedExisting = 0, excludedBounds = 0, unverifiedActivity = 0;
    const deadline = start + SUPPLY_LIMITS.timeoutMs;
    let source2, history;
    async function request(resource, params) {
      const search = resource === "search", kind = search ? "search" : "read";
      if (now() >= deadline) fail6("SUPPLY_TIMEOUT", "\uC774\uBC88 \uC218\uC9D1\uC758 \uC2DC\uAC04 \uC81C\uD55C\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4.");
      if (outreachDay(now()) !== day) fail6("SUPPLY_DAY_CHANGED", "\uD55C\uAD6D \uB0A0\uC9DC\uAC00 \uBC14\uB00C\uC5B4 \uC774\uBC88 \uC2E4\uD589\uC744 \uC885\uB8CC\uD588\uC2B5\uB2C8\uB2E4.");
      if ((search ? quota.searchCalls : quota.readCalls) >= (search ? SUPPLY_LIMITS.searchCalls : SUPPLY_LIMITS.readCalls)) fail6("SUPPLY_RUN_BUDGET", "\uC774\uBC88 \uC2E4\uD589\uC758 \uC870\uD68C \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4.");
      const reserved = await repository.reserve({ ...context, projectId, kind, requestId: uuid3() });
      if (reserved?.granted !== true) fail6(reserved?.code === "lease_lost" ? "SUPPLY_LEASE_LOST" : "SUPPLY_QUOTA_LIMIT", "\uD504\uB85C\uC81D\uD2B8 \uD560\uB2F9\uB7C9 \uB610\uB294 \uC2E4\uD589 \uC7A0\uAE08\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD574 \uC870\uD68C\uB97C \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4.");
      quota[search ? "searchCalls" : "readCalls"]++;
      const url = new URL("https://www.googleapis.com/youtube/v3/" + resource);
      for (const [key3, value] of Object.entries(params)) url.searchParams.set(key3, String(value));
      let response;
      try {
        response = await fetchImpl(url, { headers: { "X-Goog-Api-Key": apiKey }, redirect: "error", signal: AbortSignal.timeout(Math.min(8e3, Math.max(1, deadline - now()))) });
      } catch {
        fail6("SUPPLY_PROVIDER_UNCERTAIN", "YouTube \uC870\uD68C \uACB0\uACFC\uB97C \uBC1B\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC790\uB3D9 \uC7AC\uC2DC\uB3C4\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
      }
      let data;
      try {
        data = await response.json();
      } catch {
        fail6("SUPPLY_INVALID_RESPONSE", "YouTube \uC751\uB2F5\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      }
      if (!response.ok) {
        const reasons = data?.error?.errors?.map((e) => e.reason) || [];
        fail6(response.status === 429 || reasons.some((r) => ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(r)) ? "SUPPLY_PROVIDER_QUOTA" : "SUPPLY_PROVIDER_REJECTED", "YouTube \uC870\uD68C\uAC00 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uD0A4\uB97C \uBC14\uAFB8\uAC70\uB098 \uC790\uB3D9 \uC7AC\uC2DC\uB3C4\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
      }
      if (!data || !Array.isArray(data.items)) fail6("SUPPLY_INVALID_RESPONSE", "YouTube \uACB0\uACFC \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
      return data;
    }
    const summary = (state, code = null) => ({ state, day, campaign: CAMPAIGN, stagedYoutube: staged, examined, skippedExisting, excludedBounds, unverifiedActivity, targets: { youtube: 50, instagram: 10 }, youtubeResearchShortfall: Math.max(0, 50 - staged), contactReadyGuaranteed: false, quota, quotaScope: "daily_supply_worker_only", recentActivityDays: 90, provisionalActivityWindow: true, stopCode: code, sendingEnabled: false, schedulerEnabled: false });
    try {
      let excluded = /* @__PURE__ */ new Set();
      if (!executionRepository) {
        [source2, history] = await Promise.all([sourceRepository.candidates(owner), sourceRepository.history(owner)]);
        if (source2?.complete !== true || !Array.isArray(source2.candidates) || history?.complete !== true || !Array.isArray(history.creatorKeys)) fail6("SUPPLY_HISTORY_INCOMPLETE", "\uAE30\uC874 \uD6C4\uBCF4\xB7\uC5F0\uB77D \uC774\uB825\uC744 \uC644\uC804\uD558\uAC8C \uD655\uC778\uD558\uC9C0 \uBABB\uD574 \uC218\uC9D1\uC744 \uC911\uB2E8\uD588\uC2B5\uB2C8\uB2E4.");
        const snapshots = await repository.snapshots(owner, CAMPAIGN);
        excluded = new Set([...source2.candidates.map(creatorIdentity), ...history.creatorKeys, ...snapshots.map((r) => "youtube:" + (r.snapshot || r).channelId)].filter(Boolean));
      }
      async function checkExclusions(keys2) {
        if (!executionRepository) return;
        const checked = await executionRepository.exclusions(owner, keys2);
        if (checked?.complete !== true || !Array.isArray(checked.creatorKeys) || checked.creatorKeys.some((k) => !keys2.includes(k))) fail6("SUPPLY_HISTORY_INCOMPLETE", "\uC804\uCCB4 \uAE30\uC874 \uD6C4\uBCF4\xB7\uC5F0\uB77D \uC774\uB825\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        for (const key3 of checked.creatorKeys) excluded.add(key3);
      }
      const found = /* @__PURE__ */ new Map();
      while (quota.searchCalls < SUPPLY_LIMITS.searchCalls && found.size < SUPPLY_LIMITS.candidates) {
        const available = cursor.queries.map((s2, index2) => ({ s: s2, index: index2 })).filter(({ s: s2 }) => !s2.done);
        if (!available.length) break;
        const { s, index } = available.find((x) => x.index >= cursor.next) || available[0];
        const page = await request("search", { part: "snippet", type: "video", q: s.query, order: "date", maxResults: 50, relevanceLanguage: "ko", safeSearch: "strict", publishedAfter: new Date(Date.parse(cursor.anchor) - 90 * DAY4).toISOString(), fields: "nextPageToken,items(id/videoId,snippet(channelId,channelTitle,title,publishedAt))", ...s.pageToken ? { pageToken: s.pageToken } : {} });
        await checkExclusions([...new Set(page.items.slice(0, 50).map((item) => item?.snippet?.channelId).filter(channelIdValid).map((id) => "youtube:" + id))]);
        for (const item of page.items.slice(0, 50)) {
          const id = item?.snippet?.channelId;
          if (!channelIdValid(id) || !videoIdValid(item?.id?.videoId)) continue;
          if (excluded.has("youtube:" + id)) {
            skippedExisting++;
            continue;
          }
          if (!found.has(id) && found.size < SUPPLY_LIMITS.candidates) found.set(id, { id });
        }
        const next = typeof page.nextPageToken === "string" && page.nextPageToken.length <= 512 ? page.nextPageToken : null;
        s.done = !next || s.seenTokens.includes(next) || s.seenTokens.length >= 32;
        if (next) s.seenTokens.push(next);
        s.pageToken = next;
        cursor.next = (index + 1) % cursor.queries.length;
      }
      await checkExclusions([...found.keys()].map((id) => "youtube:" + id));
      for (const id of found.keys()) if (excluded.has("youtube:" + id)) {
        found.delete(id);
        skippedExisting++;
      }
      examined = found.size;
      const details = [];
      const ids = [...found.keys()];
      for (let offset = 0; offset < ids.length; offset += 50) {
        const page = await request("channels", { part: "snippet,statistics,contentDetails", id: ids.slice(offset, offset + 50).join(","), maxResults: 50, fields: "items(id,snippet/title,statistics(subscriberCount,hiddenSubscriberCount),contentDetails/relatedPlaylists/uploads)" });
        details.push(...page.items);
      }
      const stage = [], seenDetails = /* @__PURE__ */ new Set();
      for (const c of details) {
        if (!found.has(c?.id) || seenDetails.has(c.id)) continue;
        seenDetails.add(c.id);
        const count = c.statistics?.hiddenSubscriberCount ? null : publicCount(c.statistics?.subscriberCount);
        if (count === null || count < audienceBounds("youtube").minimum || count > audienceBounds("youtube").maximum) {
          excludedBounds++;
          continue;
        }
        const playlist = c.contentDetails?.relatedPlaylists?.uploads;
        if (!/^UU[A-Za-z0-9_-]{22}$/.test(playlist || "")) {
          unverifiedActivity++;
          continue;
        }
        const uploads = await request("playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: 5, fields: "items/contentDetails(videoId)" });
        const videoIds2 = [...new Set(uploads.items.map((v) => v?.contentDetails?.videoId).filter(videoIdValid))].slice(0, 5);
        if (!videoIds2.length) {
          unverifiedActivity++;
          continue;
        }
        stage.push({ channelId: c.id, title: publicText(c.snippet?.title, 150), url: "https://www.youtube.com/channel/" + c.id, subscriberCount: count, videoIds: videoIds2 });
      }
      const videoIds = [...new Set(stage.flatMap((c) => c.videoIds))], videos = /* @__PURE__ */ new Map();
      for (let offset = 0; offset < videoIds.length; offset += 50) {
        const page = await request("videos", { part: "snippet", id: videoIds.slice(offset, offset + 50).join(","), maxResults: 50, fields: "items(id,snippet(channelId,title,publishedAt))" });
        for (const video of page.items) if (videoIds.includes(video?.id)) videos.set(video.id, video);
      }
      const observedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + SUPPLY_LIMITS.snapshotDays * DAY4).toISOString();
      const rows = [];
      for (const c of stage) {
        const recentVideos = c.videoIds.map((id) => videos.get(id)).filter((v) => v?.snippet?.channelId === c.channelId && validDate(v.snippet.publishedAt) && Date.parse(v.snippet.publishedAt) <= now()).map((v) => ({ videoId: v.id, title: publicText(v.snippet.title, 200), url: "https://www.youtube.com/watch?v=" + v.id, publishedAt: v.snippet.publishedAt })).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
        if (!recentVideos.length || Date.parse(recentVideos[0].publishedAt) < now() - 90 * DAY4) {
          unverifiedActivity++;
          continue;
        }
        rows.push({ channelId: c.channelId, title: c.title, url: c.url, subscriberCount: c.subscriberCount, lastActiveAt: recentVideos[0].publishedAt, lastActivityUrl: recentVideos[0].url, recentVideos, observedAt, expiresAt, source: "youtube_data_api", reviewRequired: true });
      }
      await checkExclusions(rows.map((r) => "youtube:" + r.channelId));
      const finalRows = rows.filter((r) => !excluded.has("youtube:" + r.channelId));
      skippedExisting += rows.length - finalRows.length;
      staged = finalRows.length;
      let result;
      try {
        result = await repository.finish({ ...context, cursor, snapshots: finalRows, summary: summary("completed") });
      } catch {
        fail6("SUPPLY_SAVE_UNCERTAIN", "\uC218\uC9D1 \uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.");
      }
      if (result?.state !== "completed") fail6("SUPPLY_SAVE_UNCERTAIN", "\uC218\uC9D1 \uC800\uC7A5 \uACB0\uACFC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.");
      return { ...result, newlyCollected: true };
    } catch (error2) {
      const code = error2 instanceof OutreachError ? error2.code : "SUPPLY_UNAVAILABLE";
      if (code === "SUPPLY_SAVE_UNCERTAIN") throw error2;
      try {
        await repository.fail({ ...context, summary: summary("failed", code) });
      } catch {
      }
      throw error2 instanceof OutreachError ? error2 : new OutreachError("SUPPLY_UNAVAILABLE", "\uD6C4\uBCF4 \uC218\uC9D1\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.", 503);
    }
  }
  return { status, run, sourceCandidates, listReview, review, sweepExpired };
}

// supabase/functions/creator-daily-outreach/execution-repository.mjs
var fail7 = (code) => {
  throw new OutreachError(code, "\uD604\uC7AC \uD6C4\uBCF4 \uD398\uC774\uC9C0\uC640 \uC804\uCCB4 \uC911\uBCF5 \uC774\uB825\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", 503);
};
var key = (v) => typeof v === "string" && /^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(v);
function adaptExecutionEnvelope(owner, e, now = Date.now()) {
  if (!e || !key(e.creatorKey) || !["youtube", "instagram", "api"].includes(e.kind) || !Array.isArray(e.evidence) || e.evidence.length > 1 || e.native && e.native.owner !== owner || e.snapshot && e.snapshot.owner !== owner || e.evidence.some((r) => r.owner !== owner || r.creator_id !== e.native?.id)) fail7("EXECUTION_SOURCE_INVALID");
  const native = e.kind === "youtube" ? adaptYoutubeRecord(e.native) : e.kind === "instagram" ? adaptInstagramRecord(e.native, e.evidence) : null;
  if (e.kind !== "api" && (!native || creatorIdentity(native) !== e.creatorKey)) fail7("EXECUTION_SOURCE_CHANGED");
  const rows = mergeSupplyCandidates(native ? [native] : [], e.snapshot ? [e.snapshot] : [], now, e.review ? [{ review: e.review }] : [], e.instagramReview ? [{ review: e.instagramReview }] : [], e.instagramGuard ? [{ creator_id: e.native?.id }] : []);
  if (rows.length !== 1 || creatorIdentity(rows[0]) !== e.creatorKey) fail7("EXECUTION_SOURCE_CHANGED");
  return rows[0];
}
function createExecutionRepository(sb2, { now = () => Date.now() } = {}) {
  async function rpc(name, args) {
    let r;
    try {
      r = await sb2.rpc("sanji_daily_execution_" + name, args);
    } catch {
      fail7(name === "prepare_page" ? "SAVE_UNCERTAIN" : "EXECUTION_READ_FAILED");
    }
    if (r?.error) fail7(name === "prepare_page" ? "SAVE_UNCERTAIN" : "EXECUTION_READ_FAILED");
    return r?.data;
  }
  async function identityMatches(owner, inputs, includeSaved = false) {
    if (!Array.isArray(inputs) || inputs.length > 100 || inputs.some((r) => !key(r.creatorKey))) fail7("EXECUTION_IDENTITY_INVALID");
    if (!inputs.length) return { complete: true, scope: "all_saved_sanji_history", gmailProviderHistoryChecked: false, matches: [] };
    const result = await rpc("identities", { p_owner: owner, p_inputs: inputs, p_include_saved: includeSaved });
    if (result?.complete !== true || result.scope !== "all_saved_sanji_history" || result.gmailProviderHistoryChecked !== false || !Array.isArray(result.matches) || result.matches.length !== inputs.length || new Set(result.matches.map((r) => r.creatorKey)).size !== inputs.length || result.matches.some((r) => !inputs.some((i) => i.creatorKey === r.creatorKey) || typeof r.duplicateCreator !== "boolean" || typeof r.saved !== "boolean" || !Number.isSafeInteger(r.sourceCount) || r.sourceCount < 0 || !Array.isArray(r.emailKeys) || r.emailKeys.some((e) => emailIdentity(e) !== e))) fail7("EXECUTION_HISTORY_INCOMPLETE");
    return result;
  }
  return {
    async page(owner, { existing = null, previous = null } = {}) {
      const limits = { youtube: 50, instagram: 10 };
      const page = await rpc("page", { p_owner: owner, p_resume: (existing || previous)?.executionProgress || null, p_limits: limits, p_at: new Date(now()).toISOString(), p_restart: !existing });
      if (page?.complete !== true || page.scope !== "reviewable_sources" || !Array.isArray(page.rows) || page.rows.length > 60 || !Number.isSafeInteger(page.unreviewedInstagram) || page.unreviewedInstagram < 0) fail7("EXECUTION_PAGE_INCOMPLETE");
      for (const platform of ["youtube", "instagram"]) {
        const rows = page.rows.filter((r) => r.creatorKey?.startsWith(platform + ":"));
        let last = page.after?.[platform];
        if (typeof last !== "string" || !/^([a-f0-9]{32})$/.test(page.snapshot?.[platform] || "") || !Number.isSafeInteger(page.total?.[platform]) || typeof page.hasMore?.[platform] !== "boolean" || typeof page.exhausted?.[platform] !== "boolean" || !Number.isSafeInteger(page.counts?.[platform]) || page.counts[platform] < 0 || !Number.isSafeInteger(page.limits?.[platform]) || page.limits[platform] < 0 || page.limits[platform] > limits[platform] || rows.length > page.limits[platform]) fail7("EXECUTION_PAGE_INCOMPLETE");
        for (const row of rows) {
          if (typeof row.pageKey !== "string" || row.pageKey <= last) fail7("EXECUTION_PAGE_ORDER");
          last = row.pageKey;
        }
        if (last !== page.last?.[platform] || rows.length === 0 && page.hasMore?.[platform]) fail7("EXECUTION_PAGE_INCOMPLETE");
      }
      return { complete: true, page, candidates: page.rows.map((r) => adaptExecutionEnvelope(owner, r, now())), expected: existing?.executionProgress || null };
    },
    async current(owner, creatorKey, sourceRecordId = null) {
      if (!key(creatorKey)) fail7("EXECUTION_IDENTITY_INVALID");
      const result = await rpc("current", { p_owner: owner, p_creator_key: creatorKey, p_source_id: sourceRecordId });
      if (result?.complete !== true) fail7("EXECUTION_SOURCE_CHANGED");
      return { complete: true, candidates: [adaptExecutionEnvelope(owner, result.row, now())] };
    },
    // Review renewal uses only authoritative native identity/status/version.
    // Stale supplemental reviews and their anti-revival guards belong exclusively
    // to merged preparation/send reads and must not block a fresh human review.
    async instagramReviewSource(owner, creatorKey, sourceRecordId) {
      if (!key(creatorKey) || !creatorKey.startsWith("instagram:") || typeof sourceRecordId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sourceRecordId)) fail7("EXECUTION_IDENTITY_INVALID");
      const result = await rpc("instagram_source", { p_owner: owner, p_creator_key: creatorKey, p_source_id: sourceRecordId });
      if (result?.complete !== true || result.source !== "native_instagram_review" || result.creatorKey !== creatorKey || result.native?.owner !== owner || result.native?.id !== sourceRecordId) fail7("EXECUTION_SOURCE_CHANGED");
      const candidate = adaptInstagramRecord(result.native, []);
      if (creatorIdentity(candidate) !== creatorKey || !Number.isFinite(Date.parse(candidate.sourceRecordUpdated))) fail7("EXECUTION_SOURCE_CHANGED");
      return { complete: true, candidates: [candidate] };
    },
    async historyFor(owner, candidates) {
      const inputs = [...new Map(candidates.map((c) => [creatorIdentity(c), { creatorKey: creatorIdentity(c), sourceRecordId: c.sourceRecordId || null, emailKeys: [...new Set((c.contactEvidence || []).map((e) => emailIdentity(e.address)).filter(Boolean))].slice(0, 10) }])).values()];
      if (inputs.some((r) => candidates.filter((c) => creatorIdentity(c) === r.creatorKey).some((c) => (c.contactEvidence || []).filter((e) => emailIdentity(e.address)).length > 10))) fail7("EXECUTION_CONTACT_LIMIT");
      const result = await identityMatches(owner, inputs);
      return { complete: true, scope: result.scope, gmailProviderHistoryChecked: false, creatorKeys: result.matches.filter((r) => r.duplicateCreator || r.sourceCount > 1).map((r) => r.creatorKey), emailKeys: [...new Set(result.matches.flatMap((r) => r.emailKeys))] };
    },
    async exclusions(owner, creatorKeys) {
      const keys2 = [...new Set(creatorKeys)];
      const result = await identityMatches(owner, keys2.map((creatorKey) => ({ creatorKey, emailKeys: [] })), true);
      return { complete: true, creatorKeys: result.matches.filter((r) => r.saved || r.duplicateCreator).map((r) => r.creatorKey) };
    },
    async savePage(owner, plan, loaded) {
      return rpc("prepare_page", { p_owner: owner, p_day: plan.day, p_plan: plan, p_page: loaded.page, p_expected: loaded.expected });
    }
  };
}

// supabase/functions/creator-daily-outreach/supply-repository.mjs
var fail8 = (code) => {
  throw new OutreachError(code, "\uC77C\uC77C \uC218\uC9D1 \uC800\uC7A5\uC18C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
};
function createSupplyRepository(sb2) {
  async function rpc(name, args) {
    let result;
    try {
      result = await sb2.rpc(name, args);
    } catch {
      fail8("SUPPLY_STORE_UNCERTAIN");
    }
    if (result.error) fail8("SUPPLY_STORE_UNAVAILABLE");
    return result.data;
  }
  const params = (c) => ({ p_owner: c.owner, p_campaign: c.campaign, p_day: c.day, p_token: c.token });
  async function read(query) {
    const result = await query;
    if (result.error) fail8("SUPPLY_STORE_UNAVAILABLE");
    return result;
  }
  return {
    async snapshot(owner, campaign, creatorKey) {
      if (typeof creatorKey !== "string" || !/^youtube:UC[A-Za-z0-9_-]{22}$/.test(creatorKey)) fail8("SUPPLY_REVIEW_STALE");
      const r = await read(sb2.from("sanji_daily_supply_snapshots").select("owner,campaign,channel_id,snapshot,observed_at,expires_at").eq("owner", owner).eq("campaign", campaign).eq("channel_id", creatorKey.slice(8)).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).maybeSingle());
      return r.data ? [r.data] : [];
    },
    claim: (c) => rpc("sanji_daily_supply_claim", params(c)),
    reserve: (c) => rpc("sanji_daily_supply_reserve", { ...params(c), p_project: c.projectId, p_kind: c.kind, p_request: c.requestId }),
    // Treat all uncertain finishes specially. Never retry a write blindly.
    async finish(c) {
      try {
        return await rpc("sanji_daily_supply_finish", { ...params(c), p_cursor: c.cursor, p_snapshots: c.snapshots, p_summary: c.summary });
      } catch {
        fail8("SUPPLY_SAVE_UNCERTAIN");
      }
    },
    fail: (c) => rpc("sanji_daily_supply_fail", { ...params(c), p_summary: c.summary }),
    async sweepExpired() {
      const api = await rpc("sanji_daily_supply_sweep", {}), instagram = await rpc("sanji_daily_supply_instagram_sweep", {});
      return { ...api, ...instagram };
    },
    async saveInstagramReview(c) {
      try {
        return await rpc("sanji_daily_supply_instagram_review", { p_owner: c.owner, p_campaign: c.campaign, p_review: c.review });
      } catch {
        fail8("INSTAGRAM_REVIEW_SAVE_UNCERTAIN");
      }
    },
    async saveReview(c) {
      try {
        return await rpc("sanji_daily_supply_review", { p_owner: c.owner, p_campaign: c.campaign, p_review: c.review });
      } catch {
        fail8("SUPPLY_REVIEW_SAVE_UNCERTAIN");
      }
    },
    async reviews(owner, campaign) {
      const rows = [];
      let cursor = "", total = null;
      for (let page = 0; page < 100; page++) {
        let q = sb2.from("sanji_daily_supply_reviews").select("owner,campaign,creator_key,review,expires_at", { count: "exact" }).eq("owner", owner).eq("campaign", campaign).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).order("creator_key", { ascending: true }).limit(500);
        if (cursor) q = q.gt("creator_key", cursor);
        const r = await read(q);
        if (!Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count < r.data.length) fail8("SUPPLY_REVIEWS_INCOMPLETE");
        if (total === null) total = r.count;
        if (total > 5e3 || rows.length + r.count !== total) fail8("SUPPLY_REVIEWS_CHANGED");
        for (const row of r.data) {
          if (row.owner !== owner || row.campaign !== campaign || typeof row.creator_key !== "string" || row.creator_key <= cursor) fail8("SUPPLY_REVIEWS_INCOMPLETE");
          rows.push(row);
          cursor = row.creator_key;
        }
        if (rows.length === total) return rows;
        if (!r.data.length) break;
      }
      fail8("SUPPLY_REVIEWS_INCOMPLETE");
    },
    async instagramReviews(owner, campaign, creatorIds) {
      if (creatorIds !== void 0 && (!Array.isArray(creatorIds) || creatorIds.length > 50 || creatorIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)))) fail8("INSTAGRAM_REVIEW_PAGE_INVALID");
      if (creatorIds?.length === 0) return [];
      const rows = [];
      let cursor = "", total = null;
      for (let page = 0; page < 100; page++) {
        let q = sb2.from("sanji_daily_supply_instagram_reviews").select("owner,campaign,creator_id,source_updated,creator_key,review,expires_at", { count: "exact" }).eq("owner", owner).eq("campaign", campaign).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).order("creator_id", { ascending: true }).limit(500);
        if (creatorIds) q = q.in("creator_id", creatorIds);
        if (cursor) q = q.gt("creator_id", cursor);
        const r = await read(q);
        if (!Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count < r.data.length) fail8("INSTAGRAM_REVIEWS_INCOMPLETE");
        if (total === null) total = r.count;
        if (total > 5e3 || rows.length + r.count !== total) fail8("INSTAGRAM_REVIEWS_CHANGED");
        for (const row of r.data) {
          if (row.owner !== owner || row.campaign !== campaign || typeof row.creator_id !== "string" || row.creator_id <= cursor || creatorIds && !creatorIds.includes(row.creator_id)) fail8("INSTAGRAM_REVIEWS_INCOMPLETE");
          rows.push(row);
          cursor = row.creator_id;
        }
        if (rows.length === total) return rows;
        if (!r.data.length) break;
      }
      fail8("INSTAGRAM_REVIEWS_INCOMPLETE");
    },
    async instagramReviewGuards(owner, campaign, creatorIds) {
      if (creatorIds !== void 0 && (!Array.isArray(creatorIds) || creatorIds.length > 50 || creatorIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)))) fail8("INSTAGRAM_REVIEW_PAGE_INVALID");
      if (creatorIds?.length === 0) return [];
      const rows = [];
      let cursor = "", total = null;
      for (let page = 0; page < 100; page++) {
        let q = sb2.from("sanji_daily_supply_instagram_review_guards").select("owner,campaign,creator_id,last_reviewed_at", { count: "exact" }).eq("owner", owner).eq("campaign", campaign).order("creator_id", { ascending: true }).limit(500);
        if (creatorIds) q = q.in("creator_id", creatorIds);
        if (cursor) q = q.gt("creator_id", cursor);
        const r = await read(q);
        if (!Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count < r.data.length) fail8("INSTAGRAM_REVIEW_GUARDS_INCOMPLETE");
        if (total === null) total = r.count;
        if (total > 5e3 || rows.length + r.count !== total) fail8("INSTAGRAM_REVIEW_GUARDS_CHANGED");
        for (const row of r.data) {
          if (row.owner !== owner || row.campaign !== campaign || typeof row.creator_id !== "string" || row.creator_id <= cursor || creatorIds && !creatorIds.includes(row.creator_id)) fail8("INSTAGRAM_REVIEW_GUARDS_INCOMPLETE");
          rows.push(row);
          cursor = row.creator_id;
        }
        if (rows.length === total) return rows;
        if (!r.data.length) break;
      }
      fail8("INSTAGRAM_REVIEW_GUARDS_INCOMPLETE");
    },
    async latest(owner, campaign) {
      const r = await read(sb2.from("sanji_daily_supply_runs").select("day,state,summary,lease_expires_at,search_calls,read_calls").eq("owner", owner).eq("campaign", campaign).order("day", { ascending: false }).limit(1));
      return r.data?.[0] || null;
    },
    async snapshots(owner, campaign) {
      const rows = [];
      let cursor = "", total = null;
      for (let page = 0; page < 100; page++) {
        let q = sb2.from("sanji_daily_supply_snapshots").select("owner,campaign,channel_id,snapshot,observed_at,expires_at", { count: "exact" }).eq("owner", owner).eq("campaign", campaign).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).order("channel_id", { ascending: true }).limit(500);
        if (cursor) q = q.gt("channel_id", cursor);
        const r = await read(q);
        if (!Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count < r.data.length) fail8("SUPPLY_SNAPSHOTS_INCOMPLETE");
        if (total === null) total = r.count;
        if (total > 5e3 || rows.length + r.count !== total) fail8("SUPPLY_SNAPSHOTS_CHANGED");
        for (const row of r.data) {
          if (row.owner !== owner || row.campaign !== campaign || typeof row.channel_id !== "string" || row.channel_id <= cursor) fail8("SUPPLY_SNAPSHOTS_INCOMPLETE");
          rows.push(row);
          cursor = row.channel_id;
        }
        if (rows.length === total) return rows;
        if (!r.data.length) break;
      }
      fail8("SUPPLY_SNAPSHOTS_INCOMPLETE");
    }
  };
}

// supabase/functions/creator-daily-outreach/contact-enrichment-network.mjs
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
var ContactNetworkError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};
var reject = (code) => {
  throw new ContactNetworkError(code);
};
var forbidden = /(^|\.)(?:localhost|local|internal|test|invalid|onion|youtube\.com|youtube-nocookie\.com|youtu\.be|google\.com|googleapis\.com|googleusercontent\.com|instagram\.com|facebook\.com|fb\.com|meta\.com|tiktok\.com)$/i;
function publicOfficialUrl(value) {
  if (typeof value !== "string" || value.length > 1e3 || /[\s\\\x00-\x1f\x7f]/.test(value)) reject("source_url_invalid");
  let u;
  try {
    u = new URL(value);
  } catch {
    reject("source_url_invalid");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash || isIP(u.hostname) || forbidden.test(u.hostname) || !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname) || u.href !== value) reject("source_url_invalid");
  return u.href;
}
function publicIpv4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(value === "168.63.129.16" || a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && c <= 2 || b === 88 && c === 99 || b === 175 && c === 48 || b === 52 && c === 193 || b === 31 && c === 196) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
function createPinnedPublicReader({ lookup = dnsLookup, request = httpsRequest } = {}) {
  return { async read(url, { timeoutMs = 8e3, maxBytes = 262144, signal } = {}) {
    publicOfficialUrl(url);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8e3 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144) reject("network_limits_invalid");
    const u = new URL(url), controller = new AbortController();
    let req, timer;
    const abort = () => controller.abort(new ContactNetworkError("source_timeout"));
    if (signal?.aborted) reject("source_timeout");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await new Promise((resolve, rejectPromise) => {
        const fail17 = (error2) => {
          controller.abort(error2);
          req?.destroy();
          rejectPromise(error2 instanceof ContactNetworkError ? error2 : new ContactNetworkError("source_unavailable"));
        };
        controller.signal.addEventListener("abort", () => {
          req?.destroy();
          rejectPromise(controller.signal.reason || new ContactNetworkError("source_timeout"));
        }, { once: true });
        timer = setTimeout(abort, timeoutMs);
        Promise.resolve().then(() => lookup(u.hostname, { all: true, family: 4, verbatim: true })).then((addresses) => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32 || addresses.some((a) => a.family !== 4 || !publicIpv4(a.address))) return fail17(new ContactNetworkError("source_dns_not_public"));
          const address = addresses[0].address;
          req = request({
            protocol: "https:",
            hostname: address,
            port: 443,
            servername: u.hostname,
            path: u.pathname,
            method: "GET",
            agent: false,
            rejectUnauthorized: true,
            maxHeaderSize: 16384,
            headers: { Host: u.hostname, Accept: "text/html, text/plain;q=0.8", "Accept-Encoding": "identity", "User-Agent": "SanjiPublicContactReview/1.0" }
          }, (res) => {
            const code = res.statusCode;
            if (code === 404 || code === 410) {
              res.destroy();
              return fail17(new ContactNetworkError("source_removed"));
            }
            if (code >= 300 && code < 400) {
              res.destroy();
              return fail17(new ContactNetworkError("source_redirect_denied"));
            }
            if (code !== 200) {
              res.destroy();
              return fail17(new ContactNetworkError(code === 401 || code === 403 || code === 429 ? "source_access_denied" : "source_unavailable"));
            }
            const type = String(res.headers["content-type"] || "").toLowerCase(), encoding = String(res.headers["content-encoding"] || "identity").toLowerCase();
            if (!/^(text\/html|text\/plain)(?:\s*;\s*charset=(?:utf-8|"utf-8"|us-ascii))?\s*$/.test(type) || encoding !== "identity") {
              res.destroy();
              return fail17(new ContactNetworkError("source_content_type_unsupported"));
            }
            const declared = res.headers["content-length"];
            if (declared !== void 0 && (!/^\d+$/.test(String(declared)) || Number(declared) > maxBytes)) {
              res.destroy();
              return fail17(new ContactNetworkError("source_too_large"));
            }
            let bytes = 0;
            const chunks = [];
            res.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > maxBytes) {
                res.destroy();
                return fail17(new ContactNetworkError("source_too_large"));
              }
              chunks.push(chunk);
            });
            res.on("aborted", () => fail17(new ContactNetworkError("source_unavailable")));
            res.on("error", fail17);
            res.on("end", () => {
              if (controller.signal.aborted) return;
              try {
                resolve({ url, contentType: type.split(";")[0].trim(), text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), bytes });
              } catch {
                fail17(new ContactNetworkError("source_encoding_invalid"));
              }
            });
          });
          req.on("error", fail17);
          req.on("socket", (socket) => socket.once("secureConnect", () => {
            if (socket.remoteAddress !== address) fail17(new ContactNetworkError("source_peer_mismatch"));
          }));
          req.end();
        }).catch(fail17);
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  } };
}

// supabase/functions/creator-daily-outreach/contact-enrichment.mjs
var CONTACT_ENRICHMENT = Object.freeze({ enabled: false, maxCandidates: 5e3, maxSourcesPerCreator: 3, maxRequests: 120, maxHostRequests: 5, maxBytes: 262144, requestMs: 8e3, totalMs: 9e4, reviewDays: 7 });
var DAY5 = 864e5;
var ownerValid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
var text = (v) => typeof v === "string" ? v.trim() : "";
var business = /협업|협찬|광고|제휴|사업|비즈니스|비지니스|business|partnership|commercial|advertis|campaign|collab|sponsor/i;
var unrelated = /개인정보|개인\s*연락|채용|입사|고객\s*(?:센터|지원)|팬\s*(?:레터|메일)|privacy|personal|recruit|career|support|customer|fan\s*mail|data\s*protection|not\s+(?:for\s+)?(?:business|commercial|advertis|collab)|no\s+(?:business|commercial|advertis|collab)|(?:협업|광고|사업|제휴).{0,30}(?:거절|금지|받지|불가|아닙|아님|제외)/i;
var emailPattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
var ContactEnrichmentError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 503;
  }
};
var fail9 = (code) => {
  throw new ContactEnrichmentError(code);
};
function exactBioUrl(value, key3) {
  try {
    const u = new URL(value);
    return key3.startsWith("instagram:") && ["https://www.instagram.com/" + key3.slice(10) + "/", "https://instagram.com/" + key3.slice(10) + "/"].includes(u.href) && u.href === value;
  } catch {
    return false;
  }
}
function sourceReviewReason(source2, owner, key3, now) {
  if (!source2 || source2.owner !== owner || source2.creatorKey !== key3 || !ownerValid(source2.sourceId) || !Number.isSafeInteger(source2.revision) || source2.revision < 1) return "source_identity_invalid";
  if (source2.state !== "reviewed") return source2.state === "revoked" ? "source_review_revoked" : "source_review_required";
  if (!["official_website", "instagram_public_bio"].includes(source2.sourceKind)) return "source_kind_not_supported";
  try {
    if (source2.sourceKind === "official_website") publicOfficialUrl(source2.sourceUrl);
    else if (!exactBioUrl(source2.sourceUrl, key3)) return "source_url_invalid";
  } catch {
    return "source_url_invalid";
  }
  const link = source2.storedLink, policy = source2.policyReview, a = source2.affiliation;
  if (!link || link.creatorKey !== key3 || link.url !== source2.sourceUrl || !text(link.sourceRecordId) || !sourceUrl(link.sourceUrl) || !text(link.sourceText) || !text(link.reviewedBy) || !fresh(link.checkedAt, now, 30)) return "stored_official_link_required";
  if (!policy || policy.decision !== (source2.sourceKind === "official_website" ? "allow_public_get" : "allow_existing_official_bio") || !text(policy.reviewedBy) || !fresh(policy.reviewedAt, now, 7) || !Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) <= now || Date.parse(policy.expiresAt) > Date.parse(policy.reviewedAt) + 7 * DAY5 || policy.exactUrl !== source2.sourceUrl || policy.noLoginOrChallenge !== true || policy.noAccessRestriction !== true || policy.maxRequestsPerDay !== 1) return "source_policy_review_required";
  if (!sourceUrl(policy.termsUrl) || !text(policy.termsExcerpt) || !sourceUrl(policy.robotsUrl) || !text(policy.robotsExcerpt) || !text(policy.accessRationale)) return "source_policy_review_required";
  if (source2.sourceKind === "official_website" && policy.robotsUrl !== new URL(source2.sourceUrl).origin + "/robots.txt") return "source_policy_review_required";
  if (!a || a.verified !== true || a.independentlyVerified !== true || a.creatorKey !== key3 || a.officialUrl !== source2.sourceUrl || a.method !== "manual_cross_reference" || !text(a.reviewedBy) || !sourceUrl(a.sourceUrl) || !text(a.sourceText).includes(key3.slice(key3.indexOf(":") + 1)) || !fresh(a.checkedAt, now, 30)) return "contact_creator_affiliation_required";
  return null;
}
function parsePublicBusinessPublication(input, { contentType = "text/plain" } = {}) {
  if (typeof input !== "string" || new TextEncoder().encode(input).length > 262144) return { status: "source_too_large" };
  if (/captcha|unusual traffic|access denied|보안\s*확인|자동\s*접근.{0,20}(?:금지|차단)|robots\s+denied/i.test(input)) return { status: "source_access_denied" };
  let visible = input;
  if (contentType === "text/html") {
    visible = visible.replace(/<!--[\s\S]*?-->/g, "");
    if (/<!--|<!\[|<\?|<![^>]*(?!doctype)/i.test(visible.replace(/<!doctype\s+html\s*>/gi, ""))) return { status: "source_render_review_required" };
    visible = visible.replace(/<!doctype\s+html\s*>/gi, "");
    const tag = /<[^>]*>/g;
    for (const match2 of visible.matchAll(tag)) {
      if (!/^<\/?(?:html|head|body|main|section|article|div|p|span|h[1-6]|ul|ol|li|strong|b|em|i|br|hr)\s*\/?>$/i.test(match2[0]) && !/^<a\s+href\s*=\s*(?:"[^"<>]*"|'[^'<>]*')\s*>$/i.test(match2[0]) && !/^<\/a\s*>$/i.test(match2[0])) return { status: "source_render_review_required" };
    }
    visible = visible.replace(/<head>[\s\S]*?<\/head>/gi, "").replace(/<(?:br|hr|\/p|\/div|\/li|\/section|\/article|\/h[1-6])\s*\/?>/gi, "\n").replace(tag, " ");
    if (/[<>]/.test(visible)) return { status: "source_render_review_required" };
    visible = visible.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&");
  } else if (contentType !== "text/plain") return { status: "source_content_type_unsupported" };
  const lines = visible.split(/\r?\n/).map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean), found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], emails = [...new Set((line.match(emailPattern) || []).map((v) => v.toLowerCase()))];
    if (!emails.length) continue;
    const context = business.test(line.replace(emailPattern, "")) ? line : lines[i - 1] && business.test(lines[i - 1].replace(emailPattern, "")) ? lines[i - 1] + " " + line : line;
    if (!business.test(context.replace(emailPattern, "")) || unrelated.test(context)) continue;
    for (const address of emails) if (emailIdentity(address) && !/(?:privacy|abuse|noreply|no-reply|support|careers|recruit|legal)@/.test(address)) found.push({ address, sourceText: context });
  }
  const unique = [...new Set(found.map((v) => v.address))];
  if (unique.length > 1) return { status: "ambiguous_public_email" };
  if (!unique.length) return { status: "public_email_not_present" };
  const match = found.find((v) => v.address === unique[0]);
  if (match.sourceText.length > 4e3 || (match.sourceText.match(emailPattern) || []).some((v) => v.toLowerCase() !== match.address)) return { status: "ambiguous_public_email" };
  return { status: "publication_verified", ...match };
}
var versionRefs = (sources) => sources.map((s) => ({ sourceId: s.sourceId, revision: s.revision })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
var same = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify(a.map((s) => ({ sourceId: s.sourceId, revision: s.revision })).sort((x, y) => String(x.sourceId).localeCompare(String(y.sourceId)))) === JSON.stringify(b.map((s) => ({ sourceId: s.sourceId, revision: s.revision })).sort((x, y) => String(x.sourceId).localeCompare(String(y.sourceId))));
var minimalAffiliation = (a) => ({ verified: true, creatorKey: a.creatorKey, sourceUrl: a.sourceUrl, sourceText: a.sourceText, checkedAt: a.checkedAt });
function evidenceFor(source2, result, checkedAt) {
  return { creatorKey: source2.creatorKey, address: result.address || "", sourceUrl: source2.sourceUrl, sourceText: result.sourceText || "", checkedAt, verified: result.status === "publication_verified", purpose: "business_collaboration", accessMethod: "public_source_review", sourceKind: source2.sourceKind, affiliation: source2.affiliation ? minimalAffiliation(source2.affiliation) : null, ambiguous: result.status === "ambiguous_public_email", enrichment: { sourceId: source2.sourceId, revision: source2.revision, status: result.status, publicationEvidenceOnly: true } };
}
function overlay(candidate, evidence) {
  return { ...candidate, contactEvidence: [...Array.isArray(candidate.contactEvidence) ? candidate.contactEvidence : [], ...evidence ? [evidence] : []] };
}
function applyReviewedName(candidate, sources, owner, key3, now) {
  if (!profileMatches(candidate, candidate.profileUrl)) return candidate;
  const names = sources.filter((s) => !sourceReviewReason(s, owner, key3, now)).map((s) => s.displayNameEvidence).filter((e) => {
    if (!e || e.creatorKey !== key3 || e.verified !== true || e.independentlyVerified !== true || !text(e.reviewedBy) || !["official_website", "provided_by_creator"].includes(e.kind) || !text(e.name) || e.name.length > 150 || /[\r\n\[\]{}<>]/.test(e.name) || !text(e.sourceText).includes(e.name) || !e.sourceText.includes(key3.slice(key3.indexOf(":") + 1)) || !fresh(e.checkedAt, now, 29)) return false;
    try {
      return Boolean(publicOfficialUrl(e.sourceUrl));
    } catch {
      return false;
    }
  });
  if (!names.length || new Set(names.map((e) => e.name)).size !== 1) return candidate;
  const latest = names.sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  if (candidate.displayNameEvidence?.verified === true && candidate.displayNameEvidence.name === candidate.name && fresh(candidate.displayNameEvidence.checkedAt, now, 29)) return latest.name === candidate.name ? candidate : { ...candidate, displayNameReviewRequired: true };
  if (candidate.sourceRecordId && latest.name !== candidate.name) return { ...candidate, displayNameReviewRequired: true };
  const { name, sourceUrl: sourceUrl2, sourceText, checkedAt, kind } = latest;
  return { ...candidate, name, displayNameEvidence: { name, sourceUrl: sourceUrl2, sourceText, checkedAt, kind, verified: true, creatorKey: key3, profileUrl: candidate.profileUrl } };
}
function createContactEnrichment({ repository, network, enabled: enabled2 = false, now = () => Date.now(), limits = {} } = {}) {
  const cap = { ...CONTACT_ENRICHMENT, ...limits };
  for (const k of ["maxCandidates", "maxSourcesPerCreator", "maxRequests", "maxHostRequests", "maxBytes", "requestMs", "totalMs"]) if (!Number.isInteger(cap[k]) || cap[k] < 1 || cap[k] > CONTACT_ENRICHMENT[k]) fail9("contact_limits_invalid");
  return { async enrich(owner, { candidates } = {}) {
    if (!ownerValid(owner) || !Array.isArray(candidates) || candidates.length > cap.maxCandidates) fail9("contact_input_invalid");
    const result = { complete: true, candidates: candidates.map((c) => ({ ...c, contactEvidence: [...c.contactEvidence || []] })), observations: [], counts: { verified: 0, held: 0, requests: 0, cached: 0 }, reasons: {}, publicationEvidenceOnly: true, sendingEnabled: false, recipientBasisApproved: false };
    const addReason = (reason) => result.reasons[reason] = (result.reasons[reason] || 0) + 1;
    if (enabled2 !== true) {
      addReason("contact_enrichment_disabled");
      return result;
    }
    if (!repository?.load || !repository?.appendObservation || !repository?.reserveSource) fail9("contact_repository_required");
    const start = now(), keys2 = [...new Set(candidates.map(creatorIdentity).filter(Boolean))], loaded = await repository.load(owner, keys2);
    if (loaded?.complete !== true || !Array.isArray(loaded.sources) || !Array.isArray(loaded.observations) || !Array.isArray(loaded.bios)) fail9("contact_sources_incomplete");
    if (loaded.sources.some((s) => s.owner !== owner || !keys2.includes(s.creatorKey)) || loaded.observations.some((s) => s.owner !== owner || !keys2.includes(s.creatorKey)) || loaded.bios.some((s) => s.owner !== owner || !keys2.includes(s.creatorKey))) fail9("contact_source_owner_mismatch");
    const byCreator = /* @__PURE__ */ new Map(), processed = /* @__PURE__ */ new Map(), hostCounts = /* @__PURE__ */ new Map();
    for (const s of loaded.sources) {
      const list = byCreator.get(s.creatorKey) || [];
      if (list.some((x) => x.sourceId === s.sourceId)) fail9("contact_source_versions_ambiguous");
      list.push(s);
      byCreator.set(s.creatorKey, list);
    }
    for (let index = 0; index < candidates.length; index++) {
      let candidate = candidates[index];
      const key3 = creatorIdentity(candidate);
      if (!key3) {
        addReason("creator_identity_required");
        continue;
      }
      if (processed.has(key3)) {
        result.candidates[index] = overlay(candidate, processed.get(key3));
        continue;
      }
      const sources = (byCreator.get(key3) || []).sort((a, b) => a.sourceId.localeCompare(b.sourceId)), at = now(), refs = versionRefs(sources);
      if (!sources.length) {
        addReason("no_reviewed_official_source");
        result.counts.held++;
        processed.set(key3, null);
        continue;
      }
      if (key3.startsWith("instagram:") && candidate.existingDatabaseRecord !== true) fail9("existing_instagram_record_required");
      candidate = applyReviewedName(candidate, sources, owner, key3, at);
      result.candidates[index] = candidate;
      const prior = loaded.observations.filter((o) => o.creatorKey === key3).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
      const blockedSources = (Array.isArray(prior?.blockedSources) ? prior.blockedSources : []).filter((b) => sources.some((s) => s.sourceId === b.sourceId && s.revision === b.revision));
      const allReviewed = sources.every((s) => !sourceReviewReason(s, owner, key3, at));
      if (prior && blockedSources.length) {
        const e2 = prior.evidence;
        processed.set(key3, e2);
        result.candidates[index] = overlay(candidate, e2);
        result.observations.push(prior);
        result.counts.held++;
        addReason("source_access_review_required");
        continue;
      }
      if (prior && allReviewed && sources.every((s) => s.sourceKind === "official_website") && same(prior.sourceVersions, refs) && Date.parse(prior.validUntil) > at && fresh(prior.recordedAt, at, 1)) {
        const e2 = prior.evidence;
        processed.set(key3, e2);
        result.candidates[index] = overlay(candidate, e2);
        result.observations.push(prior);
        result.counts.cached++;
        result.counts[e2?.verified ? "verified" : "held"]++;
        if (!e2?.verified) addReason(prior.status);
        continue;
      }
      let status = sources.length > cap.maxSourcesPerCreator ? "source_count_review_required" : null;
      const findings = [];
      if (!status) for (const source3 of sources) {
        const reviewReason = sourceReviewReason(source3, owner, key3, now());
        if (reviewReason) {
          status = reviewReason;
          break;
        }
        if (now() - start >= cap.totalMs) {
          status = "contact_time_budget_exhausted";
          break;
        }
        if (source3.sourceKind === "instagram_public_bio") {
          const bios = loaded.bios.filter((b) => b.creatorKey === key3 && b.sourceUrl === source3.sourceUrl).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
          const bio = bios[0];
          if (!bio || !fresh(bio.checkedAt, now(), 7) || bio.sourceProvider !== "instagram_official" && bio.sourceProvider !== "instagram_public" || !["business_discovery", "manual_public_bio"].includes(bio.sourceRef) || typeof bio.text !== "string" || bio.contentAvailable !== true) {
            status = "fresh_instagram_bio_required";
            break;
          }
          if (bios.some((b) => b.checkedAt === bio.checkedAt && b.text !== bio.text)) {
            status = "ambiguous_instagram_bio";
            break;
          }
          const parsed2 = parsePublicBusinessPublication(bio.text);
          findings.push({ source: source3, parsed: parsed2, checkedAt: bio.checkedAt });
          if (parsed2.status !== "publication_verified") {
            status = parsed2.status;
            break;
          }
          continue;
        }
        if (!network?.read) {
          status = "pinned_public_reader_required";
          break;
        }
        const host = new URL(source3.sourceUrl).hostname;
        if (result.counts.requests >= cap.maxRequests || (hostCounts.get(host) || 0) >= cap.maxHostRequests) {
          status = "contact_request_budget_exhausted";
          break;
        }
        const reserved = await repository.reserveSource(owner, { creatorKey: key3, sourceId: source3.sourceId, revision: source3.revision });
        if (reserved?.reserved !== true) {
          status = reserved?.reason === "source_changed" ? "source_changed" : "source_daily_budget_used";
          break;
        }
        result.counts.requests++;
        hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
        let parsed;
        const observedAt = new Date(now()).toISOString();
        try {
          const page = await network.read(source3.sourceUrl, { timeoutMs: Math.min(cap.requestMs, Math.max(1, cap.totalMs - (now() - start))), maxBytes: cap.maxBytes });
          if (page?.url !== source3.sourceUrl) parsed = { status: "source_redirect_denied" };
          else if (typeof page.text !== "string" || new TextEncoder().encode(page.text).length > cap.maxBytes) parsed = { status: "source_too_large" };
          else parsed = parsePublicBusinessPublication(page.text, { contentType: page.contentType });
        } catch (error2) {
          parsed = { status: /^source_[a-z_]+$/.test(error2?.code || "") ? error2.code : "source_unavailable" };
        }
        findings.push({ source: source3, parsed, checkedAt: observedAt });
        if (["source_access_denied", "source_redirect_denied"].includes(parsed.status)) blockedSources.push({ sourceId: source3.sourceId, revision: source3.revision, reason: parsed.status });
        if (parsed.status !== "publication_verified") {
          status = parsed.status;
          break;
        }
      }
      if (!status && new Set(findings.map((f) => f.parsed.address)).size !== 1) status = "ambiguous_public_email";
      status = status || "publication_verified";
      const selected = findings.find((f) => f.parsed.status === "publication_verified") || findings[0], source2 = selected?.source || sources[0];
      const checkedAt = status === "publication_verified" ? selected.checkedAt : new Date(now()).toISOString();
      const e = evidenceFor(source2, status === "publication_verified" ? selected.parsed : { status }, checkedAt);
      const recordedAt = new Date(now()).toISOString(), dayEnd = new Date(recordedAt);
      dayEnd.setUTCHours(15, 0, 0, 0);
      if (dayEnd.getTime() <= Date.parse(recordedAt)) dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const validUntil = new Date(Math.min(dayEnd.getTime(), ...sources.map((s) => Date.parse(s.policyReview?.expiresAt) || Date.parse(recordedAt)), ...findings.filter((f) => f.source.sourceKind === "instagram_public_bio").map((f) => Date.parse(f.checkedAt) + 7 * DAY5))).toISOString();
      const observation = { owner, creatorKey: key3, status, evidence: e, sourceVersions: refs, blockedSources, recordedAt, validUntil, publicationEvidenceOnly: true };
      const saved = await repository.appendObservation(owner, observation);
      if (saved?.saved !== true) fail9("contact_observation_not_saved");
      processed.set(key3, e);
      result.candidates[index] = overlay(candidate, e);
      result.observations.push(observation);
      result.counts[e.verified ? "verified" : "held"]++;
      if (!e.verified) addReason(status);
    }
    return result;
  } };
}

// supabase/functions/creator-daily-outreach/contact-enrichment-repository.mjs
var fail10 = (code) => {
  throw new ContactEnrichmentError(code);
};
var uuid2 = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
var key2 = (value) => typeof value === "string" && /^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value);
var source = (row) => ({ owner: row.owner, sourceId: row.source_id, revision: row.revision, creatorKey: row.creator_key, sourceUrl: row.source_url, sourceKind: row.source_kind, state: row.state, storedLink: row.stored_link, policyReview: row.policy_review, affiliation: row.affiliation, displayNameEvidence: row.display_name_evidence });
function createContactEnrichmentRepository(sb2) {
  async function rpc(name, args) {
    const r = await sb2.rpc(name, args);
    if (r?.error) fail10("contact_repository_failed");
    return r?.data;
  }
  return {
    async listRegisteredSources(owner, { cursor = null } = {}) {
      const page = await readReviewPage(sb2, { table: "sanji_contact_source_versions", owner, key: "source_id", columns: "owner,source_id,revision", scope: "registered_contact_sources", cursor, pageSize: 20, filter: (q) => q.eq("revision", 1) });
      if (page.rows.some((row) => row.revision !== 1)) fail10("contact_sources_incomplete");
      const latest = async () => Promise.all(page.rows.map(async (row) => {
        const r = await sb2.from("sanji_contact_source_versions").select("owner,source_id,revision,creator_key,source_url,source_kind,state,stored_link,policy_review,affiliation,display_name_evidence", { count: "exact" }).eq("owner", owner).eq("source_id", row.source_id).order("revision", { ascending: false }).limit(1);
        const current = r.data?.[0];
        if (r.error || !Array.isArray(r.data) || r.data.length !== 1 || !Number.isSafeInteger(r.count) || r.count < 1 || current.owner !== owner || current.source_id !== row.source_id || !Number.isSafeInteger(current.revision) || current.revision < 1 || !key2(current.creator_key)) fail10("contact_sources_incomplete");
        return source(current);
      }));
      const items = await latest(), check = await latest();
      if (JSON.stringify(items) !== JSON.stringify(check)) fail10("contact_sources_changed");
      return { scope: "registered_contact_sources", items, pagination: page.pagination, registrationEnabled: true, approvalEnabled: false };
    },
    async load(owner, creatorKeys) {
      if (!uuid2(owner) || !Array.isArray(creatorKeys) || creatorKeys.length > 5e3 || creatorKeys.some((k) => !key2(k))) fail10("contact_input_invalid");
      if (!creatorKeys.length) return { complete: true, sources: [], observations: [], bios: [] };
      const data = await rpc("sanji_contact_enrichment_load", { p_owner: owner, p_creator_keys: creatorKeys });
      if (data?.complete !== true || !Array.isArray(data.sources) || !Array.isArray(data.observations) || !Array.isArray(data.bios) || data.sources.length > 15e3 || data.observations.length > 5e3 || data.bios.length > 2e4) fail10("contact_sources_incomplete");
      return { ...data, sources: data.sources.map(source) };
    },
    async reserveSource(owner, { creatorKey, sourceId, revision: revision2 }) {
      if (!uuid2(owner) || !key2(creatorKey) || !uuid2(sourceId) || !Number.isInteger(revision2) || revision2 < 1) fail10("contact_input_invalid");
      const result = await rpc("sanji_contact_enrichment_reserve", { p_owner: owner, p_creator_key: creatorKey, p_source_id: sourceId, p_revision: revision2 });
      if (typeof result?.reserved !== "boolean") fail10("contact_reservation_outcome_unknown");
      return result;
    },
    async appendObservation(owner, observation) {
      if (!uuid2(owner) || observation?.owner !== owner || !key2(observation?.creatorKey)) fail10("contact_input_invalid");
      const result = await rpc("sanji_contact_enrichment_observe", { p_owner: owner, p_observation: observation });
      if (result?.saved !== true) fail10("contact_observation_outcome_unknown");
      return result;
    },
    // UI-safe registration contract. No approved/state/review/owner/evidence fields.
    // This creates pending review only and never performs any network access.
    async requestSource(owner, input) {
      if (!uuid2(owner) || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["creatorKey", "sourceUrl", "sourceKind"].includes(k)) || !key2(input.creatorKey) || !["official_website", "instagram_public_bio"].includes(input.sourceKind)) fail10("contact_registration_invalid");
      if (input.sourceKind === "official_website") publicOfficialUrl(input.sourceUrl);
      else if (!input.creatorKey.startsWith("instagram:") || !["https://www.instagram.com/" + input.creatorKey.slice(10) + "/", "https://instagram.com/" + input.creatorKey.slice(10) + "/"].includes(input.sourceUrl)) fail10("contact_registration_invalid");
      return rpc("sanji_contact_source_request", { p_owner: owner, p_creator_key: input.creatorKey, p_source_url: input.sourceUrl, p_source_kind: input.sourceKind });
    }
  };
}

// supabase/functions/creator-daily-outreach/sender-runtime.mjs
import { Buffer as Buffer4 } from "node:buffer";
import { createHash as createHash3, randomUUID as randomUUID3, timingSafeEqual } from "node:crypto";

// supabase/functions/creator-daily-outreach/private-config.mjs
import { createHash as createHash2 } from "node:crypto";

// supabase/functions/creator-daily-outreach/inline-mail.mjs
import { Buffer as Buffer3 } from "node:buffer";
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
      const key3 = name === "a" ? "href" : "src", value = attrs[key3] || "";
      try {
        const u = new URL(value);
        if (!(name === "img" ? ["https:"] : ["https:", "http:", "mailto:", "tel:"]).includes(u.protocol) || u.username || u.password || /\/email-events\/pixel\//.test(u.pathname)) return "";
        out.push(key3 + '="' + escape(u.toString()) + '"');
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

// supabase/functions/_shared/mail-mime.ts
import { Buffer as Buffer2 } from "node:buffer";
function encodedHeader(value) {
  const parts = [];
  let chunk = "";
  if (/[\r\n]/.test(value)) throw Error("\uBA54\uC77C \uC81C\uBAA9\xB7\uBC1C\uC2E0\uC790\uBA85\uC5D0 \uC904\uBC14\uAFC8\uC744 \uB123\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  for (const char of String(value || "")) {
    if (Buffer2.byteLength(chunk + char, "utf8") > 42) {
      parts.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk || !parts.length) parts.push(chunk);
  return parts.map((p) => "=?UTF-8?B?" + Buffer2.from(p).toString("base64") + "?=").join("\r\n ");
}

// supabase/functions/creator-daily-outreach/inline-mail.mjs
var fail11 = (code, text2) => {
  throw new OutreachError(code, text2);
};
var escape2 = (text2) => String(text2).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var encoded = (value) => Buffer3.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
var crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n >>> 1 ^ (n & 1 ? 3988292384 : 0);
  return n >>> 0;
});
function validPngPixels(bytes, width, height) {
  let offset = 8, seenHeader = false, seenData = false, closedData = false, seenEnd = false;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size, type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB370\uC774\uD130\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    let crc = 4294967295;
    for (let i = offset + 4; i < end - 4; i++) crc = crc >>> 8 ^ crcTable[(crc ^ bytes[i]) & 255];
    if ((crc ^ 4294967295) >>> 0 !== bytes.readUInt32BE(end - 4)) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uC6D0\uBCF8\uC758 \uAC80\uC0AC\uAC12\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    if (!seenHeader && type !== "IHDR" || type === "IHDR" && (seenHeader || size !== 13)) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD5E4\uB354\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    if (type === "IHDR") {
      seenHeader = true;
      if (bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) fail11("INLINE_IMAGE_PNG_UNSUPPORTED", "8\uBE44\uD2B8 RGB/RGBA PNG \uC6D0\uBCF8\uC744 \uC0AC\uC6A9\uD558\uC138\uC694.");
    } else if (type === "IDAT") {
      if (closedData) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uBE14\uB85D \uC21C\uC11C\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      seenData = true;
      chunks.push(bytes.subarray(offset + 8, end - 4));
    } else {
      if (seenData) closedData = true;
      if (type === "IEND") {
        if (size !== 0 || end !== bytes.length || !seenData) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uB05D\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
        seenEnd = true;
      } else if (type === "PLTE") {
        if (seenData || !size || size % 3 || size > 768) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uD314\uB808\uD2B8\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
      } else if (type[0] === type[0].toUpperCase()) fail11("INLINE_IMAGE_PNG_UNSUPPORTED", "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 PNG \uC0AC\uC9C4 \uAD6C\uC870\uC785\uB2C8\uB2E4.");
    }
    offset = end;
  }
  if (!seenEnd) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4\uC774 \uC644\uC804\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const channels = bytes[25] === 6 ? 4 : 3, stride = width * channels + 1, expected = stride * height;
  if (expected > 80 * 1024 * 1024) fail11("INLINE_IMAGE_PNG_TOO_LARGE", "PNG \uD574\uB3C5 \uD06C\uAE30\uAC00 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
  let pixels;
  try {
    pixels = inflateSync(Buffer3.concat(chunks), { maxOutputLength: expected + 1 });
  } catch {
    fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140\uC744 \uD574\uB3C5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (pixels.length !== expected) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD53D\uC140 \uD06C\uAE30\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) fail11("INLINE_IMAGE_PNG_INVALID", "PNG \uC0AC\uC9C4 \uD544\uD130\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
}
function validateInlineImages(images, { owner, requiredIds }) {
  if (!Array.isArray(images) || images.length !== 2 || !Array.isArray(requiredIds) || requiredIds.length !== 2 || new Set(requiredIds).size !== 2 || !owner) fail11("INLINE_IMAGES_REQUIRED", "\uC815\uD655\uD55C \uBCF8\uBB38 \uC0AC\uC9C4 \uB450 \uC7A5\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const result = [], hashes = /* @__PURE__ */ new Set();
  let total = 0;
  for (const id of requiredIds) {
    const matches = images.filter((x) => x.id === id);
    if (matches.length !== 1) fail11("INLINE_IMAGE_ID_MISMATCH", "\uBCF8\uBB38 \uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const image = matches[0];
    if (image.owner !== owner || image.verified !== true || image.sharingApproved !== true || image.mimeType !== "image/png" || typeof image.content !== "string" || image.content.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content)) fail11("INLINE_IMAGE_UNVERIFIED", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uC6D0\uBCF8\xB7\uACC4\uC815\xB7\uACF5\uC720 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const bytes = Buffer3.from(image.content, "base64");
    if (bytes.length !== image.bytes || bytes.length < 45 || bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer3.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(12, 16).toString() !== "IHDR" || !bytes.subarray(-8, -4).equals(Buffer3.from("IEND"))) fail11("INLINE_IMAGE_BYTES_INVALID", "\uBCF8\uBB38 \uC0AC\uC9C4\uC758 \uD30C\uC77C \uD615\uC2DD\uACFC \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== image.sha256 || hashes.has(sha256)) fail11("INLINE_IMAGE_HASH_MISMATCH", "\uC0AC\uC9C4 \uC6D0\uBCF8\uC774 \uBC14\uB00C\uC5C8\uAC70\uB098 \uC911\uBCF5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    hashes.add(sha256);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width !== image.width || height !== image.height || width < 32 || height < 32 || width * height > 2e7) fail11("INLINE_IMAGE_DIMENSIONS", "\uBCF8\uBB38 \uC0AC\uC9C4 \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
    validPngPixels(bytes, width, height);
    total += bytes.length;
    if (total > 10 * 1024 * 1024) fail11("INLINE_IMAGES_TOO_LARGE", "\uBCF8\uBB38 \uC0AC\uC9C4 \uCD1D \uD06C\uAE30\uB97C \uC904\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
    result.push({ id, bytes, sha256, width, height, cid: "sanji-product-" + sha256 + "@sanji.local", name: "product-photo-" + (result.length + 1) + ".png", alt: typeof image.alt === "string" && image.alt.trim() ? image.alt.trim().slice(0, 150) : "\uC81C\uD488 \uC0AC\uC9C4 " + (result.length + 1) });
  }
  return result;
}
function bodyHtml(text2) {
  return escape2(text2).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\\\r?\n/g, "\n").split(/\r?\n/).map((line) => line === "---" ? "<hr>" : line).join("<br>");
}
function inlineContent({ copy, images, owner, requiredImageIds }) {
  if (!copy || copy.sendingEnabled !== false || typeof copy.body !== "string" || copy.body.length > 2e4) fail11("MAIL_PREVIEW_INVALID", "\uBCF8\uBB38\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (copy.attachments?.length) fail11("UNEXPECTED_ATTACHMENTS", "\uC77C\uBC18 \uCCA8\uBD80\uB97C \uCD94\uAC00\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const checked = validateInlineImages(images, { owner, requiredIds: requiredImageIds });
  if (!Array.isArray(copy.inlineImages) || copy.inlineImages.length !== 2 || checked.some((image, index) => copy.inlineImages[index]?.id !== image.id || copy.inlineImages[index]?.sha256 !== image.sha256)) fail11("INLINE_IMAGE_APPROVAL_MISMATCH", "\uC2B9\uC778\uD55C \uBCF8\uBB38 \uC0AC\uC9C4\uACFC \uC2E4\uC81C \uC6D0\uBCF8\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const signature = gmailSignature(copy.signatureHtml || "");
  if (!signature.text || signature.text !== copy.signatureText) fail11("SIGNATURE_CHANGED", "\uAE30\uC874 Gmail \uC11C\uBA85\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  let body = copy.body;
  const occurrences = body.split(signature.text).length - 1;
  if (occurrences > 1 || occurrences === 1 && !body.endsWith(signature.text)) fail11("SIGNATURE_PLACEMENT_REQUIRED", "\uC11C\uBA85\uC744 \uBCF8\uBB38 \uB9C8\uC9C0\uB9C9\uC5D0 \uD55C \uBC88\uB9CC \uBC30\uCE58\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (occurrences === 1) body = body.slice(0, -signature.text.length).replace(/\n\n$/, "");
  const imageHtml = checked.map((image) => '<div style="margin:20px 0"><img src="cid:' + image.cid + '" alt="' + escape2(image.alt) + '" width="' + Math.min(image.width, 640) + '" style="display:block;width:100%;max-width:640px;height:auto;border:0"></div>').join("");
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial,sans-serif;line-height:1.6">' + bodyHtml(body) + "</div>" + imageHtml + "<div>" + signature.html + "</div></body></html>";
  const text2 = body + "\n\n" + signature.text;
  return { checked, html, text: text2 };
}
function renderPrivateInlinePreview(options) {
  const { checked, html, text: text2 } = inlineContent(options);
  let embedded = html;
  const remoteSignatureImagesHidden = /<img\b[^>]*\bsrc="https?:/i.test(embedded);
  embedded = embedded.replace(/<img\b[^>]*\bsrc="https?:[^>]*>/gi, "");
  for (const image of checked) embedded = embedded.replace('src="cid:' + image.cid + '"', 'src="data:image/png;base64,' + image.bytes.toString("base64") + '"');
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'";
  embedded = embedded.replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="' + csp + '">');
  return { html: embedded, text: text2, imageCount: checked.length, remoteSignatureImagesHidden, previewOnly: true, sendingEnabled: false };
}
function composeInlineOutreach({ copy, images, owner, requiredImageIds, from, to, senderName, messageId = randomUUID(), now = /* @__PURE__ */ new Date() }) {
  if (!copy || copy.sendingEnabled !== false || !emailIdentity(from) || !emailIdentity(to) || /[^\x21-\x7E]/.test(from + to) || !String(copy.subject || "").trim() || typeof copy.body !== "string" || copy.body.length > 2e4 || !String(senderName || "").trim() || !/^[-A-Za-z0-9_]{1,100}$/.test(messageId) || Number.isNaN(new Date(now).getTime())) fail11("MAIL_PREVIEW_INVALID", "\uBC1C\uC2E0\uC790\xB7\uC218\uC2E0\uC790\xB7\uBCF8\uBB38\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (typeof copy.senderEmail !== "string" || from !== copy.senderEmail.trim().toLowerCase()) fail11("SENDER_SIGNATURE_MISMATCH", "\uD604\uC7AC \uBC1C\uC2E0 \uACC4\uC815\uACFC \uC2B9\uC778\uB41C Gmail \uC11C\uBA85\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (copy.attachments?.length) fail11("UNEXPECTED_ATTACHMENTS", "\uC77C\uBC18 \uCCA8\uBD80\uB97C \uCD94\uAC00\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const { checked, html, text: text2 } = inlineContent({ copy, images, owner, requiredImageIds });
  const boundary = "sanji_alt_" + messageId, related = "sanji_related_" + messageId;
  const lines = [`From: ${encodedHeader(senderName)} <${from}>`, `To: ${to}`, `Subject: ${encodedHeader(copy.subject)}`, `Date: ${new Date(now).toUTCString()}`, `Message-ID: <${messageId}@sanji.local>`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encoded(text2), `--${boundary}`, `Content-Type: multipart/related; boundary="${related}"; type="text/html"`, "", `--${related}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encoded(html)];
  for (const image of checked) lines.push(`--${related}`, "Content-Type: image/png", `Content-ID: <${image.cid}>`, `Content-Disposition: inline; filename="${image.name}"`, "Content-Transfer-Encoding: base64", "", encoded(image.bytes));
  lines.push(`--${related}--`, `--${boundary}--`, "");
  const mime = lines.join("\r\n");
  if (Buffer3.byteLength(mime) > 20 * 1024 * 1024) fail11("MAIL_TOO_LARGE", "\uBA54\uC77C \uBCF8\uBB38 \uD06C\uAE30\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.");
  return { raw: Buffer3.from(mime).toString("base64url"), html, text: text2, imageCount: checked.length, imageBytes: checked.reduce((n, x) => n + x.bytes.length, 0), mimeBytes: Buffer3.byteLength(mime), sendingEnabled: false };
}

// supabase/functions/creator-daily-outreach/private-config.mjs
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var HASH = /^[a-f0-9]{64}$/;
var fail12 = (code) => {
  throw new OutreachError(code, "\uCEA0\uD398\uC778 \uC6D0\uBCF8\xB7\uC11C\uBA85\xB7\uC0AC\uC9C4\xB7\uAC80\uD1A0 \uBC94\uC704\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", 409);
};
var CAMPAIGN_CLASSIFICATIONS = Object.freeze(["solicited_non_marketing_proposal", "reviewed_non_marketing_business_proposal"]);
function stableJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail12("INVALID_PRIVATE_CONFIGURATION");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableJSON(value[k])).join(",") + "}";
  fail12("INVALID_PRIVATE_CONFIGURATION");
}
var hashValue = (value) => createHash2("sha256").update(typeof value === "string" ? value : stableJSON(value)).digest("hex");
var keys = (value, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) fail12("INVALID_PRIVATE_CONFIGURATION");
};
var safeText = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
function settingsSignature(settings, connection) {
  const d = settings?.data || {}, email = String(d.gmailSignatureEmail || "").trim().toLowerCase();
  if (!UUID2.test(settings?.id || "") || !Number.isSafeInteger(settings.version) || settings.version < 1 || d.signatureSource !== "gmail" || d.gmailSignatureNeedsConsent === true || !emailIdentity(email) || email !== String(connection?.summary?.email || "").toLowerCase() || connection?.summary?.reauthRequired === true || !safeText(d.senderName, 200) || /[\r\n]/.test(d.senderName)) fail12("CURRENT_GMAIL_SIGNATURE_REQUIRED");
  const signature = gmailSignature(d.gmailSignatureHtml || "");
  if (!signature.text || signature.text !== d.emailSignature || signature.html !== d.gmailSignatureHtml) fail12("CURRENT_GMAIL_SIGNATURE_CHANGED");
  return { verified: true, source: "existing_gmail_signature", senderEmail: email, html: signature.html, text: signature.text, settingsId: settings.id, settingsVersion: settings.version, senderName: d.senderName };
}
function requireRecipientCriteria(snapshot) {
  if (snapshot?.version !== 2) fail12("RECIPIENT_CRITERIA_REVIEW_REQUIRED");
  const criteria = snapshot.recipientCriteria;
  keys(criteria, [...Object.keys(RECIPIENT_CRITERIA), "approvalSource"]);
  if (!safeText(criteria.approvalSource, 4e3)) fail12("RECIPIENT_CRITERIA_REVIEW_REQUIRED");
  const { approvalSource, ...scope } = criteria;
  if (stableJSON(scope) !== stableJSON(RECIPIENT_CRITERIA)) fail12("RECIPIENT_CRITERIA_CHANGED");
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
  if (![1, 2].includes(data.version) || data.owner !== owner || !UUID2.test(owner)) fail12("PRIVATE_SNAPSHOT_OWNER_MISMATCH");
  if (data.version === 2) requireRecipientCriteria(data);
  else if (data.recipientCriteria !== void 0) fail12("RECIPIENT_CRITERIA_CHANGED");
  keys(data.template, ["owner", "revision", "approved", "approvalSource", "subject", "body", "requiredInlineImageIds"]);
  if (data.template.owner !== owner || !Number.isSafeInteger(data.template.revision) || data.template.revision < 1) fail12("TEMPLATE_REVISION_REQUIRED");
  keys(data.signature, ["verified", "source", "senderEmail", "html", "text", "settingsId", "settingsVersion", "senderName"]);
  if (!UUID2.test(data.signature.settingsId || "") || !Number.isSafeInteger(data.signature.settingsVersion) || data.signature.settingsVersion < 1 || !safeText(data.signature.senderName, 200) || /[\r\n]/.test(data.signature.senderName)) fail12("CURRENT_GMAIL_SIGNATURE_REQUIRED");
  if (!Array.isArray(data.images) || data.images.length !== 2) fail12("INLINE_IMAGES_REQUIRED");
  for (const image of data.images) keys(image, ["id", "owner", "verified", "sharingApproved", "mimeType", "content", "bytes", "sha256", "width", "height", "alt"]);
  validateInlineImages(data.images, { owner, requiredIds: data.template.requiredInlineImageIds });
  if (!Array.isArray(data.products) || ![0, 2].includes(data.products.length) || new Set(data.products.map((x) => x.id)).size !== data.products.length) fail12("PRODUCT_SCOPE_REQUIRED");
  for (const product of data.products) {
    keys(product, ["id", "version", "sha256"]);
    if (!UUID2.test(product.id || "") || !Number.isSafeInteger(product.version) || product.version < 1 || !HASH.test(product.sha256 || "")) fail12("PRODUCT_SCOPE_REQUIRED");
  }
  if (data.productMode === "approved_campaign_assets") {
    if (data.products.length || !Array.isArray(data.campaignProducts) || data.campaignProducts.length !== 2 || new Set(data.campaignProducts.map((p) => p.name)).size !== 2) fail12("CAMPAIGN_PRODUCT_ASSETS_REQUIRED");
    for (const product of data.campaignProducts) {
      keys(product, ["name", "approvalSource"]);
      if (!["\uB9C8\uB77C\uCAC0\uB4DD\uBE75", "\uC9EC\uBF55\uCAC0\uB4DD\uBE75"].includes(product.name) || !safeText(product.approvalSource, 2e3)) fail12("CAMPAIGN_PRODUCT_ASSETS_CHANGED");
    }
  } else if (data.productMode !== void 0 && data.productMode !== "catalog" || data.campaignProducts !== void 0) fail12("PRODUCT_SCOPE_REQUIRED");
  renderOutreachCopy({ template: data.template, channelName: "\uAC80\uC99D \uCC44\uB110", signature: data.signature, inlineImages: data.images });
  const sanitized = gmailSignature(data.signature.html);
  if (sanitized.text !== data.signature.text || sanitized.html !== data.signature.html) fail12("CURRENT_GMAIL_SIGNATURE_CHANGED");
  if (data.scopeHash !== hashValue(scopeOf(data))) fail12("CAMPAIGN_SCOPE_CHANGED");
  const { contentHash, ...content } = data;
  if (!HASH.test(contentHash || "") || contentHash !== hashValue(content)) fail12("PRIVATE_SNAPSHOT_HASH_MISMATCH");
  return data;
}
function createPrivateSnapshot(input, { owner, settings, connection, products }) {
  keys(input, ["version", "owner", "template", "signature", "images", "products", "productMode", "campaignProducts", "recipientCriteria", "scopeHash", "contentHash"]);
  if (input.owner !== owner) fail12("PRIVATE_SNAPSHOT_OWNER_MISMATCH");
  requireRecipientCriteria(input);
  const signature = settingsSignature(settings, connection);
  if (input.signature && stableJSON(input.signature) !== stableJSON(signature)) fail12("CURRENT_GMAIL_SIGNATURE_CHANGED");
  if (!Array.isArray(input.products) || !Array.isArray(products) || products.length !== input.products.length) fail12("PRODUCT_SCOPE_REQUIRED");
  const selected = input.products.map((p) => {
    keys(p, ["id", "version", "sha256"]);
    const current = products.find((r) => r.id === p.id);
    if (!current || current.version !== p.version || !HASH.test(current.sha256 || "") || p.sha256 && p.sha256 !== current.sha256) fail12("PRODUCT_SCOPE_CHANGED");
    return { id: p.id, version: p.version, sha256: current.sha256 };
  });
  const data = JSON.parse(JSON.stringify({ version: input.version, owner, ...input.recipientCriteria !== void 0 ? { recipientCriteria: input.recipientCriteria } : {}, template: input.template, signature, images: input.images, products: selected, ...input.productMode !== void 0 ? { productMode: input.productMode } : {}, ...input.campaignProducts !== void 0 ? { campaignProducts: input.campaignProducts } : {} }));
  data.scopeHash = hashValue(scopeOf(data));
  data.contentHash = hashValue(data);
  if (input.scopeHash && input.scopeHash !== data.scopeHash || input.contentHash && input.contentHash !== data.contentHash) fail12("PRIVATE_SNAPSHOT_HASH_MISMATCH");
  return validateSnapshotData(data, owner);
}
function verifyPrivateSnapshot(row, owner) {
  if (row?.owner !== owner || !UUID2.test(row.id || "") || !HASH.test(row.sha256 || "")) fail12("PRIVATE_SNAPSHOT_OWNER_MISMATCH");
  const data = validateSnapshotData(row.data, owner);
  if (row.sha256 !== hashValue(data)) fail12("PRIVATE_SNAPSHOT_HASH_MISMATCH");
  return data;
}
function campaignPolicy(input = {}) {
  keys(input, ["classification", "classificationSource", "authorizationSource", "schedule"]);
  const classification = input.classification || "pending_review";
  if (![...CAMPAIGN_CLASSIFICATIONS, "pending_review", "marketing"].includes(classification)) fail12("MESSAGE_CLASSIFICATION_REQUIRED");
  if (input.classificationSource !== void 0 && typeof input.classificationSource !== "string" || input.authorizationSource !== void 0 && typeof input.authorizationSource !== "string") fail12("INVALID_PRIVATE_CONFIGURATION");
  const schedule = input.schedule || { timezone: "Asia/Seoul", hour: 9, minute: 0, confirmed: false };
  keys(schedule, ["timezone", "hour", "minute", "confirmed"]);
  if (schedule.timezone !== "Asia/Seoul" || !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 || !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59 || typeof schedule.confirmed !== "boolean") fail12("SCHEDULE_REVIEW_REQUIRED");
  return { classification, classificationSource: (input.classificationSource || "").trim().slice(0, 2e3), authorizationSource: (input.authorizationSource || "").trim().slice(0, 2e3), schedule: { ...schedule } };
}
function recipientBasis(basis, { owner, candidate, policy, snapshot, now = Date.now() }) {
  const expectedKind = policy.data?.classification === "solicited_non_marketing_proposal" ? "solicited_proposal" : "documented_business_proposal";
  return Boolean(basis && basis.owner === owner && basis.creator_key === candidate.creator_key && basis.recipient === candidate.recipient && basis.status === "approved" && basis.kind === expectedKind && CAMPAIGN_CLASSIFICATIONS.includes(basis.classification) && basis.classification === policy.data?.classification && basis.approved_by === owner && basis.policy_revision === policy.revision && basis.snapshot_id === snapshot.id && basis.snapshot_hash === snapshot.sha256 && safeText(basis.approval_source, 2e3) && safeText(basis.classification_source, 2e3) && sourceUrl(basis.source_url) && safeText(basis.source_text, 4e3) && Number.isFinite(Date.parse(basis.verified_at)) && Date.parse(basis.verified_at) <= now && Date.parse(basis.verified_at) >= now - 30 * 864e5 && Date.parse(basis.expires_at) > now);
}

// supabase/functions/creator-daily-outreach/dispatch.mjs
import { randomUUID as randomUUID2 } from "node:crypto";
var fail13 = (code, status = 409) => {
  throw new OutreachError(code, "\uCEA0\uD398\uC778 \uC124\uC815\uACFC \uBC1C\uC1A1 \uC804 \uAC80\uD1A0\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.", status);
};
var exactKeys = (input, allowed) => {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !allowed.includes(k))) fail13("INVALID_CAMPAIGN_REQUEST", 400);
};
var revision = (input) => {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail13("CAMPAIGN_REVISION_REQUIRED", 400);
  return input.expectedRevision;
};
var terminal = /* @__PURE__ */ new Set(["accepted", "rejected", "outcome_unknown", "cancelled"]);
var enabled = (env2, name) => env2(name) === "true";
var readReason = (error2) => /^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(error2?.code || error2?.message || "") ? (error2.code || error2.message).toLowerCase() : "preflight_failed";
function freshHistory(proof, { address, senderEmail, now }) {
  const at = Date.parse(proof?.checkedAt);
  if (!proof || proof.clear !== true || proof.address !== address || proof.emailKey !== emailIdentity(address) || proof.senderEmail !== senderEmail || !Number.isFinite(at) || at > now || at < now - 6e4) fail13("GMAIL_HISTORY_UNVERIFIED");
  return proof;
}
function campaignDue(schedule, now = Date.now()) {
  if (schedule?.confirmed !== true || schedule.timezone !== "Asia/Seoul") return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour").value), minute = Number(parts.find((p) => p.type === "minute").value);
  return hour * 60 + minute >= schedule.hour * 60 + schedule.minute;
}
function createDailyDispatch({ repository, provider, env: env2 = () => "", now = Date.now, uuid: uuid3 = randomUUID2, recurringTriggerVerified = () => false }) {
  const flags = () => ({ configurationEnabled: enabled(env2, "CREATOR_DAILY_CONFIGURATION_ENABLED"), dispatchEnabled: enabled(env2, "CREATOR_DAILY_DISPATCH_ENABLED"), schedulerDeploymentEnabled: enabled(env2, "CREATOR_DAILY_SCHEDULER_ENABLED"), mailDeploymentEnabled: enabled(env2, "EMAIL_SENDING_ENABLED") });
  function policyBlockers(p) {
    const b = [], f = flags();
    if (!f.configurationEnabled) b.push("private_configuration_disabled");
    if (!p?.snapshot_id) b.push("private_template_required");
    if (!CAMPAIGN_CLASSIFICATIONS.includes(p?.data?.classification)) b.push(p?.data?.classification === "marketing" ? "marketing_adapter_review_required" : "message_classification_required");
    if (!p?.data?.classificationSource) b.push("classification_source_required");
    if (!p?.data?.authorizationSource) b.push("authorization_source_required");
    if (p?.data?.schedule?.confirmed !== true) b.push("schedule_time_review_required");
    if (!f.dispatchEnabled) b.push("dispatch_deployment_disabled");
    if (!f.schedulerDeploymentEnabled) b.push("scheduler_deployment_disabled");
    if (!f.mailDeploymentEnabled) b.push("email_sending_disabled");
    return b;
  }
  async function configuration(owner) {
    const p = await repository.policy(owner), f = flags(), blockers = policyBlockers(p);
    let savedConnection = null;
    try {
      savedConnection = await repository.currentConnection(owner);
    } catch {
    }
    const gmailConnectionStatus = savedConnection?.summary?.reauthRequired === true ? "reauth_required" : emailIdentity(savedConnection?.summary?.email) ? "connected" : "unavailable";
    const gmailConnected = gmailConnectionStatus === "connected";
    let productMode = "unconfigured";
    if (p?.snapshot_id) {
      try {
        const row = await repository.snapshot(owner, p.snapshot_id), s = verifyPrivateSnapshot(row, owner);
        productMode = s.productMode || "catalog";
        requireRecipientCriteria(s);
        if (s.productMode !== "approved_campaign_assets" && s.products.length !== 2) blockers.push("product_scope_missing");
        const [settings, connection, products] = await Promise.all([repository.currentSettings(owner), Promise.resolve(savedConnection), s.products.length ? repository.currentProducts(owner, s.products.map((p2) => p2.id)) : Promise.resolve([])]);
        if (stableJSON(settingsSignature(settings, connection)) !== stableJSON(s.signature)) blockers.push("current_gmail_signature_changed");
        if (stableJSON(products.map(({ id, version, sha256 }) => ({ id, version, sha256 })).sort((a, b) => a.id.localeCompare(b.id))) !== stableJSON([...s.products].sort((a, b) => a.id.localeCompare(b.id)))) blockers.push("product_scope_changed");
      } catch (error2) {
        blockers.push(readReason(error2));
      }
    }
    const ready = blockers.length === 0, triggerVerified = await recurringTriggerVerified(owner) === true;
    return { state: p?.enabled && p?.send_enabled && ready ? triggerVerified ? "active" : "dispatch_ready_without_trigger" : p?.snapshot_id ? "paused_or_blocked" : "unconfigured", ...f, revision: p?.revision || 0, snapshotId: p?.snapshot_id || null, productMode, configured: Boolean(p?.snapshot_id), gmailConnected, gmailConnectionStatus, gmailConnectionCheck: "saved_connection_summary", gmailLiveVerified: false, classification: p?.data?.classification || "pending_review", schedule: p?.data?.schedule || { timezone: "Asia/Seoul", hour: 9, minute: 0, confirmed: false }, cutoverAt: p?.cutover_at || null, enabled: p?.enabled === true, sendEnabled: p?.send_enabled === true, policyEnabled: p?.enabled === true, recurringTriggerVerified: triggerVerified, schedulerEnabled: p?.enabled === true && ready && triggerVerified, sendingEnabled: p?.enabled === true && p?.send_enabled === true && ready, recipientReviewRequired: true, blockers: [...new Set(blockers)], noHistoricalBackfill: true };
  }
  async function configure(owner, input) {
    exactKeys(input, ["expectedRevision", "snapshot", "policy"]);
    revision(input);
    if (!flags().configurationEnabled) fail13("PRIVATE_CONFIGURATION_DISABLED", 503);
    const ids = input.snapshot?.products?.map((p) => p.id);
    if (!Array.isArray(ids) || ![0, 2].includes(ids.length)) fail13("PRODUCT_SCOPE_REQUIRED");
    const [settings, connection, products] = await Promise.all([repository.currentSettings(owner), repository.currentConnection(owner), ids.length ? repository.currentProducts(owner, ids) : Promise.resolve([])]);
    const snapshot = createPrivateSnapshot(input.snapshot, { owner, settings, connection, products }), policy = campaignPolicy(input.policy);
    await repository.configure(owner, input.expectedRevision, { id: uuid3(), data: snapshot }, policy);
    return configuration(owner);
  }
  async function schedule(owner, input) {
    exactKeys(input, ["expectedRevision"]);
    revision(input);
    const c = await configuration(owner);
    if (c.revision !== input.expectedRevision) fail13("CAMPAIGN_REVISION_CHANGED");
    if (c.blockers.length) fail13(c.blockers[0].toUpperCase());
    await repository.schedule(owner, input.expectedRevision);
    return configuration(owner);
  }
  async function pause(owner, input) {
    exactKeys(input, ["expectedRevision"]);
    revision(input);
    await repository.pause(owner, input.expectedRevision);
    return configuration(owner);
  }
  async function reviewRecipient(owner, input) {
    exactKeys(input, ["expectedRevision", "creatorKey", "recipient", "kind", "classification", "classificationSource", "sourceUrl", "sourceText", "verifiedAt", "expiresAt", "approvalSource", "status"]);
    revision(input);
    if (!flags().configurationEnabled) fail13("PRIVATE_CONFIGURATION_DISABLED", 503);
    if (!/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(input.creatorKey || "") || !emailIdentity(input.recipient) || input.recipient !== input.recipient.trim().toLowerCase() || !["approved", "revoked"].includes(input.status)) fail13("RECIPIENT_REVIEW_REQUIRED");
    const p = await repository.policy(owner);
    if (p?.revision !== input.expectedRevision || !p.snapshot_id) fail13("CAMPAIGN_REVISION_CHANGED");
    if (input.status === "approved") {
      const expectedKind = p.data?.classification === "solicited_non_marketing_proposal" ? "solicited_proposal" : "documented_business_proposal";
      if (!CAMPAIGN_CLASSIFICATIONS.includes(input.classification) || input.classification !== p.data?.classification || input.kind !== expectedKind || !sourceUrl(input.sourceUrl) || !["sourceText", "classificationSource", "approvalSource"].every((k) => typeof input[k] === "string" && input[k].trim() && input[k].length <= 4e3) || !Number.isFinite(Date.parse(input.verifiedAt)) || Date.parse(input.verifiedAt) > now() || Date.parse(input.verifiedAt) < now() - 30 * 864e5 || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now()) fail13("RECIPIENT_BASIS_REQUIRED");
    }
    const { expectedRevision, ...review } = input;
    await repository.reviewBasis(owner, expectedRevision, review);
    return { status: input.status, creatorKey: input.creatorKey, revision: expectedRevision };
  }
  async function finish(owner, job, reservation, status, receipt) {
    try {
      return await repository.finalize(owner, job, reservation, status, receipt);
    } catch {
      try {
        const current = await repository.current(owner, job.creator_key);
        if (terminal.has(current?.status)) return { status: current.status, reconciled: true };
      } catch {
      }
      return { status: "outcome_unknown", reason: "receipt_reconciliation_required" };
    }
  }
  async function processOne(owner) {
    const f = flags();
    if (!f.dispatchEnabled || !f.schedulerDeploymentEnabled || !f.mailDeploymentEnabled || !f.configurationEnabled) return { status: "disabled" };
    const job = await repository.claim(owner);
    if (!job) return { status: "idle" };
    let reservation = null, sendInvoked = false, grantReturned = false;
    const hold = (reason) => repository.hold(owner, job, reason);
    try {
      if (job.owner !== owner) fail13("QUEUE_OWNER_MISMATCH");
      const p = await repository.policy(owner);
      if (!p?.enabled || !p.send_enabled || p.revision !== job.policy_revision || p.snapshot_id !== job.snapshot_id || policyBlockers(p).length) return await hold("authorization_changed");
      const c = await repository.candidate(owner, job.creator_key);
      if (!c || c.owner !== owner || c.creator_key !== job.creator_key || c.day !== outreachDay(now()) || c.day !== job.day || !Number.isFinite(Date.parse(c.created)) || !Number.isFinite(Date.parse(p.cutover_at)) || Date.parse(c.created) < Date.parse(p.cutover_at) || Date.parse(c.created) > now() || !Number.isFinite(Date.parse(c.expires_at)) || Date.parse(c.expires_at) <= now() || c.recipient !== job.recipient) return await hold("candidate_cutover_or_expiry");
      if (c.snapshot?.apiSnapshot) {
        if (!Number.isFinite(Date.parse(c.snapshot.apiSnapshot.expiresAt)) || Date.parse(c.snapshot.apiSnapshot.expiresAt) <= now()) return await hold("api_snapshot_expired");
        if (c.snapshot.apiSnapshot.titleFromApi === true) {
          const e = c.snapshot.displayNameEvidence, url = sourceUrl(e?.sourceUrl);
          if (!e || e.name !== c.snapshot.name || e.verified !== true || !["official_website", "provided_by_creator"].includes(e.kind) || !url || /(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname) || typeof e.sourceText !== "string" || !e.sourceText.includes(e.name) || !Number.isFinite(Date.parse(e.checkedAt)) || Date.parse(e.checkedAt) > now() || Date.parse(e.checkedAt) < now() - 30 * 864e5 || !c.snapshot.contact?.affiliation?.verified || c.snapshot.contact.affiliation.creatorKey !== c.creator_key) return await hold("manual_display_name_required");
        }
      }
      const snapshot = await repository.snapshot(owner, job.snapshot_id), s = verifyPrivateSnapshot(snapshot, owner);
      requireRecipientCriteria(s);
      if (s.productMode !== "approved_campaign_assets" && s.products.length !== 2) return await hold("product_scope_missing");
      const [current, basis, settings, connection, products] = await Promise.all([repository.currentCandidate(owner, c), repository.basis(owner, c.creator_key, c.recipient), repository.currentSettings(owner), repository.currentConnection(owner), s.products.length ? repository.currentProducts(owner, s.products.map((p2) => p2.id)) : Promise.resolve([])]);
      const q = current?.candidate && qualifyOutreachCandidate(current.candidate, now());
      const { status: ignored, expiresAt: ignoredExpiry, ...prepared } = c.snapshot;
      if (!q?.eligible || q.contactReason || stableJSON(q.candidate) !== stableJSON(prepared)) return await hold("current_candidate_evidence_changed");
      if (!recipientBasis(basis, { owner, candidate: c, policy: p, snapshot, now: now() })) return await hold("recipient_basis_required");
      if (stableJSON(settingsSignature(settings, connection)) !== stableJSON(s.signature)) return await hold("current_gmail_signature_changed");
      if (stableJSON(products.map(({ id, version, sha256 }) => ({ id, version, sha256 })).sort((a, b) => a.id.localeCompare(b.id))) !== stableJSON([...s.products].sort((a, b) => a.id.localeCompare(b.id)))) return await hold("product_scope_changed");
      const copy = renderOutreachCopy({ template: s.template, channelName: c.snapshot.name, signature: s.signature, inlineImages: s.images }), messageId = uuid3();
      const mime = composeInlineOutreach({ copy, images: s.images, owner, requiredImageIds: s.template.requiredInlineImageIds, from: s.signature.senderEmail, to: c.recipient, senderName: s.signature.senderName, messageId, now: now() });
      const rawHash = hashValue(mime.raw);
      const first = await provider.history({ owner, address: c.recipient, senderEmail: s.signature.senderEmail });
      freshHistory(first.proof, { address: c.recipient, senderEmail: s.signature.senderEmail, now: now() });
      const plan = { recipientCriteria: s.recipientCriteria, snapshotId: snapshot.id, snapshotHash: snapshot.sha256, scopeHash: s.scopeHash, subject: copy.subject, body: copy.body, signatureText: s.signature.text, signatureHtml: s.signature.html, senderEmail: s.signature.senderEmail, senderName: s.signature.senderName, settingsId: s.signature.settingsId, settingsVersion: s.signature.settingsVersion, products: s.products, ...s.productMode !== void 0 ? { productMode: s.productMode } : {}, ...s.productMode === "approved_campaign_assets" ? { campaignProducts: s.campaignProducts } : {}, inlineImages: s.template.requiredInlineImageIds.map((id) => {
        const x = s.images.find((i) => i.id === id);
        return { id, sha256: x.sha256, bytes: x.bytes };
      }), messageId, rawHash, gmailHistory: first.proof, ...current.version ? { candidateVersion: current.version } : {}, ...current.updated ? { sourceUpdated: current.updated } : {} };
      reservation = await repository.reserve(owner, job, plan);
      if (reservation?.duplicate || reservation?.status !== "reserved" || !reservation?.outbox?.id || !reservation?.reservationToken) return { status: "outcome_unknown", reason: "reservation_reconciliation_required" };
      let latest, grant, grantRequested = false;
      try {
        latest = await provider.history({ owner, address: c.recipient, senderEmail: s.signature.senderEmail });
        freshHistory(latest.proof, { address: c.recipient, senderEmail: s.signature.senderEmail, now: now() });
        if (Date.parse(basis.expires_at) <= now()) fail13("RECIPIENT_BASIS_EXPIRED");
        grantRequested = true;
        grant = await repository.beginSend(owner, job, reservation, latest.proof, rawHash);
        grantReturned = true;
        if (grant?.ready !== true || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now() || Date.parse(grant.expiresAt) > now() + 16e3) fail13("SEND_GRANT_EXPIRED");
        freshHistory(latest.proof, { address: c.recipient, senderEmail: s.signature.senderEmail, now: now() });
      } catch {
        return await finish(owner, job, reservation, !grantRequested ? "cancelled" : "outcome_unknown", { reason: "preflight_changed_no_send" });
      }
      try {
        if (hashValue(mime.raw) !== rawHash || Date.parse(grant.expiresAt) <= now()) fail13("SEND_GRANT_EXPIRED");
        sendInvoked = true;
        const receipt = await provider.send({ owner, raw: mime.raw, rawHash, senderEmail: s.signature.senderEmail, address: c.recipient, session: latest.session, grant });
        if (!receipt || !["id", "threadId"].every((k) => typeof receipt[k] === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(receipt[k]))) throw Error("provider_receipt_missing");
        return await finish(owner, job, reservation, "accepted", { id: receipt.id, threadId: receipt.threadId });
      } catch (error2) {
        return await finish(owner, job, reservation, sendInvoked && [400, 401, 403, 404, 429].includes(error2?.status) ? "rejected" : "outcome_unknown", { reason: sendInvoked ? "provider_outcome_unknown" : "grant_issued_without_provider_receipt" });
      }
    } catch (error2) {
      try {
        const current = await repository.current(owner, job.creator_key);
        if (terminal.has(current?.status)) return { status: current.status, reconciled: true };
        if (current?.outbox_id || current?.status === "reserved") return { status: "outcome_unknown", reason: "reservation_reconciliation_required" };
      } catch {
        return { status: "outcome_unknown", reason: "queue_reconciliation_required" };
      }
      return await hold(readReason(error2));
    }
  }
  async function run(owner, { maxItems = 2, budgetMs = 2e4 } = {}) {
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 60 || !Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 45e3) fail13("INVALID_WORKER_BUDGET", 400);
    const p = await repository.policy(owner), f = flags();
    if (!f.configurationEnabled || !f.dispatchEnabled || !f.schedulerDeploymentEnabled || !f.mailDeploymentEnabled || !p?.enabled || !p.send_enabled) return { processed: 0, accepted: 0, held: 0, uncertain: 0, status: "disabled" };
    if (!campaignDue(p.data?.schedule, now())) return { processed: 0, accepted: 0, held: 0, uncertain: 0, status: "not_due" };
    await repository.sync(owner);
    const started = now(), results = [];
    while (results.length < maxItems && now() - started < budgetMs) {
      const r = await processOne(owner);
      if (["idle", "disabled"].includes(r.status)) break;
      results.push(r);
    }
    return { processed: results.length, accepted: results.filter((r) => r.status === "accepted").length, held: results.filter((r) => ["held", "cancelled"].includes(r.status)).length, uncertain: results.filter((r) => r.status === "outcome_unknown").length, status: "completed_pass" };
  }
  return { configuration, configure, schedule, pause, reviewRecipient, recipientReviews: (owner) => repository.recipientReviews(owner), runs: (owner) => repository.runs(owner), processOne, run };
}

// supabase/functions/creator-daily-outreach/dispatch-repository.mjs
var prefix = "sanji_daily_campaign_";
function dailyDispatchRepository(sb2, { candidateResolver } = {}) {
  const query = async (promise) => {
    const r = await promise;
    if (r.error) throw new OutreachError("CAMPAIGN_DATABASE_UNAVAILABLE", "\uCEA0\uD398\uC778 \uC800\uC7A5 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", 503);
    return r.data;
  };
  const rpc = (name, args) => query(sb2.rpc(prefix + name, args));
  const policy = (owner) => query(sb2.from(prefix + "policy").select("*").eq("owner", owner).maybeSingle());
  const snapshot = (owner, id) => query(sb2.from(prefix + "snapshots").select("*").eq("owner", owner).eq("id", id).maybeSingle());
  const currentSettings = async (owner) => {
    const rows = await query(sb2.from("sanji_records").select("id,owner,version,data").eq("owner", owner).eq("kind", "settings").order("id").limit(1));
    return rows?.[0] || null;
  };
  const currentConnection = (owner) => query(sb2.from("sanji_connections").select("owner,provider,summary").eq("owner", owner).eq("provider", "gmail").maybeSingle());
  const currentProducts = (owner, ids) => rpc("products", { p_owner: owner, p_product_ids: ids });
  const candidate = (owner, key3) => query(sb2.from("sanji_daily_outreach_candidates").select("*").eq("owner", owner).eq("creator_key", key3).maybeSingle());
  async function currentCandidate(owner, c) {
    if (candidateResolver) return await candidateResolver(owner, c);
    const id = c?.snapshot?.sourceRecordId;
    if (!id) return null;
    if (c.platform === "youtube") {
      const row2 = await query(sb2.from("sanji_records").select("id,owner,version,data,updated").eq("owner", owner).eq("kind", "candidate").eq("id", id).maybeSingle());
      if (!row2 || row2.data?.channels !== "YouTube") return null;
      return { candidate: adaptYoutubeRecord(row2), version: row2.version, updated: row2.updated };
    }
    if (c.platform !== "instagram") return null;
    const row = await query(sb2.from("sanji_creator_recovery").select("*").eq("owner", owner).eq("id", id).maybeSingle());
    if (!row) return null;
    const response = await sb2.from("sanji_creator_evidence").select("owner,creator_id,source_kind,detail,seen_at", { count: "exact" }).eq("owner", owner).eq("creator_id", id).eq("source_kind", "daily_outreach_review").order("seen_at", { ascending: false }).limit(1001);
    if (response.error || !Array.isArray(response.data) || response.data.length !== response.count || response.data.length > 1e3) throw new OutreachError("CURRENT_EVIDENCE_INCOMPLETE", "\uD604\uC7AC \uC5F0\uB77D\uCC98 \uADFC\uAC70\uB97C \uBAA8\uB450 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
    const evidence = response.data;
    if (evidence.length > 1 && evidence[0].seen_at === evidence[1].seen_at && JSON.stringify(evidence[0].detail) !== JSON.stringify(evidence[1].detail)) throw new OutreachError("CURRENT_EVIDENCE_AMBIGUOUS", "\uCD5C\uC2E0 \uC5F0\uB77D\uCC98 \uADFC\uAC70\uAC00 \uCDA9\uB3CC\uD569\uB2C8\uB2E4.", 409);
    return { candidate: adaptInstagramRecord(row, evidence), updated: row.updated };
  }
  return {
    policy,
    snapshot,
    currentSettings,
    currentConnection,
    currentProducts,
    candidate,
    currentCandidate,
    basis: (owner, key3, recipient) => query(sb2.from(prefix + "basis").select("*").eq("owner", owner).eq("creator_key", key3).eq("recipient", recipient).maybeSingle()),
    configure: (owner, expectedRevision, snapshot2, policy2) => rpc("configure", { p_owner: owner, p_expected_revision: expectedRevision, p_snapshot: snapshot2, p_policy: policy2 }),
    schedule: (owner, expectedRevision) => rpc("schedule", { p_owner: owner, p_expected_revision: expectedRevision }),
    pause: (owner, expectedRevision) => rpc("pause", { p_owner: owner, p_expected_revision: expectedRevision }),
    reviewBasis: (owner, expectedRevision, review) => rpc("review_basis", { p_owner: owner, p_expected_revision: expectedRevision, p_review: review }),
    async recipientReviews(owner) {
      const r = await sb2.from(prefix + "basis").select("creator_key,recipient,status,kind,classification,classification_source,verified_at,expires_at,policy_revision,snapshot_id,updated", { count: "exact" }).eq("owner", owner).order("creator_key").limit(1001);
      if (r.error || !Array.isArray(r.data) || r.data.length !== r.count || r.data.length > 1e3) throw new OutreachError("RECIPIENT_REVIEWS_INCOMPLETE", "\uC218\uC2E0\uC790 \uAC80\uD1A0 \uBAA9\uB85D\uC744 \uBAA8\uB450 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
      return r.data;
    },
    sync: (owner) => rpc("sync", { p_owner: owner }),
    async claim(owner) {
      const result = await rpc("claim", { p_owner: owner });
      return Array.isArray(result) ? result[0] || null : result;
    },
    hold: (owner, job, reason) => rpc("hold", { p_owner: owner, p_creator_key: job.creator_key, p_lease: job.lease_token, p_reason: reason }),
    reserve: (owner, job, plan) => rpc("reserve", { p_owner: owner, p_creator_key: job.creator_key, p_lease: job.lease_token, p_plan: plan }),
    beginSend: (owner, job, reservation, proof, rawHash) => rpc("begin_send", { p_owner: owner, p_creator_key: job.creator_key, p_reservation: reservation.reservationToken, p_gmail_history: proof, p_raw_hash: rawHash }),
    finalize: (owner, job, reservation, status, provider) => rpc("finalize", { p_owner: owner, p_creator_key: job.creator_key, p_reservation: reservation.reservationToken, p_status: status, p_provider: provider }),
    current: ((owner, key3) => query(sb2.from(prefix + "queue").select("status,reason,outbox_id,send_started_at").eq("owner", owner).eq("creator_key", key3).maybeSingle())),
    runs: (owner) => rpc("runs", { p_owner: owner, p_limit: 14 })
  };
}

// supabase/functions/creator-daily-outreach/sender-runtime.mjs
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
    const key3 = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env2("TOKEN_ENCRYPTION_KEY"))), "AES-GCM", false, ["decrypt"]);
    try {
      const bytes = Buffer4.from(r.encrypted, "base64"), value = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key3, bytes.subarray(12))));
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
        const fresh2 = await remote(tokenURL, { method: "POST", body: new URLSearchParams({ client_id: env2("GOOGLE_CLIENT_ID"), client_secret: env2("GOOGLE_CLIENT_SECRET"), refresh_token: c.refresh_token, grant_type: "refresh_token" }) });
        if (typeof fresh2.access_token !== "string" || !Number.isFinite(Number(fresh2.expires_in)) || Number(fresh2.expires_in) <= 0) throw error("GMAIL_REAUTH_REQUIRED");
        c = { ...c, access_token: fresh2.access_token, expires: now() + Number(fresh2.expires_in) * 1e3 };
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
  const usedSessions = /* @__PURE__ */ new Set();
  async function send({ owner, raw, rawHash, senderEmail, session: sessionId, grant }) {
    if (!["CREATOR_DAILY_CONFIGURATION_ENABLED", "CREATOR_DAILY_DISPATCH_ENABLED", "CREATOR_DAILY_SCHEDULER_ENABLED", "EMAIL_SENDING_ENABLED"].every((name) => env2(name) === "true")) throw error("EMAIL_SENDING_DISABLED");
    const session = sessions.get(owner);
    if (!session || session.id !== sessionId || session.email !== senderEmail || session.expires <= now() + 2e4 || typeof raw !== "string" || hashValue(raw) !== rawHash || grant?.ready !== true || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now() || Date.parse(grant.expiresAt) > now() + 16e3) throw error("SEND_GRANT_EXPIRED");
    const key3 = hashValue({ owner, sessionId, rawHash, expiresAt: grant.expiresAt });
    if (usedSessions.has(key3)) throw error("SEND_GRANT_REUSED");
    usedSessions.add(key3);
    return remote(base + "/messages/send", { method: "POST", headers: { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  }
  return { history, send, resetSession() {
    sessions.clear();
    usedSessions.clear();
  } };
}
function createDailyDispatchRuntime({ sb: sb2, env: env2, request = fetch, now = Date.now, uuid: uuid3 = randomUUID3, recurringTriggerVerified = () => false, candidateResolver }) {
  const provider = dailyGmailProvider({ sb: sb2, env: env2, request, now }), worker = createDailyDispatch({ repository: dailyDispatchRepository(sb2, { candidateResolver }), provider, env: env2, now, uuid: uuid3, recurringTriggerVerified });
  return { ...worker, async run(owner, options) {
    provider.resetSession();
    try {
      return await worker.run(owner, options);
    } finally {
      provider.resetSession();
    }
  } };
}

// supabase/functions/creator-daily-outreach/youtube-greeting.mjs
function youtubeGreetingName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 150 || /[\u0000-\u001f\u007f]/.test(value)) throw new OutreachError("CHANNEL_NAME_INVALID", "\uC2E4\uC81C \uCC44\uB110\uBA85\uC744 \uD655\uC778\uD558\uC138\uC694.");
  const name = value.trim();
  if (!/\p{Script=Hangul}/u.test(name)) return name;
  return name.normalize("NFC").replace(/[^\p{Script=Hangul}\s&]/gu, " ").replace(/\s+/g, " ").replace(/^[\s&]+|[\s&]+$/g, "");
}
function renderYoutubeOutreachCopy({ template, channelName, signature, attachments = [], inlineImages = [] }) {
  if (!template || typeof template.subject !== "string" || typeof template.body !== "string") return renderOutreachCopy({ template, channelName, signature, attachments, inlineImages });
  const withHonorificSpace = (s) => s.replace(/\[채널명\][ \t]*님/gu, "[\uCC44\uB110\uBA85] \uB2D8");
  return renderOutreachCopy({ template: { ...template, subject: withHonorificSpace(template.subject), body: withHonorificSpace(template.body) }, channelName: youtubeGreetingName(channelName), signature, attachments, inlineImages });
}

// supabase/functions/creator-daily-outreach/preview.mjs
var fail14 = (code, status = 409) => {
  throw new OutreachError(code, "\uD604\uC7AC \uD6C4\uBCF4\uC640 \uC800\uC7A5\uB41C \uBB38\uC548\xB7Gmail \uC11C\uBA85\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", status);
};
var validKey = (value) => /^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(value || "");
function createPrivatePreview({ repository, resolveTarget, now = Date.now }) {
  return async function preview(owner, input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["creatorKey", "expectedRevision"].includes(k)) || !validKey(input.creatorKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail14("INVALID_PREVIEW_REQUEST", 400);
    const policy = await repository.policy(owner);
    if (!policy || policy.owner !== owner || policy.revision !== input.expectedRevision) fail14("CAMPAIGN_REVISION_CHANGED");
    if (!policy.snapshot_id) fail14("PRIVATE_TEMPLATE_REQUIRED");
    const [row, current, settings, connection] = await Promise.all([repository.snapshot(owner, policy.snapshot_id), resolveTarget(owner, input.creatorKey), repository.currentSettings(owner), repository.currentConnection(owner)]);
    const snapshot = verifyPrivateSnapshot(row, owner);
    if (stableJSON(settingsSignature(settings, connection)) !== stableJSON(snapshot.signature)) fail14("CURRENT_GMAIL_SIGNATURE_CHANGED");
    if (current?.complete !== true || !Array.isArray(current.candidates) || current.candidates.length !== 1) fail14("CURRENT_EVIDENCE_AMBIGUOUS");
    const target = current.candidates[0];
    if (creatorIdentity(target) !== input.creatorKey || typeof target.name !== "string" || !target.name.trim() || target.name.length > 200) fail14("PREVIEW_TARGET_CHANGED");
    const qualification = qualifyOutreachCandidate(target, now()), recipient = qualification.candidate?.contact?.address || null;
    const copy = (input.creatorKey.startsWith("youtube:") ? renderYoutubeOutreachCopy : renderOutreachCopy)({ template: snapshot.template, channelName: target.name, signature: snapshot.signature, inlineImages: snapshot.images });
    const content = renderPrivateInlinePreview({ copy, images: snapshot.images, owner, requiredImageIds: snapshot.template.requiredInlineImageIds });
    const latest = await repository.policy(owner);
    if (latest?.owner !== owner || latest.revision !== policy.revision || latest.snapshot_id !== policy.snapshot_id) fail14("CAMPAIGN_REVISION_CHANGED");
    const warnings = [.../* @__PURE__ */ new Set(["preview_is_not_send_authorization", ...content.remoteSignatureImagesHidden ? ["signature_remote_images_hidden_in_preview"] : [], ...snapshot.version === 1 ? ["historical_recipient_criteria"] : [], ...qualification.reasons, ...qualification.contactReason ? [qualification.contactReason] : []])];
    return { previewOnly: true, sendingEnabled: false, creatorKey: input.creatorKey, channelName: target.name.trim(), recipient, subject: copy.subject, html: content.html, imageCount: content.imageCount, templateRevision: snapshot.template.revision, policyRevision: policy.revision, snapshotId: row.id, scopeHash: snapshot.scopeHash, warnings };
  };
}

// supabase/functions/creator-daily-outreach/prepared-recipients.mjs
var fail15 = () => {
  throw new OutreachError("PREPARED_RECIPIENTS_UNAVAILABLE", "\uC624\uB298 \uC900\uBE44\uD55C \uC218\uC2E0 \uC8FC\uC18C\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", 503);
};
function createPreparedRecipients({ sb: sb2, now = Date.now }) {
  return async (owner) => {
    const at = now(), day = outreachDay(at), pages = await Promise.all(["youtube", "instagram"].map(async (platform) => {
      const bounds = DAILY_OUTREACH.audienceBounds[platform], cap = platform === "youtube" ? 50 : 10;
      const r2 = await sb2.from("sanji_daily_outreach_candidates").select("owner,creator_key,email_key,recipient,platform,day,state,snapshot,expires_at", { count: "exact" }).eq("owner", owner).eq("day", day).eq("platform", platform).gt("expires_at", new Date(at).toISOString()).gte("snapshot->audience", bounds.minimum).lte("snapshot->audience", bounds.maximum).order("creator_key", { ascending: true }).limit(cap + 1);
      if (r2.error || !Array.isArray(r2.data) || !Number.isSafeInteger(r2.count) || r2.count !== r2.data.length || r2.count > cap || r2.data.some((row) => row.platform !== platform)) fail15();
      return r2.data;
    }));
    const r = { data: pages.flat() };
    const items = [], keys2 = /* @__PURE__ */ new Set(), emails = /* @__PURE__ */ new Set(), counts = { youtube: 0, instagram: 0 };
    for (const row of r.data) {
      const s = row.snapshot, key3 = creatorIdentity(s), email = emailIdentity(row.recipient), bounds = DAILY_OUTREACH.audienceBounds[row.platform];
      if (row.owner !== owner || row.day !== day || !bounds || !key3 || key3 !== row.creator_key || s.platform !== row.platform || !email || row.email_key !== email || keys2.has(key3) || emails.has(email) || row.state !== "awaiting_dispatch_review") fail15();
      keys2.add(key3);
      emails.add(email);
      if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= at || !Number.isSafeInteger(s.audience) || s.audience < bounds.minimum || s.audience > bounds.maximum) continue;
      if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 200 || s.contact?.verified !== true || s.contact.address !== row.recipient || s.contact.key !== email) fail15();
      counts[row.platform]++;
      if (counts[row.platform] > (row.platform === "youtube" ? 50 : 10)) fail15();
      items.push({ creatorKey: key3, platform: row.platform, name: s.name, email: row.recipient, audience: s.audience });
    }
    return { day, scope: "current_day_prepared_recipients", items, counts, preparationOnly: true, sendingEnabled: false, gmailHistoryChecked: false };
  };
}

// supabase/functions/creator-daily-outreach/campaign-runtime.mjs
var fail16 = (code) => {
  throw new OutreachError(code, "\uCEA0\uD398\uC778 \uC2E4\uD589 \uC870\uAC74\uACFC \uD604\uC7AC \uC6D0\uBCF8\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.", 503);
};
function createCampaignRuntime({ sb: sb2, env: env2 = () => "", request = fetch, now = Date.now, network = createPinnedPublicReader(), triggerVerified = () => false }) {
  const repository = createOutreachRepository(sb2), execution = createExecutionRepository(sb2, { now }), contactRepository = createContactEnrichmentRepository(sb2);
  const query = async (promise) => {
    const r = await promise;
    if (r.error) fail16("CAMPAIGN_DATABASE_UNAVAILABLE");
    return r.data;
  };
  const supply = createDailySupply({ repository: createSupplyRepository(sb2), sourceRepository: repository, executionRepository: execution, ...supplyConfig(env2), fetchImpl: request, now, sweepDownstream: () => query(sb2.rpc("sanji_daily_outreach_sweep", {})) });
  const enrichment = createContactEnrichment({ repository: contactRepository, network, enabled: env2("CREATOR_DAILY_CONTACT_ENRICHMENT_ENABLED") === "true", now });
  async function candidateResolver(owner, prepared) {
    const source2 = await execution.current(owner, prepared.creator_key, prepared.snapshot?.sourceRecordId || null);
    if (source2?.complete !== true) fail16("CURRENT_EVIDENCE_INCOMPLETE");
    const matched = source2.candidates.filter((row) => creatorIdentity(row) === prepared.creator_key);
    if (matched.length !== 1) fail16("CURRENT_EVIDENCE_AMBIGUOUS");
    const enriched = await enrichment.enrich(owner, { candidates: matched });
    if (enriched?.complete !== true || enriched.candidates.length !== 1) fail16("CURRENT_EVIDENCE_INCOMPLETE");
    const candidate = enriched.candidates[0];
    if (candidate.sourceRecordId) {
      const version = candidate.sourceRecordVersion, updated = candidate.sourceRecordUpdated;
      if (typeof updated !== "string" || !Number.isFinite(Date.parse(updated)) || candidate.platform === "youtube" && (!Number.isSafeInteger(version) || version < 1)) fail16("CURRENT_EVIDENCE_VERSION_REQUIRED");
      return { candidate, ...candidate.platform === "youtube" ? { version } : {}, updated };
    }
    return { candidate };
  }
  const dispatch = createDailyDispatchRuntime({ sb: sb2, env: env2, request, now, candidateResolver, recurringTriggerVerified: triggerVerified });
  const sourceReviews = { list: (owner, options) => contactRepository.listRegisteredSources(owner, options), register: (owner, input) => contactRepository.requestSource(owner, input) };
  const preview = createPrivatePreview({ repository: dailyDispatchRepository(sb2), resolveTarget: (owner, key3) => execution.current(owner, key3), now });
  const controller = createOutreachController({ repository, supply, enrichment, dispatch, sourceReviews, preview, preparedRecipients: createPreparedRecipients({ sb: sb2, now }), execution, env: env2, now });
  async function run() {
    if (env2("CREATOR_DAILY_RETENTION_ENABLED") !== "true") return { state: "stopped", reason: "retention_not_enabled", sendingEnabled: false };
    const maintenance = await supply.sweepExpired();
    if (env2("CREATOR_DAILY_WORKER_ENABLED") !== "true") return { state: "stopped", maintenance, sendingEnabled: false };
    const r = await sb2.from("sanji_daily_campaign_policy").select("owner,data,enabled,send_enabled").eq("enabled", true).order("owner").limit(2);
    if (r.error || !Array.isArray(r.data)) fail16("SCHEDULE_POLICY_UNAVAILABLE");
    if (r.data.length > 1) fail16("SCHEDULE_OWNER_AMBIGUOUS");
    const policy = r.data[0];
    if (!policy) return { state: "paused", maintenance, sendingEnabled: false };
    if (!campaignDue(policy.data?.schedule, now())) return { state: "not_due", maintenance, sendingEnabled: false };
    const collected = await controller.collect(policy.owner);
    if (collected.newlyCollected === true) return { state: "collected", campaign: DAILY_OUTREACH.campaign, maintenance, collected, morePassesMayBeRequired: true, sendingEnabled: false };
    let prepared = await controller.currentPlan(policy.owner);
    if (!prepared || prepared.morePreparationRequired === true) {
      prepared = await controller.prepare(policy.owner);
      return { state: "prepared", campaign: DAILY_OUTREACH.campaign, maintenance, prepared, morePassesMayBeRequired: true, sendingEnabled: false };
    }
    const dispatched = await dispatch.run(policy.owner, { maxItems: 60, budgetMs: 4e4 });
    return { state: "completed_pass", campaign: DAILY_OUTREACH.campaign, maintenance, prepared, dispatched, morePassesMayBeRequired: true };
  }
  return { controller, run, supply, enrichment, dispatch, candidateResolver, execution };
}

// supabase/functions/creator-daily-outreach/browser-configuration.mjs
function browserConfigurationEnv(read) {
  return (name) => {
    const value = read(name);
    return name === "CREATOR_DAILY_CONFIGURATION_ENABLED" && (value === void 0 || value === null || value === "") ? "true" : value || "";
  };
}

// supabase/functions/creator-daily-outreach/index.ts
var env = browserConfigurationEnv((name) => Deno.env.get(name));
var sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
var runtime = createCampaignRuntime({ sb, env });
Deno.serve(campaignHandler({ sb, controller: runtime.controller, env }));
