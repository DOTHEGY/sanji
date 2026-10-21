const { EnvHttpProxyAgent, fetch } = require("undici");
const { randomBytes } = require("node:crypto");
const agent = process.env.HTTPS_PROXY ? new EnvHttpProxyAgent() : undefined;
async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    dispatcher: agent,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Provider request failed (${res.status})`);
    e.status = res.status;
    e.providerCode = data.error?.status || data.error?.code || "provider_error";
    throw e;
  }
  return data;
}
const enc = (x) => Buffer.from(x).toString("base64url"),
  mimeHeader = (x) => `=?UTF-8?B?${Buffer.from(x).toString("base64")}?=`;
function mime(d, from) {
  const lines = [
    `From: ${from}`,
    `To: ${d.email}`,
    `Subject: ${mimeHeader(d.subject)}`,
    `Message-ID: <${d.messageId}@sanji.local>`,
    `MIME-Version: 1.0`,
  ];
  if (d.inReplyTo) {
    const messageIds = (value) =>
      (String(value || "").match(/<[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~@-]+>/g) || [])
        .slice(-20)
        .join(" ");
    const reply = messageIds(d.inReplyTo);
    if (reply)
      lines.push(
        `In-Reply-To: ${reply}`,
        `References: ${messageIds(d.references)} ${reply}`,
      );
  }
  const attachments = d.attachments || [];
  if (!attachments.length)
    return enc(
      [
        ...lines,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(d.body).toString("base64"),
      ].join("\r\n"),
    );
  const boundary = "sanji_" + randomBytes(16).toString("hex");
  lines.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(d.body).toString("base64"),
  );
  for (const a of attachments) {
    lines.push(
      `--${boundary}`,
      "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.content.match(/.{1,76}/g).join("\r\n"),
    );
  }
  lines.push(`--${boundary}--`);
  return enc(lines.join("\r\n"));
}
function bodyText(payload) {
  if (payload.mimeType === "text/plain" && payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString();
  return (payload.parts || []).map(bodyText).filter(Boolean).join("\n");
}
function headers(payload) {
  return Object.fromEntries(
    (payload.headers || []).map((h) => [h.name.toLowerCase(), h.value]),
  );
}
module.exports = { request, mime, bodyText, headers };
