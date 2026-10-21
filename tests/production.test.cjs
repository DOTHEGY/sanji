const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("@playwright/test");
const { createApp } = require("../api/app.cjs"),
  { vault } = require("../api/db.cjs"),
  { mime } = require("../api/providers.cjs");
async function harness(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sanji-test-")),
    app = createApp({
      data: dir,
      key: "unit-test-key-not-production",
      setup: "unit-test-setup-not-production",
      ...extra,
    });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  app.locals.config.base = base;
  let cookie = "",
    csrf = "";
  async function call(p, method = "GET", body, opts = {}) {
    const r = await fetch(base + "/api" + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...opts,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const c = r.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    return { status: r.status, data: await r.json() };
  }
  async function login() {
    let r = await call("/auth/setup", "POST", {
      token: "unit-test-setup-not-production",
      email: "owner@example.com",
      password: "only-test-password-12345",
    });
    assert.equal(r.status, 201);
    r = await call("/auth/login", "POST", {
      email: "owner@example.com",
      password: "only-test-password-12345",
    });
    assert.equal(r.status, 200);
    csrf = r.data.csrf;
    return r;
  }
  return {
    app,
    base,
    call,
    login,
    dir,
    close: async () => {
      await new Promise((r) => server.close(r));
      app.locals.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
const brand = (name = "실제검증 테스트 법인", email = "biz@test.example") => ({
  name,
  company: name,
  companyKey: name,
  kind: "브랜드",
  category: "일반 건강식품",
  website: "https://test.example",
  contact: {
    email,
    owner: name,
    source: "https://test.example/partners",
    checked: "2026-10-21",
    purpose: "사업 제휴",
    verified: true,
  },
});
const draft = (target, extra = {}) => ({
  target,
  channel: "email",
  subject: "(광고) 제휴 가능 여부 문의",
  body: "직접 작성한 공급 조건 문의입니다.",
  signature: "담당자",
  lawfulBasis: "테스트에서만 사용하는 사전 동의 기록",
  marketing: false,
  ...extra,
});
test("authentication, ownership, CSRF, validation, versioning, suppression and dispatch guard", async () => {
  const h = await harness();
  try {
    assert.equal((await h.call("/state")).status, 401);
    assert.equal(
      (
        await h.call("/auth/setup", "POST", {
          token: "wrong",
          email: "owner@example.com",
          password: "only-test-password-12345",
        })
      ).status,
      403,
    );
    await h.login();
    assert.equal((await h.call("/auth/setup", "POST", {})).status, 409);
    let state = await h.call("/state");
    assert.equal(state.data.candidates.length, 0);
    assert.equal(state.data.deals.length, 0);
    assert.equal(
      (await h.call("/candidate", "POST", brand(), { "X-CSRF-Token": "wrong" }))
        .status,
      403,
    );
    assert.equal(
      (
        await h.call("/candidate", "POST", brand(), {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    const b = await h.call("/candidate", "POST", brand());
    assert.equal(b.status, 201);
    assert.equal((await h.call("/candidate", "POST", brand())).status, 409);
    assert.equal(
      (
        await h.call("/candidate", "POST", {
          ...brand("지원 주소", "support@support.example"),
          contact: {
            ...brand("지원 주소").contact,
            email: "support@support.example",
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call("/candidate", "POST", {
          ...brand("소유자 불일치", "biz@other.example"),
          contact: {
            ...brand("소유자 불일치", "biz@other.example").contact,
            owner: "플랫폼 운영사",
          },
        })
      ).status,
      400,
    );
    const creator = await h.call("/candidate", "POST", {
      name: "테스트 크리에이터",
      kind: "크리에이터",
      company: "크리에이터 사업자",
      handle: "real_test_handle",
      topics: ["일상 루틴"],
    });
    assert.equal(creator.status, 201);
    assert.equal(
      (
        await h.call("/candidate", "POST", {
          name: "계정 중복",
          kind: "크리에이터",
          handle: "real_test_handle",
        })
      ).status,
      409,
    );
    const d = await h.call("/deal", "POST", {
      name: "협의 상품",
      brand: b.data.id,
      category: "일반 건강식품",
      topics: ["일상 루틴"],
    });
    assert.equal(d.status, 201);
    assert.equal(
      (
        await h.call("/deal/" + d.data.id, "PUT", {
          ...d.data,
          price: 24000,
          state: "확정",
          version: 0,
        })
      ).status,
      409,
    );
    const updated = await h.call("/deal/" + d.data.id, "PUT", {
      ...d.data,
      price: 24000,
      state: "확정",
      version: 1,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.version, 2);
    assert.equal(updated.data.history[0].price, null);
    assert.equal((await h.call("/matching")).data[0].priority, 1);
    assert.equal(
      (await h.call("/drafts", "POST", draft(b.data.id))).status,
      400,
    );
    const foreignUser = require("../api/db.cjs").id();
    h.app.locals.db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .run(
        foreignUser,
        "other@example.com",
        require("../api/db.cjs").passwordHash("other-test-password"),
        new Date().toISOString(),
      );
    const foreignRecord = require("../api/db.cjs").id();
    h.app.locals.db
      .prepare("INSERT INTO records VALUES(?,?,?,?,?,?)")
      .run(
        foreignRecord,
        foreignUser,
        "candidate",
        JSON.stringify(brand("다른 관리자 공급사", "owner@foreign.example")),
        1,
        new Date().toISOString(),
      );
    assert.equal(
      (
        await h.call("/candidate/" + foreignRecord, "PUT", {
          ...brand("침범 시도", "intrusion@example.com"),
          version: 1,
        })
      ).status,
      404,
    );
    assert.ok(
      !(await h.call("/state")).data.candidates.some(
        (c) => c.id === foreignRecord,
      ),
    );
    await h.call("/settings", "PUT", {
      dailyLimit: 5,
      senderName: "테스트 사업자",
      senderAddress: "테스트 주소",
      senderPhone: "테스트 연락처",
    });
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(b.data.id, { body: "질병 치료를 보장합니다." }),
        )
      ).status,
      400,
    );
    let p = await h.call("/drafts", "POST", draft(b.data.id));
    assert.equal(p.status, 201);
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          hash: p.data.hash,
          approved: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          hash: p.data.hash,
          approved: true,
        })
      ).status,
      403,
    );
    assert.equal((await h.call("/state")).data.outbox.length, 0);
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(b.data.id, { channel: "instagram" }),
        )
      ).status,
      400,
    );
    p = await h.call(
      "/drafts",
      "POST",
      draft(creator.data.id, {
        channel: "manual_dm",
        dealIds: [d.data.id],
        body: "{{크리에이터명}}님 {{제품명}} {{공동구매가}}",
      }),
    );
    assert.equal(p.status, 201);
    assert.match(p.data.body, /24,000원/);
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          hash: p.data.hash,
          approved: true,
          manuallySent: false,
        })
      ).status,
      400,
    );
    let r = await h.call("/drafts/" + p.data.id + "/send", "POST", {
      hash: p.data.hash,
      approved: true,
      manuallySent: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "manual_recorded");
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          hash: p.data.hash,
          approved: true,
          manuallySent: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(creator.data.id, {
            channel: "manual_dm",
            dealIds: [d.data.id],
          }),
        )
      ).status,
      409,
    );
    state = (await h.call("/state")).data;
    const th = state.threads[0];
    await h.call("/thread/" + th.id, "PUT", {
      version: th.version,
      classification: "수신 거부",
      next: "연락 중단",
      owner: "담당자",
      due: "",
    });
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(creator.data.id, { replyTo: th.id, channel: "manual_dm" }),
        )
      ).status,
      403,
    );
    assert.ok((await h.call("/state")).data.suppression.length > 0);
    assert.equal(
      (await h.call("/deal/no-such-record", "PUT", { ...updated.data })).status,
      404,
    );
    assert.equal((await h.call("/search?q=건강식품")).status, 503);
    assert.equal((await h.call("/oauth/gmail", "POST", {})).status, 503);
    assert.ok(
      !JSON.stringify((await h.call("/connections")).data).includes(
        "access_token",
      ),
    );
    assert.equal((await h.call("/auth/logout", "POST", {})).status, 200);
    assert.equal((await h.call("/state")).status, 401);
  } finally {
    await h.close();
  }
});
test("Gmail integration contract: approved MIME, provider acceptance, incoming replies, opt-out and unknown failures; all provider requests mocked", async () => {
  const calls = [];
  let reject = false;
  const h = await harness({
    emailEnabled: true,
    request: async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("/messages/send")) {
        if (reject) throw Error("timeout");
        const body = JSON.parse(opts.body),
          raw = Buffer.from(body.raw, "base64url").toString();
        assert.match(raw, /Content-Type: multipart\/mixed/);
        assert.match(raw, /Content-Disposition: attachment/);
        return { id: "provider-message-id", threadId: "provider-thread-id" };
      }
      if (url.includes("/threads?"))
        return { threads: [{ id: "provider-thread-id" }] };
      if (url.includes("/threads/"))
        return {
          id: "provider-thread-id",
          messages: [
            {
              id: "inbound-id",
              internalDate: String(Date.now()),
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "biz@test.example" },
                  { name: "Message-ID", value: "<incoming@test.example>" },
                  { name: "Subject", value: "제휴 안내" },
                  { name: "Auto-Submitted", value: "no" },
                ],
                body: {
                  data: Buffer.from(
                    "수신 거부합니다. 더 이상 연락하지 마세요.",
                  ).toString("base64url"),
                },
              },
            },
          ],
        };
      throw Error("Unexpected mocked provider URL");
    },
  });
  try {
    await h.login();
    const b = (await h.call("/candidate", "POST", brand())).data;
    await h.call("/settings", "PUT", {
      dailyLimit: 10,
      senderName: "테스트 사업자",
      senderAddress: "주소",
      senderPhone: "연락처",
    });
    const u = h.app.locals.db.prepare("SELECT id FROM users").get().id;
    h.app.locals.db.prepare("INSERT INTO connections VALUES(?,?,?)").run(
      u,
      "gmail",
      vault("unit-test-key-not-production").encrypt({
        email: "sender@test.example",
        access_token: "mock-provider-token",
        refresh_token: "mock-refresh-token",
        expires: Date.now() + 3600000,
      }),
    );
    let p = await h.call(
      "/drafts",
      "POST",
      draft(b.id, {
        attachments: [
          {
            name: "조건표.txt",
            content: Buffer.from("협의한 거래 조건").toString("base64"),
          },
        ],
      }),
    );
    assert.equal(p.status, 201);
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          approved: true,
          hash: p.data.hash,
        })
      ).data.status,
      "accepted",
    );
    assert.equal(
      calls.filter((c) => c.url.includes("messages/send")).length,
      1,
    );
    const sync = await h.call("/gmail/sync", "POST", {});
    assert.equal(sync.data.imported, 1);
    const state = (await h.call("/state")).data;
    assert.equal(state.candidates[0].status, "수신 거부");
    assert.equal(state.threads[0].classification, "수신 거부");
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(b.id, { replyTo: state.threads[0].id }),
        )
      ).status,
      403,
    );
    assert.ok(state.suppression.length);
    reject = true;
    const b2 = (
      await h.call(
        "/candidate",
        "POST",
        brand("다른 공급사", "biz@second.example"),
      )
    ).data;
    p = await h.call("/drafts", "POST", draft(b2.id));
    const result = await h.call("/drafts/" + p.data.id + "/send", "POST", {
      approved: true,
      hash: p.data.hash,
    });
    assert.equal(result.status, 502);
    assert.equal(
      (await h.call("/state")).data.outbox[0].status,
      "outcome_unknown",
    );
    assert.equal(
      (
        await h.call("/drafts/" + p.data.id + "/send", "POST", {
          approved: true,
          hash: p.data.hash,
        })
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});
test("live workspace browser flow and persistence, no seeded fictional data", async () => {
  const h = await harness();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(h.base + "/app/");
    await page.waitForSelector("#auth-form");
    await page.locator("[name=token]").fill("unit-test-setup-not-production");
    await page.locator("[name=email]").fill("owner@example.com");
    await page.locator("[name=password]").fill("only-test-password-12345");
    await page.locator("#auth-form button").click();
    await page.waitForSelector("#auth-form[data-type=login]");
    await page.locator("[name=email]").fill("owner@example.com");
    await page.locator("[name=password]").fill("only-test-password-12345");
    await page.locator("#auth-form button").click();
    await page.waitForSelector("#nav a");
    for (const key of [
      "dashboard",
      "brands",
      "deals",
      "creators",
      "matching",
      "templates",
      "inbox",
      "settings",
    ]) {
      await page.goto(h.base + "/app/#" + key);
      await page.waitForSelector("h1");
      assert.ok(await page.locator("h1").textContent());
    }
    await page.goto(h.base + "/app/#brands");
    await page.getByRole("button", { name: "＋ 직접 추가" }).click();
    await page.locator("[name=name]").fill("사용자가 확인한 공급사");
    await page.locator("[name=company]").fill("공급사 법인");
    await page.locator("[name=website]").fill("https://supplier.example");
    await page.locator("[name=next]").fill("공식 제휴 문의 확인");
    await page.locator("#candidate-form button[type=submit]").click();
    await page.waitForSelector("#modal:not([open])", { state: "attached" });
    await page.reload();
    await page.waitForSelector("#candidate-results");
    assert.match(
      await page.locator("#candidate-results").textContent(),
      /사용자가 확인한 공급사/,
    );
    await page.getByRole("button", { name: "상세·수정" }).click();
    assert.equal(
      await page.locator("[name=website]").inputValue(),
      "https://supplier.example",
    );
    await page.getByLabel("닫기").click();
    await page.goto(h.base + "/app/#deals");
    await page.getByRole("button", { name: "＋ 딜 추가" }).click();
    await page.locator("[name=name]").fill("실제 협의 예정 상품");
    await page.locator("#deal-form button[type=submit]").click();
    await page.waitForSelector("#modal:not([open])", { state: "attached" });
    await page.reload();
    await page.waitForSelector(".cards");
    assert.match(
      await page.locator(".cards").textContent(),
      /실제 협의 예정 상품/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(h.base + "/app/#dashboard");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "/tmp/sanji-production-mobile.png",
      fullPage: true,
    });
  } finally {
    if (browser) await browser.close();
    await h.close();
  }
});
test("encrypted token vault and MIME preserve Unicode without injecting headers", () => {
  const v = vault("test-key"),
    encrypted = v.encrypt({ refresh_token: "test-only-token" });
  assert.ok(!encrypted.includes("test-only-token"));
  assert.equal(v.decrypt(encrypted).refresh_token, "test-only-token");
  assert.throws(() => vault("wrong").decrypt(encrypted));
  const decoded = Buffer.from(
    mime(
      {
        email: "biz@test.example",
        subject: "공동구매 제안",
        body: "직접 작성한 내용",
        messageId: "test-message",
      },
      "sender@test.example",
    ),
    "base64url",
  ).toString();
  assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(decoded, /Content-Transfer-Encoding: base64/);
});

