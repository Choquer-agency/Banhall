---
title: 'Branch consolidation B12: observe PDF work after deadline expiration'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
baseline_commit: '38fd254c359cf9589063098f06c7f0356d5882cc'
authorization_basis: 'User requested thorough audited integration and fixes before merging all remaining branches.'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="existing parser contract and independently reproduced defect">

## Intent

**Problem:** A PDF operation begins before JavaScript enters the deadline wrapper. If the shared deadline has expired by that point, the wrapper returns a separate timeout without observing that already-started operation. A later pdf.js rejection becomes unhandled even though the parser has returned its normal partial result. This predates B1 and was independently reproduced through the public parser in both page retrieval and text extraction. Native deferred entry DW-100 records the evidence.

**Approach:** Observe the supplied promise's eventual rejection on the expired-entry path, then immediately return the same timeout. Add durable regression coverage through the real public parser with only the pdf.js boundary and clock controlled. Preserve B1 timer cleanup and its production-sensitive sequential proof.

## Boundaries & Constraints

**Always:** Retain the absolute 60-second deadline, ParseTimeout behavior, partial text and page marker, empty text for document-load timeout, and one loading-task destruction. Positive-budget errors still propagate unchanged. A never-settling operation must not delay the expired return. Keep all existing parser tests and public exports. Work only in the parent's designated consolidation checkout. This is an authorized BMAD follow-up; the generic factory engine and shipping rules do not replace the user's selected workflow.

**Ask First:** A change to duration, supported input formats, user-visible marker, normal error handling, or destruction policy requires an actual new intent decision. No such change is needed to observe an already-started promise.

**Never:** Await an expired operation, swallow positive-budget errors, reset the deadline, change extraction sequencing, or export the private helper just for a test. Do not change any other product file, native run state, or deferred ledger. Do not install dependencies, mutate another worktree, commit, push, merge or run deployment tools. The parent owns review, full gate, ledger closure and shipping.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Expired page retrieval | Page two starts work while clock crosses deadline, then rejects later | Return page-one text and page-two marker promptly, destroy once | No unhandled rejection |
| Expired text extraction | Page two's text operation starts as budget expires, then rejects later | Same existing partial result and cleanup | No unhandled rejection |
| Expired pending operation | Started operation never settles | Return existing timeout result promptly | No wait and no residual deadline timer |
| Positive budget | Operation rejects before deadline | Same original rejection and cleanup as before | Error is propagated, not swallowed |

</frozen-after-approval>

## Code Map

- `src/lib/parseDocument.ts`: withDeadline early return is the only production change. Call sites evaluate getPage/getTextContent before invoking it; preserve the surrounding parser and B1 timer-finally path.
- `src/lib/parseDocument.test.ts`: maintained public-parser suite. Extend fixture minimally for an operation that changes the clock as it begins and rejects after the parser returns. Prefer meaningful public behavior and actual unhandled-error detection to spying on a particular catch implementation.
- `.audit/branch-consolidation/parser-expired-audit/findings.md`, `build.mjs`, `probe.mjs`, and current/fixed logs: independently reviewed reachability evidence and hypothetical compiled-artifact control. Read these as evidence, not as a replacement for tests of the actual final source. Do not overwrite the original audit.
- `_bmad-output/implementation-artifacts/deferred-work.md`: DW-100 remains open until parent validation. Worker reads only if useful; parent owns all changes.
- `scripts/loop-verify.sh`: canonical parent gate. Existing private dependencies were installed from the lockfile and the full pre-B1 baseline passed.

## Tasks & Acceptance

**Execution:**
- [x] Add public-parser regression cases first and capture their actual failure against unchanged B1 source. Keep raw command output and exact source hashes. If the runner reports unhandled rejection outside a test, record that honestly as the reproduced failure rather than manufacturing a synchronous assertion failure.
- [x] Repair only the expired-entry observation path, without changing timeout result or waiting for underlying settlement.
- [x] Run the complete maintained parser suite. Prove late rejection for both page and text paths, immediate return for pending work, and continued positive-budget error propagation. Preserve timer and sequential assertions.
- [x] Record the actual final commands, exit statuses, source identities, outputs and remaining limits under `.audit/branch-consolidation/B12/`, with a concise `evidence.md`. Report readiness to the parent without claiming final merge completion.

**Acceptance Criteria:**
- Given either reachable expired-entry rejection, when the actual parser returns and worker rejection occurs later, then the existing output and destruction count are preserved and no unhandled rejection is observed.
- Given an expired never-settling promise, when parsing reaches it, then the public call resolves promptly with the existing timeout outcome.
- Given an ordinary pre-deadline failure, when parsing handles it, then the original error is still observable by the caller.
- Given all B1 regressions, when this repair is applied, then all existing cleanup, deadline and sequential proofs continue to pass.

## Spec Change Log

## Verification

**Commands:** `npx vitest run src/lib/parseDocument.test.ts`, with retained before/after logs and source hashes; `git diff --check`. A bounded separate Node probe may supplement, but not replace, maintained coverage. Keep diagnostic archives outside executable test discovery. Parent follows with three fresh BMAD review layers and the canonical full gate before closing DW-100 and committing this unit. Report any blocked command exactly; do not claim an unexecuted pass.

## Suggested Review Order

- Observe expired work synchronously while returning the same immediate timeout.
  [parseDocument.ts:66](../../src/lib/parseDocument.ts#L66)

- Prove actual late errors are observed through the public parser.
  [parseDocument.test.ts:288](../../src/lib/parseDocument.test.ts#L288)

- Prove expired pending work cannot hold the public parse open.
  [parseDocument.test.ts:328](../../src/lib/parseDocument.test.ts#L328)

## Parent Acceptance

Three fresh Astra6 medium reviews completed and root triaged all findings. The canonical nine-step gate passed:1,980 unit and463 browser tests, types, build and both uploader harnesses. Tested source hashes match after.json; all tracked paths were preserved except intentional product changes and separately captured/restored historical screenshots. Parent closed DW-100 through the installed native API after verification and preserved all other99 entries. No sprint story key is attached, so sprint synchronization is a no-op. User authorization already covers eventual reviewed push and main merge.
