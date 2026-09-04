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
