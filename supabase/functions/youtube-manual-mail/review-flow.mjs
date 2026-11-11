// Review-only transaction coordinator. Repository is owner-scoped and only
// server-instantiated. It does not create/send Gmail requests.
export function createManualReviewFlow({prepare,repository,now=Date.now}){
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 return {
  async preview(owner,input){
   const result=await prepare(owner,input);
   if(result?.previewOnly!==true||result.sendingEnabled!==false||result.review?.owner!==owner||!/^[a-f0-9]{64}$/.test(result.approvalHash||''))fail('PREVIEW_INVALID');
   const saved=await repository.createBatch({owner,snapshotId:result.snapshotId,snapshotHash:result.review.snapshotHash,settingsVersion:result.review.settingsVersion,approvalHash:result.approvalHash,review:result.review,policyRevision:result.policyRevision});
   if(!saved||typeof saved.id!=='string'||saved.owner!==owner)fail('PREVIEW_SAVE_UNCERTAIN');
   return {batchId:saved.id,approvalHash:result.approvalHash,previews:result.previews,sharedImages:result.sharedImages,warning:result.warning,sendingEnabled:false};
  },
  async confirm(owner,input){
   if(!input||Object.keys(input).some(k=>!['batchId','approvalHash'].includes(k))||typeof input.batchId!=='string'||!/^[a-f0-9]{64}$/.test(input.approvalHash||''))fail('CONFIRM_INVALID');
   const saved=await repository.batch(owner,input.batchId);
   if(!saved||saved.owner!==owner||saved.approvalHash!==input.approvalHash||!Number.isFinite(Date.parse(saved.expiresAt))||Date.parse(saved.expiresAt)<=now()||!Array.isArray(saved.review?.entries)||!Number.isSafeInteger(saved.policyRevision))fail('REVIEW_EXPIRED');
   const recipients=saved.review.entries.map(({id,version,email})=>({id,version,email}));
   const current=await prepare(owner,{expectedRevision:saved.policyRevision,recipients,...(saved.review.scope?{scope:saved.review.scope}:{})});
   if(current.approvalHash!==input.approvalHash||current.snapshotId!==saved.snapshotId)fail('REVIEW_CHANGED');
   const confirmed=await repository.confirmBatch({owner,batchId:input.batchId,approvalHash:input.approvalHash});
   if(confirmed!==true)fail('CONFIRM_UNCERTAIN');
   return {status:'confirmed',sendingEnabled:false};
  }
 };
}
