import {OutreachError} from './domain.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail=code=>{throw new OutreachError(code,'검토 목록의 범위와 현재 원본을 확인하지 못했습니다. 목록을 새로고침하세요.',503);};
export function reviewCursor(value=null){
 if(value!==null&&!uuid(value))throw new OutreachError('REVIEW_CURSOR_INVALID','검토 목록의 페이지 위치를 확인하세요.',400);
 return value;
}
// A page is a bounded review view, never a complete candidate/history scan.
// Exact counts include excluded/unreviewed rows. Two stable reads reject changes
// during this request; pages do not promise a frozen cross-request snapshot.
export async function readReviewPage(sb,{table,owner,key='id',columns,scope,cursor=null,pageSize=50,filter}){
 reviewCursor(cursor);
 if(!uuid(owner)||![20,50].includes(pageSize))fail('REVIEW_PAGE_INVALID');
 const once=async()=>{
  let totalQuery=sb.from(table).select(key,{count:'exact',head:true}).eq('owner',owner);
  let pageQuery=sb.from(table).select(columns,{count:'exact'}).eq('owner',owner).order(key,{ascending:true}).limit(pageSize);
  if(filter){totalQuery=filter(totalQuery);pageQuery=filter(pageQuery);}if(cursor)pageQuery=pageQuery.gt(key,cursor);
  const [all,page]=await Promise.all([totalQuery,pageQuery]),rows=page.data,total=all.count,remaining=page.count;
  if(all.error||page.error)fail('REVIEW_PAGE_READ_FAILED');
  if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(remaining)||remaining<0||remaining>total||!Array.isArray(rows)||rows.length>pageSize||remaining<rows.length||(!cursor&&remaining!==total)||(!rows.length&&remaining>0))fail('REVIEW_PAGE_INCOMPLETE');
  let prior=cursor||'';for(const row of rows){if(row.owner!==owner||!uuid(row[key])||row[key]<=prior)fail('REVIEW_PAGE_INCOMPLETE');prior=row[key];}
  const hasMore=remaining>rows.length;
  return {rows,pagination:{scope,cursor,nextCursor:hasMore?prior:null,pageSize,total,remaining,returned:rows.length,hasMore}};
 };
 const first=await once(),second=await once();
 if(JSON.stringify(first)!==JSON.stringify(second))fail('REVIEW_PAGE_CHANGED');
 return first;
}
