# Bounded daily execution

This change is local and unactivated. Deploying it does not grant a worker access,
configure a scheduler, approve source policies or recipient basis, or enable Gmail
sending. Daily targets remain conditional on enough distinct verified eligible
mailboxes and current legal-recipient review.

## Contracts

Apply `supabase/pending/creator-daily-execution-reads.sql` after the six base
campaign SQL files and the forward recipient-criteria v2 upgrade. The separate
`creator-daily-supply-kick.sql` scheduler trigger is not a prerequisite and must
remain unapplied while scheduling is off. It adds service-role-only, security-invoker RPCs and ordinary
query indexes. Existing authenticated browser endpoints still bind owner from the
verified member session; browser input cannot nominate page cursors or owners.

- `execution.page(owner, {existing, previous})` returns at most the remaining daily
  address slots: 50 YouTube and 10 Instagram. It returns current native records and
  latest bound evidence as one statement snapshot, not a 26,552-row download.
- Native IG without any daily evidence/review/guard is explicitly counted as
  `unreviewedInstagram`. It is available to review and exact lookup, but is not
  silently treated as qualified. All saved YouTube sources are examined, along
  with current private API snapshots. A native/API pair is merged; duplicate
  native source records are held.
- `execution.current(owner, creatorKey, sourceRecordId?)` resolves one exact
  creator, including held/unreviewed native rows, with optimistic version/update
  metadata from the same evidence read. It never fetches external sources.
- `execution.historyFor(owner, candidates)` accepts only the bounded page after
  enrichment. Every saved-history branch is checked inside PostgreSQL. Only the
  matching creator/email identities leave the database, not history records.
- `execution.exclusions(owner, creatorKeys)` batch-checks at most 100 discovered
  YouTube keys against every saved, suppressed and contacted identity plus the
  private snapshot cache before hydration and again before staging.
- `execution.savePage` rereads the exact source page and commits native preparation
  and progress under the existing owner lock. An uncertain response is never
  retried automatically. Read saved status before any subsequent action.

## Continuation and changes

Independent YouTube and IG cursors advance only through evaluated rows. Page size
is capped by each platform's remaining distinct-email slots, so reaching ten IG
recipients cannot consume ninety unselected IG rows. Previous-day cursors resume
until exhausted. Exhausted platforms restart on the next day.

Each platform has a content digest over its native sources, review evidence,
supplemental review/guard data and contact-source policies. Same-count edits,
removals and changes behind the cursor reset that platform's pass. The fingerprint
is rechecked at the atomic checkpoint; a change during enrichment aborts the save
without advancing progress. Changes after a checkpoint reset the next page. Source
versions, freshness, exclusion, recipient basis and live Gmail history are still
rechecked by the existing reserve/begin-send authority.

A pass may need several invocations. `morePreparationRequired` means another
bounded preparation pass is required; the runtime yields instead of claiming the
full pass completed. Current eligible prepared SQL counts are recomputed inside the page RPC, so
expired or legacy >200k YouTube reservations remain history barriers but do not
consume the new goal. These counts, not discovered channel counts,
drive 50/10. Same creator cannot contribute two addresses, Gmail/Googlemail dots
and plus aliases collapse, and a shared agency mailbox contributes only one slot.

## History coverage and retention

All existing saved history branches remain: outbox (all/unknown outcomes), thread
records, suppression, prepared candidates, contact reviews, jobs plus their drafts,
inbound mail, manual notes, manual Instagram conversations, isolated-email queue,
Instagram inbound and reply attempts. Missing draft joins fail closed. Nested
creator IDs, target references, creatorReviewId, channel IDs, URLs and handles are
resolved with owner-bound indexed lookups. The existing authoritative saved-history
function gains exact recursive canonical tokens without removing its older
conservative duplicate checks. Private Gmail provider history remains separate.

No history index/table copies API data. A YouTube cursor may itself contain a
private API channel ID, so its earliest underlying API expiry is stored. The
existing physical maintenance RPC now removes expired YT cursor/digest data while
preserving independent native IG continuation. Existing API snapshot/review and
prepared-fact scrubbing is unchanged. Retention must run even while sending pauses.

## Verification and rollout limits

Local tests cover 26,552 IG rows, more than 10,000 history records, cross-owner
isolation, Gmail aliases, nested references across every native history branch,
current evidence conflicts, per-platform continuation, source edits during a page,
stale/uncertain checkpoints, pre-hydration/pre-stage exclusions, physical cursor
retention, and the existing full preparation-to-one-use-grant lifecycle.

The source fingerprint is an owner-scoped database aggregate, not an O(1) trigger
index. Global history tokenization is also database-side. Before deployment, test
query plans and elapsed time against production-sized data, confirm SQL API RPC
response shapes under the actual PostgREST cap, and verify retention scheduling.
A timeout, oversized payload, unknown outcome, missing prerequisite table or
incomplete response fails closed. Do not raise row caps or remove proof checks to
make an unfinished rollout appear ready. Sending and the scheduler remain off.
