const project='gs-bbangteojineunjip-chewy-bread';
export function validateProjectScope(scope){
 if(!scope||Object.keys(scope).some(k=>!['projectId','day'].includes(k))||scope.projectId!==project||typeof scope.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(scope.day))throw Error('PROJECT_SCOPE_INVALID');
 const date=new Date(scope.day+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==scope.day)throw Error('PROJECT_SCOPE_INVALID');return {projectId:project,day:scope.day};
}
export function belongsToProjectDay(data,scope){
 const valid=validateProjectScope(scope),members=Array.isArray(data?.youtubeResearch?.projects)?data.youtubeResearch.projects.filter(x=>x?.id===valid.projectId):[];
 if(members.length!==1)return false;const m=members[0],added=Date.parse(m.addedAt);if(!Number.isFinite(added))return false;
 let day;if(m.assignedDay!==undefined){if(typeof m.assignedDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.assignedDay))return false;day=m.assignedDay;}else day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(added));return day===valid.day;
}
