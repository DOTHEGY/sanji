# Isolated creator recommendation email worker

Status: implemented for review, disabled by default, not deployed. This is an additive design, not a retry of the rejected full `bright-function` replacement.

## Separation

- New function: `creator-email-worker`, with one authenticated POST route `/run`.
- Existing `bright-function`, UI, recommendation functions, dispatch functions, Meta/DM integrations and existing cron remain byte-for-byte unchanged.
- No trigger is added to the recommendation table. The new worker polls persisted recommendations after the policy's explicit activation cutover. Previews and historical recommendations are not recipients.
- Three private tables: policy, queue, recipient basis. Five new RPCs: sync, claim, reserve, begin_send, finalize. New objects use RLS and service-role-only access. Owner/creator foreign keys follow existing deletion lifecycle; this release performs no deletion.
- The queue is unique per owner/creator. Sync takes at most 500 previously unseen recommendations per call; later polls continue. Only one enabled owner is supported. Multiple enabled owners stop the worker for review.
- The worker starts at most two items per run, with a 20-second between-item budget. Individual provider timeouts remain bounded. It does not start more work after the budget; it finishes the current operation safely.
- No rows are inserted into `sanji_jobs`. A private internal draft is created and consumed by the existing `sanji_reserve_dispatch` in the same transaction. The old runner never sees a usable new draft/job. The shared outbox protects against duplicate manual or automated outreach.

## Preparation and recipient basis

Preparation preserves the approved subject/body, replacing only creator name and one current matching product. It preserves the exact imported Gmail HTML/text signature and adds no tracking, attachments, claims, price or commitments. Product choice is deterministic, not a paid model call. A catalog over 500 settings/deal rows is held rather than silently using a truncated list.

The latest exact-profile public biography must contain exactly one published email, checked within 30 days. A newer empty/ambiguous biography overrides old email evidence. Public publication verifies the source, not deliverability, advertising consent or legal classification. Missing evidence may use the existing Meta Business Discovery connection and existing daily lookup budget only. There is no new login, scope, credential, account selection, paid source, guessed email or limit change.

Unresolved recipients receive a private prepared snapshot and a hold, not a sent message. No basis rows are automatically created or approved. The sender's blanket classification assertion is not treated as recipient evidence.

The initial sending implementation accepts only a recipient-specific reviewed solicitation:

- Exact owner, creator, email and current policy revision.
- Status approved; kind `solicited_proposal`; classification `solicited_non_marketing_proposal` with a recorded review source.
- HTTPS evidence URL, actual request text, verification within 30 days, unexpired validity, owner approval identity and source.
- An explicit reviewed product ID list containing the selected product. No wildcard product permission.
- Fixed policy classification and copy remain separately checked. An `explicit_consent` row alone does not convert advertising into non-marketing, and cannot send the current unlabeled copy.

This code does not establish a legal conclusion. If advertising requirements apply, the present sender holds the message; consent/exception handling and separately approved compliant copy require a later reviewed change. It never silently rewrites the user's approved content. See [Article 50](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1030434429) and [KISA guidance](https://spam.kisa.or.kr/spam/main.do).

## Final-send safety

1. Read Gmail all-time sent/received/draft/spam/trash history. Any contact, error or malformed response stops initial outreach.
2. Atomically validate policy, basis, source, creator, product, signature, saved review, replies, suppression and native duplicate history; consume a draft and reserve one outbox entry.
3. Repeat Gmail history after reservation. Revalidate current database facts through a separate one-use `begin_send` grant, valid for 15 seconds.
4. Start one Gmail send only from that fresh original grant. A recovered/duplicate reservation or grant never authorizes sending.
5. Record accepted, rejected, cancelled-before-send or unknown outcome. Lost provider/receipt responses never cause automatic resend. Acceptance is not delivery or reading.

Expired preparation leases can recover. Only approval-related pre-reservation holds can resume after the missing, matching evidence is explicitly supplied. Changed source, prior contact, failed preparation and uncertain sends do not automatically retry. Disabling the policy prevents new grants; a send already started cannot be recalled.

## Runtime permissions and existing invocation method

Read-only production checks on 2026-11-04 confirmed:

