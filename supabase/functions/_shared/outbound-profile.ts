// Existing users get a profile seeded to the same legacy template by migration.
export async function selectedBrandTemplate(sb:any,query:any,owner:string){
 const result=await query(sb.from('sanji_brand_outbound_profile').select('template_id,template_version,revision').eq('owner',owner).maybeSingle()),profile=Array.isArray(result)?result[0]||null:result;
 if(profile){const t=await query(sb.from('sanji_records').select('id,data,version,updated').eq('owner',owner).eq('kind','template').eq('id',profile.template_id).maybeSingle());if(!t||t.version!==profile.template_version)throw Error('자동 발송 본문 설정이 변경됐습니다. 확인이 필요합니다.');return t;}
 const rows=await query(sb.from('sanji_records').select('id,data,version,updated').eq('owner',owner).eq('kind','template').order('updated',{ascending:true}).limit(20));return rows.find((x:any)=>x.data.channel==='이메일'&&!['brand_reply','creator_proposal','brand_auto_profile'].includes(x.data.purpose))||null;
}
