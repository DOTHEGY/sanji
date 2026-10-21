export function publicContext(c: any) {
  const evidence = (c.evidence || [])
    .filter(
      (e: any) =>
        /^https:\/\//.test(e.url || "") &&
        String(e.description || "").trim() &&
        e.checked,
    )
    .slice(0, 5)
    .map((e: any, i: number) => ({
      id: String(i + 1),
      url: e.url,
      description: String(e.description).slice(0, 500),
      checked: e.checked,
    }));
  if (!evidence.length)
    throw new Error(
      "출처·확인일·설명이 있는 공개 콘텐츠 근거를 먼저 등록하세요.",
    );
  return {
    name: c.name,
    product: c.product || "",
    kind: c.kind,
    topics: (c.topics || []).slice(0, 8),
    evidence,
  };
}
export function validateIntro(value: any, context: any) {
  if (typeof value?.intro !== "string") throw new Error("AI 도입부 형식 오류");
  const intro = value.intro.trim();
  if (
    !intro ||
    intro.length > 280 ||
    intro.split(/\n+|[.!?。！？](?:\s|$)/).filter((s: string) => s.trim())
      .length > 2
  )
    throw new Error("AI 도입부는 280자 이내 1~2문장이어야 합니다.");
  if (
    /치료|예방|완치|항암|질환|투병|환자|임신|복용|매출|공급가|무료\s*샘플|독점|보장|\{\{/.test(
      intro,
    )
  )
    throw new Error(
      "도입부에 미확인 효능·민감정보·거래 조건이 포함되어 재작성이 필요합니다.",
    );
  const ids = Array.isArray(value.evidenceIds) ? value.evidenceIds : [];
  if (
    !ids.length ||
    ids.some((id: any) => !context.evidence.some((e: any) => e.id === id))
  )
    throw new Error("도입부의 공개 출처 근거가 확인되지 않았습니다.");
  return {
    intro,
    evidence: context.evidence.filter((e: any) => ids.includes(e.id)),
  };
}
