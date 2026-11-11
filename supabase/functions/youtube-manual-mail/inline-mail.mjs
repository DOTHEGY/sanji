import {Buffer} from 'node:buffer';
import {createHash,randomUUID} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {gmailSignature} from '../_shared/gmail-signature.ts';
import {encodedHeader} from '../_shared/mail-mime.ts';
import {emailIdentity,OutreachError} from '../creator-daily-outreach/domain.mjs';
const fail=(code,text)=>{throw new OutreachError(code,text);};
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const encoded=value=>Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function validPngPixels(bytes,width,height){
 let offset=8,seenHeader=false,seenData=false,closedData=false,seenEnd=false;const chunks=[];
 while(offset<bytes.length){
  if(offset+12>bytes.length)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 데이터가 손상되었습니다.');
  const size=bytes.readUInt32BE(offset),end=offset+12+size,type=bytes.subarray(offset+4,offset+8).toString('ascii');
  if(end>bytes.length||!/^[A-Za-z]{4}$/.test(type))fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 데이터가 손상되었습니다.');
  let crc=0xffffffff;for(let i=offset+4;i<end-4;i++)crc=(crc>>>8)^crcTable[(crc^bytes[i])&255];
  if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(end-4))fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 원본의 검사값이 일치하지 않습니다.');
  if(!seenHeader&&type!=='IHDR'||type==='IHDR'&&(seenHeader||size!==13))fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 헤더를 확인해야 합니다.');
  if(type==='IHDR'){
   seenHeader=true;
   // The two approved originals are non-interlaced 8-bit RGB/RGBA. Other
   // encodings require explicit conversion/review, never a lossy silent rewrite.
   if(bytes[offset+16]!==8||![2,6].includes(bytes[offset+17])||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)fail('INLINE_IMAGE_PNG_UNSUPPORTED','8비트 RGB/RGBA PNG 원본을 사용하세요.');
  }else if(type==='IDAT'){if(closedData)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 블록 순서가 잘못되었습니다.');seenData=true;chunks.push(bytes.subarray(offset+8,end-4));}
  else {if(seenData)closedData=true;if(type==='IEND'){if(size!==0||end!==bytes.length||!seenData)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 끝을 확인해야 합니다.');seenEnd=true;}else if(type==='PLTE'){if(seenData||!size||size%3||size>768)fail('INLINE_IMAGE_PNG_INVALID','PNG 팔레트를 확인해야 합니다.');}else if(type[0]===type[0].toUpperCase())fail('INLINE_IMAGE_PNG_UNSUPPORTED','지원하지 않는 PNG 사진 구조입니다.');}
  offset=end;
 }
 if(!seenEnd)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진이 완전하지 않습니다.');
 const channels=bytes[25]===6?4:3,stride=width*channels+1,expected=stride*height;
 // Besides the dimension cap, cap decoded memory for a bounded server worker.
 if(expected>80*1024*1024)fail('INLINE_IMAGE_PNG_TOO_LARGE','PNG 해독 크기가 너무 큽니다.');
 let pixels;try{pixels=inflateSync(Buffer.concat(chunks),{maxOutputLength:expected+1});}catch{fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 픽셀을 해독하지 못했습니다.');}
 if(pixels.length!==expected)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 픽셀 크기가 일치하지 않습니다.');
 for(let row=0;row<height;row++)if(pixels[row*stride]>4)fail('INLINE_IMAGE_PNG_INVALID','PNG 사진 필터가 잘못되었습니다.');
}
// No network, storage upload, draft creation or send. Caller supplies approved
// original bytes; CID references resolve solely within this MIME message.
export function validateInlineImages(images,{owner,requiredIds}){
 if(!Array.isArray(images)||images.length!==2||!Array.isArray(requiredIds)||requiredIds.length!==2||new Set(requiredIds).size!==2||!owner)fail('INLINE_IMAGES_REQUIRED','정확한 본문 사진 두 장이 필요합니다.');
 const result=[],hashes=new Set();let total=0;
 for(const id of requiredIds){
  const matches=images.filter(x=>x.id===id);if(matches.length!==1)fail('INLINE_IMAGE_ID_MISMATCH','본문 사진 원본이 일치하지 않습니다.');const image=matches[0];
  if(image.owner!==owner||image.verified!==true||image.sharingApproved!==true||image.mimeType!=='image/png'||typeof image.content!=='string'||image.content.length>8*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content))fail('INLINE_IMAGE_UNVERIFIED','본문 사진의 원본·계정·공유 범위를 확인해야 합니다.');
  const bytes=Buffer.from(image.content,'base64');if(bytes.length!==image.bytes||bytes.length<45||bytes.length>5*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.subarray(12,16).toString()!=='IHDR'||!bytes.subarray(-8,-4).equals(Buffer.from('IEND')))fail('INLINE_IMAGE_BYTES_INVALID','본문 사진의 파일 형식과 크기를 확인해야 합니다.');
  const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==image.sha256||hashes.has(sha256))fail('INLINE_IMAGE_HASH_MISMATCH','사진 원본이 바뀌었거나 중복되었습니다.');hashes.add(sha256);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width!==image.width||height!==image.height||width<32||height<32||width*height>20000000)fail('INLINE_IMAGE_DIMENSIONS','본문 사진 크기를 확인해야 합니다.');
  validPngPixels(bytes,width,height);
  total+=bytes.length;if(total>10*1024*1024)fail('INLINE_IMAGES_TOO_LARGE','본문 사진 총 크기를 줄여야 합니다.');
  result.push({id,bytes,sha256,width,height,cid:'sanji-product-'+sha256+'@sanji.local',name:'product-photo-'+(result.length+1)+'.png',alt:typeof image.alt==='string'&&image.alt.trim()?image.alt.trim().slice(0,150):'제품 사진 '+(result.length+1)});
 }
 return result;
}
function bodyHtml(text){
 // Formatting only: interpret the user's supplied Markdown bold/line-break
 // markers. No rewritten wording, added claims, links, tracking or remote media.
 return escape(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\\\r?\n/g,'\n').split(/\r?\n/).map(line=>line==='---'?'<hr>':line).join('<br>');
}
function inlineContent({copy,images,owner,requiredImageIds},validatedImages){
 if(!copy||copy.sendingEnabled!==false||typeof copy.body!=='string'||copy.body.length>20000)fail('MAIL_PREVIEW_INVALID','본문을 확인해야 합니다.');
 if(copy.attachments?.length)fail('UNEXPECTED_ATTACHMENTS','일반 첨부를 추가하지 않습니다.');
 const checked=validatedImages||validateInlineImages(images,{owner,requiredIds:requiredImageIds});
 if(!Array.isArray(copy.inlineImages)||copy.inlineImages.length!==2||checked.some((image,index)=>copy.inlineImages[index]?.id!==image.id||copy.inlineImages[index]?.sha256!==image.sha256))fail('INLINE_IMAGE_APPROVAL_MISMATCH','승인한 본문 사진과 실제 원본이 일치하지 않습니다.');
 const signature=gmailSignature(copy.signatureHtml||'');if(!signature.text||signature.text!==copy.signatureText)fail('SIGNATURE_CHANGED','기존 Gmail 서명이 일치하지 않습니다.');
 let body=copy.body;const occurrences=body.split(signature.text).length-1;
 if(occurrences>1||(occurrences===1&&!body.endsWith(signature.text)))fail('SIGNATURE_PLACEMENT_REQUIRED','서명을 본문 마지막에 한 번만 배치해야 합니다.');
 if(occurrences===1)body=body.slice(0,-signature.text.length).replace(/\n\n$/,'');
 const imageHtml=checked.map(image=>'<div style="margin:20px 0"><img src="cid:'+image.cid+'" alt="'+escape(image.alt)+'" width="'+Math.min(image.width,640)+'" style="display:block;width:100%;max-width:640px;height:auto;border:0"></div>').join('');
 const html='<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial,sans-serif;line-height:1.6">'+bodyHtml(body)+'</div>'+imageHtml+'<div>'+signature.html+'</div></body></html>';
 const text=body+'\n\n'+signature.text;
 return {checked,html,text};
}
// Private, read-only rendering. No recipient placeholder, MIME, draft, network,
// delivery token or message ID is created for a browser preview.
export function renderPrivateInlinePreview(options){
 const {checked,html,text}=inlineContent(options);let embedded=html;
 const remoteSignatureImagesHidden=/<img\b[^>]*\bsrc="https?:/i.test(embedded);
 // Preserve the actual send signature unchanged; preview must not beacon to a third party.
 embedded=embedded.replace(/<img\b[^>]*\bsrc="https?:[^>]*>/gi,'');
 for(const image of checked)embedded=embedded.replace('src="cid:'+image.cid+'"','src="data:image/png;base64,'+image.bytes.toString('base64')+'"');
 const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'";
 embedded=embedded.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+csp+'">');
 return {html:embedded,text,imageCount:checked.length,remoteSignatureImagesHidden,previewOnly:true,sendingEnabled:false};
}
// A private batch preview shares the same two validated images across all
// recipients. The caller cannot inject prevalidated data into inlineContent.
export function createSharedInlinePreview({images,owner,requiredImageIds}){
 const checked=validateInlineImages(images,{owner,requiredIds:requiredImageIds});
 const sharedImages=checked.map(image=>({sha256:image.sha256,bytes:image.bytes.length,content:image.bytes.toString('base64')}));
 function render(copy){const {html,text}=inlineContent({copy,images,owner,requiredImageIds},checked);let result=html;const remoteSignatureImagesHidden=/<img\b[^>]*\bsrc="https?:/i.test(result);result=result.replace(/<img\b[^>]*\bsrc="https?:[^>]*>/gi,'');checked.forEach((image,index)=>{result=result.replace('src="cid:'+image.cid+'"','src="sanji-preview:'+index+'"');});return {html:result,text,remoteSignatureImagesHidden};}
 return {sharedImages,render};
}
// The validated bytes and encodings live only inside this per-operation closure.
// Callers cannot provide unvalidated image metadata to the composer.
export function createSharedInlineComposer({images,owner,requiredImageIds}){
 const checked=validateInlineImages(images,{owner,requiredIds:requiredImageIds});
 const encodedImages=checked.map(image=>encoded(image.bytes));
 return options=>composeWithImages({...options,images,owner,requiredImageIds},checked,encodedImages);
}
export function composeInlineOutreach(options){return composeWithImages(options);}
function composeWithImages({copy,images,owner,requiredImageIds,from,to,senderName,messageId=randomUUID(),now=new Date()},validatedImages,encodedImages){
 if(!copy||copy.sendingEnabled!==false||!emailIdentity(from)||!emailIdentity(to)||/[^\x21-\x7E]/.test(from+to)||!String(copy.subject||'').trim()||typeof copy.body!=='string'||copy.body.length>20000||!String(senderName||'').trim()||!/^[-A-Za-z0-9_]{1,100}$/.test(messageId)||Number.isNaN(new Date(now).getTime()))fail('MAIL_PREVIEW_INVALID','발신자·수신자·본문을 확인해야 합니다.');
 if(typeof copy.senderEmail!=='string'||from!==copy.senderEmail.trim().toLowerCase())fail('SENDER_SIGNATURE_MISMATCH','현재 발신 계정과 승인된 Gmail 서명이 일치하지 않습니다.');
 if(copy.attachments?.length)fail('UNEXPECTED_ATTACHMENTS','일반 첨부를 추가하지 않습니다.');
 const {checked,html,text}=inlineContent({copy,images,owner,requiredImageIds},validatedImages);
 const boundary='sanji_alt_'+messageId,related='sanji_related_'+messageId;
 const lines=[`From: ${encodedHeader(senderName)} <${from}>`,`To: ${to}`,`Subject: ${encodedHeader(copy.subject)}`,`Date: ${new Date(now).toUTCString()}`,`Message-ID: <${messageId}@sanji.local>`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',encoded(text),`--${boundary}`,`Content-Type: multipart/related; boundary="${related}"; type="text/html"`,'',`--${related}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',encoded(html)];
 for(const [index,image] of checked.entries())lines.push(`--${related}`,'Content-Type: image/png',`Content-ID: <${image.cid}>`,`Content-Disposition: inline; filename="${image.name}"`,'Content-Transfer-Encoding: base64','',encodedImages?.[index]??encoded(image.bytes));
 lines.push(`--${related}--`,`--${boundary}--`,'');const mime=lines.join('\r\n');if(Buffer.byteLength(mime)>20*1024*1024)fail('MAIL_TOO_LARGE','메일 본문 크기를 확인해야 합니다.');
 return {raw:Buffer.from(mime).toString('base64url'),html,text,imageCount:checked.length,imageBytes:checked.reduce((n,x)=>n+x.bytes.length,0),mimeBytes:Buffer.byteLength(mime),sendingEnabled:false};
}
