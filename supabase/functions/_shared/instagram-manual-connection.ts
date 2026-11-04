// Fingerprints are internal transient comparison values. Never return them to clients or log them.
async function connectionRecord({sb,query}:any,owner:string,provider:string){
 const row=await query(sb.from('sanji_connections').select('encrypted').eq('owner',owner).eq('provider',provider).maybeSingle());
 if(!row)return null;if(typeof row.encrypted!=='string')throw Error('connection unavailable');return row;
}
async function fingerprint(encrypted:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encrypted))),x=>x.toString(16).padStart(2,'0')).join('');}
export async function readManualConnectionFingerprint(deps:any,owner:string,provider:string){const row=await connectionRecord(deps,owner,provider);return row?fingerprint(row.encrypted):null;}
export async function readManualConnection(deps:any,owner:string,provider:string){
 const row=await connectionRecord(deps,owner,provider);if(!row)return null;const bytes=Uint8Array.from(atob(row.encrypted),c=>c.charCodeAt(0));
 const decoded=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},await deps.key(),bytes.subarray(12))));
 return {...decoded,connectionFingerprint:await fingerprint(row.encrypted)};
}
