# Daily creator supply: inactive local implementation

## Boundaries

This is executable local code and pending SQL, not an activated workflow. No production schema, cron job, API credential, Vault entry, external message, merge or deployment was changed. It supplies research candidates for the existing preparation/dispatch pipeline. A candidate is not an approved email recipient.

The target remains **50 YouTube + 10 existing Instagram records per KST day**. YouTube search can inspect at most 100 channel IDs in four search calls. It enforces public subscriber counts **30,000–500,000 inclusive** and a latest visible upload in **90 days**. The 90-day window is a provisional product default and is explicitly returned in status. No gender is inferred and no score based on appearance or titles is generated. Titles and search matches never approve mukbang suitability. New staged channels have no contact evidence or verified mukbang field. Existing Instagram rows and their reviewed public contact evidence are read through `createOutreachRepository`; there is no new Instagram import or scraping.

The result reports research candidates staged, bounds/activity exclusions, observed existing identities and shortages. The final preparation step separately reports contact-ready 50/10 counts. A research-stage count is never presented as 50 email-ready creators. A finite query pool, quota, missing contacts and human review may all create shortages.

## Files and integration contract

- `supabase/functions/creator-daily-outreach/supply.mjs`: `createDailySupply`, `supplyConfig`, `mergeSupplyCandidates`, `quotaDay`.
- `supply-review.mjs`: explicit owner-reviewed mukbang, independent identity/name and contact-evidence validation.
- `supply-repository.mjs`: `createSupplyRepository(sb)` using existing server-side Supabase client.
- `scheduled-worker.mjs`: `createScheduledWorker`, `scheduledWorkerHandler`, `SCHEDULE_CONTRACT`.
- `supabase/pending/creator-daily-supply.sql`: five private tables, six invoker RPCs. Pending review, not a migration.

```js
const original = createOutreachRepository(sb);
const supply = createDailySupply({
  repository: createSupplyRepository(sb),
  sourceRepository: original,
  ...supplyConfig(env),
  // Optional downstream purge added by the preparation/dispatch integration:
  sweepDownstream: () => purgeApiDerivedPreparationCopies(),
});
// Manual button path: run collection, then prepare using this read overlay.
const sources = {...original, candidates: owner => supply.sourceCandidates(owner)};
const preparation = dailyOutreachService({repository:sources});
const result = await supply.run(authenticatedOwner);
if (result.state === 'completed') await preparation.prepare(authenticatedOwner);
```

`sourceCandidates(owner)` re-reads server-owned sources and fresh API snapshots. It keeps manual contact/mukbang evidence, manually provided name, source record ID and exclusion flags. Only API audience/activity facts are overlaid in memory. Existing source records are never changed. A new stage row has an API-provided name and no contact approval. Provenance is `apiSnapshot:{channelId,observedAt,expiresAt,fieldNames,titleFromApi}`. Parent persistence must carry that provenance, expire downstream API copies and require an independently sourced display name for lasting personalized-mail artifacts.

`status(owner)` returns stopped/ready, enabled state, limits, provisional activity window, targets, PT quota scope and latest run. `listReview(owner)` returns private fresh snapshot rows joined with `review` (or null), with `requiresHumanReview:true` and `contactCollectionSupported:false`. It is intended for an authenticated owner-only research/review view, not an unauthenticated export. Its items are storage rows with `snapshot` objects.

`run(owner)` returns completed, failed duplicate, or busy. Missing config, uncertain outcomes, incomplete saved history, quota denial, network failure and lease loss throw stable `OutreachError.code`s. A failed run is terminal for the day; no automatic retries. Query status after a lost response. A completed same-day request returns the stored summary and does not call the provider again. A lease-expired running process may be reclaimed with a new token and retained reservation counts.

## Provider calls and quotas

Reuse only the existing `YOUTUBE_API_KEY`. `YOUTUBE_QUOTA_PROJECT_ID` is an explicit non-secret identifier for that same Google project, not a second project/key. `CREATOR_DAILY_SUPPLY_ENABLED` defaults false.

