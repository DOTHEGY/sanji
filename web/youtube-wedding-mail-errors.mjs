// Browser-facing plan diagnostics only. Never render an error string or any
// diagnostic/provider data returned by the server.
const gated=Object.freeze({
 PARTYUM_DISABLED:[503,'더파티움 발송이 일시 중지돼 있습니다.'],
 GLOBAL_EMAIL_DISABLED:[503,'현재 산지 서버의 메일 발송이 비활성화돼 있습니다.'],
 PARTYUM_CONTROL_UNAVAILABLE:[503,'더파티움 발송 설정을 확인하지 못했습니다.'],
 SOURCE_UNVERIFIED:[503,'검증된 대상이나 발송 준비 상태를 확인하지 못했습니다.'],
 ADMISSION_UNVERIFIED:[503,'더파티움 대상 조회가 완료되지 않았습니다.'],
 NOT_CONFIGURED:[503,'더파티움 발송 연결을 확인하지 못했습니다.'],
 COPY_UNAVAILABLE:[409,'적용할 더파티움 카피를 확인하지 못했습니다.'],
 COPY_REVIEW_REQUIRED:[409,'저장된 더파티움 카피의 사용 승인 기록을 확인하지 못했습니다.'],
 INVALID_EXCLUSION:[400,'현재 목록에서 제외한 후보를 확인하지 못했습니다. 제외 선택을 확인해 주세요.'],
 AUTH:[401,'더파티움에 접근할 수 있는 로그인 계정을 확인해 주세요.'],
});
const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const noRequest=' 발송·예약 요청은 하지 않았습니다.';

export async function readWeddingMailPlanFailure(response){
 if(![400,401,409,503].includes(response?.status)||
    typeof response.headers?.get!=='function'||
    !/^application\/json\b/i.test(response.headers.get('content-type')??''))return null;
 try{
  const value=await response.json();
  if(!value||typeof value!=='object'||Object.keys(value).length!==1||
     typeof value.error!=='string'||!has(gated,value.error)||gated[value.error][0]!==response.status)return null;
  return value.error;
 }catch{return null;}
}
export function weddingMailPlanErrorMessage(code,stage){
 const message=typeof code==='string'&&has(gated,code)?gated[code][1]:
    stage==='copy'?'계획에 적용할 저장 카피의 최신 버전을 확인하지 못했습니다.':
    stage==='response'?'대상 수 또는 한국시간 예약 정보를 검증하지 못했습니다.':
    '대상, 날짜 또는 적용 카피를 확인하지 못했습니다.';
 // Preserve the same invariant regardless of which plan-time read failed.
 return message+noRequest;
}
