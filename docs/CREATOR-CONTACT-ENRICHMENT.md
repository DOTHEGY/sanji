# Optional public contact enrichment

## Status and boundary

Local implementation only, **disabled by default**. No source reviews have been seeded, no live creator/contact pages have been fetched, and no account API, production SQL, deployment, schedule or email has been invoked. Source registration does not authorize access. This extension adds publication evidence to the existing daily preparation pipeline; it does not approve consent, advertising classification, recipient basis, copy, or delivery.

New files only:

- `contact-enrichment.mjs`: review validation, exact public business-address parsing, evidence overlays, budgets, cache and negative observations.
- `contact-enrichment-network.mjs`: server-only Node HTTPS transport with DNS validation and IP pinning.
- `contact-enrichment-repository.mjs`: existing service-client RPC adapter and pending source registration.
- `supabase/pending/creator-contact-enrichment.sql`: two new append-only private tables and narrowly scoped RPCs. This is review SQL, not an executable migration or an activation step.
- Three local test files. Existing domain, service, repository, inline mail and shared functions are unchanged.

## Pending SQL order

Apply the reviewed `creator-daily-supply.sql` before `creator-contact-enrichment.sql`, because contact-source authorization reads the supply snapshot and independent-review tables. Base workspace/creator tables remain prerequisites. These files are proposals only; this order is not permission to apply them.

## Integration contract

```js
import {createContactEnrichment} from './contact-enrichment.mjs';
import {createContactEnrichmentRepository} from './contact-enrichment-repository.mjs';
import {createPinnedPublicReader} from './contact-enrichment-network.mjs';

const enrichment = createContactEnrichment({
  repository: createContactEnrichmentRepository(existingServerClient),
  network: createPinnedPublicReader(),
  enabled: false, // server configuration only; never from a request body
});
const result = await enrichment.enrich(authenticatedMemberOwner, {
  candidates: suppliedCandidates,
});
// Pass result.candidates to the existing history + prepare logic.
```

`result` contains `complete`, `candidates`, `observations`, `counts: {verified, held, requests, cached}`, reason counts, `publicationEvidenceOnly: true`, `sendingEnabled: false`, and `recipientBasisApproved: false`. Counts are unique creators, not the 50/10 final target counts. The existing daily domain still applies audience/activity/mukbang evidence, suppression, history and quotas. Missing sources and held contacts produce an honest shortfall, never invented addresses.

The supplied owner must come from verified server authentication and current membership. Do not expose the service client, this constructor, repository source objects, network injection, limits or review fields to browser requests. Failures reading the complete source registry or saving an observation must abort preparation, not fall back to older addresses. The returned candidates are a copy; existing manual evidence is not mutated. New negative observations supersede older addresses through the existing domain's newest-observation rules.

The pinned transport uses Node built-ins supported by the repository's Node 24 runtime. Edge deployment compatibility for Node HTTPS/DNS must be verified separately. If the deployment cannot pin the resolved IP while preserving TLS SNI and certificate validation, omit the network adapter and show `pinned_public_reader_required`; do not replace it with ordinary global `fetch`.

## Source registration and review

A future authenticated API/UI may call only:

```js
await repository.requestSource(owner, {
  creatorKey: 'youtube:UC…',
  sourceUrl: 'https://official.example.com/contact',
  sourceKind: 'official_website', // or instagram_public_bio
});
```

Only these three fields are accepted. `approved`, owner, policy, state and arbitrary evidence fields are rejected. SQL verifies an existing creator saved under this owner, or a current daily-supply snapshot with an owner-reviewed independent identity. A raw API snapshot is not sufficient. A new source starts `pending` revision 1 with no review data and cannot fetch. No source-discovery search, YouTube About/description/comment harvesting, hidden address access, CAPTCHA handling, login or guessing is provided.

An authorized server-side reviewer must independently verify the creator's link and current access rules before appending a `reviewed` version. There is deliberately no client-accessible approval RPC. A trusted administrative review path remains to be wired and authorized before use; approving the optional function is not approval of every source. Reviewers cannot bypass source restrictions just by marking a flag true. The version must contain genuine evidence:

- `stored_link`: `{creatorKey, url, sourceRecordId, sourceUrl, sourceText, reviewedBy, checkedAt}`. `url` is the exact stored contact URL. The record ID must match this owner and creator in the existing source DB. For a newly discovered YouTube channel with a current independent daily-supply identity review, use its exact `youtube:UC…` creator key as the stable source anchor instead; no legacy CRM record is created. Its evidence must identify how the official link was independently established, not a search snippet or a page's instruction to the assistant.
- `policy_review`: `{decision, exactUrl, reviewedBy, reviewedAt, expiresAt, termsUrl, termsExcerpt, robotsUrl, robotsExcerpt, accessRationale, noLoginOrChallenge: true, noAccessRestriction: true, maxRequestsPerDay: 1}`. `decision` is `allow_public_get` for an official site or `allow_existing_official_bio` for an existing Instagram snapshot. Review is at most seven days old; expiry is required and cannot be more than seven days after review. For an official site, the robots URL must be exactly that origin’s `/robots.txt`. Terms/robots must actually permit the intended access and downstream use; a robots allowance alone is not permission. No scraping approval can override platform terms.
- `affiliation`: `{verified: true, independentlyVerified: true, creatorKey, officialUrl, method: 'manual_cross_reference', reviewedBy, sourceUrl, sourceText, checkedAt}`. The source text includes the stable creator ID/handle and independently ties it to the exact official URL. Affiliation/link checks expire after 30 days. For an agency, evidence must tie this particular creator to the agency, not merely prove the agency exists.
- Optional `display_name_evidence`: `{creatorKey, name, sourceUrl, sourceText, checkedAt, verified: true, independentlyVerified: true, reviewedBy, kind: 'official_website' | 'provided_by_creator'}`. The text includes both name and stable creator ID, from a non-YouTube/non-Google independently reviewed source. Only fresh, unambiguous evidence overlays `candidate.name` and `candidate.displayNameEvidence`. An API title is never relabeled as independently verified. Existing newer manual display-name evidence is preserved.

