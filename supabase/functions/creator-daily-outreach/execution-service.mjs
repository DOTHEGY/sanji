import {buildDailyOutreachBatch,outreachDay,OutreachError} from './domain.mjs';
const fail=code=>{throw new OutreachError(code,'후보 준비 페이지를 완료하지 못했습니다. 저장된 상태를 확인하세요.',503);};
// One bounded page per call. Cursors belong to the server's previous committed
// summary, never HTTP body/query inputs. Unknown save results are not retried.
export function createExecutionPreparation({repository,execution,enrichment,now=()=>Date.now()}){
 return {async prepare(owner){
  const day=outreachDay(now()),existing=await repository.findRun(owner,day);
  const previous=existing?null:await repository.latest(owner);
  const loaded=await execution.page(owner,{existing,previous});
  if(loaded?.complete!==true||!Array.isArray(loaded.candidates)||loaded.candidates.length>60)fail('EXECUTION_PAGE_INCOMPLETE');
  const enriched=await enrichment.enrich(owner,{candidates:loaded.candidates});
  if(enriched?.complete!==true||!Array.isArray(enriched.candidates)||enriched.candidates.length!==loaded.candidates.length)fail('CONTACT_ENRICHMENT_INCOMPLETE');
  // Global saved history is checked AFTER current contact enrichment, so a newly
  // found Gmail alias/shared agency mailbox cannot evade duplicate detection.
  const history=await execution.historyFor(owner,enriched.candidates);
  const plan=buildDailyOutreachBatch({candidates:enriched.candidates,history,now:now()});
  const result=await execution.savePage(owner,plan,loaded);
  if(!result||result.day!==day||result.sendingEnabled!==false||!result.executionProgress||typeof result.morePreparationRequired!=='boolean')fail('SAVE_UNCERTAIN');
  return result;
 }};
}
