"use strict";
function assemblePersonalization(body, intro) {
  const copy = String(body || ""), personal = String(intro || "").trim();
  if (copy.includes("{{개인화}}")) {
    if (!personal) throw Error("개인화 위치에 넣을 1~2문장을 생성하거나 직접 입력하세요.");
    return copy.replaceAll("{{개인화}}", personal);
  }
  return (personal ? personal + "\n\n" : "") + copy;
}
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  tag = (t, c = "") => `<span class="tag ${c}">${esc(t)}</span>`,
  money = (n) => (n == null ? "미협의" : Number(n).toLocaleString() + "원");
const oauthNoticeUrl = new URL(location.href);
const oauthNoticeIsError = oauthNoticeUrl.searchParams.has("oauth_error");
const oauthNotice = (oauthNoticeUrl.searchParams.get("oauth_error") || oauthNoticeUrl.searchParams.get("oauth_notice") || "").slice(0, 700);
if (oauthNotice) {
  oauthNoticeUrl.searchParams.delete("oauth_error");
  oauthNoticeUrl.searchParams.delete("oauth_notice");
  history.replaceState(null, "", oauthNoticeUrl.toString());
}
let csrf = "",
  me = null,
  data = {
    candidates: [],
    deals: [],
    templates: [],
    threads: [],
    outbox: [],
    settings: {},
  },
  connections = {},
  preview = null,
  selectedThread = "",
  toastTimer;
