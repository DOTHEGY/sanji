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

test("Instagram verifies short-token profile before long exchange and explicitly limits fallback sessions", async () => {
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
  assert.match(temp.warning,/장기 인증은 실패/); assert.match(temp.warning,/15분/);
  assert.ok(calls[0].includes("/me?")); assert.ok(calls[1].includes("/access_token?"));
  let requests = 0;
  await assert.rejects(() => resolve({access_token:"test-invalid"}, async () => { requests++; throw Error("invalid profile token"); }, "test-secret", "v24.0"), /invalid profile/);
  assert.equal(requests,1);
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
 const r=parseOfficialPage('<p>대표 이메일 info@brand.co.kr</p><p>고객센터 cs@brand.co.kr</p><div>'+ ' '.repeat(250) +'</div><p>제휴 문의 b2b@brand.co.kr</p><input placeholder="user@gmail.com"><p>privacy@brand.co.kr hr@brand.co.kr</p><p>플랫폼 support@cafe24.com</p><p>브랜드 공개 brandbusiness@gmail.com</p>',"https://www.brand.co.kr/","2026-10-21");
 assert.ok(r.contacts.some(c=>c.email==="info@brand.co.kr"));assert.ok(r.contacts.some(c=>c.email==="cs@brand.co.kr"));assert.ok(r.contacts.some(c=>c.email==="b2b@brand.co.kr"));
 assert.equal(r.contacts.some(c=>c.email.includes("privacy@")||c.email.includes("hr@")||c.email==="support@cafe24.com"||c.email==="user@gmail.com"),false);
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
 assert.equal(marketplace("https://smartstore.naver.com/brand"),true);assert.equal(marketplace("https://www.coupang.com/x"),true);assert.equal(marketplace("https://brand.co.kr"),false);
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

test("Brand workflow combines discovery and registered brands, previews exact copy, invalidates approval on edits, and schedules only checked recipients", async () => {
  const express = require("express"), app = express(); app.use(express.json());
  const brands = ["A","B"].map((name,i)=>({id:"brand-"+i,name,company:name,kind:"브랜드",category:"미확인",status:"미접촉",product:"제품 "+name,topics:[],contact:{email:name.toLowerCase()+"@brand.example",verified:true}}));
  const state={candidates:brands,deals:[],templates:[{id:"copy",name:"보존할 카피",channel:"이메일",subject:"(광고) {{브랜드명}} 제안",body:"공통 앞부분\n{{개인화}}\n공통 끝부분",signature:"원본 서명"}],threads:[],outbox:[],jobs:[],suppression:[],settings:{dailyLimit:20,senderName:"운영자",senderAddress:"주소",senderPhone:"번호"}};
  const drafted=[],scheduled=[];let sends=0;
  app.all(/^\/api\/.*/, (req,res)=>{
    const p=req.path.replace("/api","");
    if(p==="/me")return res.json({email:"owner@example.test",csrf:"test"});
    if(p==="/state")return res.json(state);
    if(p==="/connections")return res.json({gmail:{connected:true,enabled:true},instagram:{connected:false},search:{configured:false},ai:{configured:false}});
    if(p==="/discovery")return res.json({settings:{enabled:true,target:30,keywords:[]},leads:[],usage:{emails:1,processed:3,calls:3},activity:[{name:"확인한 업체",emailCount:1,pages:2,checked:new Date().toISOString()}],engine:{status:"sources_exhausted",label:"대기열 소진 · 신규 소스 보강 필요",pending:0}});
    if(p==="/drafts") {drafted.push(req.body);const c=brands.find(c=>c.id===req.body.target);return res.json({id:"draft-"+c.id,hash:"hash-"+c.id,target:c.name,email:c.contact.email,subject:req.body.subject.replace("{{브랜드명}}",c.name),body:req.body.body+"\n"+req.body.signature,attachments:[]});}
    if(p==="/schedule") {scheduled.push(req.body);if(req.body.draftId === "draft-brand-1")return res.status(409).json({error:"이미 예약한 수신자"});return res.json({run_at:req.body.runAt});}
    if(p.endsWith("/send")){sends++;return res.status(500).json({error:"never send in this test"});}
    return res.status(404).json({error:p});
  });
  app.use("/app",express.static("private/ui"));
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.on("listening",r));let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:"+server.address().port+"/app/#brands");
    await page.waitForSelector("#discovery-progress");
    assert.equal(await page.locator('#nav a[href="#discovery"]').count(),0);
    assert.equal(await page.getByText("네이버 검색 연결",{exact:true}).count(),0);
    assert.match(await page.locator("#discovery-progress").textContent(),/대기열 소진/);
    await page.locator('[data-action="brand-tab"][data-id="saved"]').click();
    await page.waitForSelector("#candidate-results");
    assert.equal(await page.locator('#candidate-results [data-action="compose"]').count(),2);
    await page.locator('#candidate-results [data-action="compose"]').first().click();
    assert.equal(await page.locator('#compose-form [name=body]').inputValue(),state.templates[0].body);
    await page.locator('[data-action="close"]').click();
    await page.locator('[data-action="bulk-compose"]').click();
    await page.locator('[name=bulk-target]').first().check();
    await page.locator('[name="intro-brand-0"]').fill("확인한 제품 특징. 확인한 콘텐츠 적합성.");
    await page.locator('#bulk-compose-form [name=lawfulBasis]').fill("사전 동의 기록 확인 완료");
    await page.locator('#bulk-compose-form button[type=submit]').click();
    await page.waitForSelector('[name=bulk-approve]');
    assert.equal(drafted[0].body,"공통 앞부분\n확인한 제품 특징. 확인한 콘텐츠 적합성.\n공통 끝부분");
    assert.equal(drafted[0].subject,state.templates[0].subject);assert.equal(scheduled.length,0);assert.equal(sends,0);
    await page.locator('[data-action="bulk-schedule"]').click();
    await page.waitForFunction(()=>document.querySelector("#form-error").textContent.includes("승인 체크"));assert.equal(scheduled.length,0);
    await page.locator('[name=bulk-approve]').check();
    await page.locator('#bulk-compose-form [name=body]').fill(state.templates[0].body+" 수정");
    assert.equal(await page.locator('[name=bulk-approve]').count(),0);
    await page.locator('[name=bulk-target]').nth(1).check();
    await page.locator('[name="intro-brand-1"]').fill("두 번째 제품의 확인된 특징. 확인된 내용 적합성.");
    await page.locator('#bulk-compose-form button[type=submit]').click();await page.waitForSelector('[name=bulk-approve]');
    await page.locator('[name=bulk-approve]').nth(0).check();
    await page.locator('[name=bulk-approve]').nth(1).check();
    const future=new Date(Date.now()+86400000);await page.locator('#bulk-run-at').fill(future.toISOString().slice(0,16));
    await page.locator('[data-action="bulk-schedule"]').click();await page.waitForFunction(()=>document.querySelector('[id^="bulk-result-"]').textContent.includes("예약 완료"));
    await page.waitForFunction(()=>document.querySelector("#bulk-result-1").textContent.includes("예약 실패"));
    assert.equal(scheduled.length,2);assert.equal(scheduled[0].approved,true);assert.equal(scheduled[0].draftId,"draft-brand-0");assert.equal(sends,0);
    assert.equal(await page.locator('[name=bulk-approve]:disabled').count(),1);assert.deepEqual(errors,[]);
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test("Discovery works without search API keys and reports exhausted sources instead of pretending to collect", async()=>{
  const compiled=esbuild.buildSync({entryPoints:["supabase/functions/_shared/discovery-service.ts"],bundle:true,platform:"node",format:"cjs",write:false});
  const m={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(m,m.exports);
  const stored={sanji_discovery_config:{enabled:true,target:30,keywords:[],updated:new Date().toISOString()},sanji_discovery_leads:[],sanji_discovery_usage:{calls:3,emails:1,processed:3}};
  const sb={from(table){const q={table};for(const k of ["select","eq","order","limit","maybeSingle"])q[k]=()=>q;return q;}};
  const service=m.exports.discoveryService({sb,query:async q=>stored[q.table],audit:async()=>{},putRecord:async()=>{}});
  const r=await service.handle("/discovery","GET","owner",async()=>({}));assert.equal(r.engine.status,"sources_exhausted");assert.equal(r.engine.nextRun,null);assert.equal(r.engine.mode,"homepage_queue");
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
