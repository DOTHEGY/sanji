// Server-only Node HTTPS transport. No browser fetch, proxy, cookie jar or credentials.
import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
export class ContactNetworkError extends Error {constructor(code){super(code);this.code=code;}}
const reject=code=>{throw new ContactNetworkError(code);};
const forbidden=/(^|\.)(?:localhost|local|internal|test|invalid|onion|youtube\.com|youtube-nocookie\.com|youtu\.be|google\.com|googleapis\.com|googleusercontent\.com|instagram\.com|facebook\.com|fb\.com|meta\.com|tiktok\.com)$/i;
export function publicOfficialUrl(value){
 if(typeof value!=='string'||value.length>1000||/[\s\\\x00-\x1f\x7f]/.test(value))reject('source_url_invalid');
 let u;try{u=new URL(value);}catch{reject('source_url_invalid');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||isIP(u.hostname)||forbidden.test(u.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)||u.href!==value)reject('source_url_invalid');
 return u.href;
}
export function publicIpv4(value){
 if(isIP(value)!==4)return false;
 const [a,b,c]=value.split('.').map(Number);
 return !(value==='168.63.129.16'||a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&c<=2||b===88&&c===99||b===175&&c===48||b===52&&c===193||b===31&&c===196)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
// IPv4-only, pinned destination. IPv6-only sources are held, never downgraded to
// an unchecked fetch. All returned A records must be public before any socket opens.
export function createPinnedPublicReader({lookup=dnsLookup,request=httpsRequest}={}){
 return {async read(url,{timeoutMs=8000,maxBytes=262144,signal}={}){
  publicOfficialUrl(url);if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>262144)reject('network_limits_invalid');
  const u=new URL(url),controller=new AbortController();let req,timer;
  const abort=()=>controller.abort(new ContactNetworkError('source_timeout'));
  if(signal?.aborted)reject('source_timeout');signal?.addEventListener('abort',abort,{once:true});
  try{return await new Promise((resolve,rejectPromise)=>{
   const fail=error=>{controller.abort(error);req?.destroy();rejectPromise(error instanceof ContactNetworkError?error:new ContactNetworkError('source_unavailable'));};
   controller.signal.addEventListener('abort',()=>{req?.destroy();rejectPromise(controller.signal.reason||new ContactNetworkError('source_timeout'));},{once:true});
   timer=setTimeout(abort,timeoutMs);
   Promise.resolve().then(()=>lookup(u.hostname,{all:true,family:4,verbatim:true})).then(addresses=>{
    if(controller.signal.aborted)return;
    if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(a=>a.family!==4||!publicIpv4(a.address)))return fail(new ContactNetworkError('source_dns_not_public'));
    const address=addresses[0].address;
    req=request({protocol:'https:',hostname:address,port:443,servername:u.hostname,path:u.pathname,method:'GET',agent:false,rejectUnauthorized:true,maxHeaderSize:16384,
     headers:{Host:u.hostname,Accept:'text/html, text/plain;q=0.8','Accept-Encoding':'identity','User-Agent':'SanjiPublicContactReview/1.0'}},res=>{
      const code=res.statusCode;
      if(code===404||code===410){res.destroy();return fail(new ContactNetworkError('source_removed'));}
      if(code>=300&&code<400){res.destroy();return fail(new ContactNetworkError('source_redirect_denied'));}
      if(code!==200){res.destroy();return fail(new ContactNetworkError(code===401||code===403||code===429?'source_access_denied':'source_unavailable'));}
      const type=String(res.headers['content-type']||'').toLowerCase(),encoding=String(res.headers['content-encoding']||'identity').toLowerCase();
      if(!/^(text\/html|text\/plain)(?:\s*;\s*charset=(?:utf-8|"utf-8"|us-ascii))?\s*$/.test(type)||encoding!=='identity'){res.destroy();return fail(new ContactNetworkError('source_content_type_unsupported'));}
      const declared=res.headers['content-length'];
      if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)>maxBytes)){res.destroy();return fail(new ContactNetworkError('source_too_large'));}
      let bytes=0;const chunks=[];
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy();return fail(new ContactNetworkError('source_too_large'));}chunks.push(chunk);});
      res.on('aborted',()=>fail(new ContactNetworkError('source_unavailable')));res.on('error',fail);
      res.on('end',()=>{if(controller.signal.aborted)return;try{resolve({url,contentType:type.split(';')[0].trim(),text:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),bytes});}catch{fail(new ContactNetworkError('source_encoding_invalid'));}});
     });
    req.on('error',fail);req.on('socket',socket=>socket.once('secureConnect',()=>{if(socket.remoteAddress!==address)fail(new ContactNetworkError('source_peer_mismatch'));}));req.end();
   }).catch(fail);
  });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }};
}
