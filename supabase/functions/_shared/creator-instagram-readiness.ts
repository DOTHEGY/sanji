// Read-only snapshot. It does not check current Meta permissions or enable routes.
export function creatorInstagramReadiness(rows:any[],expected='valu_est'){
 const match=(rows||[]).find(r=>String(r.summary?.username||'').replace(/^@/,'').toLowerCase()===expected.toLowerCase());
 return {expectedHandle:expected,accountMatched:!!match,profileVerified:match?.summary?.apiVerified===true,messagesReadable:match?.summary?.capabilities?.messagesReadable===true,webhookSubscribed:match?.summary?.capabilities?.webhookSubscribed===true,lastChecked:match?.summary?.capabilities?.checked||null,officialRoutesEnabled:false,sendEnabled:false,notice:'저장된 연결 상태입니다. 공식 메시지 경로가 비활성화되어 있으며 현재 권한·실시간 수신을 확인한 결과는 아닙니다.'};
}
