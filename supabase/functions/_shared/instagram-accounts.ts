// Never choose a different account silently for an existing conversation.
export function selectInstagramAccount(accounts: any[], thread: any) {
  if (thread.connectionKey)
    return accounts.find((a) => a.provider === thread.connectionKey) || null;
  // Legacy conversations had only one possible connected account.
  return accounts.length === 1 ? accounts[0] : null;
}
export function sameInstagramConversation(thread: any, provider: string, senderId: string) {
  return thread.channel === "instagram" && thread.senderId === senderId &&
    (thread.connectionKey === provider || (!thread.connectionKey && provider === "instagram"));
}
