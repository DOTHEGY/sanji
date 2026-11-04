// Only these exact routes use the new isolated function; all existing routes retain their targets.
export function functionUrlForPath(path, urls) {
 const pathname=String(path).split('?')[0];
 if(['/creator-manual-notes/list','/creator-manual-notes/save','/creator-manual-notes/targets','/creator-manual-notes/context'].includes(pathname))return urls.creatorManualNotesFunctionUrl;
 if(['/creator-instagram/manual-inbox','/creator-instagram/manual-thread','/creator-instagram/manual-sync','/creator-instagram/manual-draft','/creator-instagram/manual-reviewed-draft','/creator-instagram/manual-review-audit','/creator-instagram/manual-reverify'].includes(pathname))return urls.instagramManualInboxFunctionUrl;
 if(pathname.startsWith('/creator-instagram/'))return urls.instagramInboxFunctionUrl;
 if(pathname==='/dot-snapshot'||pathname.startsWith('/dot-snapshot/'))return urls.dotSnapshotFunctionUrl;
 return urls.edgeFunctionUrl;
}
