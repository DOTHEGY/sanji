# Inbox review queue

This UI adds reversible owner-reported task state to the existing historical-note and legacy Instagram lists. It never sends a message, syncs a provider, marks a provider message read, deletes a record, or changes dispatch/outbox evidence.

## Scope and identity

- Historical notes retain the existing latest valid correction grouping and collapsed original history. Review controls operate on one stored creator's complete loaded group. Partial coverage, unresolved branches, or invalid correction metadata disable hiding.
- Legacy Instagram entries use the authenticated endpoint's peer ID, not a display name. A matching cached username is only an explicitly unverified cross-reference to historical notes. Source records are never merged by handle.
- Historical people/record totals, loaded legacy conversation counts, and loaded message counts are separate. Receipt-like text is not promoted to collaboration interest or an unsuitable-creator classification.
- “확인함” and “직접 보냈다고 표시” save only operator-reported task state. The latter is not provider send evidence, approval to send, a sent timestamp, or an outbox state.

## Persistence and safeguards

`settings.data.inboxReviewQueue` contains schema 1, owner ID, and bounded entries. Each entry has a source key, SHA-256 of the canonical exact loaded snapshot (including owner/source identity), label, reported state, and report time. Message bodies and note content are not copied into settings.

Only the existing `sanji_save_record` settings partial merge is used. The client must find exactly one existing owner settings row, retain its exact ID/version, and pin the initiating bearer token on both reads and the write. Owner/session/route/snapshot validity is checked before and after asynchronous steps. No insert fallback, new credential, schema migration, grant, or broader settings write is introduced. Other settings are preserved by the existing deployed partial merge.

A marker hides only a matching loaded fingerprint. New notes, corrections, message content, source identity, or incomplete/ambiguous historical coverage show the entry again. The visible reviewed list also shows markers whose source is not loaded or whose snapshot has changed. Undo targets the exact stored source/fingerprint; original records and history remain.

Settings conflicts or uncertain writes disable further writes until the user explicitly rereads. There is no automatic save retry or local-storage fallback. Maximum 200 entries and 80,000 UTF-8 serialized bytes leave room below the existing RPC's 100,000-byte JSONB-input limit. Capacity failure does not evict markers; the user must undo existing marks before adding more.

The existing isolated-email approval guard compares the whole settings row version. Review/hide writes therefore may require re-reviewing a previously prepared email. This guard is unchanged, and the UI discloses the consequence. No message is automatically sent.

## Integration and verification

Add these test files to the coordinator's aggregate `npm test` command:

- tests/inbox-review-queue.test.cjs
- tests/inbox-review-settings.test.cjs
- tests/inbox-review-integration.test.cjs
- tests/inbox-review-browser.test.cjs

The first three cover pure snapshot logic, owner/token/version races, partial SQL merge, capacity limits, uncertain outcomes, undo, new information, source separation, actual app wiring, dirty-editor cancellation, and stale auth callbacks. Browser fixtures use synthetic data and fully intercepted network routes. They exercise click/undo, original history, new-note resurfacing, mobile/desktop layout, dirty cancellation, and auth replacement.

Local verification: 50 focused non-browser tests passed and the workspace bundle built. Browser execution could not start because the sandbox prohibits Chromium sockets; no browser checks are claimed as passing. The single release coordinator must run full aggregate CI, including browser fixtures, against the combined final candidate before publishing. No production data was changed while implementing or testing this feature.
