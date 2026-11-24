const projectId='private-wedding-research';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ownerMismatch=()=>Error('Inactive Partyum owner session');
const num=x=>Number.isSafeInteger(x)&&x>=0&&x<=50;
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))
 &&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;

function project(data){
 if(data?.projectId!==projectId||!validDay(data.day))throw Error('Unverified Partyum result');
 const {mode,day}=data;
 if(mode==='refresh_day'){
  const {total,updated}=data;
  if(!num(total)||total!==updated)throw Error('Unverified Partyum result');
  return {mode,day,total,updated};
 }
 if(!['dry_run','pilot','enroll_batch'].includes(mode))throw Error('Unverified Partyum result');
 const {qualified,scanned,enrolled,held,already,dailyCap}=data;
 if(![qualified,scanned,enrolled,held,already,dailyCap].every(num)||scanned!==qualified+held||
  (mode!=='enroll_batch'&&scanned>2) ||
  (mode==='dry_run' ? enrolled+already+dailyCap!==0:qualified!==enrolled+already+dailyCap))throw Error('Unverified Partyum result');
 return {mode,day,qualified,scanned,enrolled,held,already,dailyCap};
}

/** Local owner-only UI adapter, not connected to production. Call ONLY from an
 * intentional owner button, with existing private shell's member/getSession
 * functions. No tokens returned, stored, copied, prefilled or used unattended. */
export function createOwnerPartyumResearchClient({member,getSession,supabaseUrl,supabaseKey,request=fetch}){
 if(typeof member!=='function'||typeof getSession!=='function'||typeof supabaseKey!=='string'||!supabaseKey)throw ownerMismatch();
 const status=new URL('/functions/v1/youtube-wedding-day-status',supabaseUrl);
 if(status.protocol!=='https:'||status.username||status.password||status.port||!status.hostname.endsWith('.supabase.co'))throw ownerMismatch();
 return async ({owner,operationId,stillActive})=>{
  if(typeof owner!=='string'||!UUID.test(owner)||typeof operationId!=='string'||!UUID.test(operationId)||typeof stillActive!=='function'||!stillActive())throw ownerMismatch();
  const verified=await member();
  const latest=await getSession(), session=latest?.data?.session;
  if(latest?.error||verified?.user?.id!==owner||session?.user?.id!==owner||!verified.access_token||
     session.access_token!==verified.access_token||!stillActive())throw ownerMismatch();
  const response=await request(status,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(60000),
   headers:{apikey:supabaseKey,Authorization:'Bearer '+verified.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({action:'research_supervised',projectId,operationId}),
  });
  if(!stillActive())throw ownerMismatch();
  const body=await response.json().catch(()=>null);
  if(!stillActive())throw ownerMismatch();
  if(!response.ok)throw Error(response.status===403?'Partyum scope rejected':'Unverified Partyum result; reconcile before trying again');
  return project(body);
 };
}
