# Sanji brand discovery fix: release review packet

Status: on November 6 the user explicitly authorized application after disclosure of whole-function interruption risk, and requested continuing wellness expansion at <=60% of previous discovery volume. Local implementation is under final review. Branch publication and full supported-runner CI precede any production SQL, whole-function deployment or merge. Prior denied operations are not bypassed; formal action review still applies. No failed batch or delayed message is retried.

## Confirmed diagnosis

On 2026-11-04 KST, search reserved 32 two-query leases (64 queries) and received 813 Naver rows. The existing filters/full-history dedup produced 40 new candidates; 40 homepage attempts yielded 22 email-bearing companies and 32 email addresses. The 240/day homepage budget did not cause this stop. Other providers returned no usable rows. Original audit data did not split the 773 discarded rows into duplicate versus other rejection reasons.

The old search cursor restarted daily. Query suffixes rotated by date, so the queries were not literally identical every day, but they reused a narrow topic pool. Research eligibility was filtered AFTER fetching the oldest 500 leads: the snapshot had zero eligible rows inside that slice and 281 outside it. No Nov-4 imported lead had a research attempt. The automatic scheduling gate checked mail/contact integrity without requiring a verified food product. This allowed generic pending leads and media/association organizations.

## November 6 adaptive wellness scope

The volume metric is unique homepage candidates actually enqueued by completed public-search leases, not emails, sends, mutable qualification counts, directory imports or reserved-but-unfinished queries. A comparable KST day has exactly 64 audited completed query slots; today qualifies only after that budget completes. Smaller/invalid/conflicting days are excluded explicitly. The baseline is the median of the preceding at most seven comparable days in the 60-day read window, requiring at least three. At <=60% (including equality), freeze the baseline for that low-yield episode and expand once per newly completed day. A recovery above60% releases the episode reference, but preserves the expanded pending keywords. Recovery is NOT attainment of the 70-qualified-company target.

Observed comparable history: October28=95, October29=45, November2=126, November3=85, November4=40, November5=33, November6=28. Thus initial baseline65 and ratio28/65=43.1%. November1=198 had only62 completed queries and is excluded. History is read, never rewritten.

Pending queries combine staged supported wellness categories and bounded phrases from public official SKU/catalog evidence or public search metadata, with source provenance. Private mail, notes, DM content, outreach drafts and personal data are never keyword inputs. Full reservation/completion query history prevents recycling; pending proposals survive across days and recovery. New evidence can refill an exhausted active episode without advancing the stage twice. If sources are exhausted, report that honestly rather than inventing unlimited novelty.

The atomic adaptive claim compares the expected plan under an owner row lock, preserves the daily64 counter and existing provider/240-homepage limits, consumes exactly two selected slots, and records those phrases before fetching. A capped day may save next-day expansion but executes no extra searches. Failed/reserved queries remain novelty history. Provider/security/parser errors and actual duplicate/invalid/excluded reasons stay separate; 735 raw results becoming28 new candidates does not prove all other707 were duplicates.

Qualification now supports explicit SKU-level food/nutrition, sleep/rest, exercise/recovery and personal care for brands or distributors. Current official sales proof, matching published contact, complete research and neutral proposal copy remain required. Generic accessories, medical/prescription/industrial products and medical-claim copy stay excluded. Conservative gates may exclude otherwise lawful supplements with medical-claim wording; homepage-volume recovery does not guarantee qualified-volume recovery.

## Logical change and preserved boundaries

- Persist search cursor across days; 432 default topic/variant combinations, counted provider/parse/dedup yield and explicit target shortfall. Keep 64 queries/day, 2/lease, existing cooldown/provider/240-homepage limits. No paid search or budget increase. No guarantee of 70 qualifying companies/day.
- Apply owner/status/attempt/cooldown research eligibility before SQL LIMIT. Product retries have their own three-attempt budget. Follow official home/catalog/product paths within the existing three-page/time/HTML bounds.
- Require selected SKU-specific wellness evidence, official provenance, published owner-matching contact and complete product research before automatic scheduling. Allow substantiated distributors and ordinary business inquiry mailboxes. Reject media, associations, generic unknown products and mixed-catalog accessories. Do not infer legal consent, product legal category or distribution rights.
- Track qualification separately from historical raw companies/emails. Stop/refill/notify against qualified count; recompute or invalidate qualification on relevant edits/requeue/enrichment.
- Preserve existing mailbox authorization, sender, templates, opt-out and legal gates, provider limits, sent/delayed/unknown/failed outbox and jobs. No migration rewrites leads/jobs/drafts or replays the failed batch. Existing recipient/company and atomic reservation dedup remain. The delayed provider-managed message is not retried.

