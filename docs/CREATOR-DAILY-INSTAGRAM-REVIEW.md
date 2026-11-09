# Existing Instagram daily-review extension (inactive)

This local extension supports the extra 10 existing Instagram candidates. It makes no Instagram API call, imports no creator, changes no native CRM row and sends no message. Production DDL, automation, credentials and deployment are unchanged.

## Authenticated review contract

The existing owner-authenticated `/review-candidate` route calls `supply.review(owner,input)`. `owner` comes from server authentication and membership checks, never the request. Instagram input is limited to 16 KB and these fields only:

```js
{
  creatorKey:'instagram:handle',
  sourceRecordId:'existing-native-creator-uuid',
  sourceRecordUpdated:'exact native updated string from the candidate',
  audience:30000, audienceSource:'https://www.instagram.com/handle/',
  audienceCheckedAt:'ISO timestamp',
  lastActiveAt:'ISO timestamp', activitySource:'https://www.instagram.com/p/post/',
  activityCheckedAt:'ISO timestamp',
  mukbang:{verified:true,sourceUrl:'https://...',sourceText:'Explicit human review',checkedAt:'ISO timestamp'},
  contactEvidence:[] // optional; existing domain public business-contact DTOs
}
```

The caller cannot set name, profile, handle, owner, native status, source flags or gender. The native source must exist and match exact owner, UUID, handle and updated timestamp. Followers must be an integer 30,000–500,000 inclusive. All checks must be fresh within 29 days, latest activity within 90 days, and no timestamp can be future-dated. These are manually reviewed observations, not generated scores. Official business-email validation uses the existing domain rules, including same-profile public bio or independently verified affiliation. All contact and affiliation times cap evidence expiry. Empty contactEvidence means not contact-ready and replaces older supplemental evidence rather than merging old addresses back.

Success returns `saved:true`, `platform:'instagram'`, creatorKey, sourceRecordId/sourceRecordUpdated, expiresAt, reviewed:true, contactEvidenceReady and sendingEnabled:false. Unknown database outcomes return `INSTAGRAM_REVIEW_SAVE_UNCERTAIN`; reload the list to reconcile, never auto-resubmit.

## Read overlay and queue

`sourceCandidates(owner)` reads native sources plus private supplemental evidence. A review applies only when native ID, exact updated string and creator key match. Native name/profile/sourceRecordId/sourceRecordUpdated and exclusions are preserved. Native status other than `new`, assessment `excluded`, suspected noncreator or missing `source_confirmed` link always wins. Prior-contact and suppression flags also stay authoritative.

The overlay adds `supplyReview:{source:'existing_instagram_database',sourceRecordUpdated,reviewedAt,expiresAt}`. Parent domain validation caps prepared expiry to that marker. Dispatch resolves current native evidence again and binds plan.sourceUpdated to the exact native updated value from the same read, not a later metadata-only query.

`listReview()` retains legacy top-level source:`youtube_data_api`, requiresHumanReview:true, contactCollectionSupported:false, and adds sources:`['youtube_data_api','existing_instagram_database']`. YouTube items retain snapshot shape and add platform:'youtube'. Instagram items are:

```js
{platform:'instagram',creator_key,creator_id,candidate,review:null,reviewState:'pending'}
```

reviewState may be pending, reviewed, stale or excluded. candidate contains native name/profileUrl/sourceRecordId/sourceRecordUpdated. A stale review can be remedied only by explicit new evidence bound to the current native version.

### Bounded read-only review pages

`GET /supply-review?cursor=<native UUID>` lists at most 50 native Instagram rows per request, plus the existing bounded current YouTube snapshots. Omit `cursor` for the first page. The response has `scope: 'paged_native_instagram_and_current_youtube_snapshots'`, `preparationEligibilityChecked: false`, and `pagination` with scope `existing_instagram_database`, the incoming cursor, nextCursor, pageSize, total, remaining, returned and hasMore. Counts include all native statuses, exclusions and unknown/missing qualification evidence. `remaining` includes the returned page; it is not an eligible-creator count. The next cursor is absent only when this ordered range is exhausted. Smaller server row caps still produce an explicit continuation. Each request verifies owner, UUID order, exact counts and a second unchanged read. Separate requests are fresh pages, not one frozen database snapshot.

`GET /source-reviews?cursor=<source UUID>` independently pages up to 20 registered contact-source IDs. Its scope is `registered_contact_sources`; each item is the latest append-only registry version, including pending/revoked states. Total counts sources, not revisions or all native creators. Source registration still creates pending review only. No source is approved, fetched from a provider or sent a message by either GET.

These pages are review views, not complete preparation inputs. The complete candidate/history scans, deduplication and execution limits remain unchanged and fail closed. In particular, a native database above the current full-scan limit can now be browsed but still cannot be prepared or dispatched until the separate complete-source execution path is reviewed. Pagination does not silently truncate execution inputs or certify that all global history was checked.

## Storage and revocation

Apply only after approval: `supabase/pending/creator-daily-instagram-review.sql`.

- `sanji_daily_supply_instagram_reviews`: owner/campaign/creator_id primary key, source_updated timestamp, creator_key, review JSON, reviewed_at and expires_at. The entire evidence row is physically deleted on expiry, no later than 29 days from the earliest evidence timestamp or 90 days from last activity.
- `sanji_daily_supply_instagram_review_guards`: owner/campaign/existing-native-creator_id and last_reviewed_at only. No contact, statistics, source text or API-derived data. It prevents an expired/deleted supplemental review from reviving older native contact evidence. The existing native CRM identity is retained for this revocation purpose, not a YouTube API identifier. Native record/account deletion cascades to these markers.

Once guarded, missing, stale, expired or version-mismatched evidence holds the source with `instagram_review_required`; native evidence cannot silently become a fallback. A new explicit review replaces the private evidence. An older in-flight review cannot overwrite a newer review timestamp.

Both tables have RLS, no public/authenticated grants, and service-role-only invoker RPCs with an empty search path. The save RPC locks the native row for source-version consistency but never changes it. The existing recovery migration already grants service_role the table privilege needed for row locking; this pending SQL adds no native-table permission. Review save and guard update are atomic.

`createSupplyRepository().sweepExpired()` executes both the existing API sweep and `sanji_daily_supply_instagram_sweep()`. Parent downstream purge remains separate. Production daily maintenance must be enabled before activation, including when sending is paused.

## Latency separation

Supply first completion returns `newlyCollected:true` only in that response. The persisted summary has no such field. Same-day replay returns duplicate:true/newlyCollected:false. Busy returns newlyCollected:false. The generic scheduled worker yields state:'collected' after new collection and does not prepare or dispatch inline; parent controller/runtime implements the full multi-pass schedule.

## Local checks

```sh
node --test tests/creator-daily-instagram-review*.test.cjs tests/creator-daily-supply-stages.test.cjs
```

Synthetic tests cover same native ID/version, owner separation, all native exclusions, 30k/500k boundaries, activity/freshness, affiliation expiry, empty-contact revocation, stale guard behavior, full evidence deletion, unchanged native records, private ACL/RLS, no provider calls and ephemeral stage markers. Broader supply/preparation regression is run separately. No live/provider/production/send test has been performed.
