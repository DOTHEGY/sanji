import {matchesRecipientCriteria,verifiedMailboxSummary,previewEnvelope,privatePreviewDocument,previewWarning,preparedRecipients} from './youtube-email-view.mjs';
// Private campaign controls. No provider send endpoint, persistent browser storage,
// public copy, external image fetch or implicit configuration is used here.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const string=(x,max=4000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const integer=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const creator=x=>typeof x==='string'&&/^(youtube:UC[A-Za-z0-9_-]{22}|instagram:[a-z0-9._]{1,30})$/.test(x);
const nonIndependent=url=>/(^|\.)(youtube\.com|youtu\.be|googleapis\.com)$/.test(new URL(url).hostname);
const classes=['pending_review','solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal','marketing'];
const fail=text=>{throw Error(text);};
const kstDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const fresh=(x,now=Date.now())=>date(x)&&Date.parse(x)<=now&&Date.parse(x)>now-29*86400000;
export function safeCampaignUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)&&!/^\d+(\.\d+){3}$/.test(u.hostname)?u.href:null;}catch{return null;}}
export function parsePrivateJSON(text,max=5*1024*1024){if(typeof text!=='string'||new TextEncoder().encode(text).length>max)fail('입력 크기 제한을 초과했습니다.');let x;try{x=JSON.parse(text);}catch{fail('JSON 형식을 확인하세요.');}if(!object(x))fail('JSON 객체를 선택하세요.');return x;}
export function fullConfiguration(raw){
 if(!object(raw)||!integer(raw.revision,Number.MAX_SAFE_INTEGER)||!Array.isArray(raw.blockers)||raw.blockers.some(x=>!string(x,160))||!classes.includes(raw.classification)||!object(raw.schedule)||raw.schedule.timezone!=='Asia/Seoul'||!integer(raw.schedule.hour,23)||!integer(raw.schedule.minute,59)||typeof raw.schedule.confirmed!=='boolean')fail('캠페인 설정 응답을 확인하지 못했습니다.');
 for(const key of ['configurationEnabled','dispatchEnabled','schedulerDeploymentEnabled','mailDeploymentEnabled','enabled','sendEnabled','schedulerEnabled','sendingEnabled','recurringTriggerVerified'])if(typeof raw[key]!=='boolean')fail('서버 기능 상태를 확인하지 못했습니다.');
 if(raw.snapshotId!==null&&!uuid(raw.snapshotId))fail('저장된 설정 ID를 확인하지 못했습니다.');
 return raw;
}
export function fullStatus(raw){if(!object(raw)||raw.state!=='campaign'||typeof raw.preparationEnabled!=='boolean'||typeof raw.sendingEnabled!=='boolean'||typeof raw.schedulerEnabled!=='boolean'||typeof raw.recurringTriggerVerified!=='boolean'||!object(raw.discovery))fail('전체 캠페인 연결을 확인하지 못했습니다.');fullConfiguration(raw.campaign);return raw;}
function validatePolicy(raw){
 const p=raw===undefined?{classification:'pending_review',classificationSource:'',authorizationSource:'',schedule:{timezone:'Asia/Seoul',hour:9,minute:0,confirmed:false}}:raw;
 if(!own(p,['classification','classificationSource','authorizationSource','schedule'])||!classes.includes(p.classification)||typeof p.classificationSource!=='string'||p.classificationSource.length>2000||typeof p.authorizationSource!=='string'||p.authorizationSource.length>2000||!own(p.schedule,['timezone','hour','minute','confirmed'])||p.schedule.timezone!=='Asia/Seoul'||!integer(p.schedule.hour,23)||!integer(p.schedule.minute,59)||typeof p.schedule.confirmed!=='boolean')fail('분류 근거와 한국시간 일정을 확인하세요.');
 if(['solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal'].includes(p.classification)&&(!p.classificationSource.trim()||!p.authorizationSource.trim()))fail('검토된 분류와 반복 발송의 승인 근거를 입력하세요.');
 return p;
}
// Validate complete PNG chunks and CRCs before asking the browser to decode pixels.
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function pngCrc(bytes){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function validatePngChunks(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,chunks=0,idat=false,ended=false;
 while(offset<bytes.length){if(++chunks>8192||offset+12>bytes.length)fail('PNG 파일이 잘렸거나 청크가 너무 많습니다.');const length=view.getUint32(offset);if(length>bytes.length-offset-12)fail('PNG 청크 크기를 확인하세요.');const kind=String.fromCharCode(...bytes.slice(offset+4,offset+8)),data=offset+8,end=data+length;if(!/^[A-Za-z]{4}$/.test(kind)||pngCrc(bytes.subarray(offset+4,end))!==view.getUint32(end))fail('PNG 원본 무결성 검증에 실패했습니다.');if(chunks===1&&(kind!=='IHDR'||length!==13))fail('PNG 헤더 형식을 확인하세요.');if(chunks>1&&kind==='IHDR')fail('PNG 헤더가 중복되었습니다.');if(kind==='IDAT'&&length>0)idat=true;if(kind==='IEND'){if(length!==0||end+4!==bytes.length||!idat)fail('PNG 이미지 데이터 또는 종료 정보가 올바르지 않습니다.');ended=true;}offset=end+4;
 }
 if(!ended)fail('완전한 PNG 사진이 필요합니다.');
}
export async function decodePrivateImages(snapshot,decoder){
 const decode=decoder||async function(image){
  const bytes=Uint8Array.from(atob(image.content),x=>x.charCodeAt(0));
  if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{return {width:bitmap.width,height:bitmap.height};}finally{bitmap.close();}}
  if(typeof Image==='function'){const img=new Image();const loaded=new Promise((resolve,reject)=>{img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(Error('사진 디코드 실패'));});img.src='data:image/png;base64,'+image.content;return loaded;}
  fail('이 브라우저에서 사진 원본을 확인할 수 없습니다. 지원되는 브라우저에서 다시 열어주세요.');
 };
 for(const image of snapshot.images){let size;try{size=await decode(image);}catch{fail('사진을 실제로 표시할 수 없습니다. 손상되지 않은 PNG 원본을 확인하세요.');}if(size.width!==image.width||size.height!==image.height)fail('디코드한 사진 크기가 원본 정보와 다릅니다.');}
}
export async function validatePrivateImport(raw,owner,{digest=bytes=>crypto.subtle.digest('SHA-256',bytes)}={}){
 if(!uuid(owner)||!own(raw,['snapshot','policy','expectedRevision'])||(raw.expectedRevision!==undefined&&!integer(raw.expectedRevision,Number.MAX_SAFE_INTEGER)))fail('현재 계정용 비공개 설정 파일을 선택하세요.');
 const s=raw.snapshot;
 if(!own(s,['version','owner','productMode','products','campaignProducts','template','images','recipientCriteria'])||s.version!==2||s.owner!==owner||s.productMode!=='approved_campaign_assets'||!Array.isArray(s.products)||s.products.length!==0||!Array.isArray(s.campaignProducts)||s.campaignProducts.length!==2)fail('승인된 캠페인 사진 모드의 현재 계정 설정이 필요합니다. 서명과 비밀키는 파일에 넣지 마세요.');
 if(!own(s.recipientCriteria,['version','audienceBounds','targets','targetUnit','maxEmailsPerCreator','dedupeScope','approvalSource'])||s.recipientCriteria.version!==1||!matchesRecipientCriteria(s.recipientCriteria)||!own(s.recipientCriteria.audienceBounds,['youtube','instagram'])||!own(s.recipientCriteria.audienceBounds.youtube,['minimum','maximum'])||!own(s.recipientCriteria.audienceBounds.instagram,['minimum','maximum'])||!own(s.recipientCriteria.targets,['youtube','instagram'])||s.recipientCriteria.targets?.youtube!==50||s.recipientCriteria.targets?.instagram!==10||!string(s.recipientCriteria.approvalSource,4000))fail('YouTube 3만–20만·50개 주소, Instagram 10개 주소의 최신 수신자 기준을 확인하세요.');
 const expected=['마라쫀득빵','짬뽕쫀득빵'];
 if(s.campaignProducts.some((p,i)=>!own(p,['name','approvalSource'])||p.name!==expected[i]||!string(p.approvalSource,2000)))fail('두 제품과 사용자 승인 출처를 확인하세요.');
 const t=s.template;
 if(!own(t,['owner','revision','approved','approvalSource','subject','body','requiredInlineImageIds'])||t.owner!==owner||!integer(t.revision,1000000)||t.revision<1||t.approved!==true||!string(t.approvalSource,2000)||!string(t.subject,200)||/[\r\n]/.test(t.subject)||!string(t.body,20000)||!Array.isArray(t.requiredInlineImageIds)||t.requiredInlineImageIds.length!==2||new Set(t.requiredInlineImageIds).size!==2||t.requiredInlineImageIds.some(id=>!string(id,200)))fail('승인된 고정 제목·본문과 사진 ID 두 개를 확인하세요.');
 if(!Array.isArray(s.images)||s.images.length!==2)fail('본문 사진은 정확히 두 장이어야 합니다.');
 const hashes=new Set();
 for(const id of t.requiredInlineImageIds){
  const im=s.images.find(i=>i.id===id);
  if(!own(im,['id','owner','verified','sharingApproved','mimeType','content','bytes','sha256','width','height','alt'])||im.owner!==owner||im.verified!==true||im.sharingApproved!==true||im.mimeType!=='image/png'||typeof im.content!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(im.content)||!integer(im.bytes,5*1024*1024)||im.bytes<45||!integer(im.width,20000000)||!integer(im.height,20000000)||im.width<32||im.height<32||im.width*im.height>20000000||!(/^[a-f0-9]{64}$/).test(im.sha256||'')||(im.alt!==undefined&&!string(im.alt,150)))fail('사진의 원본·계정·공유 승인 정보를 확인하세요.');
  let b;try{b=Uint8Array.from(atob(im.content),c=>c.charCodeAt(0));}catch{fail('사진 base64 형식을 확인하세요.');}
  const v=new DataView(b.buffer);if(b.length!==im.bytes||b.length<45||[137,80,78,71,13,10,26,10].some((x,i)=>b[i]!==x)||String.fromCharCode(...b.slice(12,16))!=='IHDR'||String.fromCharCode(...b.slice(-8,-4))!=='IEND'||v.getUint32(16)!==im.width||v.getUint32(20)!==im.height)fail('사진 파일과 표시 크기가 일치하지 않습니다.');
  validatePngChunks(b);
  const h=Array.from(new Uint8Array(await digest(b)),x=>x.toString(16).padStart(2,'0')).join('');if(h!==im.sha256||hashes.has(h))fail('사진 해시가 다르거나 동일한 사진이 중복되었습니다.');hashes.add(h);
 }
 const result={snapshot:structuredClone(s),policy:structuredClone(validatePolicy(raw.policy))};
 if(new TextEncoder().encode(JSON.stringify({...result,expectedRevision:999999999})).length>5*1024*1024)fail('설정 파일이 서버의 5 MiB 요청 제한을 초과합니다.');
 return result;
}
export function validateCandidateReview(input,items,now=Date.now()){
 if(input?.creatorKey?.startsWith('instagram:'))return validateInstagramReview(input,items,now);
 if(!own(input,['creatorKey','snapshotObservedAt','mukbang','displayNameEvidence','contactEvidence'])||!creator(input.creatorKey)||!input.creatorKey.startsWith('youtube:'))fail('후보 검토 형식을 확인하세요.');
 const row=items.find(x=>'youtube:'+x.snapshot?.channelId===input.creatorKey),s=row?.snapshot;
 if(!s||input.snapshotObservedAt!==s.observedAt||!date(s.expiresAt)||Date.parse(s.expiresAt)<=now)fail('최신 후보 목록을 다시 불러오세요.');
 const m=input.mukbang,d=input.displayNameEvidence,profile='https://www.youtube.com/channel/'+s.channelId;
 if(!own(m,['verified','sourceUrl','sourceText','checkedAt'])||m.verified!==true||!safeCampaignUrl(m.sourceUrl)||!string(m.sourceText,2000)||!fresh(m.checkedAt,now))fail('실제로 확인한 먹방 콘텐츠 근거가 필요합니다.');
 if(!own(d,['name','sourceUrl','sourceText','checkedAt','verified','kind','creatorKey','profileUrl'])||!string(d.name,150)||/[\r\n<>\[\]{}]/.test(d.name)||d.verified!==true||!['official_website','provided_by_creator'].includes(d.kind)||d.creatorKey!==input.creatorKey||d.profileUrl!==profile||!safeCampaignUrl(d.sourceUrl)||nonIndependent(d.sourceUrl)||!string(d.sourceText)||!d.sourceText.includes(d.name)||!(d.sourceText.includes(profile)||d.sourceText.includes(s.channelId))||!fresh(d.checkedAt,now))fail('YouTube 밖의 독립된 이름·채널 연결 근거를 확인하세요.');
 if(input.contactEvidence!==undefined&&(!Array.isArray(input.contactEvidence)||input.contactEvidence.length>5))fail('연락처 근거 형식을 확인하세요.');
 for(const e of input.contactEvidence||[]){
  if(!object(e)||!string(e.address,254)||e.verified!==true||e.purpose!=='business_collaboration'||e.accessMethod!=='public_source_review'||!['official_website','provided_by_creator'].includes(e.sourceKind)||!safeCampaignUrl(e.sourceUrl)||nonIndependent(e.sourceUrl)||!string(e.sourceText)||!e.sourceText.toLowerCase().includes(e.address.toLowerCase())||!fresh(e.checkedAt,now)||e.affiliation?.verified!==true||e.affiliation.creatorKey!==input.creatorKey||!safeCampaignUrl(e.affiliation.sourceUrl)||!string(e.affiliation.sourceText)||!fresh(e.affiliation.checkedAt,now))fail('YouTube에서 이메일을 수집할 수 없습니다. 공식 공개 업무 연락처와 해당 채널의 소속 근거를 확인하세요.');
 }
 if(new TextEncoder().encode(JSON.stringify(input)).length>16000)fail('후보 검토 JSON은 16 KB 이하로 입력하세요.');return structuredClone(input);
}
export function validateInstagramReview(input,items,now=Date.now()){
 if(!own(input,['creatorKey','sourceRecordId','sourceRecordUpdated','audience','audienceSource','audienceCheckedAt','lastActiveAt','activitySource','activityCheckedAt','mukbang','contactEvidence'])||!creator(input.creatorKey)||!input.creatorKey.startsWith('instagram:'))fail('기존 Instagram 후보 검토 형식을 확인하세요.');
 const row=items.find(x=>x.platform==='instagram'&&x.creator_key===input.creatorKey),c=row?.candidate;
 if(!c||c.existingDatabaseRecord!==true||c.excluded===true||row.reviewState==='excluded'||!uuid(c.sourceRecordId)||input.sourceRecordId!==c.sourceRecordId||input.sourceRecordUpdated!==c.sourceRecordUpdated)fail('최신 기존 Instagram 후보를 확인하세요. 제외된 대상은 승인할 수 없습니다.');
 if(!integer(input.audience,500000)||input.audience<30000||!safeCampaignUrl(input.audienceSource)||!fresh(input.audienceCheckedAt,now)||!date(input.lastActiveAt)||Date.parse(input.lastActiveAt)>now||Date.parse(input.lastActiveAt)<now-90*86400000||!safeCampaignUrl(input.activitySource)||!fresh(input.activityCheckedAt,now))fail('3만~50만 팔로워 및 최근 90일 활동의 최신 공개 근거가 필요합니다.');
 const m=input.mukbang;if(!own(m,['verified','sourceUrl','sourceText','checkedAt'])||m.verified!==true||!safeCampaignUrl(m.sourceUrl)||!string(m.sourceText,2000)||!fresh(m.checkedAt,now))fail('직접 확인한 Instagram 먹방 콘텐츠 근거가 필요합니다.');
 if(input.contactEvidence!==undefined&&(!Array.isArray(input.contactEvidence)||input.contactEvidence.length>5))fail('연락처 근거 형식을 확인하세요.');
 for(const e of input.contactEvidence||[]){
  if(!object(e)||!string(e.address,254)||e.verified!==true||e.purpose!=='business_collaboration'||e.accessMethod!=='public_source_review'||!['official_website','instagram_public_bio','provided_by_creator'].includes(e.sourceKind)||!safeCampaignUrl(e.sourceUrl)||!string(e.sourceText)||!e.sourceText.toLowerCase().includes(e.address.toLowerCase())||!fresh(e.checkedAt,now))fail('공개 업무 연락처 원문과 확인 시각을 검토하세요.');
  if(e.sourceKind==='instagram_public_bio'){const u=new URL(e.sourceUrl);if(!['instagram.com','www.instagram.com'].includes(u.hostname)||u.search||u.pathname.replace(/\/$/,'').toLowerCase()!=='/'+input.creatorKey.slice(10))fail('같은 Instagram 계정의 공개 프로필 근거가 필요합니다.');}
  else if(e.affiliation?.verified!==true||e.affiliation.creatorKey!==input.creatorKey||!safeCampaignUrl(e.affiliation.sourceUrl)||!string(e.affiliation.sourceText)||!fresh(e.affiliation.checkedAt,now))fail('해당 Instagram 계정의 공식 소속 근거를 확인하세요.');
 }
 if(new TextEncoder().encode(JSON.stringify(input)).length>16000)fail('후보 검토 JSON은 16 KB 이하로 입력하세요.');return structuredClone(input);
}
function containsEvidence(actual,input,key=''){if(Array.isArray(input))return Array.isArray(actual)&&actual.length===input.length&&input.every((x,i)=>containsEvidence(actual[i],x));if(object(input))return object(actual)&&Object.keys(input).every(k=>containsEvidence(actual[k],input[k],k));if(['sourceUrl','profileUrl','audienceSource','activitySource'].includes(key))return safeCampaignUrl(actual)!==null&&safeCampaignUrl(actual)===safeCampaignUrl(input);if(key==='name'&&typeof actual==='string'&&typeof input==='string')return actual.trim()===input.trim();return actual===input;}
export function validateRecipientReview(raw,config,now=Date.now()){
 if(!own(raw,['creatorKey','recipient','kind','classification','classificationSource','sourceUrl','sourceText','verifiedAt','expiresAt','approvalSource','status'])||!creator(raw.creatorKey)||!string(raw.recipient,254)||raw.recipient!==raw.recipient.trim().toLowerCase()||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(raw.recipient)||!['approved','revoked'].includes(raw.status))fail('수신자와 검토 상태를 확인하세요.');
 if(raw.status==='approved'&&(raw.classification!==config.classification||!['solicited_non_marketing_proposal','reviewed_non_marketing_business_proposal'].includes(raw.classification)||raw.kind!==(raw.classification==='solicited_non_marketing_proposal'?'solicited_proposal':'documented_business_proposal')||!safeCampaignUrl(raw.sourceUrl)||!['classificationSource','sourceText','approvalSource'].every(k=>string(raw[k]))||!fresh(raw.verifiedAt,now)||!date(raw.expiresAt)||Date.parse(raw.expiresAt)<=now))fail('공개 이메일만으로 발송 승인되지 않습니다. 개별 수신자의 제안·분류·승인 근거를 확인하세요.');
 return {...structuredClone(raw),expectedRevision:config.revision};
}
const labels={recipient_criteria_review_required:'YouTube 3만–20만·50개 주소 기준으로 비공개 설정을 다시 확인해야 합니다.',private_configuration_disabled:'비공개 설정 저장 기능이 아직 배포되지 않았습니다.',private_template_required:'고정 문안과 서명 위 본문 사진 2장을 저장해야 합니다.',message_classification_required:'메일 성격과 발송 근거 검토가 필요합니다.',marketing_adapter_review_required:'광고성 메일의 별도 요건 검토가 필요합니다.',classification_source_required:'메일 분류 근거가 필요합니다.',authorization_source_required:'사용자 승인 근거가 필요합니다.',schedule_time_review_required:'한국시간 반복 실행 시각 확인이 필요합니다.',dispatch_deployment_disabled:'발송 처리 기능이 비활성입니다.',scheduler_deployment_disabled:'예약 실행 기능이 비활성입니다.',email_sending_disabled:'메일 전송 기능이 비활성입니다.',current_gmail_signature_changed:'기존 Gmail 서명이 변경되어 설정을 다시 검토해야 합니다.',verified_inline_product_images_required:'서명 위 본문 사진 확인 필요',inline_product_images_required:'서명 위 본문 사진 확인 필요',verified_product_attachments_required:'서명 위 본문 사진 확인 필요',existing_youtube_key_required:'기존 YouTube API 연결 확인 필요',existing_google_project_id_required:'YouTube 할당량 프로젝트 확인 필요'};
const label=code=>labels[code]||'서버 확인 필요: '+String(code).slice(0,160);
const display=x=>typeof x==='string'||typeof x==='number'||typeof x==='boolean'?String(x).slice(0,2000):'미확인';
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function control(tag,id){const n=el(tag);n.id=id;return n;}
function checkbox(id,text){const box=control('input',id);box.type='checkbox';const wrapper=el('label');wrapper.append(box,el('span',' '+text));return {box,wrapper};}
function section(title){const node=el('details');node.append(el('summary',title));return node;}
// Counts cover database records, not reviewed/eligible recipients. Only the requested
// page is retained. A total above a full-scan cap must not reject a bounded page.
export function reviewPagination(raw,scope,pageSize,cursor=null){
 const p=raw?.pagination,cursorId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
 if(cursor!==null&&!cursorId(cursor)||!object(p)||p.scope!==scope||p.pageSize!==pageSize||p.cursor!==cursor||!integer(p.total,Number.MAX_SAFE_INTEGER)||!integer(p.remaining,p.total)||!integer(p.returned,pageSize)||p.returned>p.remaining||p.remaining>0&&p.returned===0||typeof p.hasMore!=='boolean'||p.hasMore!==(p.remaining>p.returned)||(cursor===null&&p.remaining!==p.total)||(p.hasMore?(!cursorId(p.nextCursor)||cursor!==null&&p.nextCursor<=cursor):p.nextCursor!==null))fail('페이지 범위와 전체·남은 수를 확인하지 못했습니다.');
 return p;
}
export function mountFullCampaign({container,client,functionUrl,apiKey,getOwner,isCurrent,fetchImpl=fetch,initialStatus=null}){
 let preparedToken=0,previewToken=0,previewKey=null,previewAbort=null,renderedFrame=null;
 let epoch=0,busy=false,config=null,state=null,staged=null,disposed=false,importToken=0,reviewPlatform='youtube',reviewPage=0;const reviewCursors=[null],sourceCursors=[null],pageControls=new Map();const pending=new Set(),uncertain=new Map(),cache={},acknowledged={};
 const heading=el('h2','Gmail · 개별 카피 확인');
 const safety=el('p','목표: YouTube 50개 · Instagram 10개의 서로 다른 공개 업무 이메일. 크리에이터당 1개 주소, 플랫폼 간 공유 수신함·별칭 중복 제외. 고정 카피는 [채널명]만 바꾸고 사진 2장은 기존 Gmail 서명 위에 넣습니다.');safety.className='notice';
 const status=el('p','캠페인 상태를 확인하세요.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const current=el('div'),blockers=el('ul'),overview=control('div','campaign-overview');
 const mailPreview=control('section','campaign-email-preview');mailPreview.className='email-preview panel';mailPreview.hidden=true;mailPreview.setAttribute('aria-label','개별 이메일 카피 미리보기');mailPreview.setAttribute('tabindex','-1');
 const mailTitle=el('h3','개별 카피 확인'),mailMeta=el('p'),mailWarnings=el('div'),mailContent=el('div'),closePreview=control('button','campaign-preview-close');closePreview.type='button';closePreview.textContent='카피 닫기';mailPreview.append(mailTitle,closePreview,mailMeta,mailWarnings,mailContent);
 function clearMailPreview(){if(renderedFrame){renderedFrame.srcdoc='';renderedFrame=null;}previewToken++;previewKey=null;if(previewAbort){previewAbort.abort();previewAbort=null;}mailContent.replaceChildren();mailWarnings.replaceChildren();mailMeta.textContent='';mailPreview.hidden=true;}
 closePreview.addEventListener('click',clearMailPreview);
 const preparedSection=control('section','campaign-prepared-recipients');preparedSection.setAttribute('aria-label','오늘 준비한 수신 주소');preparedSection.append(el('h3','오늘 준비한 수신 주소'));const preparedList=control('div','campaign-prepared-list');preparedList.setAttribute('aria-live','polite');preparedList.append(el('p','로그인 후 오늘 준비한 수신 주소를 확인합니다.'));preparedSection.append(el('p','준비된 공개 업무 이메일만 표시합니다. Gmail 전체 발송 이력·수신자별 발송 근거는 발송 전에 별도 확인해야 하며, 이 목록은 발송 가능 보장이 아닙니다.'),preparedList);
 const refresh=control('button','campaign-refresh');refresh.textContent='전체 상태 새로고침';refresh.type='button';
 const collect=control('button','campaign-collect');collect.textContent='오늘 신규 후보 탐색';collect.type='button';
 const prepare=control('button','campaign-prepare');prepare.textContent='검토한 후보 준비';prepare.type='button';
 const configSection=section('비공개 고정 문안·본문 사진 설정');
 const privateFile=control('input','campaign-private-file');privateFile.type='file';privateFile.accept='.json,application/json';
 const preview=el('div');preview.className='campaign-private-preview';
 const copyCheck=checkbox('campaign-copy-confirm','제목·본문 원문, 사진 2장, 사용자 승인 출처를 확인했습니다.');
 const configure=control('button','campaign-configure');configure.textContent='설정 저장 · 항상 일시정지';configure.type='button';
 configSection.append(el('p','현재 로그인 계정용 JSON 파일을 선택하면 이 기기에서 먼저 검증합니다. 저장 버튼을 누를 때만 Sanji 비공개 설정으로 전송합니다. 기존 Gmail 서명은 서버에서 읽으며 파일에 인증정보·서명을 넣지 마세요. 파일의 과거 버전 번호 대신 현재 서버 설정 버전으로 저장합니다.'),privateFile,preview,copyCheck.wrapper,configure);
 const scheduleSection=section('반복 실행과 일시정지');
 const scheduleInfo=el('p');
 const scheduleCheck=checkbox('campaign-schedule-confirm','저장된 문안·사진·수신자별 근거와 한국시간 일정을 확인했습니다. 반복 실행 연결 전에는 자동 실행되지 않으며, 연결 후 이 일정의 반복 발송을 허용합니다.');
 const schedule=control('button','campaign-schedule');schedule.textContent='검토한 일정으로 반복 실행 시작';schedule.type='button';
 const pause=control('button','campaign-pause');pause.textContent='캠페인 일시정지';pause.type='button';
 scheduleSection.append(scheduleInfo,el('p','활성화 전의 과거 준비 목록은 발송하지 않습니다. 활성화 이후 새로 검토·준비된 대상이나 다음 실행부터 적용되며, 즉시 60명 발송을 보장하지 않습니다.'),scheduleCheck.wrapper,schedule,pause);
 const reviewSection=section('YouTube·기존 Instagram 원문 근거 검토');const reviewList=control('div','campaign-candidate-list');
 const reviewJSON=control('textarea','campaign-candidate-json');reviewJSON.rows=9;reviewJSON.setAttribute('aria-label','후보 검토 근거 JSON');
 const reviewCheck=checkbox('campaign-candidate-confirm','해당 계정의 먹방 콘텐츠와 최신 활동·규모 근거, YouTube의 독립된 이름·채널 근거 및 입력한 연락처 원문을 직접 확인했습니다.');
 const reviewSave=control('button','campaign-review-candidate');reviewSave.textContent='후보 원문 근거 저장';reviewSave.type='button';
 reviewSection.append(el('p','검색 결과만으로 먹방·연락처를 승인하지 않습니다. YouTube 정보 탭·설명·댓글의 이메일 자동 수집은 지원하지 않습니다. 연락처를 비워 저장하면 연락처 검토 보류로 남습니다.'),reviewList,reviewJSON,reviewCheck.wrapper,reviewSave);
 const recipientsSection=section('수신자별 발송 근거 검토');const recipientsList=el('div');
 const recipientJSON=control('textarea','campaign-recipient-json');recipientJSON.rows=8;recipientJSON.setAttribute('aria-label','수신자 발송 근거 JSON');
 const recipientCheck=checkbox('campaign-recipient-confirm','현재 문안·사진 범위에 대한 해당 수신자의 발송 근거 또는 승인 철회 내용을 확인했습니다.');
 const recipientBlank=el('button','빈 수신자 검토 양식');recipientBlank.type='button';recipientBlank.addEventListener('click',()=>{if(busy||disposed)return;recipientJSON.value=JSON.stringify({creatorKey:'',recipient:'',status:'pending_review',kind:'',classification:config?.classification||'pending_review',classificationSource:'',sourceUrl:'',sourceText:'',verifiedAt:'',expiresAt:'',approvalSource:''},null,2);recipientCheck.box.checked=false;controls();});
 const recipientSave=control('button','campaign-review-recipient');recipientSave.textContent='수신자 검토 저장';recipientSave.type='button';
 recipientsSection.append(el('p','수신자의 요청·업무 제안 근거와 승인 출처를 기록합니다. 공개 이메일을 발견했다는 사실만으로 승인하지 않습니다. 설정 버전이 바뀌면 다시 검토해야 합니다.'),recipientsList,recipientBlank,recipientJSON,recipientCheck.wrapper,recipientSave);
 const sourcesSection=section('공식 연락처 출처 등록 요청');const sourcesList=control('div','campaign-source-list');
 const sourceKey=control('input','campaign-source-key');sourceKey.placeholder='youtube:UC… 또는 instagram:계정';sourceKey.setAttribute('aria-label','출처의 크리에이터 ID');
 const sourceURL=control('input','campaign-source-url');sourceURL.type='url';sourceURL.placeholder='https://공식-사이트/업무연락처';sourceURL.setAttribute('aria-label','공식 연락처 출처 URL');
 const sourceKind=control('select','campaign-source-kind');for(const [value,text] of [['official_website','공식 웹사이트'],['instagram_public_bio','Instagram 공개 프로필']]){const o=el('option',text);o.value=value;sourceKind.append(o);}sourceKind.value='official_website';
 const sourceCheck=checkbox('campaign-source-confirm','해당 크리에이터의 공식 공개 출처임을 확인했습니다. 등록 요청은 수집·발송 승인이 아님을 확인합니다.');
 const sourceSave=control('button','campaign-register-source');sourceSave.textContent='출처 검토 요청 등록';sourceSave.type='button';
 sourcesSection.append(el('p','등록은 검토 요청만 만듭니다. 사이트 정책·공개 접근·채널 소속 검토가 끝나기 전에는 연락처 수집에 사용하지 않습니다.'),sourcesList,sourceKey,sourceURL,sourceKind,sourceCheck.wrapper,sourceSave);
 const runsSection=section('최근 실행·발송 이력');const runs=el('div');runsSection.append(runs);
 const advanced=section('고급 관리 · 조사 근거·비공개 설정·실행 이력');advanced.id='campaign-advanced';advanced.append(status,collect,prepare,current,blockers,configSection,scheduleSection,reviewSection,recipientsSection,sourcesSection,runsSection);
 container.replaceChildren(heading,overview,safety,refresh,preparedSection,mailPreview,advanced);
 const mutations=[collect,prepare,configure,schedule,pause,reviewSave,recipientSave,sourceSave];
 const allInputs=[privateFile,copyCheck.box,scheduleCheck.box,reviewJSON,reviewCheck.box,recipientJSON,recipientCheck.box,sourceKey,sourceURL,sourceKind,sourceCheck.box];
 function active(owner,ticket){return !disposed&&ticket===epoch&&getOwner()===owner&&isCurrent(owner);}
 function identity(c=config){return c?JSON.stringify({revision:c.revision,snapshotId:c.snapshotId,classification:c.classification,schedule:c.schedule,blockers:c.blockers,gmailConnected:c.gmailConnected}):null;}
 function acceptConfig(next){if(config&&identity(config)!==identity(next)){clearMailPreview();for(const x of [copyCheck.box,scheduleCheck.box,recipientCheck.box]){x.checked=false;delete acknowledged[x.id];}}config=next;}
 function checked(box){return box.checked&&acknowledged[box.id]===identity();}
 function controls(){
  const off=busy||!getOwner()||disposed,locked=path=>uncertain.has(path);refresh.disabled=off;
  for(const x of allInputs)x.disabled=off;
  for(const [button,unavailable] of pageControls)button.disabled=off||unavailable;
  const collection=state?.discovery?.latest,today=collection?.day===kstDay();
  collect.disabled=off||state?.preparationEnabled!==true||state?.discovery?.configurationReady===false||today&&['completed','failed'].includes(collection.state)||locked('/collect');
  prepare.disabled=off||state?.preparationEnabled!==true||!today||collection?.state!=='completed'||locked('/prepare');
  configure.disabled=off||config?.configurationEnabled!==true||!staged||!checked(copyCheck.box)||locked('/configure');
  schedule.disabled=off||!config?.snapshotId||!config.configurationEnabled||!config.dispatchEnabled||!config.schedulerDeploymentEnabled||!config.mailDeploymentEnabled||config.blockers.length>0||!config.schedule.confirmed||config.enabled||!checked(scheduleCheck.box)||uncertain.size>0;
  // An idempotent pause remains available if another operation has uncertain outcome.
  pause.disabled=off||!config?.snapshotId||config.revision<1||locked('/pause');
  reviewSave.disabled=off||state?.discovery?.enabled!==true||!cache.supply||!reviewCheck.box.checked||locked('/review-candidate');
  recipientSave.disabled=off||!config?.snapshotId||config.configurationEnabled!==true||!checked(recipientCheck.box)||locked('/review-recipient');
  sourceSave.disabled=off||cache.sources?.registrationEnabled!==true||!sourceCheck.box.checked||locked('/register-source-review');
 }
 async function request(path,payload,owner,ticket){
  const auth=await client.auth.getSession();if(!active(owner,ticket))throw Object.assign(Error('계정 변경'),{code:'STALE'});
  if(auth.error||auth.data?.session?.user?.id!==owner)throw Object.assign(Error('로그인을 다시 확인하세요.'),{code:'AUTH_REQUIRED',beforeRequest:true});
  const controller=new AbortController();pending.add(controller);if(path==='/preview')previewAbort=controller;const timer=setTimeout(()=>controller.abort(),path==='/collect'?135000:path==='/prepare'?110000:35000);
  try{const res=await fetchImpl(functionUrl+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+auth.data.session.access_token,apikey:apiKey,'Content-Type':'application/json'},cache:'no-store',...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:controller.signal});let body;try{body=await res.json();}catch{throw Error('응답 확인 실패');}
   const after=await client.auth.getSession();if(!active(owner,ticket))throw Object.assign(Error('계정 변경'),{code:'STALE'});if(after.error||after.data?.session?.user?.id!==owner)throw Object.assign(Error('계정 확인 실패'),{code:payload===undefined?'AUTH_REQUIRED':'SAVE_UNCERTAIN'});
   if(!res.ok)throw Object.assign(Error('서버 요청 거절'),{code:body?.code,httpStatus:res.status});return body;
  }finally{clearTimeout(timer);pending.delete(controller);if(previewAbort===controller)previewAbort=null;}
 }
 function drawState(){
  current.replaceChildren();blockers.replaceChildren();overview.replaceChildren();if(!state||!config){clearMailPreview();overview.append(el('p','설정 상태를 확인하지 못했습니다. 후보나 주소를 0개로 처리하지 않았습니다.'));return;}
  overview.append(el('p',`Gmail ${config.gmailConnected===true?'연결됨':config.gmailConnected===false?(config.gmailConnectionStatus==='reauth_required'?'다시 연결 필요':'연결 필요'):'연결 상태 확인 필요'} · 고정 카피·사진 ${config.snapshotId?'저장됨':'미등록'} · 발송 ${state.sendingEnabled?'활성':'꺼짐'} · 자동 실행 ${state.schedulerEnabled?'활성':'꺼짐'}`));
  overview.append(el('p',config.snapshotId?'채널 옆 카피 보기에서 각 수신자의 제목·본문·사진·기존 서명을 확인하세요. 미리보기는 발송하지 않습니다.':'비공개 카피·사진 설정이 아직 완료되지 않았습니다. 개별 카피는 설정 저장 후 확인할 수 있습니다.'));
  current.append(el('p',`설정 버전 ${config.revision} · ${config.snapshotId?'비공개 원본 저장됨':'비공개 원본 미등록'} · ${config.enabled?'정책 활성':'일시정지/미설정'}`));
  current.append(el('p',`검색: ${state.discovery.enabled?'연결됨':'비활성'} · 전송 기능: ${state.sendingEnabled?'활성':'비활성'} · 반복 실행: ${state.schedulerEnabled?'활성':'비활성'} · 실제 반복 실행 연결: ${state.recurringTriggerVerified?'확인됨':'미확인'}`));
  const collection=state.discovery.latest;if(collection)current.append(el('p',`신규 후보 탐색 ${display(collection.day)}: ${display(collection.state)} · 새 임시 후보 ${display(collection.summary?.stagedYoutube)}명. 검색 결과는 연락처·발송 승인 인원이 아닙니다.`));else current.append(el('p','오늘의 신규 후보 탐색 후 원문 검토와 후보 준비를 진행하세요.'));
  const s=verifiedMailboxSummary(state.latest);if(s){overview.append(el('p',`검증 주소 준비: YouTube ${s.counts.youtube}/50개 · Instagram ${s.counts.instagram}/10개. 부족 ${s.shortfall.youtube}개 / ${s.shortfall.instagram}개. 준비 수는 발송 수가 아닙니다.`));current.append(el('p',`준비 기준일 ${display(s.day)} · 구독자 YouTube 3만–20만 / Instagram 3만–50만`));}else overview.append(el('p',state.latest?'이전 기준의 준비 기록은 보존했습니다. 현재 50개·10개 검증 주소 집계는 아직 확인되지 않았습니다.':'확인된 검증 주소 준비 기록이 없습니다. 목표는 YouTube 50개 · Instagram 10개입니다.'));
  const progress=s?.executionProgress;prepare.textContent=s?.morePreparationRequired===true?'남은 검토 후보 계속 준비':'검토한 후보 준비';
  if(s?.morePreparationRequired===true)overview.append(el('p','일부 검토 후보를 처리했습니다. 목표에 아직 부족한 주소는 고급 관리의 계속 준비 버튼으로 다음 분량을 확인하세요. 자동으로 반복 요청하지 않습니다.'));
  if(progress&&object(progress.exhausted)&&typeof progress.exhausted.youtube==='boolean'&&typeof progress.exhausted.instagram==='boolean'){current.append(el('p',`현재 검토 가능한 자료 확인: YouTube ${progress.exhausted.youtube?'이번 범위 완료':'남은 자료 있음'} · Instagram ${progress.exhausted.instagram?'이번 범위 완료':'남은 자료 있음'}. 범위 완료는 목표 달성이나 전체 원본 검토 완료가 아닙니다.`));if(integer(progress.unreviewedInstagram,Number.MAX_SAFE_INTEGER))current.append(el('p',`일일 근거 검토가 없는 Instagram 원본 ${progress.unreviewedInstagram}개 · 자동 승인하거나 목표에 포함하지 않습니다.`));}
  for(const reason of [...new Set([...config.blockers,...(Array.isArray(state.discovery.blockers)?state.discovery.blockers:[])])])blockers.append(el('li',label(reason)));
  if(!state.recurringTriggerVerified)blockers.append(el('li','실제 반복 실행 연결이 미확인입니다. 일정을 허용해도 외부 실행 연결 전에는 자동 실행되지 않습니다.'));
  for(const path of uncertain.keys())blockers.append(el('li',`${path} 저장 여부가 불확실합니다. 자동 재시도하지 않습니다. 해당 원본 또는 이력을 확인해야 합니다.`));
  schedule.textContent=state.recurringTriggerVerified?'검토한 일정으로 반복 실행 허용':'일일 실행 설정 허용 · 반복 실행 미연결';
  const time=String(config.schedule.hour).padStart(2,'0')+':'+String(config.schedule.minute).padStart(2,'0');scheduleInfo.textContent=`저장된 일정: 매일 ${time} (Asia/Seoul) · ${config.schedule.confirmed?'시각 확인됨':'시각 미확인'} · 분류: ${display(config.classification)}`;
 }
 function drawList(node,items,fields){node.replaceChildren();if(!items.length){node.append(el('p','확인된 기록이 없습니다.'));return;}for(const row of items.slice(0,1000)){if(!object(row))continue;const card=el('div');card.className='evidence';for(const [key,title] of fields)if(row[key]!==undefined)card.append(el('p',`${title}: ${display(row[key])}`));node.append(card);}}
 function clearCandidateDraft(){reviewJSON.value='';reviewCheck.box.checked=false;delete acknowledged[reviewCheck.box.id];}
 function pagePath(kind,cursor){return (kind==='supply'?'/supply-review':'/source-reviews')+(cursor?'?cursor='+encodeURIComponent(cursor):'');}
 function pageButton(node,id,title,unavailable,handler){const button=control('button',id);button.textContent=title;button.type='button';pageControls.set(button,unavailable);button.disabled=busy||disposed||!getOwner()||unavailable;button.addEventListener('click',()=>{if(busy||disposed||button.disabled)return;return handler();});node.append(button);}
 function dropPageControls(prefix){for(const button of pageControls.keys())if(button.id.startsWith(prefix))pageControls.delete(button);}
 function drawSupply(raw,cursor=reviewCursors.at(-1)){
  if(!object(raw)||raw.scope!=='paged_native_instagram_and_current_youtube_snapshots'||raw.preparationEligibilityChecked!==false||raw.requiresHumanReview!==true||raw.contactCollectionSupported!==false||!Array.isArray(raw.items)||raw.items.length>5050||raw.items.some(x=>!object(x)||!['youtube','instagram'].includes(x.platform)))fail('후보 검토 응답을 확인하지 못했습니다.');
  const p=reviewPagination(raw,'existing_instagram_database',50,cursor),groups={youtube:raw.items.filter(x=>x.platform==='youtube'),instagram:raw.items.filter(x=>x.platform==='instagram')};
  if(groups.youtube.length>5000||groups.instagram.length!==p.returned)fail('후보 페이지 크기를 확인하지 못했습니다.');cache.supply=raw;
  const rows=groups[reviewPlatform],pages=Math.max(1,Math.ceil(groups.youtube.length/50));reviewPage=Math.min(reviewPage,pages-1);dropPageControls('campaign-candidates-');reviewList.replaceChildren();const nav=el('div');
  for(const [platform,title] of [['youtube','YouTube'],['instagram','기존 Instagram']])pageButton(nav,'campaign-candidates-'+platform,`${title} (${platform==='youtube'?groups.youtube.length:p.total})`,platform===reviewPlatform,()=>{reviewPlatform=platform;clearCandidateDraft();drawSupply(raw);controls();});
  for(const [delta,title,name] of [[-1,'이전 후보 페이지','previous'],[1,'다음 후보 페이지','next']])pageButton(nav,'campaign-candidates-'+name,title,reviewPlatform==='youtube'?(delta<0?reviewPage===0:reviewPage===pages-1):(delta<0?reviewCursors.length===1:!p.hasMore),()=>{if(reviewPlatform==='instagram')return loadPage('supply',delta);reviewPage+=delta;clearCandidateDraft();drawSupply(raw);controls();});
  nav.append(el('p',reviewPlatform==='youtube'?`YouTube ${reviewPage+1}/${pages} 페이지 · 현재 유효 검색 스냅샷 ${rows.length}명 · 페이지당 50명`:`기존 Instagram 조회 ${reviewCursors.length}페이지 · 내 원본 DB 전체 ${p.total}개 · 이 페이지 원본 ${p.returned}개 / 표시 후보 ${rows.length}명 · 이후 남은 원본 ${p.remaining-p.returned}개 · 페이지당 최대 50개`));
  nav.append(el('p','범위: 현재 계정의 유효 YouTube 검색 스냅샷과 기존 Instagram 원본 한 페이지입니다. 원본 수는 검토 완료·발송 가능 인원 수가 아닙니다. 다음 페이지는 버튼을 누를 때만 조회합니다.'));
  nav.append(el('p','실행 준비 확인 대기: 이 목록은 준비 대상 적격성과 전체 과거 발송 이력을 확인하지 않았습니다. 목록 조회 성공이 자동 발송 준비 완료를 뜻하지 않습니다.'));
  if(p.total>10000)nav.append(el('p','기존 Instagram 원본이 많습니다. 원본 수를 준비 대상 수로 집계하지 않습니다. 실제 준비 범위와 부족한 주소 수는 서버 준비 결과로 확인하세요.'));
  reviewList.append(nav);
  if(!rows.length)reviewList.append(el('p',reviewPlatform==='youtube'?'현재 유효 YouTube 검색 후보가 없습니다.':'이 페이지에 표시할 Instagram 후보가 없습니다. 전체 원본이 없다는 뜻은 아닙니다.'));
  for(const row of reviewPlatform==='youtube'?rows.slice(reviewPage*50,(reviewPage+1)*50):rows){
   if(row.platform==='instagram'){
    const c=row.candidate;if(!object(c)||!creator(row.creator_key)){const held=el('div','기존 Instagram 원본 검토 보류: 계정 식별 정보를 확인하지 못했습니다. 이 원본은 승인하거나 발송할 수 없습니다.');held.className='evidence';reviewList.append(held);continue;}const card=el('div');card.className='evidence';card.append(el('p',`기존 Instagram · ${display(c.name)} · ${display(row.creator_key)} · ${display(row.reviewState)} · 원본 갱신 ${display(c.sourceRecordUpdated)}`));
    const url=safeCampaignUrl(c.profileUrl);if(url){const a=el('a','기존 Instagram 프로필 보기');a.href=url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
    const choose=el('button','이 기존 Instagram 후보의 빈 검토 양식');choose.type='button';choose.disabled=c.excluded===true||row.reviewState==='excluded';choose.addEventListener('click',()=>{if(busy||disposed||choose.disabled)return;reviewJSON.value=JSON.stringify({creatorKey:row.creator_key,sourceRecordId:c.sourceRecordId,sourceRecordUpdated:c.sourceRecordUpdated,audience:null,audienceSource:'',audienceCheckedAt:'',lastActiveAt:'',activitySource:'',activityCheckedAt:'',mukbang:{verified:false,sourceUrl:'',sourceText:'',checkedAt:''},contactEvidence:[]},null,2);reviewCheck.box.checked=false;controls();});const viewCopy=el('button','카피 보기');viewCopy.type='button';viewCopy.addEventListener('click',()=>previewRecipient(row.creator_key));card.append(viewCopy,choose);reviewList.append(card);continue;
   }
   const s=row.snapshot;if(!object(s)||!/^UC[A-Za-z0-9_-]{22}$/.test(s.channelId||'')){const held=el('div','YouTube 스냅샷 검토 보류: 채널 식별 정보를 확인하지 못했습니다.');held.className='evidence';reviewList.append(held);continue;}
   const card=el('div');card.className='evidence';card.append(el('p',`${display(s.title)} · 구독자 ${display(s.subscriberCount)} · 관측 ${display(s.observedAt)} · ${row.review?'근거 등록됨':'원문 검토 필요'}`));
   const a=el('a','YouTube 채널 보기');a.href='https://www.youtube.com/channel/'+s.channelId;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
   const choose=el('button','이 후보의 빈 검토 양식');choose.type='button';choose.addEventListener('click',()=>{if(busy||disposed)return;reviewJSON.value=JSON.stringify({creatorKey:'youtube:'+s.channelId,snapshotObservedAt:s.observedAt,mukbang:{verified:false,sourceUrl:'',sourceText:'',checkedAt:''},displayNameEvidence:{name:'',sourceUrl:'',sourceText:'',checkedAt:'',verified:false,kind:'official_website',creatorKey:'youtube:'+s.channelId,profileUrl:'https://www.youtube.com/channel/'+s.channelId},contactEvidence:[]},null,2);reviewCheck.box.checked=false;controls();});const viewCopy=el('button','카피 보기');viewCopy.type='button';viewCopy.addEventListener('click',()=>previewRecipient('youtube:'+s.channelId));card.append(viewCopy,choose);reviewList.append(card);
  }
 }
 function drawSources(raw,cursor=sourceCursors.at(-1)){
  if(!object(raw)||raw.scope!=='registered_contact_sources'||raw.approvalEnabled!==false||typeof raw.registrationEnabled!=='boolean'||!Array.isArray(raw.items)||raw.items.length>20||raw.items.some(x=>!object(x)))fail('출처 검토 응답을 확인하지 못했습니다.');
  const p=reviewPagination(raw,'registered_contact_sources',20,cursor);if(raw.items.length!==p.returned)fail('출처 페이지 크기를 확인하지 못했습니다.');cache.sources=raw;dropPageControls('campaign-sources-');sourcesList.replaceChildren();const nav=el('div');
  for(const [delta,title,name] of [[-1,'이전 출처 페이지','previous'],[1,'다음 출처 페이지','next']])pageButton(nav,'campaign-sources-'+name,title,delta<0?sourceCursors.length===1:!p.hasMore,()=>loadPage('sources',delta));
  nav.append(el('p',`등록 출처 조회 ${sourceCursors.length}페이지 · 내 등록 출처 전체 ${p.total}개 · 이 페이지 ${p.returned}개 · 이후 남은 출처 ${p.remaining-p.returned}개 · 페이지당 최대 20개`),el('p','범위: 현재 계정에 등록된 출처만 표시합니다. 후보 원본 전체나 승인·발송 가능 인원 집계가 아닙니다. 다음 페이지를 자동 조회하지 않습니다.'));
  const rows=el('div');drawList(rows,raw.items,[['creatorKey','크리에이터'],['sourceUrl','출처'],['state','검토 상태']]);sourcesList.append(nav,rows);
 }
 async function loadPage(kind,delta){
  if(busy||disposed)return;const owner=getOwner(),ticket=epoch,stack=kind==='supply'?reviewCursors:sourceCursors,raw=kind==='supply'?cache.supply:cache.sources;
  if(!owner||!isCurrent(owner)||!raw||delta<0&&stack.length===1||delta>0&&!raw.pagination.hasMore)return;
  const cursor=delta<0?stack[stack.length-2]:raw.pagination.nextCursor;if(delta>0&&stack.includes(cursor))return;
  const oldStack=[...stack];busy=true;if(kind==='supply')clearCandidateDraft();controls();status.textContent='요청한 목록 한 페이지를 조회 중입니다…';
  try{const next=await request(pagePath(kind,cursor),undefined,owner,ticket);if(!active(owner,ticket))return;
   if(delta<0)stack.pop();else stack.push(cursor);
   try{if(kind==='supply')drawSupply(next,cursor);else drawSources(next,cursor);}catch(e){stack.splice(0,stack.length,...oldStack);throw e;}
   reconcile();drawState();status.textContent='요청한 한 페이지를 불러왔습니다. 전체 검토·실행 준비 완료를 뜻하지 않습니다.';
  }catch(e){if(active(owner,ticket)&&e.code!=='STALE')status.textContent='다음 또는 이전 페이지를 확인하지 못했습니다. 현재 표시한 페이지를 유지했습니다. 목록이 끝났거나 후보가 0명이라는 뜻은 아닙니다. 전체 상태 새로고침 후 다시 확인하세요.';
  }finally{if(active(owner,ticket)){busy=false;controls();}}
 }
 async function refreshReads(owner,ticket,seed){
  preparedToken++;cache.prepared=null;preparedList.replaceChildren(el('p','오늘 준비한 수신 주소 확인 중…'));
  const paths=['/status','/configuration','/runs',pagePath('supply',reviewCursors.at(-1)),'/recipient-reviews',pagePath('sources',sourceCursors.at(-1)),'/prepared-recipients'];
  const data=await Promise.allSettled(paths.map(path=>path==='/status'&&seed?Promise.resolve(seed):request(path,undefined,owner,ticket)));
  if(!active(owner,ticket))return;const errors=[];
  if(data[0].status==='fulfilled'&&data[1].status==='fulfilled')try{const next=fullStatus(data[0].value),c=fullConfiguration(data[1].value);if(next.campaign.revision!==c.revision)fail('설정 버전이 조회 중 바뀌었습니다. 다시 확인하세요.');state=next;acceptConfig(c);}catch(e){state=null;config=null;errors.push(e.message);}else{state=null;config=null;errors.push('서버 연결·배포 대기: 캠페인 상태 조회 실패. 후보 0명으로 처리하지 않았습니다.');}
  if(data[2].status==='fulfilled'){cache.runs=data[2].value;drawRuns(data[2].value);}else{cache.runs=null;runs.replaceChildren(el('p','실행 이력을 확인하지 못했습니다. 이력이 없다는 뜻은 아닙니다.'));errors.push('실행 이력 조회 실패');}
  if(data[3].status==='fulfilled')try{drawSupply(data[3].value);}catch(e){cache.supply=null;reviewList.replaceChildren(el('p',e.message));errors.push(e.message);}else{cache.supply=null;reviewList.replaceChildren(el('p','후보 검토 목록을 확인하지 못했습니다.'));errors.push('후보 검토 조회 실패');}
  if(data[4].status==='fulfilled'&&Array.isArray(data[4].value)&&data[4].value.length<=1000){cache.recipients=data[4].value;drawList(recipientsList,cache.recipients,[['creator_key','크리에이터'],['recipient','이메일'],['status','검토 상태'],['classification','분류'],['policy_revision','설정 버전'],['expires_at','유효기한']]);}else{cache.recipients=null;recipientsList.replaceChildren(el('p','수신자 검토 목록을 확인하지 못했습니다.'));errors.push('수신자 검토 조회 실패');}
  if(data[5].status==='fulfilled')try{drawSources(data[5].value);}catch(e){cache.sources=null;sourcesList.replaceChildren(el('p',e.message));errors.push(e.message);}else{cache.sources=null;sourcesList.replaceChildren(el('p','출처 검토 목록을 확인하지 못했습니다.'));errors.push('출처 조회 실패');}
  if(data[6].status==='fulfilled')try{drawPrepared(data[6].value);}catch(e){cache.prepared=null;preparedList.replaceChildren(el('p',e.message+' 확인된 0개로 처리하지 않았습니다.'));errors.push('준비 주소 조회 형식 확인 필요');}else{cache.prepared=null;preparedList.replaceChildren(el('p','오늘 준비한 수신 주소를 불러오지 못했습니다. 빈 목록이나 0개로 처리하지 않았습니다. 상태를 새로고침하세요.'));errors.push('준비 주소 조회 실패');}
  reconcile();drawState();status.textContent=errors.length?errors.join(' · '):uncertain.size?'상태를 조회했습니다. 불확실한 요청은 확인 전까지 다시 실행하지 않습니다.':'캠페인 상태를 불러왔습니다. 각 작업은 아래 버튼을 눌러야 실행됩니다.';
 }
 function drawPrepared(raw){
  const result=preparedRecipients(raw,kstDay()),token=preparedToken,owner=getOwner(),ticket=epoch;cache.prepared=result;preparedList.replaceChildren(el('p',`${result.day} · 한국시간 기준 · 읽기 전용 준비 목록`));
  for(const [platform,title,metric,target] of [['youtube','YouTube','구독자수',50],['instagram','Instagram','팔로워수',10]]){
   const count=result.counts[platform],rows=result.items.filter(row=>row.platform===platform),section=el('section');section.append(el('h3',`${title} ${count}/${target}개 주소 · 부족 ${target-count}개`));
   if(!rows.length){section.append(el('p',`오늘 준비된 ${title} 수신 주소가 없습니다. 아직 ${target}개가 부족합니다.`));preparedList.append(section);continue;}
   const wrap=el('div');wrap.className='creator-table-wrap';const table=el('table');table.className='creator-table';table.setAttribute('aria-label',`${title} 오늘 준비한 수신 주소`);const head=el('thead'),titles=el('tr');for(const text of ['채널명','이메일',metric]){const th=el('th',text);th.setAttribute('scope','col');titles.append(th);}head.append(titles);const body=el('tbody');table.append(head,body);wrap.append(table);section.append(wrap);
   for(const row of rows){const tr=el('tr'),name=el('td'),email=el('td',row.email),audience=el('td',row.audience.toLocaleString('ko-KR')),button=el('button','카피 보기');button.type='button';button.className='compact secondary';button.setAttribute('aria-label',`${row.name} 준비된 이메일 카피 보기`);button.addEventListener('click',()=>{if(token!==preparedToken||busy||!active(owner,ticket))return;return previewRecipient(row.creatorKey);});name.append(el('span',row.name),button);tr.append(name,email,audience);body.append(tr);}preparedList.append(section);
  }
 }
 function drawRuns(raw){
  const list=Array.isArray(raw)?raw:Array.isArray(raw?.runs)?raw.runs:null;
  if(!list||list.length>1000){runs.replaceChildren(el('p','실행 이력 형식을 확인하지 못했습니다.'));return;}
  const names={queued:'대기',processing:'처리 중',held:'보류',reserved:'전송 전 예약',accepted:'Gmail 접수',rejected:'거절',outcome_unknown:'결과 미확인 · 재발송 금지',cancelled:'취소'};
  runs.replaceChildren();if(!list.length)runs.append(el('p','확인된 실행 기록이 없습니다.'));for(const row of list){if(!object(row)||!object(row.counts)||!date(row.updated)||Object.keys(names).some(k=>!integer(row.counts[k],5000))){runs.append(el('p','일부 실행 집계를 확인하지 못했습니다.'));continue;}const card=el('div');card.className='evidence';card.append(el('p',`${display(row.day)} · 갱신 ${display(row.updated)}`));for(const [k,title] of Object.entries(names))card.append(el('p',`${title}: ${row.counts[k]}`));runs.append(card);}runs.append(el('p','Gmail 접수는 수신함 도착·열람 확인이 아닙니다. 결과 미확인 항목은 자동 재발송하지 않습니다.'));
 }
 function reconcile(){
  for(const [path,u] of uncertain){
   let resolved=false;
   if(path==='/collect')resolved=state?.discovery?.latest?.day===u.day&&['completed','failed'].includes(state.discovery.latest.state);
   if(path==='/pause')resolved=config&&config.revision>u.revision&&config.enabled===false&&config.sendEnabled===false;
   if(path==='/configure')resolved=config&&config.revision>u.revision&&config.snapshotId!==u.snapshotId;
   if(path==='/schedule')resolved=config&&config.revision===u.revision&&config.enabled===true&&config.sendEnabled===true;
   if(path==='/review-candidate')resolved=cache.supply?.items.some(r=>r.review&&containsEvidence(r.review,u.payload)&&date(r.review.reviewedAt)&&Date.parse(r.review.reviewedAt)>=Date.parse(u.requestedAt));
   if(path==='/review-recipient')resolved=cache.recipients?.some(r=>r.creator_key===u.payload.creatorKey&&r.recipient===u.payload.recipient&&r.policy_revision===u.revision&&r.status===u.payload.status&&date(r.updated)&&Date.parse(r.updated)>=Date.parse(u.requestedAt));
   if(path==='/register-source-review')resolved=cache.sources?.items.some(r=>r.creatorKey===u.payload.creatorKey&&r.sourceUrl===u.payload.sourceUrl&&r.sourceKind===u.payload.sourceKind);
   // /prepare can append to an existing run. Same-day presence is not proof.
   if(resolved)uncertain.delete(path);
  }
 }
 async function load(seed){if(busy||disposed)return;const owner=getOwner(),ticket=epoch;if(!owner){status.textContent='로그인 후 상태를 불러옵니다.';controls();return;}busy=true;controls();try{await refreshReads(owner,ticket,seed);}finally{if(active(owner,ticket)){busy=false;controls();}}}
 async function mutate(path,payload,message){
  if(busy||disposed||uncertain.has(path))return;const owner=getOwner(),ticket=epoch;if(!owner||!isCurrent(owner))return;busy=true;controls();status.textContent='요청 처리 중…';const before={revision:config?.revision||0,snapshotId:config?.snapshotId||null,payload,day:kstDay(),requestedAt:new Date().toISOString()};
  try{const result=await request(path,payload,owner,ticket);if(!active(owner,ticket))return;
   if(['/configure','/schedule','/pause'].includes(path)){const next=fullConfiguration(result);if(path==='/schedule'?next.revision!==before.revision||!next.enabled||!next.sendEnabled:next.revision<=before.revision||next.enabled||next.sendEnabled)fail('저장된 설정 버전과 실행 상태를 확인하지 못했습니다.');acceptConfig(next);}
   else if(path==='/collect'&&(result?.state!=='completed'||!integer(result.stagedYoutube,100)))fail('신규 후보 탐색 결과를 확인하지 못했습니다.');
   else if(path==='/prepare'&&(!object(result?.counts)||!object(result?.shortfall)||!integer(result.counts.youtube,50)||!integer(result.counts.instagram,10)||!integer(result.shortfall.youtube,50)||!integer(result.shortfall.instagram,10)||result.counts.youtube+result.shortfall.youtube!==50||result.counts.instagram+result.shortfall.instagram!==10))fail('준비 집계를 확인하지 못했습니다.');
   else if(path==='/review-candidate'&&result?.saved!==true)fail('후보 근거 저장 여부를 확인하지 못했습니다.');
   else if(path==='/review-recipient'&&(result?.creatorKey!==payload.creatorKey||result?.status!==payload.status))fail('수신자 검토 저장 여부를 확인하지 못했습니다.');
   else if(path==='/register-source-review'&&(!uuid(result?.sourceId)||!integer(result.revision,Number.MAX_SAFE_INTEGER)||result.revision<1||!['pending','reviewed','revoked'].includes(result.state)||typeof result.created!=='boolean'))fail('출처 등록 결과를 확인하지 못했습니다.');
   if(path==='/configure'){staged=null;privateFile.value='';preview.replaceChildren();copyCheck.box.checked=false;}
   if(path==='/review-candidate'){reviewCheck.box.checked=false;reviewJSON.value='';}if(path==='/review-recipient'){recipientCheck.box.checked=false;recipientJSON.value='';}if(path==='/register-source-review')sourceCheck.box.checked=false;scheduleCheck.box.checked=false;
   await refreshReads(owner,ticket);if(active(owner,ticket))status.textContent=message;
  }catch(e){if(active(owner,ticket)&&e.code!=='STALE'){
    // Only explicit client-side/auth/version validation failures are known not to have committed.
    const rejected=e.beforeRequest||[400,401,403,404,413].includes(e.httpStatus)||e.httpStatus===409&&['CAMPAIGN_REVISION_CHANGED','REVISION_REQUIRED','SUPPLY_REVIEW_STALE','INSTAGRAM_REVIEW_SOURCE_CHANGED','COLLECTION_REQUIRED'].includes(e.code);
    if(!rejected)uncertain.set(path,before);
    status.textContent=rejected?'요청이 거절되었습니다. 입력·권한·현재 버전을 확인하세요. '+(e.code||''):'저장 결과가 불확실합니다. 다시 누르지 말고 전체 상태를 조회하세요. 자동 재시도하지 않습니다.';
    if(e.code==='AUTH_REQUIRED'){state=null;config=null;}drawState();
   }}finally{if(active(owner,ticket)){busy=false;controls();}}
 }
 async function previewRecipient(creatorKey){
  if(disposed||!getOwner()||!creator(creatorKey))return;
  if(previewKey===creatorKey&&previewAbort)return;
  clearMailPreview();const owner=getOwner(),ticket=epoch,token=previewToken,identityAtStart=identity();previewKey=creatorKey;mailPreview.hidden=false;mailPreview.focus?.();mailPreview.scrollIntoView?.({behavior:'smooth',block:'start'});
  if(!config?.snapshotId){mailMeta.textContent='비공개 고정 카피·사진 설정이 아직 등록되지 않아 개별 카피를 표시할 수 없습니다. 설정을 완료한 뒤 다시 확인하세요.';return;}
  if(busy){mailMeta.textContent='현재 설정을 확인 중입니다. 완료 후 카피 보기를 다시 눌러주세요.';return;}
  mailMeta.textContent='이 수신자의 고정 카피·사진·기존 Gmail 서명을 불러오는 중…';
  const current=()=>active(owner,ticket)&&token===previewToken&&identityAtStart===identity();
  try{const raw=await request('/preview',{creatorKey,expectedRevision:config.revision},owner,ticket);if(!current())return;const result=previewEnvelope(raw,{creatorKey,snapshotId:config.snapshotId,policyRevision:config.revision});
   mailMeta.textContent=`${result.channelName} · 수신 주소: ${result.recipient||'미확인'} · 미리보기 전용, 발송하지 않음`;
   mailContent.append(el('h3',result.subject));const frame=el('iframe');frame.title=result.channelName+' 이메일 카피';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('loading','eager');frame.srcdoc=privatePreviewDocument(result.html);renderedFrame=frame;mailContent.append(frame);
   for(const warning of [...new Set([...result.warnings,'preview_is_not_send_authorization'])])mailWarnings.append(el('p',previewWarning(warning)));
  }catch(e){if(current()){mailContent.replaceChildren();mailMeta.textContent=e.code==='AUTH_REQUIRED'?'로그인 상태를 다시 확인하세요.':e.code==='NOT_FOUND'||e.httpStatus===404?'개별 카피 미리보기 연결이 아직 준비되지 않았습니다. 저장된 카피와 발송 상태는 변경하지 않았습니다.':e.code==='PRIVATE_TEMPLATE_REQUIRED'?'비공개 고정 카피·사진 설정이 필요합니다.':e.code==='CAMPAIGN_REVISION_CHANGED'?'설정이 바뀌었습니다. 상태를 새로고침한 뒤 카피를 다시 확인하세요.':'개별 카피를 확인하지 못했습니다. 다시 확인하세요. 메일을 보내거나 초안을 생성하지 않았습니다.';}}
 }
 privateFile.addEventListener('change',async()=>{
  if(busy||disposed)return;const owner=getOwner(),ticket=epoch,token=++importToken;staged=null;preview.replaceChildren();copyCheck.box.checked=false;controls();const file=privateFile.files?.[0];if(!file)return;
  try{if(file.size>5*1024*1024)fail('설정 파일은 5 MiB 이하만 가능합니다.');const raw=parsePrivateJSON(await file.text());const result=await validatePrivateImport(raw,owner);await decodePrivateImages(result.snapshot);if(!active(owner,ticket)||token!==importToken)return;staged=result;
   preview.append(el('p','로컬 검증 완료. 아직 서버에 저장하지 않았습니다.'),el('h3',result.snapshot.template.subject));const body=el('p',result.snapshot.template.body);body.className='evidence';preview.append(body);
   for(const id of result.snapshot.template.requiredInlineImageIds){const im=result.snapshot.images.find(x=>x.id===id),img=el('img');img.src='data:image/png;base64,'+im.content;img.alt=im.alt||'본문 제품 사진';img.width=Math.min(im.width,320);preview.append(img);}
   preview.append(el('p','사진 아래: 서버에 저장된 기존 Gmail 서명. 실제 서명은 저장 시 서버가 검증합니다.'),el('p',`저장할 분류: ${result.policy.classification} · 매일 ${String(result.policy.schedule.hour).padStart(2,'0')}:${String(result.policy.schedule.minute).padStart(2,'0')} 한국시간 · ${result.policy.schedule.confirmed?'시각 확인됨':'시각 미확인'}`));
  }catch(e){if(active(owner,ticket)&&token===importToken)preview.replaceChildren(el('p',e.message));}finally{if(active(owner,ticket)&&token===importToken)controls();}
 });
 function guarded(button,handler){button.addEventListener('click',()=>{if(button.disabled||busy||disposed)return;try{return handler();}catch(e){status.textContent=e.message;controls();}});}
 refresh.addEventListener('click',()=>load());guarded(collect,()=>mutate('/collect',{},'오늘의 신규 후보 탐색을 완료했습니다. 원문 근거를 검토한 뒤 후보를 준비하세요.'));guarded(prepare,()=>mutate('/prepare',{},'검토 후보 준비 요청을 완료했습니다. 준비 수는 발송 수가 아닙니다.'));
 guarded(configure,()=>mutate('/configure',{expectedRevision:config.revision,...staged},'비공개 고정 원본을 새 버전으로 저장했습니다. 캠페인은 일시정지 상태입니다.'));
 guarded(schedule,()=>mutate('/schedule',{expectedRevision:config.revision},'반복 실행 정책을 저장했습니다. 현재 연결 상태와 실행 이력을 확인하세요.'));
 guarded(pause,()=>mutate('/pause',{expectedRevision:config.revision},'캠페인을 일시정지했습니다. 이미 전송 처리에 들어간 메일은 취소되지 않을 수 있습니다.'));
 guarded(reviewSave,()=>mutate('/review-candidate',validateCandidateReview(parsePrivateJSON(reviewJSON.value,16000),cache.supply.items),'후보 원문 근거를 저장했습니다. 연락처와 수신자 발송 근거는 별도 검토하며, 필요한 경우 다시 준비하세요.'));
 guarded(recipientSave,()=>mutate('/review-recipient',validateRecipientReview(parsePrivateJSON(recipientJSON.value,16000),config),'수신자별 근거를 저장했습니다. 이 작업 자체는 메일을 보내지 않습니다.'));
 guarded(sourceSave,()=>{const sourceKindValue=sourceKind.value,url=safeCampaignUrl(sourceURL.value.trim()),key=sourceKey.value.trim();if(!creator(key)||!url||!['official_website','instagram_public_bio'].includes(sourceKindValue))fail('크리에이터 ID와 공개 HTTPS 출처를 확인하세요.');if(sourceKindValue==='official_website'&&nonIndependent(url))fail('YouTube 연락처 수집은 지원하지 않습니다. 공식 웹사이트 출처를 입력하세요.');if(sourceKindValue==='instagram_public_bio'&&(!key.startsWith('instagram:')||!['https://www.instagram.com/'+key.slice(10)+'/','https://instagram.com/'+key.slice(10)+'/'].includes(url)))fail('같은 Instagram 계정의 공개 프로필만 등록할 수 있습니다.');return mutate('/register-source-review',{creatorKey:key,sourceUrl:url,sourceKind:sourceKindValue},'공식 출처 검토 요청을 등록했습니다. 출처 승인·수집·발송은 아직 완료된 것이 아닙니다.');});
 for(const [input,check] of [[reviewJSON,reviewCheck.box],[recipientJSON,recipientCheck.box],[sourceKey,sourceCheck.box],[sourceURL,sourceCheck.box],[sourceKind,sourceCheck.box]])input.addEventListener('input',()=>{check.checked=false;controls();});
 for(const x of [copyCheck.box,scheduleCheck.box,reviewCheck.box,recipientCheck.box,sourceCheck.box])x.addEventListener('change',()=>{if(x.checked)acknowledged[x.id]=identity();else delete acknowledged[x.id];controls();});
 controls();
 return {previewRecipient,load:()=>{const seed=initialStatus;initialStatus=null;return load(seed);},clear(){preparedToken++;preparedList.replaceChildren(el('p','로그인 후 오늘 준비한 수신 주소를 확인합니다.'));clearMailPreview();overview.replaceChildren();epoch++;importToken++;disposed=true;for(const p of pending)p.abort();pending.clear();uncertain.clear();pageControls.clear();reviewCursors.splice(0,reviewCursors.length,null);sourceCursors.splice(0,sourceCursors.length,null);reviewPlatform='youtube';reviewPage=0;staged=null;state=null;config=null;for(const k of Object.keys(cache))delete cache[k];privateFile.value='';reviewJSON.value='';recipientJSON.value='';sourceKey.value='';sourceURL.value='';preview.replaceChildren();current.replaceChildren();blockers.replaceChildren();reviewList.replaceChildren();recipientsList.replaceChildren();sourcesList.replaceChildren();runs.replaceChildren();for(const x of allInputs)if(x.type==='checkbox')x.checked=false;status.textContent='로그인 후 상태를 불러옵니다.';controls();}};
}
