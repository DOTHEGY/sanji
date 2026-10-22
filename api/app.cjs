const express = require("express"),
  helmet = require("helmet"),
  { rateLimit } = require("express-rate-limit"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const {
    openDatabase,
    id,
    now,
    hash,
    passwordHash,
    passwordValid,
    vault,
  } = require("./db.cjs"),
  schemas = require("./schema.cjs"),
  { request, mime, bodyText, headers } = require("./providers.cjs");
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || "")),
    bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function createApp(config = {}) {
  const cfg = {
    base:
      process.env.APP_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      "http://localhost:3000",
    data: process.env.DATA_DIR || path.join(__dirname, "../private/data"),
    key: process.env.SANJI_ENCRYPTION_KEY,
    setup: process.env.SANJI_SETUP_TOKEN,
    emailEnabled: process.env.EMAIL_SENDING_ENABLED === "true",
    instagramEnabled: process.env.INSTAGRAM_SENDING_ENABLED === "true",
    ...config,
  };
  const prod = process.env.NODE_ENV === "production";
  if (prod && (!cfg.key || !cfg.setup || !cfg.base.startsWith("https://")))
    throw Error(
      "Production requires APP_URL HTTPS, SANJI_ENCRYPTION_KEY and SANJI_SETUP_TOKEN",
    );
  fs.mkdirSync(cfg.data, { recursive: true, mode: 0o700 });
  if (!cfg.key) {
    const p = path.join(cfg.data, "encryption.key");
    if (!fs.existsSync(p))
      fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), {
        mode: 0o600,
      });
    cfg.key = fs.readFileSync(p, "utf8");
  }
  if (!cfg.setup) {
    const p = path.join(cfg.data, "setup.token");
    if (!fs.existsSync(p))
      fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), {
        mode: 0o600,
      });
    cfg.setup = fs.readFileSync(p, "utf8");
  }
  const providerRequest = cfg.request || request;
  const db = openDatabase(path.join(cfg.data, "sanji.sqlite")),
    crypt = vault(cfg.key),
    app = express();
  app.set("trust proxy", prod ? 1 : false);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: prod ? [] : null,
        },
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  db.prepare("DELETE FROM drafts WHERE expires<?").run(Date.now() - 86400000);
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  db.prepare("DELETE FROM oauth_states WHERE expires<?").run(Date.now());
  const audit = (u, action, data = {}) =>
    db
      .prepare("INSERT INTO audit(user_id,action,data,created) VALUES(?,?,?,?)")
      .run(u, action, JSON.stringify(data), now());
  const list = (u, kind) =>
    db
      .prepare(
        "SELECT * FROM records WHERE user_id=? AND kind=? ORDER BY updated DESC",
      )
      .all(u, kind)
      .map(unpack);
  function unpack(r) {
    return r
      ? {
          id: r.id,
          ...JSON.parse(r.data),
          version: r.version,
          updated: r.updated,
        }
      : null;
  }
  function get(u, rid, kind) {
    const r = db
      .prepare("SELECT * FROM records WHERE id=? AND user_id=?")
      .get(rid, u);
    if (!r || (kind && r.kind !== kind)) fail(404, "항목을 찾을 수 없습니다.");
    return unpack(r);
  }
  function put(u, kind, data, rid = id(), expected) {
    const old = db
      .prepare("SELECT * FROM records WHERE id=? AND user_id=?")
      .get(rid, u);
    if (old && expected !== old.version)
      fail(409, "다른 변경이 있습니다. 새로고침 후 다시 저장하세요.");
    const version = old ? old.version + 1 : 1;
    db.prepare(
      "INSERT INTO records(id,user_id,kind,data,version,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated WHERE records.user_id=excluded.user_id",
    ).run(rid, u, kind, JSON.stringify(data), version, now());
    return get(u, rid);
  }
  function connection(u, p) {
    const r = db
      .prepare(
        "SELECT encrypted FROM connections WHERE user_id=? AND provider=?",
      )
      .get(u, p);
    return r ? crypt.decrypt(r.encrypted) : null;
  }
  function saveConnection(u, p, data) {
    db.prepare(
      "INSERT INTO connections VALUES(?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted=excluded.encrypted",
    ).run(u, p, crypt.encrypt(data));
  }
  const identities = (t) =>
    [
      t.contact?.email?.toLowerCase(),
      t.companyKey && "company:" + t.companyKey.replace(/\s/g, ""),
      t.handle && "instagram:" + t.handle.toLowerCase(),
      t.profile,
    ].filter(Boolean);
  function blocked(u, t) {
    return (
      identities(t).some((i) =>
        db
          .prepare("SELECT 1 FROM suppression WHERE user_id=? AND identity=?")
          .get(u, i),
      ) || ["거절", "수신 거부"].includes(t.status)
    );
  }
  function suppress(u, t, reason) {
    for (const ident of identities(t))
      db.prepare("INSERT OR REPLACE INTO suppression VALUES(?,?,?)").run(
        u,
        ident,
        reason,
      );
  }
  function session(req, res, next) {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("sanji_session="))
      ?.slice(14);
    const s =
      token &&
      db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(hash(token), Date.now());
    if (!s) return res.status(401).json({ error: "로그인이 필요합니다." });
    req.user = s.user_id;
    req.session = s;
    next();
  }
  function csrf(req, res, next) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin !== new URL(cfg.base).origin)
        return res.status(403).json({ error: "허용되지 않은 출처입니다." });
      if (!safeEqual(req.headers["x-csrf-token"], req.session.csrf))
        return res.status(403).json({ error: "보안 토큰을 확인하세요." });
    }
    next();
  }
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.get("/healthz", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  app.get("/api/status", (req, res) =>
    res.json({
      production: true,
      setupRequired: !db.prepare("SELECT 1 FROM users LIMIT 1").get(),
      emailSendingEnabled: cfg.emailEnabled,
      instagramSendingEnabled: cfg.instagramEnabled,
    }),
  );
  app.post(
    "/api/instagram/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res) => {
      if (!process.env.META_APP_SECRET) return res.sendStatus(503);
      const expected =
        "sha256=" +
        crypto
          .createHmac("sha256", process.env.META_APP_SECRET)
          .update(req.body)
          .digest("hex");
      if (!safeEqual(expected, req.headers["x-hub-signature-256"]))
        return res.sendStatus(403);
      const body = JSON.parse(req.body);
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const eid = event.message?.mid;
          if (!eid || event.message?.is_echo || !event.sender?.id) continue;
          if (db.prepare("SELECT 1 FROM webhook_events WHERE id=?").get(eid))
            continue;
          db.prepare("INSERT INTO webhook_events VALUES(?,?)").run(eid, now());
          for (const row of db
            .prepare("SELECT * FROM connections WHERE provider='instagram'")
            .all()) {
            const c = crypt.decrypt(row.encrypted);
            if (String(c.id) !== String(entry.id)) continue;
            const threads = list(row.user_id, "thread");
            let t = threads.find(
              (t) =>
                t.channel === "instagram" &&
                t.senderId === String(event.sender.id),
            );
            if (!t)
              t = {
                channel: "instagram",
                senderId: String(event.sender.id),
                target: "",
                subject: "Instagram 수신 대화",
                owner: "",
                next: "수신자와 공개 계정 관계 확인 필요",
                due: "",
                classification: "미분류",
                messages: [],
              };
            t.messages.push({
              id: eid,
              out: false,
              text: event.message?.text || "[첨부 메시지]",
              at: new Date(event.timestamp || Date.now()).toISOString(),
              automatic: false,
            });
            t.lastInbound = Math.max(
              t.lastInbound || 0,
              Math.min(Date.now(), Number(event.timestamp) || 0),
            );
            put(row.user_id, "thread", t, t.id || id(), t.version);
            audit(row.user_id, "instagram_received", { message: eid });
          }
        }
      }
      res.sendStatus(200);
    },
  );
  app.get("/api/instagram/webhook", (req, res) => {
    if (
      process.env.META_VERIFY_TOKEN &&
      req.query["hub.mode"] === "subscribe" &&
      safeEqual(req.query["hub.verify_token"], process.env.META_VERIFY_TOKEN)
    )
      return res.type("text").send(req.query["hub.challenge"]);
    res.sendStatus(403);
  });
  app.use(express.json({ limit: "15mb" }));
  app.post("/api/auth/setup", authLimit, (req, res) => {
    if (req.headers.origin !== new URL(cfg.base).origin)
      fail(403, "허용되지 않은 출처");
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get())
      fail(409, "초기 설정이 완료되었습니다. 로그인하세요.");
    if (!safeEqual(req.body.token, cfg.setup))
      fail(403, "관리자 초기 설정 토큰이 일치하지 않습니다.");
    const email = String(req.body.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body.password || "");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      password.length < 12 ||
      password.length > 200
    )
      fail(400, "이메일과 12~200자 비밀번호를 입력하세요.");
    const u = id();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      u,
      email,
      passwordHash(password),
      now(),
    );
    audit(u, "admin_created");
    res.status(201).json({ ok: true });
  });
  app.post("/api/auth/login", authLimit, (req, res) => {
    if (req.headers.origin !== new URL(cfg.base).origin)
      fail(403, "허용되지 않은 출처");
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(String(req.body.email || "").toLowerCase());
    if (
      !u ||
      !passwordValid(String(req.body.password || "").slice(0, 200), u.password)
    )
      fail(401, "이메일 또는 비밀번호가 일치하지 않습니다.");
    const token = crypto.randomBytes(32).toString("hex"),
      csrfToken = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      hash(token),
      u.id,
      csrfToken,
      Date.now() + 12 * 3600000,
    );
    res.setHeader(
      "Set-Cookie",
      `sanji_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${prod ? "; Secure" : ""}`,
    );
    res.json({ csrf: csrfToken, email: u.email });
    audit(u.id, "login");
  });
  app.get("/oauth/:provider/callback", session, async (req, res) => {
    const provider = req.params.provider,
      stored = db
        .prepare(
          "SELECT * FROM oauth_states WHERE state=? AND user_id=? AND provider=? AND session=? AND expires>?",
        )
        .get(
          hash(String(req.query.state || "")),
          req.user,
          provider,
          req.session.token,
          Date.now(),
        );
    if (!stored) fail(403, "인증 상태가 만료되었거나 일치하지 않습니다.");
    db.prepare("DELETE FROM oauth_states WHERE state=?").run(stored.state);
    if (!req.query.code) fail(400, "인증이 취소되었습니다.");
    if (provider === "gmail") {
      const token = await providerRequest(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: String(req.query.code),
            grant_type: "authorization_code",
            redirect_uri: cfg.base + "/oauth/gmail/callback",
            code_verifier: stored.verifier,
          }),
        },
      );
      const profile = await providerRequest(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: "Bearer " + token.access_token } },
      );
      if (!token.refresh_token)
        fail(
          400,
          "오프라인 갱신 권한이 없습니다. Google 앱 권한을 해제한 후 다시 연결하세요.",
        );
      saveConnection(req.user, "gmail", {
        ...token,
        email: profile.emailAddress,
        expires: Date.now() + token.expires_in * 1000,
      });
    } else if (provider === "instagram") {
      const token = await providerRequest(
        "https://api.instagram.com/oauth/access_token",
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            code: String(req.query.code),
            grant_type: "authorization_code",
            redirect_uri: cfg.base + "/oauth/instagram/callback",
          }),
        },
      );
      const long = await providerRequest(
        "https://graph.instagram.com/access_token?" +
          new URLSearchParams({
            grant_type: "ig_exchange_token",
            client_secret: process.env.META_APP_SECRET,
            access_token: token.access_token,
          }),
      );
      const profile = await providerRequest(
        "https://graph.instagram.com/" +
          (process.env.META_GRAPH_VERSION || "v24.0") +
          "/me?" +
          new URLSearchParams({
            fields: "id,username",
            access_token: long.access_token,
          }),
      );
      saveConnection(req.user, "instagram", {
        ...long,
        ...profile,
        expires: Date.now() + long.expires_in * 1000,
      });
    } else fail(404, "알 수 없는 연결");
    audit(req.user, "oauth_connected", { provider });
    res.redirect("/app/#settings");
  });
  app.use("/api", session, csrf, (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/me", (req, res) =>
    res.json({
      email: db.prepare("SELECT email FROM users WHERE id=?").get(req.user)
        .email,
      csrf: req.session.csrf,
    }),
  );
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.session.token);
    res.setHeader(
      "Set-Cookie",
      "sanji_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    );
    res.json({ ok: true });
  });
  app.get("/api/state", (req, res) =>
    res.json({
      candidates: list(req.user, "candidate"),
      deals: list(req.user, "deal"),
      templates: list(req.user, "template"),
      threads: list(req.user, "thread"),
      outbox: db
        .prepare(
          "SELECT id,target,channel,status,created,data FROM outbox WHERE user_id=? ORDER BY created DESC LIMIT 500",
        )
        .all(req.user)
        .map((x) => ({ ...x, data: JSON.parse(x.data) })),
      suppression: db
        .prepare("SELECT identity,reason FROM suppression WHERE user_id=?")
        .all(req.user),
      settings: list(req.user, "settings")[0] || {
        senderName: "",
        senderAddress: "",
        senderPhone: "",
        optOut: "회신으로 수신 거부를 요청하실 수 있습니다.",
      },
    }),
  );
  function validateCandidate(u, data, exclude) {
    if (
      data.followers !== null &&
      (!data.metricsSource || !data.metricsChecked)
    )
      fail(400, "팔로워 수치에는 출처 URL과 확인일이 필요합니다.");
    if (!data.companyKey && data.company)
      data.companyKey = data.company.replace(/\s/g, "");
    const cs = list(u, "candidate");
    if (
      cs.some(
        (c) =>
          c.id !== exclude &&
          ((data.companyKey && c.companyKey === data.companyKey) ||
            (data.handle &&
              c.handle.toLowerCase() === data.handle.toLowerCase()) ||
            (data.contact.email &&
              c.contact.email.toLowerCase() ===
                data.contact.email.toLowerCase())),
      )
    )
      fail(
        409,
        "같은 법인 식별자·계정·이메일 후보가 이미 존재합니다. 기존 회사의 브랜드·제품 관계를 메모에 추가하세요.",
      );
    if (data.contact.verified) {
      if (
        !data.contact.email ||
        !data.contact.source ||
        !data.contact.checked ||
        data.contact.owner !== data.company ||
        data.contact.purpose === "미확인"
      )
        fail(
          400,
          "검증하려면 공식 출처·확인일·이메일 소유 회사 일치와 사업용 목적을 기록하세요.",
        );
      if (
        /(^|[._-])(privacy|recruit|career|jobs|security|support|noreply|no-reply|tech)([._-]|@)/i.test(
          data.contact.email,
        )
      )
        fail(
          400,
          "개인정보·채용·지원 등 무관한 주소는 영업에 사용할 수 없습니다.",
        );
    }
  }
  for (const kind of ["candidate", "deal", "template"]) {
    app.post("/api/" + kind, (req, res) => {
      const data = schemas[kind].parse(req.body);
      if (kind === "candidate") validateCandidate(req.user, data);
      if (kind === "deal") get(req.user, data.brand, "candidate");
      const r = put(req.user, kind, {
        ...data,
        ...(kind === "deal" ? { history: [] } : {}),
      });
      audit(req.user, kind + "_created", { id: r.id });
      res.status(201).json(r);
    });
    app.put("/api/" + kind + "/:id", (req, res) => {
      const old = get(req.user, req.params.id, kind),
        data = schemas[kind].parse(req.body);
      if (kind === "candidate") validateCandidate(req.user, data, old.id);
      if (kind === "deal") get(req.user, data.brand, "candidate");
      const r = put(
        req.user,
        kind,
        {
          ...data,
          ...(kind === "deal"
            ? {
                history: [
                  ...(old.history || []),
                  { ...old, history: undefined },
                ],
              }
            : {}),
        },
        old.id,
        req.body.version,
      );
      if (kind === "candidate" && ["거절", "수신 거부"].includes(r.status))
        suppress(req.user, r, r.status);
      audit(req.user, kind + "_updated", { id: r.id, version: r.version });
      res.json(r);
    });
  }
  app.put("/api/settings", (req, res) => {
    const b = req.body;
    const old = list(req.user, "settings")[0];
    res.json(
      put(
        req.user,
        "settings",
        {
          senderName: String(b.senderName || "").slice(0, 200),
          senderAddress: String(b.senderAddress || "").slice(0, 500),
          senderPhone: String(b.senderPhone || "").slice(0, 100),
          optOut: "회신으로 수신 거부를 요청하실 수 있습니다.",
        },
        old?.id || id(),
        old?.version,
      ),
    );
  });
  app.put("/api/thread/:id", (req, res) => {
    const t = get(req.user, req.params.id, "thread"),
      b = req.body;
    if (
      ![
        "미분류",
        "자동 응답",
        "관심 회신",
        "단순 안내",
        "거절",
        "수신 거부",
        "수락",
        "공동구매 확정",
      ].includes(b.classification)
    )
      fail(400, "분류를 확인하세요.");
    for (const k of ["owner", "next", "due", "classification"])
      t[k] = String(b[k] || "").slice(0, 2000);
    if (t.target && ["거절", "수신 거부"].includes(t.classification)) {
      const c = get(req.user, t.target, "candidate");
      suppress(req.user, c, t.classification);
      put(
        req.user,
        "candidate",
        { ...c, status: t.classification },
        c.id,
        c.version,
      );
    }
    res.json(put(req.user, "thread", t, t.id, b.version));
  });
  app.get("/api/matching", (req, res) => {
    const pairs = [];
    for (const c of list(req.user, "candidate").filter(
      (c) => c.kind === "크리에이터",
    ))
      for (const d of list(req.user, "deal")) {
        const common = c.topics.filter((t) => d.topics.includes(t));
        pairs.push({
          creator: c.id,
          deal: d.id,
          priority: common.length,
          reason: common.length
            ? "공개 주제 일치: " + common.join(", ")
            : "일치하는 공개 주제 근거 없음",
          uncertainty: [
            c.evidence.length
              ? "콘텐츠 출처를 직접 검토하세요."
              : "확인한 콘텐츠 출처 없음",
            c.experience === "미확인" ? "공동구매 경험 미확인" : c.experience,
            "가격대 수용성·실판매 성과 미확인",
            d.state === "확정"
              ? "거래 조건 " + d.version + " 버전"
              : "조건 협의 중",
            `크리에이터 일정: ${c.schedule} / 상품 일정: ${d.schedule}`,
          ],
        });
      }
    res.json(pairs.sort((a, b) => b.priority - a.priority));
  });
  app.get("/api/search", async (req, res) => {
    const q = String(req.query.q || "")
        .trim()
        .slice(0, 200),
      type = req.query.type === "creator" ? "creator" : "brand";
    if (q.length < 2) fail(400, "검색어를 2자 이상 입력하세요.");
    if (!process.env.BRAVE_SEARCH_API_KEY)
      return res.status(503).json({
        error:
          "Brave Search API 키가 아직 연결되지 않았습니다. 공식 검색 링크 또는 직접 추가 기능을 사용하세요.",
        searchUrl:
          "https://www.google.com/search?q=" +
          encodeURIComponent(
            type === "creator"
              ? q + " site:instagram.com 건강식품 공동구매"
              : q + " 공식 홈페이지 제휴 도매 문의",
          ),
      });
    const result = await providerRequest(
      "https://api.search.brave.com/res/v1/web/search?" +
        new URLSearchParams({
          q:
            type === "creator"
              ? q + " site:instagram.com 건강식품 공동구매"
              : q + " 공식 홈페이지 제휴 도매 문의",
          count: "10",
          country: "KR",
          search_lang: "ko",
        }),
      {
        headers: {
          "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
          Accept: "application/json",
        },
      },
    );
    res.json({
      results: (result.web?.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        checked: now(),
        verification: "검색 결과 · 회사/계정 소유 및 연락처 검증 전",
      })),
    });
  });
  app.get("/api/connections", (req, res) => {
    const gmail = connection(req.user, "gmail"),
      ig = connection(req.user, "instagram");
    res.json({
      gmail: {
        configured:
          !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
        connected: !!gmail,
        email: gmail?.email || "",
        enabled: cfg.emailEnabled,
      },
      instagram: {
        configured: !!process.env.META_APP_ID && !!process.env.META_APP_SECRET,
        connected: !!ig,
        username: ig?.username || "",
        expires: ig?.expires || null,
        enabled: cfg.instagramEnabled,
      },
      search: { configured: !!process.env.BRAVE_SEARCH_API_KEY },
    });
  });
  app.post("/api/oauth/:provider", async (req, res) => {
    const p = req.params.provider;
    if (!["gmail", "instagram"].includes(p)) fail(404, "알 수 없는 연결");
    if (
      (p === "gmail" &&
        (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) ||
      (p === "instagram" &&
        (!process.env.META_APP_ID || !process.env.META_APP_SECRET))
    )
      fail(503, "서버에 공식 OAuth 앱 설정이 필요합니다.");
    const state = crypto.randomBytes(32).toString("hex"),
      verifier = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO oauth_states VALUES(?,?,?,?,?,?)").run(
      hash(state),
      req.user,
      p,
      req.session.token,
      verifier,
      Date.now() + 10 * 60000,
    );
    let url;
    if (p === "gmail")
      url =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          redirect_uri: cfg.base + "/oauth/gmail/callback",
          response_type: "code",
          scope:
            "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: crypto
            .createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        });
    else
      url =
        "https://www.instagram.com/oauth/authorize?" +
        new URLSearchParams({
          client_id: process.env.META_APP_ID,
          redirect_uri: cfg.base + "/oauth/instagram/callback",
          response_type: "code",
          scope: "instagram_business_basic,instagram_business_manage_messages",
          state,
        });
    res.json({ url });
  });
  app.delete("/api/connections/:provider", (req, res) => {
    db.prepare("DELETE FROM connections WHERE user_id=? AND provider=?").run(
      req.user,
      req.params.provider,
    );
    audit(req.user, "connection_removed", { provider: req.params.provider });
    res.json({ ok: true });
  });
  async function gmailToken(u) {
    const c = connection(u, "gmail");
    if (!c) fail(503, "Gmail을 먼저 연결하세요.");
    if (c.expires > Date.now() + 60000) return c;
    const token = await providerRequest("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: c.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const updated = {
      ...c,
      ...token,
      expires: Date.now() + token.expires_in * 1000,
    };
    saveConnection(u, "gmail", updated);
    return updated;
  }
  app.post("/api/gmail/sync", async (req, res) => {
    const c = await gmailToken(req.user),
      auth = { Authorization: "Bearer " + c.access_token },
      targets = list(req.user, "candidate").filter((t) => t.contact?.email);
    let imported = 0,
      needsMore = false;
    for (const target of targets.slice(0, 30)) {
      const email = target.contact.email;
      const result = await providerRequest(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads?" +
          new URLSearchParams({
            q: `{from:${email} to:${email}} newer_than:90d`,
            maxResults: "20",
          }),
        { headers: auth },
      );
      if (result.nextPageToken) needsMore = true;
      for (const entry of result.threads || []) {
        const remote = await providerRequest(
          "https://gmail.googleapis.com/gmail/v1/users/me/threads/" +
            encodeURIComponent(entry.id) +
            "?format=full",
          { headers: auth },
        );
        const messages = remote.messages
          .map((m) => {
            const h = headers(m.payload),
              from = h.from || "",
              automatic =
                (!!h["auto-submitted"] && h["auto-submitted"] !== "no") ||
                /auto_reply|auto-replied|bulk|junk/i.test(
                  (h.precedence || "") + " " + (h["x-autoreply"] || ""),
                );
            return {
              id: m.id,
              messageId: h["message-id"] || "",
              references: h.references || "",
              from,
              subject: h.subject || "",
              out: from.toLowerCase().includes(c.email.toLowerCase()),
              text: bodyText(m.payload) || m.snippet || "[본문 미지원]",
              at: new Date(Number(m.internalDate)).toISOString(),
              automatic,
              hasAttachments: (m.payload.parts || []).some((p) => p.filename),
            };
          })
          .sort((a, b) => a.at.localeCompare(b.at));
        const old = list(req.user, "thread").find(
          (t) => t.providerId === remote.id && t.channel === "email",
        );
        const inbound = messages.filter((m) => !m.out);
        const optOut = inbound.some(
          (m) =>
            !m.automatic &&
            /수신\s*거부(합니다|할게|해\s*주세요|요청합니다)|^\s*수신\s*거부[.!]?\s*$|unsubscribe\s+me|please\s+(unsubscribe|stop)|연락.{0,8}(중단해|그만해|하지\s*마)/im.test(
              m.text,
            ),
        );
        const classification = optOut
          ? "수신 거부"
          : old?.classification ||
            (inbound.length && inbound.every((m) => m.automatic)
              ? "자동 응답"
              : "미분류");
        if (optOut) suppress(req.user, target, "수신 메일의 수신 거부 요청");
        put(
          req.user,
          "thread",
          {
            target: target.id,
            channel: "email",
            providerId: remote.id,
            subject: messages[0]?.subject || "(제목 없음)",
            owner: old?.owner || "",
            next: old?.next || "",
            due: old?.due || "",
            classification,
            messages,
            synced: now(),
          },
          old?.id || id(),
          old?.version,
        );
        if (inbound.length)
          put(
            req.user,
            "candidate",
            {
              ...get(req.user, target.id, "candidate"),
              status: optOut
                ? "수신 거부"
                : ["거절", "수신 거부"].includes(target.status)
                  ? target.status
                  : "회신",
            },
            target.id,
            get(req.user, target.id).version,
          );
        imported++;
      }
    }
    audit(req.user, "gmail_synced", { imported });
    res.json({
      imported,
      partial: targets.length > 30 || needsMore,
      note: "등록된 이메일 대상과 최근 90일 대화만 동기화. 대상 최대 30명·대상당 최근 20개 대화.",
    });
  });
  function renderText(text, target, deals) {
    const vars = {
      회사명: target.company || "미확인",
      브랜드명:
        target.kind === "크리에이터"
          ? deals
              .map((d) => get(target._user, d.brand, "candidate").name)
              .join(" / ")
          : target.name,
      크리에이터명: target.kind === "크리에이터" ? target.name : "해당 없음",
      제품명: deals.length
        ? deals.map((d) => d.name).join(" / ")
        : target.product || "미확인",
      공동구매가: deals.length
        ? deals
            .map((d) =>
              d.price == null ? "미협의" : d.price.toLocaleString() + "원",
            )
            .join(" / ")
        : "미확인",
      일정: deals.map((d) => d.schedule).join(" / ") || "미확인",
    };
    return text.replace(/\{\{(.*?)\}\}/g, (_, k) => vars[k] ?? "{{" + k + "}}");
  }
  function validateSending(u, data) {
    const t = get(u, data.target, "candidate");
    if (blocked(u, t)) fail(403, "거절·수신 거부 대상입니다.");
    if (data.channel === "email") {
      if (!t.contact.verified || !t.contact.email)
        fail(400, "공식 사업용 연락처 소유 회사·출처를 검증해야 합니다.");
    }
    const deals = data.dealIds.map((d) => get(u, d, "deal"));
    if (t.kind === "크리에이터" && !data.replyTo && !deals.length)
      fail(400, "크리에이터 신규 제안에는 확정 상품 1~3개가 필요합니다.");
    if (deals.some((d) => d.state !== "확정"))
      fail(400, "협의 중 상품은 제안할 수 없습니다.");
    if (data.replyTo) {
      const thread = get(u, data.replyTo, "thread");
      if (
        thread.target !== t.id ||
        (thread.channel !== data.channel &&
          !(data.channel === "manual_dm" && thread.channel === "manual_dm"))
      )
        fail(400, "대화와 수신자·채널이 일치하지 않습니다.");
    } else {
      if (
        list(u, "thread").some((th) => th.target === t.id) ||
        db
          .prepare(
            "SELECT 1 FROM outbox WHERE user_id=? AND target=? AND status NOT IN ('cancelled','failed_before_send')",
          )
          .get(u, t.id)
      )
        fail(409, "기존 연락 이력이 있습니다. 기존 대화에서 회신하세요.");
      const ids = identities(t);
      for (const other of list(u, "candidate").filter((c) => c.id !== t.id)) {
        if (
          identities(other).some((i) => ids.includes(i)) &&
          (list(u, "thread").some((th) => th.target === other.id) ||
            db
              .prepare("SELECT 1 FROM outbox WHERE user_id=? AND target=?")
              .get(u, other.id))
        )
          fail(409, "같은 회사·이메일·계정의 연락 이력이 있습니다.");
      }
    }
    return { target: t, deals };
  }
  app.post("/api/drafts", (req, res) => {
    const input = schemas.draft.parse(req.body),
      { target, deals } = validateSending(req.user, input);
    target._user = req.user;
    const settings = list(req.user, "settings")[0];
    if (
      input.channel === "email" &&
      (!settings?.senderName ||
        (input.marketing && !settings.senderAddress) ||
        !settings.senderPhone)
    )
      fail(400, "설정에서 발신자명·주소·연락처를 먼저 등록하세요.");
    const subject = renderText(input.subject, target, deals),
      body =
        renderText(input.body, target, deals) +
        "\n\n" +
        input.signature +
        (input.channel === "email"
          ? `\n\n${settings.senderName}\n${settings.senderAddress}\n${settings.senderPhone}${input.marketing?"\n"+settings.optOut:""}`
          : "");
    if (/\{\{/.test(subject + body)) fail(400, "미해결 변수가 있습니다.");
    if (
      /치료|예방|완치|항암|효능.{0,4}보장|혈당.{0,5}(낮|개선)/.test(
        subject + body,
      )
    )
      fail(
        400,
        "질병 예방·치료 또는 미확인 효능 표현을 수정하세요. 전문 검토 전 발송할 수 없습니다.",
      );
    if (
      input.marketing &&
      input.channel === "email" &&
      !subject.startsWith("(광고)")
    )
      fail(400, "광고성 제안 제목은 (광고)로 시작해야 합니다.");
    const total = input.attachments.reduce(
      (n, a) => n + Buffer.from(a.content, "base64").length,
      0,
    );
    if (total > 5 * 1024 * 1024) fail(400, "첨부 합계는 5MB 이하입니다.");
    let reply = {};
    if (input.replyTo) {
      const t = get(req.user, input.replyTo, "thread"),
        last = t.messages.filter((m) => !m.out).at(-1);
      reply = {
        providerThread: t.providerId,
        inReplyTo: last?.messageId,
        references: last?.references,
        senderId: t.senderId,
      };
      if (
        input.channel === "instagram" &&
        (!t.senderId ||
          !t.lastInbound ||
          Date.now() - t.lastInbound > 24 * 3600000)
      )
        fail(400, "상대가 시작한 최근 24시간 대화에만 답장할 수 있습니다.");
    }
    if (input.channel === "instagram" && !input.replyTo)
      fail(400, "Instagram 신규 선제 DM은 지원하지 않습니다.");
    const d = {
        ...input,
        ...reply,
        subject,
        body,
        email: target.contact.email,
        targetName: target.name,
        targetVersion: target.version,
        dealVersions: deals.map((d) => ({ id: d.id, version: d.version })),
        messageId: id(),
      },
      draftId = id(),
      digest = hash(JSON.stringify(d));
    db.prepare("INSERT INTO drafts VALUES(?,?,?,?,?,0)").run(
      draftId,
      req.user,
      JSON.stringify(d),
      digest,
      Date.now() + 15 * 60000,
    );
    res.status(201).json({
      id: draftId,
      hash: digest,
      target: d.targetName,
      email: d.email,
      channel: d.channel,
      subject,
      body,
      dealVersions: d.dealVersions,
      attachments: d.attachments.map((a) => ({
        name: a.name,
        size: Buffer.from(a.content, "base64").length,
      })),
      expiresIn: 900,
      warnings: [
        "접수는 받은편지함 도착을 의미하지 않습니다.",
        "법적 발송 근거는 사용자 확인 사항입니다.",
      ],
    });
  });
  app.post("/api/drafts/:id/send", async (req, res) => {
    const row = db
      .prepare("SELECT * FROM drafts WHERE id=? AND user_id=?")
      .get(req.params.id, req.user);
    if (!row || row.used || row.expires < Date.now())
      fail(409, "미리보기가 만료되었거나 이미 사용됐습니다.");
    if (!req.body.approved || !safeEqual(req.body.hash, row.hash))
      fail(400, "수신자·본문·첨부 최종 미리보기 승인이 필요합니다.");
    const d = JSON.parse(row.data),
      { target, deals } = validateSending(req.user, d);
    if (d.marketing && d.channel !== "manual_dm") {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(new Date()),
      );
      if (hour < 8 || hour >= 21)
        fail(
          403,
          "광고성 정보는 한국시간 08~21시 사이에만 발송할 수 있습니다. 야간 별도 동의 예외는 현재 지원하지 않습니다.",
        );
    }
    if (
      target.version !== d.targetVersion ||
      deals.some((x, i) => x.version !== d.dealVersions[i].version)
    )
      fail(409, "후보 또는 상품 조건이 변경됐습니다. 새 미리보기를 만드세요.");
    if (d.channel === "email" && !cfg.emailEnabled)
      fail(
        403,
        "서버 실제 이메일 발송 스위치가 꺼져 있습니다. 관리자 확인 전 발송하지 않습니다.",
      );
    if (d.channel === "instagram" && !cfg.instagramEnabled)
      fail(403, "Instagram 실제 발송 스위치가 꺼져 있습니다.");
    if (d.channel === "manual_dm" && !req.body.manuallySent)
      fail(400, "사용자가 직접 발송한 결과만 기록할 수 있습니다.");
    if (d.channel === "instagram") {
      const t = get(req.user, d.replyTo, "thread");
      if (!t.lastInbound || Date.now() - t.lastInbound > 24 * 3600000)
        fail(403, "메시징 시간이 만료되었습니다.");
      if (d.attachments.length || Buffer.byteLength(d.body) > 1000)
        fail(400, "현재 Instagram 회신은 1000바이트 이하 텍스트만 지원합니다.");
    }
    let gmail, ig;
    if (d.channel === "email") gmail = await gmailToken(req.user);
    if (d.channel === "instagram") {
      ig = connection(req.user, "instagram");
      if (!ig || ig.expires < Date.now())
        fail(503, "Instagram 재연결이 필요합니다.");
    }
    // Reserve synchronously before any network request. Unknown outcomes never retry automatically.
    const oid = id(),
      fingerprint = hash(
        req.user +
          "|" +
          d.target +
          "|" +
          d.channel +
          "|" +
          d.subject +
          "|" +
          d.body,
      );
    try {
      db.exec("BEGIN IMMEDIATE");
      validateSending(req.user, d);
      const fresh = get(req.user, d.target, "candidate");
      if (
        fresh.version !== d.targetVersion ||
        d.dealVersions.some(
          (v) => get(req.user, v.id, "deal").version !== v.version,
        )
      )
        fail(409, "승인 중 조건이 변경됐습니다.");
      if (
        !db
          .prepare("UPDATE drafts SET used=1 WHERE id=? AND used=0")
          .run(row.id).changes
      )
        fail(409, "이미 승인 처리한 미리보기입니다.");
      db.prepare("INSERT INTO outbox VALUES(?,?,?,?,?,?,?,?)").run(
        oid,
        req.user,
        d.target,
        d.channel,
        fingerprint,
        "submitting",
        JSON.stringify({
          ...d,
          attachments: d.attachments.map((a) => ({
            name: a.name,
            size: Buffer.from(a.content, "base64").length,
          })),
          lawfulBasis: d.lawfulBasis,
        }),
        now(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      if (e.code?.includes("SQLITE_CONSTRAINT"))
        fail(409, "동일 내용 중복 발송을 차단했습니다.");
      throw e;
    }
    let result = {},
      status = "manual_recorded";
    try {
      if (d.channel === "email") {
        result = await providerRequest(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + gmail.access_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              raw: mime(d, gmail.email),
              ...(d.providerThread ? { threadId: d.providerThread } : {}),
            }),
          },
        );
        status = "accepted";
      }
      if (d.channel === "instagram") {
        result = await providerRequest(
          "https://graph.instagram.com/" +
            (process.env.META_GRAPH_VERSION || "v24.0") +
            "/" +
            encodeURIComponent(ig.id) +
            "/messages",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + ig.access_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipient: { id: d.senderId },
              message: { text: d.body },
            }),
          },
        );
        status = "accepted";
      }
      db.prepare("UPDATE outbox SET status=? WHERE id=?").run(status, oid);
      let thread = d.replyTo ? get(req.user, d.replyTo, "thread") : null;
      const data = thread || {
        target: d.target,
        channel: d.channel,
        subject: d.subject,
        providerId: result.threadId || "",
        owner: "",
        next: "회신 대기",
        due: "",
        classification: "미분류",
        messages: [],
      };
      data.messages.push({
        id: result.id || oid,
        messageId: `<${d.messageId}@sanji.local>`,
        out: true,
        text: d.body,
        at: now(),
        status,
      });
      put(req.user, "thread", data, thread?.id || id(), thread?.version);
      put(
        req.user,
        "candidate",
        { ...get(req.user, target.id, "candidate"), status: "발송" },
        target.id,
        get(req.user, target.id).version,
      );
      audit(req.user, "approved_dispatch", {
        outbox: oid,
        channel: d.channel,
        status,
        previewHash: row.hash,
      });
      res.json({
        id: oid,
        status,
        note:
          status === "accepted"
            ? "제공자 접수. 받은편지함 도착·열람은 확인되지 않았습니다."
            : "사용자 수동 발송 기록. 전달·열람 미확인.",
      });
    } catch (e) {
      const definite = [400, 401, 403, 404, 429].includes(e.status);
      db.prepare("UPDATE outbox SET status=?,data=? WHERE id=?").run(
        definite ? "provider_rejected" : "outcome_unknown",
        JSON.stringify({
          targetName: d.targetName,
          subject: d.subject,
          error: e.providerCode || "network_or_persistence_error",
          retries: 0,
        }),
        oid,
      );
      audit(req.user, "dispatch_error", {
        outbox: oid,
        status: definite ? "provider_rejected" : "outcome_unknown",
      });
      res.status(502).json({
        error:
          "발송 결과를 확인하지 못했습니다. 오류 기록과 제공자 보낸편지함을 확인하세요. 자동 재시도하지 않습니다.",
        id: oid,
      });
    }
  });
  app.post("/api/instagram/link-thread", (req, res) => {
    const t = get(req.user, req.body.thread, "thread"),
      c = get(req.user, req.body.target, "candidate");
    if (t.channel !== "instagram" || c.kind !== "크리에이터")
      fail(400, "대상 유형을 확인하세요.");
    t.target = c.id;
    res.json(put(req.user, "thread", t, t.id, req.body.version));
  });
  app.get("/api/audit", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT action,data,created FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 200",
        )
        .all(req.user)
        .map((r) => ({ ...r, data: JSON.parse(r.data) })),
    ),
  );
  app.get("/", (req, res) => res.redirect("/app/"));
  app.use(
    "/app",
    express.static(path.join(__dirname, "../private/ui"), {
      index: "index.html",
      dotfiles: "deny",
    }),
  );
  app.use(
    express.static(path.join(__dirname, "../public"), {
      dotfiles: "deny",
      index: "index.html",
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.name === "ZodError")
      return res.status(400).json({
        error: "입력 내용을 확인하세요.",
        details: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    res
      .status(
        err.status && err.status >= 400 && err.status < 600 ? err.status : 500,
      )
      .json({
        error: err.status
          ? err.message
          : "요청을 처리하지 못했습니다. 서버 관리자에게 문의하세요.",
      });
  });
  app.locals.db = db;
  app.locals.config = cfg;
  return app;
}
module.exports = { createApp };
