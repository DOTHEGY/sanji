import {PROJECT} from './partyum-mail.mjs';
// Reads old Sanji project markers only. It cannot attribute undocumented, untagged,
 // or separately sent Gmail to a Partyum candidate. Do not falsely certify before
 // checking operations policy and all recognized Partyum writers.
export async function readPartyumHoldingLegacyEvidence(q,x){
 if(x?.projectId!==PROJECT||!Array.isArray(x.channelIds)||x.channelIds.length>100)return {complete:false};
 const keys=x.channelIds.map(id=>'youtube:'+id);
 const {rows:[r]}=await q.query(`select
    exists(select 1 from public.sanji_youtube_manual_batches where owner=$1 and review#>>'{scope,projectId}'=$2) as batches,
    exists(select 1 from public.sanji_drafts where owner=$1 and (data->>'projectId'=$2 or data#>>'{scope,projectId}'=$2)) as drafts,
    exists(select 1 from public.sanji_outbox where owner=$1 and channel='email' and data->>'projectId'=$2
      and (data->>'creatorKey' is null or data->>'creatorKey'=any($3::text[]))) as outbox,
    exists(select 1 from public.sanji_records where owner=$1 and kind='thread' and data->>'projectId'=$2
      and (data->>'creatorKey' is null or data->>'creatorKey'=any($3::text[]))) as thread`,[x.actor,PROJECT,keys]);
 if(!r||[r.batches,r.drafts,r.outbox,r.thread].some(v=>v!==false))return {complete:false};
 return {complete:true,channels:[]};
}
