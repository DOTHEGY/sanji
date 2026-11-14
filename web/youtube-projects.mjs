import {youtubeSelectionExclusion} from '../supabase/functions/_shared/mcn-exclusion.mjs';
import {savedEmailDisplay} from './youtube-email-view.mjs';
import {emailIdentity} from '../supabase/functions/creator-daily-outreach/domain.mjs';
// Project membership is explicit and separate from topic collections.
export const FIRST_PROJECT=Object.freeze({id:'gs-bbangteojineunjip-chewy-bread',name:'빵터지는집 쫀득빵 GS 유통',description:'사천마라 쫀득빵 · 크림짬뽕 쫀득빵',dailyGoal:50,minFollowers:30000,maxFollowers:200000});
export function projectMemberships(data){return Array.isArray(data?.youtubeResearch?.projects)?data.youtubeResearch.projects.filter(p=>p&&typeof p.id==='string'&&typeof p.addedAt==='string'&&Number.isFinite(Date.parse(p.addedAt))):[];}
export function addProjectMembership(data,id,addedAt,assignedDay){
 if(typeof id!=='string'||!id||typeof addedAt!=='string'||!Number.isFinite(Date.parse(addedAt)))throw Error('프로젝트 또는 기록 시각을 확인하세요.');
 if(assignedDay!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(assignedDay)||!Number.isFinite(Date.parse(assignedDay))))throw Error('프로젝트 날짜를 확인하세요.');
 const existing=projectMemberships(data);if(existing.some(p=>p.id===id))return null;
 return {...data,youtubeResearch:{...(data.youtubeResearch||{}),projects:[...existing,{id,addedAt,...(assignedDay?{assignedDay}:{})}]}};
}
export function projectDay(membership){return typeof membership?.assignedDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(membership.assignedDay)&&Number.isFinite(Date.parse(membership.assignedDay))?membership.assignedDay:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(membership.addedAt));}
export function sourcedEmail(data){return savedEmailDisplay(data).email;}

export function projectStats(rows,id,day){
 const seen=new Set(),unique=[];
 for(const row of rows){const membership=projectMemberships(row?.data).find(p=>p.id===id);if(!membership)continue;
  const profile=row.data?.profile;if(typeof profile!=='string'||!/^https:\/\/(?:www\.)?youtube\.com\/channel\/UC[A-Za-z0-9_-]{22}\/?$/.test(profile))continue;
  const key=profile.replace(/^https:\/\/(?:www\.)?youtube\.com/,'https://www.youtube.com').replace(/\/$/,'');if(seen.has(key))continue;seen.add(key);unique.push({row,membership});}
 const eligible=unique.filter(x=>!youtubeSelectionExclusion(x.row).excluded),qualified=eligible.filter(x=>Number.isFinite(x.row.data?.followers)&&x.row.data.followers>=FIRST_PROJECT.minFollowers&&x.row.data.followers<=FIRST_PROJECT.maxFollowers);
 const mailSeen=new Set(),withEmail=[];
 for(const x of [...eligible].sort((a,b)=>Date.parse(a.membership.addedAt)-Date.parse(b.membership.addedAt))){const key=emailIdentity(sourcedEmail(x.row.data));if(!key||mailSeen.has(key))continue;mailSeen.add(key);withEmail.push(x);}
 return {count:unique.length,qualified:qualified.length,withEmail:withEmail.length,today:withEmail.filter(x=>projectDay(x.membership)===day).length,rows:unique.map(x=>x.row)};
}
