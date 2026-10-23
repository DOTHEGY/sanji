export function manualReplyService({sb,query,putRecord,audit}:any){
 return async function save(owner:string,b:any){
  const name=String(b.company||"").trim();if(!name||!["phone","sms"].includes(b.channel))throw Error("업체명과 전화·문자 경로를 확인하세요.");
  const classification=String(b.classification||"미분류");if(!["미분류","관심 회신","단순 안내","거절","수신 거부"].includes(classification))throw Error("회신 분류를 확인하세요.");
  const text=String(b.text||"").trim();if(text.length>5000)throw Error("회신 메모는 5000자 이내입니다.");
  const at=b.at?new Date(b.at):new Date();if(!Number.isFinite(at.getTime())||at.getTime()>Date.now()+60000)throw Error("회신 일시를 확인하세요.");
  const candidates=await query(sb.from("sanji_records").select("*").eq("owner",owner).eq("kind","candidate"));
  let rows=candidates.filter((r:any)=>r.data.kind!=="크리에이터"&&(b.target?r.id===b.target:[r.data.name,r.data.company].includes(name)));
  let target=rows[0];if(b.target&&(!target||![target.data.name,target.data.company].includes(name)))throw Error("입력한 업체명과 선택한 업체가 다릅니다.");if(rows.length>1)throw Error("같은 이름의 업체가 여러 곳입니다. 업체 선택에서 정확한 대상을 선택하세요.");
  if(!target){
   const leads=await query(sb.from("sanji_discovery_leads").select("*").eq("owner",owner));const matching=leads.filter((l:any)=>[l.data.name,l.data.outreach?.brandName].includes(name));
   if(matching.length!==1)throw Error("저장된 업체명과 정확히 일치하는 대상을 찾지 못했습니다. 브랜드 목록의 업체명을 선택하세요.");
   const l=matching[0];target=await putRecord(owner,"candidate",{name,company:name,companyKey:"manual:"+l.id,kind:"브랜드",category:"미확인",website:l.data.website||"",profile:"",handle:"",product:"",contact:{email:"",source:"",checked:"",owner:name,verified:false,purpose:"미확인"},topics:[],evidence:[],status:"회신",next:"문자·전화 회신 후속 확인",owner:"",due:"",note:"수동 회신 기록으로 연결한 업체"});
   await query(sb.from("sanji_discovery_leads").update({data:{...l.data,candidateId:target.id,outreach:{...l.data.outreach,candidateId:target.id}}}).eq("owner",owner).eq("id",l.id));
  }
  const records=await query(sb.from("sanji_records").select("*").eq("owner",owner).eq("kind","thread"));
  const old=records.find((r:any)=>r.data.target===target.id&&r.data.channel===b.channel),label=b.channel==="phone"?"전화":"문자";
  const t=await putRecord(owner,"thread",{...(old?.data||{}),target:target.id,channel:b.channel,subject:label+" 회신 · 수동 기록",classification,owner:old?.data.owner||"",due:old?.data.due||"",next:old?.data.next||"",manual:true,messages:[...(old?.data.messages||[]),{id:crypto.randomUUID(),out:false,automatic:false,text:text||label+" 회신 수신 (내용 미기록)",at:at.toISOString(),source:"operator_reported",recordedBy:owner,recordedAt:new Date().toISOString()}],...(old?{version:old.version}:{})},old?.id);
  const status=["거절","수신 거부"].includes(classification)?classification:["거절","수신 거부","협상","딜 확보"].includes(target.data.status)?target.data.status:"회신";
  await putRecord(owner,"candidate",{...target.data,status,lastManualReply:{channel:b.channel,at:at.toISOString(),thread:t.id},version:target.version},target.id);
  if(status==="수신 거부"){for(const identity of [...(target.data.companyKey?["company:"+target.data.companyKey]:[]),...(target.data.contact?.email?["email:"+target.data.contact.email.toLowerCase()]:[])].filter(x=>x!=="company:"))await query(sb.from("sanji_suppression").upsert({owner,identity,reason:"운영자 기록 · "+label+" 수신 거부"},{onConflict:"owner,identity"}));}
  const pending=await query(sb.from("sanji_drafts").select("id,data").eq("owner",owner).eq("used",false).eq("data->>target",target.id));
  const initial=pending.filter((d:any)=>!d.data.replyTo).map((d:any)=>d.id);
  if(initial.length)await query(sb.from("sanji_jobs").update({status:"cancelled",result:{reason:label+" 회신 수동 기록 · 후속 내용 재승인 필요"}}).eq("owner",owner).eq("status","queued").in("draft_id",initial));
  await audit(owner,"manual_brand_reply_recorded",{target:target.id,channel:b.channel,classification});return {ok:true,target:target.id,thread:t.id};
 };
}
