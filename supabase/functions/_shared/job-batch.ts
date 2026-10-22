// Only drains already-approved, due jobs. A failed/uncertain job is never retried here.
export async function drainApprovedJobs(processOne:()=>Promise<any>,maxJobs=10,budgetMs=45000){
 const started=Date.now(),results=[];
 while(results.length<maxJobs&&Date.now()-started<budgetMs){
  const result=await processOne();if(!result?.processed)break;results.push(result);
 }
 return {processed:results.length,results};
}
