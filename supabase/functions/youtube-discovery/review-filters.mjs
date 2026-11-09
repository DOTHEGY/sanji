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

// Conservative, inspectable review reasons; affiliation alone is never an exclusion.
export function mukbangReview(channel,now=Date.now()) {
 const reasons=reviewReasons(channel,{minimumSubscribers:30000,now});
 const recent=(channel.recentVideos||[]).filter(v=>Number.isFinite(Date.parse(v.publishedAt))&&Date.parse(v.publishedAt)<=now&&Date.parse(v.publishedAt)>=now-180*86400000);
 const evidence=recent.filter(v=>/(?:먹방|\bmukbang\b)/iu.test(v.title||'')&&!/게임|\bgaming\b|뉴스|\bnews\b|먹방\s*(?:아닌|아니|아닙|제외)|\b(?:not|no)\s+mukbang\b/iu.test(v.title||''));
 if(!evidence.length)reasons.push('최근 180일 업로드 최대 5개에서 먹방 제목 표현 미확인');
 for(const flag of channel.contentFlags||[])if(['news_language','business_language','corporate_mcn_language'].includes(flag.kind))reasons.push(flag.label);
 return {reasons,evidence: evidence.map(v=>({videoId:v.videoId,title:v.title,url:v.url,publishedAt:v.publishedAt})),note:'공개 수치와 제목 표현에 따른 검토 대기 후보입니다. 사람 중심·먹방 전문성·소속·브랜드 안전성은 직접 확인하세요. 개인 크리에이터의 MCN 소속만으로 제외하지 않습니다.'};
}
