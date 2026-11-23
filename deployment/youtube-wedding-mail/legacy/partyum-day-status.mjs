const project = 'private-wedding-research';
const channel = /^UC[A-Za-z0-9_-]{22}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const civilDate = /^\d{4}-\d{2}-\d{2}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const sources = Object.freeze({
  scheduled: 'confirmed-current-reservation',
  sent: 'accepted-provider-receipt',
  failed: 'recorded-terminal-failure',
});
const maximum = 100;
function bad(message) {
  return Object.assign(new Error(message),{code:message});
}
const isDate = x => typeof x === 'string' && civilDate.test(x) &&
  Number.isFinite(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const isStamp = x => typeof x === 'string' && timestamp.test(x) &&
  isDate(x.slice(0,10)) && Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString().slice(0,19)===x.slice(0,19);
const isChannel = x => typeof x === 'string' && channel.test(x);

/**
 * A trusted server-side adapter supplies bindings. This module does not read database
 * internals, switch credentials, infer a Partyum mapping from email, or mutate anything.
 * `actor` must come from the already-established member/auth guard (never the body).
 * The shortlist loader must be scoped by owner, project and discovery-day.
 * The snapshot adapter must implement the evidence contract in README.md.
 */
export async function readPartyumDayStatus({
  actor, input, readShortlist, readSnapshot, now = Date.now,
}) {
  if (typeof actor !== 'string' || !uuid.test(actor)) throw bad('AUTH');
  if (!input || Object.getPrototypeOf(input)!==Object.prototype ||
      Object.keys(input).sort().join(',')!=='channelIds,day,projectId' ||
      input.projectId!==project || !isDate(input.day) || !Array.isArray(input.channelIds) ||
      input.channelIds.length<1 || input.channelIds.length>maximum ||
      !input.channelIds.every(isChannel) || new Set(input.channelIds).size!==input.channelIds.length) {
    throw bad('SCOPE');
  }
  if (typeof readShortlist!=='function') throw bad('READ');
  const {day,channelIds} = input;
  const requested = new Set(channelIds);
  const scope = Object.freeze({owner:actor,projectId:project,day,channelIds:Object.freeze([...requested])});
  const matches = await readShortlist(scope);
  const inScope = x => x?.owner===actor && x.projectId===project && x.day===day &&
    requested.has(x.channelId);
  if (!Array.isArray(matches) || !matches.every(inScope) ||
      new Set(matches.map(m=>m.channelId)).size!==matches.length) throw bad('READ');
  // Treat an absent ID and a foreign ID alike, without revealing another owner’s data.
  if (matches.length!==requested.size) throw bad('SCOPE');
  const unknown = channelId => ({channelId,status:'unknown',at:null,completeForCandidate:false});
  const result = items => ({projectId:project,day,items});
  const failClosed = () => result([...requested].map(unknown));
  if (typeof readSnapshot!=='function') return failClosed();
  let snapshot;
  try { snapshot = await readSnapshot(scope); } catch { return failClosed(); }
  if (snapshot?.owner!==actor || snapshot?.projectId!==project || snapshot?.day!==day ||
      !Array.isArray(snapshot?.entries) || !snapshot.entries.every(inScope) ||
      snapshot.entries.length>maximum*2) return failClosed();
  const evidence = new Map();
  const conflicting = new Set();
  for (const row of snapshot.entries) {
    if (evidence.has(row.channelId)) conflicting.add(row.channelId);
    evidence.set(row.channelId,row);
  }
  const claimants=new Map();
  for (const row of evidence.values()) {
    if (!Array.isArray(row.events)||row.events.length!==1) continue;
    const event=row.events[0];
    if (!inScope(event)||typeof event.proofId!=='string') continue;
    const claim=claimants.get(event.proofId);
    if (claim&&claim!==row.channelId) { conflicting.add(claim); conflicting.add(row.channelId); }
    claimants.set(event.proofId,row.channelId);
  }
  let t;
  try { t = now(); } catch { return failClosed(); }
  if (!Number.isFinite(t)) return failClosed();
  return result([...requested].map(id=>{
    const row=evidence.get(id);
    if (conflicting.has(id)||!row||row.exhaustive!==true||!Array.isArray(row.events)) return unknown(id);
    if (row.events.length===0) return {channelId:id,status:'found_only',at:null,completeForCandidate:true};
    if (row.events.length!==1) return unknown(id);
    const e=row.events[0];
    if (!inScope(e)||e.channelId!==id||!Object.hasOwn(sources,e.status)||
        sources[e.status]!==e.source||!isStamp(e.at)||typeof e.proofId!=='string'||
        !/^[A-Za-z0-9:_-]{1,128}$/.test(e.proofId)) return unknown(id);
    const when=Date.parse(e.at);
    if ((e.status==='scheduled'&&when<=t)||(e.status!=='scheduled'&&when>t)) return unknown(id);
    // No proof IDs, owner, contact email, private draft data or copy leave the reader.
    return {channelId:id,status:e.status,at:e.at,completeForCandidate:true};
  }));
}
