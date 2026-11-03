// Keyset pagination by immutable UUID. A second lightweight pass detects
// changes during the scan; continuously changing data fails closed.
export async function loadStableStateRecords({fetchPage,owner,pageSize=500,maxPages=40,maxAttempts=3}) {
 if(typeof fetchPage!=='function'||typeof owner!=='string'||!owner)throw Error('계정 확인 후 다시 불러오세요.');
 async function scan(summary){const rows=[];let cursor='';for(let page=0;page<maxPages;page++){
  const part=await fetchPage({owner,cursor,summary,pageSize});if(!Array.isArray(part)||part.length>pageSize)throw Error('목록 조회가 불완전합니다. 다시 불러오세요.');
  for(const r of part){if(!r||typeof r.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.id)||r.owner!==owner||!Number.isInteger(r.version)||typeof r.updated!=='string'||!Number.isFinite(Date.parse(r.updated))||(cursor&&r.id<=cursor))throw Error('목록 순서 또는 소유자를 확인할 수 없습니다.');cursor=r.id;rows.push(r)}
  if(part.length<pageSize)return rows;
 }throw Error('목록이 너무 많아 안전하게 불러오지 못했습니다.');}
 const same=(a,b)=>a.length===b.length&&a.every((r,i)=>r.id===b[i].id&&r.version===b[i].version&&r.updated===b[i].updated);
 for(let i=0;i<maxAttempts;i++){const rows=await scan(false),check=await scan(true);if(same(rows,check))return rows.sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated)||a.id.localeCompare(b.id));}
 throw Error('목록이 계속 변경되어 전체 상품을 확인하지 못했습니다. 잠시 후 다시 불러오세요.');
}
