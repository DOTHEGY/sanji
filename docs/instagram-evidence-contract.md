# Instagram evidence candidate (not deployed)

The existing authenticated `instagram-inbox` function exposes two POST routes. Both derive owner from the Sanji session, require current membership, and derive the connected `valu_est` account server-side. The DB functions are service-role-only. No messages are sent and no collection jobs are started.

## Tagby sent evidence

`/creator-instagram/tagby-evidence` accepts `{ "attested": true, "rows": [...] }`. Each row has exactly `handle`, `sender` (`valu_est`), `provider_status` (`SUCCESS`), `campaign_id` (integer), `campaign_url` (`https://tagby.io/tools/instagram/dm/<campaign_id>`), `sheet` (`발송 내역`), `sheet_row` (positive integer), `evidence_sha256` (lowercase SHA256 of the inspected XLSX), `sent_at_display` (original `YYYY.MM.DD. 오전/오후 H:MM` text) and `observed_at` (ISO 8601 with timezone). Input is an operator attestation of an inspected provider export; a hash is provenance and is not a provider signature. The import rechecks the current owner’s unique matching recovery handle and existing recommendation. Replays are idempotent; conflicting row contents are rejected. It stores no email, message body, token, or local file path. It never infers a timezone or claims a reply resulted from that particular campaign.

Read projection requires a current verified `valu_est` connection, recent verified peer username, matching unique owner-scoped recommendation, stored attestation, and real inbound message for that peer. UI further restricts to inbound within the last seven days. A false or unverified operator attestation is not independently detectable from a JSON/hash alone; review the original provider export before invoking the route.

## Public research

`/creator-instagram/public-research` accepts exactly `{ "attested": true, "peerId": "...", "profileUrl": "https://www.instagram.com/<verified_handle>/", "observedAt": "<ISO timezone>", "topics": ["..."], "sources": ["https://www.instagram.com/<verified_handle>/p/<shortcode>/"], "summary": "..." }`. `sources` also supports `reel` URLs, 1–10 entries, bound to the same handle. Topics and summary describe public content only, not medical status; topics are restricted short plain strings. Observation time is capture time, not publication time. Records are append-only; exact replays are no-ops and same-time different content is rejected. Public text is data, not instructions. At read time current owner/account/peer/profile identity and a seven-day freshness bound are rechecked; client treats source contents as text and escapes output.

## Scope and rollback

Migrations create `sanji_tagby_sent_evidence` and `sanji_instagram_public_research` with RLS, service-role SELECT only, and service-role-only import/projection RPCs. Authenticated callers use the existing function’s `getUser` and membership checks; no direct table access or new credentials. The `instagram-inbox` deployment bundle replaces that dedicated function only; existing `bright-function` is unchanged. Rollback requires restoring the previously deployed dedicated function and UI first, exporting any approved evidence if retention is needed, then explicitly reviewing removal of these new RPCs/tables. No operation is applied by these files. No current production row is included.
