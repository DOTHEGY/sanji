// Optional, authenticated synthetic-only check. It cannot accept recipient data,
// reserve work, or send mail. One click per mounted control, with no retries.
export function createReservationDiagnostic(){
 let started=false;
 return function mountReservationDiagnostic({container,createElement,isCurrent,run}){
 const button=createElement('button','성능 검사 (샘플 54명 · 발송 없음)'),status=createElement('p','실제 수신자·예약·발송 없이 합성 샘플만 검사합니다.');
 button.type='button';status.setAttribute('role','status');button.disabled=started;if(started)status.textContent='이번 화면에서 이미 검사를 실행했습니다. 서버 상태를 확인하기 전 다시 실행하지 마세요.';
 button.addEventListener('click',async()=>{
  if(started||!isCurrent())return;started=true;button.disabled=true;
  status.textContent='합성 샘플 검사 중입니다. 다시 누르지 마세요.';
  try{
   const result=await run();if(!isCurrent())return;
   if(result?.syntheticOnly!==true||result.ok!==true||result.recipients!==54||result.allHashesMatch!==true||result.databaseCalls!==0||result.providerCalls!==0||result.atomicMockCalls!==1)throw Error('unverified');
   status.textContent='샘플 54명 해시 일치 · DB·발송 호출 없음. 운영 예약 전 서버 CPU 로그를 확인해야 합니다.';
  }catch{if(isCurrent())status.textContent='검사 실패 또는 결과 미확인입니다. 서버 상태를 확인하기 전 다시 실행하지 마세요.';}
 });
 container.append(button,status);return {button,status};
};
}
export const mountReservationDiagnostic=createReservationDiagnostic();
