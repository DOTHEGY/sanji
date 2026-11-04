# Source-grounded Instagram product candidates

This feature prepares local review material. It does not send a DM, save a new note, change the original draft, or authorize contact.

## Input and scope

- Inspect the owner's entire saved deal snapshot returned by the existing stable, owner-scoped record scan. Report the loaded row count, distinct product count after option deduplication, and whether the snapshot was complete.
- Bind official conversation context to the selected account, peer and exact message snapshot. Bind historical context to the saved note ID, creator ID, handle and signed-in owner.
- The isolated `creator-manual-notes` function exposes a read-only `/creator-manual-notes/context` route. It verifies the authenticated member and exact active note/creator twice, projects only stored public context, and checks source changes. It does not change permissions, schema, credentials or legacy function routing.
- Stored public observations retain their original observation time and source URLs. Historical evidence is labeled as such. Neither a profile record nor a saved observation establishes current activity or complete provider-inbox coverage.
- When observations store topics and source URLs without a topic-to-URL mapping, cards show the dated source bundle and explicitly leave that mapping unconfirmed. Stored category matches do not certify product suitability.

## Selection and draft

The pure browser engine ranks up to three distinct products. A directly matching general content topic is distinguished from a bounded content-scene inference. Each candidate displays its reason, supporting fields or source URLs, and uncertainty. There is no arbitrary fill to reach three. Remaining products and blocked products are listed separately.

Product variants, packaging sizes and price variants are deduplicated where supported by explicit identity. Sold-out, excluded and held products are blocked. A creator's refusal or stop request prevents a commercial proposal. Scoped exclusions remove the relevant products or categories. Inquiry and uncertain intent do not establish consent.

The editable draft answers the recorded inquiry first and may present supported candidates as tentative examples. It does not claim acceptance, promise terms or benefits, include commission figures, or infer health conditions, demographic audience traits, product efficacy or preferences. Original historical notes and drafts remain visible and unchanged.

Email-channel requests and recorded contact uncertainty are handled separately. Drafts do not invent, correct or send an email address. If the available context is too ambiguous, the generated text stays blank with a prompt to review the preserved original draft.

Review checkboxes are not automatically affirmed. Selection changes, exclusions, account changes, refreshed records, newer messages, navigation and dialog replacement invalidate the applicable review state. Replacing user-edited text requires confirmation. Historical proposals remain copy-only and cannot populate the official reply field.

## Verification

Pure engine tests cover matching, inference, deduplication, uncertainty, refusal, scoped exclusions, source dates, privacy and commission omission. UI tests cover source binding, pending requests, repeated actions, edited-draft preservation and separate remaining catalog display. Backend and bound-client tests cover owner/member validation, exact identity, corrected notes, projected public fields, revoked sources and token/session races. CI runs the browser cases at desktop and mobile widths.

No private conversation content, creator-specific observations or business terms belong in repository fixtures. Live content evaluation remains in private task artifacts.

## Saved selling points (2026-11-04)

The local draft generator reuses current persisted deal `claims` only when the latest complete `[상품 소구점 확인]` / `[/상품 소구점 확인]` block in `sourceNote` contains the same 상품ID, valid 확인일 within90days, 검증범위 `공식 상세페이지`, exact UTF-8 소구점SHA256, nonempty affirmative 근거 and safe public 출처 URLs. Each URL has its own `출처:` line. 상품목록만, missing/malformed metadata, changed claims, withdrawn/pending records and future/stale dates hold the selling points. This validates an operator-recorded source snapshot, not an independent live page visit or truth guarantee. No source-note prefix or private negotiation text is copied.

Eligible whole factual sentences are reused rather than embellished. Fees/commissions, payment promises, private contacts/links, unsupported medical/child-safety statements and instruction-like payloads are excluded. A missing usable point is disclosed, never invented. The matching card retains the source/date and the distinction between saved facts, dated public channel observations and an inferred content angle. Product stock, pricing, support and cooperation conditions remain unconfirmed. Explicit standalone-add-on limits hold the product instead of upgrading it to a standalone offer.

Current nonquoted, nonnegative reply preferences can reorder only products already supported by public/stored channel context. They cannot create creator interests, override refusals/category exclusions, or imply acceptance. Historical summaries are not silently upgraded to current positive preferences. At most3 distinct groups are selected, and only an eligible selected variant supplies its own product-bound points. No new outbound/send/save API exists.

Drafts preserve the existing reply-first tone, include saved points and a bounded content-angle suggestion, and omit commissions. They compact by dropping whole extra sentences/content-angle lines if needed for the existing1000-character DM editor; if still too long, generation holds for review. Nothing truncates a factual qualifier mid-sentence or overwrites an existing saved draft. Existing regeneration confirmation and owner/context review gates remain in place.

The source-only change has dedicated synthetic regression tests in `tests/instagram-saved-selling-points.test.cjs`. Those tests compare SHA256 against Node crypto including Korean, emoji and block boundaries, and cover invalid/revoked evidence, private data, variant provenance, refusal/health/add-on constraints, positive/negative preferences, immutability and length handling. The feature has no dependency on unpublished research files: data must actually be saved to the current owner's product records before it is used.

## Creator reply copy and catalog link

The November 4 user-authored reply is the tone/structure reference for clear product-information requests: warm thanks, up to three numbered product facts, freedom to choose other products, an optional catalog sheet, and an invitation to discuss a longer-term collaboration. It does not assert that the sender personally studied the recipient's channel, knows audience interests, or has confirmed stock or commercial terms. Questions about method/cost still come first, and refusal and uncertain-email holds still win. No commission is added.

The pure planner accepts `catalog.sharedSheet`. The UI snapshots this from the current owner's existing `settings.productCatalogSheet` only when its `ownerId` matches the owner-bound catalog. The Supabase-only “공개 상품 시트 연결” form records the exact owner ID, a canonical `https://docs.google.com/spreadsheets/d/<id>/edit` URL, `access: "anyone_reader"`, the ISO `verifiedAt` time of an actual operator check, `provenance: "operator_attested_public_read"`, `publicFieldsOnly: true`, and `verificationMethod` (`owner_sharing_ui` or `anonymous_read`). The form states “운영자 확인 기록 · 자동 접근 검사 아님”. It updates only the current owner's existing, version-checked settings row; it creates no settings row, Google permission, account access, or Sheet. Revoked, stale (over 24 hours), future, foreign-owner, private, or malformed records are omitted from copy, with an explicit internal warning. This is a recorded access check, not a live permission probe; it makes no automatic sheet-sync promise. A settings change, disconnect, expiry, or late competing response invalidates open review/copy actions. Before copying a linked draft or inserting it into the official reply editor, the stored setting is reread with the original owner/session and compared by semantic fields and non-regressing row version. No Google or recipient message is sent. Do not mark a private sheet public merely to satisfy the parser.

Drafts remain bounded to 1,000 characters. Whole selling-point sentences are compacted before holding an overlong draft; copy is never cut mid-fact. User edits, original notes, and official reply transport are unchanged.
