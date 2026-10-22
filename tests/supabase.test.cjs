const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { PGlite } = require("@electric-sql/pglite");
const { chromium } = require("@playwright/test");
const esbuild = require("esbuild");
const migration = fs.readFileSync(
  "supabase/migrations/202610210001_workspace.sql",
  "utf8",
);
async function database() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;`,
  );
  for (const step of [1, 2, 3])
    await db.exec(fs.readFileSync(`public/setup/0${step}.sql`, "utf8"));
  return db;
}
const u1 = "11111111-1111-4111-8111-111111111111",
  u2 = "22222222-2222-4222-8222-222222222222";
async function login(db, u) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u]);
  await db.exec("set role authenticated");
}
async function save(db, kind, data, id = null, version = null) {
  return (
    await db.query(
      "select * from public.sanji_save_record($1,$2::jsonb,$3::uuid,$4::integer)",
      [kind, JSON.stringify(data), id, version],
    )
  ).rows[0];
}
test("Supabase migration repeatability, membership, RLS, safe writes, optimistic versions and suppression", async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.query("insert into auth.users values($1,$2),($3,$4)", [
      u1,
      "one@test.example",
      u2,
      "two@test.example",
    ]);
    await db.query("insert into public.sanji_members(user_id) values($1)", [
      u1,
    ]);
    await login(db, u2);
    await assert.rejects(
      () => save(db, "candidate", { name: "unauthorized", kind: "브랜드" }),
      /권한/,
    );
    await login(db, u1);
    const brand = await save(db, "candidate", {
      name: "사용자 확인 브랜드",
      company: "공급 법인",
      kind: "브랜드",
    });
    assert.equal(brand.data.companyKey, "공급법인");
    assert.equal(brand.data.contact.email, "");
    await assert.rejects(
      () =>
        save(db, "candidate", {
          name: "중복 법인",
          company: "공급 법인",
          kind: "브랜드",
        }),
      /duplicate/,
    );
    await assert.rejects(
      () =>
        save(db, "candidate", {
          name: "위험 링크",
          kind: "크리에이터",
          profile: "javascript:alert(1)",
        }),
      /HTTPS/,
    );
    await assert.rejects(
      () =>
        save(db, "candidate", {
          name: "수치 무근거",
          kind: "크리에이터",
          followers: 30000,
        }),
      /출처/,
    );
    await assert.rejects(
      () => db.exec(`update public.sanji_records set version=999`),
      /permission/,
    );
    let deal = await save(db, "deal", { name: "협의 상품", brand: brand.id });
    assert.equal(deal.data.price, null);
    const updated = await save(
      db,
      "deal",
      { ...deal.data, price: 25000, state: "확정" },
      deal.id,
      1,
    );
    assert.equal(updated.version, 2);
    assert.equal(updated.data.history[0].price, null);
    await assert.rejects(
      () => save(db, "deal", { ...deal.data, price: 30000 }, deal.id, 1),
      /다른 변경/,
    );
    const blocked = await save(db, "candidate", {
      name: "거절 대상",
      kind: "크리에이터",
      handle: "public_handle",
      status: "수신 거부",
    });
    assert.ok(
      (await db.query("select * from public.sanji_suppression")).rows.some(
        (r) => r.identity === "instagram:public_handle",
      ),
    );
    await db.exec("reset role");
    await db.query("insert into public.sanji_members(user_id) values($1)", [
      u2,
    ]);
    await login(db, u2);
    assert.equal(
      (await db.query("select * from public.sanji_records")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        save(db, "candidate", { name: "침범", kind: "브랜드" }, brand.id, 1),
      /찾을 수/,
    );
    await assert.rejects(
      () => db.exec("select * from public.sanji_connections"),
      /permission/,
    );
    await db.exec("reset role");
    await db.exec("set role anon");
    assert.equal(
      (
        await db
          .query("select count(*)::int n from public.sanji_records")
          .catch(() => ({ rows: [{ n: 0 }] }))
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("Postgres send reservation is single use, stale-version aware and service-only", async () => {
  const db = await database();
  try {
    await db.query("insert into auth.users values($1,$2)", [
      u1,
      "owner@test.example",
    ]);
    await db.query("insert into public.sanji_members(user_id) values($1)", [
      u1,
    ]);
    await login(db, u1);
    const c = await save(db, "candidate", { name: "수신자", kind: "브랜드" }),
      d = await save(db, "deal", {
        name: "확정 상품",
        brand: c.id,
        state: "확정",
      });
    await assert.rejects(
      () =>
        db.query("select public.sanji_reserve_dispatch($1,$2,$3,$4)", [
          u1,
          crypto.randomUUID(),
          "hash",
          "fingerprint",
        ]),
      /permission/,
    );
    await db.exec("reset role");
    const id = crypto.randomUUID(),
      payload = {
        target: c.id,
        targetVersion: c.version,
        channel: "manual_dm",
        dealVersions: [{ id: d.id, version: d.version }],
        attachmentSummary: [],
      };
    await db.query(
      "insert into public.sanji_drafts(id,owner,data,hash,expires) values($1,$2,$3,'approved-hash',now()+interval '15 minutes')",
      [id, u1, JSON.stringify(payload)],
    );
    await db.exec("set role service_role");
    const row = (
      await db.query(
        "select * from public.sanji_reserve_dispatch($1,$2,$3,$4)",
        [u1, id, "approved-hash", "unique-fingerprint"],
      )
    ).rows[0];
    assert.equal(row.status, "submitting");
    await assert.rejects(
      () =>
        db.query("select public.sanji_reserve_dispatch($1,$2,$3,$4)", [
          u1,
          id,
          "approved-hash",
          "again",
        ]),
      /만료|중복/,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from public.sanji_outbox"))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("Edge function compiles and denies unauthenticated/disallowed-origin requests", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sanji-edge-")),
    file = path.join(dir, "edge.mjs");
  await esbuild.build({
    entryPoints: ["supabase/functions/workspace/index.ts"],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "npm-imports",
        setup(build) {
          build.onResolve({ filter: /^npm:/ }, (args) => ({
            path: args.path.replace(/^npm:/, "").replace(/@\d[^/]*$/, ""),
            external: true,
          }));
        },
      },
    ],
  });
  let handler;
  const previous = global.Deno;
  global.Deno = {
    env: {
      get: (n) =>
        n === "SUPABASE_URL"
          ? "https://project.example"
          : n === "SUPABASE_SERVICE_ROLE_KEY"
            ? "test-service-only-key"
            : "",
    },
    serve: (h) => {
      handler = h;
    },
  };
  const localFile = path.resolve("node_modules/.cache-edge-test.mjs");
  try {
    fs.copyFileSync(file, localFile);
    await import("file://" + localFile + "?" + Date.now());
    assert.equal(
      (await handler(new Request("https://project.example/workspace/health")))
        .status,
      200,
    );
    assert.equal(
      (
        await handler(
          new Request("https://project.example/workspace/jobs/run", {
            method: "POST",
          }),
        )
      ).status,
      503,
    );
    for (const prefix of [
      "/workspace",
      "/functions/v1/workspace",
      "/bright-function",
      "/functions/v1/bright-function",
    ]) {
      const health = await handler(
        new Request("https://project.example" + prefix + "/health"),
      );
      assert.equal(health.status, 200);
      assert.equal((await health.json()).version, 12);
      const callback = await handler(new Request("https://project.example" + prefix + "/oauth/instagram/callback"));
      assert.equal(callback.status, 302);
      const back = new URL(callback.headers.get("location"));
      assert.equal(back.origin, "https://dothegy.github.io");
      assert.match(back.searchParams.get("oauth_error"), /state/);
      assert.equal(back.hash, "#settings");
      assert.equal(await callback.text(), "");
      assert.equal(
        (
          await handler(
            new Request("https://project.example" + prefix + "/connections"),
          )
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await handler(
          new Request("https://project.example/workspace/connections", {
            headers: { Origin: "https://attacker.example" },
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await handler(
          new Request("https://project.example/workspace/connections", {
            method: "OPTIONS",
            headers: { Origin: "https://dothegy.github.io" },
          }),
        )
      ).status,
      204,
    );
  } finally {
    global.Deno = previous;
    fs.rmSync(localFile, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Published Supabase UI renders login without any demo data (mocked Auth only)", async () => {
  const express = require("express"),
    app = express();
  app.use(express.static("public"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "http://127.0.0.1:" + server.address().port + "/workspace/",
    );
    await page.waitForSelector("#auth-form");
    assert.match(await page.locator("h1").textContent(), /반갑습니다/);
    assert.equal(await page.locator("#nav a").count(), 0);
    assert.ok(
      !(await page.locator("#app").textContent()).includes("온유뉴트리"),
    );
    await page.locator("[name=email]").fill("owner@test.example");
    await page.locator("[name=password]").fill("a-test-password");
    await page.route(
      "https://ofasbfpeapbdcotnptvz.supabase.co/auth/v1/token**",
      (r) =>
        r.fulfill({
          status: 400,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          }),
        }),
    );
    await page.locator("#auth-form button").click();
    await page.waitForFunction(() =>
      document.querySelector("#auth-error").textContent.includes("Invalid"),
    );
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
});

test("approved scheduling: ownership, business hours, cancellation and single-claim processing", async () => {
  const db = await database();
  try {
    const sql = fs.readFileSync(
      "supabase/migrations/202610210002_automation.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    await db.query("insert into auth.users values($1,$2)", [
      u1,
      "owner@test.example",
    ]);
    await db.query("insert into public.sanji_members(user_id) values($1)", [
      u1,
    ]);
    await login(db, u1);
    const c = await save(db, "candidate", {
      name: "예약 수신자",
      kind: "브랜드",
    });
    await assert.rejects(
      () =>
        db.query("select public.sanji_schedule_dispatch($1,$2,$3,now())", [
          u1,
          crypto.randomUUID(),
          "hash",
        ]),
      /permission/,
    );
    await db.exec("reset role");
    const draftId = crypto.randomUUID(),
      payload = {
        target: c.id,
        targetVersion: c.version,
        channel: "email",
        marketing: true,
        dealVersions: [],
        attachmentSummary: [],
      };
    await db.query(
      "insert into public.sanji_drafts(id,owner,data,hash,expires) values($1,$2,$3,'approved-hash',now()+interval '15 minutes')",
      [draftId, u1, JSON.stringify(payload)],
    );
    await db.exec("set role service_role");
    const date = new Date(Date.now() + 86400000);
    date.setUTCHours(1, 0, 0, 0);
    const time = date.toISOString();
    await assert.rejects(
      () =>
        db.query("select public.sanji_schedule_dispatch($1,$2,$3,$4)", [
          u1,
          draftId,
          "forged-hash",
          time,
        ]),
      /해시|만료/,
    );
    const night = new Date(date);
    night.setUTCHours(14);
    await assert.rejects(
      () =>
        db.query("select public.sanji_schedule_dispatch($1,$2,$3,$4)", [
          u1,
          draftId,
          "approved-hash",
          night.toISOString(),
        ]),
      /08~21/,
    );
    const job = (
      await db.query(
        "select * from public.sanji_schedule_dispatch($1,$2,$3,$4)",
        [u1, draftId, "approved-hash", time],
      )
    ).rows[0];
    assert.equal(job.status, "queued");
    assert.equal(
      (await db.query("select * from public.sanji_claim_job()")).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.query(
      "update public.sanji_jobs set run_at=now()-interval '1 minute' where id=$1",
      [job.id],
    );
    await db.exec("set role service_role");
    const claimed = (await db.query("select * from public.sanji_claim_job()"))
      .rows[0];
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.attempts, 1);
    assert.equal(
      (await db.query("select * from public.sanji_claim_job()")).rows.length,
      0,
    );
    await login(db, u1);
    await assert.rejects(
      () => db.query("select public.sanji_cancel_job($1)", [job.id]),
      /처리 중|취소/,
    );
    await db.exec("reset role");
    const second = crypto.randomUUID();
    await db.query(
      "insert into public.sanji_drafts(id,owner,data,hash,expires) values($1,$2,$3,'second-hash',now()+interval '15 minutes')",
      [second, u1, JSON.stringify({ ...payload, target: crypto.randomUUID() })],
    );
    const secondJob = crypto.randomUUID();
    await db.query(
      "insert into public.sanji_jobs(id,owner,draft_id,preview_hash,run_at) values($1,$2,$3,'second-hash',now()+interval '1 hour')",
      [secondJob, u1, second],
    );
    await login(db, u1);
    await db.query("select public.sanji_cancel_job($1)", [secondJob]);
    assert.equal(
      (
        await db.query("select status from public.sanji_jobs where id=$1", [
          secondJob,
        ])
      ).rows[0].status,
      "cancelled",
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select used from public.sanji_drafts where id=$1", [
          second,
        ])
      ).rows[0].used,
      true,
    );
  } finally {
    await db.close();
  }
});

test("AI intro uses public evidence only and rejects sensitive claims, invented references and long rewrites", async () => {
  const result = await esbuild.build({
    entryPoints: ["supabase/functions/_shared/personalization.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  });
  const m = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(m, m.exports);
  const { publicContext, validateIntro } = m.exports;
  assert.throws(
    () => publicContext({ name: "미확인", topics: [], evidence: [] }),
    /근거/,
  );
  const c = publicContext({
    name: "작성자",
    kind: "크리에이터",
    email: "private@example.com",
    note: "절대 AI로 전송하면 안 되는 내부 협상 메모",
    followers: 1234,
    topics: ["식물성 레시피"],
    evidence: [
      {
        url: "https://creator.example/post/1",
        description: "공개된 식물성 아침 레시피 콘텐츠",
        checked: "2026-10-21",
      },
    ],
  });
  assert.ok(!JSON.stringify(c).includes("private@"));
  assert.ok(!JSON.stringify(c).includes("협상"));
  const r = validateIntro(
    {
      intro: "공개하신 식물성 아침 레시피 콘텐츠를 보고 연락드립니다.",
      evidenceIds: ["1"],
    },
    c,
  );
  assert.equal(r.evidence.length, 1);
  assert.throws(
    () =>
      validateIntro(
        { intro: "공개 콘텐츠를 보고 연락드립니다.", evidenceIds: ["99"] },
        c,
      ),
    /근거/,
  );
  assert.throws(
    () =>
      validateIntro(
        { intro: "질환을 치료하는 상품을 제안합니다.", evidenceIds: ["1"] },
        c,
      ),
    /민감정보|효능/,
  );
  assert.throws(
    () =>
      validateIntro(
        {
          intro: "문장입니다. 두 번째입니다. 세 번째입니다.",
          evidenceIds: ["1"],
        },
        c,
      ),
    /1~2문장/,
  );
});

test("deployment diagnostics distinguish missing function from JWT rejection in the browser", async () => {
  const express = require("express"),
    app = express();
  app.use(express.static("public"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    let status = 404,
      body = { code: "NOT_FOUND", message: "Requested function was not found" };
    await page.route(
      "https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/health",
      (r) =>
        r.fulfill({
          status,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/connect/");
    await page.getByRole("button", { name: "배포 상태 확인" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("함수를 찾을 수 없습니다(404)"),
    );
    status = 401;
    body = { error: "로그인이 필요합니다." };
    await page.getByRole("button", { name: "배포 상태 확인" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("함수는 실행되지만"),
    );
    status = 401;
    body = { code: 401, message: "Missing authorization header" };
    await page.getByRole("button", { name: "배포 상태 확인" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("401로 차단"),
    );
    status = 503;
    body = { code: "BOOT_ERROR", message: "Worker failed to boot" };
    await page.getByRole("button", { name: "배포 상태 확인" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("BOOT_ERROR"),
    );
    status = 200;
    body = { ok: true, version: 2 };
    await page.getByRole("button", { name: "배포 상태 확인" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("함수 연결 정상"),
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
});

test("Instagram replies retain the receiving account; legacy ambiguous and removed accounts fail closed", async () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/instagram-accounts.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const module = { exports: {} };
  new Function("module", "exports", compiled.outputFiles[0].text)(module, module.exports);
  const { selectInstagramAccount: pick, sameInstagramConversation: same } = module.exports;
  const a = { provider: "instagram:111" }, b = { provider: "instagram:222" };
  assert.equal(pick([a,b], { connectionKey: a.provider }), a);
  assert.equal(pick([b], { connectionKey: a.provider }), null);
  assert.equal(pick([a,b], {}), null);
  assert.equal(pick([a], {}), a);
  const t = { channel: "instagram", connectionKey: a.provider, senderId: "customer" };
  assert.equal(same(t, a.provider, "customer"), true);
  assert.equal(same(t, b.provider, "customer"), false);
  assert.equal(same(t, a.provider, "other"), false);
});

test("OAuth expiry distinguishes missing, consumed and expired requests and redirects safely to the UTF-8 frontend", () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/oauth-status.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", compiled.outputFiles[0].text)(m, m.exports);
  const { oauthStateProblem: problem, oauthLifetimeMs: ttl, oauthErrorRedirect: redirect } = m.exports;
  assert.equal(ttl, 1800000);
  assert.match(problem("", null), /state/);
  assert.match(problem("used", null), /이미 처리/);
  assert.match(problem("old", {expires: new Date(0).toISOString()}, ttl), /30분/);
  assert.match(problem("bad", {expires: "bad"}), /30분/);
  assert.equal(problem("valid", {expires: new Date(ttl).toISOString()}, 0), "");
  const url = new URL(redirect("연결 실패 <script>bad</script>", "https://app.example/"));
  assert.equal(url.origin, "https://app.example");
  assert.equal(url.searchParams.get("oauth_error"), "연결 실패 <script>bad</script>");
  assert.equal(url.hash, "#settings");
});

test("Gmail health checks only account and granted scopes, never invokes send or returns tokens", async () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/gmail-check.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", compiled.outputFiles[0].text)(m, m.exports);
  const urls = [];
  const result = await m.exports.checkGmail({ access_token: "private-test-token", email: "sender@example.test" }, async (url) => {
    urls.push(url);
    return url.includes("/profile") ? {emailAddress: "sender@example.test"} : {scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"};
  }, false);
  assert.equal(result.accountMatches, true); assert.equal(result.sendPermission, true); assert.equal(result.readPermission, true);
  assert.equal(result.sendingEnabled, false); assert.equal(result.emailSent, false);
  assert.equal(urls.length, 2); assert.equal(urls.some(u => u.includes("/send")), false);
  assert.equal(JSON.stringify(result).includes("private-test-token"), false);
  const missing = await m.exports.checkGmail({email: "a"}, async () => ({}), false);
  assert.equal(missing.sendPermission, false); assert.equal(missing.accountMatches, false);
});

test("Personalization fills only the requested inline slot, preserving the surrounding user copy", () => {
  const source = fs.readFileSync("private/ui/app.js", "utf8");
  const start = source.indexOf("function assemblePersonalization("), end = source.indexOf("\n}\n", start) + 2;
  const assemble = new Function(source.slice(start,end) + ";return assemblePersonalization;")();
  const original = "안녕하세요, {{브랜드명}} 담당자님.\n고정 제안 문구\n\n{{개인화}}\n\n회사 소개 원문";
  assert.equal(assemble(original, "특징 근거 한 문장.\n적합성 근거 한 문장."), original.replace("{{개인화}}", "특징 근거 한 문장.\n적합성 근거 한 문장."));
  assert.throws(() => assemble(original, ""), /생성하거나 직접 입력/);
  assert.equal(assemble("기존 카피", "도입부"), "도입부\n\n기존 카피");
  assert.equal(assemble("기존 카피", ""), "기존 카피");
});

test("Provider error diagnosis retains useful codes while redacting OAuth credentials", () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/oauth-status.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", compiled.outputFiles[0].text)(m, m.exports);
  const detail = m.exports.providerErrorDetail("https://graph.instagram.com/me?access_token=private-token-123", {body: new URLSearchParams({client_secret: "private-secret-456", code: "private-code-789"})}, {error: {code: 100, message: "Invalid field user_id for private-token-123 private-secret-456 private-code-789"}});
  assert.match(detail, /100/); assert.match(detail, /Invalid field user_id/);
  assert.equal(detail.includes("private-"), false);
});

test("Instagram token exchange supports current data-array and legacy responses, rejecting empty tokens before next request", () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/instagram-token.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", compiled.outputFiles[0].text)(m, m.exports);
  const parse = m.exports.instagramTokenResponse;
  assert.equal(parse({ data: [{access_token: "test-new-token",user_id:"123"}] }).access_token, "test-new-token");
  assert.equal(parse({access_token:"test-legacy-token"}).access_token, "test-legacy-token");
  assert.equal(parse({data:[{access_token:"test-long-token",expires_in:5183944}]}, true).expires_in, 5183944);
  for (const response of [{}, {data:[]}, {data:[{}]}, {access_token:""}, {access_token:null}])
    assert.throws(() => parse(response), /유효한 토큰/);
  assert.throws(() => parse({access_token:"test-long-token"},true), /유효기간/);
  assert.throws(() => parse({access_token:"test-long-token",expires_in:-1},true), /유효기간/);
});

test("Instagram follows the documented long-token exchange then verifies profile and bounds short sessions", async () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/instagram-session.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", compiled.outputFiles[0].text)(m, m.exports);
  const resolve = m.exports.resolveInstagramSession;
  const profile = {id:"111",user_id:"222",username:"test-account"}, calls=[];
  const temp = await resolve({data:[{access_token:"test-short"}]}, async (url) => {
    calls.push(url); if (url.includes("/me?")) return profile;
    throw Error("Unsupported request - method type: get");
  }, "test-secret", "v24.0", 1000);
  assert.equal(temp.tokenMode,"short"); assert.equal(temp.id,"222");
  assert.equal(temp.expires,901000); assert.equal(temp.expiryKnown,false);
  assert.match(temp.warning,/장기 토큰 교환 미완료/); assert.match(temp.warning,/15분/);
  assert.ok(calls[0].includes("/access_token?")); assert.ok(calls[1].includes("/me?"));
  let requests = 0;
  await assert.rejects(() => resolve({access_token:"test-invalid"}, async () => { requests++; throw Error("invalid profile token"); }, "test-secret", "v24.0"), /invalid profile/);
  assert.equal(requests,2);
  const full = await resolve({access_token:"test-short"}, async (url) => url.includes("/me?") ? profile : {access_token:"test-long",expires_in:5183944}, "test-secret", "v24.0", 1000);
  assert.equal(full.tokenMode,"long"); assert.equal(full.warning,""); assert.equal(full.expires,5183945000);
});

test("Actual Edge MIME supports Unicode replies, binary documents and image attachments without pretending inline images", () => {
  const compiled = esbuild.buildSync({ entryPoints: ["supabase/functions/_shared/mail-mime.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} }; new Function("module", "exports", "require", compiled.outputFiles[0].text)(m, m.exports, require);
  const image = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString("base64");
  const raw = Buffer.from(m.exports.mime({email:"recipient@example.test",subject:"Re: 제안 회신",messageId:"test-id",inReplyTo:"<parent@example.test>\r\nBcc: attacker@example.test",references:"<first@example.test>",body:"검토 감사합니다. 자료를 첨부합니다.",attachments:[{name:"자료.pdf",content:Buffer.from("%PDF-1.7\nexample").toString("base64")},{name:"제품.png",content:image}]}, "sender@example.test"),"base64url").toString();
  assert.match(raw,/In-Reply-To: <parent@example.test>\r\nReferences: <first@example.test> <parent@example.test>/);
  assert.equal(raw.includes("Bcc:"),false); assert.match(raw,/multipart\/mixed/);
  assert.match(raw,/Content-Type: image\/png/);assert.match(raw,/Content-Type: application\/pdf/);
  assert.ok(raw.includes(image)); assert.ok(raw.includes(encodeURIComponent("제품.png")));
  assert.equal((raw.match(/Content-Disposition: attachment/g)||[]).length,2);
  assert.equal(raw.includes("Content-Disposition: inline"),false);
});

function discoveryHelpers(){
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery.ts"],bundle:true,platform:"node",format:"cjs",write:false});
 const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);return m.exports;
}
test("Email discovery includes official general and customer mail, labels ownership and excludes placeholders, privacy, recruitment and platform owners",()=>{
 const {parseOfficialPage,shoppingProspects,companyIdentity}=discoveryHelpers();
 const r=parseOfficialPage('<p>대표 이메일 info@brand.co.kr</p><p>고객센터 cs@brand.co.kr</p><div>'+ ' '.repeat(250) +'</div><p>제휴 문의 b2b@brand.co.kr</p><input placeholder="user@gmail.com"><p>privacy@brand.co.kr hr@brand.co.kr</p><p>플랫폼 support@cafe24.com godo@godo.co.kr</p><p>기술 담당 webmaster@brand.co.kr nbtusa.it@brand.co.kr</p><p>브랜드 공개 brandbusiness@gmail.com</p>',"https://www.brand.co.kr/","2026-10-21");
 assert.ok(r.contacts.some(c=>c.email==="info@brand.co.kr"));assert.ok(r.contacts.some(c=>c.email==="cs@brand.co.kr"));assert.ok(r.contacts.some(c=>c.email==="b2b@brand.co.kr"));
 assert.equal(r.contacts.some(c=>c.email.includes("privacy@")||c.email.includes("hr@")||c.email==="support@cafe24.com"||c.email==="user@gmail.com"||c.email==="godo@godo.co.kr"||c.email==="webmaster@brand.co.kr"||c.email==="nbtusa.it@brand.co.kr"),false);
 assert.equal(r.contacts.find(c=>c.email==="brandbusiness@gmail.com").domainMatch,false);
 assert.equal(r.contacts.every(c=>c.verified===false),true);
 const items=shoppingProspects([{brand:"테스트 브랜드",maker:"제조사 A",title:"<b>건강</b> 상품",link:"https://www.coupang.com/x",mallName:"쿠팡"},{brand:"테스트 브랜드",title:"다른 SKU"},{brand:"쿠팡"}],"건강식품","2026-10-21");
 assert.equal(items.length,1);assert.equal(items[0].company,"");assert.equal(items[0].manufacturerClaim,"제조사 A");assert.equal(companyIdentity("(주) 테스트 회사"),companyIdentity("주식회사테스트회사"));
});
test("Discovery blocks private targets, honors robots and distinguishes marketplace discovery from official sites",()=>{
 const {publicUrl,publicIp,robotsAllowed,marketplace}=discoveryHelpers();
 for(const u of ["http://brand.co.kr","https://127.0.0.1","https://169.254.169.254","https://localhost","https://x.internal","https://user:pass@brand.co.kr"] )assert.throws(()=>publicUrl(u));
 for(const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.0.1","169.254.169.254","::1","fc00::1"])assert.equal(publicIp(ip),false);
 assert.equal(publicIp("172.67.1.2"),true);assert.equal(publicIp("8.8.8.8"),true);
 assert.equal(robotsAllowed("User-agent: *\nDisallow: /private/", "/private/contact"),false);
 assert.equal(robotsAllowed("User-agent: *\nDisallow: /", "/"),false);
 assert.equal(robotsAllowed("User-agent: *\nDisallow: /private/", "/contact"),true);
 assert.equal(marketplace("https://smartstore.naver.com/brand"),true);assert.equal(marketplace("https://www.coupang.com/x"),true);assert.equal(marketplace("https://brand.co.kr"),false);assert.equal(marketplace("https://foodbrand.cafe24.com"),false);assert.equal(marketplace("https://www.cafe24.com"),true);
});
test("Discovery schema is repeatable, tenant private and daily claims cannot overlap",async()=>{
 const db=await database();try{
  const sql=fs.readFileSync("supabase/migrations/202610210003_discovery.sql","utf8");await db.exec(sql);await db.exec(sql);
  await db.query("insert into auth.users values($1,$2),($3,$4)",[u1,"one@test.example",u2,"two@test.example"]);await db.query("insert into public.sanji_members(user_id) values($1),($2)",[u1,u2]);
  await db.query("insert into public.sanji_discovery_leads(owner,identity,data) values($1,'brand','{\"name\":\"brand\"}')",[u1]);
  await login(db,u2);assert.equal((await db.query("select * from public.sanji_discovery_leads")).rows.length,0);
  await assert.rejects(()=>db.query("select public.sanji_discovery_claim($1)",[u2]),/permission denied/);
  await db.exec("reset role");const first=(await db.query("select * from public.sanji_discovery_claim($1)",[u1])).rows[0];assert.equal(first.calls,1);
  const second=(await db.query("select * from public.sanji_discovery_claim($1)",[u1])).rows[0];assert.equal(second.owner,null);
  await login(db,u1);assert.equal((await db.query("select * from public.sanji_discovery_leads")).rows.length,1);
 }finally{await db.close();}
});

test("Instagram login response status never pretends API verification or persists access tokens",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/instagram-token.ts"],bundle:true,platform:"node",format:"cjs",write:false});
 const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
 const result=m.exports.instagramLoginPending({access_token:"private-token-not-for-status",user_id:"1234"},"API check pending",0);
 assert.equal(result.connected,false);assert.equal(result.apiVerified,false);assert.equal(result.authorizationResponseReceived,true);assert.equal(result.subject,"1234");
 assert.equal(JSON.stringify(result).includes("private-token-not-for-status"),false);assert.equal(result.access_token,undefined);
});

test("Gmail replies address the actual Reply-To sender and reject ambiguous or injected mailbox headers",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/mail-reply.ts"],bundle:true,platform:"node",format:"cjs",write:false});
 const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);const {singleMailbox,replyRecipient}=m.exports;
 assert.equal(singleMailbox('담당자 <buyer@brand.example.test>'),"buyer@brand.example.test");
 assert.equal(singleMailbox('Buyer <buyer@brand.example.test>\r\nBcc: stranger@example.test'),"");
 assert.equal(singleMailbox('a@example.test, b@example.test'),"");
 const selected=replyRecipient({from:'담당자 <buyer@brand.example.test>',replyToHeader:'제휴팀 <partner@brand.example.test>'},"info@brand.example.test");
 assert.equal(selected.email,"partner@brand.example.test");assert.equal(selected.changed,true);
 assert.equal(replyRecipient(null,"info@brand.example.test").email,"info@brand.example.test");
 assert.throws(()=>replyRecipient({from:"invalid"},"info@brand.example.test"),/회신 주소/);
});

test("Brand email workspace reviews all company addresses directly, preserves copy and requires final approval", async () => {
 const express=require("express"),app=express();app.use(express.json());
 const copy={subject:"브랜드A 제안",body:"안녕하세요 브랜드A 담당자님.\n구체적인 제품 특징입니다. 콘텐츠 적합성입니다.\n공통 본문 그대로",signature:"원본 서명",brandName:"브랜드A",productName:"제품A"};
 const lead={id:"lead-a",data:{name:"법인A",contacts:[{email:"a@brand.example",source:"https://brand.example"},{email:"cs@brand.example",source:"https://brand.example"}],outreach:copy}};
 const state={candidates:[],deals:[],templates:[],threads:[],outbox:[],jobs:[],suppression:[],settings:{dailyLimit:20,senderAddress:"주소"}};
 let saved=0,prepared=0,scheduled=0,sends=0;const drafted=[];
 app.all(/^\/api\/.*/, (req,res)=>{const p=req.path.replace("/api","");
 if(p==="/me")return res.json({email:"owner@example.test",csrf:"test"});
 if(p==="/state")return res.json(state);
 if(p==="/connections")return res.json({gmail:{connected:true},instagram:{},ai:{}});
 if(p==="/discovery")return res.json({settings:{enabled:true,target:30,keywords:[]},leads:[lead],usage:{emails:2},activity:[]});
 if(p==="/discovery/outreach"){saved++;return res.json({ok:true});}
 if(p==="/discovery/prepare-contact"){prepared++;return res.json({candidateId:"candidate-a"});}
 if(p==="/drafts"){drafted.push(req.body);return res.json({id:"draft-a",hash:"hash-a",target:"브랜드A",emails:lead.data.contacts.map(c=>c.email),subject:req.body.subject,body:req.body.body+"\n"+req.body.signature,attachments:[]});}
 if(p==="/schedule"){scheduled++;return res.json({run_at:req.body.runAt});}
 if(p.endsWith("/send"))sends++;
 return res.status(404).json({error:p});});app.use("/app",express.static("private/ui"));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.on("listening",r));let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});const page=await browser.newPage();
 await page.goto("http://127.0.0.1:"+server.address().port+"/app/#brands");await page.locator('[data-action="mail-review"]').click();
 assert.equal(await page.locator('select[name=email]').count(),0);
 assert.match(await page.locator('.recipient-list').textContent(),/a@brand.example.*cs@brand.example/);
 assert.equal(await page.locator('[name=companyName]').inputValue(),"브랜드A");
 assert.equal(await page.locator('[name=body]').inputValue(),copy.body);
 await page.locator('[data-action="mail-save"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes("저장"));assert.equal(saved,1);assert.equal(prepared,0);assert.equal(scheduled,0);
 await page.locator('[name=ownership]').check();await page.locator('#mail-review-form button[type=submit]').click();await page.waitForSelector('[name=bulk-approve]');
 assert.equal(drafted[0].marketing,false);assert.equal(drafted[0].recipientMode,"company_all");assert.equal(drafted[0].body,copy.body);assert.equal(drafted[0].subject,copy.subject);assert.equal(scheduled,0);
 assert.match(await page.locator('#mail-final').textContent(),/a@brand.example, cs@brand.example/);
 await page.locator('[name=body]').fill(copy.body+" 수정");assert.equal(await page.locator('[name=bulk-approve]').count(),0);
 await page.locator('#mail-review-form button[type=submit]').click();await page.waitForSelector('[name=bulk-approve]');await page.locator('[name=bulk-approve]').check();await page.locator('#bulk-run-at').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await page.locator('[data-action="mail-schedule"]').click();await page.waitForFunction(()=>document.querySelector('#bulk-result-0').textContent.includes("예약 완료"));assert.equal(scheduled,1);assert.equal(sends,0);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test("Discovery works without search API keys and reports exhausted sources instead of pretending to collect", async()=>{
  const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-service.ts"],bundle:true,platform:"node",format:"cjs",write:false});
  const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
  const stored={sanji_discovery_config:{enabled:true,target:30,keywords:[],updated:new Date().toISOString()},sanji_discovery_leads:[],sanji_discovery_usage:{calls:3,emails:1,processed:3},history:[]};
  const sb={rpc:()=>({table:"history"}),from(table){const q={table};for(const k of ["select","eq","order","limit","maybeSingle"])q[k]=()=>q;return q;}};
  const service=m.exports.discoveryService({sb,query:async q=>stored[q.table],audit:async()=>{},putRecord:async()=>{}});
  const r=await service.handle("/discovery","GET","owner",async()=>({}));assert.equal(r.engine.status,"sources_exhausted");assert.equal(r.engine.nextRun,null);assert.equal(r.engine.mode,"public_sources_and_homepages");
  const result=await service.handle("/discovery/run","POST","owner",async()=>({}));assert.equal(result.status,"sources_exhausted");assert.equal(JSON.stringify(result).includes("네이버"),false);
});

test("Footer parsing recognizes linked corporate official sites and keeps customer mail separate from privacy contacts",()=>{
 const {parseOfficialPage}=discoveryHelpers();
 const r=parseOfficialPage('<div class="site footer"><p>고객센터 cs3900&#64;brand.co.kr</p><p>개인정보보호책임자 protect@brand.co.kr</p><a href="https://company.brand.co.kr">브랜드 오피셜</a></div>',"https://www.brand.co.kr/","2026-10-21");
 assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].location,"footer");assert.equal(r.links[0].type,"company");
});

test("Footer discovery follows an explicitly linked shop without a search key, decodes emails and preserves user supplied leads",async()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-service.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
 const lead={id:"lead",owner:"owner",status:"new",created:new Date().toISOString(),data:{name:"테스트 식품",website:"https://www.brand.co.kr/",contacts:[{email:"submitted@brand.co.kr",source:"https://www.google.com/search?q=brand",discoveryMethod:"user_provided",checked:new Date().toISOString()}]}};
 const tables={sanji_discovery_config:[{owner:"owner",enabled:true,target:30,keywords:[]}],sanji_discovery_leads:[lead],sanji_discovery_usage:[{owner:"owner",day:"2026-10-21",calls:1,added:0,processed:0,emails:0}]};
 class Q {constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push([k,v]);return this;}order(){return this;}limit(){return this;}maybeSingle(){this.single=true;return this;}update(value){this.value=value;return this;}exec(){let rows=tables[this.table].filter(r=>this.filters.every(([k,v])=>r[k]===v));if(this.value)rows.forEach(r=>Object.assign(r,structuredClone(this.value)));return structuredClone(this.single?rows[0]||null:rows);}then(ok,bad){return Promise.resolve({data:this.exec(),error:null}).then(ok,bad);}}
 const sb={from:t=>new Q(t),rpc:()=>({exec:()=>tables.sanji_discovery_usage[0]})},seen=[],oldFetch=global.fetch,oldDeno=global.Deno;
 global.Deno={resolveDns:async()=>["8.8.8.8"]};
 global.fetch=async(value)=>{const u=String(value);seen.push(u);if(u.endsWith("/robots.txt"))return new Response("User-agent: *\nDisallow:",{headers:{"content-type":"text/plain"}});if(u==="https://www.brand.co.kr/")return new Response(null,{status:302,headers:{location:"https://brand.co.kr/"}});if(u==="https://brand.co.kr/")return new Response('<footer><p>대표 이메일 office@brand.co.kr</p><select><option value=https://shop.brand.co.kr/>온라인쇼핑몰(공식몰)</option></select><a href=https://www.unrelated.co.kr/>관계사</a></footer><script>fake@brand.co.kr</script>',{headers:{"content-type":"text/html"}});if(u==="https://shop.brand.co.kr/")return new Response('<footer><p>고객센터 <a href=mailto:cs3900%40brand.co.kr>cs3900&#64;brand.co.kr</a></p><p>개인정보보호책임자 privacy@brand.co.kr</p></footer>',{headers:{"content-type":"text/html"}});throw Error("Unexpected URL "+u);};
 try{
  const service=m.exports.discoveryService({sb,query:async q=>q.exec(),audit:async()=>{},putRecord:async()=>{}});
  const r=await service.handle("/discovery/run","POST","owner",async()=>({}));assert.equal(r.status,"processed");assert.equal(r.emailCandidatesAdded,2);
  assert.ok(seen.includes("https://shop.brand.co.kr/"));assert.equal(seen.some(u=>u.includes("unrelated")),false);
  const c=lead.data.contacts.find(c=>c.email==="cs3900@brand.co.kr");assert.ok(c);assert.equal(c.location,"footer");assert.equal(c.purpose,"고객센터");assert.equal(c.verified,false);assert.equal(c.linkedFrom,"https://brand.co.kr/");
  assert.ok(seen.indexOf("https://brand.co.kr/robots.txt")<seen.indexOf("https://brand.co.kr/"));
  assert.equal(lead.data.sourceAttempts[0].redirects[0],"https://www.brand.co.kr/");
  assert.ok(lead.data.contacts.some(c=>c.email==="submitted@brand.co.kr"));assert.equal(lead.data.contacts.some(c=>c.email==="privacy@brand.co.kr"||c.email==="fake@brand.co.kr"),false);assert.equal(lead.data.pages,2);assert.equal(lead.data.sourceAttempts.length,2);
 }finally{global.fetch=oldFetch;global.Deno=oldDeno;}
});

test("Company recipient groups deduplicate addresses and reject header injection",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/mail-mime.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports","require",compiled.outputFiles[0].text)(m,m.exports,require);
 const d={email:"a@brand.test",emails:["A@brand.test","cs@brand.test","a@brand.test"],subject:"제안",body:"내용",attachments:[],messageId:"group"};
 const raw=Buffer.from(m.exports.mime(d,"sender@example.test"),"base64url").toString();assert.match(raw,/To: a@brand.test, cs@brand.test\r\n/);
 assert.throws(()=>m.exports.mime({...d,emails:["a@brand.test\r\nBcc: b@other.test"]},"sender@example.test"),/수신 이메일/);
});

test("Template edits refresh only unsent owned leads, retain personalization, cancel old approval and preserve sent snapshots",async()=>{
 const db=await database();try{
 await db.exec(fs.readFileSync('supabase/migrations/202610210002_automation.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610210003_discovery.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610220001_mail_refresh.sql','utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[u1,'one@example.test',u2,'two@example.test']);
 await db.query('insert into sanji_members(user_id) values($1),($2)',[u1,u2]);
 const tid=(await db.query("insert into sanji_records(owner,kind,data) values($1,'template',$2::jsonb) returning id",[u1,JSON.stringify({name:'카피',channel:'이메일',subject:'{{브랜드명}} 제안',body:'안녕하세요 {{브랜드명}}.\n{{개인화}}\n{{제품명}} 공통 카피',signature:'서명'})])).rows[0].id;
 const targets=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
 for(let i=0;i<3;i++)await db.query("insert into sanji_discovery_leads(owner,identity,data,status) values($1,$2,$3::jsonb,'review')",[i===2?u2:u1,'brand'+i,JSON.stringify({name:'브랜드'+i,candidateId:targets[i]||'',contacts:[{email:'mail'+i+'@brand.test'}],outreach:{intro:'검증된 특징. 콘텐츠 적합성.',productName:'확인 제품',templateId:tid,body:'기존 원문'}})]);
 await db.query("insert into sanji_outbox(owner,target,channel,fingerprint,status,data) values($1,$2,'email','immutable','accepted',$3::jsonb)",[u1,targets[1],JSON.stringify({email:'mail1@brand.test',body:'이미 발송된 원문'})]);
 const draft=(await db.query("insert into sanji_drafts(owner,data,hash,expires) values($1,$2::jsonb,'old-hash',now()+interval '1 day') returning id",[u1,JSON.stringify({target:targets[0]})])).rows[0].id;
 await db.query("insert into sanji_jobs(owner,draft_id,preview_hash,run_at) values($1,$2,'old-hash',now()+interval '1 hour')",[u1,draft]);
 await db.query("update sanji_records set data=jsonb_set(data,'{body}',to_jsonb($1::text)),version=version+1 where id=$2",['안녕하세요 {{브랜드명}}.\n{{개인화}}\n{{제품명}} 공통 카피\nhttps://company.example/intro',tid]);
 const leads=(await db.query('select owner,identity,data from sanji_discovery_leads order by identity')).rows;
 assert.equal(leads[0].data.outreach.body,'안녕하세요 브랜드0.\n검증된 특징. 콘텐츠 적합성.\n확인 제품 공통 카피\nhttps://company.example/intro');assert.equal(leads[0].data.outreach.templateVersion,2);assert.equal(leads[0].data.outreach.approved,false);
 assert.equal(leads[1].data.outreach.body,'기존 원문');assert.equal(leads[2].data.outreach.body,'기존 원문');
 assert.equal((await db.query('select status from sanji_jobs')).rows[0].status,'cancelled');
 assert.equal((await db.query('select expires<now() expired from sanji_drafts')).rows[0].expired,true);
 assert.equal((await db.query('select data from sanji_outbox')).rows[0].data.body,'이미 발송된 원문');
 await db.query('insert into sanji_discovery_config(owner,enabled,target) values($1,true,40)',[u1]);
 assert.equal((await db.query('select sanji_claim_daily_sources($1) claimed',[u1])).rows[0].claimed,true);
 assert.equal((await db.query('select sanji_claim_daily_sources($1) claimed',[u1])).rows[0].claimed,false);
 await db.query("update sanji_discovery_config set source_state='{}'");assert.equal((await db.query('select sanji_claim_daily_sources($1) claimed',[u1])).rows[0].claimed,true);
 const proposed=[{identity:'new-source',data:{name:'새 업체',website:'https://new-brand.co.kr/',sourceEntity:'https://www.wikidata.org/entity/Q111'}},{identity:'same-domain',data:{website:'https://www.new-brand.co.kr/products'}},{identity:'same-entity',data:{website:'https://alternate-brand.co.kr/',sourceEntity:'https://www.wikidata.org/entity/Q111'}}];
 assert.equal((await db.query('select sanji_enqueue_discovery_sources($1,$2::jsonb) added',[u1,JSON.stringify(proposed)])).rows[0].added,1);
 assert.equal((await db.query('select sanji_enqueue_discovery_sources($1,$2::jsonb) added',[u1,JSON.stringify(proposed)])).rows[0].added,0);

 }finally{await db.close();}
});

test("Daily public sources deduplicate company names and domains without inventing contact addresses",()=>{
 const compiled=esbuild.buildSync({entryPoints:['supabase/functions/_shared/discovery-sources.ts'],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(m,m.exports);
 const known=[{identity:'기존회사',data:{website:'https://known-brand.co.kr/'}}];
 const rows=m.exports.sourceProspects([{name:'신규브랜드',website:'https://new-brand.co.kr',source:'https://directory.co.kr'},{name:'신규브랜드 다른 표기',website:'https://www.new-brand.co.kr'},{name:'기존회사',website:'https://changed-brand.co.kr'},{name:'다른 이름',website:'https://known-brand.co.kr/store'},{name:'플랫폼',website:'https://coupang.com'},{name:'비공개',website:'https://127.0.0.1'},{name:'Q123',website:'https://unnamed.co.kr'}],known,'2026-10-22');
 assert.equal(rows.length,1);assert.equal(rows[0].data.name,'신규브랜드');assert.deepEqual(rows[0].data.contacts,[]);assert.equal(rows[0].data.officialVerified,false);
});

test("Instagram capability checks distinguish real profile, conversation permission and webhook subscription without sending",async()=>{
 const compiled=esbuild.buildSync({entryPoints:['supabase/functions/_shared/instagram-session.ts'],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(m,m.exports);
 const calls=[];const yes=await m.exports.instagramCapabilities({id:'123',access_token:'mock-token'},async(url,opts)=>{calls.push({url,opts});return url.includes('/conversations?')?{data:[]}:{data:[{subscribed_fields:['messages']}]};},'v24.0');
 assert.equal(yes.messagesReadable,true);assert.equal(yes.webhookSubscribed,true);assert.equal(calls.every(c=>c.opts.method==='GET'),true);assert.equal(calls.some(c=>/\/messages(?:\?|$)/.test(c.url)),false);
 const no=await m.exports.instagramCapabilities({id:'123',access_token:'mock-token'},async()=>{throw Error('permission denied');},'v24.0');assert.equal(no.profileVerified,true);assert.equal(no.messagesReadable,false);assert.equal(no.webhookSubscribed,false);
});

test("Clean integration settings show expired Instagram auth honestly and offer profile-only login",async()=>{
 const express=require('express'),app=express();app.use(express.json());let loginBody;
 const state={candidates:[],deals:[],templates:[],threads:[],outbox:[],jobs:[],suppression:[],settings:{senderName:'운영자',senderAddress:'사업장',senderPhone:'번호',dailyLimit:20}};
 app.all(/^\/api\/.*/,(req,res)=>{const p=req.path.replace('/api','');
 if(p==='/me')return res.json({email:'owner@example.test'});if(p==='/state')return res.json(state);
 if(p==='/connections')return res.json({gmail:{connected:true,email:'owner@example.test',enabled:true},instagram:{accounts:[],loginPending:[{key:'instagram_login:123',username:'valu_est',userDesignated:true,detail:'이전 계정 조회 오류'}]}});
 if(p==='/discovery')return res.json({settings:{target:40,enabled:true,keywords:[]},engine:{sourceState:{checked:'2026-10-22T00:00:00Z',added:40}},leads:[],usage:{},activity:[]});
 if(p==='/oauth/instagram'){loginBody=req.body;return res.json({url:'#settings'});}return res.status(404).json({error:p});});app.use('/app',express.static('private/ui'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1365,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/#settings');await page.waitForSelector('#discovery-settings [name=target]');
 assert.equal(await page.locator('#discovery-settings [name=target]').inputValue(),'40');assert.match(await page.locator('.account-pending').textContent(),/재로그인 필요/);assert.equal(await page.getByText('로그인 응답 수신 · 계정 조회 대기',{exact:true}).count(),0);
 await page.locator('.account-pending [data-action=connect-instagram-basic]').click();assert.deepEqual(loginBody,{profileOnly:true});
 await page.screenshot({path:'/tmp/sanji-settings-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/sanji-settings-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test("Public shell redirects are bounded literal same-origin URLs and never execute login or external scripts",()=>{
 const {publicHtmlRedirect}=discoveryHelpers();
 assert.equal(publicHtmlRedirect('<script>location.href="/user/main/main.do";</script>','https://brand.co.kr/'),'https://brand.co.kr/user/main/main.do');
 assert.equal(publicHtmlRedirect('<script>location.replace("https://private.other.co.kr/")</script>','https://brand.co.kr/'),'');
 assert.equal(publicHtmlRedirect('<script>location.href="/login"</script>','https://brand.co.kr/'),'');
 assert.equal(publicHtmlRedirect('<script>location.href=compute()</script>','https://brand.co.kr/'),'');
});

test("New company collection prepares the current template and counts one company for several emails",async()=>{
 const compiled=esbuild.buildSync({entryPoints:['supabase/functions/_shared/discovery-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(m,m.exports);
 const lead={id:'new-lead',owner:'owner',status:'new',data:{name:'새 브랜드',website:'https://brand.co.kr/',contacts:[]}},tables={sanji_discovery_config:[{owner:'owner',target:40,enabled:true}],sanji_discovery_leads:[lead],sanji_discovery_usage:[{owner:'owner',day:'2026-10-22',calls:1,emails:0,companies:0,added:0,processed:0}],sanji_records:[{id:'current-copy',owner:'owner',kind:'template',version:3,updated:'2026-10-22',data:{channel:'이메일',subject:'{{브랜드명}} 제안',body:'안녕하세요 {{브랜드명}}. https://company.test/intro',signature:'서명'}}]};
 class Q{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push([k,v]);return this;}order(column){if(this.table==='sanji_records')assert.notEqual(column,'created');return this;}limit(){return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}update(value){this.value=value;return this;}exec(){const rows=tables[this.table].filter(r=>this.filters.every(([k,v])=>r[k]===v));if(this.value)rows.forEach(r=>Object.assign(r,structuredClone(this.value)));return structuredClone(this.one?rows[0]:rows);}}
 const sb={from:t=>new Q(t),rpc:()=>({exec:()=>structuredClone(tables.sanji_discovery_usage[0])})};const prevFetch=global.fetch,prevDeno=global.Deno;
 global.Deno={resolveDns:async()=>['8.8.8.8']};global.fetch=async url=>new Response(String(url).endsWith('/robots.txt')?'User-agent: *\nDisallow:':'<footer>대표 이메일 info@brand.co.kr 고객센터 cs@brand.co.kr</footer>',{headers:{'content-type':'text/html'}});
 try{const service=m.exports.discoveryService({sb,query:async q=>q.exec(),audit:async()=>{},putRecord:async()=>{}});const result=await service.handle('/discovery/run','POST','owner',async()=>({}));assert.equal(result.status,'processed');assert.equal(result.companiesAdded,1);assert.equal(result.emailCandidatesAdded,2);assert.equal(lead.data.outreach.templateVersion,3);assert.match(lead.data.outreach.body,/새 브랜드.*https:\/\/company.test\/intro/);assert.equal(lead.data.outreach.needsPersonalization,true);assert.equal(tables.sanji_discovery_usage[0].companies,1);
 await assert.rejects(()=>service.handle('/discovery/outreach','POST','owner',async()=>({id:lead.id,templateVersion:2,body:'stale'})),/템플릿이 변경/);
 }finally{global.fetch=prevFetch;global.Deno=prevDeno;}
});

test("Daily cap is removed while reservation remains approved-only, one-time and blocked-recipient aware; history uses KST",async()=>{
 const db=await database();try{
 await db.exec(fs.readFileSync('supabase/migrations/202610210002_automation.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/202610210003_discovery.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/202610220001_mail_refresh.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/202610220002_mail_operations.sql','utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2)',[u1,'owner@example.test']);await db.query('insert into sanji_members(user_id) values($1)',[u1]);
 const def=(await db.query("select pg_get_functiondef('sanji_reserve_dispatch(uuid,uuid,text,text)'::regprocedure) body")).rows[0].body;
 assert.equal(def.includes('일일 제한 초과'),false);assert.match(def,/d.used/);assert.match(def,/sanji_blocked/);assert.match(def,/fingerprint/);
 const saveDef=(await db.query("select pg_get_functiondef('sanji_save_record(text,jsonb,uuid,integer)'::regprocedure) body")).rows[0].body;assert.equal(saveDef.includes('dailyLimit'),false);
 const stamp=new Date((await db.query("select ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')+interval '30 minutes' stamp")).rows[0].stamp).toISOString();
 await db.query("insert into sanji_discovery_leads(owner,identity,data,created) values($1,'kst-yesterday',$2::jsonb,now()-interval '2 days')",[u1,JSON.stringify({name:'브랜드',firstEmailAt:stamp,contacts:[{email:'one@brand.test',checked:stamp,discoveryMethod:'public_page'},{email:'two@brand.test',checked:stamp,discoveryMethod:'public_page'}]})]);
 const h=(await db.query('select sanji_discovery_history($1) history',[u1])).rows[0].history,day=h[0];assert.equal(day.companies,1);assert.equal(day.emails,2);assert.equal(day.publicCompanies,1);
 const target=(await db.query("insert into sanji_records(owner,kind,data) values($1,'candidate',$2::jsonb) returning id",[u1,JSON.stringify({name:'대량 승인 대상',status:'미접촉',contact:{email:'one@brand.test'}})])).rows[0].id;
 await db.query("insert into sanji_outbox(owner,target,channel,fingerprint,status,data) select $1,gen_random_uuid(),'email','prior-'||i,'accepted','{}' from generate_series(1,25) i",[u1]);
 const did=(await db.query("insert into sanji_drafts(owner,data,hash,expires) values($1,$2::jsonb,'approved',now()+interval '1 hour') returning id",[u1,JSON.stringify({target,targetVersion:1,channel:'email',dealVersions:[]})])).rows[0].id;
 assert.equal((await db.query("select * from sanji_reserve_dispatch($1,$2,'approved','over-old-cap')",[u1,did])).rows[0].status,'submitting');
 await assert.rejects(()=>db.query("select * from sanji_reserve_dispatch($1,$2,'approved','duplicate-after-cap')",[u1,did]),/중복|만료/);
 await login(db,u1);const saved=(await db.query("select * from sanji_save_record('settings',$1::jsonb,null,null)",[JSON.stringify({senderName:'운영자',senderAddress:'주소',senderPhone:'번호'})])).rows[0];assert.equal(saved.data.senderName,'운영자');assert.equal('dailyLimit' in saved.data,false);
 }finally{await db.close();}
});

test("Production mail formatting keeps one signature and contact block and folds Korean headers without corruption",()=>{
 const compile=file=>{const c=esbuild.buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}),m={exports:{}};new Function('module','exports','require',c.outputFiles[0].text)(m,m.exports,require);return m.exports;};
 const {mailContent}=compile('supabase/functions/_shared/mail-content.ts'),{mime}=compile('supabase/functions/_shared/mail-mime.ts');
 const signature='남준혁 드림\n두더지웍스 공동대표 · 변리사\n010-5231-0804\ndothegy2021@gmail.com',settings={senderName:'두더지웍스 · 남준혁',senderAddress:'실제 사업장 주소',senderPhone:'010-5231-0804'};
 const text=mailContent('안녕하세요, 정관장 담당자님.\n\n확인된 제품 특징과 구체적인 콘텐츠 제안.\nhttps://littledore.kr/',signature,settings),subject='(광고) 도합 300만 크리에이터와 함께 일하는 남준혁 변리사입니다';
 assert.equal(text.split('010-5231-0804').length-1,1);assert.equal(text.split('남준혁 드림').length-1,1);assert.equal(text.split('회신으로 수신 거부').length-1,0);assert.ok(mailContent('광고 본문',signature,settings,true,true).includes('회신으로 수신 거부'));assert.equal(mailContent(text,signature,settings),text);
 const raw=Buffer.from(mime({subject,body:text,senderName:settings.senderName,email:'self@example.test',messageId:'format-check'},'sender@example.test'),'base64url').toString();
 const head=raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g,' '),encoded=/^Subject: (.+)$/m.exec(head)[1].trim(),decoded=encoded.replace(/\?=\s+=\?/g,'?==?').replace(/=\?UTF-8\?B\?([^?]+)\?=/g,(_,b)=>Buffer.from(b,'base64').toString());
 assert.equal(decoded,subject);assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString(),text);
 for(const word of raw.match(/=\?UTF-8\?B\?[^?]+\?=/g))assert.ok(word.length<=75);
 assert.equal(raw.split('\r\n').every(line=>Buffer.byteLength(line)<=998),true);
});

test("Brand list shows yesterday and today acquisition counts and filters the actual company rows",async()=>{
 const express=require('express'),app=express();app.use(express.json());
 const kst=n=>new Date(Date.now()-n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),today=kst(0),yesterday=kst(1);
 const leads=[['y','어제 브랜드',yesterday],['t','오늘 브랜드',today]].map(([id,name,day])=>({id,status:'review',data:{name,firstEmailAt:day+'T12:00:00+09:00',contacts:[{email:id+'@brand.test',source:'https://brand.test'}],outreach:{subject:'제안',body:'본문',intro:'공개 제품 근거. 콘텐츠 기획.',signature:'서명'}}}));
 const state={candidates:[],deals:[],templates:[],threads:[],outbox:[],jobs:[],suppression:[],settings:{senderName:'운영자',senderAddress:'주소',senderPhone:'번호'}};
 app.all(/^\/api\/.*/,(req,res)=>{const p=req.path.replace('/api','');if(p==='/me')return res.json({email:'owner@example.test'});if(p==='/state')return res.json(state);if(p==='/connections')return res.json({gmail:{connected:true,email:'owner@example.test'},instagram:{accounts:[]}});if(p==='/discovery')return res.json({settings:{target:40,enabled:true,keywords:[]},health:{label:"정상 대기 · 다음 업체 확인",status:"waiting",heartbeatVerified:true,pending:12,lastStarted:new Date().toISOString(),lastFinished:new Date().toISOString(),efficiency:{processed:50,companies:10,emails:12,companyYield:20,snapshotChecked:50,failedSites:3,partialSites:1,noEmailSites:35,reasons:{"응답 시간 초과":3}},recent:[{name:"오류 업체",status:"오류",emails:0,pages:0,error:"Signal timed out.",at:new Date().toISOString()}]},leads,history:[{day:today,companies:5,publicCompanies:5,emails:5,candidates:40},{day:yesterday,companies:28,publicCompanies:26,emails:41,candidates:91}],usage:{companies:99},activity:[]});return res.status(404).json({error:p});});app.use('/app',express.static('private/ui'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1365,height:950}});
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/#brands');await page.waitForSelector('#mail-yesterday-companies');assert.equal(await page.locator('#mail-yesterday-companies').textContent(),'28');assert.equal(await page.locator('#mail-today-companies').textContent(),'5');assert.equal(await page.locator('.mail-card').count(),2);assert.match(await page.locator('#discovery-health').textContent(),/정상 대기/);assert.match(await page.locator('#discovery-health').textContent(),/20%/);assert.match(await page.locator('#discovery-health').textContent(),/응답 시간 초과/);
 await page.locator('[data-action=mail-day][data-id=yesterday]').click();await page.waitForFunction(()=>document.querySelectorAll('.mail-card').length===1);assert.match(await page.locator('.mail-card h3').textContent(),/어제 브랜드/);
 await page.locator('[data-action=mail-day][data-id=today]').click();await page.waitForFunction(()=>document.querySelector('.mail-card h3')?.textContent==='오늘 브랜드');
 await page.screenshot({path:'/tmp/sanji-history-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/sanji-history-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/#settings');await page.waitForSelector('#settings-form');assert.equal(await page.locator('[name=dailyLimit]').count(),0);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test("Public search parses provider links without treating snippets or platform mail as official contacts",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-search.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
 const {searchResults,searchQuery,searchUrl}=m.exports;
 const rows=searchResults('<a href="/url?q=https%3A%2F%2Fbrand.co.kr%2Fshop"><h3>브랜드 공식몰</h3></a><a href="https://brand.co.kr/other">브랜드 중복</a><a href="https://smartstore.naver.com/brand">입점 브랜드</a><a href="https://news.naver.com/">건강식품 뉴스</a><a href="https://www.navercorp.com/">© NAVER Corp. 새 창 열림</a><a href="https://empty-brand.co.kr/">새 창 열림</a>snippet@brand.co.kr',searchUrl("Google","유산균"),"유산균");
 assert.equal(rows.length,1);assert.equal(rows[0].website,"https://brand.co.kr/");assert.equal(rows[0].name,"브랜드");assert.equal(rows[0].searchQuery,"유산균");assert.equal(rows[0].contacts,undefined);
 const rss=searchResults('<rss><channel><item><title>뉴브랜드 - 공식몰</title><link>https://newbrand.co.kr/</link></item></channel></rss>',searchUrl("Bing","홍삼"),"홍삼");assert.equal(rss[0].name,"뉴브랜드");
 assert.throws(()=>searchResults("unusual traffic captcha","https://www.google.com/","q"),/우회하지/);
 assert.notEqual(searchQuery(0),searchQuery(1));assert.notEqual(searchUrl("Google","한글"),searchUrl("Naver","한글"));
});

test("Search replenishment rotates engines after denial and queues new sites with query provenance",async()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-service.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
 let state={},queued=[],fetches=[];const oldFetch=global.fetch;
 const config={enabled:true,target:40,keywords:[],source_state:{}};
 class Q{constructor(t){this.t=t;}select(fields){this.fields=fields;return this;}eq(){return this;}lt(){return this;}order(){return this;}limit(){return this;}maybeSingle(){return this;}update(v){this.v=v;return this;}delete(){return this;}then(ok,bad){let data=this.t==="sanji_discovery_config"?(this.v?(Object.assign(config,this.v),config):(this.fields==="owner"?[{owner:"owner"}]:config)):[];if(this.v?.search_state)state=this.v.search_state;return Promise.resolve({data,error:null}).then(ok,bad);}}
 const sb={from:t=>new Q(t),rpc:(name,args)=>({name,args})};
 const query=async q=>{if(q instanceof Q){const r=await q;return r.data;}if(q.name==="sanji_claim_daily_sources")return false;if(q.name==="sanji_claim_search_sources")return {cursor:0,queries:2,day:"2026-10-22"};if(q.name==="sanji_enqueue_discovery_sources"){queued=q.args.p_rows;return queued.length;}return [];};
 global.fetch=async u=>{fetches.push(String(u));if(String(u).includes("google.com"))return new Response("denied",{status:429});return new Response('<a href="https://brand.co.kr/">브랜드 공식몰</a>',{headers:{"content-type":"text/html"}});};
 try{const service=m.exports.discoveryService({sb,query,audit:async()=>{},putRecord:async()=>{}});const r=await service.scheduled();assert.equal(r.added,1);assert.equal(state.queries,2);assert.equal(state.status,"replenished");assert.ok(fetches.some(u=>u.includes("naver.com")));assert.ok(queued[0].data.searchQuery);assert.equal(queued[0].data.contacts.length,0);}finally{global.fetch=oldFetch;}
});

test("Bulk email selects and approves two companies once, sends approved hashes and never resends on a second click",async()=>{
 const express=require("express"),app=express();app.use(express.json());
 const leads=["a","b"].map(id=>({id,data:{name:"브랜드"+id,contacts:[{email:id+"@brand.test",source:"https://"+id+".brand.test"}],outreach:{subject:"협업 "+id,body:"개인화 "+id+"\n공통 본문",signature:"서명",brandName:"브랜드"+id,productName:"제품"+id}}}));
 const state={candidates:[],deals:[],templates:[],threads:[],outbox:[],jobs:[],suppression:[],settings:{senderAddress:""}};const sent=[];
 app.all(/^\/api\/.*/,(req,res)=>{const p=req.path.replace("/api","");
 if(p==="/me")return res.json({email:"owner@example.test",csrf:"test"});if(p==="/state")return res.json(state);if(p==="/connections")return res.json({gmail:{connected:true,enabled:true},instagram:{},ai:{}});
 if(p==="/discovery")return res.json({settings:{enabled:true,target:40,keywords:[]},leads,usage:{emails:2},activity:[]});
 if(p==="/discovery/outreach")return res.json({ok:true});if(p==="/discovery/prepare-contact")return res.json({candidateId:req.body.id});
 if(p==="/drafts"){const id=req.body.target;return res.json({id,hash:"hash-"+id,target:id,email:id+"@brand.test",subject:req.body.subject,body:req.body.body,attachments:[]});}
 if(/^\/drafts\/[^/]+\/send$/.test(p)){sent.push({path:p,...req.body});return res.json({note:"Gmail 서버 접수"});}res.status(404).json({error:"unknown"});});
 app.use("/app",express.static("private/ui"));const server=app.listen(0,"127.0.0.1");let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",args:["--no-sandbox"]});const page=await browser.newPage();await page.goto("http://127.0.0.1:"+server.address().port+"/app/#brands");
 await page.locator('[data-action="mail-select-all"]').click();assert.equal(await page.locator('[data-mail-select]:checked').count(),2);await page.locator('[data-action="mail-review-selected"]').click();
 await page.waitForSelector('#mail-approve-all');assert.equal(sent.length,0);assert.equal(await page.locator('[name=bulk-approve]:checked').count(),2);
 await page.locator('[data-action="mail-send-all"]').click();await page.waitForFunction(()=>document.querySelector('#mail-send-summary').textContent.includes('전송 처리 완료'));assert.equal(sent.length,2);assert.ok(sent.every(x=>x.approved&&x.hash==="hash-"+x.path.split("/")[2]));
 assert.ok((await page.locator('#bulk-result-1').textContent()).includes('Gmail 서버 접수'));assert.equal(await page.locator('[data-action="mail-send-all"]').isDisabled(),true);await page.evaluate(()=>document.querySelector('[data-action="mail-send-all"]').click());assert.equal(sent.length,2);

 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test("Search refill lease enforces owner, cooldown, target and daily budget while allowing more searches after an empty queue",async()=>{
 const db=await database();try{
 await db.exec(fs.readFileSync('supabase/migrations/202610210003_discovery.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/202610220001_mail_refresh.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/202610220003_search_refill.sql','utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2)',[u1,'owner@example.test']);await db.query('insert into sanji_members(user_id) values($1)',[u1]);await db.query('insert into sanji_discovery_config(owner,enabled,target) values($1,true,40)',[u1]);
 const claim=async()=>(await db.query('select sanji_claim_search_sources($1) s',[u1])).rows[0].s;
 assert.equal((await claim()).queries,2);assert.equal(await claim(),null);
 await db.query("update sanji_discovery_config set search_state=jsonb_set(jsonb_set(search_state,'{leaseUntil}','null'),'{checked}',to_jsonb((now()-interval '16 minutes')::text))");assert.equal((await claim()).cursor,2);
 await db.query("update sanji_discovery_config set search_state=jsonb_set(jsonb_set(jsonb_set(search_state,'{leaseUntil}','null'),'{checked}',to_jsonb((now()-interval '16 minutes')::text)),'{queries}','64')");assert.equal(await claim(),null);
 await db.query("update sanji_discovery_config set search_state='{}'");await db.query("insert into sanji_discovery_usage(owner,day,companies) values($1,(now() at time zone 'Asia/Seoul')::date,40)",[u1]);assert.equal(await claim(),null);
 await login(db,u1);await assert.rejects(()=>db.query('select sanji_claim_search_sources($1)',[u1]),/permission denied/);
 }finally{await db.close();}
});

test("Discovery health separates active work, idle, stopped and stale heartbeat and states yield denominator",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-health.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);const health=m.exports.discoveryHealth;
 const at=Date.parse("2026-10-22T04:00:00Z"),cfg={enabled:true,target:40,runtime:{lastStarted:new Date(at-60000).toISOString(),lastFinished:new Date(at-50000).toISOString()}};
 const rows=[{status:"new",data:{name:"대기"}},{status:"review",data:{name:"실패",checked:new Date(at-20000).toISOString(),error:"Signal timed out."}}];
 const h=health(cfg,{processed:50,companies:10,emails:12},rows,at);assert.equal(h.status,"waiting");assert.equal(h.efficiency.companyYield,20);assert.equal(h.efficiency.failedSites,1);assert.equal(h.pending,1);assert.ok(h.nextRun);assert.equal(h.cost.billingVerified,false);
 assert.equal(health({...cfg,enabled:false},{},rows,at).status,"paused");assert.equal(health({...cfg,runtime:{lastStarted:new Date(at-13*60000).toISOString()}},{},rows,at).status,"delayed");
 assert.equal(health({...cfg,search_state:{status:"searching",leaseUntil:new Date(at+60000).toISOString()}},{},rows,at).status,"searching");
 assert.equal(health(cfg,{companies:40},rows,at).status,"target_reached");assert.equal(health({...cfg,search_state:{queries:64}},{},[],at).status,"search_budget");
});

test("Automatic brand research grounds exact product, proposes content rather than claims, checks email source and preserves finished copy",()=>{
 const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/brand-research.ts"],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
 const template={id:"t",version:4,data:{subject:"제안 {{브랜드명}}",body:"담당자님 {{개인화}}\n{{제품명}} 공통 본문 https://company.test/",signature:"원본 서명"}};
 const lead={name:"브랜드",website:"https://brand.co.kr/",contacts:[{email:"sales@brand.co.kr",source:"https://brand.co.kr/"}],publicEvidence:[{url:"https://brand.co.kr/",title:"브랜드 공식몰",description:"건강식품",checked:"2026-10-22",products:[{name:"브랜드 단백질 쉐이크 파우치 5종",quote:"브랜드 단백질 쉐이크 파우치 5종"}]}]};
 const r=m.exports.researchBrand(lead,template);assert.equal(r.outreach.needsPersonalization,false);assert.match(r.outreach.intro,/파우치 5종/);assert.match(r.outreach.intro,/제안드리고/);assert.equal(r.research.ownership,"source_supported");assert.equal(m.exports.researchBrand({...lead,contacts:[{email:"sales@brand.co.kr",source:"https://brand.co.kr"}]},template).research.ownership,"source_supported");assert.match(r.outreach.body,/공통 본문 https/);assert.equal(r.outreach.signature,"원본 서명");assert.ok(!/효능|치료|무료|확정/.test(r.outreach.intro));
 assert.equal(m.exports.researchBrand({...lead,contacts:[{email:"sales@other.co.kr",source:"https://other.co.kr/"}]},template).research.ownership,"research_pending");
 const original={intro:"기존에 작성된 강화 개인화",body:"보존 본문",needsPersonalization:false};assert.deepEqual(m.exports.researchBrand({...lead,outreach:original},template).outreach,original);
 const noProduct=m.exports.researchBrand({...lead,publicEvidence:[{url:lead.website,title:"브랜드 공식몰",checked:"2026-10-22",description:"건강식품"}]},template);assert.equal(noProduct.outreach.needsPersonalization,true);
});

test("Discovery completion claim requires opted-in owner and actual KST target, reserves once, and is tenant private",async()=>{
 const db=await database();try{
 for(const name of ['202610210003_discovery','202610220001_mail_refresh','202610220005_discovery_notifications'])await db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[u1,'one@example.test',u2,'two@example.test']);await db.query('insert into sanji_members(user_id) values($1),($2)',[u1,u2]);await db.query('insert into sanji_discovery_config(owner,enabled,target) values($1,true,40)',[u1]);
 await db.query("insert into sanji_discovery_usage(owner,day,companies,emails,processed) values($1,(now() at time zone 'Asia/Seoul')::date,39,50,120)",[u1]);
 const claim=async()=>(await db.query('select sanji_claim_discovery_notification($1) s',[u1])).rows[0].s;
 assert.equal(await claim(),null);await db.query('update sanji_discovery_config set notify_completion=true');assert.equal(await claim(),null);
 await db.query('update sanji_discovery_usage set companies=40');const r=await claim();assert.equal(r.recipient,'one@example.test');assert.equal(r.companies,40);assert.equal(r.target,40);assert.equal(await claim(),null);assert.equal((await db.query('select count(*) n from sanji_discovery_notifications')).rows[0].n,1);
 await login(db,u2);assert.equal((await db.query('select * from sanji_discovery_notifications')).rows.length,0);await assert.rejects(()=>db.query('select sanji_claim_discovery_notification($1)',[u1]),/permission denied/);
 }finally{await db.close();}
});

test("Completion notifier sends one real MIME contract to the owner only, preserves unknown outcomes and does not retry",async()=>{
 const c=esbuild.buildSync({entryPoints:['supabase/functions/_shared/discovery-notification.ts'],bundle:true,platform:'node',format:'cjs',write:false}),m={exports:{}};new Function('module','exports','require',c.outputFiles[0].text)(m,m.exports,require);
 let claimed=false,updates=[],requests=[],fail=false;
 const sb={rpc:()=>({claim:true}),from:()=>({update(v){updates.push(v);return this;},eq(){return this;}})};
 const query=async q=>{if(q.claim){if(claimed)return null;claimed=true;return {day:'2026-10-22',recipient:'owner@example.test',target:40,companies:40,emails:53,processed:160};}return null;};
 const notify=m.exports.discoveryCompletionNotifier({sb,query,gmailToken:async()=>({email:'sender@example.test',access_token:'mock-token'}),env:()=>"true",audit:async()=>{},remote:async(u,o)=>{requests.push({u,o});if(fail)throw Error('network timeout');return {id:'provider-id'};}});
 assert.equal((await notify(u1)).status,'accepted');assert.equal((await notify(u1)).status,'not_due_or_already_attempted');assert.equal(requests.length,1);assert.equal(updates[0].status,'accepted');
 const raw=Buffer.from(JSON.parse(requests[0].o.body).raw,'base64url').toString();assert.match(raw,/To: owner@example.test/);assert.equal(raw.includes('bcc:'),false);const body=Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString();assert.match(body,/매일 한국시간 자정/);assert.match(body,/이메일 확보 완료와 회사·상품 검증 완료는 구분/);assert.match(body,/40곳/);
 claimed=false;fail=true;assert.equal((await notify(u1)).status,'outcome_unknown');assert.equal((await notify(u1)).status,'not_due_or_already_attempted');assert.equal(requests.length,2);assert.equal(updates.at(-1).status,'outcome_unknown');
});
