# CAP-8 verification evidence

Verified implementation commit: `b13d5ce9f93fe00ad0d02e15294954a20961b69d`. The verified working-tree source was committed unchanged; the subsequent audit-only commit records this identifier.

Baseline commit: `f122b086d745acc40b4decca26b9aaafc7257f6a`.

## Acceptance mapping

| Behavior | Runtime evidence |
|---|---|
| Canonical deterministic persistence | qaBlocking: human content save; single-candidate completion |
| Because/methodology block readiness and publish atomically | qaBlocking: human content save; both explicit compliance flag cases |
| Absolute rule despite manager/admin feedback | qaBlocking: manager/admin cannot waive; qaChecks: all writer waivers outside P5 |
| Advisory-only client review remains available | qaBlocking: house-style findings and false verbiage |
| Human correction leaves old history and reevaluates current content | qaBlocking: human correction |
| Late QA does not become current | qaBlocking: QA input uses current content and late completion |
| Legacy reports cannot bypass deterministic failure | qaBlocking: legacy rows without QA/revision/hash |
| Foreign report and stale hash isolation | qaBlocking: foreign report identity and stale content hash |
| Retry deduplication and no score-based waiver | qaBlocking: same-revision QA retries |
| Existing authorization retained | qaBlocking: publish authorization precedes QA; projects.test.ts |

## Completed commands

`npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`

```text
Test Files  3 passed (3)
Tests  115 passed (115)
Duration  9.59s
```

`npx vitest run convex/ai/qaChecks.test.ts convex/ai/prompts.test.ts convex/lib/tiptapReport.test.ts`

See the retained verification log; implementation agent ran this command and root inspected the output.

`git diff --name-only -- src/` returned no paths. `git diff --check` returned no errors.

## Tooling prerequisite

Initial Vite runs failed before executing tests with TSCONFIG_ERROR for shared modules. A shared-only config enabled backend tests but the full run still failed 44 suites before execution. Explicit root tsconfig.json includes preserve the Svelte file set and cover shared modules; a frontend/CAP-8 probe then passed 40 tests. The intermediate shared config was removed. No generated files were modified.

## Pre-review full gate

`bash scripts/loop-verify.sh` completed with exit 0.

```text
svelte-check found 0 errors and 0 warnings
Test Files  128 passed (128)
Tests  1376 passed (1376)
PowerShell harness: 50 passed, 0 failed
Bash harness: 18 passed, 0 failed
```

Convex `tsc --noEmit` also passed as the first command under the gate's `set -e`. Full raw output retained in `gate-before-review.log`. Review fixes require a fresh gate before finalization.

## Final review verification

`bash scripts/loop-verify.sh` completed with exit 0 after all review fixes.

```text
svelte-check found 0 errors and 0 warnings
Test Files  128 passed (128)
Tests  1393 passed (1393)
PowerShell: 50 passed, 0 failed
Bash: 18 passed, 0 failed
```

Convex TypeScript passed as the gate's first command. Full output: `gate-reviewed.log`.

The exact spec-focused command passed 129 tests in 3 files; output: `focused-reviewed.log`. Review-focused provider/extraction/persistence checks passed 123 tests; the final extraction/QA rerun passed 36 tests. No source or assertion changed after this full gate.

Additional review coverage: same-content save and restoration preserve methodology blockers; heading-like body prose cannot bypass readiness/publish; section-specific rows deduplicate independently; a real post-QA provider false flag reaches stored findings and both gates; proposal apply, stepped apply, comment acceptance, restoration, copy and iterative assembly persist rows pinned to the actual resulting content.

`git diff --check` passed; `git diff --name-only -- src/ convex/_generated/` returned no paths.


## Fresh review verification (2026-09-04)

Entry revision: `2f4d32f17b706967a7c1565453b2edb370ae4f5a`.
Verified follow-up source commit: `5b2bed6a0f129af3c9799f8bc80e0fa3ec1e3a01`.

