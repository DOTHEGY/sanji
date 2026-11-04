// Historical operator notes only. Never reads provider credentials or calls a provider.
export class ManualNoteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const invalid = (message = '수동 메모 입력을 확인하세요.') => new ManualNoteError(400, 'INVALID_NOTE', message);
const validUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value: any, allowed: string[]) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
}
function handle(value: any) {
  if (typeof value !== 'string') throw invalid();
  const result = value.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(result) || ['.', '..'].includes(result)) throw invalid('크리에이터 아이디를 확인하세요.');
  return result;
}
function noteText(value: any, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\u0000')) throw invalid();
  return value;
}
export function validateManualNote(body: any, now = Date.now()) {
  keys(body, ['noteId', 'creatorId', 'handle', 'observedAt', 'sourceUrl', 'inboundWhen', 'summary', 'draft', 'intent', 'afterInboundOutbound', 'recorderType', 'supersedesId']);
  if (!validUuid(body.noteId) || !validUuid(body.creatorId) || (body.supersedesId != null && !validUuid(body.supersedesId)) || body.supersedesId === body.noteId) throw invalid();
  const observedAt = noteText(body.observedAt, 40, true);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(observedAt);
  const full = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(observedAt);
  const parsed = Date.parse(observedAt);
  const calendar = new Date(observedAt.slice(0, 10) + 'T00:00:00.000Z');
  if ((!dateOnly && !full) || !Number.isFinite(parsed) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== observedAt.slice(0, 10) || Number(observedAt.slice(0, 4)) < 2000 || parsed > now) throw invalid('실제로 확인한 과거 날짜나 시각을 입력하세요.');
  let source: URL;
  try { source = new URL(body.sourceUrl); } catch { throw invalid('확인한 Instagram 원문 대화 주소가 필요합니다.'); }
  if (typeof body.sourceUrl !== 'string' || source.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(source.hostname) || source.port || source.username || source.password || source.search || source.hash || !/^\/direct\/t\/\d{1,100}\/?$/.test(source.pathname)) throw invalid('확인한 Instagram 원문 대화 주소가 필요합니다.');
  if (!['user', 'assistant', 'other_authorized_worker'].includes(body.recorderType)) throw invalid();
  return {
    noteId: body.noteId.toLowerCase(), creatorId: body.creatorId.toLowerCase(), handle: handle(body.handle), supersedesId: body.supersedesId?.toLowerCase() || null,
    payload: { observedAt, sourceUrl: source.toString(), inboundWhen: noteText(body.inboundWhen ?? '', 500), summary: noteText(body.summary, 4000, true), draft: noteText(body.draft ?? '', 5000), intent: noteText(body.intent ?? '', 500), afterInboundOutbound: noteText(body.afterInboundOutbound ?? '', 500), recorderType: body.recorderType },
  };
}
export function publicManualNote(row: any) {
  if (!row || !validUuid(row.note_id) || !validUuid(row.creator_id) || typeof row.handle !== 'string' || !object(row.payload) || !Number.isFinite(Date.parse(row.recorded_at))) throw new ManualNoteError(503, 'NOTE_READ_FAILED', '수동 메모를 불러오지 못했습니다.');
  const p = row.payload;
  return { id: row.note_id, creatorId: row.creator_id, handle: row.handle, recordedAt: row.recorded_at, supersedesId: row.supersedes_id || null, observedAt: p.observedAt, sourceUrl: p.sourceUrl, inboundWhen: p.inboundWhen, summary: p.summary, draft: p.draft, intent: p.intent, afterInboundOutbound: p.afterInboundOutbound, recorderType: p.recorderType, recordType: 'manual_historical_note', latestVerified: false, dispatchState: 'not_sent' };
}
async function readInput(req: Request) {
  const declared = req.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 65536)) { await req.body?.cancel().catch(() => {}); throw new ManualNoteError(413, 'INPUT_TOO_LARGE', '메모 입력 크기를 줄여 주세요.'); }
  if (!req.body) return {};
  const reader = req.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let raw = '', size = 0;
  try {
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel().catch(() => {}); throw new ManualNoteError(413, 'INPUT_TOO_LARGE', '메모 입력 크기를 줄여 주세요.'); } raw += decoder.decode(value, {stream:true}); }
    raw += decoder.decode();
    try { return raw ? JSON.parse(raw) : {}; } catch { throw invalid(); }
  } finally { reader.releaseLock(); }
}
export function creatorManualNotesHandler({sb, env, now = () => Date.now()}: any) {
  const origin = env('APP_ORIGIN') || 'https://dothegy.github.io';
  const configured = new URL(origin);
  if (configured.origin !== origin || configured.protocol !== 'https:' || configured.username || configured.password) throw Error('invalid origin');
  const cors = {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', Vary:'Origin', 'Cache-Control':'no-store'};
  const json = (value: any, status = 200) => new Response(JSON.stringify(value), {status, headers:{...cors, 'Content-Type':'application/json'}});
  const query = async (request: any) => { const {data, error} = await request; if (error) throw new ManualNoteError(503, 'NOTE_STORAGE_UNAVAILABLE', '수동 메모 저장소를 확인할 수 없습니다. 입력을 보존한 뒤 다시 확인하세요.'); return data; };
  return async (req: Request) => {
    try {
      if (req.headers.get('origin') && req.headers.get('origin') !== origin) throw new ManualNoteError(403, 'ORIGIN_DENIED', '허용되지 않은 출처입니다.');
      if (req.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
      const parts = new URL(req.url).pathname.split('/').filter(Boolean), offset = parts[0] === 'functions' && parts[1] === 'v1' ? 2 : 0;
      if (parts[offset] !== 'creator-manual-notes') return json({error:'지원하지 않는 경로입니다.'},404);
      const path = '/' + parts.slice(offset + 1).join('/');
      if (path === '/health' && req.method === 'GET') return json({ok:true, capability:'manual_historical_notes', sendingEnabled:false});
      if (req.method !== 'POST' || !['/creator-manual-notes/targets','/creator-manual-notes/list','/creator-manual-notes/save'].includes(path)) return json({error:'지원하지 않는 경로입니다.'},404);
      const authorization = req.headers.get('authorization') || '';
      if (!authorization.startsWith('Bearer ') || !authorization.slice(7)) throw new ManualNoteError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
      const auth = await sb.auth.getUser(authorization.slice(7)), user = auth?.data?.user;
      if (auth?.error || !user || !validUuid(user.id)) throw new ManualNoteError(401, 'AUTH_REQUIRED', '로그인 상태를 확인하세요.');
      const member = await query(sb.from('sanji_members').select('user_id').eq('user_id', user.id).maybeSingle());
      if (!member) throw new ManualNoteError(403, 'MEMBERSHIP_REQUIRED', '접근 권한이 없습니다.');
      const owner = user.id, body = await readInput(req);
      if (path.endsWith('/targets')) {
        keys(body, ['handle']); const targetHandle = handle(body.handle);
        const rows = await query(sb.from('sanji_creator_recovery').select('id,handle,nickname,profile_url,entity_type,assessment,status').eq('owner',owner).ilike('handle',targetHandle.replace(/[\\%_]/g,'\\$&')).limit(2));
        const target = rows?.length === 1 ? rows[0] : null;
        if (!target || handle(target.handle) !== targetHandle || target.entity_type !== 'creator_evidence' || !target.assessment || !target.status || target.assessment === 'excluded' || target.status === 'excluded') throw new ManualNoteError(404, 'TARGET_UNAVAILABLE', '일치하는 기존 크리에이터를 확인할 수 없습니다.');
        return json({target:{creatorId:target.id,handle:targetHandle,displayName:target.nickname || targetHandle,profileUrl:target.profile_url || ''}});
      }
      if (path.endsWith('/list')) {
        keys(body, ['creatorId','noteId','before']);
        if ((body.creatorId !== undefined && !validUuid(body.creatorId)) || (body.noteId !== undefined && !validUuid(body.noteId))) throw invalid();
        if (body.noteId !== undefined && body.before !== undefined) throw invalid();
        let before: any = null;
        if (body.before !== undefined) { keys(body.before, ['recordedAt','id']); if (!validUuid(body.before.id) || typeof body.before.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|\+00:00)$/.test(body.before.recordedAt) || !Number.isFinite(Date.parse(body.before.recordedAt))) throw invalid(); before = body.before; }
        let request = sb.from('sanji_creator_manual_notes').select('note_id,creator_id,handle,payload,recorded_at,supersedes_id').eq('owner',owner);
        if (body.creatorId !== undefined) request=request.eq('creator_id',body.creatorId);
        if (body.noteId !== undefined) request=request.eq('note_id',body.noteId);
        if (before) request=request.or('recorded_at.lt.'+before.recordedAt+',and(recorded_at.eq.'+before.recordedAt+',note_id.lt.'+before.id+')');
        const rows = await query(request.order('recorded_at',{ascending:false}).order('note_id',{ascending:false}).limit(21));
        if (!Array.isArray(rows)) throw new ManualNoteError(503,'NOTE_READ_FAILED','수동 메모를 불러오지 못했습니다.');
        const items=rows.slice(0,20).map(publicManualNote), last=items[items.length-1];
        return json({items,nextBefore:rows.length>20?{recordedAt:last.recordedAt,id:last.id}:null,complete:rows.length<=20});
      }
      const value = validateManualNote(body, now());
      const result = await sb.rpc('sanji_creator_manual_note_save',{p_owner:owner,p_creator:value.creatorId,p_handle:value.handle,p_note:value.noteId,p_payload:value.payload,p_supersedes:value.supersedesId});
      if (result.error) {
        if (['22023','23503','23505','40001','P0001'].includes(result.error.code)) throw new ManualNoteError(409,'NOTE_CONFLICT','대상이나 같은 메모의 저장 내용이 달라졌습니다. 기존 메모를 다시 확인하세요.');
        if (result.error.code === '42501') throw new ManualNoteError(403,'MEMBERSHIP_REQUIRED','접근 권한을 다시 확인하세요.');
        throw new ManualNoteError(503,'NOTE_SAVE_UNCERTAIN','저장 결과를 확인하지 못했습니다. 같은 메모를 다시 저장하기 전에 목록에서 확인하세요.');
      }
      const saved = result.data;
      if (!saved || !object(saved.note) || typeof saved.duplicate !== 'boolean') throw new ManualNoteError(503,'NOTE_SAVE_UNCERTAIN','저장 결과를 다시 확인하세요.');
      if (saved.note.id !== value.noteId || saved.note.creatorId !== value.creatorId || saved.note.handle !== value.handle || (saved.note.supersedesId || null) !== value.supersedesId) throw new ManualNoteError(503,'NOTE_SAVE_UNCERTAIN','저장 대상과 결과를 다시 확인하세요.');
      const note = publicManualNote({note_id:saved.note.id,creator_id:saved.note.creatorId,handle:saved.note.handle,recorded_at:saved.note.recordedAt,supersedes_id:saved.note.supersedesId,payload:saved.note.payload});
      if (Object.entries(value.payload).some(([key,value]) => note[key] !== value)) throw new ManualNoteError(503,'NOTE_SAVE_UNCERTAIN','저장 내용과 결과를 다시 확인하세요.');
      return json({note,duplicate:saved.duplicate});
    } catch (e) {
      if (e instanceof ManualNoteError) return json({error:e.message,code:e.code},e.status);
      return json({error:'수동 메모 요청 결과를 확인하지 못했습니다. 입력을 보존한 뒤 목록을 다시 확인하세요.',code:'NOTE_REQUEST_UNCERTAIN'},503);
    }
  };
}
