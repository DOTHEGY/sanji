# Historical creator manual notes

This feature stores explicitly manual historical summaries and unsent reference drafts. It does not fix provider Inbox synchronization, create received messages, verify conversation freshness, send DM, mark messages read, or create dispatch jobs.

## Data and UI boundaries

- A separate `#manual-notes` route and Inbox link display notes even if provider Inbox is unavailable.
- Observation date/time is supplied by the observer and preserved with its precision. Recording time is database-generated. The UI always states that the latest state is unverified and any draft remains unsent.
- Notes use existing exact owner-scoped creator identities. Unknown/excluded identities fail closed; saving a note never upgrades their verification.
- The import file is previewed and saved one item at a time, in the supplied order. A user can skip an item without writing or losing the rest. Private import files must never be committed or bundled.
- Notes append; corrections link to an earlier same-owner/same-creator note. An immutable client note ID makes exact retries idempotent. The UI rereads that ID before retrying an uncertain request.

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
