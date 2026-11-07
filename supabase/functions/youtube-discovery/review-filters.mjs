// User-selected thresholds over raw API statistics, never a derived creator score.
export function reviewReasons(channel,{minimumSubscribers=0,minimumViews=0,now=Date.now()}={}) {
 const reasons=[];
 if(minimumSubscribers>0){
  if(channel.subscriberCount==null)reasons.push('구독자 수 비공개·미확인');
  else if(channel.subscriberCount<minimumSubscribers)reasons.push(`구독자 ${minimumSubscribers.toLocaleString('ko-KR')}명 미만`);
 }
 if(minimumViews>0){
  const recent=(channel.recentVideos||[]).filter(v=>v.publishedAt&&Date.parse(v.publishedAt)<=now&&Date.parse(v.publishedAt)>=now-90*86400000);
  if(!recent.some(v=>v.viewCount!=null&&v.viewCount>=minimumViews))reasons.push('최근 90일 업로드 최대 5개에서 조회수 조건 충족 미확인');
 }
 return reasons;
}
export function orderCandidates(rows,order='source'){
 if(order!=='subscribers')return [...rows];
 return [...rows].sort((a,b)=>(b.channel.subscriberCount??-1)-(a.channel.subscriberCount??-1));
}
