import { probeEdge, classifyEdgeResponse } from "./edge-diagnostics.js";
import { createClient } from "@supabase/supabase-js";
import {
  supabaseUrl,
  supabaseKey,
  edgeFunctionUrl,
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
async function edge(path, method, body) {
  const session = await member();
  let response;
  try {
    response = await fetch(edgeFunctionUrl + path, {
      method,
      headers: {
        apikey: supabaseKey,
        Authorization: "Bearer " + session.access_token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    const diagnosis = await probeEdge(edgeFunctionUrl);
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
  if (!response.ok) {
    if (data.code === "NOT_FOUND" || data.code === "BOOT_ERROR")
      throw error(
        classifyEdgeResponse(response.status, data, edgeFunctionUrl).message,
        response.status,
      );
    const e = error(
      data.error || data.message || "외부 연동 기능 준비가 필요합니다.",
      response.status,
    );
    e.searchUrl = data.searchUrl;
    throw e;
  }
  return data;
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
  await member();
  if (path === "/state") {
    const [rows, outbox, suppression] = await Promise.all([
      result(
        client
          .from("sanji_records")
          .select("*")
          .order("updated", { ascending: false }),
      ),
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