const routes = {
  dashboard: ["◫", "대시보드"],
  brands: ["▣", "브랜드 발굴"],
  deals: ["▤", "상품 딜"],
  creators: ["◎", "크리에이터 발굴"],
  matching: ["⇄", "상품 매칭"],
  templates: ["▧", "템플릿"],
  inbox: ["✉", "통합 대화함"],
  settings: ["⚙", "연동 설정"],
};
const statuses = [
  "미접촉",
  "검토 중",
  "발송",
  "회신",
  "협상",
  "딜 확보",
  "보류",
  "거절",
  "수신 거부",
  "수락",
  "공동구매 확정",
];
const button = (label, action, id = "", primary = false) =>
  `<button data-action="${action}" data-id="${esc(id)}" class="${primary ? "primary" : ""}">${label}</button>`;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 5000);
}
async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await res
    .json()
    .catch(() => ({ error: "응답을 읽을 수 없습니다." }));
  if (!res.ok) {
    const e = new Error(
      result.error +
        (result.details
          ? "\n" +
            result.details.map((i) => i.field + ": " + i.message).join("\n")
          : ""),
    );
    e.status = res.status;
    e.searchUrl = result.searchUrl;
    throw e;
  }
  return result;
}
function field(name, label, value = "", type = "text", options) {
  const help = label.includes("|") ? label.split("|")[1] : "";
  label = label.split("|")[0];
  return `<label class="field">${esc(label)}${help ? `<small class="help">${esc(help)}</small>` : ""}${options ? `<select name="${name}">${options.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : type === "textarea" ? `<textarea name="${name}">${esc(value)}</textarea>` : type === "checkbox" ? `<span><input name="${name}" type="checkbox" ${value ? "checked" : ""}> 확인</span>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="any"' : ""}>`}</label>`;
}
function modal(html) {
  $("#modal-content").innerHTML =
    html + '<div id="form-error" role="alert"></div>';
  $("#modal").showModal();
}
function close() {
  $("#modal").close();
  preview = null;
}
function err(e) {
  const el = $("#form-error");
  if (el && $("#modal").open) {
    el.className = "error";
    el.textContent = e.message;
  } else toast(e.message);
}
const candidate = (id) => data.candidates.find((c) => c.id === id),
  deal = (id) => data.deals.find((d) => d.id === id),
  targetName = (id) => candidate(id)?.name || "계정 매핑 필요";
function head(title, sub, buttons = "") {
  return `<div class="heading"><div><div class="eyebrow">SANJI PARTNER WORKSPACE</div><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div><div class="actions">${buttons}</div></div>`;
}
async function reload() {
  [data, connections] = await Promise.all([api("/state"), api("/connections")]);
  $("#connection-banner").innerHTML =
    `<b>운영 데이터 · 서버 저장</b> Gmail ${connections.gmail.connected ? "연결됨" : "미연결"} · 실제 메일 ${connections.gmail.enabled ? "사용자 승인 후 발송" : "발송 비활성"} · Instagram 신규 DM은 수동 발송`;
  render();
}
async function boot() {
  try {
    me = await api("/me");
    csrf = me.csrf;
    $("#user").textContent = me.email;
    await reload();
  } catch (e) {
    if (e.status !== 401) {
      toast(e.message);
      return;
    }
    await authPage();
  }
}
async function authPage() {
  me = null;
  csrf = "";
  $("#nav").innerHTML = "";
  $("#user").textContent = "관리자 로그인";
  const status = await api("/status");
  $("#app").innerHTML =
    `<div class="panel auth"><div class="eyebrow">PRIVATE WORKSPACE</div><h1>${status.setupRequired ? "관리자 계정 만들기" : "다시 만나 반갑습니다"}</h1><p class="login-note">실제 회사·크리에이터·대화 자료는 로그인 후에만 조회됩니다. 가상 데이터는 포함하지 않습니다.</p><form id="auth-form" data-type="${status.setupRequired ? "setup" : "login"}">${status.setupRequired ? field("token", "서버 초기 설정 토큰|서버 환경 변수 SANJI_SETUP_TOKEN 값입니다. 메일·Instagram 비밀번호가 아닙니다.", "", "password") : ""}${field("email", "관리자 이메일", "", "email")}${field("password", "서비스 로그인 비밀번호|초기 생성 시 12자 이상. 외부 이메일 계정 비밀번호를 입력하지 마세요.", "", "password")}<button class="primary" type="submit">${status.setupRequired ? "관리자 계정 생성" : "로그인"}</button><div id="auth-error" class="login-note"></div></form></div>`;
}
function render() {
  if (!me) return;
  const rawKey = location.hash.slice(1) || "dashboard";
  const key = rawKey === "discovery" ? "brands" : rawKey;
  $("#nav").innerHTML = Object.entries(routes)
    .map(
      ([k, v]) =>
        `<a href="#${k}" class="${key === k ? "active" : ""}"><span>${v[0]}</span>${v[1]}</a>`,
    )
    .join("");
  $("#breadcrumb").textContent =
    "워크스페이스 / " + (routes[key]?.[1] || "대시보드");
  (pages[key] || dashboard)();
}
function dashboard() {
  const sent = data.outbox.filter((o) => o.status === "accepted"),
    sentTargets = new Set(sent.map((o) => o.target)),
    human = data.threads.filter(
      (t) =>
        t.messages.some((m) => !m.out && !m.automatic) &&
        sentTargets.has(t.target),
    ),
    humanTargets = new Set(human.map((t) => t.target)),
    positive = new Set(
      human
        .filter((t) =>
          ["관심 회신", "수락", "공동구매 확정"].includes(t.classification),
        )
        .map((t) => t.target),
    );
  const rate = (n) =>
    sentTargets.size ? Math.round((n / sentTargets.size) * 100) + "%" : "—";
  $("#app").innerHTML =
    head(
      "브랜드 이메일 영업",
      "가상 수치 없이, 서버에 기록된 실제 업무 현황입니다.",
      button("＋ 브랜드 추가", "add-brand", "", true),
    ) +
    `${!data.settings.senderAddress ? '<p class="notice">브랜드 메일 발송 전 <a href="#settings">연동 설정 → 발신자 정보</a>에 실제 사업장 주소를 입력하세요. 메일은 수신자·내용 최종 승인 후 발송합니다.</p>' : ""}<p class="fine"><a href="#discovery">회사 이메일 발굴 →</a> · <a href="#templates">브랜드 제안 템플릿 →</a> · <a href="#inbox">답장 확인·회신 →</a></p><div class="stats"><div class="stat"><label>발굴 후보</label><strong>${data.candidates.length}</strong><small>검증된 사업용 연락처 ${data.candidates.filter((c) => c.contact.verified).length}</small></div><div class="stat"><label>이메일·API 접수</label><strong>${sent.length}</strong><small>받은편지함 도착·열람은 미확인</small></div><div class="stat"><label>사람의 회신율</label><strong>${rate(humanTargets.size)}</strong><small>회신 대상 ${humanTargets.size} / 접수 대상 ${sentTargets.size} · 자동 응답 제외</small></div><div class="stat"><label>확보한 상품 딜</label><strong>${data.deals.filter((d) => d.state === "확정").length}</strong><small>상품 조건이 확정된 카드 수</small></div></div><div class="grid"><div class="panel"><div class="panel-head"><h2>지금 해야 할 일</h2><a href="#inbox">대화함 ↗</a></div>${
      data.candidates
        .filter((c) => c.next)
        .map(
          (c) =>
            `<div class="task"><span class="task-icon">${c.kind === "크리에이터" ? "◎" : "▣"}</span><div><strong>${esc(c.next)}</strong><small>${esc(c.name)} · ${esc(c.owner || "담당자 미지정")} · ${esc(c.due || "일정 미지정")}</small></div>${button("열기", "edit-candidate", c.id)}</div>`,
        )
        .join("") ||
      '<div class="empty">후보에 다음 행동을 기록하면 여기에 표시됩니다.</div>'
    }</div><div class="panel"><h2>성과와 집계 기준</h2><div class="task">긍정 회신율 <strong style="margin-left:auto">${rate(positive.size)}</strong></div><div class="task">협상 전환율 <strong style="margin-left:auto">${humanTargets.size ? Math.round((data.candidates.filter((c) => c.status === "협상" && humanTargets.has(c.id)).length / humanTargets.size) * 100) + "%" : "—"}</strong></div><div class="task">크리에이터 수락 <strong style="margin-left:auto">${data.candidates.filter((c) => c.kind === "크리에이터" && ["수락", "공동구매 확정"].includes(c.status)).length}</strong></div><div class="task">공동구매 확정 <strong style="margin-left:auto">${data.threads.filter((t) => t.classification === "공동구매 확정").length}</strong></div><p class="fine">전체 기록 기간 · 긍정/접수 대상 · 협상/사람 회신 대상 · 수동 DM 접수/열람 미집계 · 매출 수집 없음</p></div></div><div class="panel"><h2>발송·오류 현황</h2>${outboxTable()}</div>`;
}
function outboxTable() {
  return `<div class="table-scroll"><table><thead><tr><th>대상</th><th>채널</th><th>상태</th><th>일시</th></tr></thead><tbody>${data.outbox.map((o) => `<tr><td>${esc(targetName(o.target))}</td><td>${esc(o.channel)}</td><td>${tag(o.status, o.status === "accepted" ? "" : "orange")}<small>${esc(o.data.error || "")}</small></td><td>${esc(new Date(o.created).toLocaleString("ko-KR"))}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">실제 발송·수동 기록이 없습니다.</td></tr>'}</tbody></table></div>`;
}
function candidatesPage(type, embedded = false) {
  const creator = type === "creator";
  const destination = embedded ? $("#brand-saved") : $("#app");
  destination.innerHTML =
    (embedded ? "" : head(
      creator ? "크리에이터 발굴" : "브랜드·유통사 발굴",
      "공식 출처를 기록하고, 연락처 소유 관계를 확인한 뒤 영업 후보로 관리하세요.",
      button("＋ 직접 추가", creator ? "add-creator" : "add-brand", "", true),
    )) +
    `<details class="panel"><summary>직접 검색·추가 (보조 기능)</summary>${button("＋ 직접 추가", creator ? "add-creator" : "add-brand")}<h2>웹에서 실제 후보 찾기</h2><form id="search-form" data-type="${type}" class="toolbar"><input class="search" name="q" required minlength="2" placeholder="${creator ? "예: 식물성 레시피 공동구매 인스타그램" : "예: 건강기능식품 브랜드 공식 도매 문의"}" aria-label="실제 후보 웹 검색"><button type="submit">검색</button><a href="https://www.google.com/search?q=${encodeURIComponent(creator ? "site:instagram.com 건강식품 공동구매" : "건강기능식품 공식 브랜드 제휴 문의")}" target="_blank" rel="noopener">직접 검색 ↗</a></form><div id="search-results" class="fine">${connections.search.configured ? "검색 API 연결됨. 결과는 검증 전 자료로 표시됩니다." : "API 가입 없이 공개 웹 검색을 열 수 있습니다. 확인한 URL·이메일은 후보에 기록하세요."}</div></details><div class="toolbar"><input id="candidate-filter" class="search" placeholder="저장한 후보 이름·제품·콘텐츠 주제 검색" aria-label="후보 검색"><select id="status-filter"><option value="">모든 상태</option>${statuses.map((s) => `<option>${s}</option>`).join("")}</select><select id="category-filter"><option value="">모든 분류</option><option>건강기능식품</option><option>일반 건강식품</option><option>미확인</option></select></div><div class="panel" id="candidate-results" data-type="${type}"></div>`;
  filterCandidates();
}
function filterCandidates() {
  const type = $("#candidate-results")?.dataset.type;
  if (!type) return;
  const q = $("#candidate-filter").value,
    s = $("#status-filter").value,
    cat = $("#category-filter").value;
  const rows = data.candidates.filter(
    (c) =>
      (type === "creator"
        ? c.kind === "크리에이터"
        : c.kind !== "크리에이터") &&
      (c.name + c.company + c.product + c.topics.join(" ")).includes(q) &&
      (!s || c.status === s) &&
      (!cat || c.category === cat),
  );
  $("#candidate-results").innerHTML =
    `<div class="table-scroll"><table><thead><tr><th>이름 / 회사</th><th>분류 · 상태</th><th>공식 출처 · 연락처</th><th>다음 행동</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.company || c.handle || "관계 미확인")}</small><small>${esc(c.product || c.topics.join(" · "))}</small></td><td>${tag(c.category)} ${tag(c.status)}<small>${esc(c.classification)}</small></td><td>${c.website || c.profile ? `<a href="${esc(c.website || c.profile)}" target="_blank" rel="noopener">공식 링크 확인 ↗</a>` : "미확인"}<small>${esc(c.contact.email || "이메일 미확인")}</small>${tag(c.contact.verified ? "사용자 검증 기록 있음" : "검증 전", c.contact.verified ? "" : "orange")}</td><td>${esc(c.next || "—")}<small>${esc(c.owner)} · ${esc(c.due)}</small></td><td>${button("상세·수정", "edit-candidate", c.id)} ${button("메일 작성·미리보기", "compose", c.id)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">실제 후보를 추가해 주세요. 가상 데이터는 넣지 않습니다.</td></tr>'}</tbody></table></div>`;
}
function candidateForm(id = "", creator = false) {
  const c = candidate(id) || {
    kind: creator ? "크리에이터" : "브랜드",
    category: "미확인",
    status: "미접촉",
    contact: {},
    topics: [],
    evidence: [],
  };
  const contact = c.contact;
  modal(
    `<h2>${id ? "후보 상세·수정" : "실제 후보 추가"}</h2><p class="notice">실제로 확인한 사실과 공식 URL만 입력하세요. 모르는 분류·권한·수치는 미확인으로 남기세요. 공식 문의 폼은 대체 경로로 기록하며 자동 제출하지 않습니다.</p><form id="candidate-form" data-id="${esc(id)}" class="form-grid">${field("name", "브랜드 / 크리에이터명", c.name)}${field("kind", "관계", c.kind, "text", ["브랜드", "제조사", "공식 유통사", "크리에이터"])}${field("company", "소유 회사 / 소속 법인", c.company)}${field("companyKey", "법인 식별자|사업자번호 또는 동일 회사의 공통 식별자. 미입력 시 회사명으로 중복 확인.", c.companyKey)}${field("product", "제품명", c.product)}${field("category", "제품 분류", c.category, "text", ["건강기능식품", "일반 건강식품", "미확인"])}${field("classification", "법적 분류 확인 근거", c.classification || "미확인", "textarea")}${field("authority", "제조·판매·공식 유통 권한 근거", c.authority || "미확인", "textarea")}${field("website", "공식 홈페이지 / 문의 폼 URL", c.website, "url")}${field("channels", "판매 채널", c.channels)}<h3 class="form-section">공식 사업용 연락처</h3>${field("email", "공개 사업용 이메일|이메일을 추측하지 마세요. 플랫폼 고객센터를 입점 브랜드 연락처로 사용하지 마세요.", contact.email, "email")}${field("contactOwner", "이메일 소유 회사|위 소유 회사와 정확히 일치해야 검증 표시 가능", contact.owner)}${field("contactSource", "공식 연락처 출처 URL", contact.source, "url")}${field("contactChecked", "확인일", contact.checked, "date")}${field("contactPurpose", "공식 사용 목적", contact.purpose || "미확인", "text", ["미확인", "사업 제휴", "도매·유통", "비즈니스"])}${field("verified", "소유 회사·공식 출처·사업용 용도를 직접 확인함", contact.verified, "checkbox")}<h3 class="form-section">크리에이터 공개 콘텐츠 / 매칭 근거</h3>${field("handle", "Instagram 아이디", c.handle)}${field("profile", "공개 프로필 URL", c.profile, "url")}${field("agency", "크리에이터·소속사 관계", c.agency)}${field("topics", "공개 콘텐츠 주제|쉼표로 구분. 개인 건강·질병을 추정해 입력하지 마세요.", c.topics.join(", "))}${field("followers", "팔로워 (미확인은 빈칸)", c.followers ?? "", "number")}${field("metricsSource", "수치 출처 URL", c.metricsSource, "url")}${field("metricsChecked", "수치 확인일", c.metricsChecked, "date")}${field("reaction", "실제 공개 반응 / 조회수 근거", c.reaction || "미확인", "textarea")}${field("experience", "확인한 공동구매 경험", c.experience || "미확인", "textarea")}${field("active", "활동 상태", c.active || "미확인")}${field("schedule", "제안 가능 일정", c.schedule || "미확인")}${field("evidence", "확인한 콘텐츠 URL|한 줄에 URL 하나씩. 설명은 선정 이유에 기록.", c.evidence.map((e) => e.url).join("\n"), "textarea")}${field("reason", "선정 이유 / 공개 근거", c.reason, "textarea")}<h3 class="form-section">영업 관리</h3>${field("status", "상태", c.status, "text", statuses)}${field("owner", "담당자", c.owner)}${field("next", "다음 행동", c.next)}${field("due", "후속 연락일", c.due, "date")}${field("note", "내부 메모", c.note, "textarea")}<div class="full actions"><button class="primary" type="submit">서버에 저장</button>${id ? button("제안 작성", "compose", id) : ""}</div></form>`,
  );
}
function dealsPage() {
  $("#app").innerHTML =
    head(
      "확보한 상품 딜",
      "상품 가격·조건·자료와 이전 제안 버전을 기록합니다.",
      button("＋ 딜 추가", "add-deal", "", true),
    ) +
    `<div class="cards">${data.deals.map((d) => `<article class="panel">${tag(d.category)} ${tag(d.state, d.state === "확정" ? "" : "orange")}<h3>${esc(d.name)}</h3><p class="sub">${esc(targetName(d.brand))}</p><div class="price">${money(d.price)} <small>공동구매가</small></div><p class="fine">${esc(d.schedule)}<br>v${d.version} · ${esc(d.checked || "확인일 미입력")}<br>${esc(d.sourceNote || "조건 출처 미입력")}</p><div class="card-footer">${button("조건·버전 상세", "edit-deal", d.id)}<a href="#matching">매칭 ↗</a></div></article>`).join("") || '<div class="panel empty">실제 협의한 상품을 추가하세요. 미협의 가격은 빈칸으로 남깁니다.</div>'}</div>`;
}
function dealForm(id = "") {
  const d = deal(id) || {
    state: "협의 중",
    category: "미확인",
    topics: [],
    history: [],
  };
  modal(
    `<h2>${id ? "상품 조건·버전" : "딜 카드 추가"}</h2><div class="notice">이전 버전은 서버에 보존됩니다. 확정 상태도 직접 협의한 조건만 선택하세요.</div><form id="deal-form" data-id="${esc(id)}" class="form-grid">${field("name", "제품명", d.name)}<label class="field">브랜드·공급사<select name="brand">${data.candidates
      .filter((c) => c.kind !== "크리에이터")
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === d.brand ? "selected" : ""}>${esc(c.name)} / ${esc(c.company)}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("category", "법적 분류", d.category, "text", ["미확인", "건강기능식품", "일반 건강식품"])}${field("state", "협의 상태", d.state, "text", ["협의 중", "확정"])}${field("productUrl", "공식 제품 링크", d.productUrl, "url")}${field("image", "사용 허가된 이미지 URL", d.image, "url")}${[
      ["retail", "정상 판매가"],
      ["price", "공동구매가"],
      ["supply", "공급가"],
      ["moq", "최소 수량"],
      ["stock", "공급 가능 수량"],
    ]
      .map(([k, l]) => field(k, l + " (미협의는 빈칸)", d[k] ?? "", "number"))
      .join("")}${[
      ["commission", "수수료"],
      ["settlement", "정산 조건"],
      ["shipping", "배송비·출고 방식"],
      ["returns", "반품 조건"],
      ["expiry", "소비기한·로트 정보"],
      ["schedule", "가능 일정"],
      ["target", "타깃 고객"],
      ["claims", "확인된 소구점"],
      ["assets", "사용 가능한 자료·허가 범위"],
    ]
      .map(([k, l]) => field(k, l, d[k] || "미협의", "textarea"))
      .join(
        "",
      )}${field("topics", "매칭 주제 (쉼표 구분)", d.topics.join(", "))}${field("source", "조건 출처 URL (이메일이면 메모에 기록)", d.source, "url")}${field("sourceNote", "조건 출처·담당자·협의 메모", d.sourceNote, "textarea")}${field("checked", "확인일", d.checked, "date")}<div class="full"><button class="primary" type="submit">${id ? "새 조건 버전 저장" : "딜 저장"}</button></div></form><h3>이전 버전</h3>${d.history.map((v) => `<div class="notice">v${v.version} · ${money(v.price)} · ${esc(v.state)} · ${esc(v.schedule)}<br>${esc(v.sourceNote)} / ${esc(v.checked)}</div>`).join("") || '<p class="fine">이전 버전 없음</p>'}`,
  );
}
async function matchingPage() {
  $("#app").innerHTML =
    head(
      "상품과 크리에이터 매칭",
      "주제·콘텐츠 근거와 불확실성을 함께 확인하세요. 판매 성과를 추정하지 않습니다.",
    ) +
    `<div class="panel"><div class="toolbar"><select id="match-direction"><option value="creator">크리에이터 → 상품</option><option value="deal">상품 → 크리에이터</option></select><select id="match-target"></select></div><div id="match-results"></div></div>`;
  window.matchPairs = await api("/matching");
  updateMatchOptions();
}
function updateMatchOptions() {
  const mode = $("#match-direction").value;
  $("#match-target").innerHTML = (
    mode === "creator"
      ? data.candidates.filter((c) => c.kind === "크리에이터")
      : data.deals
  )
    .map((x) => `<option value="${x.id}">${esc(x.name)}</option>`)
    .join("");
  showMatches();
}
function showMatches() {
  const mode = $("#match-direction").value,
    target = $("#match-target").value,
    pairs = (window.matchPairs || []).filter((p) =>
      mode === "creator" ? p.creator === target : p.deal === target,
    );
  $("#match-results").innerHTML =
    pairs
      .map(
        (p) =>
          `<div class="match-option"><label><input name="match-pair" type="${mode === "creator" ? "checkbox" : "radio"}" value="${mode === "creator" ? p.deal : p.creator}"><strong>${esc(mode === "creator" ? deal(p.deal)?.name : targetName(p.creator))}</strong>${tag(p.priority ? "공개 주제 일치" : "근거 부족", p.priority ? "" : "orange")}</label><p>${esc(p.reason)}<br>${p.uncertainty.map(esc).join("<br>")}</p></div>`,
      )
      .join("") +
    (pairs.length
      ? button("선택한 조합으로 제안 작성", "matched-compose", "", true)
      : '<div class="empty">크리에이터와 상품을 추가하고 공개 주제를 기록하세요.</div>');
}
function templatesPage() {
  $("#app").innerHTML =
    head(
      "직접 작성하는 제안 템플릿",
      "여기에 공통 카피를 저장하세요. AI는 제안 작성 화면에서 앞 1~2줄만 만들고 공통 본문은 그대로 둡니다.",
      button("＋ 템플릿 추가", "add-template", "", true),
    ) +
    `<div class="cards">${data.templates.map((t) => `<article class="panel">${tag(t.channel)}<h3>${esc(t.name)}</h3><p class="sub">${esc(t.subject)}</p><div class="message">${esc(t.body)}</div>${button("편집", "edit-template", t.id)} ${button("사용", "use-template", t.id)}</article>`).join("") || '<div class="panel empty">직접 작성한 메일·DM 카피를 저장하세요.</div>'}</div>`;
}
function templateForm(id = "") {
  const t = data.templates.find((t) => t.id === id) || { channel: "이메일" };
  modal(
    `<h2>템플릿 편집</h2><form id="template-form" data-id="${esc(id)}">${field("name", "템플릿 이름", t.name)}${field("channel", "채널", t.channel, "text", ["이메일", "Instagram DM"])}${field("subject", "제목", t.subject)}<p class="fine">제목은 원문대로 저장합니다. 광고성 이메일 발송에는 (광고) 표시가 필요하며, 미리보기에서 누락을 검사합니다.</p><p class="fine">사용 가능 변수: {{회사명}}, {{브랜드명}}, {{제품명}}, {{크리에이터명}}, {{공동구매가}}, {{일정}}. 본문에 {{개인화}}를 넣으면 그 위치에 개인화 1~2문장이 들어갑니다. 없으면 본문 앞에 붙습니다.</p>${field("body", "공통 본문 카피 · AI 수정 없음", t.body, "textarea")}${field("aiEnabled", "수신자별 AI 도입부 1~2줄 제안 사용", t.aiEnabled ?? true, "checkbox")}${field("personalizationGuide", "개인화 작성 지침 · AI에는 이 지침과 공개 근거만 전달", t.personalizationGuide || "", "textarea")}${field("signature", "서명", t.signature, "textarea")}<button class="primary" type="submit">템플릿 저장</button></form>`,
  );
}
function compose(target = "", ds = [], templateId = "", replyTo = "") {
  close();
  if (!templateId && !replyTo) templateId = data.templates.find(t => t.channel === "이메일")?.id || "";
  const t = data.templates.find((t) => t.id === templateId) || {
    subject: replyTo
      ? "Re: " + data.threads.find((t) => t.id === replyTo).subject
      : "",
    body: "",
    signature: "",
  };
  const targetList = replyTo
    ? data.candidates.filter((c) => c.id === target)
    : data.candidates;
  modal(
    `<h2>${replyTo ? "대화에 직접 회신" : "제안 작성·수신자 승인"}</h2><p class="notice">실제 전송은 연결·서버 발송 허용·최종 승인 세 조건이 모두 필요합니다. 협의 중 상품과 미검증 이메일은 차단됩니다.</p><form id="compose-form" data-template="${esc(templateId)}" data-reply="${esc(replyTo)}"><div class="form-grid"><label class="field">수신자<select name="target">${targetList.map((c) => `<option value="${c.id}" ${c.id === target ? "selected" : ""}>${esc(c.name)} / ${esc(c.contact.email || c.handle || "연락처 미확인")}</option>`).join("")}</select></label>${field("channel", "채널", replyTo ? (data.threads.find((t) => t.id === replyTo).channel === "email" ? "이메일" : data.threads.find((t) => t.id === replyTo).channel === "instagram" ? "Instagram 회신" : "Instagram DM 수동") : t.channel === "Instagram DM" ? "Instagram DM 수동" : "이메일", "text", replyTo ? ["이메일", "Instagram 회신", "Instagram DM 수동"] : ["이메일", "Instagram DM 수동"])}<label class="field full">상품 1~3개 (Ctrl/Cmd로 복수 선택)<select name="dealIds" multiple size="4">${data.deals.map((d) => `<option value="${d.id}" ${ds.includes(d.id) ? "selected" : ""}>${esc(d.name)} · v${d.version} · ${esc(d.state)}</option>`).join("")}</select></label></div>${field("subject", "제목|광고성 이메일 제목은 (광고)로 시작해야 합니다.", t.subject)}<div class="actions">${["회사명", "브랜드명", "제품명", "크리에이터명", "공동구매가", "일정"].map((v) => button("＋ " + v, "insert-variable", v)).join("")}</div>${field("intro", "개인화 1~2문장 · 직접 수정 가능", "", "textarea")}<div class="actions">${!replyTo && t.aiEnabled !== false ? button("AI 도입부 1~2줄 생성", "personalize") : ""}</div><div id="intro-evidence" class="fine">${connections.ai?.configured ? "공개 콘텐츠 근거가 있어야 AI 개인화를 제안할 수 있습니다." : "AI 개인화는 아직 연결되지 않았습니다. 개인화 문장은 직접 입력할 수 있습니다."} 본문의 {{개인화}} 위치에 삽입하며, 없으면 앞에 붙습니다. 공통 본문·가격·일정은 AI가 바꾸지 않습니다.</div>${field("body", "공통 본문 카피 · 직접 작성한 원문", t.body, "textarea")}${field("signature", "서명", t.signature, "textarea")}${field("lawfulBasis", "발송 근거·동의 기록|공개 이메일만으로 광고성 정보 발송이 허용되는 것은 아닙니다. 확인한 동의 또는 적용 예외를 기록하세요.", "", "textarea")}${field("marketing", "광고성 정보에 해당함", true, "checkbox")}<label class="field">첨부파일 · 이미지 첨부 가능 (최대 5개·합계 5MB, 파일당 2MB)<input name="attachments" type="file" multiple><small class="help">이미지는 파일로 첨부됩니다. 본문 안에 이미지를 배치하는 기능은 아직 지원하지 않습니다.</small></label><div class="actions"><button class="primary" type="submit">수신자별 최종 미리보기</button>${button("프로필 열기", "open-profile")}</div></form><div id="preview-area"></div>`,
  );
}
async function preparePreview(form) {
  const f = new FormData(form),
    attachments = [];
  for (const file of $("#compose-form [name=attachments]").files) {
    if (file.size > 2 * 1024 * 1024)
      throw Error("파일당 2MB 이하만 첨부하세요.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    attachments.push({ name: file.name, content: btoa(binary) });
  }
  const replyTo = form.dataset.reply;
  preview = await api("/drafts", "POST", {
    target: f.get("target"),
    dealIds: f.getAll("dealIds"),
    channel:
      f.get("channel") === "이메일"
        ? "email"
        : f.get("channel") === "Instagram 회신"
          ? "instagram"
          : "manual_dm",
    subject: f.get("subject"),
    body: assemblePersonalization(f.get("body"), f.get("intro")),
    signature: f.get("signature"),
    lawfulBasis: f.get("lawfulBasis"),
    marketing: f.has("marketing"),
    attachments,
    ...(replyTo ? { replyTo } : {}),
  });
  $("#preview-area").innerHTML =
    `<h3>최종 수신자·내용</h3>${preview.replyRecipientNeedsReview ? `<p class="notice">담당자의 실제 회신 주소 ${esc(preview.email)}로 보냅니다. 최초 등록한 이메일과 다르므로 소유 관계와 수신자를 확인한 후 승인하세요.</p>` : ""}<div class="preview" id="final-preview">${esc(`수신: ${preview.target} / ${preview.email || "Instagram 수동 또는 수신 대화"}\n채널: ${preview.channel}${preview.accountUsername ? " / 발신 @" + preview.accountUsername : ""}\n상품 버전: ${preview.dealVersions.map((x) => x.id + " v" + x.version).join(", ") || "없음"}\n제목: ${preview.subject}\n\n${preview.body}\n\n첨부: ${preview.attachments.map((a) => a.name + " (" + a.size + " bytes)").join(", ") || "없음"}`)}</div><p class="fine">15분 내 승인해야 합니다. 수정하면 다시 미리보기를 만드세요. 예약 메일은 예약 시각 이후 실행기가 확인할 때 처리됩니다(최대 약 5분 간격).</p><label class="field"><span><input id="send-approved" type="checkbox"> 위 수신자·내용·조건 버전·첨부파일을 확인하고 승인합니다.</span></label>${preview.channel === "manual_dm" ? '<label class="field"><span><input id="manually-sent" type="checkbox"> Instagram에서 직접 발송을 완료했습니다.</span></label>' : ""}<div class="actions">${preview.channel === "email" ? `<label class="field">예약 시간 (기기 시간 기준)<input id="schedule-at" type="datetime-local"></label>${button("승인한 내용 예약 자동 발송", "schedule")}` : ""}${button("문구 복사", "copy-preview")}${button(preview.channel === "manual_dm" ? "수동 발송 결과 기록" : "승인한 내용 실제 발송", "dispatch", "", true)}</div><div class="notice">${preview.channel === "email" && !connections.gmail.enabled ? "현재 실제 메일 발송은 서버에서 꺼져 있습니다. " : ""}접수·전달·열람 상태를 혼동하지 않습니다. 자동 재시도는 하지 않습니다.</div>`;
  $("#preview-area").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function inboxPage() {
  $("#app").innerHTML =
    head(
      "통합 대화함",
      "실제 동기화된 대화와 직접 작성한 회신을 관리합니다.",
      button("Gmail 답장 동기화", "sync-mail"),
    ) +
    `<div class="toolbar"><input id="thread-filter" class="search" placeholder="이름·제목·담당자·메모 검색" aria-label="대화 검색"><select id="thread-type"><option value="">모든 대화</option><option value="brand">브랜드</option><option value="creator">크리에이터</option></select></div><div class="panel conversation"><div class="thread-list" id="thread-list"></div><div class="thread-content" id="thread-detail"></div></div>`;
  filterThreads();
  showThread(selectedThread || data.threads[0]?.id);
}
function filterThreads() {
  if (!$("#thread-list")) return;
  const q = $("#thread-filter").value,
    type = $("#thread-type").value;
  $("#thread-list").innerHTML =
    data.threads
      .filter(
        (t) =>
          (targetName(t.target) + t.subject + t.owner + t.next).includes(q) &&
          (!type ||
            (type === "creator"
              ? candidate(t.target)?.kind === "크리에이터"
              : candidate(t.target)?.kind !== "크리에이터")),
      )
      .map(
        (t) =>
          `<div class="thread"><button data-action="thread" data-id="${t.id}" style="text-align:left;width:100%;border:0;background:none"><strong>${esc(targetName(t.target))}</strong><p>${esc(t.subject)}</p>${tag(t.channel)} ${tag(t.classification)}</button></div>`,
      )
      .join("") || '<div class="empty">동기화된 대화가 없습니다.</div>';
}
function showThread(id) {
  const t = data.threads.find((t) => t.id === id);
  if (!t) {
    $("#thread-detail").innerHTML =
      '<div class="empty">대화를 선택하세요. 실제 수신 메일은 Gmail을 연결한 후 동기화할 수 있습니다.</div>';
    return;
  }
  selectedThread = id;
  $("#thread-detail").innerHTML =
    `${tag(t.channel)}${t.channel === "email" && t.providerId ? `<a href="https://mail.google.com/mail/?authuser=${encodeURIComponent(connections.gmail.email || "")}#all/${encodeURIComponent(t.providerId)}" target="_blank" rel="noopener">원본 Gmail 열기 ↗</a>` : ""}<h2 style="margin-top:15px">${esc(t.subject)}</h2><p class="fine">${esc(targetName(t.target))} · ${esc(t.synced || "수동·발송 기록")}${t.accountUsername ? " · 수신·회신 계정 @" + esc(t.accountUsername) : ""}</p>${
      !t.target && t.channel === "instagram"
        ? `<form id="link-instagram-form" data-id="${t.id}"><label class="field">공식 수신 계정과 후보의 관계를 직접 확인한 뒤 연결<select name="target">${data.candidates
            .filter((c) => c.kind === "크리에이터")
            .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
            .join(
              "",
            )}</select></label><button type="submit">확인한 후보에 연결</button></form>`
        : ""
    }<form id="thread-form" data-id="${t.id}" class="form-grid">${field("owner", "담당자", t.owner)}${field("due", "후속 연락일", t.due, "date")}${field("next", "다음 행동·메모", t.next)}${field("classification", "회신 분류", t.classification, "text", ["미분류", "자동 응답", "관심 회신", "단순 안내", "거절", "수신 거부", "수락", "공동구매 확정"])}<button type="submit">관리 정보 저장</button></form>${t.messages.map((m) => `<div class="message ${m.out ? "out" : ""}">${tag(m.out ? "발신" : m.automatic ? "자동 응답" : "사람 회신 / 직접 확인 필요")}<small class="fine">${esc(m.at)}</small><br>${esc(m.text)}${m.hasAttachments ? '<p class="fine">첨부가 있습니다. 원본 Gmail에서 확인하세요.</p>' : ""}</div>`).join("")}${t.target ? button("직접 회신 작성", "reply", t.id, true) : '<div class="notice">수신 계정을 후보와 연결한 후 답장할 수 있습니다.</div>'}`;
}
function jobTable() {
  const jobs = data.jobs || [];
  return `<div class="table-scroll"><table><thead><tr><th>예약 시각</th><th>상태</th><th>처리 결과</th><th></th></tr></thead><tbody>${jobs.map((j) => `<tr><td>${esc(new Date(j.run_at).toLocaleString("ko-KR"))}</td><td>${tag(j.status)}</td><td>${esc(j.result?.error || j.result?.note || "전달·열람 미확인")}</td><td>${j.status === "queued" ? button("예약 취소", "cancel-job", j.id) : ""}</td></tr>`).join("") || '<tr><td colspan="4">승인된 예약이 없습니다.</td></tr>'}</tbody></table></div>`;
}
function settingsPage() {
  $("#app").innerHTML =
    head(
      "운영 설정·공식 계정 연결",
      "외부 서비스 비밀번호를 받지 않습니다. OAuth 토큰은 서버에서 암호화해 저장합니다.",
    ) +
    `${oauthNotice ? `<div class="${oauthNoticeIsError ? "error" : "notice"}" role="alert"><strong>계정 인증 안내</strong><p>${esc(oauthNotice)}</p><p>아래 계정 추가·재인증 버튼에서 다시 시작하세요. 기존 연결은 유지됩니다.</p></div>` : ""}<div class="grid"><div class="panel"><h2>Gmail / Google Workspace</h2><p class="notice">${connections.gmail.connected ? esc(connections.gmail.email) + " 연결됨" : "아직 연결되지 않았습니다."}<br>공식 OAuth 앱 설정 ${connections.gmail.configured ? "완료" : "필요"} · 실제 발송 ${connections.gmail.enabled ? "사용자 승인 후 허용" : "차단 중"}</p>${button("Google 공식 로그인", "connect-gmail", "", true)} ${button("Gmail 연결·권한 점검 (발송 없음)", "check-gmail")}<div id="gmail-check-result" class="fine" role="status"></div> ${button("연결 해제", "disconnect", "gmail")}<p class="fine">gmail.send / gmail.readonly 권한. 운영 계정 동의·검증이 필요합니다. 동기화는 등록 대상과 최근 90일 대화만 가져옵니다.</p></div><div class="panel"><h2>Instagram 프로페셔널 계정</h2><p class="notice">${connections.instagram.connected ? esc(connections.instagram.username) + " 연결됨" : "미연결"} · 앱 설정 ${connections.instagram.configured ? "완료" : "필요"}<br>신규 선제 DM 자동화 불가. 사용자가 먼저 보낸 대화는 웹훅으로 수신하며 24시간 이내 텍스트 회신만 제공합니다.</p>${button("Instagram 계정 추가·재인증", "connect-instagram", "", true)}${connections.instagram.accounts ? connections.instagram.accounts.map((a) => `<div class="task"><strong>@${esc(a.username)}</strong> · ${a.expires && a.expires < Date.now() ? "재인증 필요" : a.tokenMode === "short" ? "임시 연결 · 최대 15분 · 장기 인증 미완료" : "연결됨"}${a.warning ? `<p class="notice">${esc(a.warning)}</p>` : ""} ${button("이 계정 연결 해제", "disconnect", a.key)}</div>`).join("") : button("연결 해제", "disconnect", "instagram")}${(connections.instagram.loginPending || []).map(a => `<div class="notice"><strong>${a.username ? "@" + esc(a.username) + " · " : ""}로그인 응답 수신 · 계정 조회 대기</strong>${a.userDesignated ? "<p class=fine>계정명은 사용자가 지정한 표시이며 API로 확인되지 않았습니다.</p>" : ""}<p>${esc(a.checked)} · DM 수신·발송은 미연동입니다.</p><details><summary>계정 조회 진단 정보</summary><p>${esc(a.detail)}</p></details>${button("이 인증 기록 제거", "disconnect", a.key)}</div>`).join("")}<p class="fine">Instagram 로그인은 선택 사항이며 브랜드 이메일 업무와 독립적입니다. 인증 응답만 받은 상태와 계정·API 검증 완료 상태를 구분합니다.</p><p class="fine">계정 추가 시 Instagram 인증 화면에서 다른 계정으로 로그인하세요. 기존 연결은 유지됩니다. 회신은 해당 대화를 받은 계정으로 고정됩니다.</p><p class="fine">공식 인증·권한 심사·웹훅 설정이 필요합니다. 계정 아이디만으로 로그인하지 않습니다.</p></div></div><div class="panel"><h2>발신자 정보·일일 제한</h2><form id="settings-form" class="form-grid" style="margin-top:20px">${field("senderName", "사업자·발신자명", data.settings.senderName)}${field("senderAddress", "사업장 주소", data.settings.senderAddress)}${field("senderPhone", "발신자 연락처", data.settings.senderPhone)}${field("dailyLimit", "일일 발송 제한 (UTC 기준, 1~100)", data.settings.dailyLimit || 20, "number")}<div class="full"><p class="notice">수신 거부 안내는 이메일 하단에 자동 포함됩니다. 영업 메일은 기본적으로 광고성 정보로 처리합니다. 무료 회신 수신 거부, 동의 근거·발신자 표시·야간 제한은 운영 전에 전문가와 확인하세요. 수신자·본문을 최종 승인한 건만 실제로 발송합니다.</p><button type="submit" class="primary">운영 설정 저장</button></div></form><h3>수신 거부·거절 차단 목록</h3>${data.suppression.map((s) => `<div class="task">${esc(s.identity)} ${tag(s.reason, "orange")}</div>`).join("") || '<p class="fine">차단 기록 없음</p>'}<h3>오류·발송 로그</h3>${outboxTable()}<h3>승인된 예약 자동 발송</h3>${jobTable()}${button("감사 기록 조회", "audit")}</div><div class="notice">Instagram 정책은 <a href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/" target="_blank" rel="noopener">공식 문서</a>를 확인하세요. 수신·전달·매출 수치는 확인한 값만 표시합니다. AI는 지정한 개인화 문장만 제안하며 공통 카피를 유지합니다. 승인된 예약만 Cron 실행기가 자동 처리하며 미승인 초안은 발송하지 않습니다.</div>`;
}
let discoveryView = null, discoveryOnlyEmails = true;
let brandTab = "discovery", discoveryRefresh = null;
const localTime = v => v ? new Date(v).toLocaleString("ko-KR") : "아직 없음";
function discoveryProgress(r) {
  const contacts = new Set(r.leads.flatMap(l => (l.data.contacts || []).map(c => c.email.toLowerCase())));
  return `<div class="stats"><div class="stat"><label>오늘 자동 수집 신규 메일</label><strong>${r.usage.emails} / ${r.settings.target}</strong><small>한국시간 · 고유 메일 · 검증 전</small></div><div class="stat"><label>전체 이메일 후보</label><strong>${contacts.size}</strong><small>전화·문의 폼 제외</small></div><div class="stat"><label>검토 후 브랜드 등록</label><strong>${r.leads.filter(l => l.status === "imported").length}</strong><small>소유 관계 승인 완료</small></div><div class="stat"><label>수집 대기 업체</label><strong>${r.engine?.pending ?? r.leads.filter(l => l.status === "new").length}</strong><small>오늘 처리 ${r.usage.processed}곳</small></div></div>
  <div class="notice" role="status"><strong>${esc(r.engine?.label || "수집 현황 확인 중")}</strong>${r.engine?.current ? " · " + esc(r.engine.current) : ""}<br>최근 수집 완료: ${esc(localTime(r.engine?.lastCompleted))} · 다음 실행 예정: ${esc(localTime(r.engine?.nextRun))}<br><small>화면은 30초마다 현황을 갱신합니다. 서버 수집은 5분 간격입니다. 홈페이지 후보 대기열을 확인하며 검색 API는 필요하지 않습니다. 대기열이 소진되면 별도 웹 조사로 소스를 보강해야 합니다. 하루 30개는 목표이며 확보 보장이 아닙니다.</small>${r.usage.last_error ? "<p class=error>최근 수집 오류: " + esc(r.usage.last_error) + "</p>" : ""}</div>
  <details class="panel" open><summary>최근 수집 진행 내역</summary>${(r.activity || []).map(a => `<div class="task"><strong>${esc(a.name)}</strong> · ${a.emailCount ? "메일 후보 " + a.emailCount + "개" : "메일 미확보"}<small>${esc(localTime(a.checked))} · 확인 ${a.pages}페이지</small>${a.error ? `<p class="error">${esc(a.error)}</p>` : ""}</div>`).join("") || '<p class="fine">아직 처리한 업체가 없습니다.</p>'}</details>`;
}
function discoveryCards(r) {
  const rows = r.leads.filter(l => !discoveryOnlyEmails || l.data.contacts?.length);
  return `<div class="cards">${rows.map(l => `<article class="panel">${tag(l.status === "imported" ? "검토 후 등록됨" : l.data.contacts?.length ? "공개 메일 후보 · 소유 관계 검토 전" : l.status === "new" ? "수집 대기" : "메일 미확보")}<h3>${esc(l.data.name)}</h3><p>${esc(l.data.product || "상품 미선정")}<br>${esc(l.data.channel || "")} · 제품 법적 분류·판매 권한 미확인</p>${l.data.website ? `<a href="${esc(l.data.website)}" target="_blank" rel="noopener">홈페이지 후보 ↗</a>` : ""}<p class="fine">발견 출처: ${l.data.source ? `<a href="${esc(l.data.source)}" target="_blank" rel="noopener">원본 보기</a>` : "미확인"} · ${esc(l.data.checked || "")}</p>${l.data.error ? `<p class="error">${esc(l.data.error)}</p>` : ""}${(l.data.contacts || []).map(c => `<div class="message"><strong>${esc(c.email)}</strong>${tag(c.purpose || "용도 미확인")}${c.discoveryMethod === "user_provided" ? tag("사용자 제공 · 웹 원문 검증 전", "orange") : c.location === "footer" ? tag("푸터에서 확인") : ""}<p class="fine">${esc(c.ownership || "소유 관계 검토 필요")}</p><p>${esc(c.context)}</p>${c.source ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">이메일 출처 확인 ↗</a>` : "사용자 제공 자료 · 원문 URL 확인 대기"} · ${esc(c.checked)}</div>`).join("")}${l.data.contacts?.length && l.status !== "imported" ? `<form id="discovery-import-${l.id}" data-discovery-import="true" data-id="${l.id}">${field("company", "확인한 이메일 소유 법인명", l.data.company || "")}${l.data.contacts.some(c => !c.source) ? field("source", "직접 확인한 이메일 원문 HTTPS URL", "", "url") : ""}<label class="field">등록할 이메일<select name="email">${l.data.contacts.map(c => `<option>${esc(c.email)}</option>`).join("")}</select></label>${field("approved", "공개 원문 출처·이메일 소유 회사·제안 대상 회사의 일치 여부를 직접 확인했습니다", false, "checkbox")}<button type="submit">검토한 이메일로 브랜드 등록</button></form>` : ""}${!l.data.contacts?.length && l.status !== "new" ? `<form id="discovery-requeue-${l.id}" data-discovery-requeue="true" data-id="${l.id}">${field("url", "확인한 공식 홈페이지 URL로 재수집", l.data.website || "", "url")}<button type="submit">URL 보완 후 대기열에 넣기</button></form>` : ""}<p class="fine">${l.data.sourceAttempts?.length ? `<details><summary>확인한 홈페이지·자사몰·푸터 경로</summary>${l.data.sourceAttempts.map(a => `<p><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a> · ${a.status === "checked" ? "메일 후보 " + a.emailCount + "개" : esc(a.error)}${a.linkedFrom ? "<small>연결 출처: " + esc(a.linkedFrom) + "</small>" : ""}</p>`).join("")}</details>` : ""}${l.data.excludedCount || 0}개 주소 제외. 이메일 미확보 업체는 실적에 포함되지 않습니다.</p></article>`).join("") || '<div class="panel empty">아직 조건을 충족한 이메일 후보가 없습니다. 홈페이지 후보를 순서대로 확인하고 있습니다. 진행 현황에서 대기·실패 여부를 확인하세요.</div>'}</div>`;
}
async function discoveryPage() {
  clearTimeout(discoveryRefresh);
  $("#app").innerHTML = head("브랜드 발굴·이메일 영업", "이메일 수집 → 출처·소유 관계 검토 → 브랜드 등록 → 메일 미리보기 → 승인한 건 일괄 예약", button("진행 현황 새로고침", "discovery-refresh")) + '<div class="panel">수집 현황 확인 중…</div>';
  try {
    const r = await api("/discovery"); discoveryView = r;
    $("#app").innerHTML = head("브랜드 발굴·이메일 영업", "이메일 수집 → 소유 관계 검토 → 브랜드 등록 → 메일 미리보기 → 승인한 건 일괄 예약", button("진행 현황 새로고침", "discovery-refresh")) +
      `<div class="actions">${button("발굴·수집 현황", "brand-tab", "discovery", brandTab === "discovery")}${button("등록 브랜드·메일 작성", "brand-tab", "saved", brandTab === "saved")}${button("일괄 메일 작성·미리보기", "bulk-compose", "", true)}</div><div id="discovery-progress">${discoveryProgress(r)}</div>` +
      (brandTab === "saved" ? '<div class="panel"><h2>등록 후 이렇게 진행하세요</h2><p>브랜드의 제품명·이메일을 확인한 뒤 ‘메일 작성·미리보기’를 누르세요. 공통 카피는 <a href="#templates">템플릿</a>에서 편집하고, 개인화 1~2줄은 수신자별로 입력합니다. 최종 내용을 승인하면 예약 실행기가 발송하고, 답장은 <a href="#inbox">통합 대화함</a>에서 확인·회신합니다.</p></div><div id="brand-saved"></div><div class="panel" id="brand-jobs"><h2>승인된 메일 예약 현황</h2>'+jobTable()+'</div>' :
      `<details class="panel"><summary>수집 설정·보조 기능</summary><form id="discovery-settings" class="form-grid">${field("target", "하루 신규 이메일 후보 목표", r.settings.target, "number")}${field("enabled", "5분 간격 자동 수집", r.settings.enabled, "checkbox")}<input name="keywords" type="hidden" value="${esc(r.settings.keywords.join("\n"))}"><button type="submit">설정 저장</button></form>${button("지금 다음 업체 수집", "discovery-run")}<details><summary>직접 홈페이지 추가 (보조 기능)</summary><form id="discovery-seed" class="form-grid">${field("name", "회사·브랜드명", "")}${field("url", "홈페이지 후보 HTTPS URL", "", "url")}<button type="submit">수집 대기열에 추가</button></form></details><p class="fine">대표·일반 문의·고객센터 메일도 찾고 용도를 구분합니다. 이메일 추측·차단 우회·자동 문의폼 제출은 하지 않습니다. AI 호출 없이 사이트당 최대 5페이지를 확인합니다.</p></details>` +
      `<div class="actions">${button(discoveryOnlyEmails ? "메일 미확보·대기 업체도 보기" : "이메일 있는 업체만 보기", "discovery-filter")}${button("이메일 후보 목록 복사", "discovery-copy")}</div>` +
      `<div id="discovery-results">${discoveryCards(r)}</div>`);
    if (brandTab === "saved") candidatesPage("brand", true);
    scheduleDiscoveryRefresh();
  } catch (e) { if (e.status === 404) { candidatesPage("brand"); return; } $("#app").innerHTML = head("브랜드 발굴 연결 확인", "") + `<div class="error">${esc(e.message)}</div>`; }
}
function scheduleDiscoveryRefresh() {
  clearTimeout(discoveryRefresh);
  discoveryRefresh = setTimeout(async () => {
    if (!me || !["brands", "discovery"].includes(location.hash.slice(1))) return;
    try {
      const r = await api("/discovery"), changed = JSON.stringify(discoveryView?.leads) !== JSON.stringify(r.leads);
      const editing = $("#modal").open || document.activeElement?.closest("form");
      if ($("#discovery-progress")) $("#discovery-progress").innerHTML = discoveryProgress(r);
      if (changed && !editing && $("#discovery-results")) { $("#discovery-results").innerHTML = discoveryCards(r); discoveryView = r; }
      if (brandTab === "saved" && !editing) { data = await api("/state"); if ($("#brand-jobs")) $("#brand-jobs").innerHTML = '<h2>승인된 메일 예약 현황</h2>' + jobTable(); }
    }
    catch (e) { if ($("#discovery-progress")) $("#discovery-progress").innerHTML += `<p class="error">현황 갱신 실패: ${esc(e.message)}</p>`; }
    scheduleDiscoveryRefresh();
  }, 30000);
}

let bulkPreviews = [], bulkTemplateId = "";
function bulkCompose() {
  close(); bulkPreviews = [];
  const templates = data.templates.filter(t => t.channel === "이메일");
  if (!templates.length) return toast("템플릿 화면에 이메일 공통 카피를 먼저 저장하세요.");
  const targets = data.candidates.filter(c => c.kind !== "크리에이터" && c.contact?.verified && c.contact.email && !["거절", "수신 거부"].includes(c.status) && !data.outbox.some(o => o.target === c.id) && !data.threads.some(t => t.target === c.id));
  bulkTemplateId = templates[0].id;
  modal(`<h2>브랜드 이메일 일괄 작성</h2><p class="notice">수신자별 최종 제목·본문을 먼저 만듭니다. 미리보기만으로는 발송되지 않습니다. 마지막에 직접 승인한 메일만 예약합니다. 기존 연락·거절·수신 거부 대상은 제외합니다.</p>${!data.settings.senderAddress ? '<p class="error">발신자 사업장 주소가 비어 있습니다. 연동 설정에서 입력해야 최종 미리보기를 만들 수 있습니다.</p>' : ""}<form id="bulk-compose-form"><label class="field">공통 템플릿<select name="templateId" id="bulk-template">${templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label><div id="bulk-copy-fields"></div>${field("lawfulBasis", "발송 근거·동의 기록|공개 이메일이라는 사실만으로 광고성 정보 발송에 동의한 것은 아닙니다. 확인한 근거를 적으세요.", "", "textarea")}${field("marketing", "광고성 정보에 해당함", true, "checkbox")}<h3>수신자 선택·개인화 1~2문장</h3><p class="fine">최대 일일 제한 ${Number(data.settings.dailyLimit || 20)}건 이내로 선택하세요. 개인화는 공통 본문의 {{개인화}} 위치에만 들어갑니다.</p>${targets.map(c => `<article class="panel"><label><input type="checkbox" name="bulk-target" value="${c.id}"> <strong>${esc(c.name)}</strong> · ${esc(c.contact.email)}</label><p class="fine">제품: ${esc(c.product || "미입력 · 브랜드 상세에서 실제 제품명 입력 필요")}</p>${field("intro-" + c.id, "눈여겨본 제품 특징 / 콘텐츠·팬층과 맞는 이유 · 근거가 확인된 사실만", "", "textarea")}${connections.ai?.configured ? button("이 업체 개인화 2문장 제안", "bulk-personalize", c.id) : '<p class="fine">AI 미연결 · 개인화 문장을 직접 입력하세요.</p>'}</article>`).join("") || '<p class="notice">선택 가능한 등록 브랜드가 없습니다. 발굴 목록에서 이메일 출처·소유 관계를 검토해 브랜드로 등록하세요.</p>'}<label class="field">공통 첨부파일 (파일당 2MB·최대 5개·합계 5MB)<input name="attachments" type="file" multiple></label><button type="submit" class="primary">선택한 수신자별 최종 메일 미리보기</button></form><div id="bulk-previews"></div>`);
  applyBulkTemplate();
}
function applyBulkTemplate() {
  bulkTemplateId = $("#bulk-template").value;
  const t = data.templates.find(t => t.id === bulkTemplateId);
  $("#bulk-copy-fields").innerHTML = field("subject", "공통 제목 · 광고성 메일은 (광고)로 시작", t.subject) + field("body", "공통 본문 · 저장된 카피 그대로", t.body, "textarea") + field("signature", "서명", t.signature, "textarea");
  invalidateBulk();
}
function invalidateBulk() {
  bulkPreviews = [];
  if ($("#bulk-previews")) $("#bulk-previews").innerHTML = '<p class="fine">수신자·내용 변경 시 미리보기와 승인을 다시 진행하세요. 이미 완료한 예약은 자동 취소되지 않으며 등록 브랜드의 예약 현황에서 취소할 수 있습니다.</p>';
}
async function bulkPrepare(form) {
  invalidateBulk();
  const f = new FormData(form), targets = f.getAll("bulk-target");
  if (!targets.length) throw Error("수신자를 선택하세요.");
  if (targets.length > Number(data.settings.dailyLimit || 20)) throw Error("선택 수가 일일 발송 제한보다 많습니다. 나누어 예약하세요.");
  const attachments = []; let total = 0;
  for (const file of form.querySelector("[name=attachments]").files) {
    if (file.size > 2 * 1024 * 1024) throw Error("첨부파일은 파일당 2MB 이하입니다.");
    total += file.size;
    if (total > 5 * 1024 * 1024 || attachments.length >= 5) throw Error("첨부파일은 최대 5개·합계 5MB입니다.");
    let binary = ""; for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    attachments.push({name:file.name,content:btoa(binary)});
  }
  const errors = [];
  for (const target of targets) {
    $("#bulk-previews").textContent = `최종 메일 생성 중 ${bulkPreviews.length + errors.length + 1} / ${targets.length} · 실제 발송 없음`;
    try {
      const body = assemblePersonalization(f.get("body"), f.get("intro-" + target));
      const p = await api("/drafts", "POST", {target,dealIds:[],channel:"email",subject:f.get("subject"),body,signature:f.get("signature"),lawfulBasis:f.get("lawfulBasis"),marketing:f.has("marketing"),attachments});
      bulkPreviews.push({...p,candidateId:target});
    } catch(e) { errors.push({name:targetName(target),error:e.message}); }
  }
  $("#bulk-previews").innerHTML = `<h3>최종 메일 ${bulkPreviews.length}건 · 생성 실패 ${errors.length}건</h3><p class="notice">각 메일을 펼쳐 수신자·제목·본문·첨부를 확인하고 개별 체크하세요. 15분 안에 승인해야 합니다. 위 내용을 수정하면 모든 미리보기 승인이 해제됩니다.</p>${errors.map(e => `<p class="error">${esc(e.name)}: ${esc(e.error)}</p>`).join("")}${bulkPreviews.map((p,i) => `<article class="panel"><details open><summary>${esc(p.target)} · ${esc(p.email)}</summary><div class="preview">${esc("수신: " + p.email + "\n제목: " + p.subject + "\n\n" + p.body + "\n\n첨부: " + (p.attachments.map(a => a.name).join(", ") || "없음"))}</div></details><label><input type="checkbox" name="bulk-approve" value="${i}"> 이 수신자·최종 내용·첨부를 확인하고 발송을 승인합니다.</label><div id="bulk-result-${i}" role="status"></div></article>`).join("")}${bulkPreviews.length ? `<label class="field">예약 시각 · 기기 시간 기준 · 광고성 이메일은 한국시간 08~21시<input id="bulk-run-at" type="datetime-local"></label><p class="fine">선택한 시각 이후 5분 간격 실행기가 승인한 건만 순서대로 발송합니다. 일일 제한·중복·수신 거부를 다시 검사하며 실패 건은 자동 재발송하지 않습니다.</p>${button("체크한 메일만 승인·일괄 예약", "bulk-schedule", "", true)}` : ""}`;
}
async function bulkSchedule() {
  const checked = $$("[name=bulk-approve]:checked:not(:disabled)");
  if (!checked.length) throw Error("최종 메일을 확인한 뒤 수신자별 승인 체크를 하세요.");
  const value = $("#bulk-run-at")?.value, time = new Date(value);
  if (!value || !Number.isFinite(time.getTime()) || time.getTime() < Date.now()) throw Error("미래 예약 시각을 선택하세요.");
  const day = time.toISOString().slice(0,10);
  const used = data.outbox.filter(o => ["accepted","sending","outcome_unknown"].includes(o.status) && new Date(o.created).toISOString().slice(0,10) === day).length;
  const reserved = (data.jobs || []).filter(j => ["queued","processing"].includes(j.status) && new Date(j.run_at).toISOString().slice(0,10) === day).length;
  if (used + reserved + checked.length > Number(data.settings.dailyLimit || 20)) throw Error("해당 날짜의 발송·예약 수를 합하면 일일 제한을 넘습니다. 수신자를 줄이거나 날짜를 나누세요.");
  let success = 0, failed = 0;
  for (const check of checked) {
    const i = Number(check.value), p = bulkPreviews[i];
    if (!p) continue;
    try {
      const r = await api("/schedule", "POST", {draftId:p.id,hash:p.hash,approved:true,runAt:time.toISOString()});
      check.disabled = true; check.checked = false; success++;
      $("#bulk-result-"+i).textContent = "예약 완료 · " + localTime(r.run_at);
    } catch(e) { failed++; $("#bulk-result-"+i).textContent = "예약 실패 · " + e.message; }
  }
  data = await api("/state");
  toast(`예약 완료 ${success}건 · 실패 ${failed}건. 실패한 메일은 예약되지 않았습니다.`);
}

const pages = {
  dashboard,
  discovery: discoveryPage,
  brands: discoveryPage,
  deals: dealsPage,
  creators: () => candidatesPage("creator"),
  matching: matchingPage,
  templates: templatesPage,
  inbox: inboxPage,
  settings: settingsPage,
};
const formObject = (form) => Object.fromEntries(new FormData(form));
const listText = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    buttons = [...form.querySelectorAll("button[type=submit]")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const f = formObject(form),
      fid = form.dataset.id;
    if (form.id === "bulk-compose-form") { await bulkPrepare(form); return; }
    if (form.id.startsWith("discovery-")) {
      if (form.dataset.discoveryRequeue) await api("/discovery/requeue", "POST", {id:fid,url:f.url});
      else if (form.dataset.discoveryImport) await api("/discovery/import", "POST", { id:fid, email:f.email, company:f.company, source:f.source || "", approved:f.approved === "on" });
      else if (form.id === "discovery-settings") await api("/discovery/settings", "POST", { target:Number(f.target), enabled:f.enabled === "on", keywords:f.keywords.split(/\r?\n/).filter(Boolean) });
      else if (form.id === "discovery-seed") await api("/discovery/seed", "POST", {name:f.name,url:f.url});
      toast("저장했습니다."); await reload(); await discoveryPage(); return;
    }
    if (form.id === "auth-form") {
      if (form.dataset.type === "setup") {
        await api("/auth/setup", "POST", f);
        toast("관리자 생성 완료. 로그인하세요.");
        await authPage();
      } else {
        const r = await api("/auth/login", "POST", f);
        csrf = r.csrf;
        await boot();
      }
      return;
    }
    if (form.id === "search-form") {
      if (!connections.search.configured) {
        const q = f.q + (form.dataset.type === "creator" ? " site:instagram.com" : " 회사 이메일 공식 홈페이지");
        window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank", "noopener,noreferrer");
        $("#search-results").textContent = "공개 웹 검색을 새 탭으로 열었습니다. API 연결은 필요하지 않습니다.";
        return;
      }
      try {
        const r = await api(
          "/search?q=" + encodeURIComponent(f.q) + "&type=" + form.dataset.type,
        );
        $("#search-results").innerHTML =
          r.results
            .map(
              (r) =>
                `<article class="link-card"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)} ↗</a><p>${esc(r.description)}</p><small>${esc(r.verification)} · ${esc(r.checked)}</small>${button("직접 확인 후 후보 추가", form.dataset.type === "creator" ? "add-creator" : "add-brand")}</article>`,
            )
            .join("") || "검색 결과가 없습니다.";
      } catch (e) {
        $("#search-results").innerHTML =
          `<div class="notice">${esc(e.message)}${e.searchUrl ? `<br><a href="${esc(e.searchUrl)}" target="_blank" rel="noopener">공식 링크 직접 검색 ↗</a>` : ""}</div>`;
      }
      return;
    }
    if (form.id === "candidate-form") {
      const old = candidate(fid),
        c = {
          ...f,
          companyKey: f.companyKey || f.company.replace(/\s/g, ""),
          contact: {
            email: f.email,
            owner: f.contactOwner,
            source: f.contactSource,
            checked: f.contactChecked,
            verified: f.verified === "on",
            purpose: f.contactPurpose,
          },
          topics: listText(f.topics),
          followers: f.followers === "" ? null : Number(f.followers),
          evidence: f.evidence
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((url) => ({
              url,
              description: f.reason,
              checked: new Date().toISOString().slice(0, 10),
            })),
          ...(old ? { version: old.version } : {}),
        };
      await api("/candidate" + (fid ? "/" + fid : ""), fid ? "PUT" : "POST", c);
    } else if (form.id === "deal-form") {
      const old = deal(fid),
        d = {
          ...f,
          topics: listText(f.topics),
          ...(old ? { version: old.version } : {}),
        };
      for (const k of ["retail", "price", "supply", "moq", "stock"])
        d[k] = f[k] === "" ? null : Number(f[k]);
      await api("/deal" + (fid ? "/" + fid : ""), fid ? "PUT" : "POST", d);
    } else if (form.id === "template-form") {
      const old = data.templates.find((t) => t.id === fid);
      await api("/template" + (fid ? "/" + fid : ""), fid ? "PUT" : "POST", {
        ...f,
        aiEnabled: f.aiEnabled === "on",
        ...(old ? { version: old.version } : {}),
      });
    } else if (form.id === "settings-form") {
      await api("/settings", "PUT", { ...f, dailyLimit: Number(f.dailyLimit) });
      await reload();
      toast("운영 설정을 저장했습니다.");
      return;
    } else if (form.id === "thread-form") {
      const t = data.threads.find((t) => t.id === fid);
      await api("/thread/" + fid, "PUT", { ...f, version: t.version });
      await reload();
      toast("대화 관리 정보를 저장했습니다.");
      return;
    } else if (form.id === "compose-form") {
      await preparePreview(form);
      return;
    } else if (form.id === "link-instagram-form") {
      const t = data.threads.find((t) => t.id === fid);
      await api("/instagram/link-thread", "POST", {
        thread: fid,
        target: f.target,
        version: t.version,
      });
      await reload();
      return;
    }
    close();
    await reload();
    toast("서버에 저장했습니다.");
  } catch (e) {
    if (form.id === "auth-form") $("#auth-error").textContent = e.message;
    else err(e);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});
const actions = {
  close,
  "bulk-compose": bulkCompose,
  "bulk-schedule": bulkSchedule,
  "bulk-personalize": async (target) => { const r = await api("/personalize", "POST", {target,templateId:bulkTemplateId}); $("#bulk-compose-form [name=\"intro-"+target+"\"]").value = r.intro; invalidateBulk(); },
  "discovery-refresh": discoveryPage,
  "brand-tab": async (tab) => { brandTab = tab; await discoveryPage(); },
  "discovery-run": async () => { const r = await api("/discovery/run", "POST", {}); await discoveryPage(); toast(r.message || `신규 업체 ${r.added || 0}곳 · 이메일 후보 ${r.emailCandidatesAdded || 0}개 · 검토 ${r.processed || 0}곳`); },
  "discovery-filter": async () => { discoveryOnlyEmails = !discoveryOnlyEmails; await discoveryPage(); },
  "discovery-copy": async () => { const emails = [...new Set((discoveryView?.leads || []).flatMap(l => (l.data.contacts || []).map(c => c.email)))]; if (!emails.length) return toast("확보한 이메일 후보가 없습니다."); await navigator.clipboard.writeText(emails.join("\n")); toast("메일 후보를 복사했습니다. 발송 전 소유 관계와 동의 근거를 확인하세요."); },
  async logout() {
    await api("/auth/logout", "POST", {});
    location.reload();
  },
  "add-brand": () => candidateForm(),
  "add-creator": () => candidateForm("", true),
  "edit-candidate": (id) => candidateForm(id),
  "add-deal": () =>
    data.candidates.some((c) => c.kind !== "크리에이터")
      ? dealForm()
      : toast("브랜드·공급사를 먼저 추가하세요."),
  "edit-deal": (id) => dealForm(id),
  "add-template": () => templateForm(),
  "edit-template": (id) => templateForm(id),
  "use-template": (id) => compose("", [], id),
  compose: (id) =>
    data.candidates.length ? compose(id) : toast("후보를 먼저 추가하세요."),
  reply: (id) => {
    const t = data.threads.find((t) => t.id === id);
    compose(t.target, [], "", id);
  },
  thread: showThread,
  "matched-compose": () => {
    const ids = $$("[name=match-pair]:checked").map((i) => i.value),
      mode = $("#match-direction").value,
      target = $("#match-target").value;
    if (!ids.length || ids.length > 3)
      return toast("상품 1~3개 또는 크리에이터 1명을 선택하세요.");
    compose(
      mode === "creator" ? target : ids[0],
      mode === "creator" ? ids : [target],
    );
  },
  "insert-variable": (v) => {
    const el = $("#compose-form [name=body]");
    el.setRangeText("{{" + v + "}}", el.selectionStart, el.selectionEnd, "end");
    invalidatePreview();
  },
  "open-profile": () => {
    const c = candidate($("#compose-form [name=target]").value),
      url =
        c.profile ||
        (c.handle &&
          "https://www.instagram.com/" + encodeURIComponent(c.handle) + "/");
    if (!url) return toast("공개 프로필을 먼저 등록하세요.");
    window.open(url, "_blank", "noopener,noreferrer");
  },
  "copy-preview": async () => {
    if (!preview) return toast("최종 미리보기를 먼저 만드세요.");
    await navigator.clipboard.writeText(
      preview.subject + "\n\n" + preview.body,
    );
    toast("직접 발송할 문구를 복사했습니다.");
  },
  dispatch: async () => {
    if (!preview || !$("#send-approved")?.checked)
      return toast("최종 수신자·내용을 승인하세요.");
    const r = await api("/drafts/" + preview.id + "/send", "POST", {
      hash: preview.hash,
      approved: true,
      manuallySent: $("#manually-sent")?.checked || false,
    });
    close();
    await reload();
    toast(r.note);
  },
  personalize: async () => {
    const target = $("#compose-form [name=target]").value;
    if (!target) return toast("수신자를 먼저 선택하세요.");
    const r = await api("/personalize", "POST", { target, templateId: $("#compose-form").dataset.template || undefined });
    $("#compose-form [name=intro]").value = r.intro;
    invalidatePreview();
    $("#intro-evidence").innerHTML =
      "AI 제안 · 최종 검토 필요<br>" +
      r.evidence
        .map(
          (e) =>
            `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.description)}</a> · ${esc(e.checked)}`,
        )
        .join("<br>");
    toast("도입부만 생성했습니다. 공통 본문은 변경하지 않았습니다.");
  },
  schedule: async () => {
    if (!preview || !$("#send-approved")?.checked)
      return toast("최종 수신자·내용을 먼저 승인하세요.");
    const value = $("#schedule-at")?.value;
    if (!value) return toast("예약 시간을 선택하세요.");
    const r = await api("/schedule", "POST", {
      draftId: preview.id,
      hash: preview.hash,
      approved: true,
      runAt: new Date(value).toISOString(),
    });
    close();
    await reload();
    toast(
      "승인한 내용으로 예약했습니다. 예약 시각: " +
        new Date(r.run_at).toLocaleString("ko-KR"),
    );
  },
  "cancel-job": async (id) => {
    await api("/jobs/" + id, "DELETE");
    await reload();
    toast("예약을 취소했습니다.");
  },
  "health-check": async () => {
    const r = await api("/health");
    toast(
      r.ok
        ? "서버 함수 연결 정상 · 버전 " + r.version
        : "함수 상태를 확인하세요.",
    );
  },
  "check-gmail": async () => {
    const r = await api("/gmail/check", "POST", {});
    $("#gmail-check-result").textContent = `계정 일치 ${r.accountMatches ? "확인" : "실패"} · Gmail 발송 권한 ${r.sendPermission ? "있음" : "없음"} · 수신 조회 권한 ${r.readPermission ? "있음" : "없음"} · 서버 실제 발송 ${r.sendingEnabled ? "허용됨 (최종 승인 필요)" : "차단 중"}. 테스트 메일은 보내지 않았으며 수신함 도착은 미검증입니다.`;
  },
  "connect-gmail": async () =>
    location.assign((await api("/oauth/gmail", "POST", {})).url),
  "connect-instagram": async () =>
    location.assign((await api("/oauth/instagram", "POST", {})).url),
  disconnect: async (p) => {
    if (
      confirm(
        "서비스에 저장된 연결을 해제할까요? 제공자 계정의 앱 권한은 해당 계정에서도 해제할 수 있습니다.",
      )
    ) {
      await api("/connections/" + p, "DELETE");
      await reload();
    }
  },
  "sync-mail": async () => {
    const r = await api("/gmail/sync", "POST", {});
    await reload();
    toast(
      r.imported +
        "개 대화 동기화" +
        (r.partial ? " · 일부 결과만 수집됨" : ""),
    );
  },
  audit: async () => {
    const rows = await api("/audit");
    modal(
      "<h2>감사 기록</h2>" +
        rows
          .map(
            (r) =>
              `<div class="notice">${esc(r.action)} · ${esc(r.created)}<br>${esc(JSON.stringify(r.data))}</div>`,
          )
          .join(""),
    );
  },
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  e.preventDefault();
  const a = actions[b.dataset.action];
  if (!a) return;
  b.disabled = true;
  try {
    await a(b.dataset.id);
  } catch (e) {
    err(e);
  } finally {
    b.disabled = false;
  }
});
function invalidatePreview() {
  preview = null;
  if ($("#preview-area"))
    $("#preview-area").innerHTML =
      '<div class="notice">내용이 변경되었습니다. 최종 미리보기를 다시 만드세요.</div>';
}
document.addEventListener("input", (e) => {
  if (e.target.closest("#compose-form")) invalidatePreview();
  if (e.target.closest("#bulk-compose-form")) invalidateBulk();
  if (
    ["candidate-filter", "status-filter", "category-filter"].includes(
      e.target.id,
    )
  )
    filterCandidates();
  if (["thread-filter", "thread-type"].includes(e.target.id)) filterThreads();
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#compose-form")) invalidatePreview();
  if (e.target.closest("#bulk-compose-form")) invalidateBulk();
  if (e.target.id === "bulk-template") applyBulkTemplate();
  if (e.target.id === "match-direction") updateMatchOptions();
  if (e.target.id === "match-target") showMatches();
  if (["status-filter", "category-filter"].includes(e.target.id))
    filterCandidates();
  if (e.target.id === "thread-type") filterThreads();
});
window.addEventListener("hashchange", () => {
  render();
});
boot();
