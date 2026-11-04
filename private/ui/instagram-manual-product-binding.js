/* Draft insertion only: no persistence or sending. All assertions are local, not proof of Meta freshness. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SanjiManualProductBinding=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 function create({read,confirm,write}){
  if(typeof read!=='function'||typeof confirm!=='function'||typeof write!=='function')throw Error('연결을 확인하세요.');
  const initial=read();
  const valid=s=>!!s&&typeof s.owner==='string'&&s.owner.length>0&&typeof s.peerId==='string'&&/^\d{1,100}$/.test(s.peerId)&&typeof s.generation==='string'&&s.generation.length>0&&typeof s.creatorId==='string'&&s.creatorId.length>0&&typeof s.revision==='string'&&s.revision.length>0&&Number.isSafeInteger(s.dataVersion)&&s.open===true&&s.busy===false&&s.blocked===false&&s.formConnected===true&&typeof s.formVersion==='string'&&typeof s.draft==='string'&&Array.isArray(s.messages);
  if(!valid(initial))throw Error('계정·대화·검수 버전을 먼저 확인하세요.');
  const sig=s=>JSON.stringify([s.owner,s.peerId,s.generation,s.creatorId,s.revision,s.dataVersion,s.formVersion,s.draft,s.messages]);const expected=sig(initial);
  function active(){const now=read();return valid(now)&&sig(now)===expected;}
  function context(){if(!active())return null;const s=read();return {peerId:s.peerId,conversationId:s.generation,messages:s.messages};}
  function insert(value){if(typeof value!=='string'||!value.trim()||value.length>10000||!active())return false;if(confirm()!==true||!active())return false;return write(value)===true;}
  return {isActive:active,getContext:context,insert};
 }
 return {create};
});
