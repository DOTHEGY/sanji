# Contact integrity incident review — 2026-10-26

Status: local implementation and no-send validation. Not deployed. No production rows changed and no mail sent.

## Confirmed from saved production evidence

- Estée Lauder: `username@network.co.kr` was extracted from a form validation message instructing users how to format an email address, not a published business contact.
- Saramin: `jumpit_id01@email.com` and `jumpit_id02@email.com` appeared in account examples in the official help page. Saved delivery-status records show permanent status **5.7.0**; this does not establish the more specific “user unknown” cause.
- Coherent Market Insights: `enquiriessales@…`, `linesales@…`, and `directlysales@…` appear with labels “Sales Enquiries”, “Direct line”, and “Write to us directly” in saved excerpts. The extractor removed inline boundaries, allowing label text to merge with addresses. Saved DSNs show **5.1.1** for the three exact addresses. No corrected address was generated or used.
- An official page containing a string was being treated as sufficient publication evidence, without excluding examples. A recruiting platform and market-research vendor also passed as outreach companies despite being outside food-brand scope.
- At inspection: 500 saved discovery leads; 58 completed jobs; zero queued, processing, review_pending or unknown jobs. These counts are a point-in-time snapshot, not a pause/disable of sending.
- The five permanently failed incident addresses are present in saved thread DSNs but absent from the persistent suppression table. Existing dispatch checks read thread DSNs; the new sync change additionally persists address-level suppression.

## Changes

- Shared contact-safety rules reject sample usernames, documented account examples, form-format instructions and the observed concatenation artifacts. No blanket ban on Gmail, Naver, customer-service or operator domains.
- Preserve boundaries between inline labels when parsing HTML while retaining an explicitly split domain suffix. Never trim a guessed prefix or append a guessed suffix to create another address.
- Run the same example checks against existing stored contacts at final dispatch, including immediate and scheduled sends. Verify the exact source page exists in cached evidence; another homepage excerpt does not substitute for it.
- Exclude known recruiting and market-report vendors from food-brand targeting. Other vendors are not automatically classified as food brands by this change; wider category classification remains a follow-up limitation.
- Gmail sync persists structured permanent DSN addresses even when no matching candidate exists. Insert-only conflict handling preserves pre-existing opt-out reasons. Company-wide suppression is not applied.
- Exact current send/recipient checks remain in place, as do opt-outs and duplicate-send protection. No copy, signature, attachment, sent history or thread content was rewritten.

## Validation and limitations

- Regression fixtures cover all six reported incorrect addresses, inline-label boundaries, form examples, exact-source evidence, official representative/support/Naver/Gmail/operator mailboxes, saved drafts, direct/scheduled dispatch before external requests, and exact-address DSN persistence with opt-out preservation.
- Saved production evidence was inspected read-only; original remote HTML was not freshly fetched. SMTP existence probing was not performed. No test, apology or proposal message was sent.
- The cached evidence contains the extraction artifact, so raw historical tag layout cannot be reconstructed conclusively from the cache alone. The inline-boundary defect is reproduced by HTML fixtures.
- No active queue needs alteration at this snapshot. Existing sent history remains unchanged. Future jobs need the updated Edge bundle deployed before these new guards apply.

## Proposed production scope (requires separate approval)

1. Deploy the updated `bright-function` bundle only; no schema or paid service needed.
2. Back up and insert the five exact incident DSN addresses into suppression if absent; do not modify opt-outs, other addresses or sent records.
3. Re-run read-only stored-contact validation; move any newly queued affected jobs to review only with approved scope. No dispatch or automatic restart as part of deployment.

Rollback: redeploy the previous Edge bundle. The suppression insertion is address-specific and should normally remain; if a proven erroneous insertion must be undone, remove only rows created by this approved repair after checking that their reasons have not changed. Never remove existing opt-outs. Private evidence snapshots are stored outside the repository under `/workspace/results/contact-incident/`.
