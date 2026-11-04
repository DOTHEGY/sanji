# Historical note display

The Inbox historical reader and manual note editor now default to **사람별 최신 정정 우선 · 불러온 기록만**. Each loaded creator has one group. Valid correction-chain tips are shown first; superseded originals and intermediate corrections remain in a closed, expandable history. Nothing is deleted or rewritten.

- Counts distinguish loaded creators from records, for example **11명 · 22개 기록**. This is not a count of actual inbound senders or a complete provider inbox.
- A correction hides a predecessor only when the loaded ID, creator, owner scope, handle, and valid recording timestamps support the link. Recording timestamps retain nanosecond precision. Genuine ties keep loaded order.
- Missing parents, inconsistent identities, invalid/backward timestamps, duplicate IDs, cycles, and competing correction branches remain explicit. Disconnected records stay visible as separate candidates. The view never resolves an ambiguous branch into a verified final draft.
- Product-review actions remain unavailable for superseded records or unresolved correction/timestamp candidates, including synthetic click events. Existing session, navigation, selection, cancellation and request-epoch guards remain in place.
- More pages can change the grouping, correction connections and creator counts. The Inbox reader retains its existing 20-page batch bound and continuation control. A completed list request only means that request reported no further stored pages, never that current Instagram conversations are verified.
- Review order and source-date views remain available locally. Person groups use the earliest loaded recording as review order, not actual arrival order. All records retain the historical, unverified and unsent-draft notices.

Regression checks:

```sh
node --test --test-concurrency=1 tests/creator-manual-notes-inbox.test.cjs tests/creator-manual-notes-inbox-browser.test.cjs tests/creator-manual-notes-ui.test.cjs
```

Fixtures are synthetic. No production data, provider queries, dispatch, migration or storage change is required.

## Public context for correction leaves

The isolated `creator-manual-notes` context route accepts an unambiguous current leaf of an append-only correction chain, rather than rejecting all correction records. It reuses only that authenticated owner's saved public creator evidence; it never fetches a provider, returns private note payloads, updates notes or sends messages.

The server reads exact-count metadata for the selected owner and creator, with a 200-record bound. Missing/count-truncated results hold rather than infer completeness. It walks at most 32 nodes, requiring exact owner/creator/handle binding, unique IDs, a null root, valid nondecreasing recording timestamps with sub-millisecond precision, no cycles and no sibling branches. Equal recording timestamps remain allowed. Every declared sibling counts even if its own time is invalid. Superseded parents cannot supply a fresh review; separate independent root observations remain independent.

The validated path snapshot and eligible creator row must agree across repeated reads around the existing saved-research/revocation checks. A changed chain, newly appended correction, source revocation or ambiguous evidence produces a hold. These are bounded read-side checks, not a claim of current Instagram conversation verification, a transaction lock, consent, or permission to send. Existing authentication, membership, owner filtering, RLS/ACL, JWT verification, service credentials, deployment target and save paths remain unchanged.
