# Public product catalog Sheet settings

## Implemented scope

The Supabase workspace's **연동 설정 → 공개 상품 시트 연결** panel lets an authenticated operator connect, refresh the recorded check, or disconnect a public product-list link. It does not create a Sheet, change Google sharing, grant OAuth scopes, copy products into a Sheet, or send DM/email.

The operator enters a Google Sheet edit URL, the actual observation time in Korean time, and the actual check method:

- `owner_sharing_ui`: Google’s Share UI was inspected and showed anyone-with-link **Viewer**. Anonymous content access is not claimed.
- `anonymous_read`: both the sharing setting and logged-out/private-window reading were checked.

A separate acknowledgment covers the entire workbook and every tab: only approved product names and public product links, without internal commissions, transaction terms, contacts, or creator correspondence. The UI says **운영자 확인 기록 · 자동 접근 검사 아님**. Saving does not run a network access probe against Google.

URLs are restricted to the standard HTTPS `docs.google.com/spreadsheets/d/<id>/edit` form. Known `usp`/numeric `gid` decorations are normalized away; secrets, arbitrary query strings, credentials, fragments other than numeric sheet IDs, nonstandard ports, and other document types are rejected. The owner ID, method, provenance, allowed public fields acknowledgment, and actual UTC observation time are saved. A missing, foreign, revoked, malformed, future, or older-than-24-hour record omits the link and displays an internal warning. The live URL is never hard-coded into repository files.

## Storage and concurrency

`catalogSheetSettingsApi` reads exactly one existing settings row for the expected owner. It pins the original access token on both read and existing `sanji_save_record` RPC requests, checks session/owner/lifecycle before and after asynchronous boundaries, and supplies the exact row ID and version. It never falls back to inserting a settings row. The connection write is a one-key partial settings update. Disconnect writes explicit `productCatalogSheet: null`; omission would preserve the previous link.

This relies on the existing `202610240002_settings_signature_merge.sql` behavior. It must be verified on the target deployment before rollout. A read-only capability check on the target on 2026-11-04 confirmed both existing-data merge and new-key preservation. The local SQL test verifies unrelated sender/signature preservation, null disconnect, conflict rejection, and foreign-record rejection. No migration or new account permission is part of this change.

Updating the shared settings row increments its version. Existing isolated email approvals deliberately pin that version, so linking, renewing, or disconnecting a Sheet can require those drafts to be reviewed again. The UI discloses this consequence; no email guard or sender/signature requirement is weakened.

An uncertain save disables further mutation until the operator explicitly rereads stored state. Navigation/account changes discard late results. Repeated submissions cannot duplicate writes. Edited inputs are not silently replaced after a pending save. The Node fallback is explicitly unsupported rather than silently discarding the new key.

Open product drafts compare captured/current Sheet fields semantically. Linked copy/official-editor insertion also rereads the stored setting; competing reads are gated, versions cannot regress, and a response cannot overwrite a newer local disconnect or replacement. Already copied text and historical saved drafts are not erased. Google access can still change after an observation: this feature does not certify perpetual access or retract earlier copies.

The [Supabase RPC interface](https://supabase.com/docs/reference/javascript/rpc) is used with the existing versioned database function. Session reads are lifecycle checks, not independent authorization; ownership and version enforcement remain in the existing SQL function. [Supabase documents the distinction between retrieving a session and validating identity.](https://supabase.com/docs/reference/javascript/auth-getsession)

## Product-addition synchronization: design only, not running

The user’s desired future behavior is to keep this one public list up to date when a product deal is added. This panel does **not** implement that behavior. A separate implementation must satisfy all of the following before claiming it is active:

1. Bind one verified owner workspace to one exact spreadsheet ID and tab/range. Do not place credentials in this UI, a public bundle, a URL, or a setting field. Use an already-authorized official integration if it can perform the bounded operation. Creating or expanding persistent credentials needs its own action-time approval.
2. Fetch a complete, stable, owner-filtered deal snapshot. Project **only product name and approved public product URL**. Do not copy the deal object, source notes, commissions, costs, contacts, creator information, or private evidence. Reject formula-leading text or write with raw-value semantics.
3. Maintain an idempotent private deal-to-row receipt. Append newly added deals once. Preserve operator-edited cells; do not overwrite a row, delete rows, change permissions, or add extra columns without the corresponding scope. Ambiguous identity, partial scans, or concurrent edits hold rather than guess.
4. Before a write, verify the exact file/tab and current permitted public-reader setting through supported official capabilities. A permission check is distinct from a content write. The [Drive permission-list API](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/list) is one possible capability; availability in the actual connected integration must be checked first.
5. Use a bounded official append operation and reread the affected range to confirm exact values and one-time application. [Sheets append requires an exact spreadsheet ID/range and input interpretation option.](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append) If an append outcome is uncertain, inspect before retrying. Do not claim trigger immediacy or recurring execution until an actual trigger/schedule is installed and tested.
6. Verify API quota/cost, retry limits, ownership changes, revoked sharing, manual edits, and duplicate delivery. Keep an owner-visible last-success time, error/hold reason, and pause control. No such writer, schedule, or ongoing access was installed by this patch.

## Verification

API and UI tests cover strict metadata validation, KST conversion, key-order-independent equality, same-input mutation, pinned owner/token checks, partial settings preservation, stale versions, missing/duplicate rows, uncertain writes, concurrent copy rechecks, local and remote disconnect, expiry, and late textarea changes. Optional Playwright tests cover desktop/mobile connection and disconnection without contacting Google. Browser execution requires the CI browser environment; local Chromium is restricted here.
