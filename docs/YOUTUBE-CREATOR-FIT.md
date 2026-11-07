# Creator-field-first discovery release

## Verified problem

The supplied 473-line result export searched only `편의점 호빵`. Nine results mixed food creators with news, store-staff training and occasional product mentions. No subscriber statistics or recent-upload view counts were present. Literal product mentions do not establish a creator's recurring content field.

## Changes

- For supported food collaboration briefs (호빵, 급식, 음식 with a collaboration/creator/launch/distribution context), infer and disclose the primary search direction: 먹방, plus food reviews. Explicit 요리 without 먹방 stays 요리; 비건 remains a modifier.
- Convenience-store steamed-bun launch: `먹방` + `편의점 음식 리뷰`. Mala steamed bun: `먹방` + `매운 음식 먹방`. Product identity and context remain visible but do not become mandatory terms in every query. Direct query overrides are respected. Ambiguous exclusions still require review.
- This is a limited transparent ruleset, not general LLM intent understanding or proof of a channel's main genre. Other products and ambiguous requests can use manual search terms. It does not promise all candidates are mukbang creators.
- Retrieve public subscriber count from channels.statistics and the latest up-to-five upload IDs through each channel's official uploads playlist. Retrieve per-video published date, title, duration and public lifetime view count through videos.list. Keyword search hits remain separate from latest uploads.
- User-selectable minimum subscribers, an explicit 30,000 preset, and a view-count threshold for any of the latest five uploads published within 90 days. Zero disables a filter. 30,000 is not a global project constraint. Unknown/hidden counts are distinct from zero and folded with an explicit reason. All folds can be undone without another API call.
- Optional public-subscriber descending order is a direct statistic order, not an overall fit score. API search order remains available. Existing cards, contact inputs and drafts are preserved when sorting/folding.
- No composite fit/reputation score, average views, engagement ratio, inferred audience demographics, automatic safety verdict or email harvesting. No new credentials, storage, account permissions, external messages, migrations or Tagby-window interaction.

## Limits and cost

At most two search requests, 20 distinct channels, one channels request, 20 playlistItems requests (concurrency four), and two videos requests for up to 100 IDs: at most 2 search + 23 read calls per search. No pagination or automatic retries; shared 18-second deadline remains. Additional reads can expose existing rate/quota limits and cause an explicit search error rather than false complete metrics. Actual project quota and live latency have not been verified.

The five latest uploads are a bounded sample, not all videos in 90 days. Shorts, standard videos and livestreams may be mixed. The UI shows duration and date but does not falsely infer Shorts type from duration. View counts are cumulative since publication, not views gained within 90 days. The view-count filter is not a measure of typical performance. Unavailable/deleted/private resources remain absent or unconfirmed.

## Policy references checked 2026-11-07

- https://developers.google.com/youtube/terms/developer-policies (III.E.8 restricts new/derived API metrics; III.L describes a separate explicit approval route for audited analytics developers. Such approval has not been established here.)
- https://developers.google.com/youtube/data/reference/rest/v3/channels
- https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list
- https://developers.google.com/youtube/data/reference/rest/v3/videos

Keep original YouTube data and attribution clear and separate from Sanji's user-selected review controls. Existing privacy-policy/consent obligations need deployment review; code changes alone are not a legal compliance certification. API data remains transient in page memory, cleared on signout/refresh.

## Release scope

The user explicitly authorized formal validation, release, and a bounded real-search quality check. This release contains only the creator-fit change; navigation/main-workspace changes are excluded. Source files were compared to main 55203d9 before publication. CI and deployment verification remain required.

## Verification results

- Final focused suite: 65 passed, zero failed (`npm run test:youtube-relevance`, including creator-fit cases).
- Final full build: `npm run build:supabase` passed. Browser bundle rebuilt after final source changes.
- Full regression: 1,271 tests, 1,191 passed, 75 failed, 5 skipped. Of the failures, 70 were Chromium launch blocked by sandbox socket/ptrace restrictions; four were missing `local-worker/node_modules/playwright`; one was the existing creator-contact-review timestamp expectation (UTC vs +09). The timestamp failure was reproduced in the unmodified navigation baseline. This is not a full green regression run.
- Browser tests were authored, including metric folding/sorting/restore/signout, but did not execute through application interaction. Visual QA and real API latency/quota/output quality remain unverified.
- Independent review identified exclusion reintroduction and overwriting explicit creator fields. Fixed by preserving unknown/other explicit subjects and validating every generated fallback query against exclusions, including topic aliases. Tests cover 먹방/음식 exclusions, the school-meal fallback, and gaming/exercise/parenting fields.
