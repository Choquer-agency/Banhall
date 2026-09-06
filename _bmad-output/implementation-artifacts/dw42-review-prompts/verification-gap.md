Read `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-privacy-contract/_bmad/render/bmad-build/banhall-bmad-privacy-contract-d91946565f06/76ed2550f5ac0cd01cf5/review-prompts/verification-gap.md` completely and follow it as your review instructions.

Review content:

diff --git a/.audit/DW42/decisions.tsv b/.audit/DW42/decisions.tsv
new file mode 100644
index 0000000..4784ffa
--- /dev/null
+++ b/.audit/DW42/decisions.tsv
@@ -0,0 +1,4 @@
+ts	phase	decision	why	evidence	result
+2026-09-04	scope	Document existing approved CAP-1 contract only	Root delegated DW42 domain-contract repair	_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md	No runtime or policy change
+2026-09-04	verify	Compare amendment with approved story and source	Avoid expanding best-effort privacy guarantee	.audit/DW42/evidence.md	Static verification passed; independent review pending
+2026-09-04	scope	Include Brain reference target named by DW42	Correct missing documentation obligation without changing frozen intent	docs/the-brain.md	Both documentation targets prepared for independent review
diff --git a/.audit/DW42/evidence.md b/.audit/DW42/evidence.md
new file mode 100644
index 0000000..27091e6
--- /dev/null
+++ b/.audit/DW42/evidence.md
@@ -0,0 +1,66 @@
+# DW42 documentation repair evidence
+
+Baseline: `b99f1eeef78348df5c14f68031f7f0276527ff3f`.
+Branch: `codex/bmad-privacy-contract`.
+Scope: documentation of the existing approved story 2 contract only.
+
+## Baseline failure and corrected artifact
+
+A Python comparison using `git show b99f1eeef78348df5c14f68031f7f0276527ff3f:docs/product-domain.md`
+confirmed that the baseline has neither `privacyReviewed` nor the new privacy
+amendment. The updated domain document has `privacyReviewed: true`,
+`digestId: null`, and an explicit reservation of story 4's mixed-stream policy.
+The same check confirmed no em dash in the added amendment. These are static
+document checks, not tests of runtime behavior.
+
+Output:
+
+```text
+PASS: baseline lacks privacy contract; amended document contains publication/null boundaries and preserves unresolved story 4 policy.
+PASS: amendment introduces no em dash.
+```
+
+## Acceptance evidence
+
+| Acceptance | Direct source inspection |
+| --- | --- |
+| Approved contract only | Canonical story 2 read fully in the learn-chat worktree; its Intent, Always/Never boundaries and matrix define the amendment. `convex/lib/deidentify.ts:20-102` confirms actual helper fields, placeholders and best-effort limits. |
+| Exact boundaries and compatibility | `convex/brain.ts:229-250` scrubs nomination prose/title and retains pending approval; `convex/generations.ts:1965-1996,2117` preserves raw report prose/editRatio and scrubs event writes; `convex/learning.ts:74-98` scrubs proposal reads only, using the current or absent project; `convex/learning.ts:102-114` returns stored section-event text. Historic rows and other streams remain deferred in canonical story 2. |
+| Publication, null disable, unchanged authority | `convex/learning.ts:305-365` requires settings.configure, checks expectedSelectionId, gates all non-null ids before same-id return, rejects personal digests, and appends selection events without persisting the privacy flag. `src/routes/admin/reviews/+page.svelte:39,84-87,214-217,233-254,323-344` confirms per-kind state, reset and ungated disable. |
+| Generic rules | `convex/ai/learning.ts:96,114,185` appends the shared privacy instruction to both prompts. |
+| Documentation-only scope | `git diff --check` passed; `git diff --name-only` showed `docs/product-domain.md` before adding the new repair spec/audit artifacts. No runtime, canonical story, ledger, or native run file edited. |
+
+## Existing coverage inspected, not executed
+
+The named test locations were inspected to verify that the domain document's
+verification pointers exist: `convex/lib/deidentify.test.ts:5-155`,
+`convex/brainFeedback.test.ts:556`,
+`convex/generationLifecycle.test.ts:1471,1503,1530`,
+`convex/learning.test.ts:277,302,380,405`, and
+`src/routes/admin/reviews/reviewsPublishGate.component.test.ts:91,120,134`.
+No claim is made that these tests passed in this repair session.
+
+## Pending review and limitations
+
+Root owns BMAD step 04 independent review and all broader runtime gates.
+The local candidate is prepared for review, not marked done. No heavy checks,
+dependency installation, push, canonical ledger/status changes, or native
+run changes were performed. Story 4's mixed-stream decision remains outside
+this documentation repair. Best-effort privacy limitations remain unchanged.
+
+## Brain reference follow-up
+
+Root identified that DW42 also explicitly names `docs/the-brain.md`. Read the
+entire reference and added a bounded CAP-1 section under ingestion instructions.
+It documents the actual `nominateFromReport` content/title scrub, pending status,
+forward-only scope and excluded import paths, then distinguishes digest
+publication from Brain approval and links to the domain amendment.
+Source evidence is unchanged: `convex/brain.ts:229-250` and
+`convex/learning.ts:305-365`, plus the canonical story's deferred import gaps.
+The frozen repair intent was preserved byte-for-byte; only the non-frozen
+execution map, changelog and verification were extended.
+
+Static follow-up checks compare both documents to the original baseline,
+validate the relative link and heading, and ensure the complete tracked diff
+contains only the two docs, repair spec and audit evidence. These checks do
+not claim runtime test execution. Independent review remains pending.
diff --git a/_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md b/_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md
new file mode 100644
index 0000000..ecde016
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md
@@ -0,0 +1,66 @@
+---
+title: 'DW42: Record the approved firm-wide knowledge privacy contract'
+type: 'chore'
+created: '2026-09-04'
+status: 'in-review'
+baseline_commit: 'b99f1eeef78348df5c14f68031f7f0276527ff3f'
+review_loop_iteration: 0
+context: []
+---
+
+<frozen-after-approval reason="Previously approved story 2 contract; user-authorized documentation repair">
+
+## Intent
+
+**Problem:** Story 2 implemented de-identification at selected firm-wide knowledge boundaries and an administrator privacy attestation for digest publication, but the domain contract omits both. DW42 records this documentation obligation.
+
+**Approach:** Add a dated amendment to `docs/product-domain.md` documenting only the existing approved CAP-1 contract, and link it from the governed behavioral learning section. The canonical story is `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md`.
+
+## Boundaries & Constraints
+
+**Always:** State that scrubbing is best-effort, regex and project-record driven, with false negatives accepted. Specify the six project identifier fields, contact patterns and preserved prose structure. Distinguish nomination and section-event writes from proposal-event learning reads. Record the administrator's explicit `privacyReviewed: true` requirement on every non-null selection, including restoration; null disable remains reachable. Keep immutable candidates, administrator authority, selection history, and separately governed Brain approval intact. Record compatibility, authorization, verification pointers and existing approval provenance.
+
+**Ask First:** Any proposal to change the approved product policy requires an independent product decision.
+
+**Never:** Change runtime code, schema, canonical story status, deferred ledgers, native run state, or global publication semantics. Do not imply all Brain imports or digest inputs are scrubbed, that historic stored content is backfilled, or that review is stored as a new ledger field. Do not decide story 4 mixed-stream behavior. Do not run heavy gates or install dependencies; root owns those checks. Commit locally only, with no push.
+
+</frozen-after-approval>
+
+## Code Map
+
+- `docs/the-brain.md:66`: ingestion reference; add the missing nomination scrub boundary and link the approved domain contract, without changing other import instructions.
+
+- `docs/product-domain.md:165`: existing governed behavioral learning rules; retain these and add the amendment reference.
+- `convex/lib/deidentify.ts:20`: pure helper enumerates `clientName`, `title`, `sredTitle`, `writer`, `interviewer`, `interviewees`; contact patterns, placeholders and limitations.
+- `convex/brain.ts:213`: `nominateFromReport` scrubs plain report content and project-title label before importing a pending Brain source.
+- `convex/generations.ts:1991`: `approveSectionDraft` writes scrubbed draft/approved text after computing editRatio; ghost patch at line 2117 also scrubs.
+- `convex/learning.ts:74`: proposal edit digest reader scrubs using the current project, retains raw stored events and handles a missing project with contacts only.
+- `convex/learning.ts:305`: `selectDigest` requires `settings.configure`, current-selection concurrency check and privacy flag for non-null ids before selection writes. Personal digests remain prohibited.
+- `convex/ai/learning.ts:96`: privacy prompt instruction appended to both digest kinds.
+- `src/routes/admin/reviews/+page.svelte:39`: per-kind review state; successful publication resets it, disable omits the flag.
+- Canonical story 2: approved scope plus deferred limits for historic rows and other imports. Its Design Notes pseudocode predates review fixes; use the actual implementation for detailed helper behavior.
+
+## Tasks & Acceptance
+
+**Execution:**
+- [x] `docs/the-brain.md`: document the existing nomination scrub and separate digest publication gate, with a link to the domain amendment.
+- [x] `docs/product-domain.md`: add dated approved-contract amendment and cross-reference, accurately recording boundaries and compatibility.
+- [x] `.audit/DW42/evidence.md`: record baseline omission, precise source evidence, verification and limitations.
+- [x] `.audit/DW42/decisions.tsv`: append traceable scope and verification decisions.
+
+**Acceptance Criteria:**
+- Given the approved story and implementation, when the amendment is read, then each affirmative contract claim has matching evidence and no new policy is introduced.
+- Given CAP-1's limited crossings, when compatibility is read, then forward-only writes, raw proposal storage and unscrubbed out-of-scope streams remain explicit.
+- Given existing publication governance, when the amendment is read, then non-null publication requires administrator attestation and null disable does not, without changing candidate or authority semantics.
+- Given the final diff, when inspected, then only documentation, this repair spec and its audit artifacts change, and no story 4 mixed-stream decision is recorded.
+
+## Spec Change Log
+
+- 2026-09-04: root identified the second documentation target explicitly named by DW42. Added `docs/the-brain.md` to the execution map and verification. Preserve the approved contract, all boundary limitations, and the frozen intent; this corrects the missing implementation target without changing policy.
+
+## Verification
+
+- `git diff --check`: no whitespace errors.
+- `git diff --name-only`: authorized documentation and repair artifacts only.
+- Read every added domain and Brain-reference paragraph against the Code Map and canonical story. Baseline must omit the newly recorded contract and nomination scrub; updated documents must contain them. Verify the Brain reference links to the actual domain amendment heading.
+- Independent BMAD review remains mandatory; if team capacity prevents dispatch, report the pending review to root without declaring the repair fully verified.
diff --git a/docs/product-domain.md b/docs/product-domain.md
index f2105a8..3e62bdb 100644
--- a/docs/product-domain.md
+++ b/docs/product-domain.md
@@ -168,6 +168,7 @@ Rules:
 - Before the first post-amendment candidate is saved, the system freezes the pre-amendment active digest (or explicit absence) so deployment cannot silently change production behavior.
 - Personal digests cannot be published globally. Per-writer activation requires a separately approved scope and privacy contract.
 - Brain sources remain governed separately. Digest publication does not ingest report content into the Brain or alter deterministic CRA scoring rules.
