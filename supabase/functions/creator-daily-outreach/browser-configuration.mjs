// This release enables only owner-authenticated private template setup and
// recipient review. The operator may still explicitly turn it off. Discovery,
// dispatch, recurring execution and every mail gate remain opt-in and unchanged.
export function browserConfigurationEnv(read){
 return name=>{
  const value=read(name);
  return name==='CREATOR_DAILY_CONFIGURATION_ENABLED'&&(value===undefined||value===null||value==='')?'true':value||'';
 };
}
