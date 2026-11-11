import {OutreachError,renderOutreachCopy} from './domain.mjs';

// Channel identity remains untouched. Only the substituted YouTube salutation
// changes; a name with no Hangul is retained verbatim apart from outer spaces.
export function youtubeGreetingName(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>150||/[\u0000-\u001f\u007f]/.test(value))throw new OutreachError('CHANNEL_NAME_INVALID','실제 채널명을 확인하세요.');
 const name=value.trim();
 if(!/\p{Script=Hangul}/u.test(name))return name;
 return name.normalize('NFC').replace(/[^\p{Script=Hangul}\s&]/gu,' ').replace(/\s+/g,' ').replace(/^[\s&]+|[\s&]+$/g,'');
}
export function renderYoutubeOutreachCopy({template,channelName,signature,attachments=[],inlineImages=[]}){
 if(!template||typeof template.subject!=='string'||typeof template.body!=='string')return renderOutreachCopy({template,channelName,signature,attachments,inlineImages});
 const withHonorificSpace=s=>s.replace(/\[채널명\][ \t]*님/gu,'[채널명] 님');
 return renderOutreachCopy({template:{...template,subject:withHonorificSpace(template.subject),body:withHonorificSpace(template.body)},channelName:youtubeGreetingName(channelName),signature,attachments,inlineImages});
}