All source versions preserve owner, source identity, exact URL and kind. To change the URL, register a new pending source and revoke the old one. Revocation appends a new `revoked` version; prior manual reviews stay immutable. New revisions cannot skip numbers. SQL grants no update/delete to the service role and no read/write/execute access to anonymous or authenticated clients. RLS remains enabled; functions are security invoker with an empty search path.

## Fetch and extraction safeguards

- Exact canonical HTTPS URL only. No URL credentials, IP literals, port, query, fragment, whitespace, local/test/internal hostnames or supported social-platform endpoints. The source registry is empty until actual independent reviews occur.
- Resolve A records once; reject any non-public/special/private address. Only validated IPv4 destinations are supported. The HTTPS connection goes directly to the pinned IP with the original hostname for TLS SNI, Host and certificate verification. No second DNS resolution, proxy, cookie jar, authentication, credentials or persistent session.
- GET only, no redirect following. Redirects, 401/403/429, CAPTCHA/challenge text and access restrictions produce a hold. Access denial/redirect is not retried on subsequent days until a materially new version of that specific denied source review exists. Updating another source cannot clear the block.
- Each exact URL is reserved once per owner per Korean day before opening a socket. The durable attempt survives a failed response or crash. An uncertain database reservation/save is not retried. Same-day verified snapshots may be reused only while the exact source revisions and all reviews remain current.
- Defaults: 120 requests, five per host, three sources per creator, 8 seconds per request including DNS and body, 90 seconds of network work per run, 256 KiB response, 16 KiB headers. Limits can only be lowered. No concurrency or automatic retry is used.
- Only UTF-8/ASCII `text/html` or `text/plain`, no compression, PDFs, images, dynamic rendering or JavaScript. The parser deliberately accepts only very simple static markup. Scripts, CSS, unsupported tags, visibility attributes and encoded/obfuscated addresses are held for manual review. It does not mine `mailto` attributes or infer a missing address.
- The exact visible email must have adjacent business/collaboration context. Personal/support/privacy/recruiting/fan and negative-purpose contexts are excluded. Multiple different eligible addresses, conflicting sources, removed addresses, stale reviews or ambiguous biography observations are held. No empty quota is padded.

This conservative static parser will hold many ordinary modern sites. A renderer that demonstrates actual visibility could be separately reviewed later; do not silently loosen the parser into hidden-HTML extraction to meet a target.

## Existing Instagram biographies

Read only current owner-bound `sanji_creator_evidence` rows for existing `sanji_creator_recovery` creators, exact profile URL and `source_kind=public_bio`. Accepted provenance is `instagram_official/business_discovery` or `instagram_public/manual_public_bio`, with available original text. Use the latest actual observation, including a removal or contradiction, at most seven days old. Preserve the original observation timestamp; reading the DB does not refresh it. No Instagram HTML fetch, new creator import, Meta API request or budget consumption occurs here.

Access-policy review must cover the saved source's permitted use. Automated observations are stored separately from manual review versions. Their evidence is usable only under freshness checks. Operational retention/erasure requirements for any provider-derived data still need explicit review before deployment; immutable audit retention is not a license to retain provider content indefinitely. No automatic deletion or retention job is configured by this change.

## Status meanings

- `publication_verified`: exact public business email substantiated. This is not permission to send.
- `no_reviewed_official_source`: no registered source; zero fetches.
- `source_review_required`, `source_policy_review_required`, `contact_creator_affiliation_required`: independent link/access/affiliation evidence missing or expired; zero fetches for that source.
- `source_review_revoked`, `source_access_review_required`: fresh review required before reuse/retry.
- `public_email_not_present`, `ambiguous_public_email`, `fresh_instagram_bio_required`: no safe address.
- `source_daily_budget_used`, `contact_request_budget_exhausted`, `contact_time_budget_exhausted`: bounded work stopped; no fallback fetch.
- `source_render_review_required`, `source_dns_not_public`, `source_redirect_denied`, `source_access_denied`, `source_too_large`, `source_timeout`: source held; do not evade with another route.
- Database/version errors abort preparation. No ephemeral unsaved email escapes to sending.

## Validation

```sh
node --test tests/creator-contact-enrichment.test.cjs \
  tests/creator-contact-enrichment-network.test.cjs \
  tests/creator-contact-enrichment-sql.test.cjs
```

All HTTP, DNS and account interfaces are mocked. SQL tests use only local in-memory PGlite fixtures, not any project database. They cover private ACLs, pending-only registration, immutable versions, owner isolation, durable per-day reservations, revocation races, current exact biography rows, negative evidence, restrictive rendering, DNS pinning, private ranges, redirect refusal, size/time budgets and repository integration. Parent integration should add the new tests to its aggregate command, apply the normal full-repository checks, and verify the exact runtime before an authorized release.

Official guidance consulted: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database functions and privileges](https://supabase.com/docs/guides/database/functions). The changelog Markdown request was unsupported by the read tool; no Supabase feature beyond the repository's existing client/RPC/Postgres patterns was assumed. Production schema drift, policy source verification, runtime egress, source review workflow and rollout remain unverified.
