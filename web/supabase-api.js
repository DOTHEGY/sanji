import { functionUrlForPath } from "./edge-routing.mjs";
import { loadStableStateRecords } from "./state-records.mjs";
import { probeEdge, classifyEdgeResponse } from "./edge-diagnostics.js";
import { createClient } from "@supabase/supabase-js";
import {
  supabaseUrl,
  supabaseKey,
  edgeFunctionUrl,
  instagramInboxFunctionUrl,
  instagramManualInboxFunctionUrl,
  dotSnapshotFunctionUrl,
  creatorManualNotesFunctionUrl,
} from "./supabase-config.js";
export const client = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
const unpack = (value) => {
  const r = Array.isArray(value) ? value[0] : value;
  if (!r) throw new Error("저장 결과가 없습니다.");
  return {
    ...(r.data || {}),
    id: r.id,
    version: r.version,
    updated: r.updated,
  };
};
function error(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}
async function result(p) {
  const { data, error: e } = await p;
  if (e) {
    let message = e.message;
    if (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01")
      message =
        "Supabase DB 초기 설정이 아직 필요합니다. 관리자 SQL 파일을 적용해 주세요.";
    if (e.code === "23505")
      message = "같은 회사·이메일·계정이 이미 등록되어 있습니다.";
    throw error(message, e.code === "42501" ? 403 : 400);
  }
  return data;
}
async function member() {
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) throw error("로그인이 필요합니다.", 401);
  const rows = await result(
    client
      .from("sanji_members")
      .select("user_id")
      .eq("user_id", session.user.id),
  );
  if (!rows.length)
    throw error(
      "로그인은 됐지만 관리자 접근 권한이 없습니다. 프로젝트 관리자가 관리자 등록 SQL을 적용해야 합니다.",
      403,
    );
  return session;
}
async function edge(path, method, body, expectedOwner, stillActive) {
  if (path === "/creator-manual-notes/context" && (typeof expectedOwner !== "string" || !expectedOwner || typeof stillActive !== "function" || !stillActive())) throw error("계정과 대상을 확인하세요.", 403);
  const session = await member();
  if (expectedOwner !== undefined && path === "/creator-instagram/transient-inbox" && session.user.id !== expectedOwner) { const e=error("계정이 변경됐습니다. 다시 확인하세요.",403); e.code="TRANSIENT_OWNER_CHANGED"; throw e; }
  if (expectedOwner !== undefined && path !== "/creator-instagram/transient-inbox") {
    const latest = await client.auth.getSession();
    const current = latest?.data?.session;
    if (session.user.id !== expectedOwner || current?.user?.id !== expectedOwner || typeof stillActive !== "function" || !stillActive()) { const e = error("계정이 변경됐습니다. 다시 확인하세요.", 403); e.code = "MANUAL_OWNER_CHANGED"; throw e; }
    if (latest?.error || typeof session.access_token !== "string" || !session.access_token || current?.access_token !== session.access_token) { const e = error("로그인 상태가 갱신되어 요청하지 않았습니다. 입력을 보존하고 다시 확인하세요.", 409); e.code = "MANUAL_SESSION_REFRESHED"; throw e; }
  }
  const functionUrl = functionUrlForPath(path, { edgeFunctionUrl, instagramInboxFunctionUrl, instagramManualInboxFunctionUrl, dotSnapshotFunctionUrl, creatorManualNotesFunctionUrl });
  let response;
  try {
    response = await fetch(functionUrl + path, {
      ...(expectedOwner !== undefined ? { cache: "no-store" } : {}),
      method,
      headers: {
        apikey: supabaseKey,
        Authorization: "Bearer " + session.access_token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    if (functionUrl === dotSnapshotFunctionUrl) throw error("원장 서버에 연결할 수 없습니다.", 503);

    const diagnosis = await probeEdge(functionUrl);
    throw error(
      diagnosis.kind === "ready"
        ? "서버 상태 확인은 정상이나 인증 요청의 CORS 연결이 실패했습니다. APP_ORIGIN과 함수 로그를 확인하세요."
        : diagnosis.message,
      diagnosis.status || 503,
    );
  }
  const data = await response
    .json()
    .catch(() => ({ error: "서버 응답을 읽지 못했습니다." }));
  if (path === "/creator-manual-notes/context" || (path === "/creator-instagram/creator-context" && expectedOwner !== undefined)) {
    const latest = await client.auth.getSession(), current = latest?.data?.session;
    if (latest?.error || current?.user?.id !== expectedOwner || current?.access_token !== session.access_token || typeof stillActive !== "function" || !stillActive()) throw error("계정 또는 화면이 변경됐습니다. 다시 확인하세요.", 403);
  }
  if (!response.ok) {
    if (data.code === "NOT_FOUND" || data.code === "BOOT_ERROR")
      throw error(
        classifyEdgeResponse(response.status, data, functionUrl).message,
        response.status,
      );
    const e = error(
      data.error || data.message || "외부 연동 기능 준비가 필요합니다.",
      response.status,
    );
    e.searchUrl = data.searchUrl;
    if (response.status === 429 && path === "/creator-instagram/manual-sync" && data.retryCursor === null && typeof data.restartRequired === "boolean") { e.retryCursor=null; e.restartRequired=data.restartRequired; if(Number.isSafeInteger(data.retryAfterSeconds)&&data.retryAfterSeconds>=0&&data.retryAfterSeconds<=86400)e.retryAfterSeconds=data.retryAfterSeconds; }
    throw e;
  }
  return data;
}
const MANUAL_OWNER_PATHS = new Set(["/creator-instagram/manual-inbox", "/creator-instagram/manual-thread", "/creator-instagram/manual-sync", "/creator-instagram/manual-draft", "/creator-instagram/manual-reviewed-draft", "/creator-instagram/manual-review-audit", "/creator-instagram/manual-reverify"]);
export async function manualWorkspaceApi(path, body, expectedOwner, stillActive) {
  if (!MANUAL_OWNER_PATHS.has(path) || typeof expectedOwner !== "string" || !expectedOwner) throw error("계정과 대상을 확인하세요.", 403);
  return edge(path, "POST", body, expectedOwner, stillActive);
}
const MANUAL_NOTES_PATHS = new Set(["/creator-manual-notes/list", "/creator-manual-notes/save", "/creator-manual-notes/targets", "/creator-manual-notes/context"]);
export async function manualNotesApi(path, body, expectedOwner, stillActive) {
  if (!MANUAL_NOTES_PATHS.has(path) || typeof expectedOwner !== "string" || !expectedOwner || typeof stillActive !== "function") throw error("계정과 대상을 확인하세요.", 403);
  let input = body;
  if (path === "/creator-manual-notes/context") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(k => !["noteId","creatorId","handle"].includes(k)) || ![body.noteId,body.creatorId].every(v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) || typeof body.handle !== "string" || !/^[a-z0-9._]{1,30}$/.test(body.handle) || [".",".."].includes(body.handle)) throw error("저장된 메모와 대상을 확인하세요.", 400);
    input = Object.freeze({noteId:body.noteId,creatorId:body.creatorId,handle:body.handle});
  }
  let contextToken;
  if (path === "/creator-manual-notes/context") {
    const initial = await client.auth.getSession();
    if (initial?.error || initial?.data?.session?.user?.id !== expectedOwner || typeof initial.data.session.access_token !== "string" || !initial.data.session.access_token || !stillActive()) throw error("계정 또는 화면이 변경됐습니다.", 403);
    contextToken = initial.data.session.access_token;
  }
  const value = await edge(path, "POST", input, expectedOwner, stillActive);
  const latest = await client.auth.getSession();
  if (latest.error || latest.data?.session?.user?.id !== expectedOwner || (contextToken !== undefined && latest.data?.session?.access_token !== contextToken) || !stillActive()) throw error("계정 또는 화면이 변경됐습니다.", 403);
  if (path === "/creator-manual-notes/context" && (value?.matched !== true || value.noteId !== input.noteId || value.creator?.id !== input.creatorId || value.creator?.handle !== input.handle)) throw error("저장된 메모와 조회 결과가 일치하지 않습니다.", 409);
  return value;
}
export async function creatorProposalContextApi(body, expectedOwner, stillActive) {
  if (typeof expectedOwner !== "string" || !expectedOwner || typeof stillActive !== "function" || !stillActive()) throw error("계정과 대상을 확인하세요.", 403);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || Object.keys(body)[0] !== "peerId" || typeof body.peerId !== "string" || !/^\d{1,100}$/.test(body.peerId)) throw error("상대 계정을 확인하세요.", 400);
  const input = Object.freeze({peerId:body.peerId}), initial = await client.auth.getSession();
  if (initial?.error || initial?.data?.session?.user?.id !== expectedOwner || typeof initial.data.session.access_token !== "string" || !initial.data.session.access_token || !stillActive()) throw error("계정 또는 화면이 변경됐습니다.", 403);
  const token = initial.data.session.access_token;
  const value = await edge("/creator-instagram/creator-context", "POST", input, expectedOwner, stillActive);
  const latest = await client.auth.getSession();
  if (latest?.error || latest?.data?.session?.user?.id !== expectedOwner || latest?.data?.session?.access_token !== token || !stillActive()) throw error("계정 또는 화면이 변경됐습니다.", 403);
  if (value?.matched !== true || typeof value.peerUsername !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(value.peerUsername) || [".",".."].includes(value.peerUsername) || typeof value.creator?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.creator.id) || typeof value.creator.handle !== "string" || value.creator.handle !== value.peerUsername.toLowerCase()) throw error("상대 계정과 크리에이터 조회 결과가 일치하지 않습니다.", 409);
  return value;
}
export async function transientInboxApi(body, expectedOwner) {
  if (typeof expectedOwner !== "string" || !expectedOwner) throw error("계정을 확인하세요.", 403);
  return edge("/creator-instagram/transient-inbox", "POST", body, expectedOwner);
}
export async function workspaceApi(path, method = "GET", body) {
  if (path === "/status") return { setupRequired: false, supabase: true };
  if (path === "/auth/login") {
    const { data, error: e } = await client.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (e) throw error(e.message, 401);
    return { email: data.user.email, csrf: "" };
  }
  if (path === "/auth/signup") {
    const { data, error: e } = await client.auth.signUp({
      email: body.email,
      password: body.password,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (e) throw error(e.message);
    return { session: !!data.session };
  }
  if (path === "/auth/logout") {
    await client.auth.signOut();
    return { ok: true };
  }
  if (path === "/me") {
    const s = await member();
    return { id:s.user.id, email: s.user.email, csrf: "" };
  }
  if (path === "/connections") {
    await member();
    const summaries = await result(client.rpc("sanji_connection_status"));
    return {
      gmail: {
        configured: false,
        connected: !!summaries.gmail,
        email: summaries.gmail?.email || "",
        enabled: false,
        ...summaries.gmail,
      },
      instagram: {
        configured: false,
        connected: !!summaries.instagram,
        enabled: false,
        ...summaries.instagram,
      },
      search: { configured: false },
      ai: { configured: false },
      automation: { configured: false },
    };
  }
  const session = await member();
  if (path === "/state") {
    const ownerId = session.user.id;
    const [rows, outbox, suppression] = await Promise.all([
      loadStableStateRecords({owner:ownerId,fetchPage:async({owner,cursor,summary,pageSize})=>{
        let q=client.from("sanji_records").select(summary?"id,owner,version,updated":"*").eq("owner",owner).order("id",{ascending:true}).limit(pageSize);
        if(cursor)q=q.gt("id",cursor);
        return await result(q);
      }}),
      result(
        client
          .from("sanji_outbox")
          .select("id,target,channel,status,data,created")
          .order("created", { ascending: false })
          .limit(500),
      ),
      result(client.from("sanji_suppression").select("identity,reason")),
    ]);
    const jobsResult = await client
      .from("sanji_jobs")
      .select("id,draft_id,status,run_at,attempts,result,approved_at")
      .order("run_at", { ascending: false })
      .limit(200);
    if (
      jobsResult.error &&
      !["PGRST205", "42P01"].includes(jobsResult.error.code)
    )
      throw error("예약 목록 조회에 실패했습니다.");
    const scheduleStatus=await edge("/schedule-status","GET");
    const records = rows.map((r) => ({ ...unpack(r), _kind: r.kind }));
    return {
      candidates: records.filter((r) => r._kind === "candidate"),
      deals: records.filter((r) => r._kind === "deal"),
      catalog: {complete:true,expectedCount:records.filter((r) => r._kind === "deal").length,observedAt:new Date().toISOString(),source:"owner-scoped stable state scan",scope:"owner_saved_deals",ownerId},
      templates: records.filter((r) => r._kind === "template"),
      threads: records.filter((r) => r._kind === "thread"),
      outbox,
      jobs: scheduleStatus.jobs || jobsResult.data || [],
      suppression,
      settings: records.find((r) => r._kind === "settings") || {
        senderName: "",
        senderAddress: "",
        senderPhone: "",
      },
    };
  }
  const match = path.match(/^\/(candidate|deal|template)(?:\/([a-f0-9-]+))?$/);
  if (match && ["POST", "PUT"].includes(method)) {
    return unpack(
      await result(
        client.rpc("sanji_save_record", {
          p_kind: match[1],
          p_data: body,
          p_id: match[2] || null,
          p_version: body.version || null,
        }),
      ),
    );
  }
  if (path === "/settings" && method === "PUT") {
    const rows = await result(
      client.from("sanji_records").select("id,version").eq("kind", "settings"),
    );
    return unpack(
      await result(
        client.rpc("sanji_save_record", {
          p_kind: "settings",
          p_data: body,
          p_id: rows[0]?.id || null,
          p_version: body.version ?? rows[0]?.version ?? null,
        }),
      ),
    );
  }
  if (path === "/creator-conversation-status" && method === "GET") return {items:await result(client.rpc("sanji_creator_conversation_list"))};
  if (path === "/creator-conversation-status" && method === "PUT") return await result(client.rpc("sanji_creator_conversation_save",{p_creator:body.creatorId,p_thread:body.threadId,p_version:body.version,p_status:body.status,p_note:body.note}));
  if (path.startsWith("/thread/") && method === "PUT")
    return unpack(
      await result(
        client.rpc("sanji_manage_thread", {
          p_id: path.split("/")[2],
          p_version: body.version,
          p_data: body,
        }),
      ),
    );
  if (path.startsWith("/jobs/") && method === "DELETE") {
    await result(client.rpc("sanji_cancel_job", { p_id: path.split("/")[2] }));
    return { ok: true };
  }
  if (path === "/matching") {
    const rows = await result(
        client
          .from("sanji_records")
          .select("*")
          .in("kind", ["candidate", "deal"]),
      ),
      cs = rows
        .filter((r) => r.kind === "candidate" && r.data.kind === "크리에이터")
        .map(unpack),
      ds = rows.filter((r) => r.kind === "deal").map(unpack),
      pairs = [];
    for (const c of cs)
      for (const d of ds) {
        const common = c.topics.filter((t) => d.topics.includes(t));
        pairs.push({
          creator: c.id,
          deal: d.id,
          priority: common.length,
          reason: common.length
            ? "공개 주제 일치: " + common.join(" · ")
            : "주제 일치 근거 없음",
          uncertainty: [
            c.evidence.length
              ? "확인한 콘텐츠 링크를 직접 검토하세요."
              : "콘텐츠 출처 없음",
            "가격대 적합성·실판매 미확인",
            "공동구매 경험: " + c.experience,
            "일정: " + c.schedule + " / " + d.schedule,
            "거래 조건: " + d.state + " v" + d.version,
          ],
        });
      }
    return pairs.sort((a, b) => b.priority - a.priority);
  }
  if (path === "/audit")
    return await result(
      client
        .from("sanji_audit")
        .select("action,data,created")
        .order("created", { ascending: false })
        .limit(200),
    );
  if (path.startsWith("/search?")) {
    try {
      return await edge(path, method, body);
    } catch (e) {
      e.searchUrl =
        "https://www.google.com/search?q=" +
        encodeURIComponent(new URLSearchParams(path.split("?")[1]).get("q"));
      throw e;
    }
  }
  return edge(path, method, body);
}
export async function integrationStatus() {
  try {
    return await edge("/connections", "GET");
  } catch {
    return null;
  }
}
