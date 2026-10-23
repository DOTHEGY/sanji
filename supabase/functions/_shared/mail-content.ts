const normalize=(s:any)=>String(s||"").replace(/\r\n?/g,"\n").trim();
export function mailContent(body:string,signature:string,settings:any={},email=true,marketing=false){
 let text=normalize(body),original=normalize(signature),custom=email?normalize(settings.emailSignature):"",sig=custom||original;
 if(custom&&original&&custom!==original&&text.endsWith(original))text=text.slice(0,-original.length).trim();
 if(sig&&!text.includes(sig))text+=(text?"\n\n":"")+sig;
 if(!email)return text;
 if(sig&&!marketing)return text.replace(/(?:\n\s*)?회신으로 수신 거부를 요청하실 수 있습니다\./g,"").trim();
 const lines:string[]=[],name=normalize(settings.senderName),address=normalize(settings.senderAddress),phone=normalize(settings.senderPhone),optOut=normalize(settings.optOut)||"회신으로 수신 거부를 요청하실 수 있습니다.";
 const nameParts=name.split(/[·•|]/).map(s=>s.trim()).filter(Boolean);
 if(name&&(!nameParts.length||!nameParts.every(s=>text.includes(s))))lines.push(name);
 if(address&&!text.includes(address))lines.push(address);
 if(phone&&!text.replace(/[\s()-]/g,"").includes(phone.replace(/[\s()-]/g,"")))lines.push(phone);
 if(marketing&&optOut&&!text.includes(optOut))lines.push(optOut);
 if(!marketing)text=text.replace(/(?:\n\s*)?회신으로 수신 거부를 요청하실 수 있습니다\./g,"").trim();
 return text+(lines.length?"\n\n"+lines.join("\n"):"");
}
