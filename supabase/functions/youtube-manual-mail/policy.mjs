import {CAMPAIGN_CLASSIFICATIONS} from '../creator-daily-outreach/private-config.mjs';
export function manualMailPolicy(policy,owner,revision){
 const d=policy?.data,valid=policy?.owner===owner&&policy.revision===revision&&CAMPAIGN_CLASSIFICATIONS.includes(d?.classification)&&typeof d.classificationSource==='string'&&d.classificationSource.trim().length>0&&d.classificationSource.length<=2000&&typeof d.authorizationSource==='string'&&d.authorizationSource.trim().length>0&&d.authorizationSource.length<=2000;
 if(!valid)throw Object.assign(new Error('MESSAGE_CLASSIFICATION_REVIEW_REQUIRED'),{code:'MESSAGE_CLASSIFICATION_REVIEW_REQUIRED'});
 return {classification:d.classification,classificationSource:d.classificationSource,authorizationSource:d.authorizationSource};
}
