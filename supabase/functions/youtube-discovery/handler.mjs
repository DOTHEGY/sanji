import {businessContacts,validateBusinessRequest,REVIEWED_BUSINESS_SOURCES,MANUAL_BUSINESS_SOURCES} from './business-contacts.mjs';
import {discover,searchPlan,DiscoveryError} from './discovery.mjs';
export function youtubeDiscoveryHandler({sb,env,fetchImpl=fetch,now=()=>Date.now(),businessSources=REVIEWED_BUSINESS_SOURCES}) {
  // Best-effort per-isolate pacing; provider/project quota remains the global cap.
  const attempts = new Map();
  const active = new Set();
  return async function handler(req) {
    const origin=req.headers.get('Origin');
    const allowed=(env('APP_ORIGIN') || 'https://dothegy.github.io').split(',').map(s=>s.trim());
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    if(origin && !allowed.includes(origin)) return new Response(JSON.stringify({error:'허용되지 않은 출처입니다.',code:'ORIGIN_DENIED'}),{status:403,headers});
    if(origin) headers['Access-Control-Allow-Origin']=origin;
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    let owner;
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    try {
      const token=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')||'')?.[1];
      if(!token) throw new DiscoveryError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
      const auth=await sb.auth.getUser(token);
      owner=auth?.data?.user?.id;
      if(auth.error || !owner) throw new DiscoveryError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
      const membership=await sb.from('sanji_members').select('user_id').eq('user_id',owner).maybeSingle();
      if(membership.error || membership.data?.user_id!==owner) throw new DiscoveryError(403,'MEMBERSHIP_REQUIRED','Sanji 관리자 권한이 필요합니다.');
      const path=new URL(req.url).pathname.replace(/^.*\/youtube-discovery/,'');
      if(path==='/status' && req.method==='GET') return json({available:env('YOUTUBE_DISCOVERY_ENABLED')==='true' && !!env('YOUTUBE_API_KEY'),apiKeyConfigured:!!env('YOUTUBE_API_KEY'),enabled:env('YOUTUBE_DISCOVERY_ENABLED')==='true',contactHarvesting:false,sendingEnabled:false,pinnedCommentsSupported:false,businessContactAutoSources:businessSources.length,manualBusinessSources:MANUAL_BUSINESS_SOURCES});
      if(!['/search','/business-contacts'].includes(path) || req.method!=='POST') throw new DiscoveryError(404,'NOT_FOUND','지원하지 않는 요청입니다.');
      if(path==='/search' && env('YOUTUBE_DISCOVERY_ENABLED')!=='true') throw new DiscoveryError(503,'YOUTUBE_DISABLED','YouTube 검색 기능은 아직 활성화되지 않았습니다.');
      const tooLarge=()=>new DiscoveryError(413,'BODY_TOO_LARGE','입력이 너무 깁니다.');
      if(Number(req.headers.get('Content-Length'))>4096) throw tooLarge();
      const reader=req.body?.getReader(), chunks=[]; let bytes=0;
      if(reader) try {
        while(true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>4096) {await reader.cancel();throw tooLarge();} chunks.push(value); }
      } finally {reader.releaseLock();}
      const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
      const text=new TextDecoder().decode(buffer);
      let body; try {body=JSON.parse(text);} catch {throw new DiscoveryError(400,'INVALID_JSON','입력 형식이 올바르지 않습니다.');}
      if(path==='/search') searchPlan(body); else validateBusinessRequest(body);
      if(active.has(owner) || (attempts.has(owner) && now()-attempts.get(owner)<30000)) throw new DiscoveryError(429,'SEARCH_RATE_LIMIT','검색은 30초 간격으로 실행하세요.');
      for(const [id,at] of attempts) if(now()-at>60000) attempts.delete(id);
      attempts.set(owner,now()); active.add(owner);
      try {return json(path==='/search'?await discover(body,{apiKey:env('YOUTUBE_API_KEY'),fetchImpl,now}):await businessContacts(body,{sources:businessSources,fetchImpl,now}));}
      finally {active.delete(owner);}
    } catch(error) {
      if(error instanceof DiscoveryError) return json({error:error.message,code:error.code},error.status);
      return json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 확인하세요.',code:'INTERNAL_ERROR'},500);
    }
  };
}
