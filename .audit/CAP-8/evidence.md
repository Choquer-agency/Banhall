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
