export function recipientDelivery(recipients:string[],threads:any[],created:string){
 return recipients.map(email=>{const events=threads.flatMap(t=>(t.data||t).messages||[]).filter(m=>!m.out&&Date.parse(m.at)>=Date.parse(created)).flatMap(m=>(m.bounceFailures||[]).filter(f=>f.email?.toLowerCase()===email.toLowerCase()&&f.kind==="permanent"&&f.source==="delivery_status").map(f=>({...f,providerMessageId:m.id,at:m.at})));const latest=events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 return {email,status:latest?"해당 주소 영구 반송 기록":"전달 여부 미확인",...(latest?{smtpStatus:latest.status,source:latest.source,providerMessageId:latest.providerMessageId,at:latest.at}:{}),exactMessageAttribution:false,notice:"주소별 기록이며 같은 주소의 여러 발송 중 어느 건인지 직접 귀속은 별도 확인. 반송 없음은 전달 성공의 증거가 아닙니다."};});
}
