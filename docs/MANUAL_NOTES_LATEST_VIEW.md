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
