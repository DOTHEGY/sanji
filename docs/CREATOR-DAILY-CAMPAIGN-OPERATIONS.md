# Daily creator campaign: local implementation and activation boundary

Deployment audit (2026-11-09): the six private database schemas below are applied and verified. UI and API publication are tracked separately; no recurring automation or sending activation is established by these scripts.
The existing Gmail sender and older isolated worker remain unchanged.

## Implemented path

1. The owner-authenticated campaign UI calls the separate creator-daily-outreach API.
2. `/collect` runs official YouTube search separately from `/prepare`, so collection, enrichment and dispatch never share one worst-case 250-second invocation. Official YouTube search is bounded to four search calls and 112 ordinary units per Korean day. The worker reserves quota before each call and charges unknown outcomes. This is a worker-only budget, not a verified remaining Google-project allowance.
3. New channel facts live in a private 29-day cache. Existing candidates, prior contacts, reservations and suppression are excluded. The requested 50 YouTube plus 10 existing Instagram are maximum daily targets, never guaranteed or padded.
4. Recent activity is provisionally 90 days. Audience is 30,000–500,000 inclusive. Independent source evidence must establish mukbang, identity and a public business address. Neither gender nor appearance is inferred. A public address alone does not authorize sending.
5. Explicit owner source/recipient reviews are separate from automatic publication checks. Source registration creates pending review only. Automatic website enrichment requires a trusted administrative access-policy and affiliation review; it is not a generic scraper. Complex or restricted sites remain manual.
6. Preparation can add newly reviewed candidates to a partial daily plan under an atomic owner lock and cumulative 50/10 limits. Duplicate creators and addresses remain excluded.
7. Immutable private configuration binds the approved copy, the two original inline photos in order, current Gmail signature and campaign scope. The campaign asset mode supports the two named breads without inventing catalog records, prices or a photograph-to-product mapping. No private content is embedded in the static build.
8. The campaign adapter uses native outbox and thread records, twice-fresh Gmail history, current account/signature, recipient-specific basis, suppression and reply checks, and a one-use short send grant. Unknown provider/commit outcomes are held, never automatically resent. A provider receipt means accepted, not delivered.

## Stopped by default

All daily flags require the exact string `true`:

- CREATOR_DAILY_PREPARATION_ENABLED
- CREATOR_DAILY_SUPPLY_ENABLED
- CREATOR_DAILY_CONTACT_ENRICHMENT_ENABLED (optional source fetches)
- CREATOR_DAILY_CONFIGURATION_ENABLED
- CREATOR_DAILY_DISPATCH_ENABLED
- CREATOR_DAILY_SCHEDULER_ENABLED
- CREATOR_DAILY_WORKER_ENABLED
- CREATOR_DAILY_RETENTION_ENABLED
- EMAIL_SENDING_ENABLED (existing global mail switch)

The existing YOUTUBE_API_KEY and same-project YOUTUBE_QUOTA_PROJECT_ID must be verified before provider use. No new key, account, token, grant or billing change is created by this implementation. Gmail uses the existing encrypted connection only.

Configuration always pauses the campaign. Changing immutable scope requires recipient reviews tied to the new revision. Schedule time is initially 09:00 Asia/Seoul and explicitly unconfirmed. Enabling establishes a cutover; earlier prepared recipients are not backfilled. A separately verified recurring trigger is required for actual recurrence. The UI must not infer a timer from a saved policy flag.

The fixed worker accepts an empty authenticated request only. It cannot accept an owner, recipient or content from the request. Maintenance runs before work and still runs while campaign policy is paused. Retention must remain scheduled while any API cache exists. Collection and first preparation stop after their own stage. Once a daily plan exists, later worker passes dispatch it without repeating enrichment. Newly reviewed additions use the explicit prepare action. A later pass may process fewer than 60 messages due to time limits; the eventual authorized schedule needs bounded continuation and completion monitoring.

## Pending SQL order and permissions

Source scripts 1–6 were applied to production on 2026-11-09, with 15 empty private RLS tables and 37 service-only functions verified. Script 7 remains unapplied. The exact migration versions and post-deployment audit are retained in the deployment receipt:

1. creator-daily-outreach.sql
2. creator-daily-supply.sql
3. creator-daily-instagram-review.sql
4. creator-contact-enrichment.sql
5. creator-daily-campaign.sql
6. creator-daily-retention.sql
7. creator-daily-supply-kick.sql (optional bridge, after service authentication review)

All new tables are private with RLS and no anonymous/authenticated table access. Browser routes authenticate membership and derive the owner. The kick is a no-argument service-only bridge to the fixed project worker. It references the existing Vault secret by name, never returns it, and does not grant Vault privileges or register cron. Existing Vault/pg_net access and network-queue privacy must be verified; do not add broad secret-read grants as a shortcut.

Production merge/deployment needs immediate user approval. Activating the new internal endpoint's persistent access and any new permission/configuration must satisfy the applicable separate approval requirements. Use the official automation tooling for the requested recurrence only after deployment, scope and real readiness are verified. No automation has been created by this change.

## Tests and remaining real checks

Run `npm run test:creator-daily-outreach`, `npm run check:creator-daily-outreach`, the YouTube UI tests, and the normal build. Unit and in-memory PostgreSQL tests use injected providers, not live emails or YouTube calls.

Real runtime checks still required: authenticated owner isolation, existing project quota and other consumers, Node-compatible DNS/TLS pinning on the deployed runtime, actual browser behavior, approved source reviews, recipient classification, verified scheduler/retention execution, and a separately authorized live smoke test. Gmail alias checks may hold large domain-wide result sets rather than silently claim complete history.

YouTube policy source: https://developers.google.com/youtube/terms/developer-policies (III.E.4 and III.E.6). Raw API facts and identifiers are physically removed on expiry. Independently sourced contact/identity and send dedup audit remain separate. Deletion requests require prompt handling within the applicable policy window; do not represent a hidden expired cache as deleted data.
