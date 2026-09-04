# CAP-9 review provenance evidence

Canonical starting revision: `f122b086d745acc40b4decca26b9aaafc7257f6a`.
Verified implementation commit: `febc42b3309eab88e4186a92b26e5fa125374964`. The subsequent evidence-only commit records this identifier and normalizes trailing blank lines in retained command logs.

## Acceptance and matrix coverage

| Requirement | Real Convex function / stored-row coverage |
| --- | --- |
| Writer insert/resubmit, typed actor, report revision/hash | `convex/reviews.test.ts`, CAP-9 legacy-report parameterized test; existing nomination tests preserve IDs and scheduling |
| Missing revision and absent/empty report hash | Same parameterized test exercises writer and QA inserts, then updates to stored report hash, then empty-hash fallback after edits |
| Candidate baseline and candidate-to-selected-report key continuity | `convex/reviews.test.ts`, candidate feedback test invokes `selectReportCandidate`, edits the selected report, and verifies one unchanged feedback ID with updated revision/hash |
| PD start, failed/completed retries, completion | `convex/pdReviewProjection.test.ts`, CAP-9 PD test verifies exact document bytes (including whitespace and Unicode), fresh IDs, stored provenance, and completion preservation |
| Report converted to plain-text PD | `convex/reviewFromProject.test.ts`, first action test checks hash of resulting document and inequality with source rich-text report hash |
| Historical PD copies preserve fields and absence | `convex/projects.test.ts`, content-copy test checks absent fields, attributed revision/hash, baseline zero, and empty-string preservation |
| Historical query compatibility | `convex/reviews.test.ts`, legacy writer/QA projection test; existing legacy PD projection tests; all verify unchanged query results |
| No frontend/public argument/generated/excluded file changes | `git diff --name-only`, `git diff --check` |

## Verification

`npx vitest run convex/reviews.test.ts convex/pdReviewProjection.test.ts convex/reviewFromProject.test.ts convex/projects.test.ts` failed before tests loaded with Vite OXC `TSCONFIG_ERROR`: `Failed to load tsconfig for 'shared/workItems.ts': Tsconfig not found`. `svelte-kit sync` did not resolve it. Full output: `focused-tests.log`.

Diagnostic command using an audit-local config that merges the canonical Vitest configuration with `oxc: { tsconfig: false }`:

```
npx vitest run --config .audit/CAP-9/vitest.diagnostic.config.ts convex/reviews.test.ts convex/pdReviewProjection.test.ts convex/reviewFromProject.test.ts convex/projects.test.ts

 Test Files  4 passed (4)
      Tests  96 passed (96)
   Start at  12:26:41
   Duration  19.89s (transform 36.84s, setup 0ms, import 27.03s, tests 27.65s, environment 3.44s)
```

Actual output: `diagnostic-tests.log`. This is functional evidence, not a claim that the canonical gate passed.

The unchanged `shared/workflowStages.test.ts` also failed before loading tests with the same discovery error (`unchanged-runner-repro.log`). Adding the shared include to ignored Svelte generated configuration and setting explicit OXC cwd did not fix it. Vitest-only inline compiler options resolve discovery without changing either typecheck command; this verification deviation is recorded in the spec change log.

Standard focused command after repair:

```
npx vitest run convex/reviews.test.ts convex/pdReviewProjection.test.ts convex/reviewFromProject.test.ts convex/projects.test.ts shared/workflowStages.test.ts

 Test Files  5 passed (5)
      Tests  99 passed (99)
   Start at  12:31:41
   Duration  26.63s (transform 49.99s, setup 0ms, import 49.57s, tests 33.78s, environment 3.24s)
```

Actual output: `focused-tests-fixed.log`.

`bash scripts/loop-verify.sh` exited 0. The unchanged Convex typecheck completed successfully, then:

```
svelte-check found 0 errors and 0 warnings
 Test Files  127 passed (127)
      Tests  1363 passed (1363)
50 passed, 0 failed
18 passed, 0 failed
```

