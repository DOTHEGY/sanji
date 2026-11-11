import {dailyGmailProvider} from './sender-runtime.mjs';
import {createYoutubeManualPrepare} from '../creator-daily-outreach/youtube-manual-prepare.mjs';
import {youtubeManualRepository} from './repository.mjs';
import {youtubeManualHistorySource} from './history-source.mjs';
import {youtubeHistorySnapshotReader} from './snapshot-reader.mjs';
import {youtubeManualPayloadBuilder} from './payload.mjs';
import {youtubeManualProvider} from './provider.mjs';
import {createManualReviewFlow} from './review-flow.mjs';
import {youtubeManualSendFlow} from './send-flow.mjs';
import {youtubeGmailReviewFlow} from './gmail-review-flow.mjs';
import {scheduledYoutubeWorker} from './scheduled-worker.mjs';
// Independent service candidate. Trigger registration is separate and disabled by default.
export function youtubeManualRuntime({sb,env=(_name)=>'',request=fetch,now=Date.now}){
 const historyProvider=dailyGmailProvider({sb,env,request,now});let repository;
 const historySource=youtubeManualHistorySource({readSnapshot:youtubeHistorySnapshotReader(sb),provider:historyProvider,connection:owner=>repository.currentConnection(owner),now});
 repository=youtubeManualRepository({sb,historySource});
 const prepare=createYoutubeManualPrepare({repository,now}),review=createManualReviewFlow({prepare,repository,now});
 const gmailReview=youtubeGmailReviewFlow({repository,provider:historyProvider,now});
 const sender=youtubeManualSendFlow({repository,payloadBuilder:youtubeManualPayloadBuilder({repository,now}),providerFactory:()=>youtubeManualProvider({sb,env,request,now}),env});
 const worker=scheduledYoutubeWorker({repository,now,dispatch:({owner,batchId,approvalHash,token})=>sender.next(owner,{batchId,approvalHash},token)});
 const runScheduledOne=()=>env('YOUTUBE_MANUAL_SCHEDULER_ENABLED')==='true'?worker.runOne():Promise.resolve({status:'disabled'});
 return {gmailReviewPrepare:gmailReview.prepare,gmailReviewConfirm:gmailReview.confirm,preview:review.preview,confirm:review.confirm,reserve:sender.reserve,schedule:sender.schedule,next:sender.next,status:sender.status,recent:sender.recent,cancel:sender.cancel,runScheduledOne};
}
