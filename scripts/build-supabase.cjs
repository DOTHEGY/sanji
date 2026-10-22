const fs = require("node:fs"),
  esbuild = require("esbuild");
fs.mkdirSync("public/workspace", { recursive: true });
let source = fs.readFileSync("private/ui/app.js", "utf8");
const start = source.indexOf("async function api("),
  end = source.indexOf("\nfunction field(", start);
source =
  'import {workspaceApi,integrationStatus} from "./supabase-api.js";\n' +
  source.slice(0, start) +
  'async function api(path,method="GET",body){return workspaceApi(path,method,body)}\n' +
  source.slice(end);
source = source.replace(
  "if (e.status !== 401) {",
  'if (e.status === 403 || /초기 설정/.test(e.message)) { $("#app").innerHTML=`<div class="panel auth"><h1>관리자 접근 설정 필요</h1><p class="notice">${esc(e.message)}</p><a href="https://github.com/DOTHEGY/sanji/blob/main/docs/SUPABASE.md" target="_blank" rel="noopener">설정 안내 열기</a><p><button data-action="logout">다른 계정으로 로그인</button></p></div>`;return;}\n    if (e.status !== 401) {',
);
source = source.replace("render();\n}", "render();\n}", 1);
// Report configured providers from the authenticated Edge Function when deployed.
source = source.replace(
  '[data, connections] = await Promise.all([api("/state"), api("/connections")]);',
  '[data, connections] = await Promise.all([api("/state"), api("/connections")]); const live=await integrationStatus();if(live)connections=live;',
);
source = source.replace(
  'id="auth-form" data-type=',
  'id="auth-form" data-type=',
);
source = source.replace(
  '<div id="auth-error" class="login-note"></div>',
  '<div id="auth-error" class="login-note"></div><p class="fine">관리자가 Supabase Authentication에 생성한 계정으로 로그인하세요. 외부 메일 비밀번호가 아닌 이 서비스의 비밀번호입니다.</p>',
);
source = source.replaceAll("루트에서", "운영 화면에서");
esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: require("node:path").resolve("web"),
    sourcefile: "workspace-ui.js",
  },
  bundle: true,
  outfile: "public/workspace/app.js",
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
});
let html = fs
  .readFileSync("private/ui/index.html", "utf8")
  .replaceAll("/app/", "./");
html = html.replace(
  "로그인 후 실제 영업 자료를 안전하게 관리하세요.",
  "Supabase 운영 연결 · 가상 데이터 없음 · 관리자 로그인 필요",
);
const assetHash = require("node:crypto")
  .createHash("sha256")
  .update(fs.readFileSync("public/workspace/app.js"))
  .digest("hex")
  .slice(0, 12);
html = html.replace('src="./app.js"', 'src="./app.js?v=' + assetHash + '"');
const styleHash = require("node:crypto").createHash("sha256").update(fs.readFileSync("private/ui/style.css")).digest("hex").slice(0,12);
html = html.replace('href="./style.css"', 'href="./style.css?v=' + styleHash + '"');
fs.writeFileSync("public/workspace/index.html", html);
fs.copyFileSync("private/ui/style.css", "public/workspace/style.css");
console.log("Supabase workspace built: public/workspace/");
