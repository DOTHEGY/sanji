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
  brands: ["▣", "브랜드 이메일"],
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
    `<b>운영 데이터 · 서버 저장</b> Gmail ${connections.gmail.connected ? "연결됨" : "미연결"} · 실제 메일 ${connections.gmail.enabled ? "사용자 승인 후 발송" : "발송 비활성"} · 승인 전 자동 발송 없음`;
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
    `p class="fine"><a href="#discovery">회사 이메일 발굴 →</a> · <a href="#templates">브랜드 제안 템플릿 →</a> · <a href="#inbox">답장 확인·회신 →</a></p><div class="stats"><div class="stat"><label>발굴 후보</label><strong>${data.candidates.length}</strong><small>검증된 사업용 연락처 ${data.candidates.filter((c) => c.contact.verified).length}</small></div><div class="stat"><label>이메일·API 접수</label><strong>${sent.length}</strong><small>받은편지함 도착·열람은 미확인</small></div><div class="stat"><label>사람의 회신율</label><strong>${rate(humanTargets.size)}</strong><small>회신 대상 ${humanTargets.size} / 접수 대상 ${sentTargets.size} · 자동 응답 제외</small></div><div class="stat"><label>확보한 상품 딜</label><strong>${data.deals.filter((d) => d.state === "확정").length}</strong><small>상품 조건이 확정된 카드 수</small></div></div><div class="grid"><div class="panel"><div class="panel-head"><h2>지금 해야 할 일</h2><a href="#inbox">대화함 ↗</a></div>${
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
    `<h2>템플릿 편집</h2><form id="template-form" data-id="${esc(id)}">${field("name", "템플릿 이름", t.name)}${field("channel", "채널", t.channel, "text", ["이메일", "Instagram DM"])}${field("subject", "제목", t.subject)}<p class="fine">제목은 입력한 원문 그대로 저장하고 발송 전 업체 메일에 반영합니다.</p><p class="fine">사용 가능 변수: {{회사명}}, {{브랜드명}}, {{제품명}}, {{크리에이터명}}, {{공동구매가}}, {{일정}}. 본문에 {{개인화}}를 넣으면 그 위치에 개인화 1~2문장이 들어갑니다. 없으면 본문 앞에 붙습니다.</p>${field("body", "공통 본문 카피 · AI 수정 없음", t.body, "textarea")}${field("aiEnabled", "수신자별 AI 도입부 1~2줄 제안 사용", t.aiEnabled ?? true, "checkbox")}${field("personalizationGuide", "개인화 작성 지침 · AI에는 이 지침과 공개 근거만 전달", t.personalizationGuide || "", "textarea")}${field("signature", "서명", t.signature, "textarea")}<p class="template-sync-note">저장하면 연결된 발송 전 업체의 제목·본문·서명에 바로 반영됩니다. 업체별 개인화는 유지됩니다. 이전 미리보기와 대기 중인 예약은 재승인이 필요하며, 이미 보낸 원문은 바뀌지 않습니다.</p><button class="primary" type="submit">저장하고 발송 전 메일에 반영</button></form>`,
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
    `<h2>${replyTo ? "대화에 직접 회신" : "제안 작성·수신자 승인"}</h2><p class="notice">실제 전송은 연결·서버 발송 허용·최종 승인 세 조건이 모두 필요합니다. 협의 중 상품과 미검증 이메일은 차단됩니다.</p><form id="compose-form" data-template="${esc(templateId)}" data-reply="${esc(replyTo)}"><div class="form-grid"><label class="field">수신자<select name="target">${targetList.map((c) => `<option value="${c.id}" ${c.id === target ? "selected" : ""}>${esc(c.name)} / ${esc(c.contact.email || c.handle || "연락처 미확인")}</option>`).join("")}</select></label>${field("channel", "채널", replyTo ? (data.threads.find((t) => t.id === replyTo).channel === "email" ? "이메일" : data.threads.find((t) => t.id === replyTo).channel === "instagram" ? "Instagram 회신" : "Instagram DM 수동") : t.channel === "Instagram DM" ? "Instagram DM 수동" : "이메일", "text", replyTo ? ["이메일", "Instagram 회신", "Instagram DM 수동"] : ["이메일", "Instagram DM 수동"])}<label class="field full">상품 1~3개 (Ctrl/Cmd로 복수 선택)<select name="dealIds" multiple size="4">${data.deals.map((d) => `<option value="${d.id}" ${ds.includes(d.id) ? "selected" : ""}>${esc(d.name)} · v${d.version} · ${esc(d.state)}</option>`).join("")}</select></label></div>${field("subject", "제목", t.subject)}<div class="actions">${["회사명", "브랜드명", "제품명", "크리에이터명", "공동구매가", "일정"].map((v) => button("＋ " + v, "insert-variable", v)).join("")}</div>${field("intro", "개인화 1~2문장 · 직접 수정 가능", "", "textarea")}<div class="actions">${!replyTo && t.aiEnabled !== false ? button("AI 도입부 1~2줄 생성", "personalize") : ""}</div><div id="intro-evidence" class="fine">${connections.ai?.configured ? "공개 콘텐츠 근거가 있어야 AI 개인화를 제안할 수 있습니다." : "AI 개인화는 아직 연결되지 않았습니다. 개인화 문장은 직접 입력할 수 있습니다."} 본문의 {{개인화}} 위치에 삽입하며, 없으면 앞에 붙습니다. 공통 본문·가격·일정은 AI가 바꾸지 않습니다.</div>${field("body", "공통 본문 카피 · 직접 작성한 원문", t.body, "textarea")}${field("signature", "서명", t.signature, "textarea")}<details><summary>추가 발송 설정</summary>${field("marketing", "광고성 판매·홍보 메일에 해당함", false, "checkbox")}</details><label class="field">첨부파일 · 이미지 첨부 가능 (최대 5개·합계 5MB, 파일당 2MB)<input name="attachments" type="file" multiple><small class="help">이미지는 파일로 첨부됩니다. 본문 안에 이미지를 배치하는 기능은 아직 지원하지 않습니다.</small></label><div class="actions"><button class="primary" type="submit">수신자별 최종 미리보기</button>${button("프로필 열기", "open-profile")}</div></form><div id="preview-area"></div>`,
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
    lawfulBasis: f.get("lawfulBasis") || "",
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
  return `<div class="table-scroll"><table><thead><tr><th>예약 시각</th><th>상태</th><th>처리 결과</th><th></th></tr></thead><tbody>${jobs.map((j) => `<tr><td>${esc(new Date(j.run_at).toLocaleString("ko-KR"))}</td><td>${tag(j.status)}</td><td>${esc(j.result?.error || j.result?.note || j.result?.reason || "전달·열람 미확인")}</td><td>${j.status === "queued" ? button("예약 취소", "cancel-job", j.id) : ""}</td></tr>`).join("") || '<tr><td colspan="4">승인된 예약이 없습니다.</td></tr>'}</tbody></table></div>`;
}
async function settingsPage() {
 const g=connections.gmail||{},ig=connections.instagram||{};
 const accountCards=(ig.accounts||[]).map(a=>{
  const valid=a.expires>Date.now(),c=a.capabilities||{};
  return '<article class="connected-account"><div class="account-heading"><strong>@'+esc(a.username)+'</strong>'+tag(valid?(a.tokenMode==="short"?"임시 인증":"계정 확인됨"):"재로그인 필요",valid?"":"orange")+'</div><div class="connection-steps">'+connectionStep("계정 조회",valid&&a.apiVerified)+connectionStep("대화 읽기",valid&&c.messagesReadable)+connectionStep("웹훅 구독",valid&&c.webhookSubscribed)+'</div><div class="actions">'+button(valid?"연결 상태 점검":"다시 로그인",valid?"check-instagram":"connect-instagram-basic",valid?a.key:"")+button("해제","disconnect",a.key)+'</div>'+(a.warning?'<details class="fine"><summary>인증 상세</summary>'+esc(a.warning)+'</details>':"")+'</article>';
 }).join("");
 const pendingCards=(ig.loginPending||[]).map(a=>'<article class="connected-account account-pending"><div class="account-heading"><strong>'+(a.username?"@"+esc(a.username):"이전 인증")+'</strong>'+tag(a.canRetry?"계정 조회 필요":"재로그인 필요","orange")+'</div><p>'+(a.canRetry?"로그인 응답은 확인했지만 계정 조회가 완료되지 않았습니다. 보관 중인 임시 인증으로 다시 확인할 수 있습니다.":"이전 로그인은 계정 조회까지 완료되지 않았고 임시 토큰이 만료됐습니다. 공식 로그인부터 다시 연결해 주세요.")+'</p><div class="actions">'+(a.canRetry?button("계정 조회 다시 시도","check-instagram",a.key):"")+button("Instagram 다시 연결","connect-instagram-basic","",true)+button("기록 삭제","disconnect",a.key)+'</div><details class="fine"><summary>이전 오류 보기</summary>'+esc(a.detail||"")+'</details></article>').join("");
 $("#app").innerHTML=head("연동 설정","계정 연결, 자동 발굴, 발신 정보를 관리하세요.")+
 (oauthNotice?'<div class="'+(oauthNoticeIsError?"error":"notice")+'" role="alert">'+esc(oauthNotice)+'</div>':"")+
 '<div class="settings-layout"><section class="panel integration-card"><div class="integration-heading"><span class="provider-mark gmail-mark">G</span><div><h2>Gmail</h2><p>브랜드 메일 발송·답장</p></div>'+tag(g.connected?"연결됨":"미연결",g.connected?"":"orange")+'</div><div class="integration-body"><strong>'+esc(g.email||"보낼 계정을 연결하세요")+'</strong><p class="fine">'+(g.enabled?"수신자와 최종 내용을 승인한 메일만 발송합니다.":"현재 서버에서 실제 발송을 제한하고 있습니다.")+'</p><div class="actions">'+button(g.connected?"계정 변경":"Google로 연결","connect-gmail","",!g.connected)+button("연결 점검","check-gmail")+'</div><div id="gmail-check-result" role="status" class="fine"></div><details class="integration-detail"><summary>권한·연결 관리</summary><p class="fine">gmail.send · gmail.readonly. 최근 90일의 대상 업체 대화를 동기화합니다.</p>'+button("Gmail 연결 해제","disconnect","gmail")+'</details></div></section>'+
 '<section class="panel integration-card"><div class="integration-heading"><span class="provider-mark instagram-mark">◎</span><div><h2>Instagram</h2><p>계정 조회·받은 대화 연결</p></div>'+tag(ig.connected?"계정 연결됨":"설정 필요",ig.connected?"":"orange")+'</div><div class="integration-body">'+accountCards+pendingCards+(!accountCards&&!pendingCards?'<p class="fine">프로페셔널 계정을 공식 로그인으로 연결하세요.</p>':"")+'<div class="actions">'+button("＋ 다른 계정 추가","connect-instagram-basic")+'</div><div id="instagram-check-result" role="status" class="fine"></div><details class="integration-detail"><summary>지원 범위·웹훅 설정</summary><p class="fine">신규 상대에게 먼저 DM을 보내는 자동화는 지원하지 않습니다. 대화 읽기 권한과 웹훅 구독이 확인되어야 수신 대화를 연결할 수 있습니다. 회신은 사용자가 먼저 보낸 대화의 24시간 내 텍스트만 지원하며 최종 승인이 필요합니다.</p><p class="fine">Meta 앱의 Instagram 웹훅 콜백을 먼저 설정해야 합니다. 계정 점검에서 웹훅 미구독이면 아래 버튼으로 해당 계정의 messages 구독을 요청할 수 있습니다.</p>'+(ig.accounts||[]).map(a=>button("@"+a.username+" 웹훅 구독","subscribe-instagram",a.key)).join("")+button("대화 권한 추가·재인증","connect-instagram")+'<a class="text-link" href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/" target="_blank" rel="noopener">Meta 공식 안내 ↗</a></details></div></section></div>'+
 '<section class="panel settings-section"><div class="section-title"><div><h2>매일 새 업체 찾기</h2><p>한국시간 자정에 외부 목록을 갱신하고, 중복을 제외해 순차 확인합니다.</p></div>'+tag("00:00 KST")+'</div><div id="discovery-settings-panel" class="fine">발굴 설정 확인 중…</div></section>'+
 '<section class="panel settings-section"><div class="section-title"><div><h2>발신자 정보</h2><p>메일 하단에 표시되는 사업자 정보입니다.</p></div></div><form id="settings-form" class="form-grid">'+field("senderName","사업자·발신자명",data.settings.senderName)+field("senderAddress","사업장 주소",data.settings.senderAddress)+field("senderPhone","발신자 연락처",data.settings.senderPhone)+'<div class="full"><p class="fine">일반 협업 제안에는 수신 거부 문구를 자동 추가하지 않습니다. 광고성 메일에는 발신자 정보·수신 거부 안내를 적용합니다.</p><button type="submit" class="primary">발신 정보 저장</button></div></form></section>'+
 '<details class="panel settings-section"><summary>예약·발송 기록·차단 목록</summary><h3>승인한 발송 예약</h3>'+jobTable()+'<h3>발송 기록</h3>'+outboxTable()+'<h3>차단 목록</h3>'+(data.suppression.map(s=>'<div class="task">'+esc(s.identity)+tag(s.reason,"orange")+'</div>').join("")||'<p class="fine">차단 기록 없음</p>')+button("감사 기록 조회","audit")+'</details>';
 try {const r=await api("/discovery");if(!$("#discovery-settings-panel"))return;$("#discovery-settings-panel").innerHTML='<form id="discovery-settings" class="discovery-preferences">'+field("target","하루 신규 업체 목표",r.settings.target,"number")+field("enabled","매일 자정(00:00 KST) 자동 발굴",r.settings.enabled,"checkbox")+field("notifyCompletion","목표 달성 시 관리자 로그인 이메일로 완료 알림",r.settings.notify_completion,"checkbox")+'<input name="keywords" type="hidden" value="'+esc(r.settings.keywords.join("\n"))+'"><button type="submit">발굴 설정 저장</button></form><p class="fine">이메일을 확보한 새로운 업체를 기준으로 집계합니다. 40곳은 일일 목표이며 실제 확보 수와 실패 원인을 표시합니다. 자동 발굴은 메일 발송 승인을 대신하지 않습니다.</p><div class="discovery-source-summary">'+sourceSummary(r)+'</div>';}catch(e){if($("#discovery-settings-panel"))$("#discovery-settings-panel").textContent=e.message;}
}
function connectionStep(label,done){return '<span class="connection-step '+(done?"done":"")+'">'+(done?"✓":"○")+' '+esc(label)+'</span>';}
function sourceSummary(r){const s=r.engine?.sourceState||r.settings.source_state||{};return '<span>최근 목록 갱신 '+esc(localTime(s.checked))+'</span><span>신규 후보 '+Number(s.added||0)+'곳</span>'+(s.error?'<details><summary>수집 제한·오류</summary><p>'+esc(s.error)+'</p></details>':"");}

let discoveryView = null, discoveryOnlyEmails = true;
let mailDayFilter="all";
const inlineMailState=new Map();let inlineMailBusy=false;
let brandTab = "pending", discoveryRefresh = null, selectedMailLeads = new Set();
const localTime = v => v ? new Date(v).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}) : "아직 없음";
const kstDay=v=>new Date(v).toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
function historyCount(r,offset){const day=kstDay(Date.now()-offset*86400000);return {day,...(r.history||[]).find(h=>h.day===day),companies:(r.history||[]).find(h=>h.day===day)?.companies??(offset===0?Number(r.usage?.companies||0):0)};}
function leadDay(l){return l.data.firstEmailAt?kstDay(l.data.firstEmailAt):l.data.discoveredDay||"";}
function discoveryHistory(r){return '<details class="discovery-history"><summary>날짜별 발굴 내역</summary><p class="fine">한국시간 기준 · 이메일을 처음 확보한 날로 집계합니다. 후보 추가·이메일 확보·소유 관계 검증은 서로 다른 단계입니다. 사용자 제공 이메일도 포함합니다.</p><div class="table-scroll"><table><thead><tr><th>날짜</th><th>이메일 확보 업체</th><th>공개 페이지 출처 업체</th><th>신규 이메일</th><th>홈페이지 후보 추가</th></tr></thead><tbody>'+(r.history||[]).slice(0,14).map(h=>'<tr><td>'+esc(h.day)+'</td><td>'+Number(h.companies)+'곳</td><td>'+Number(h.publicCompanies)+'곳</td><td>'+Number(h.emails)+'개</td><td>'+Number(h.candidates)+'곳</td></tr>').join("")+'</tbody></table></div></details>';}
function mailCopy(l) {
  const o=l.data.outreach||{},t=data.templates.find(t=>t.channel==="이메일")||{};
  return {subject:o.subject||t.subject||"",body:o.body||"",signature:o.signature??t.signature??"",intro:o.intro||"",productName:o.productName||l.data.product||"",companyName:o.brandName||l.data.name||l.data.company||"",prepared:!!o.body,needsPersonalization:!!o.needsPersonalization,sendBlockedReason:o.sendBlockedReason||"",uncertainty:o.uncertainty||"",templateId:o.templateId,templateVersion:o.templateVersion,evidence:o.evidence||[]};
}
function sentMailRows() { return data.outbox.filter(o=>o.channel==="email"&&o.status==="accepted"); }
function mailLeadSent(l) { return sentMailRows().some(o=>o.target===l.data.candidateId||candidate(o.target)?.contact?.email&&(l.data.contacts||[]).some(c=>c.email.toLowerCase()===candidate(o.target).contact.email.toLowerCase())); }
function searchSummary(r){const s=r.engine?.searchState||r.settings.search_state||{};return "검색 보충: "+esc(({searching:"검색 중",replenished:"새 후보 추가",no_new_results:"새 결과 없음 · 다음 검색어 대기"})[s.status]||"대기")+" · 오늘 검색어 "+Number(s.queries||0)+"개 · 최근 새 후보 "+Number(s.added||0)+"곳"+(s.sources?.length?'<details><summary>검색 제공자별 결과</summary>'+s.sources.map(x=>'<p>'+esc(x.engine)+" · "+esc(x.query)+" · "+(x.ok?Number(x.count)+"개 링크":esc(x.error||"추출 결과 없음"))+'</p>').join("")+'</details>':"");}
function discoveryHealthPanel(r){
 const h=r.health;if(!h)return '<p class="fine">서버 진행 상태를 확인하는 중입니다.</p>';
 const e=h.efficiency||{},research=h.research||{},warn=["error","delayed","paused","crawl_budget","search_budget"].includes(h.status);
 return '<section class="panel discovery-health '+(warn?'health-warning':'')+'" aria-live="polite"><div class="health-heading"><h2>'+esc(h.label)+'</h2><span>30초마다 갱신</span></div>'+(h.current?'<p><strong>현재 확인: '+esc(h.current)+'</strong></p>':"")+'<div class="health-times"><span>마지막 실행 '+esc(localTime(h.lastStarted))+'</span><span>완료 '+esc(localTime(h.lastFinished))+'</span><span>다음 실행 '+esc(h.nextRun?localTime(h.nextRun):["crawling","searching","researching"].includes(h.status)?"현재 처리 중":"상태 상세 확인")+'</span><span>대기 후보 '+Number(h.pending)+'곳</span><span>최근 작업 '+esc(h.lastStep||"아직 기록 없음")+'</span></div>'+(!h.heartbeatVerified?'<p class="notice">아직 새 실행 기록이 없습니다. 수집 중으로 간주하지 않습니다.</p>':"")+(h.lastError?'<p class="error">'+esc(h.lastError)+'</p>':"")+'<p class="fine">매일 00:00 KST 시작 · 완료 메일 '+(r.settings.notify_completion?"켜짐":"꺼짐")+' · '+esc(r.notification?({accepted:"오늘 완료 알림 Gmail 서버 접수",failed:"완료 알림 실패",outcome_unknown:"완료 알림 접수 여부 미확인 · 중복 방지를 위해 자동 재발송 안 함",reserved:"완료 알림 처리 중"})[r.notification.status]:"오늘 목표 달성 후 한 번 알림")+'</p><div class="health-metrics"><div><span>오늘 확인 처리</span><strong>'+Number(e.processed)+'회</strong></div><div><span>이메일 확보 업체</span><strong>'+Number(e.companies)+'곳</strong></div><div><span>업체 확보율</span><strong>'+(e.companyYield===null?"—":Number(e.companyYield)+"%")+'</strong></div><div><span>오늘 신규 이메일</span><strong>'+Number(e.emails)+'개</strong></div></div><p class="fine">확보율 = 오늘 신규 이메일 확보 업체 ÷ 홈페이지 확인 처리 횟수. 한국시간 기준이며 재확인 처리도 분모에 포함됩니다.</p><div class="health-outcomes"><span>저장된 오늘 확인 기록 '+Number(e.snapshotChecked)+'곳</span><span>접속·처리 오류 '+Number(e.failedSites)+'곳</span><span>일부 페이지 오류 '+Number(e.partialSites)+'곳</span><span>접속 성공·이메일 미발견 '+Number(e.noEmailSites)+'곳</span><span>중복·부적합 자동 제외 '+Number(e.excluded||0)+'곳 (누적)</span></div>'+Object.entries(e.reasons||{}).map(([k,v])=>'<span class="health-reason">'+esc(k)+' '+Number(v)+'곳</span>').join("")+'<p class="fine">제품·개인화 초안 '+Number(research.readyCopies||0)+'곳 완료 · 자동 작성 대기 '+Number(research.pendingCopies||0)+'곳 / 공식 게시 출처 대조 '+Number(research.sourceSupported||0)+'곳 완료 · 추가 자동 조사 '+Number(research.pendingSources||0)+'곳. 출처 대조와 최종 발송 승인은 별개입니다.</p><details class="research-log"><summary>최근 처리 결과·실패 이유</summary>'+(h.recent||[]).map(x=>'<div class="health-event"><strong>'+esc(x.name)+'</strong><span>'+esc(x.status)+' · 이메일 '+Number(x.emails)+'개 · '+Number(x.pages)+'페이지</span><small>'+esc(localTime(x.at))+'</small>'+(x.error?'<p class="error">'+esc(x.error)+'</p>':"")+'</div>').join("")+'</details><p class="fine">유료 검색·자동 작성 AI 호출 0회 · Supabase 청구 금액은 미확인입니다. 오류가 난 업체는 다른 업체의 수집을 막지 않습니다.</p></section>';
}
function discoveryProgress(r) {
  return '<div class="research-status"><span class="status-dot"></span><strong>'+esc(r.engine?.label||"수집 현황 확인 중")+'</strong><span>오늘 확인 '+Number(r.usage.processed||0)+'곳 · 신규 업체 '+Number(r.usage.companies||0)+'곳 · 원문 메일 '+Number(r.usage.emails||0)+'개</span></div><details class="research-log"><summary>최근 수집 내역</summary>'+(r.activity||[]).map(a=>'<div class="task"><strong>'+esc(a.name)+'</strong><span>'+a.emailCount+'개 · '+esc(localTime(a.checked))+'</span>'+(a.error?'<small>'+esc(a.error)+'</small>':'')+'</div>').join("")+'</details>';
}
function discoveryCards(r) {
  const q=($("#mail-filter")?.value||"").trim().toLowerCase();
  const selectedDay=mailDayFilter==="all"?"":kstDay(Date.now()-(mailDayFilter==="yesterday"?86400000:0));
  const rows=r.leads.filter(l=>(!selectedDay||leadDay(l)===selectedDay)&&l.status!=="blocked"&&!l.data.outreach?.sendBlockedReason&&(!discoveryOnlyEmails||l.data.contacts?.length)&&!mailLeadSent(l)&&(!q||(l.data.name+" "+(l.data.contacts||[]).map(c=>c.email).join(" ")).toLowerCase().includes(q)));
  const held=r.leads.filter(l=>l.status!=="blocked"&&l.data.outreach?.sendBlockedReason&&!mailLeadSent(l));
  return '<div class="mail-list">'+rows.map(l=>{
    const c=mailCopy(l),contact=(l.data.contacts||[])[0];
    return '<article class="mail-card"><label class="mail-select"><input type="checkbox" data-mail-select="'+l.id+'" '+(selectedMailLeads.has(l.id)?"checked":"")+' aria-label="'+esc(l.data.name)+' 선택"></label><div class="mail-card-main"><div class="mail-card-top"><h3>'+esc(c.companyName)+'</h3>'+tag(c.sendBlockedReason?"발송 보류 · 사유 보기":c.needsPersonalization?(Number(l.data.research?.attempts||0)>=3?"자동 조사 보류 · 상품 근거 미확인":"상품 조사 대기"):l.data.research?.ownership==="research_pending"?(Number(l.data.research?.attempts||0)>=3?"출처 대조 보류 · 사유 보기":"이메일 게시 출처 자동 대조 대기"):c.prepared?"초안 준비됨":"초안 준비 전",c.prepared&&!c.needsPersonalization&&!c.sendBlockedReason?"":"orange")+'</div><div class="mail-recipient"><strong>'+esc((l.data.contacts||[]).filter(e=>!e.excluded&&!e.excludeFromOutreach).map(e=>e.email).join(", ")||"수신 가능한 이메일 확인 필요")+'</strong>'+(contact?.purpose?'<span>'+esc(contact.purpose)+'</span>':'')+'</div><p class="mail-subject">'+esc(c.subject||"템플릿을 설정하세요")+'</p><p class="mail-intro">'+esc(c.intro||c.productName||"확인한 자료로 제품과 개인화를 준비합니다.")+'</p><details class="mail-inline-copy"><summary>메일 전문 펼쳐보기 · 제목·본문·서명</summary><strong>'+esc(c.subject)+'</strong><div class="mail-letter">'+esc(inlineMailBody(c))+'</div></details><div id="mail-state-'+l.id+'" role="status" aria-live="polite">'+esc(inlineMailState.get(l.id)?.text||"아직 발송하지 않았습니다.")+'</div><details class="mail-evidence"><summary>출처·검토 상태</summary><p>이메일 원문 확인과 회사 소유 관계 승인을 구분합니다. 현재 자동 조사 결과와 최종 발송 승인은 구분합니다.</p>'+(l.data.contacts||[]).map(e=>'<p><strong>'+esc(e.email)+'</strong> · '+esc(e.purpose||"용도 검토 전")+' '+(e.source?'<a href="'+esc(e.source)+'" target="_blank" rel="noopener">원문 ↗</a>':'<span>사용자 제공 자료 · 원문 URL 확인 대기</span>')+'</p>').join("")+(c.evidence||[]).map(e=>'<p><a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.description||"개인화 근거")+' ↗</a></p>').join("")+(l.data.research?.reason?'<p class="fine">자동 조사 결과: '+esc(l.data.research.reason)+'</p>':"")+(l.data.error?'<p class="fine">수집 메모: '+esc(l.data.error)+'</p>':"")+'</details></div><div class="mail-card-action">'+inlineMailButton(l.id)+button("내용 수정","mail-review",l.id)+'</div></article>';
  }).join("")+'</div>'+(rows.length?"":'<div class="panel empty">표시할 업체가 없습니다.</div>')+(held.length?'<details class="panel"><summary>발송 보류 '+held.length+'곳 · 자료를 추가 확인해야 하는 업체</summary>'+held.map(l=>'<p><strong>'+esc(l.data.name)+'</strong> · '+esc(l.data.outreach.sendBlockedReason.replace(/^전체 초안 검수: /,""))+'</p>').join("")+'</details>':"");
}
function sentMailCards() {
  const rows=sentMailRows();
  return '<div class="mail-list">'+rows.map(o=>{
    const c=candidate(o.target),thread=data.threads.find(t=>t.target===o.target&&t.channel==="email"),copy=o.data?.sentCopy||o.data;
    const old=thread?.messages.filter(m=>m.out).sort((a,b)=>Math.abs(Date.parse(a.at)-Date.parse(o.created))-Math.abs(Date.parse(b.at)-Date.parse(o.created)))[0];
    return '<article class="panel sent-card"><div class="mail-card-top"><h3>'+esc(c?.name||"발송 대상")+'</h3>'+tag("Gmail 서버 접수")+'</div><p class="fine">'+esc(copy?.emails?.join(", ")||copy?.email||c?.contact?.email||"")+" · "+esc(localTime(o.created))+'</p><details><summary>'+esc(copy?.subject||thread?.subject||"보낸 메일")+'</summary><div class="mail-letter">'+esc(copy?.body||old?.text||"보낸 원문은 대화함에서 동기화해 확인하세요.")+'</div></details><p class="fine">받은편지함 도착·열람 미확인 · Gmail API 발송에는 Mailsuite 확장 프로그램 추적이 자동 적용되지 않습니다.</p>'+(thread?button("대화·답장 보기","mail-open-thread",thread.id):"")+'</article>';
  }).join("")+'</div>'+(rows.length?"":'<div class="panel empty"><h3>아직 보낸 영업 메일이 없습니다</h3><p>승인 후 실제 Gmail 서버가 접수한 메일만 여기에 표시됩니다.</p></div>');
}
async function discoveryPage() {
  clearTimeout(discoveryRefresh);
  $("#app").innerHTML=head("브랜드 이메일","업체별로 준비된 제안을 확인하고, 승인한 메일만 보내세요.")+'<div class="panel">메일 목록을 불러오는 중…</div>';
  try {
    const r=await api("/discovery");discoveryView=r;
    const yesterday=historyCount(r,1),today=historyCount(r,0);
    const ready=r.leads.filter(l=>l.status!=="blocked"&&l.data.contacts?.length&&!mailLeadSent(l)),emails=new Set(r.leads.flatMap(l=>(l.data.contacts||[]).map(c=>c.email.toLowerCase())));
    $("#app").innerHTML=head("브랜드 이메일","업체별 제안 확인부터 발송 승인까지 한곳에서 진행하세요.",'<a class="text-link" href="#templates">공통 템플릿 설정 ↗</a>')+
    '<div class="mail-overview"><div><span>발송 전</span><strong><span id="mail-pending-count">'+ready.length+'</span><small>업체</small></strong></div><div><span>어제 이메일 확보 · '+esc(yesterday.day.slice(5))+'</span><strong><span id="mail-yesterday-companies">'+Number(yesterday.companies)+'</span><small>곳</small></strong></div><div><span>오늘 이메일 확보 · '+esc(today.day.slice(5))+'</span><strong><span id="mail-today-companies">'+Number(today.companies)+'</span><small>/ '+r.settings.target+'곳</small></strong></div><div><span>보낸 메일</span><strong><span id="mail-sent-count">'+sentMailRows().length+'</span><small>통</small></strong></div></div><div class="daily-discovery-line"><span class="status-dot"></span> 매일 00:00 KST · 검색 후보 자동 보충 · 신규 '+r.settings.target+'곳 목표 <span>이메일 '+emails.size+'개 확보</span></div><div id="search-refill-status" class="fine">'+searchSummary(r)+'</div>'+
    '<div id="discovery-health">'+discoveryHealthPanel(r)+'</div>'+discoveryHistory(r)+'<div class="mail-workspace"><div class="mail-toolbar"><div class="mail-tabs" role="tablist">'+button("발송 전","brand-tab","pending",brandTab==="pending")+button("보낸 메일","brand-tab","sent",brandTab==="sent")+'</div>'+(brandTab==="pending"?'<div class="actions mail-filter-actions"><div class="day-filters">'+button("전체","mail-day","all",mailDayFilter==="all")+button("어제","mail-day","yesterday",mailDayFilter==="yesterday")+button("오늘","mail-day","today",mailDayFilter==="today")+'</div><input id="mail-filter" class="search" placeholder="업체·이메일 검색" aria-label="업체·이메일 검색">'+button("현재 목록 전체 선택","mail-select-all")+button("선택 해제","mail-select-none")+button("선택한 메일 지금 보내기","mail-review-selected","",true)+'</div>':"")+'</div>'+
    '<div id="inline-mail-summary" class="notice" role="status" aria-live="polite">'+esc(inlineMailStatus())+'</div><div id="discovery-results">'+(brandTab==="sent"?sentMailCards():discoveryCards(r))+'</div></div>'+
    '<details class="panel mail-advanced"><summary>수집 현황·운영 설정</summary><div id="discovery-progress">'+discoveryProgress(r)+'</div><div class="actions">'+button("새로고침","discovery-refresh")+button("다음 업체 수집","discovery-run")+button(discoveryOnlyEmails?"메일 미확보 업체도 보기":"이메일 있는 업체만 보기","discovery-filter")+'</div><form id="discovery-settings" class="form-grid">'+field("target","하루 신규 업체 목표",r.settings.target,"number")+field("enabled","자동 수집 켜짐",r.settings.enabled,"checkbox")+field("notifyCompletion","목표 달성 시 관리자 이메일로 완료 알림",r.settings.notify_completion,"checkbox")+'<input name="keywords" type="hidden" value="'+esc(r.settings.keywords.join("\n"))+'"><button type="submit">설정 저장</button></form><details><summary>홈페이지 직접 추가</summary><form id="discovery-seed" class="form-grid">'+field("name","업체명","")+field("url","공개 홈페이지 URL","","url")+'<button type="submit">추가</button></form></details><p class="fine">화면 현황은 30초마다 갱신됩니다. Google·네이버·Bing·DuckDuckGo의 공개 검색 결과를 순차 확인합니다. 보안문자·차단은 우회하지 않으며, 검색어 회전과 재보충은 하루 64개 검색어 이내로 진행합니다. 유료 검색·AI API는 사용하지 않습니다. Supabase 실제 사용료는 청구 화면에서 확인해야 합니다.</p></details>';
    scheduleDiscoveryRefresh();
  } catch(e) {if(e.status===404){candidatesPage("brand");return;}$("#app").innerHTML=head("브랜드 이메일","")+'<div class="error">'+esc(e.message)+'</div>';}
}
function scheduleDiscoveryRefresh() {
  clearTimeout(discoveryRefresh);
  discoveryRefresh=setTimeout(async()=>{
    if(!me||!["brands","discovery"].includes(location.hash.slice(1)))return;
    try {
      const r=await api("/discovery"),editing=$("#modal").open||document.activeElement?.closest("form");
      if($("#discovery-health"))$("#discovery-health").innerHTML=discoveryHealthPanel(r);if($("#discovery-progress"))$("#discovery-progress").innerHTML=discoveryProgress(r);if($("#search-refill-status"))$("#search-refill-status").innerHTML=searchSummary(r);
      if($("#mail-today-companies"))$("#mail-today-companies").textContent=historyCount(r,0).companies;if($("#mail-yesterday-companies"))$("#mail-yesterday-companies").textContent=historyCount(r,1).companies;
      if(!editing){discoveryView=r;data=await api("/state");if($("#mail-pending-count"))$("#mail-pending-count").textContent=r.leads.filter(l=>l.status!=="blocked"&&l.data.contacts?.length&&!mailLeadSent(l)).length;if($("#mail-sent-count"))$("#mail-sent-count").textContent=sentMailRows().length;if($("#discovery-results"))$("#discovery-results").innerHTML=brandTab==="sent"?sentMailCards():discoveryCards(r);}
    }catch(e){toast("현황 갱신 실패: "+e.message);}
    scheduleDiscoveryRefresh();
  },30000);
}
function mailReview(ids) {
  const leads=ids.map(id=>discoveryView?.leads.find(l=>l.id===id)).filter(Boolean);
  if(!leads.length)return toast("검토할 업체를 선택하세요.");
  close();bulkPreviews=[];
  modal('<div class="review-heading"><span class="eyebrow">EMAIL REVIEW</span><h2>제안 메일 검토</h2><p>업체 '+leads.length+'곳 · 저장만으로는 발송되지 않습니다.</p></div><form id="mail-review-form"><div class="actions">'+button("표시된 업체 소유 관계 일괄 확인","mail-ownership-all")+'</div>'+leads.map(l=>{
    const c=mailCopy(l),contacts=(l.data.contacts||[]).filter(e=>!e.excluded&&!e.excludeFromOutreach);
    return '<section class="mail-review-item" data-lead="'+l.id+'" data-template-id="'+esc(c.templateId||"")+'" data-template-version="'+esc(c.templateVersion||"")+'"><div class="mail-card-top"><h3>'+esc(c.companyName)+'</h3>'+tag("발송 전")+'</div>'+(c.sendBlockedReason?'<p class="notice">자동 조사 보류: '+esc(c.sendBlockedReason)+'</p>':"")+(c.uncertainty?'<p class="notice">'+esc(c.uncertainty)+'</p>':"")+'<div class="form-grid"><label class="field">받는 주소 · 업체당 한 통<input name="email" type="hidden" value="'+esc(contacts[0]?.email||"")+'"><div class="recipient-list">'+contacts.filter(e=>!e.excluded&&!e.excludeFromOutreach).map(e=>'<span>'+esc(e.email)+'</span>').join("")+'</div></label><input name="companyName" type="hidden" value="'+esc(c.companyName)+'">' +field("productName","제안 제품·제품군",c.productName)+field("source","직접 확인한 이메일 원문 URL",contacts[0]?.source||"","url")+'</div>'+field("subject","제목",c.subject)+field("body","업체명·개인화가 반영된 본문",c.body,"textarea")+field("signature","서명",c.signature,"textarea")+'<details class="mail-evidence"><summary>개인화 작성 근거</summary>'+(c.evidence||[]).map(e=>'<p><a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.description||"공개 자료")+' ↗</a>'+(e.quote?'<blockquote>'+esc(e.quote)+'</blockquote>':"")+'</p>').join("")+'</details><label class="review-check"><input name="ownership" type="checkbox" '+(l.data.research?.ownership==="source_supported"?"checked":"")+'> 공개 원문·대상 회사 대조 결과를 확인했습니다.</label></section>';
  }).join("")+'<div class="review-footer">'+'<details><summary>추가 발송 설정</summary>'+field("marketing","광고성 판매·홍보 메일에 해당함",false,"checkbox")+'</details>'+'<label class="field">첨부파일 (최대 5개·파일당 2MB·합계 5MB)<input name="attachments" type="file" multiple></label><div class="actions">'+button("초안 저장","mail-save")+'<button type="submit" class="primary">최종 발송 내용 확인</button></div></div></form><div id="mail-final"></div>');
}
function mailReviewValues(section) {
  const get=n=>section.querySelector('[name="'+n+'"]').value;
  return {id:section.dataset.lead,templateId:section.dataset.templateId||undefined,templateVersion:section.dataset.templateVersion?Number(section.dataset.templateVersion):undefined,email:get("email"),companyName:get("companyName"),productName:get("productName"),source:get("source"),subject:get("subject"),body:get("body"),signature:get("signature"),ownership:section.querySelector("[name=ownership]").checked};
}
function inlineMailBody(c){
 const norm=v=>String(v||"").replace(/\r\n?/g,"\n").trim();let text=norm(c.body),sig=norm(c.signature);if(sig&&!text.includes(sig))text+=(text?"\n\n":"")+sig;
 const name=norm(data.settings.senderName),address=norm(data.settings.senderAddress),phone=norm(data.settings.senderPhone),parts=name.split(/[·•|]/).map(s=>s.trim()).filter(Boolean),lines=[];
 if(name&&(!parts.length||!parts.every(s=>text.includes(s))))lines.push(name);if(address&&!text.includes(address))lines.push(address);if(phone&&!text.replace(/[\s()-]/g,"").includes(phone.replace(/[\s()-]/g,"")))lines.push(phone);
 text=text.replace(/(?:\n\s*)?회신으로 수신 거부를 요청하실 수 있습니다\./g,"").trim();return text+(lines.length?"\n\n"+lines.join("\n"):"");
}
function inlineMailButton(id){
 const state=inlineMailState.get(id);if(!state)return button("이 메일 지금 보내기","mail-direct-send",id,true);
 return '<button class="primary" disabled data-send-finished="true" data-action="mail-direct-send" data-id="'+esc(id)+'">'+esc(state.phase==="accepted"?"Gmail 서버 접수":state.phase==="error"?"결과 확인 필요":"전송 중…")+'</button>';
}
function inlineMailStatus(){
 const rows=[...inlineMailState.values()],done=rows.filter(s=>s.phase==="accepted").length,errors=rows.filter(s=>s.phase==="error").length,waiting=rows.length-done-errors;
 return rows.length?(inlineMailBusy?"전송 중":"전송 처리 완료")+" · Gmail 서버 접수 "+done+"건 · 오류·확인 필요 "+errors+"건 · 남은 "+waiting+"건. 수신함 도착은 미확인입니다.":"본문은 아래에서 펼쳐 확인하세요. 보내기 버튼을 누르면 표시된 수신자·제목·본문으로 전송합니다.";
}
function updateInlineMail(id,phase,text){
 inlineMailState.set(id,{phase,text});const el=document.getElementById("mail-state-"+id);if(el)el.textContent=text;
 const summary=$("#inline-mail-summary");if(summary)summary.textContent=inlineMailStatus();
 for(const b of document.querySelectorAll('[data-action="mail-direct-send"]'))if(b.dataset.id===id){b.disabled=true;b.dataset.sendFinished="true";b.textContent=phase==="accepted"?"Gmail 서버 접수":phase==="error"?"결과 확인 필요":"전송 중…";}
}
async function sendInlineMails(ids){
 if(inlineMailBusy)return toast("선택한 메일을 전송하고 있습니다. 목록에서 진행 상황을 확인하세요.");
 const items=[...new Set(ids)].map(id=>discoveryView?.leads.find(l=>l.id===id)).filter(l=>l&&l.status!=="blocked"&&!mailLeadSent(l)&&!inlineMailState.has(l.id)&&!l.data.outreach?.sendBlockedReason&&!l.data.outreach?.needsPersonalization&&l.data.outreach?.body);
 if(!items.length)return toast("발송할 새 초안을 선택하세요. 처리한 메일·보류 업체는 다시 보내지 않습니다.");
 // Snapshot exactly what the user approved on the main list. Never replace it with later copy.
 const queue=items.map(l=>({lead:l,copy:{...mailCopy(l)},body:inlineMailBody(mailCopy(l)),emails:(l.data.contacts||[]).filter(c=>!c.excluded&&!c.excludeFromOutreach).map(c=>c.email.toLowerCase()).sort()}));
 inlineMailBusy=true;for(const item of queue)updateInlineMail(item.lead.id,"queued","발송 대기 · 이번 버튼 클릭으로 승인한 메일");
 let cursor=0;
 const worker=async()=>{while(cursor<queue.length){const item=queue[cursor++],l=item.lead,c=item.copy;
  try{
   updateInlineMail(l.id,"processing","전송 중… 이 업체의 수신자·본문을 확인하고 있습니다.");
   const contact=(l.data.contacts||[]).find(e=>!e.excluded&&!e.excludeFromOutreach);if(!contact)throw Error("발송할 이메일이 없습니다.");
   const prepared=await api("/discovery/prepare-contact","POST",{id:l.id,email:contact.email,source:contact.source||"",approved:true,expectedCopy:{subject:c.subject,body:c.body,signature:c.signature,templateVersion:c.templateVersion}});
   if(c.templateVersion&&prepared.templateVersion&&c.templateVersion!==prepared.templateVersion)throw Error("템플릿이 변경됐습니다. 새로고침 후 내용을 다시 확인하세요.");
   const draft=await api("/drafts","POST",{target:prepared.candidateId,channel:"email",recipientMode:"company_all",dealIds:[],subject:c.subject,body:c.body,signature:c.signature,templateId:prepared.templateId||c.templateId,templateVersion:prepared.templateVersion||c.templateVersion,lawfulBasis:"",marketing:false,attachments:[]});
   const actual=(draft.emails||[draft.email]).map(e=>e.toLowerCase()).sort();
   if(draft.subject!==c.subject||draft.body.replace(/\r\n?/g,"\n").trim()!==item.body||JSON.stringify(actual)!==JSON.stringify(item.emails))throw Error("수신자 또는 최종 본문이 화면 내용과 달라 발송하지 않았습니다. 새로고침 후 확인하세요.");
   updateInlineMail(l.id,"processing","Gmail로 전송 중… 다시 누르지 마세요.");
   await api("/drafts/"+draft.id+"/send","POST",{hash:draft.hash,approved:true});
   updateInlineMail(l.id,"accepted","✓ Gmail 서버 접수 · "+new Date().toLocaleTimeString("ko-KR")+" · 수신함 도착은 미확인");selectedMailLeads.delete(l.id);
  }catch(e){updateInlineMail(l.id,"error","오류·확인 필요: "+e.message+" · 자동 재시도하지 않습니다.");}
 }};
 try{await Promise.all(Array.from({length:Math.min(3,queue.length)},()=>worker()));}
 finally{inlineMailBusy=false;const summary=$("#inline-mail-summary");if(summary)summary.textContent=inlineMailStatus();try{data=await api("/state");}catch{}toast(inlineMailStatus());}
}
async function quickMailReview(ids){
 const eligible=ids.filter(id=>{const l=discoveryView?.leads.find(l=>l.id===id);return l&&!l.data.outreach?.sendBlockedReason;});
 if(!eligible.length)return toast("보낼 수 있는 초안이 없습니다. 상품 또는 이메일 미확인 업체는 제외됩니다.");
 mailReview(eligible);const form=$("#mail-review-form");if(!form)return;
 const progress=document.createElement("p");progress.id="mail-preparing";progress.setAttribute("role","status");progress.textContent="수신자·최종 메일 준비 중… 아직 발송되지 않았습니다.";form.before(progress);
 form.hidden=true;
 for(const checkbox of form.querySelectorAll("[name=ownership]"))checkbox.checked=true;
 try{await prepareMailReview(form);progress.textContent="수신자와 최종 내용을 확인하고 아래 발송 버튼을 누르세요. 아직 발송되지 않았습니다.";}
 catch(e){progress.textContent="준비 실패: "+e.message;form.hidden=false;}
}
async function saveMailReview() {
  for(const section of $$("#mail-review-form [data-lead]"))await api("/discovery/outreach","POST",mailReviewValues(section));
  toast("업체별 초안을 저장했습니다. 발송되지 않았습니다.");
}
async function prepareMailReview(form) {
  bulkPreviews=[];$("#mail-final").innerHTML="";
  const f=new FormData(form),attachments=[];let total=0;
  for(const file of form.querySelector("[name=attachments]").files){
    total+=file.size;if(file.size>2*1024*1024||total>5*1024*1024||attachments.length>=5)throw Error("첨부는 최대 5개·파일당 2MB·합계 5MB입니다.");
    let bytes="";for(const byte of new Uint8Array(await file.arrayBuffer()))bytes+=String.fromCharCode(byte);
    attachments.push({name:file.name,content:btoa(bytes)});
  }
  const errors=[];
  for(const section of form.querySelectorAll("[data-lead]")){
    const v=mailReviewValues(section),l=discoveryView.leads.find(l=>l.id===v.id);
    try {
      if(l.data.outreach?.sendBlockedReason)throw Error(l.data.outreach.sendBlockedReason);
      await api("/discovery/outreach","POST",v);
      if(!v.ownership)throw Error("이메일 소유 관계 확인이 필요합니다.");
      if(!v.companyName.trim())throw Error("업체명을 확인해 주세요.");
      if(!v.productName.trim())throw Error("제안 제품·제품군을 확인해 주세요.");
      if(f.has("marketing")&&!v.subject.startsWith("(광고)"))throw Error("제목에 (광고) 표시를 추가해 주세요.");
      if(f.has("marketing")&&!data.settings.senderAddress)throw Error("광고성 메일은 발신자 사업장 주소가 필요합니다.");
      const prepared=await api("/discovery/prepare-contact","POST",{id:v.id,email:v.email,source:v.source,approved:true});
      const id=prepared.candidateId;
      if(!id)throw Error("업체 저장 결과를 확인할 수 없습니다.");
      const p=await api("/drafts","POST",{target:id,channel:"email",recipientMode:"company_all",dealIds:[],subject:v.subject,body:v.body,signature:v.signature,templateId:prepared.templateId,templateVersion:prepared.templateVersion,lawfulBasis:f.get("lawfulBasis")||"",marketing:f.has("marketing"),attachments});
      bulkPreviews.push({...p,candidateId:id});
    }catch(e){errors.push(l.data.name+": "+e.message);}
  }
  $("#mail-final").innerHTML='<h3>최종 발송 내용</h3>'+errors.map(e=>'<p class="error">'+esc(e)+'</p>').join("")+bulkPreviews.map((p,i)=>'<article class="panel"><h3>'+esc(p.target)+'</h3><p class="fine">받는 주소: '+esc((p.emails||[p.email]).join(", "))+'</p><strong>'+esc(p.subject)+'</strong><div class="mail-letter">'+esc(p.body)+'</div><p class="fine">첨부: '+esc(p.attachments.map(a=>a.name).join(", ")||"없음")+'</p><label class="review-check"><input name="bulk-approve" type="checkbox" checked value="'+i+'"> 이 메일을 전송 대상에 포함</label><div id="bulk-result-'+i+'" role="status"></div></article>').join("")+(bulkPreviews.length?'<label class="review-check"><input id="mail-approve-all" type="checkbox" checked> 위 '+bulkPreviews.length+'개 메일을 모두 전송 대상에 포함</label><div class="actions">'+button("선택한 메일 승인·지금 보내기","mail-send-all","",true)+'</div><p class="fine">15분 안에 승인하세요. 내용을 수정하면 다시 확인해야 합니다.</p><label class="field">예약 시각<input id="bulk-run-at" type="datetime-local"></label>'+button("승인한 메일 예약","mail-schedule","",true):"");
}
function invalidateMailReview(){if($("#mail-final")){$("#mail-final").innerHTML='<p class="fine">내용이 변경되었습니다. 최종 발송 내용을 다시 확인하세요.</p>';bulkPreviews=[];}}

let bulkPreviews = [], bulkTemplateId = "", bulkSending = false;
async function bulkSendNow(){
 if(bulkSending)return;
 const checked=$$("#mail-final [name=bulk-approve]:checked:not(:disabled)");
 if(!checked.length)throw Error("최종 메일을 확인한 뒤 일괄 승인 또는 개별 승인하세요.");
 const entries=checked.map(check=>({check,index:Number(check.value),preview:bulkPreviews[Number(check.value)],result:$("#bulk-result-"+check.value)}));
 bulkSending=true;
 let summary=$("#mail-send-summary");if(!summary){summary=document.createElement("div");summary.id="mail-send-summary";summary.setAttribute("role","status");summary.className="notice";$("#mail-final").prepend(summary);}
 summary.textContent="전송 중 · 0 / "+entries.length+"건";
 const controls=$$("#mail-final button, #mail-final input");controls.forEach(e=>{e.disabled=true;if(e.dataset.action==="mail-send-all")e.textContent="전송 중…";});
 let accepted=0,failed=0;
 try{
  for(const entry of entries){
   const {check,preview:p,result}=entry;if(!p)continue;
   if(result)result.textContent="전송 중… 완료될 때까지 다시 누르지 마세요.";
   try{const r=await api("/drafts/"+p.id+"/send","POST",{hash:p.hash,approved:true});
    if(result)result.textContent="✓ Gmail 서버 접수 · "+new Date().toLocaleTimeString("ko-KR")+" · 수신함 도착은 미확인";accepted++;
   }catch(e){failed++;if(result)result.textContent="발송 오류 · "+e.message+" · 자동 재시도하지 않습니다.";}
   check.checked=false;check.dataset.attempted="true";
   summary.textContent="처리 중 · "+(accepted+failed)+" / "+entries.length+"건 · 서버 접수 "+accepted+"건 · 오류·확인 필요 "+failed+"건";
  }
  summary.textContent="전송 처리 완료 · Gmail 서버 접수 "+accepted+"건 · 오류·확인 필요 "+failed+"건. 접수된 메일은 보낸 메일 탭에서 확인하세요. 수신함 도착은 미확인입니다.";
  try{data=await api("/state");}catch{summary.textContent+=" 목록 갱신에 실패했습니다. 결과를 확인하고 재발송하지 마세요.";}
  toast("Gmail 서버 접수 "+accepted+"건 · 오류·확인 필요 "+failed+"건");
 }finally{bulkSending=false;controls.forEach(e=>{e.disabled=e.dataset.attempted==="true"||e.dataset.action==="mail-send-all";if(e.dataset.action==="mail-send-all"){e.dataset.sendFinished="true";e.textContent="전송 처리 완료 · 결과를 확인하세요";}});}
}
function bulkCompose() {
  close(); bulkPreviews = [];
  const templates = data.templates.filter(t => t.channel === "이메일");
  if (!templates.length) return toast("템플릿 화면에 이메일 공통 카피를 먼저 저장하세요.");
  const targets = data.candidates.filter(c => c.kind !== "크리에이터" && c.contact?.verified && c.contact.email && !["거절", "수신 거부"].includes(c.status) && !data.outbox.some(o => o.target === c.id) && !data.threads.some(t => t.target === c.id));
  bulkTemplateId = templates[0].id;
  modal(`<h2>브랜드 이메일 일괄 작성</h2><p class="notice">수신자별 최종 제목·본문을 먼저 만듭니다. 미리보기만으로는 발송되지 않습니다. 마지막에 직접 승인한 메일만 예약합니다. 기존 연락·거절·수신 거부 대상은 제외합니다.</p>form id="bulk-compose-form"><label class="field">공통 템플릿<select name="templateId" id="bulk-template">${templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label><div id="bulk-copy-fields"></div><details><summary>추가 발송 설정</summary>${field("marketing", "광고성 판매·홍보 메일에 해당함", false, "checkbox")}</details><h3>수신자 선택·개인화 1~2문장</h3><p class="fine">개인화는 공통 본문의 {{개인화}} 위치에만 들어갑니다.</p>${targets.map(c => `<article class="panel"><label><input type="checkbox" name="bulk-target" value="${c.id}"> <strong>${esc(c.name)}</strong> · ${esc(c.contact.email)}</label><p class="fine">제품: ${esc(c.product || "미입력 · 브랜드 상세에서 실제 제품명 입력 필요")}</p>${field("intro-" + c.id, "눈여겨본 제품 특징 / 콘텐츠·팬층과 맞는 이유 · 근거가 확인된 사실만", "", "textarea")}${connections.ai?.configured ? button("이 업체 개인화 2문장 제안", "bulk-personalize", c.id) : '<p class="fine">AI 미연결 · 개인화 문장을 직접 입력하세요.</p>'}</article>`).join("") || '<p class="notice">선택 가능한 등록 브랜드가 없습니다. 발굴 목록에서 이메일 출처·소유 관계를 검토해 브랜드로 등록하세요.</p>'}<label class="field">공통 첨부파일 (파일당 2MB·최대 5개·합계 5MB)<input name="attachments" type="file" multiple></label><button type="submit" class="primary">선택한 수신자별 최종 메일 미리보기</button></form><div id="bulk-previews"></div>`);
  applyBulkTemplate();
}
function applyBulkTemplate() {
  bulkTemplateId = $("#bulk-template").value;
  const t = data.templates.find(t => t.id === bulkTemplateId);
  $("#bulk-copy-fields").innerHTML = field("subject", "공통 제목", t.subject) + field("body", "공통 본문 · 저장된 카피 그대로", t.body, "textarea") + field("signature", "서명", t.signature, "textarea");
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
      const p = await api("/drafts", "POST", {target,dealIds:[],channel:"email",subject:f.get("subject"),body,signature:f.get("signature"),lawfulBasis:f.get("lawfulBasis")||"",marketing:f.has("marketing"),attachments});
      bulkPreviews.push({...p,candidateId:target});
    } catch(e) { errors.push({name:targetName(target),error:e.message}); }
  }
  $("#bulk-previews").innerHTML = `<h3>최종 메일 ${bulkPreviews.length}건 · 생성 실패 ${errors.length}건</h3><p class="notice">각 메일을 펼쳐 수신자·제목·본문·첨부를 확인하고 개별 체크하세요. 15분 안에 승인해야 합니다. 위 내용을 수정하면 모든 미리보기 승인이 해제됩니다.</p>${errors.map(e => `<p class="error">${esc(e.name)}: ${esc(e.error)}</p>`).join("")}${bulkPreviews.map((p,i) => `<article class="panel"><details open><summary>${esc(p.target)} · ${esc(p.email)}</summary><div class="preview">${esc("수신: " + p.email + "\n제목: " + p.subject + "\n\n" + p.body + "\n\n첨부: " + (p.attachments.map(a => a.name).join(", ") || "없음"))}</div></details><label><input type="checkbox" name="bulk-approve" value="${i}"> 이 수신자·최종 내용·첨부를 확인하고 발송을 승인합니다.</label><div id="bulk-result-${i}" role="status"></div></article>`).join("")}${bulkPreviews.length ? `<label class="field">예약 시각 · 기기 시간 기준 · 광고성 이메일은 한국시간 08~21시<input id="bulk-run-at" type="datetime-local"></label><p class="fine">선택한 시각 이후 5분 간격 실행기가 승인한 건만 순서대로 발송합니다. 중복·수신 거부를 다시 검사하며 실패 건은 자동 재발송하지 않습니다.</p>${button("체크한 메일만 승인·일괄 예약", "bulk-schedule", "", true)}` : ""}`;
}
async function bulkSchedule() {
  const checked = $$("[name=bulk-approve]:checked:not(:disabled)");
  if (!checked.length) throw Error("최종 메일을 확인한 뒤 수신자별 승인 체크를 하세요.");
  const value = $("#bulk-run-at")?.value, time = new Date(value);
  if (!value || !Number.isFinite(time.getTime()) || time.getTime() < Date.now()) throw Error("미래 예약 시각을 선택하세요.");
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
    if (form.id === "mail-review-form") { await prepareMailReview(form); return; }
    if (form.id === "bulk-compose-form") { await bulkPrepare(form); return; }
    if (form.id.startsWith("discovery-")) {
      if (form.dataset.discoveryRequeue) await api("/discovery/requeue", "POST", {id:fid,url:f.url});
      else if (form.dataset.discoveryImport) await api("/discovery/import", "POST", { id:fid, email:f.email, company:f.company, source:f.source || "", approved:f.approved === "on" });
      else if (form.id === "discovery-settings") await api("/discovery/settings", "POST", { target:Number(f.target), enabled:f.enabled === "on", notifyCompletion:f.notifyCompletion === "on", keywords:f.keywords.split(/\r?\n/).filter(Boolean) });
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
      await api("/settings", "PUT", f);
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
  "mail-review": id => mailReview([id]),
  "mail-day": async day => {mailDayFilter=day;await discoveryPage();},
  "mail-review-selected": () => sendInlineMails([...selectedMailLeads]),
  "mail-direct-send": id => sendInlineMails([id]),
  "mail-quick-review": id => quickMailReview([id]),
  "mail-save": saveMailReview,
  "mail-schedule": bulkSchedule,
  "mail-send-all": bulkSendNow,
  "mail-select-all": () => {const boxes=$$("#discovery-results [data-mail-select]");for(const e of boxes){const l=discoveryView.leads.find(l=>l.id===e.dataset.mailSelect);if(!l?.data.contacts?.length||l.data.outreach?.sendBlockedReason)continue;e.checked=true;selectedMailLeads.add(e.dataset.mailSelect);}toast(selectedMailLeads.size+"개 업체 선택 · 대상 회사 확인이 필요한 업체는 제외했습니다.");},
  "mail-select-none": () => {selectedMailLeads.clear();$$("[data-mail-select]").forEach(e=>e.checked=false);},
  "mail-ownership-all": () => { $$("#mail-review-form [name=ownership]").forEach(e=>{const l=discoveryView.leads.find(l=>l.id===e.closest("[data-lead]").dataset.lead);if(!l?.data.outreach?.sendBlockedReason)e.checked=true;});invalidateMailReview();toast("소유 관계를 일괄 확인했습니다. 최종 내용 검토 후 별도로 발송 승인하세요.");},
  "mail-settings": () => { close(); location.hash="settings"; },
  "mail-open-thread": id => { selectedThread=id; location.hash="inbox"; },
  "discovery-refresh": discoveryPage,
  "brand-tab": async (tab) => { brandTab = tab; await discoveryPage(); },
  "discovery-run": async () => { const r = await api("/discovery/run", "POST", {}); await discoveryPage(); toast(r.message || `신규 업체 ${r.added || 0}곳 · 이메일 후보 ${r.emailCandidatesAdded || 0}개 · 검토 ${r.processed || 0}곳`); },
  "discovery-filter": async () => { discoveryOnlyEmails = !discoveryOnlyEmails; await discoveryPage(); },

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
  "connect-instagram-basic": async () =>
    location.assign((await api("/oauth/instagram", "POST", {profileOnly:true})).url),
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
  "check-instagram": async key => {
    const el=$("#instagram-check-result");if(el)el.textContent="계정·대화 권한 확인 중…";
    const r=await api("/instagram/check","POST",{key});await reload();toast(r.requiresLogin?r.message:"Instagram 계정 조회 완료 · 대화/웹훅 상태를 확인하세요.");
  },
  "subscribe-instagram": async key => {const r=await api("/instagram/subscribe","POST",{key});await reload();toast(r.webhookSubscribed?"메시지 웹훅 구독 완료":"웹훅 상태를 확인하세요.");},
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
    b.disabled = b.dataset.sendFinished === "true";
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
  if (e.target.closest("#mail-review-form")) invalidateMailReview();
  if (e.target.closest("#bulk-compose-form")) invalidateBulk();
  if (
    ["candidate-filter", "status-filter", "category-filter"].includes(
      e.target.id,
    )
  )
    filterCandidates();
  if (["thread-filter", "thread-type"].includes(e.target.id)) filterThreads();
  if (e.target.id === "mail-filter" && discoveryView) $("#discovery-results").innerHTML=discoveryCards(discoveryView);
});
document.addEventListener("change", (e) => {
  if(e.target.id==="mail-approve-all") $$("#mail-final [name=bulk-approve]:not(:disabled)").forEach(c=>c.checked=e.target.checked);
  if(e.target.name==="bulk-approve"&&$("#mail-approve-all")){const all=$$("#mail-final [name=bulk-approve]:not(:disabled)");$("#mail-approve-all").checked=!!all.length&&all.every(c=>c.checked);}

  if (e.target.closest("#compose-form")) invalidatePreview();
  if (e.target.closest("#mail-review-form")) invalidateMailReview();
  if (e.target.closest("#bulk-compose-form")) invalidateBulk();
  if (e.target.dataset.mailSelect) { if(e.target.checked)selectedMailLeads.add(e.target.dataset.mailSelect);else selectedMailLeads.delete(e.target.dataset.mailSelect); }
  if (e.target.id === "bulk-template") applyBulkTemplate();
  if (e.target.id === "match-direction") updateMatchOptions();
  if (e.target.id === "match-target") showMatches();
  if (["status-filter", "category-filter"].includes(e.target.id))
    filterCandidates();
  if (e.target.id === "thread-type") filterThreads();
  if (e.target.id === "mail-filter" && discoveryView) $("#discovery-results").innerHTML=discoveryCards(discoveryView);
});
window.addEventListener("hashchange", () => {
  render();
});
boot();