- Project `ofasbfpeapbdcotnptvz` is active and its organization uses Pro.
- Existing job `sanji-approved-email-dispatch` runs `*/5 * * * *`, using `net.http_post`, an `x-job-token` header and a Vault-backed credential reference. No credential value was retrieved.
- Existing target, creator validator and reservation routine definitions were retrieved read-only and tested locally. Release must compare their definitions again for drift.
- The new `creator-email-worker` name was absent in the live function listing. Recheck before release; do not overwrite an unexpectedly existing function.

The new handler can reuse the existing `JOB_RUNNER_TOKEN`; it accepts no owner, recipient, policy or content from a request. No new cron credential is necessary. A new cron must reference the existing Vault credential securely and send an empty JSON body to the new route; it must not replace or clone arbitrary existing SQL commands.

This is operational isolation, not a separate security boundary. A function in the same project has access to injected service-role credentials and project secrets. The implementation reads only existing Gmail/creator-meta connections and refreshes an existing Gmail grant in memory. It does not persist new tokens, reconnect accounts or modify secrets. The broader runtime capability must still be disclosed and approved at action time. New function access, its role grants, credential reuse and new schedule must not be configured silently. See [Supabase environment variables](https://supabase.com/docs/guides/functions/secrets).

Supabase warns that `pg_net` temporarily stores the authentication header in its request queue, where database login roles may be able to read it. Review that exposure and existing role access before reusing the current transport; do not silently export a project-admin key or create another credential. [Scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions)

## Cost

A five-minute schedule adds 8,640 planned function invocations per 30 days (8,928 in 31 days). Existing Pro includes 2 million organization-wide invocations. Overage is billed in whole packages of 1 million, rounded up, at USD 2 per package. These additional scheduled calls cost zero if they fit the included/current paid package, but may trigger an additional USD 2 package at a boundary. The earlier linear estimate of USD 0.01728 is not the actual billing rule. [Exact billing method](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)

Current organization-wide usage, spend cap and total egress/database impact have not been verified. Unscheduled requests are also invocations. Do not promise a zero total bill. No subscription, upgrade, payment, paid enrichment or model API is introduced. Core successful Gmail work uses two list requests plus one send (110 published quota units), in addition to any existing token/provider work. Gmail's current quota/billing threshold must not be described as unlimited free usage. [Gmail quotas](https://developers.google.com/workspace/gmail/api/reference/quota)

## Release decision and rollback

1. Review and test this separate patch on current main, including exact deployed reservation definitions. Build only `node scripts/build-creator-email-worker.cjs`; do not build/deploy the workspace bundle as a substitute.
2. Obtain action-time approval for the new function's persistent server access, the additive migration, existing credential reuse and a separate five-minute schedule. Ordinary merge/deploy permission remains necessary. No PR is required or created.
3. The matching migration was generated using Supabase CLI 3.0.0; it is checked byte-for-byte against the reviewed pending SQL. Apply only the new migration and deploy only `creator-email-worker`. Its transaction has a two-second lock timeout and 30-second statement timeout, so unexpected contention aborts rather than waiting indefinitely. Existing function/cron and security settings are unchanged.
4. Keep policy `enabled=false`, `send_enabled=false`, classification unconfirmed and no approved recipient basis by default. Test authentication/status without mail. Do not run a real-send canary without its exact recipient authorization.
5. Confirm usage/spend controls and source/basis review. Activation for the one authorized owner must use the actual activation time as cutover, current fixed copy/signature and a new revision. Re-activation needs a new cutover/revision so recommendations made while disabled are not silently backfilled. Today's existing/manual batch stays outside this queue.
6. Enable preparation and sending only within the confirmed scope. Evidence gaps remain held and are reported, not silently overridden to satisfy volume.

Rollback: disable the new policy and new schedule first. Keep queue/outbox/audit data; never resurrect a consumed grant or unknown send. The existing application needs no restoration because its function, UI, cron and validators were not replaced.

Tests are local PGlite plus mocked Gmail/Meta and HTTP auth. They make no real provider calls. No deployment, production mutation, credential setup or send has been performed by this implementation task.
