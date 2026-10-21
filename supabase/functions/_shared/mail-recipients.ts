export function mailRecipients(d:any):string[]{
 const input=Array.isArray(d.emails)&&d.emails.length?d.emails:[d.email];
 const out=[...new Set(input.map((x:any)=>String(x||"").trim().toLowerCase()))];
 if(!out.length||out.length>20||out.some(x=>! /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(x)||/[\r\n,<>]/.test(x)))throw Error("수신 이메일 목록을 확인하세요.");
 return out;
}
