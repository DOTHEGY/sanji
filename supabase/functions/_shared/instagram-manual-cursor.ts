// Random references are sensitive short-lived tokens, not standalone authorization: JWT owner/account and DB anchor are revalidated.
// Only a SHA-256 hash is stored. Tokens/POST bodies must not be logged.
const ERROR='저장 목록이 변경되었거나 이어보기 기한이 지났습니다. 처음부터 다시 확인하세요.';
const enc=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
export function manualCursor(sb:any,query:any){
 async function issue(data:any){const token=enc(crypto.getRandomValues(new Uint8Array(32))),hash=await digest(token),ok=await query(sb.rpc('sanji_ig_manual_cursor_issue',{p_owner:data.owner,p_account:data.account,p_kind:data.kind,p_creator:data.creator||null,p_creator_generation:data.creatorGeneration||null,p_hash:hash,p_payload:data}));if(ok!==true)throw Error(ERROR);return token;}
 async function read(token:any,expected:any){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error(ERROR);const value=await query(sb.rpc('sanji_ig_manual_cursor_take',{p_owner:expected.owner,p_account:expected.account,p_kind:expected.kind,p_hash:await digest(token)}));if(!value||typeof value!=='object'||Array.isArray(value))throw Error(ERROR);for(const [k,v] of Object.entries(expected))if(value[k]!==v)throw Error(ERROR);return value;}
 return {issue,read,error:ERROR};
}
