// Store fixed classifications only; never persist provider payload or credential fragments.
export function gmailFailure(error:any,previous:any={},now=Date.now()){
 if(error?.code==='GMAIL_REAUTH_REQUIRED')return {status:'reauth_required',reauthRequired:true,error:'Gmail 인증이 만료되거나 취소됐습니다. 다시 연결해 주세요.',attempts:0,retryAt:null};
 const attempts=Math.min(10,Math.max(0,Number(previous?.attempts)||0)+1),delay=Math.min(30,2**(attempts-1))*60000;
 return {status:'temporarily_unavailable',reauthRequired:false,error:'Gmail 연결에 일시적인 오류가 발생했습니다.',attempts,retryAt:new Date(now+delay).toISOString()};
}
export function gmailSyncPaused(result:any,now=Date.now()){
 if(result?.reauthRequired)return {status:'reauth_required',imported:0};
 if(result?.retryAt&&Date.parse(result.retryAt)>now)return {status:'backoff',imported:0,retryAt:result.retryAt};
 return null;
}

export function isRevokedGoogleRefresh(url:string,body:any,response:any){return url==='https://oauth2.googleapis.com/token'&&body instanceof URLSearchParams&&body.get('grant_type')==='refresh_token'&&response?.error==='invalid_grant';}