test("Instagram signed webhook deduplication, real event time window and OAuth session state", async () => {
  const crypto = require("node:crypto");
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "test-meta-app-secret";
  const h = await harness();
  try {
    await h.login();
    const u = h.app.locals.db.prepare("SELECT id FROM users").get().id;
    h.app.locals.db.prepare("INSERT INTO connections VALUES(?,?,?)").run(
      u,
      "instagram",
      vault("unit-test-key-not-production").encrypt({
        id: "professional-id",
        access_token: "test-only",
        expires: Date.now() + 3600000,
      }),
    );
    const c = (
      await h.call("/candidate", "POST", {
        name: "수신 계정 후보",
        kind: "크리에이터",
        handle: "inbound_test",
      })
    ).data;
    const payload = {
      entry: [
        {
          id: "professional-id",
          messaging: [
            {
              sender: { id: "scoped-person-id" },
              timestamp: Date.now() - 25 * 3600000,
              message: {
                mid: "unique-meta-message",
                text: "상품 자료를 요청합니다.",
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload),
      signature =
        "sha256=" +
        crypto
          .createHmac("sha256", process.env.META_APP_SECRET)
          .update(body)
          .digest("hex");
    let r = await fetch(h.base + "/api/instagram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "wrong",
      },
      body,
    });
    assert.equal(r.status, 403);
    for (let i = 0; i < 2; i++) {
      r = await fetch(h.base + "/api/instagram/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body,
      });
      assert.equal(r.status, 200);
    }
    let state = (await h.call("/state")).data;
    assert.equal(state.threads.length, 1);
    assert.equal(state.threads[0].messages.length, 1);
    const t = state.threads[0];
    assert.ok(t.lastInbound < Date.now() - 24 * 3600000);
    assert.equal(
      (
        await h.call("/instagram/link-thread", "POST", {
          thread: t.id,
          target: c.id,
          version: t.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call(
          "/drafts",
          "POST",
          draft(c.id, { channel: "instagram", replyTo: t.id }),
        )
      ).status,
      400,
    );
    const callback = await fetch(
      h.base + "/oauth/gmail/callback?code=attacker&state=wrong",
      { redirect: "manual" },
    );
    assert.equal(callback.status, 401);
  } finally {
    await h.close();
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

test("concurrent approved requests reserve once; changed deal versions invalidate preview", async () => {
  let sends = 0;
  const h = await harness({
    emailEnabled: true,
    request: async () => {
      sends++;
      await new Promise((r) => setTimeout(r, 20));
      return { id: "sent-one", threadId: "thread-one" };
    },
  });
  try {
    await h.login();
    const c = (await h.call("/candidate", "POST", brand())).data;
    await h.call("/settings", "PUT", {
      dailyLimit: 10,
      senderName: "테스트",
      senderAddress: "주소",
      senderPhone: "연락처",
    });
    const u = h.app.locals.db.prepare("SELECT id FROM users").get().id;
    h.app.locals.db.prepare("INSERT INTO connections VALUES(?,?,?)").run(
      u,
      "gmail",
      vault("unit-test-key-not-production").encrypt({
        email: "sender@test.example",
        access_token: "mock",
        expires: Date.now() + 3600000,
      }),
    );
    const p1 = (await h.call("/drafts", "POST", draft(c.id))).data,
      p2 = (await h.call("/drafts", "POST", draft(c.id))).data;
    const rs = await Promise.all([
      h.call("/drafts/" + p1.id + "/send", "POST", {
        hash: p1.hash,
        approved: true,
      }),
      h.call("/drafts/" + p2.id + "/send", "POST", {
        hash: p2.hash,
        approved: true,
      }),
    ]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal(sends, 1);
    const c2 = (
      await h.call("/candidate", "POST", {
        name: "크리에이터",
        kind: "크리에이터",
        handle: "stale_version_person",
      })
    ).data;
    const d = (
      await h.call("/deal", "POST", {
        name: "협의 완료 상품",
        brand: c.id,
        category: "일반 건강식품",
        state: "확정",
        price: 20000,
      })
    ).data;
    const p = (
      await h.call(
        "/drafts",
        "POST",
        draft(c2.id, { channel: "manual_dm", dealIds: [d.id] }),
      )
    ).data;
    await h.call("/deal/" + d.id, "PUT", {
      ...d,
      price: 22000,
      version: d.version,
    });
    assert.equal(
      (
        await h.call("/drafts/" + p.id + "/send", "POST", {
          hash: p.hash,
          approved: true,
          manuallySent: true,
        })
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});

test("copy editor keeps main template intact while AI changes intro only; scheduling requires approval", async () => {
  const h = await harness();
  let browser;
  try {
    await h.login();
    const c = (await h.call("/candidate", "POST", brand())).data;
    await h.call("/settings", "PUT", {
      dailyLimit: 10,
      senderName: "테스트 사업자",
      senderAddress: "사업장 주소",
      senderPhone: "사업 연락처",
    });
    const main =
      "공통 본문은 변경하지 않습니다.\n{{제품명}} 제휴 조건을 문의드립니다.";
    const template = (
      await h.call("/template", "POST", {
        name: "내 공통 카피",
        channel: "이메일",
        subject: "(광고) 공동구매 제휴 문의",
        body: main,
        signature: "내 서명",
        aiEnabled: true,
      })
    ).data;
    assert.equal(template.aiEnabled, true);
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const p = await browser.newPage();
    await p.goto(h.base + "/app/");
    await p.waitForSelector("#auth-form");
    await p.locator("[name=email]").fill("owner@example.com");
    await p.locator("[name=password]").fill("only-test-password-12345");
    await p.locator("#auth-form button").click();
    await p.waitForSelector("#nav a");
    await p.goto(h.base + "/app/#templates");
    await p.getByRole("button", { name: "사용", exact: true }).click();
    assert.equal(
      await p.locator("#compose-form [name=body]").inputValue(),
      main,
    );
    let personalized = 0,
      scheduled = 0,
      captured;
    await p.route(h.base + "/api/personalize", async (r) => {
      personalized++;
      assert.deepEqual(r.request().postDataJSON(), { target: c.id, templateId: template.id });
      await r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          intro: "공개하신 아침 레시피 콘텐츠를 보고 연락드립니다.",
          evidence: [
            {
              url: "https://test.example/public-recipe",
              description: "공개 레시피",
              checked: "2026-10-21",
            },
          ],
        }),
      });
    });
    await p.getByRole("button", { name: "AI 도입부 1~2줄 생성" }).click();
    await p.waitForFunction(() =>
      document.querySelector("[name=intro]").value.includes("레시피"),
    );
    assert.equal(personalized, 1);
    assert.equal(
      await p.locator("#compose-form [name=body]").inputValue(),
      main,
    );
    await p.locator("[name=lawfulBasis]").fill("테스트용 사전 동의 확인 기록");
    await p.getByRole("button", { name: "수신자별 최종 미리보기" }).click();
    await p.waitForSelector("#send-approved");
    assert.match(
      await p.locator("#final-preview").textContent(),
      /레시피 콘텐츠.*\n\n공통 본문은 변경하지 않습니다\./s,
    );
    await p.route(h.base + "/api/schedule", async (r) => {
      scheduled++;
      captured = r.request().postDataJSON();
      await r.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test-job",
          run_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
    });
    await p.getByRole("button", { name: "승인한 내용 예약 자동 발송" }).click();
    assert.equal(scheduled, 0);
    await p.locator("#send-approved").check();
    await p.locator("#schedule-at").fill("2027-01-01T10:00");
    await p.getByRole("button", { name: "승인한 내용 예약 자동 발송" }).click();
    await p.waitForSelector("#modal:not([open])", { state: "attached" });
    assert.equal(scheduled, 1);
    assert.equal(captured.approved, true);
    assert.ok(captured.draftId);
    assert.ok(captured.hash);
    assert.equal((await h.call("/state")).data.outbox.length, 0);
    assert.equal((await h.call("/state")).data.templates[0].body, main);
  } finally {
    if (browser) await browser.close();
    await h.close();
  }
});