+- The [2026-09-04 privacy amendment](#2026-09-04-privacy-at-selected-firm-wide-knowledge-boundaries-cap-1) defines the approved de-identification boundaries and the privacy review required to publish a digest.
 
 ## Role and capability matrix
 
@@ -1556,6 +1557,66 @@ it follow in `transcripts-2` through `transcripts-7`.
   working two-hour transcript at the 2026-08-26 client meeting; recorded here
   before any code relies on the contract.
 
+### 2026-09-04: Privacy at selected firm-wide knowledge boundaries (CAP-1)
+
+Records the approved AI engine sprint 2 learn/chat story 2 contract and closes
+its missing domain-contract documentation (DW42).
+
+- **De-identification:** `convex/lib/deidentify.ts` applies best-effort,
+  project-record and regex matching, without a model call. The identifier set
+  is `clientName`, `title`, `sredTitle`, `writer`, `interviewer`, and
+  `interviewees`, plus email and phone patterns. Blank identifiers and names
+  shorter than three characters are ignored. Replacements use `[redacted]`,
+  `[redacted email]`, and `[redacted phone]`, preserving prose layout rather
+  than collapsing whitespace. False negatives are accepted in this sprint;
+  this is not a guarantee that all client identifiers are removed.
+- **Write boundaries:** `nominateFromReport` scrubs the report's plain-text
+  content and the project-title portion of its label before importing a
+  `brainSources` candidate. It still enters the pending approval queue.
+  `approveSectionDraft` scrubs `sectionEditEvents.draftText` and
+  `approvedText` before insertion and scrubs `ghostText` when patched later.
+  The edit ratio continues to use raw prose, and report/section prose itself
+  is unchanged by this scrub.
+- **Read boundary:** `proposalWordingEditEvents` retain their raw stored
+  `originalText` and `editedText`. `getProposalWordingEditsForDigest` scrubs
+  those fields when returning learning input, using the current project
+  record. If the project no longer exists, email and phone patterns still
+  apply. A renamed project's previous identifiers may survive this read.
+- **Digest instruction:** both QA-calibration and drafting-style distillation
+  prompts require generic rules and prohibit carrying company names, person
+  names, project titles, email addresses, or phone numbers from events into
+  rules, including identifiers missed by the best-effort scrub.
+- **Publication precondition:** an administrator with `settings.configure`
+  must explicitly submit `privacyReviewed: true` to `selectDigest` for every
+  non-null `digestId`, confirming review for client identifiers. This also
+  applies when restoring an older version or selecting the same version.
+  An absent or false flag rejects the publish operation before a selection
+  event is written. `digestId: null` still disables guidance, including a
+  rollback to no guidance, without privacy attestation; authorization and
+  the current-selection concurrency check still apply. The reviews page
+  holds a separate checkbox for each digest kind, gates its publish buttons,
+  and clears that kind's checkbox after successful publication. Disable
+  guidance is not gated by the privacy checkbox.
+- **Governance and compatibility:** candidates remain immutable and inactive
+  until administrator selection; personal digests cannot be published
+  globally. Existing selection-history and Brain-approval governance remain
+  unchanged. No schema field or persisted privacy-attestation field is added
+  to `learningDigestSelections`. Scrubbing is forward-only for the nomination
+  and section-event write boundaries; existing stored content is not
+  backfilled. CAP-1 does not extend scrubbing to other Brain import paths or
+  other free-text learning streams. Their residual privacy exposure remains
+  recorded in story 2's deferred findings. This amendment makes no decision
+  about story 4's mixed-stream distillation policy.
+- **Verification pointers:** `convex/lib/deidentify.test.ts`,
+  `convex/brainFeedback.test.ts`, `convex/generationLifecycle.test.ts`, and
+  `convex/learning.test.ts` cover the helper, nomination, section writes,
+  proposal reads, and publication gate. The per-kind checkbox and reset are
+  covered by `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`.
+- **Approval:** records the already approved CAP-1 contract in AI engine
+  sprint 2 learn/chat story 2 (`2-de-identification-before-firm-wide-knowledge`),
+  as authorized for the 2026-09-04 failed-story repair. No additional product
+  policy or capability is introduced by this documentation amendment.
+
 ## Amendment process
 
 A change to vocabulary, an invariant, a transition edge, or a decision above requires:
diff --git a/docs/the-brain.md b/docs/the-brain.md
index 18cfed3..a3b1c9c 100644
--- a/docs/the-brain.md
+++ b/docs/the-brain.md
@@ -77,6 +77,26 @@ never commit them. Only the `.example.json` template is tracked.
 **One-off (admin UI):** pending imports appear in `/admin/brain` → Queue →
 review full text → Approve.
 
+### Privacy at the report-nomination boundary (CAP-1, 2026-09-04)
+
+`convex/brain.ts`'s `nominateFromReport` applies `deidentify` to the report's
+plain-text content and the project-title portion of its label before creating
+a pending `brainSources` candidate. Administrator approval is still required
+before retrieval. The scrub uses project-record identifiers and email/phone
+patterns, preserves prose layout, and is best-effort; identifiers can survive.
+This boundary applies to new report nominations. It does not backfill existing
+sources or extend scrubbing to the bulk, curated, or writer-feedback import
+paths described here.
+
+Learning digests have a separate publication gate: an administrator with
+`settings.configure` must pass `privacyReviewed: true` to `selectDigest` for
+any non-null digest selection, including restoring an older version.
+Selecting `digestId: null` disables guidance without that attestation, while
+retaining authorization and concurrency checks. This does not approve a Brain
+source or change the Brain's governance. See the
+[approved privacy contract](product-domain.md#2026-09-04-privacy-at-selected-firm-wide-knowledge-boundaries-cap-1)
+for the exact event write/read boundaries, privacy-review UI, and limitations.
+
 ## Governance cheat-sheet (`/admin/brain`)
 
 | Action | Effect |

Do not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.
