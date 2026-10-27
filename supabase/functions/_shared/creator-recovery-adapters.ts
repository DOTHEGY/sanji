// Adapters are opt-in: no provider credentials, scheduled fetches, or paid calls live here.
export function providerError(status:number,code?:number){
 if(status===401||code===190)return {state:'login_expired',retry:false,message:'공식 인증 만료 · 다시 연결 필요'};
 if(status===429||code===4||code===17||code===32||code===613)return {state:'rate_limited',retry:false,message:'제공자 조회 제한 · 자동 우회·재시도 중지'};
 if(status===403||code===10||code===200)return {state:'permission_required',retry:false,message:'공식 권한 또는 계정 유형 확인 필요'};
 return {state:'unavailable',retry:false,message:'프로필 조회 실패 · 확인 필요'};
}
export function shouldRefresh(lastVerified:string|null,now=Date.now(),days=30){return !lastVerified||!Number.isFinite(Date.parse(lastVerified))||Date.parse(lastVerified)<now-days*86400000;}
// Facebook Login Business Discovery requires an authorized professional IG account and named professional target.
// Do not use this endpoint for personal accounts, unknown handles, email inference, or broad discovery.
export async function instagramBusinessDiscovery({accountId,token,handle,request=fetch,version='v24.0'}:any){
 if(!/^\d+$/.test(String(accountId))||!/^v\d+\.\d+$/.test(version)||!/^[a-z0-9._]{1,30}$/i.test(handle)||!token)throw Error('공식 계정·권한 연결 필요');
 const url=new URL(`https://graph.facebook.com/${version}/${accountId}`);url.searchParams.set('fields',`business_discovery.username(${handle}){username,followers_count,media_count,biography,website}`);
 try{const response=await request(url.toString(),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});const data=await response.json();if(!response.ok||data.error)return {...providerError(response.status,data.error?.code),checkedAt:new Date().toISOString()};const p=data.business_discovery;if(!p||String(p.username||'').toLowerCase()!==handle.toLowerCase())return {...providerError(404),checkedAt:new Date().toISOString()};return {state:'verified',handle:p.username,followers:Number.isInteger(p.followers_count)&&p.followers_count>=0?p.followers_count:null,mediaCount:Number.isInteger(p.media_count)&&p.media_count>=0?p.media_count:null,biography:typeof p.biography==='string'?p.biography.slice(0,4000):null,website:typeof p.website==='string'?p.website.slice(0,2000):null,source:'Meta Business Discovery',checkedAt:new Date().toISOString(),emailStatus:'기존 소개란 유지 · 이 API에서 이메일 미확인'};}catch{return {...providerError(0),checkedAt:new Date().toISOString()};}
}
// The caller supplies a provider-approved page reader and transactional saveCheckpoint.
// Never supplies Tagby endpoints, cookies, hidden data, or login-challenge bypasses.
export async function importAuthorizedPage({cursor=null,maxRows=20,readPage,saveCheckpoint}:any){
 if(!Number.isInteger(maxRows)||maxRows<1||maxRows>20)throw Error('검증 단계는 최대 20명입니다.');
 let page:any;try{page=await readPage(cursor,maxRows);}catch(e:any){return {status:e?.code==='LOGIN_EXPIRED'?'login_expired':'failed',cursor,processed:0};}
 if(page?.challenge||page?.rateLimited)return {status:page.challenge?'login_expired':'rate_limited',cursor,processed:0};
 if(!Array.isArray(page?.rows)||page.rows.length>maxRows)return {status:'failed',cursor,processed:0};
 const rows=page.rows.filter((r:any)=>/^[a-z0-9._]{1,30}$/i.test(r.handle||''));
 // Rows and next cursor are committed by one caller-controlled transaction.
 try{await saveCheckpoint(rows,page.nextCursor??null);}catch{return {status:'save_failed',cursor,processed:0};}
 return {status:page.nextCursor?'partial':'complete',cursor:page.nextCursor??null,processed:rows.length};
}
// A failed lookup cannot erase prior evidence. A link is accepted only when the provider
// has confirmed both its source and the exact username; constructing one is insufficient.
export function mergeObservation(previous:any,observation:any){
 if(observation?.state!=='verified')return {...previous,lookup_state:observation?.state||'unavailable',lookup_checked:observation?.checkedAt||new Date().toISOString()};
 if(String(observation.handle||'').toLowerCase()!==String(previous.handle||'').toLowerCase())throw Error('계정 아이디 불일치');
 const patch:any={lookup_state:'verified',lookup_checked:observation.checkedAt,last_verified:observation.checkedAt};
 if(Number.isInteger(observation.followers)&&observation.followers>=0)patch.followers=observation.followers;
 if(observation.profileUrl){const u=new URL(observation.profileUrl),expected='/'+String(previous.handle).toLowerCase();if(!/^https:$/.test(u.protocol)||!['instagram.com','www.instagram.com'].includes(u.hostname)||u.pathname.replace(/\/$/,'').toLowerCase()!==expected||observation.sourceVerified!==true)throw Error('공식 프로필 근거 불일치');patch.profile_url=u.toString();patch.link_status='source_confirmed';}
 // No bio is returned by the documented fields requested above: retain historical emails.
 return {...previous,...patch};
}