## SQL scope: additive and mixed-version compatible

Apply only these migrations, in order, with the existing privileged migration role:
1. `20261105005945_brand_discovery_quality.sql`: add two read-only owner-scoped SECURITY INVOKER helpers (`sanji_discovery_qualified_count`, `sanji_next_brand_research`) and a service-only claim RPC `sanji_claim_qualified_discovery_notification`.
2. `20261105010012_discovery_search_supply.sql`: add service-only `sanji_claim_qualified_search_sources` with persistent-cursor and qualified-target semantics.
3. `20261106054625_adaptive_wellness_discovery.sql`: add read-only service-only `sanji_discovery_search_history` and atomic service-only `sanji_claim_adaptive_search_sources`. The latter wraps the qualified claim with plan CAS, pending-queue consumption and reservation audit. Six additive functions total; no new table or user-facing grants.

The original `sanji_claim_search_sources` and `sanji_claim_discovery_notification` are NOT changed. Old v132 keeps calling them; only the three patched factories call the new qualified versions. Both claim versions share existing row locks/counters and notification owner/day uniqueness. Same-day coexistence preserves the lease/cooldown and cannot create a second completion notification. The legacy function historically resets its lease check across KST midnight; avoid a rollout crossing that boundary rather than modifying the old RPC in this release. The new function respects cross-midnight leases. SQL first is safe for the old code; there is no cron pause or new settings change in this plan. No tables, indexes, RLS, existing function definitions, grants to user-facing roles, or records are modified.

The target was read-only verified as PostgreSQL 17.11; `pg_input_is_valid(text,text)` exists. All six new functions deny PUBLIC/anon/authenticated execution and allow only the existing privileged service boundary. The three new claim functions mirror the original SECURITY DEFINER and empty search_path boundary; helpers are read-only SECURITY INVOKER. `prechange-rpcs.json` records original bodies, postgres owner and postgres/service_role ACLs so a reviewer can verify them unchanged. All three migrations are individually transactional and perform no data backfill.

## Artifact scope and prior denials

The production function is **bright-function v132**, project `ofasbfpeapbdcotnptvz`. The main source is not identical to that whole deployed function. DO NOT deploy `supabase/dashboard/workspace.ts` from main for this repair.

The separate patch builder takes the exact verified v132 bundle (SHA-256 `f9f75e6b84b9e53d99f1965ca1d474358273478312e8363fc1b247375620ce82`), preserves all its bytes, and inserts one isolated block overriding only `discoveryService`, `brandAutoService`, and `discoveryCompletionNotifier` before initialization. Its 19 pre-existing dependency modules match v132 byte-for-byte at the base source revision; qualification and adaptive-search planning are new. Changed dependencies are scoped inside the block, so unrelated live callers retain their original implementations. The manifest records all source file hashes, exact HEAD/dirty flag, esbuild version, builder hash, migration hashes and rollback hash. Removal of the inserted block recreates the exact original bytes. This is still technically an ENTIRE Edge Function redeployment, not an exemption from a denial or approval requirement.

Historical denied artifacts: `cb6d8c72a6417a41f6f413bad82f91d3f18fd2c019532ab13b78fa163e85db5c` (PR29, head 8ec954de) and `daebca5ba8d2f8f1a09f3534d79aa4029b5cdf5cf53911136ce8cd016046cc96`. Saved results state executed=false. Their stated risks were broad, unrelated production bundle replacement and disruption/rollback risk. This reviewed logical scope is materially narrower, but the shared function can still fail startup or interrupt unrelated endpoints. Formal review of the new exact artifact, explicit approval and rollback readiness remain required. No deployment attempt has been made for this change.

## Proposed rollout, requiring approval

