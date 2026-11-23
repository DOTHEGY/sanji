import {WEDDING_PROJECT} from './youtube-wedding-model.mjs';
import {validDay,dayStatusText} from './youtube-project-day-status.mjs';

const allowedStates=new Set(['found_only','scheduled','sent','failed','unknown']);
const channelPattern=/^UC[A-Za-z0-9_-]{22}$/;
export const MAX_WEDDING_STATUS_IDS=100;
export const WEDDING_SUBSCRIBER_MINIMUM=50_000;
export function decodeWeddingSubscriberProof(item){
 const number=item?.subscriberCount;
 if(!Number.isSafeInteger(number)||number<0)return {subscriberEligibility:'unknown',subscriberCount:null};
 const state=number>=WEDDING_SUBSCRIBER_MINIMUM?'eligible':'below_minimum';
 return item.subscriberEligibility===state
  ?{subscriberEligibility:state,subscriberCount:number}:{subscriberEligibility:'unknown',subscriberCount:null};
}
export function decodeWeddingStatus(body,{owner,day,channelIds}){
 if(!owner||!validDay(day)||!Array.isArray(channelIds)||channelIds.length>MAX_WEDDING_STATUS_IDS||
    body?.projectId!==WEDDING_PROJECT.id||body.day!==day||!Array.isArray(body.items)||body.items.length>channelIds.length)return new Map();
 const requested=new Set(channelIds),items=new Map(),dupes=new Set();
 for(const x of body.items){
  if(!requested.has(x?.channelId)||!channelPattern.test(x.channelId)||dupes.has(x.channelId))continue;
  if(items.has(x.channelId)){items.delete(x.channelId);dupes.add(x.channelId);continue;}
  const state=allowedStates.has(x.status)&&(x.status!=='found_only'||x.completeForCandidate===true)
   ?dayStatusText({status:x.status,at:x.at}).state:'unknown';
  items.set(x.channelId,{owner,projectId:WEDDING_PROJECT.id,day,channelID:x.channelId,status:state,at:state===x.status?x.at:null,completeForCandidate:x.completeForCandidate===true,...decodeWeddingSubscriberProof(x)});
 }
 return items;
}
