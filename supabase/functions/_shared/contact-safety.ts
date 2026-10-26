// Publication is necessary, but examples and form validation text are not contacts.
export function unsafeContactReason(email:string,context:string=""){
 const value=String(email||"").trim().toLowerCase(),local=value.split('@')[0];
 if(!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value))return "이메일 형식 오류";
 if(/^(?:user(?:name)?|your[._-]?email|example|sample|test|email|name)(?:[._-]?\d+)?$/.test(local)||/^(?:jumpit|saramin)[._-]id\d+$/i.test(local)||/@(?:example\.(?:com|org|net)|domain\.(?:com|co\.kr))$/.test(value))return "입력 예시·샘플 주소";
 // Do not repair these strings into guessed addresses; recover from original HTML instead.
 if(/^(?:enquiries|line|directly)sales@/i.test(value)&&/coherentmarketinsights\.com$/.test(value))return "주변 안내 문구와 이메일이 결합된 추출 오류";
 const at=context.toLowerCase().indexOf(value),near=at<0?context:context.slice(Math.max(0,at-65),at+value.length+85);
 const after=at<0?"":context.slice(at+value.length,at+value.length+65),before=at<0?"":context.slice(Math.max(0,at-60),at);
 if(/^(?:\s*(?:은|는|을|를))?\s*(?:형식|형태).{0,20}(?:입력|따라)/i.test(after)||/(?:예시|입력\s*예|샘플|example|e\.g\.|placeholder)\s*[:：]?\s*[^@\n]{0,40}$/i.test(before)||/(?:saramin_id\d+).{0,30}jumpit_id\d+/i.test(near))return "연락처가 아닌 입력 형식·계정 예시";
 return "";
}
export function excludedBusinessSource(website:string,pages:any[]=[]){
 let host="";try{host=new URL(website).hostname.replace(/^www\./,"");}catch{return "";}
 if(["saramin.co.kr","jobkorea.co.kr","coherentmarketinsights.com"].some(h=>host===h||host.endsWith('.'+h)))return "채용·시장조사 서비스 운영사 · 식품 브랜드 제안 대상 아님";
 return "";
}