Actual output: `loop-verify.log`. The PowerShell harness reports its existing platform-specific dotfile sub-case skip; both uploader harnesses succeeded. No browser/component tests were required because no frontend components changed.
`git diff --check` passed with no output.

Final scope: `convex/schema.ts`, `convex/reviews.ts`, `convex/pdReviews.ts`, `convex/reviewFromProject.ts`, `convex/projects.ts`, their four specified test files, and the documented `vitest.config.ts` verification repair. No generated, frontend, learning, brain, or chat files changed.

## Review coverage patches

All six review coverage findings were addressed without production changes:

- `convex/reviews.test.ts`: new writer/QA insert cases independently cover a nonzero revision with stored hash, absent revision with stored hash, and nonzero revision with absent hash. Historical rows stay absent through reads, then resubmit into the same IDs with populated provenance.
- `convex/pdReviewProjection.test.ts`: document bytes change before retry; retries hash the new bytes while the original completed review stays pinned to its prior hash. `failPdReview` preserves provenance.
- `convex/projects.test.ts`: revision-only and hash-only historical reviews preserve the present field and the absence of the other field during duplication.

Final verification after these patches: `bash scripts/loop-verify.sh` exited 0. Actual output is retained in `review-patches-loop-verify.log`:

```
svelte-check found 0 errors and 0 warnings
 Test Files  127 passed (127)
      Tests  1366 passed (1366)
50 passed, 0 failed
18 passed, 0 failed
```

The Convex typecheck passed before application check; the existing PowerShell platform-specific dotfile sub-case skip remains. `git diff --check` exited 0 with no output after the patches.

Audit artifact notes: command logs retain their output content with trailing blank lines removed. `parent-verify.log` is an intentionally interrupted redundant rerun (exit 143), not full-gate evidence; the two complete gate logs are `loop-verify.log` and `review-patches-loop-verify.log`. Initial decision timestamps in rows 2 and 3 are unknown, as explicitly corrected in the append-only decision trail.

## Deterministic verification timeout repair

Repair baseline: `3db1dd0c8d750034b73e42eb0bf4e75c797afd45`.

Before editing configuration, `npm test` exited 1 and reproduced the reported failure: the repository-wide form-control source audit took 6541ms against the default 5000ms timeout. The remaining 126 files and 1365 tests passed. Full output: `timeout-baseline.log`.

`vitest.config.ts` now assigns that audit file to the `source-audit` project with a 30000ms timeout and excludes the same shared file pattern from the ordinary `src` project. `npm test` runs all projects, including this audit. A filtered `--project src` run no longer includes it; use `--project source-audit` to run the audit explicitly. Ordinary unit-test timeouts remain unchanged; no assertion, source traversal, Svelte component, backend function, schema, or public API changed. This configuration-only repair preserves the frozen intent contract. The story records the deviation and fixes the relative feedback link.

After repair, `npm test` exited 0 (`timeout-fixed.log`):

```
 Test Files  127 passed (127)
      Tests  1366 passed (1366)
   Duration  51.81s
```

`npx vitest run src/lib/components/ui/formControlContract.test.ts --reporter=verbose` exited 0 (`timeout-audit-focused.log`): exactly one file and three tests ran, all under `source-audit`. The focused full-source traversal took 5060ms, also exceeding the previous 5000ms budget. The 30000ms budget provides headroom over these observed runtimes without removing assertions; runtime still depends on machine load, so these passing runs do not guarantee future completion within the timeout. `git diff --check` passed. At the implementation handoff, parent full-gate verification was still pending; its subsequent successful result is recorded below.

Parent verification: `bash scripts/loop-verify.sh` exited 0. Actual output: `timeout-parent-gate.log`. Convex typecheck passed; Svelte reported 0 errors and 0 warnings; 127 test files and 1366 tests passed; PowerShell uploader 50 passed and Bash uploader 18 passed. The existing platform-specific dotfile sub-case skip remains. All matrix tests remain registered and passed in this unfiltered run. The frozen intent block matches the repair baseline byte-for-byte. `git diff --check` passed; no frontend, generated, or excluded epic files changed.

