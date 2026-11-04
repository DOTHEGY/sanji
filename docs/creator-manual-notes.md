# Historical creator manual notes

This feature stores explicitly manual historical summaries and unsent reference drafts. It does not fix provider Inbox synchronization, create received messages, verify conversation freshness, send DM, mark messages read, or create dispatch jobs.

## Data and UI boundaries

- A separate `#manual-notes` route edits/appends notes. The Inbox also renders a read-only historical section with its own count, original context, source link and unsent draft. It is not merged into provider conversation rows.
- Observation date/time is supplied by the observer and preserved with its precision. Recording time is database-generated. The UI always states that the latest state is unverified and any draft remains unsent.
- Notes use existing exact owner-scoped creator identities. Unknown/excluded identities fail closed; saving a note never upgrades their verification.
- The import file is previewed and saved one item at a time, in the supplied order. A user can skip an item without writing or losing the rest. Private import files must never be committed or bundled.
- Notes append; corrections link to an earlier same-owner/same-creator note. An immutable client note ID makes exact retries idempotent. The UI rereads that ID before retrying an uncertain request.

## Historical display order

The default **review order** shows only loaded/saved notes by earliest Sanji recording timestamp first. It is not reply chronology. Timestamp ties preserve existing list order, including equivalent explicit timezone representations, and database sub-millisecond precision is retained. Invalid/missing recording timestamps stay separately unpositioned and never fall back to observation or inbound time. Loading another page can insert an earlier record ahead of the current first item. Switching the display preserves imported/unsaved fields, target confirmation, review checkbox, queue and uncertain-save payload without making a request.

The optional **source display date/time** view groups only the loaded/saved records, not all replies or an entire source period. Valid explicit `inboundWhen` calendar dates appear oldest first using the source's displayed date. Within a day, recognized clocks sort only within the same notation, explicit timezone (or unverified display basis), and precision. Equal clocks preserve the existing list order. Different clock bases do not imply an order relative to one another. No timezone is inferred and no date is shifted to UTC.

Date-only records and malformed or ambiguous clocks remain visibly unpositioned within a valid explicit day. Relative strings such as `5일 전` and `약 20시간 전` stay in a separate uncertain-date section, in their existing order; observation timestamps do not turn them into absolute dates. Invalid/ambiguous dates remain in an unknown-date section. Raw strings and drafts are preserved without rewriting. This is a conservative review aid, not a complete or normalized received-message timeline.

Pagination still follows the server's recording-time cursor. The screen labels unloaded pages, regroups the loaded records after each page, and never equates the end of saved pages with complete source coverage. Corrections remain separate visible records; the screen indicates whether the original and any correcting records are present in the currently loaded list. It never hides an original or declares a correction the latest verified source.

## Inbox and product review

The Inbox historical section reads only the existing owner-scoped note-list endpoint. It automatically reads up to 20 saved pages per batch, with an explicit continuation and incomplete-coverage label when necessary. Repeated or malformed cursors fail closed while preserving already loaded rows. Existing provider filters and attested-identity requirements are unchanged; changing their date filter cannot discover additional historical notes. The note count is not a unique-person count and must not be added to the provider conversation count.

Notes expose a local product-review dialog with the exact saved observation time, source, reply summary, intent, subsequent-outbound observation, original draft and editable copy. Known corrected originals remain readable but cannot open a new product review. Catalog choices start unchecked and remain separate from the draft text; selecting them does not assert suitability, infer consent, insert a pitch, save a note or send a message. The reviewer confirms source/intent/exclusions and may choose no product. Historical copies cannot enter the official reply field. Closing destroys local edits.

For an exact verified official creator with no supported topic match, the product button opens this explicit manual catalog-review fallback instead of ending at an insufficient-evidence message. Existing supported automatic matches remain available without padding to three. Recorded structured refusal/stop states block product selection; free-text historical intent is displayed for review rather than classified with a loose regular expression. No historical note, selected product or copied draft becomes a verified live provider message.

Owner/session changes invalidate reads and clear historical dialogs. Navigation, logout, modal replacement and escape/close preserve dirty work if cancellation is chosen. Re-reading notes invalidates the selected snapshot. No server schema, Edge Function, access setting or provider call changes are required for this UI integration.

## Isolated backend

`supabase/functions/creator-manual-notes` is a new small function, separate from `bright-function` and both existing Instagram functions. It uses the existing project environment and does not need a new credential or provider connection. Gateway JWT verification stays enabled; the handler also calls Auth and checks Sanji membership.

Only these POST routes exist:

- `/creator-manual-notes/targets`: exact-handle lookup of one existing allowed creator.
- `/creator-manual-notes/list`: owner-scoped keyset read; optional creator or exact note ID filter.
- `/creator-manual-notes/save`: validated append via the dedicated RPC.

The handler derives owner from the authenticated user. It never accepts an owner supplied in JSON, reads encrypted provider credentials, calls a provider, or logs note bodies. Responses project only note fields, with fixed `manual_historical_note`, `latestVerified=false`, and `not_sent` labels.

## Schema and access delta

The reviewed SQL is `supabase/proposals/creator_manual_notes.sql`. The matching migration `supabase/migrations/20261104070352_creator_manual_notes.sql` was generated with Supabase CLI 3.0.0, then its filename was aligned to the migration service’s recorded version after application. Neither is installed automatically by the build.

- New `sanji_creator_manual_notes` table, RLS enabled, no client policies.
- Existing service role gets SELECT and INSERT only on six input columns. No UPDATE, DELETE, TRUNCATE or client-supplied recording timestamp.
- One service-role-only invoker save RPC; an invoker insert guard rechecks membership, same-owner exact target, payload and correction linkage, including direct service inserts.
- Transactional ACL checks reject hostile default grants, inheritance, ownership and broad privileges. Existing table/role grants are unchanged.
- Uses existing recovery `(id,owner)` uniqueness for its composite FK. Existing target and member locking privileges are prerequisites, not granted by this proposal.
- Deleting the creator follows the existing cascade lifecycle and removes associated notes. “Append-only” describes note APIs/grants, not retention against creator deletion or database ownership.

## Validation and rollout gates

Run `npm run test:manual-notes`, including browser cases in a permitted browser environment. Additional relevant regression tests are `instagram-manual-routing-integration.test.cjs` and `inbox-ui-only-safety.test.cjs`. The integration test uses the real proposal RPC, actual edge handler and UI receipt matching against synthetic data.

Build the function with `npm run build:creator-manual-notes` and the UI with `node scripts/build-supabase.cjs`. Neither command deploys anything. Do not rebuild/deploy the broad workspace function as part of this feature.

Before production, review exact SQL permissions, obtain applicable approval, run all required checks, and verify no unrelated function changes. Install the schema and deploy the new function with `verify_jwt=true` before enabling the frontend. Verify anonymous/wrong-owner rejection, an authorized note save, exact readback and visible labels. No live test may send DM.

For a UI rollback, restore the preceding UI assets while retaining stored notes. Do not drop the table or erase notes as an automatic rollback step.
