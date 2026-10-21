export function singleMailbox(header: string) {
  const value=String(header||"").replace(/\r?\n[ \t]+/g," ");
  if(/[\r\n]/.test(value))return "";
  const angle=Array.from(value.matchAll(/<([^<>]+)>/g),m=>m[1].trim());
  const pattern=/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;
  if(angle.length===1)return pattern.test(angle[0])?angle[0]:"";
  if(angle.length>1)return "";
  return pattern.test(value.trim())?value.trim():"";
}
export function replyRecipient(message: any, original: string) {
  if(!message)return {email:original,changed:false};
  const email=singleMailbox(message.replyToHeader || message.replyAddress || message.from || "");
  if(!email)throw Error("수신 대화의 회신 주소를 하나로 확인할 수 없습니다. 원본 Gmail에서 확인하세요.");
  return {email,changed:email.toLowerCase()!==original.toLowerCase()};
}
