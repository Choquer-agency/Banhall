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
