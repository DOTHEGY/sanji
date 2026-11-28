// Use Seoul wall-clock inputs, not the operator's browser timezone.
export const MAX_WEDDING_SCHEDULE_MS=30*86400000;
export function validWeddingScheduleAt(value,now){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)||!Number.isFinite(now))return false;
 const ms=Date.parse(value);
 return Number.isFinite(ms)&&new Date(ms).toISOString()===value&&ms>now&&ms<=now+MAX_WEDDING_SCHEDULE_MS;
}
export function weddingScheduleAtKst(day,time,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
 const wall=day+'T'+time+':00.000Z',ms=Date.parse(wall);
 if(!Number.isFinite(ms)||new Date(ms).toISOString()!==wall)return null;
 const utc=new Date(ms-9*3600000).toISOString();
 return validWeddingScheduleAt(utc,now)?utc:null;
}
