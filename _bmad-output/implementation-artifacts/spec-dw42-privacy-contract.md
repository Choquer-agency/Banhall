---
title: 'DW42: Record the approved firm-wide knowledge privacy contract'
type: 'chore'
created: '2026-09-04'
status: 'in-review'
baseline_commit: 'b99f1eeef78348df5c14f68031f7f0276527ff3f'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="Previously approved story 2 contract; user-authorized documentation repair">

## Intent

**Problem:** Story 2 implemented de-identification at selected firm-wide knowledge boundaries and an administrator privacy attestation for digest publication, but the domain contract omits both. DW42 records this documentation obligation.

**Approach:** Add a dated amendment to `docs/product-domain.md` documenting only the existing approved CAP-1 contract, and link it from the governed behavioral learning section. The canonical story is `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md`.

## Boundaries & Constraints

**Always:** State that scrubbing is best-effort, regex and project-record driven, with false negatives accepted. Specify the six project identifier fields, contact patterns and preserved prose structure. Distinguish nomination and section-event writes from proposal-event learning reads. Record the administrator's explicit `privacyReviewed: true` requirement on every non-null selection, including restoration; null disable remains reachable. Keep immutable candidates, administrator authority, selection history, and separately governed Brain approval intact. Record compatibility, authorization, verification pointers and existing approval provenance.

**Ask First:** Any proposal to change the approved product policy requires an independent product decision.

**Never:** Change runtime code, schema, canonical story status, deferred ledgers, native run state, or global publication semantics. Do not imply all Brain imports or digest inputs are scrubbed, that historic stored content is backfilled, or that review is stored as a new ledger field. Do not decide story 4 mixed-stream behavior. Do not run heavy gates or install dependencies; root owns those checks. Commit locally only, with no push.

</frozen-after-approval>

## Code Map

- `docs/product-domain.md:165`: existing governed behavioral learning rules; retain these and add the amendment reference.
- `convex/lib/deidentify.ts:20`: pure helper enumerates `clientName`, `title`, `sredTitle`, `writer`, `interviewer`, `interviewees`; contact patterns, placeholders and limitations.
- `convex/brain.ts:213`: `nominateFromReport` scrubs plain report content and project-title label before importing a pending Brain source.
- `convex/generations.ts:1991`: `approveSectionDraft` writes scrubbed draft/approved text after computing editRatio; ghost patch at line 2117 also scrubs.
- `convex/learning.ts:74`: proposal edit digest reader scrubs using the current project, retains raw stored events and handles a missing project with contacts only.
- `convex/learning.ts:305`: `selectDigest` requires `settings.configure`, current-selection concurrency check and privacy flag for non-null ids before selection writes. Personal digests remain prohibited.
- `convex/ai/learning.ts:96`: privacy prompt instruction appended to both digest kinds.
- `src/routes/admin/reviews/+page.svelte:39`: per-kind review state; successful publication resets it, disable omits the flag.
- Canonical story 2: approved scope plus deferred limits for historic rows and other imports. Its Design Notes pseudocode predates review fixes; use the actual implementation for detailed helper behavior.

## Tasks & Acceptance

**Execution:**
- [x] `docs/product-domain.md`: add dated approved-contract amendment and cross-reference, accurately recording boundaries and compatibility.
- [x] `.audit/DW42/evidence.md`: record baseline omission, precise source evidence, verification and limitations.
- [x] `.audit/DW42/decisions.tsv`: append traceable scope and verification decisions.

**Acceptance Criteria:**
- Given the approved story and implementation, when the amendment is read, then each affirmative contract claim has matching evidence and no new policy is introduced.
- Given CAP-1's limited crossings, when compatibility is read, then forward-only writes, raw proposal storage and unscrubbed out-of-scope streams remain explicit.
- Given existing publication governance, when the amendment is read, then non-null publication requires administrator attestation and null disable does not, without changing candidate or authority semantics.
- Given the final diff, when inspected, then only documentation, this repair spec and its audit artifacts change, and no story 4 mixed-stream decision is recorded.

## Spec Change Log

## Verification

- `git diff --check`: no whitespace errors.
- `git diff --name-only`: authorized documentation and repair artifacts only.
- Read every added domain paragraph against the Code Map and canonical story. Baseline must omit the newly recorded contract; updated document must contain it.
- Independent BMAD review remains mandatory; if team capacity prevents dispatch, report the pending review to root without declaring the repair fully verified.