| Acceptance or review behavior | Evidence |
|---|---|
| Current deterministic rows and non-waivable gates | `convex/qaBlocking.test.ts`; final focused run: 146 tests across four files |
| Punctuated, removed or renamed headings preserve uncertainty | Four new extraction cases failed before repair; current `qaBlocking` tests pass |
| Nested section boundaries and legacy paragraph separation | `convex/lib/tiptapReport.test.ts`, `convex/qaBlocking.test.ts` |
| Stale QA releases only its attempt; retry can complete | `convex/generationAttribution.test.ts`: stale/edit/retry and empty-input recovery cases; related three-file run: 84 passed |
| Iterative QA uses three current sections and matching reference | `convex/generationAttribution.test.ts`: iterative current-content case |
| Authorized deletion cleans findings; live/foreign reports remain safe | `convex/qaFindingsCleanup.test.ts`: five cases, including 257 rows across bounded batches |
| Cleanup baseline versus fix | Entry revision retained 257 rows in each of two failing deletion cases; final four-file cleanup run: 120 passed |

Command output tails are retained in `followup-regressions.log`. The complete final `bash scripts/loop-verify.sh` output is retained in `followup-gate.log`; exit 0:

```text
svelte-check found 0 errors and 0 warnings
Test Files  129 passed (129)
Tests  1408 passed (1408)
50 passed, 0 failed
18 passed, 0 failed
```

The gate's first command, `npx tsc -p convex/tsconfig.json --noEmit`, passed silently under `set -e`. The source was committed unchanged after this gate. `git diff --check` passed, and baseline-to-current `src/` and generated Convex files remained unchanged.

The existing BMAD-engine ledger append is committed only as operator-authorized bookkeeping. Its entry and final content digest is SHA-256 `4bb7eaacb7e1d45159335c8fc89e0eb9e7dfee8f5f9768d12e012c607bc663d5`. No entry text, status or resolution was edited. Existing story deferrals were preserved and no new items were added.


## Second fresh review verification (2026-09-04)

Entry revision: `4403c6232e0e8c528644cd272e89ffa942c1162e`.

| Acceptance or review behavior | Runtime evidence |
|---|---|
| Legacy labels and rich-text subtitles retain recognized uncertainty | `convex/qaBlocking.test.ts`: parameterized substantive uncertainty case, legacy label and rich heading variants |
| Code-block inline fragments preserve recognized uncertainty | Same parameterized case, split code block variant |
| Punctuated work labels do not produce false blockers | `convex/qaBlocking.test.ts`: punctuated legacy work heading case |
| Cross-reference sentences do not create section boundaries | `convex/qaBlocking.test.ts`: legacy punctuated cross-reference case |
| Invalid stored scorecards cannot create methodology blockers | `convex/qaBlocking.test.ts`: candidate selection through persistence, readiness, and successful publish |

Before repair, the three hidden-uncertainty cases failed because readiness lacked `QA_BLOCKING`, and the punctuated work-label case failed because readiness incorrectly included it. Logs: `second-review-before.log`, `second-review-before-extra.log`. The invalid-scorecard case passed before repair and guards existing validation. A follow-up inspection reproduced a cross-reference regression in the initial repair; `second-review-crossref-before.log` records its failure before the correction.

The final focused command, `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts convex/lib/tiptapReport.test.ts`, passed 152 tests in four files. Output: `second-review-focused.log`.

Existing deferred-work ledger bytes and the existing story deferral are preserved. No frontend or generated Convex files changed relative to the story baseline. The initial parallel broad checks were stopped after source repairs so final validation could use the settled source; they are not counted as passing evidence.

Final full gate: `bash scripts/loop-verify.sh`, exit 0. Output: `second-review-gate.log`.

```text
svelte-check found 0 errors and 0 warnings
Test Files  129 passed (129)
Tests  1414 passed (1414)
50 passed, 0 failed
18 passed, 0 failed
```

The final cross-reference repair landed before the full suite ran. Both type checks were subsequently repeated against the settled source: `npx tsc -p convex/tsconfig.json --noEmit` exited 0; `PUBLIC_CONVEX_URL=placeholder npm run check` exited 0 with no errors or warnings. Output: `second-review-final-check.log`; Convex TypeScript passed silently. `git diff --check` passed, the baseline-relative frontend/generated diff was empty, and exact comparison confirmed no change to either the deferred-work ledger or the existing story deferral.

Verified second-review source commit: `40d34059ae38b891023681ac00989d040f9fc973`. The subsequent audit-only commit records this identifier; source remained unchanged after verification.

The final baseline-wide whitespace check also reports a pre-existing trailing blank line in `followup-regressions.log:63`; that prior-run log was preserved. New second-review logs have normalized trailing newlines. The current worktree diff check passes.
