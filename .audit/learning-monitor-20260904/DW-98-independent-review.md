# DW-98 independent review, 2026-09-05

Result: **one medium patch finding remains**. Four fresh BMAD review layers completed in two concurrency waves. This fulfills the bounded follow-up review, but does not establish clean acceptance or close DW-98. No product/spec/ledger/native state was changed, no dependencies installed, and no test, commit, merge or push performed.

Owned checkout `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw98-review`, branch `codex/bmad-dw98-review`, exact target `e8abbc14523eff3e1aa490712e7efafe9cd86b24`. Reviewed accepted story 7 `1b0511611f0766f90b61bb01afea011085fcc4cf` against baseline `438edf107a85d443480a3027fe8d19e0f9195106`. Read complete story 7 contract, three prior triage files and accepted evidence, plus full source/test diff and relevant backend routing contract. Applied bmad-code-review and applicable TypeScript/Convex/Svelte guidance. Skill step 4 writes are redirected to these audit action items under the explicit read-only assignment; original story/status remains untouched.

## Finding 1: initial implicit draft Retry can send into a different conversation

**Medium, patch, no new product decision required.** On an initially empty report, `startingNewChat` begins false (`AgentChatPanel.svelte:188-191`). The first composer send captures neither `threadId` nor `newThread` at lines 659-662. Only after capture does line 679 set `startingNewChat=true`. Its local request is assigned a distinct draft scope, retained on failure and selectable from Unsent conversations.

Concrete reachable sequence:

1. Send A from the initial empty report composer, without first selecting New conversation. Let it fail definitively before creating a backend thread.
2. Select New conversation, send B successfully, and let B become the report's latest thread.
3. Return to retained Unsent conversation A and activate Retry.
4. `retryRequest`/`transmitRequest` resend `request.args` unchanged (lines694-709). They still have no explicit destination. `convex/chatV2.ts:316-324` resolves those arguments to the latest report thread, B. A is appended to B, and local completion promotes A's scope to B (panel716-722).

This violates the story's captured conversation intent, distinct not-yet-created origin and matrix requirement “Retry targets origin only.” It does not rely on ambiguous transport success, duplicate backend submission, page visibility, or reload: A can fail without committing anything. It is therefore separate from every declared limitation below. Backend routing is unchanged; this defect is exposed by retaining and retrying an older independently navigable implicit draft.

Required action: capture the unsaved conversation's explicit creation intent using the existing API at initial send, then preserve those arguments on retry. Add an actual-panel regression starting with the implicit empty report draft A, failure, successful separate B, then return/retry A; prove request/destination separation and newer draft preservation. No backend/permission change is shown necessary. Root retains repair authorization and integration ownership.

Existing `OptimisticSend.component.test.ts:185-208` covers an **explicit** New conversation before A, so `newThread:true` is already captured and the failure does not arise. The initial-empty test at lines48-74 exercises success, while lines210-226 cover successful initial mutation completion after navigation; neither combines failed implicit A with a newly persisted B. Static source and backend routing establish the missing case without inventing a transport result, so no new runtime test was necessary for this adjudication. A repair should retain before/after actual-panel proof.

## Four-layer triage

Blind hunter raised a published local row remaining Sending when its prompt leaves the loaded page. Dismissed: the contract explicitly removes local rows only after exact returned identity is observed in that thread's persisted page, and second prior triage already records that boundary. Durable turn completion alone is not the specified acknowledgement. Edge hunter independently raised finding 1. Verification layer reported no gaps. Acceptance initially reported no violations; after a bounded triage question and reading the concrete backend fallback, it revised its conclusion and confirmed finding 1 as an origin-only contract violation. No layer failed; all four initial reviewer contexts were fresh.

Totals: decision-needed 0, patch 1 (medium), defer 0, dismiss 1; duplicate edge/acceptance claim merged. No patch made. Individual outputs/dispositions are in `layers.json` and structured findings in `triage.json`.

## Existing proof and explicit limits

Retained gate revision `6db7560ac132cb7f10ef71dbb1fd6b3f851bcd79` differs from target only in audit/spec/ledger artifacts. `second-source.sha256` verifies all four executable/test files at target: AgentChatPanel, OptimisticSend tests, uiMessages and RegenerateTurn tests. Accepted commit and merged target have identical trees. Exact identity checks and changed-path inventory are in `source-identity.json`.

Reused `.audit/story-7/second-final-component.txt:580-581` reports **428 tests / 59 files**, `second-final-unit.txt:9-10` reports **1911 / 149**, and `second-final-check.txt:8` reports **0 errors / 0 warnings**. Accepted evidence identifies `6db7560ac132cb7f10ef71dbb1fd6b3f851bcd79` and records successful command exits. These exact-source accepted receipts were inspected, not rerun by this reviewer. They do not disprove the missing implicit-draft transition.

No additional confirmed violation was found in immediate insertion, exact persisted-ID/thread handoff, captured text/highlight/refinement, historical resend, newer draft preservation, narrow long-text containment, blank-error fallback, focus preservation, synthetic-order exclusion, Stop or terminal/navigation guards. Declared limitations remain: temporary publication-first duplication until mutation identity arrives; acknowledgement only in the loaded persisted page; local failures lost on reload; no backend idempotency; controlled transport rather than live provider/deployed lifecycle proof. Those are not recounted as new defects.

Separately verified DW-97 research guard repair `5df0d2c4ae9677a891cd8ca19f2669da40fc4311` is pending integration and is excluded from DW-98 findings. Neither this review nor reused tests prove its combined integration with story 7 or later stories. Root must reconcile and verify the combined source at the safe native boundary.

Durable artifacts in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw98-review/.audit/DW-98-independent-review`: review.diff, exact numbered source-evidence.md, source-identity.json, layers.json, triage.json, report.md. Working tree remains clean outside ignored audit output; original source/spec/ledger bytes remain exact target.
