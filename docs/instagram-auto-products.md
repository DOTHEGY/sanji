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
