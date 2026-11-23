import {dayStatusText, validDay} from './youtube-project-day-status.mjs';
import {WEDDING_PROJECT} from './youtube-wedding-model.mjs';

const channelId = /^UC[A-Za-z0-9_-]{22}$/;

/** Keep dates and state linked to this project's verified shortlist, never email alone. */
export function weddingDayGroups({owner,rows,verified,statusByDay,day=''}){
 if(typeof owner!=='string'||!owner)return [];
 const projectRows=rows.filter(x=>x?.owner===owner&&x.projectId===WEDDING_PROJECT.id&&channelId.test(x.channelID)&&validDay(x.projectDay)&&(!day||day===x.projectDay));
 const contacts=new Map((verified??[]).filter(x=>x?.owner===owner&&x.projectId===WEDDING_PROJECT.id).map(x=>[x.channelID,x]));
 const groups=new Map();
 for(const row of projectRows){
   const g=groups.get(row.projectDay)??{day:row.projectDay,active:[],history:[],counts:{found_only:0,scheduled:0,sent:0,failed:0,unknown:0}};
   groups.set(row.projectDay,g);
   const contact=contacts.get(row.channelID);
   const entry=contact?.projectDay===row.projectDay?contact:null;
   const proof=statusByDay?.get(row.projectDay)?.get(row.channelID);
   const status=dayStatusText(proof?.owner===owner&&proof.projectId===WEDDING_PROJECT.id&&proof.channelID===row.channelID&&proof.day===row.projectDay&&
     (proof.status!=='found_only'||proof.completeForCandidate===true)?proof:null);
   g.counts[status.state]++;
   (entry?g.active:g.history).push({row,contact:entry,status});
 }
 return [...groups.values()].sort((a,b)=>b.day.localeCompare(a.day));
}
