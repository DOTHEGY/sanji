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
      assert.equal((await health.json()).version, 3);
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
