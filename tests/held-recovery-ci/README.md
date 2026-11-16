# Isolated PostgreSQL held-recovery concurrency candidate

Test-only files. No production deployment, application changes, secrets, OAuth,
OIDC, external messages or production database connection. Run only in the
explicit test branch workflow with its ephemeral official PostgreSQL service.
No package installation is required: Python standard library invokes psql inside
that disposable service using docker exec. It requires two distinct backend PIDs.

All rows, addresses, approval/evidence receipts and identifiers are synthetic.
The recovery SQL is a test copy: five operational owner/batch/ledger identifiers
were replaced by synthetic UUIDs. No other recovery SQL structure changed. Exact
public helper function bodies were read from the approved schema, not private
credentials or function environment variables. These fixtures are not evidence
that any real held email can be recovered or sent.

Scenarios assert recovery-first claim blocking until commit, claim-first NOWAIT
with unchanged state, rejection of committed processing, second-table lock failure
releasing the first lock, same-incident one-audit idempotence, and rollback release.
Only SQLSTATE 55P03 is accepted as an expected lock conflict. Timeout/error is a
failure. The driver polls PostgreSQL's lock-wait state, not only elapsed time.

Static Python compilation passed locally. Real two-backend execution remains
pending CI; no successful concurrency claim is implied by preparing these files.
The fixture covers the exact recovery and helper code but a minimal synthetic
schema, not all production triggers/policies or external provider behavior.
