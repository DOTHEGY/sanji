import { Buffer } from "node:buffer";
import {mailRecipients} from "./mail-recipients.ts";
function attachmentType(content: string) {
  const b = Buffer.from(content, "base64");
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a","GIF89a"].includes(b.subarray(0,6).toString())) return "image/gif";
  if (b.subarray(0,4).toString() === "RIFF" && b.subarray(8,12).toString() === "WEBP") return "image/webp";
  if (b.subarray(0,5).toString() === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}
function messageIds(v: string) {
  return (String(v || "").match(/<[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~@-]+>/g) || [])
    .slice(-20)
    .join(" ");
}
// RFC 2047 encoded words stay below 75 octets and split only at Unicode code points.
export function encodedHeader(value:string){
 const parts:string[]=[];let chunk="";
 if(/[\r\n]/.test(value))throw Error("메일 제목·발신자명에 줄바꿈을 넣을 수 없습니다.");
 for(const char of String(value||"")){if(Buffer.byteLength(chunk+char,"utf8")>42){parts.push(chunk);chunk="";}chunk+=char;}
 if(chunk||!parts.length)parts.push(chunk);
 return parts.map(p=>"=?UTF-8?B?"+Buffer.from(p).toString("base64")+"?=").join("\r\n ");
}
const base64Body=(text:string)=>Buffer.from(text,"utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n")||"";
function trackingHtml(d:any){
 const escape=(s:string)=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
 let url;try{url=new URL(d.trackingPixelUrl);if(url.protocol!=="https:"||!/^\/functions\/v1\/[^/]+\/email-events\/pixel\/[A-Za-z0-9_-]{43}\.gif$/.test(url.pathname)||url.search||url.hash||url.username||url.password)return null;}catch{return null;}
 const text=String(d.body),parts:string[]=[];let last=0;
 for(const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)){parts.push(escape(text.slice(last,m.index)));parts.push('<a href="'+escape(m[0])+'">'+escape(m[0])+'</a>');last=m.index!+m[0].length;}parts.push(escape(text.slice(last)));
 return '<!doctype html><html><head><meta charset="utf-8"></head><body><div style="white-space:pre-wrap">'+parts.join('')+'</div><img src="'+escape(url.toString())+'" width="1" height="1" alt="" referrerpolicy="no-referrer" style="width:1px;height:1px;border:0" /></body></html>';
}
export function mime(d: any, from: string) {
  const lines = [
    `From: ${d.senderName?encodedHeader(d.senderName)+" <"+from+">":from}`,
    `To: ${mailRecipients(d).join(", ")}`,
    `Subject: ${encodedHeader(d.subject)}`,
    `Message-ID: <${d.messageId}@sanji.local>`,
    "MIME-Version: 1.0",
  ];
  if (d.inReplyTo)
    lines.push(
      "In-Reply-To: " + messageIds(d.inReplyTo),
      "References: " + messageIds(d.references) + " " + messageIds(d.inReplyTo),
    );
  const html=trackingHtml(d),alternative="sanji_alt_"+crypto.randomUUID();
  const bodyLines=html?[
   `Content-Type: multipart/alternative; boundary="${alternative}"`, "",`--${alternative}`,
   "Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",base64Body(d.body),
   `--${alternative}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",base64Body(html),`--${alternative}--`
  ]:["Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",base64Body(d.body)];
  const attachments = d.attachments || [];
  if (!attachments.length)return Buffer.from([...lines,...bodyLines].join("\r\n")).toString("base64url");
  const boundary = "sanji_" + crypto.randomUUID();
  lines.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...bodyLines,
  );
  for (const a of attachments)
    lines.push(
      `--${boundary}`,
      "Content-Type: " + attachmentType(a.content),
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.content.match(/.{1,76}/g)?.join("\r\n") || "",
    );
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
