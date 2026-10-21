import { probeEdge } from "./diagnostics.js";
("use strict");
const $ = (s) => document.querySelector(s);
let code = "";
async function copy(text) {
  await navigator.clipboard.writeText(text);
  $("#status").textContent =
    "전체 " + text.length.toLocaleString() + "자를 복사했습니다.";
}
fetch("workspace.ts?release=oauth-redirect-v6", { cache: "no-store" })
  .then((r) => {
    if (!r.ok) throw Error("함수 코드 로드 실패");
    return r.text();
  })
  .then((s) => {
    code = s;
    $("#function-code").value = s;
    $("#status").textContent =
      "함수 전체 " +
      s.length.toLocaleString() +
      "자 로드 완료. 전체 코드 복사를 사용하세요.";
  })
  .catch((e) => ($("#status").textContent = e.message));
$("#copy-function").onclick = async () => {
  try {
    if (!code) throw Error("함수 로딩을 기다려주세요.");
    await copy(code);
  } catch (e) {
    $("#function-code").focus();
    $("#function-code").select();
    $("#status").textContent =
      "복사 권한이 없으면 선택된 전체 코드를 Ctrl+C로 복사하세요.";
  }
};
$("#copy-automation").onclick = async () => {
  try {
    const r = await fetch("../setup/automation.sql");
    if (!r.ok) throw Error("SQL 로드 실패");
    await copy(await r.text());
  } catch (e) {
    $("#status").textContent = e.message;
  }
};
$("#check-health").onclick = async () => {
  try {
    const url = new URL($("#function-url").value.trim());
    if (
      url.protocol !== "https:" ||
      url.host !== "ofasbfpeapbdcotnptvz.supabase.co" ||
      !/^\/functions\/v1\/[a-z0-9_-]+\/?$/.test(url.pathname)
    )
      throw Error(
        "이 프로젝트의 Function URL 전체를 입력하세요. 예: https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function",
      );
    $("#status").textContent = "상태 확인 중…";
    const diagnosis = await probeEdge(url.origin + url.pathname);
    $("#status").textContent = diagnosis.message;
  } catch (e) {
    $("#status").textContent = e.message;
  }
};