Verified configuration SHA-256: `013eec3395ad1ede28d65ff04483220ce06b34721aa1b3287d3ed8808e6d76fe`. The review repair only changes this configuration and audit/story records relative to repair baseline `3db1dd0c8d750034b73e42eb0bf4e75c797afd45`; the original feature baseline and implementation identifiers remain recorded above.

Final post-review verification: `bash scripts/loop-verify.sh` exited 0 (`timeout-final-gate.log`), with 0 Svelte errors/warnings, 127 files and 1366 tests passing, and uploader harnesses 50 and 18 passing. `git diff --check` passed. New logs retain output with trailing blank lines normalized. Three documentation review patches were applied; executable configuration was unchanged after the first passing parent gate.

Verified repair commit: `f009b43b10d6faf6408841b89a6ae993d3f947c8`. This identifier binds the configuration and retained passing logs to the repaired source; the following evidence-only commit records it.

## Fresh review integrity checks

Reviewed source revision: `b3e0c2ad2740c827be17a7cd0d777d95d6ee6b35`. This pass makes only audit/story documentation changes.

Reproduce the frozen-intent comparison and configuration digest from the repository root:

```bash
python3 - <<'PYTHON'
from pathlib import Path
import hashlib, subprocess
p = '_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/schema/stories/9-review-artifacts-pinned-to-revision-and-content-hash.md'
old = subprocess.check_output(['git', 'show', '3db1dd0c8d750034b73e42eb0bf4e75c797afd45:' + p])
new = Path(p).read_bytes()
def block(s):
    start, end = b'<intent-contract>', b'</intent-contract>'
    assert s.count(start) == s.count(end) == 1
    assert s.index(start) < s.index(end)
    return s.split(start, 1)[1].split(end, 1)[0]
assert block(old) == block(new)
print('Frozen intent matches baseline byte-for-byte: PASS')
print('vitest.config.ts SHA-256:', hashlib.sha256(Path('vitest.config.ts').read_bytes()).hexdigest())
PYTHON
```

Observed output, exit 0:

```text
Frozen intent matches baseline byte-for-byte: PASS
vitest.config.ts SHA-256: 013eec3395ad1ede28d65ff04483220ce06b34721aa1b3287d3ed8808e6d76fe
```

Fresh verification did not complete successfully. `bash scripts/loop-verify.sh` passed Convex tsc and Svelte check (0 errors/warnings), then reported timeout-related failures in `convex/generationEntryFailure.test.ts` and `convex/chatTurns.test.ts`. The stalled run was terminated (exit 143); see `fresh-review-default-interrupted.log`. No complete test-suite summary or uploader result was produced.

A retry with the installed Vitest-supported `VITEST_MAX_WORKERS=2` setting completed Convex tsc after approximately eight minutes and began application check before deliberate termination (exit 143); see `fresh-review-bounded-interrupted.log`. `uptime` during the retry reported load averages `44.45 57.85 52.91`; this is evidence of contention, not proof that all failures are environmental. No executable configuration was changed to mask the failures. Earlier passing evidence remains historical; this fresh pass is blocked on patch verification.

`git diff --check` passes for the documentation updates. Existing deferred-work ledger content and frontmatter entries remain unchanged.

## Resumed implementation verification

Reviewed and verified source revision: `4131c58bccbb5dbf6b0b92445e2d079e8332f104`.
The requested implementation and all matrix tests are already present at this revision. Inspection of the six production review insert sites and their update paths found no missing implementation; no backend, frontend, public API, generated-file, or Vitest configuration changes were needed during this pass.

The initial `bash scripts/loop-verify.sh` exited 1 before typechecking because `node_modules/.bin/tsc` was a regular copy of the executable instead of a symlink, causing `Cannot find module '../lib/tsc.js'`. Actual output: `resume-gate.log`. `npm rebuild --bin-links` exited 0 and restored the dependency executable links locally; actual output: `resume-dependencies.log`. No tracked dependency or lockfile was changed.

