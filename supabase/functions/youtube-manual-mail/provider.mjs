import {dailyGmailProvider} from './sender-runtime.mjs';
// Isolated provider instance per request; it cannot toggle scheduler settings.
export function youtubeManualProvider({sb,env,request,now}){
 const gmail=dailyGmailProvider({sb,env,request,now});
 return {
  async prepare({owner,senderEmail}){return gmail.manualSession({owner,senderEmail});},
  async send({owner,senderEmail,session,raw,rawHash,grant}){
   const r=await gmail.manualSend({owner,senderEmail,session,raw,rawHash,grant});
   if(!r||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(r.id)||typeof r.threadId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(r.threadId))throw Error('receipt_invalid');
   return {accepted:true,providerId:r.id,providerThread:r.threadId};
  },
  clear(){gmail.resetSession();}
 };
}
