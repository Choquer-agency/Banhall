---
title: 'DW42: Record the approved firm-wide knowledge privacy contract'
type: 'chore'
created: '2026-09-04'
status: 'done'
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

- Portable canonical reference: [story 2](../specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md), including its deferred findings; [CAP-1 definition](../specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md#capabilities). The absolute path inside frozen intent is historical and retained verbatim.
- All implementation/test line citations below and in audit evidence refer to `b99f1eeef78348df5c14f68031f7f0276527ff3f`.

- `docs/the-brain.md:66`: ingestion reference; add the missing nomination scrub boundary and link the approved domain contract, without changing other import instructions.

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
- [x] `.audit/DW42/verify.py`: reproducible baseline, final scope, reference, source identity and frozen-intent checks.
- [x] `.audit/DW42/review.md`: record root-reported independent review results and patch triage.
- [x] `docs/the-brain.md`: document the existing nomination scrub and separate digest publication gate, with a link to the domain amendment.
- [x] `docs/product-domain.md`: add dated approved-contract amendment and cross-reference, accurately recording boundaries and compatibility.
- [x] `.audit/DW42/evidence.md`: record baseline omission, precise source evidence, verification and limitations.
- [x] `.audit/DW42/decisions.tsv`: append traceable scope and verification decisions.

**Acceptance Criteria:**
- Given the approved story and implementation, when the amendment is read, then each affirmative contract claim has matching evidence and no new policy is introduced.
- Given CAP-1's limited crossings, when compatibility is read, then forward-only writes, raw proposal storage and unscrubbed out-of-scope streams remain explicit.
- Given existing publication governance, when the amendment is read, then non-null publication requires administrator attestation and null disable does not, without changing candidate or authority semantics.
- Given the final diff, when inspected, then only documentation, this repair spec and its audit artifacts change, and no story 4 mixed-stream decision is recorded.

## Spec Change Log

- 2026-09-04: root identified the second documentation target explicitly named by DW42. Added `docs/the-brain.md` to the execution map and verification. Preserve the approved contract, all boundary limitations, and the frozen intent; this corrects the missing implementation target without changing policy.

## Verification

- `python3 .audit/DW42/verify.py`: compare the baseline to the final working candidate including staged/new files, allowlisting only repair artifacts and separately accounting for the three untracked review prompts.
- `git diff b99f1eeef78348df5c14f68031f7f0276527ff3f --check`: no whitespace errors.
- Read every added domain and Brain-reference paragraph against the Code Map and canonical story. Baseline must omit the newly recorded contract and nomination scrub; updated documents must contain them. Verify the Brain reference links to the actual domain amendment heading.
- Root reported all three independent BMAD layers complete; triage and applied patches are recorded in `.audit/DW42/review.md`. Broader product runtime gates remain root-owned.

## Suggested Review Order

- Read the approved privacy boundaries and publication precondition.
  [product-domain.md:1560](../../docs/product-domain.md#L1560)

- See how nomination privacy fits the existing Brain ingestion reference.
  [the-brain.md:80](../../docs/the-brain.md#L80)

- Verify authorization and the exact source revision.
  [evidence.md:7](../../.audit/DW42/evidence.md#L7)

- Review dispositions for the ten independent findings.
  [review.md:1](../../.audit/DW42/review.md#L1)

- Rerun the static checks against the final candidate.
  [verify.py:1](../../.audit/DW42/verify.py#L1)
