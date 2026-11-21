import {WEDDING_PROJECT, weddingRows} from './youtube-wedding-model.mjs';

const table='sanji_private_wedding_contacts';
const fields='owner,channel_id,email,source_url,source_kind,verified_at,expires_at';
const emailPattern=/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?[.][A-Za-z]{2,63}$/;
const roleBlock=/^(?:noreply|no-reply|privacy|abuse|careers|recruit|legal|support)@/i;
const officialYouTubeHosts=new Set(['youtube.com','www.youtube.com','m.youtube.com']);
const error=()=>Error('Project contact evidence unavailable');
const canonicalChannel=/^UC[A-Za-z0-9_-]{22}$/;
const canonicalVideo=/^[A-Za-z0-9_-]{11}$/;

function source(raw, kind, channelID, videoID){
  if(typeof raw!=='string'||raw.length>1000||!/^https:\/\/[\w.-]+(?:[/?#]|$)/.test(raw)||/[<>\\\s]/.test(raw))throw error();
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||
    /^\d+\./.test(url.hostname)||url.hostname.endsWith('.')||/\.(local|localhost|internal)$/i.test(url.hostname))throw error();
  if(kind==='official_channel'){
    if(!officialYouTubeHosts.has(url.hostname)||url.search||url.hash||
      !new Set(['/channel/'+channelID, '/channel/'+channelID+'/about']).has(url.pathname.replace(/\/$/,'')))throw error();
  }else if(kind==='official_video'){
    if(!canonicalVideo.test(videoID||'')||raw!=='https://www.youtube.com/watch?v='+videoID)throw error();
  }else if(kind!=='official_website'||/(^|[.])(youtube[.]com|youtu[.]be)$/i.test(url.hostname))throw error();
  return url.href;
}

export function verifiedContactsForDay(rows,day='',now=Date.now()){
  return rows.filter(row=>(!day||row.projectDay===day)&&Date.parse(row.verifiedAt)<=now&&Date.parse(row.expiresAt)>now);
}

/** Owner/epoch guard is supplied by the standalone authenticated view; no writes, RPCs or sends. */
export async function readVerifiedProjectContacts({client,owner,shortlist,current,now=Date.now}){
  if(!owner||typeof current!=='function'||!current())return null;
  const scoped=weddingRows(shortlist,owner);
  if(scoped.length!==shortlist.length||scoped.length>2100||scoped.some(row=>row.projectId!==WEDDING_PROJECT.id||!canonicalChannel.test(row.channelID)))throw error();
  const byChannel=new Map(scoped.map(row=>[row.channelID,row]));
  if(byChannel.size!==scoped.length)throw error();
  if(!scoped.length)return [];
  const contactByChannel=new Map(), duplicated=new Set(), seenEmail=new Set();
  // Fixed bounded sets, no unbounded scrape or wildcard contact query.
  for(let i=0;i<scoped.length;i+=50){
    if(!current())return null;
    const ids=scoped.slice(i,i+50).map(r=>r.channelID), requested=new Set(ids);
    const result=await client.from(table).select(fields).eq('owner',owner).in('channel_id',ids).limit(ids.length+1);
    if(!current())return null;
    if(result.error||!Array.isArray(result.data)||result.data.length>ids.length)throw error();
    for(const row of result.data){
      if(row?.owner!==owner||!requested.has(row.channel_id)||contactByChannel.has(row.channel_id))throw error();
      const verified=Date.parse(row.verified_at), expires=Date.parse(row.expires_at);
      if(!Number.isFinite(verified)||!Number.isFinite(expires)||expires<=verified)throw error();
      const address=row.email;
      if(typeof address!=='string'||address.length>254||!emailPattern.test(address)||roleBlock.test(address))throw error();
      const sourceUrl=source(row.source_url,row.source_kind,row.channel_id,byChannel.get(row.channel_id)?.videoID);
      const addressKey=address.toLowerCase();
      if(seenEmail.has(addressKey))duplicated.add(addressKey);
      seenEmail.add(addressKey);
      contactByChannel.set(row.channel_id,{email:address,sourceUrl,verifiedAt:row.verified_at,expiresAt:row.expires_at});
    }
  }
  if(!current())return null;
  return verifiedContactsForDay(scoped.flatMap(row=>{
    const contact=contactByChannel.get(row.channelID);
    return contact&&!duplicated.has(contact.email.toLowerCase())?[{...row,...contact}]:[];
  }),'',now());
}
