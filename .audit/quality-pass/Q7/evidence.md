# Q7 implementation evidence

Baseline: `73b0b0fe75d16e248ea794b73289574c1530aedb`. Work stayed in the authorized quality-pass checkout. The initial working tree had only the untracked Q7 spec. No install, staging, commit, push, ledger change, backend change, or other-checkout edit was performed. The frozen spec remains unchanged.

Read the entire spec and all five frontmatter context files before implementation. Also read `.factory/AGENTS.factory.md`. Applied TypeScript, prose style and real-artifact verification skills. The TypeScript skill's referenced type-system-discipline skill was not found in the installed skill roots; its explicit TypeScript rules were applied.

## Baseline and repair

Verified the existing full baseline evidence at `../Q4/full-gate.log` and `../Q4/full-gate-exit.txt`: exit 0, including 64 browser files / 499 tests. Subsequent accepted Q5/Q6 changes and their baseline/source proofs are recorded at `../Q5/root-broad-baseline-check.json`, `../Q6/baseline-proof.json`, and `../Q6/final-component.log` (30 passing tests). No evidence invalidated the browser baseline for this wizard-only change.

Added and ran the actual wizard regression before changing production source. `baseline-component.log`: 2 failed / 14 passed. The first failure observed only the first URL/POST after a transient rejection. The second observed zero original-missing warnings after text persistence and review start. Existing transcript and prefill suites passed. `warning-before.png` is the real baseline browser screenshot with no warning (default narrow viewport). `warning-after.png` is the repaired real Toaster at an explicit 1280x900 viewport, after its entrance animation. These demonstrate behavior, not a same-viewport layout comparison. Both captures were visually inspected.

The transport helper now permits at most two attempts, stops on first success, acquires a fresh URL per attempt with the existing 30-second timeout, and uses one aborting 120-second deadline across POST and body consumption. It rejects non-2xx status and unknown JSON without a nonblank string storageId. Only then does it apply the boundary Convex brand assertion. Exhaustion returns undefined for the existing extracted-text fallback. The wizard warns only after review text persistence resolves and before startPdReview.

## Acceptance mapping

| Contract | Runtime proof |
| --- | --- |
| First success attaches once; bytes and MIME preserved | originalUpload.test.ts success / MIME fallback tests; component context-success payload |
| Fresh URL after transient URL/POST/body/HTTP/JSON failure | parameterized unit retry tests; real DOCX review component test |
| Invalid object or empty/non-string ID never succeeds | parameterized unknown-response unit tests |
| URL 30 seconds; POST and JSON share 120 seconds; timers cleaned; two attempts maximum | fake-clock stalled URL, POST, body, shared deadline tests, afterEach timer-count assertion |
| Late URL cannot start abandoned POST; late rejection handled | late resolve/reject unit cases; stalled transport late rejection cases; no unhandled-error test result |
| Saved text without original warns once before review; existing ID and attempt retained | deferred text-save browser test, warning spy verifies no start at emission; success review payload and no failed-attempt calls |
| Text-save rejection preserves failure accounting and does not start review or claim saved text | browser cases with online accounting and offline localStorage outbox |
| Context success/fallback preserved | real DOCX context component cases with original present and missing |
| Transcript sets and prefill untouched | existing newProjectTranscripts and newProjectPrefill suites |

## Commands and results

- `npm run test:component -- src/routes/project/new/newProjectOriginalUpload.component.test.ts src/routes/project/new/newProjectTranscripts.component.test.ts src/routes/project/new/newProjectPrefill.component.test.ts`: baseline exit 1, expected 2 defect failures (`baseline-component.log`); final exit 0, 3 files / 19 tests passed (`final-component.log`). Browser fixtures stub only Convex/auth/navigation/network boundaries; DOCX parsing, wizard, Toaster and outbox are real. During test expansion, Toaster dismissal needed settling before remount, and the outbox fixture additionally needed users:getCurrentUser; both were fixture corrections, with no production changes.
- `npm test -- src/lib/uploads/originalUpload.test.ts src/lib/uploads/outboxFlush.test.ts`: exit 0, 2 files / 45 tests passed (`fixed-unit.log`).
- `npm run check`: exit 0, 0 errors / 0 warnings (`check.log`).
- `git diff --check`: exit 0 (`diff-check.log`). Final source hashes: `source-hashes.json`.

## Limits and handoff

Independent three-lens review, canonical decision log and final full gate remain with the owning root session as the spec requires. No nested reviewers were launched. This is an implementation and targeted-verification handoff, not final quality-pass acceptance.

Only the original transport has these bounds. Two attempts can take roughly 300 seconds; the entire commit() is not bounded. URL timeouts do not cancel queued Convex mutations. Lost upload acknowledgements can leave orphaned storage bytes; no deletion was added. Actual ID validity remains server-validated. FilesPanel/chat uploads are unchanged and Files-panel recovery is not guaranteed. Network boundaries use deterministic stubs; no live storage upload or production backend was exercised.