1. Re-read live function version/hash, both original RPC definitions/ACLs and branch head. Abort on drift, missing backups, failed review or unclear denial reconciliation. Do not begin a mixed-version rollout close enough to 00:00 KST to cross the date boundary. Preserve the approved original v132 artifact.
2. Seek explicit approval for the exact source merge (which auto-publishes GitHub Pages), six additive SQL functions, and the whole bright-function redeployment. A feature-fix request alone is not this approval. Do not use another route after a denied action. No cron pause, auth change or other settings change is requested in this revised plan.
3. Apply SQL 1, SQL 2, then SQL 3. Verify all six new functions' bodies/ACLs and confirm the two original functions remain identical. Old v132 continues normally. If either migration fails, stop; do not deploy code that needs missing functions.
4. Deploy ONLY the exact approved v132-based artifact to bright-function, preserving existing function configuration. The whole shared function still faces startup/availability risk despite bounded logic changes. Existing live schedules may naturally run before/after deployment under their prior authorization; preparation and smoke tests do not invoke them.
5. Verify startup/OPTIONS, authenticated read-only discovery response, applied version/hash and ACL/tenant isolation. Do NOT trigger `/discovery/run`, scheduled endpoints, auto-reservation, sends or retries as a smoke test. Use read-only comparisons for existing jobs/outbox. Then merge/publish the reviewed UI/source change after its separate approval. Do not deploy the main-generated dashboard bundle as a shortcut.

## Rollback

Restore the exact original v132 function. It calls the untouched original RPCs, so **no SQL rollback or cron pause is required for compatibility**. Leave the six new service-only functions and additive JSON qualification fields inert. `rollback.sql` is deliberately comments-only: it must not overwrite original functions, drop helpers, reset data, or delete history/notifications. If the UI was published, restore its reviewed prior source through the separately approved Pages workflow. Do not retry any message or reservation.

The local PGlite coexistence test installs captured original functions, applies the migrations, and checks original bodies/ACLs/owners byte-for-byte unchanged. It verifies old and new lease claims block one another, old raw-count and new qualified-count semantics stay independent, and a previously claimed old notification prevents a second new notification. Restore-code-only therefore returns to the original RPC behavior. That emergency fallback restores the former raw-count behavior and its known quality weakness, not a completed quality fix. Already created new qualification evidence or reservations are not undone or resent automatically.

## Test and replay evidence

The local replay uses the untouched 40-row Nov-4 snapshot, SHA-256 `ef7cffeb85c6829f1ec019ba33d04fd8112e32cc843fe31bcbca86f3e7a23ee8`. Old gate: 22 eligible. New gate with untouched saved evidence: 1 (EATSN). Recomputing research locally from the same saved pages: 2 (EATSN and Yohemite). EPSA and Healthumer are rejected. This creates zero network requests, DB writes, reservations or messages and does not imply the other 20 companies are permanently unsuitable or that the target of 70 is achievable.

Focused tests cover food/accessory discrimination, official provenance, Shopify/Makeshop/Imweb URLs, source-selected product identity, stale-copy prevention, eligible rows beyond 500, independent retry budgets, malformed timestamps, owner/ACL isolation, raw-versus-qualified target, cursor continuity/budgets, same-origin official catalog descent, mutation invalidation, atomic scheduling dedup, no failed/unknown send retries, additive mixed-version SQL compatibility, and isolated artifact startup/reproducibility.

Full browser verification is NOT passed in this environment: 55 Chromium tests were blocked by kernel socket/ptrace permission restrictions, and one by a missing bundled browser executable. An allowed unsandboxed test invocation did not remove the kernel restriction; no security settings were changed or restriction bypassed. The standard CI browser run on a supported runner remains a release condition. Final exact test totals and artifact hashes accompany the release report.

Final validation results and exact artifact hashes are recorded in the pinned manifest and release report. The original 40-row replay remains 22 old-eligible, 1 eligible as saved and 2 after local evidence-only recomputation, with zero network/DB/reservation actions. The full supported-runner workflow must pass for the exact published HEAD; local browser blocks are never counted as passes.

## Temporary automatic-reservation pause

Restore the previously authorized brand-only automatic reservation setting only after successful release verification and an exhaustive owner-scoped eligibility/dedup review. Preserve original approval boundaries and actual restoration timestamps; do not force backlog scheduling, reset run/job/outbox records, or retry failed/delayed messages. The private operational audit is kept outside this public repository.
