# Q7 post-review repair evidence

Reviewed at HEAD `73b0b0fe75d16e248ea794b73289574c1530aedb` in the assigned quality-pass checkout. Read the Q7 spec, three review results, relevant context and transport/wizard source. This patch changes only `originalUpload.ts`, its unit test and `newProjectOriginalUpload.component.test.ts`. The wizard production page is byte-identical to its pre-review snapshot. No install, source change outside Q7, staging, commit, full gate, spec change, ledger operation, or other-checkout write was performed.

`post-review/before.json` binds pre-review helper/test/page bytes, HEAD and35 existing Q7 audit artifacts. Full source/test snapshots use non-discoverable `.txt` names. `post-review/after.json` binds final source hashes, all command exits, screenshot SHA and preservation checks. All35 pre-existing Q7 artifacts, including `warning-observed.png`, remain byte-identical. `post-review/post-review.diff` contains the complete before/after source delta.

## Executed failure before the repair

Added the HTTP error-stream regression while the helper still had only `clearTimeout(timer)` in its transfer finally. Ran:

`npm test -- src/lib/uploads/originalUpload.test.ts src/lib/uploads/outboxFlush.test.ts`

`post-review/baseline-unit.log` and `.exit`: exit1,1 failed/51 passed. The failed assertion received `[false]` instead of `[true]`: retry fetch started while the first503 response's abort-connected body was still active. A real ReadableStream/Response was connected to the supplied AbortSignal, with a pending reader after its first partial JSON chunk. Baseline test cleanup canceled that reader only after the assertion. This is a deterministic local transport regression, not a production network observation.

The repair aborts the controller in finally after clearing the deadline. The same regression passes; its final assertion additionally verifies the pending real body read rejects with AbortError. Timeout abort remains intact. Intermediate `fixed-unit.log` passed52 tests before the final diagnostic-preservation case was added.

## Review dispositions implemented

- Blind2/edge1: unconditional transfer-finally abort releases slow failed HTTP bodies before retry. No response-body draining or new transport abstraction.
- Blind6: the200 response-body test consumes a real ReadableStream via Response.json; timeout abort errors that stream at120seconds, and the second attempt does the same. No json mock in this abort-connected stream case.
- Blind7: four late-success cases cover POST/body settlements after either a successful second attempt or exhaustion. The abandoned storage ID never changes the one observed result. These deliberate non-aborting doubles complement the real abort-connected stream tests.
- Blind8: each URL takes29,999ms, followed by a stalled120,000ms POST. At299,997ms the result remains pending; at299,998ms it is exhausted, both signals are aborted and no timer remains. This exercises the combined near300-second budget with fake time, not a five-minute live request.
- Blind9: the deferred saved-text case resolves `document-text-fallback` and asserts exact `{projectId: "project-new", documentId: "document-text-fallback"}` review-start payload.
- Blind11: after extracted-text save resolves, review-start rejection produces exactly one unchanged original-missing warning plus the existing error messages `review start failed` and the project-created/review-not-started retry guidance. The real Toaster renders the latter; no failed-attempt mutation is issued for the saved text.
- Blind12: future captures go to ignored `.vitest-attachments/Q7-warning-observed.png`. After the last browser pass, the capture was copied once using exclusive file creation to `post-review/warning-final.png` and visually inspected. The test cannot overwrite any historical Q7 audit screenshot.
- Blind1 root correction: root reconsidered the removed existing diagnostic as a preservation regression. The final failed attempt alone logs `console.error("storage upload failed", error)`; recovered first-attempt failures stay quiet. No callbacks, stage taxonomy, wrapper or telemetry framework. Unit console spies suppress expected failures and restore in finally, with final-exhaustion-once and recovered-quiet assertions.

Root retains dispositions for broader backoff/Retry-After, caller cancellation and progress UX (blind3/4/5), spec status (blind13) and final canonical acceptance. No broader work was introduced.

## Persistence proof is deliberately qualified (blind10)

The component tests use mocked Convex mutations: they prove payload, attemptKey presence, exact document-ID propagation, warning/error ordering and absence of failed-attempt calls. They do **not** prove a successful database row was persisted by the wizard. This qualification supersedes any broader reading of the original Q7 acceptance table without rewriting that historical evidence.

There is already real backend coverage. `convex/uploadAttempts.test.ts:131–153`, “uploadDocument resolves the attempt and it leaves the receipt,” invokes the registered uploadDocument mutation with extracted content and attemptKey and **without storageId**, then reads the real convex-test database row and checks status succeeded plus returned documentId. The adjacent dedupe test at156–184 proves the same for a dedupe hit;186–218 proves succeeded remains terminal against later failure reports. These exercise the backend contract independently, not an end-to-end browser/production service path. Ran the existing suite unchanged: `npm test -- convex/uploadAttempts.test.ts`, exit0,17 tests (`post-review/backend-existing.log`). No redundant backend test or policy change was added.

## Failed fixture iterations retained

The first browser iteration (`post-review/component.log`, exit1) expected the generic fallback instead of the existing userErrorMessage behavior for `Error("review start failed")`. It also triggered an unhandled Sonner error during bulk teardown of three real toast notifications; failed cleanup prevented mock restoration and contaminated the following test. Corrected the expectation after inspecting `src/lib/errors.ts` and moved all mock/global restoration into finally.

The second iteration (`post-review/component-final.log`, exit1) corrected the message and prevented contamination, but bulk-dismiss teardown still raised Sonner's toastId error. A400ms settlement wait alone did not solve it. The fixture now dismisses existing notifications oldest-first through public getActiveToasts()/dismiss(), awaiting each real exit before continuing. It neither changes production toast behavior nor suppresses unhandled errors. `component-settled.log` then passed20 tests. The final candidate was rerun after the diagnostic source change, below. These failed attempts are not presented as successful evidence; no library defect is claimed repaired by test cleanup.

## Final candidate commands

| Command | Result | Evidence |
|---|---|---|
| `npm test -- src/lib/uploads/originalUpload.test.ts src/lib/uploads/outboxFlush.test.ts` | Exit0,53 passed in2 files | `post-review/unit-final.log`, `.exit` |
| `npm run test:component -- src/routes/project/new/newProjectOriginalUpload.component.test.ts src/routes/project/new/newProjectTranscripts.component.test.ts src/routes/project/new/newProjectPrefill.component.test.ts` | Exit0,20 passed in3 files; no unhandled-error summary | `post-review/browser-final.log`, `.exit` |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` | Exit0,0 errors/0 warnings | `post-review/check-final.log`, `.exit` |
| `git diff --check` | Exit0 | `post-review/diff-check.log`, `.exit` |

Final helper SHA256 `a2cca4ebaae3fed4ff8f95a945b7de5d44cc99a7b6c0a7a010fed44139e21247`; helper-test SHA256 `43ab7a0fdde4caf8a8f9636b25bffba6d01786079cbf54a5e9c67a6a622444f0`; wizard-test SHA256 `67a46ebe311365e6f6e3e8533779647defb44d1d3838221633df78a00a038967`. Final warning capture SHA256 `65cf8c92b4463ca86fe7b1ff21eb6e3f4002c4c3ea540aa8c5eed05a443cc8ca`.

Only upload transport is bounded. URL timeout does not cancel a queued mutation; late acknowledgements may leave orphaned storage bytes. No deletion, Files-panel recovery guarantee, live server upload or full commit() bound is claimed. Root's final full gate and acceptance remain outstanding.