Each search/read request is charged by a durable SQL reservation **before** network access. A reused reservation ID cannot authorize another request. Timeouts, invalid responses and provider rejections remain charged. Credentials are sent in the `X-Goog-Api-Key` header, never in URLs/logs. Requests allow only the official `www.googleapis.com/youtube/v3` resources search, channels, playlistItems and videos. No descriptions, about pages, comments, business email endpoints or CAPTCHA are fetched. Titles are masked by the existing public-text sanitizer.

Local ceilings are four search calls and 112 ordinary reads per KST run. Across owners, the new worker shares a project/PT-day ceiling of 20 search calls and 500 ordinary-read units. Daily quotas reset in `America/Los_Angeles`, including DST, independently of the KST campaign day. These conservative ceilings leave room for existing consumers; **they do not measure total project usage**. The current interactive `discover()` is not silently changed or falsely counted. Before activation, verify actual project quotas and other traffic. If all project callers must share a true global limiter, explicitly integrate them into this ledger first. Provider quota exhaustion stops work; no new keys/projects or paid sources are attempted.

A continuing search carries a fixed 90-day anchor and a bounded page cursor for up to seven days. Completed exhaustion restarts from recent content on a later daily run. API-stage identities, existing manual source identities and saved contact history are excluded before detail reads. API-only identities expire with their snapshots, so an unreviewed creator may be rediscovered after deletion. Permanent exclusions must be independently recorded in approved CRM/suppression data, not an indefinite API cache.

## Retention and ownership

API snapshots are isolated from manual CRM. Expiry removes the entire row, including API-derived channel IDs, profile links, titles and video identifiers. There is no identifier retention exception. Durable contact/audit identities need separately verified independent sources. TTL is **29 days**, leaving a full-day maintenance margin below 30 calendar days. Search cursors expire after seven days. `sanji_daily_supply_sweep()` physically deletes expired snapshot rows and clears expired cursor material. Run summaries keep only operational counts and codes, never channel titles, statistics, video data, emails or raw provider responses. Quota tables contain call accounting only.

`supply.sweepExpired()` invokes the physical sweep and optionally the parent's downstream-copy purge. A separately approved maintenance execution must continue daily even if discovery/sending is paused. An offline scheduler cannot guarantee physical deletion on time, so production activation requires a maintenance schedule, failure alert and coverage of **every downstream API-derived copy**. No maintenance job has been registered by these files. Existing CRM/manual evidence is not deleted or overwritten by the supply sweep.

All five tables have RLS enabled, no anon/authenticated grants and service-role-only operations. RPCs use `SECURITY INVOKER` and an empty search path; function execution is revoked from PUBLIC/anon/authenticated. Membership is checked when claiming an owner/day run. Row locks, advisory lock and lease token fence overlap; quota rows serialize project budgets. Run/finish/reserve require current KST day; per-call PT date comes from the database clock.

## Scheduler contract

`createScheduledWorker({enabled:false,owner,campaign,supply,prepare,dispatch?,dispatchEnabled:false})` creates an inert orchestration object, no timer. `run()` returns stopped unless explicitly enabled. Active runs perform expiry, supply, preparation, then optionally the independently guarded dispatcher. `maintain()` is the dedicated expiry call. A busy/failed collection does not dispatch.

Suggested schedule is **09:00 Asia/Seoul**, explicitly provisional until confirmed. No catch-up burst. The actual recurring setup must be created later through the official automation system, not pg_cron. An external request cannot choose owner, recipients, campaign, date or copy.

`scheduledWorkerHandler({worker,authenticate})` accepts POST with empty body/`{}` and a trusted injected authentication check. The parent runtime uses the existing `JOB_RUNNER_TOKEN` through a constant-time comparator and a server-configured owner. This module never creates a credential or stores one in a prompt.

**Narrow pending trigger:** `supabase/pending/creator-daily-supply-kick.sql` defines `sanji_daily_supply_kick()` with no arguments. It uses a fixed verified URL (`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/creator-daily-outreach-worker/run`), resolves only the already-existing Vault name `sanji_approved_email_runner`, and sends an empty object with the existing `x-job-token` header. Read-only production metadata identifying that existing name/endpoint family was verified by the parent on 2026-11-09. No secret value was retrieved, Vault entry created, cron registered or network call executed. The function returns only request ID and `completionVerified:false`.

