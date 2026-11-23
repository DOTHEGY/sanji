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

export function decodeWeddingSubscriberRefresh(value){
 const counts=['total','eligible','belowMinimum','unknown','materialized'];
 if(value?.projectId!==WEDDING_PROJECT.id||value.subscriberMinimum!==WEDDING_SUBSCRIBER_MINIMUM||
    counts.some(k=>!Number.isSafeInteger(value[k])||value[k]<0||value[k]>100)||
    value.eligible+value.belowMinimum+value.unknown!==value.total||value.materialized!==value.total)return null;
 return Object.fromEntries(counts.map(k=>[k,value[k]]));
}
export function subscriberRefreshError(code){
 switch(code){
  case 'SCOPE':return '이 계정의 더파티움 프로젝트 권한으로만 구독자 수를 확인할 수 있습니다.';
  case 'SUBSCRIBER_SCOPE':return '현재 더파티움 목록의 확인 범위를 읽을 수 없습니다.';
  case 'YOUTUBE_NOT_CONFIGURED':return 'YouTube 조회 연결이 준비되지 않았습니다. 기존 확인 기록은 그대로 표시합니다.';
  case 'YOUTUBE_SUBSCRIBERS_UNVERIFIED':return 'YouTube에서 구독자 수를 확인하지 못했습니다. 기존 확인 기록은 그대로 표시합니다.';
  default:return '구독자 확인 결과를 검증하지 못했습니다. 목록을 새로고침해 확인해 주세요.';
 }
}
