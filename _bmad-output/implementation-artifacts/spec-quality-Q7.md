---
title: 'Q7: Preserve original uploads through transient failures'
type: 'bugfix'
created: '2026-09-05'
status: done
baseline_commit: 73b0b0fe75d16e248ea794b73289574c1530aedb
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Wizard original uploads use one unbounded POST, accept failed HTTP JSON and silently lose originals on transient failure.

**Approach:** Retry original uploads twice with fresh URLs, deadlines and response validation. Warn when review originals fail but extracted text persists.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Preserve transcript sets, attempt/outbox accounting, provenance, role checks, human apply and text fallback. Bound URL acquisition using existing withUploadTimeout default 30 seconds; bound POST plus JSON body consumption to 120 seconds and abort transport on timeout. Exactly two attempts, each with a fresh URL. Record evidence under `.audit/quality-pass/Q7/`.

**Ask First:** Backend contract or policy changes require root escalation; transport extraction/tests are authorized.

**Never:** Claim whole commit() is bounded, guarantee Files-panel recovery, change FilesPanel/chat upload flows, delete potentially orphaned storage bytes, mark successful extracted-text attempts failed solely for missing originals, edit other checkouts, commit, stage, push, install, or change ledgers. Root owns independent three-lens review and final full gate. Do not attempt nested reviewer fan-out from the ephemeral implementation session.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Success | First HTTP success, object with nonempty storageId | Attach original once; no retry/warning | Existing text upload follows |
| Transient | First URL/POST/body failure, second succeeds | Fresh URL, attach second result | At most two attempts |
| Invalid response | Non-2xx even with ID; malformed JSON/object/empty ID | Never accept as original success | Retry, then undefined |
| Stalled network | URL promise or POST/body never settles | URL 30s; abort POST/body at 120s per attempt | Timers cleaned; second attempt bounded |
| Exhausted review original | Both attempts fail, extracted document persists | One explicit original-missing warning; start existing review | No guaranteed recovery promise |
| Text upload fails | Original missing and uploadDocument rejects | Existing failed-attempt/outbox and error path | Do not claim review will run |

</frozen-after-approval>

## Code Map

- `src/routes/project/new/+page.svelte:482` uploadOriginal currently contains unsafe single POST. Calls at 627 (context files) and 734 (review PD) share behavior.
- Wizard lines 737–769 persist extracted review document with attemptKey then start review. Emit original-specific warning after successful document persistence, before start; wording describes saved text and missing original, not guaranteed review success.
- `src/lib/uploads/outboxFlush.ts:48` withUploadTimeout bounds URL acquisition; it does not cancel queued Convex mutations.
- New `src/lib/uploads/originalUpload.ts` isolates transport with explicit URL/fetch dependencies; `originalUpload.test.ts` tests deadlines/validation.
- New `src/routes/project/new/newProjectOriginalUpload.component.test.ts` uses real DOCX/wizard patterns from newProjectTranscripts. Seed users:getMyUser and createProject result {projectId,transcriptIds:[]}; select the written-PD input. Mutation stubs accept values/Promises, not callbacks; update URL result from controlled fetch failure. Mount real Toaster for screenshots; defer text-save resolution to prove warning/start ordering.
- `src/lib/components/editor/FilesPanel.svelte:256` also lacks transport guards; do not promise replacement recovery.

## Tasks & Acceptance

**Execution:**
- [x] `newProjectOriginalUpload.component.test.ts` — submit real wizard/DOCX; reproduce baseline lost original and missing warning. Stub only network/Convex boundaries.
- [x] `originalUpload.ts` and `originalUpload.test.ts` — extract transport, two attempts, URL timeout reuse, aborting POST/body deadline, HTTP check and unknown response validation. Validate unknown JSON object/nonempty string before a boundary-only Convex brand assertion; server validates actual ID validity.
- [x] `+page.svelte` — delegate transport; warn after successful text persistence; preserve attempt/review sequencing.
- [x] Tests — cover matrix, fake-time abort/cleanup, actual wizard payload/warning, bytes/MIME and context-file success.
- [x] `.audit/quality-pass/Q7/` — old-fail/new-pass logs, before/after warning screenshots, evidence.md; root owns the canonical quality-pass decision log.

**Acceptance Criteria:**
- Given a late URL result after timeout, when it resolves, then abandoned attempt does not start a late POST or attach bytes; no unhandled rejection remains.
- Given text persists without original, when review continues, then its mutation receives existing document ID and upload-attempt success is preserved, with one truthful warning.

## Spec Change Log

## Design Notes

AbortController plus cleaned deadline covers fetch/body. Two attempts can total roughly 300 seconds; other mutations retain existing bounds. Lost acknowledgements may orphan bytes; no cleanup added. Warning: “The PD text was saved, but the original file ‘NAME’ could not be uploaded.”

## Verification

**Commands:**
- Root has completed the full browser baseline before component work. Verify that evidence, then run this unit's actual component regression against unchanged production source before editing it; rerun full baseline only if new evidence invalidates it.
- `npm run test:component -- src/routes/project/new/newProjectOriginalUpload.component.test.ts src/routes/project/new/newProjectTranscripts.component.test.ts src/routes/project/new/newProjectPrefill.component.test.ts` — baseline defect fails, repaired real submissions pass.
- `npm test -- src/lib/uploads/originalUpload.test.ts src/lib/uploads/outboxFlush.test.ts` — deterministic timeout, abort, validation and retry cases pass.
- `npm run check` and `git diff --check` — clean; root owns final full gate and independent review.

## Suggested Review Order

- Bound each attempt and release transport before retry.
  [originalUpload.ts:12](../../src/lib/uploads/originalUpload.ts#L12)

- Warn only after extracted text was saved.
  [+page.svelte:752](../../src/routes/project/new/+page.svelte#L752)

- Exercise deadlines, real stream abort and late settlements.
  [originalUpload.test.ts:110](../../src/lib/uploads/originalUpload.test.ts#L110)

- Verify saved-text warning order through the real wizard.
  [newProjectOriginalUpload.component.test.ts:122](../../src/routes/project/new/newProjectOriginalUpload.component.test.ts#L122)
