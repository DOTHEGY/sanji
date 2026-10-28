// New discoveries only. This module plans dates; it neither authorizes nor sends mail.
export function brandNextWeekdayNine(discoveredAt:string|Date):string {
 const instant=new Date(discoveredAt);if(!Number.isFinite(instant.getTime()))throw Error('발견 시각을 확인하세요.');
 // Korea Standard Time has no daylight-saving transitions.
 const local=new Date(instant.getTime()+9*3600000),weekday=local.getUTCDay();
 const days=weekday===5?3:weekday===6?2:1;
 const at=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+days,0,0,0);
 return new Date(at).toISOString();
}

// If background processing is delayed past the planned time, never dispatch immediately.
export function brandNextSafeSlot(discoveredAt:string|Date,now:string|Date):string {
 const initial=brandNextWeekdayNine(discoveredAt),current=new Date(now);
 if(!Number.isFinite(current.getTime()))throw Error('현재 시각을 확인하세요.');
 if(Date.parse(initial)>current.getTime())return initial;
 const local=new Date(current.getTime()+9*3600000),weekday=local.getUTCDay();
 let days=weekday===6?2:weekday===0?1:0;
 if(days===0&&local.getUTCHours()>=9)days=weekday===5?3:1;
 return new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+days,0)).toISOString();
}
