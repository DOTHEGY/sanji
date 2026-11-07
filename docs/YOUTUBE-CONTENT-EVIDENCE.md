# Food-taste, person-centered review candidate

Prepared locally, then authorized by the user for formal testing and deployment. No PR, merge or deployment had occurred when this preparation record was written. Baseline is the PR38 creator-fit release files; reconcile current main and separate navigation work before publication.

## Latest intent and implementation

The goal is creators whose food tastes may support food distribution, not literal bun or spicy-bun matching. Supported food-distribution briefs now suggest 먹방 / 먹방 리뷰, or 먹방 / 쫀득 먹방 when texture is explicitly requested. Product names remain secondary context. Texture is not universal; explicit cooking, vegan, spicy, other fields, exclusions and manual queries retain priority. Combined texture/spicy requests retain both. Review requirements such as taste credibility, visible faces, and person-centered presentation are not literal search terms or automatic channel judgments.

All candidates initially remain in the review queue. Users may explicitly choose '사람 중심 영상 직접 확인 · 후보로 남김' or '직접 검토 제외'. Confirmed and excluded cards have separate containers. These are clearly labeled user-entered review states, not YouTube data or Sanji verification. Exclusion is reversible; contact inputs and draft text remain. Excluding the selected recipient invalidates mail confirmation and blocks drafting/opening that recipient's mail action until restored and reconfirmed. New search, refresh and signout clear review state; no external storage or sending was added.

The existing news self-description text fold defaults on and is named narrowly. Exact evidence and restore controls remain. It neither identifies all news nor proves remaining channels are people-led. No automatic face, trust, audience, reputation, content-category or advertising-suitability classification is added.

The raw recent-title index shows every retrieved latest-five title/date/link, including unmatched titles, alongside literal expression occurrences. Description excerpts are separate. Negation and quotation remain visible. No recurrence ratios, scores or genre labels. Manual negative query words are not positive evidence targets; preview/direct submissions produce the same targets. Source spelling is retained.

## Real query experiments on existing production UI

1. Earlier baseline `먹방 / 편의점 음식 리뷰`: 19 channels, 16 at 30,000 subscribers.
2. Interim `먹방 / 편의점 먹방`: 20 channels, 17 at that threshold; 2 search calls + 23 reads. Food-title examples appeared, but animation/variety also remained. This is historical exploration, not the final query design.
3. Latest intent `먹방 / 쫀득 먹방`: 15 channels, 14 at that threshold; 2 search calls + 18 reads. 톡톡시아 had a recent 과일모찌 맛있을까 title, 띠미 had recent food-tasting titles, 뿌니 had 쫀득한 소라빵. 쫀득TV also appeared: the same word can be a channel name rather than food texture. 지식지상주의, 밀우, other mixed entries require direct content review.

These are separate observations, not controlled quality scores. No videos were watched and no face/taste-trust confirmation was claimed. The new renderer/manual-state workflow is not yet deployed and was not exercised by these live queries. Followup experiments consumed 4 search calls and 41 reads total; the two earlier post-deployment searches are separate.

## Quota and policy

Official reference checked 2026-11-07: https://developers.google.com/youtube/data/determine_quota_cost (updated 2026-11-03) documents separate default search.list allowance 100/day, 1 per call, and 10,000 units/day for other methods. channels.list, playlistItems.list, videos.list cost 1 each. Do not convert 2 searches + 23 reads into 223 combined units or a currency amount. Actual project allowance/remaining usage was not inspected. The new raw-title/review-state UI needs no extra provider calls.

https://developers.google.com/youtube/terms/developer-policies-guide prohibits deriving channel/video content type and other independent data. This work uses source-text navigation and clearly separate user review notes, not automatic specialty classification. It is not a compliance-audit certification.

## Verification

- Focused non-browser suite: 73 passed, zero failed on latest code.
- Full Supabase build passed; isolated YouTube bundle rebuilt after final parser edits.
- Independent code review surfaced negative manual terms, preview inconsistency, source casing, excluded-recipient draft permission and combined texture/spicy regressions; fixes and tests were added.
- Added browser tests for safe source-text rendering, immutable results, manual-state movement/restoration, preserved contacts, signout, and exclude-after-confirmed-draft. Browser execution is blocked before test bodies by Chromium socket/ptrace Operation not permitted, including an elevated attempt. These are not passed browser tests.
- An earlier aggregate run before the latest user clarification had 1,271 tests: 1,190 pass, 76 fail, 5 skip (Chromium restriction, four missing local-worker Playwright dependencies, and existing UTC/+09 assertion). It is not a final-code aggregate pass.
- Formal CI and final new-rendering browser verification remain. Merge and deployment require explicit approval.


## Latest approved game exclusion and email clarification

Automatic food-search suggestions visibly append `-게임 -gaming` using YouTube's documented NOT query operator: https://developers.google.com/youtube/data/reference/rest/v3/search/list . Direct queries remain untouched and explicit gaming requests bypass food inference. This is a text search exclusion, not game-channel classification, and cannot remove every gaming channel. The literal evidence index never turns the negative game words into positive targets.

The production v5 function was retrieved and checked: REVIEWED_BUSINESS_SOURCES is empty, status declares contactHarvesting false, sendingEnabled false, pinnedCommentsSupported false, and businessContactAutoSources zero. No automatic creator-email acquisition currently exists. The UI clarifies that search did not obtain an email, and asks for a directly checked business-purpose address/source. Directory links are not proof of creator affiliation. No email was sent. The API channel schema exposes no dedicated business-email property, and its policies prohibit harvesting contact information without consent.
