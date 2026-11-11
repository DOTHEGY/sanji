// A candidate's project membership is not proof that a particular message came
// from that project. Only persisted thread/outbox project provenance is exact.
export function youtubeThreadProject(thread, outbox = []) {
  if (!thread || thread.channel !== 'email') return {status:'unassigned'};
  const direct = typeof thread.projectId === 'string' ? thread.projectId.trim() : '';
  const matches = outbox.filter(o => o && o.channel === 'email' && o.target === thread.target &&
    o.data && (o.data.providerThread && o.data.providerThread === thread.providerId ||
      Array.isArray(thread.messages) && thread.messages.some(m => m.outboxId && m.outboxId === o.id)));
  const ids = new Set(matches.map(o => typeof o.data.projectId === 'string' ? o.data.projectId.trim() : '').filter(Boolean));
  if (direct) ids.add(direct);
  if (ids.size === 1) return {status:'confirmed', projectId:[...ids][0]};
  return {status:ids.size > 1 ? 'ambiguous' : 'unassigned'};
}
