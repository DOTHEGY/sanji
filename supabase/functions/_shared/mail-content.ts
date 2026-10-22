const normalize=(s:any)=>String(s||"").replace(/\r\n?/g,"\n").trim();
export function mailContent(body:string,signature:string,settings:any={},email=true){
 let text=normalize(body),sig=normalize(signature);
 if(sig&&!text.includes(sig))text+=(text?"\n\n":"")+sig;
 if(!email)return text;
 const lines:string[]=[],name=normalize(settings.senderName),address=normalize(settings.senderAddress),phone=normalize(settings.senderPhone),optOut=normalize(settings.optOut)||"회신으로 수신 거부를 요청하실 수 있습니다.";
 const nameParts=name.split(/[·•|]/).map(s=>s.trim()).filter(Boolean);
 if(name&&(!nameParts.length||!nameParts.every(s=>text.includes(s))))lines.push(name);
 if(address&&!text.includes(address))lines.push(address);
 if(phone&&!text.replace(/[\s()-]/g,"").includes(phone.replace(/[\s()-]/g,"")))lines.push(phone);
 if(optOut&&!text.includes(optOut))lines.push(optOut);
 return text+(lines.length?"\n\n"+lines.join("\n"):"");
}