The pending function uses SECURITY INVOKER and grants execution only to service_role. It deliberately grants no broad Vault or network privileges. Before activation, verify the approved invoker can resolve that one credential and call pg_net. If it cannot, review a narrow privileged bridge rather than granting access to every decrypted Vault secret. pg_net can retain request headers/credential material in its queue; disclose and review that exposure and worker endpoint `verify_jwt=false` plus server token validation before approving any activation. The official automation prompt must contain only the narrow RPC invocation and status reconciliation, never credentials. Accepted HTTP enqueue is not worker completion or email delivery; reconcile authenticated status after timeouts. The 180-second request timeout and actual Edge Function runtime limits need live verification before enabling.

## Explicit staged-candidate review

`review(owner,input)` is a separate authenticated-owner action, with the owner/membership resolved by the parent HTTP handler. It does not run automatically, classify titles or send anything. Exact allowed input:

```js
{
  creatorKey: 'youtube:UC...',
  snapshotObservedAt: 'the exact snapshot.observedAt',
  mukbang: {verified:true,sourceUrl,sourceText,checkedAt},
  displayNameEvidence: {
    name,sourceUrl,sourceText,checkedAt,verified:true,
    kind:'official_website', // or provided_by_creator
    creatorKey:'youtube:UC...',
    profileUrl:'https://www.youtube.com/channel/UC...'
  },
  contactEvidence: [] // optional, existing domain public-source evidence DTOs
}
```

The independent proof must explicitly contain the name and exact channel ID/canonical profile URL in source text. A YouTube/youtu.be/googleapis source cannot establish independent identity/name. `kind` is canonical; `sourceKind` is not an alias for this object. Human mukbang review can reference a YouTube video, but is marked non-independent and deleted on expiry. Contact evidence reuses domain checks for collaboration purpose, creator affiliation, current source, ambiguity and forbidden harvesting. Missing contact evidence leaves the candidate held; invalid submitted evidence is rejected rather than silently approved.

The response is `{saved:true,creatorKey,expiresAt,sendingEnabled:false,reviewed:true,contactEvidenceReady}`. Review storage is separate in `sanji_daily_supply_reviews`, keyed owner/campaign/creator_key. Owner-derived reviewedBy/reviewedAt and independent-review provenance stay at review-row level; the candidate's displayNameEvidence is exactly the eight canonical fields above. An outdated snapshot observation or another owner's source cannot be reviewed. Review expiry is at most the earliest evidence+29 days and the API snapshot expiry, and `sweep()` physically deletes the whole review record, not just a visibility flag.

Fresh explicit review enriches a **new** staged candidate with independently proven name/identity, verified mukbang evidence and reviewed public business contacts. `apiSnapshot.titleFromApi` remains true to identify origin, while `nameIndependentlySourced`/`identityIndependentlySourced` are true and API fieldNames exclude those independently evidenced fields. Parent preparation/dispatch must revalidate that proof, not trust the booleans. Existing manual source rows are preserved rather than overwritten by a staging review. No new API-only candidate can become email-ready without this independent review.

## Verification

```sh
node --test tests/creator-daily-supply*.test.cjs
```

Tests use synthetic data and PGlite only. No live provider calls, paid services, real email, production DDL or scheduler activation. They cover pre-call charge, limits, stale/hidden/oversized audience, recent activity, manual/IG preservation, overlap, day/idempotency, lease replacement, project-wide worker counters, PT/DST boundary, API data deletion, private ACLs and authentication/body restrictions. Live Supabase advisories, deployed function invocation, real provider behavior and official automation execution remain unrun.

## Sources verified 2026-11-09

- [YouTube quota costs](https://developers.google.com/youtube/data/determine_quota_cost), updated 2026-11-03: separate search calls bucket, ordinary endpoints units, and midnight PT reset. Actual project allocation still needs verification.
- [YouTube developer policies, storage/refresh and scraping sections](https://developers.google.com/youtube/terms/developer-policies): delete/refresh non-authorized API data within 30 calendar days and no YouTube scraping.
- [Supabase RPC reference](https://supabase.com/docs/reference/javascript/rpc) and [database functions](https://supabase.com/docs/guides/database/functions).
- [Supabase changelog](https://supabase.com/changelog.md): checked relevant changes. No CLI operations or dependency upgrades performed. The pending SQL is not a generated migration.