After that local dependency repair, `bash scripts/loop-verify.sh` exited 0. Actual output: `resume-fixed-gate.log`:

```text
svelte-check found 0 errors and 0 warnings
 Test Files  127 passed (127)
      Tests  1366 passed (1366)
   Duration  126.65s
50 passed, 0 failed
18 passed, 0 failed
```

Convex typechecking passed before the application check. The existing platform-specific PowerShell dotfile sub-case skip remains. The full suite exercised the matrix coverage listed above, with no test-selection changes. `git diff --check` exited 0 with no output.

The frozen intent block matches immutable revision `4131c58bccbb5dbf6b0b92445e2d079e8332f104` byte-for-byte. Reproduce this comparison and the configuration digest from the repository root:

```bash
python3 - <<'PYTHON'
from pathlib import Path
import hashlib, subprocess
revision = '4131c58bccbb5dbf6b0b92445e2d079e8332f104'
p = '_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/schema/stories/9-review-artifacts-pinned-to-revision-and-content-hash.md'
old = subprocess.check_output(['git', 'show', revision + ':' + p])
new = Path(p).read_bytes()
def block(s):
    start, end = b'<intent-contract>', b'</intent-contract>'
    assert s.count(start) == s.count(end) == 1
    assert s.index(start) < s.index(end)
    return s.split(start, 1)[1].split(end, 1)[0]
assert block(old) == block(new)
print('Frozen intent matches ' + revision + ' byte-for-byte: PASS')
print('vitest.config.ts SHA-256:', hashlib.sha256(Path('vitest.config.ts').read_bytes()).hexdigest())
PYTHON
```

Observed output, exit 0:

```text
Frozen intent matches 4131c58bccbb5dbf6b0b92445e2d079e8332f104 byte-for-byte: PASS
vitest.config.ts SHA-256: 7ded8548bb9f244b65db0031259eef323c7a3e8ce2156843d9a6827cf3a496b2
```

This configuration digest includes the already-committed two-worker bound. Earlier interrupted evidence remains historical; this is a fresh complete passing gate. The existing caller-observation fencing deferral remains unchanged.

Parent verification: `bash scripts/loop-verify.sh` exited 0 (`resume-parent-gate.log`): Convex typecheck passed; Svelte reported 0 errors/warnings; 127 files and 1366 tests passed; uploader harnesses reported 50 and 18 passed. Matrix test bodies were inspected directly in `convex/reviews.test.ts:262`, `convex/pdReviewProjection.test.ts:207`, `convex/reviewFromProject.test.ts:89`, and `convex/projects.test.ts:270`. All are registered by the unchanged Convex test include; the unfiltered run passed every test. `git diff --check` passed, and the current diff contains only audit and story records.

Post-review verification: `bash scripts/loop-verify.sh` exited 0 (`resume-final-gate.log`), with Convex typecheck passing, Svelte 0 errors/warnings, 127 files and 1366 tests passing, and uploader harnesses 50 and 18 passing. The two review fixes changed audit documentation only. `git diff --check` passed.

## Completion review verification

Reviewed source revision: `5a175cfd2a1d12ebf8f51879be44873e402f2691`. Command: `bash scripts/loop-verify.sh`; exit 0. Actual output: `completion-review-gate.log`. Convex typecheck passed, Svelte reported 0 errors/warnings, 127 test files and 1366 tests passed, and uploader harnesses reported 50 and 18 passed. The existing PowerShell platform-specific dotfile sub-case skip remains.

The two integrity commands above were executed after changing them to read raw bytes and require exactly one ordered delimiter pair. Both frozen-intent comparisons passed; the current configuration digest remains `7ded8548bb9f244b65db0031259eef323c7a3e8ce2156843d9a6827cf3a496b2`. Earlier digest outputs describe their historical source revisions. Existing deferred entries and the intent contract were also compared against the starting HEAD and remain unchanged. Only audit and story records changed. `git diff --check` passed.
