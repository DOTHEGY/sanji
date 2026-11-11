import {emailIdentity} from '../supabase/functions/creator-daily-outreach/domain.mjs';
import {FIRST_PROJECT,projectMemberships,projectDay,sourcedEmail} from './youtube-projects.mjs';

// Local review only. This function neither stores reservations nor sends mail.
export function tomorrowTenSeoul(now){
 const ms=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(ms))throw Error('현재 시각을 확인할 수 없습니다.');
 const seoul=new Date(ms+9*3600000);
 return new Date(Date.UTC(seoul.getUTCFullYear(),seoul.getUTCMonth(),seoul.getUTCDate()+1,1)).toISOString();
}
export function reviewProjectReservation({rows,projectId,day,excludedIds=[],now}){
 if(projectId!==FIRST_PROJECT.id||!Array.isArray(rows)||!Array.isArray(excludedIds)||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('프로젝트와 날짜를 확인하세요.');
 const excluded=new Set(excludedIds),inProject=rows.filter(r=>projectMemberships(r?.data).some(p=>p.id===projectId));
 const blockedProfiles=new Set(),blockedEmails=new Set();
 const channelId=profile=>String(profile||'').match(/^https:\/\/(?:www\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1]||'';
 for(const r of inProject.filter(r=>excluded.has(r.id))){const leads=[r.data?.contact,...(Array.isArray(r.data?.youtubeResearch?.businessContacts)?r.data.youtubeResearch.businessContacts:[])],channel=channelId(r.data?.profile);for(const lead of leads){const email=emailIdentity(lead?.email);if(email)blockedEmails.add(email);}if(channel)blockedProfiles.add(channel);}
 const seenProfiles=new Set(),seenEmails=new Set(),candidates=[],held=[];
 for(const row of inProject){const m=projectMemberships(row.data).find(p=>p.id===projectId);if(projectDay(m)!==day)continue;const profile=String(row.data?.profile||'').replace(/\/$/,''),email=sourcedEmail(row.data),key=emailIdentity(email),audience=row.data?.followers;
  if(excluded.has(row.id)||blockedProfiles.has(channelId(profile))||(key&&blockedEmails.has(key)))continue;
  if(!/^https:\/\/(?:www\.)?youtube\.com\/channel\/UC[A-Za-z0-9_-]{22}$/.test(profile)||!Number.isSafeInteger(audience)||audience<30000||audience>200000||!key){held.push(row.id);continue;}
  const channel=profile.split('/').pop();if(seenProfiles.has(channel)||seenEmails.has(key)){held.push(row.id);continue;}seenProfiles.add(channel);seenEmails.add(key);candidates.push({id:row.id,version:row.version,name:row.data.name,email});
 }
 return {runAt:tomorrowTenSeoul(now),projectId,day,candidates,held,reviewOnly:true};
}
