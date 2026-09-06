# Q3 implementation evidence

Baseline: `5f1998c9e486130e62569849a917ee1b79442791` (matches spec).
Scope: `_bmad-output/implementation-artifacts/spec-quality-Q3.md`, read fully with all four frontmatter context files before edits. Initial Git status contained only the untracked spec. All changes stayed in the authorized checkout; no install, staging, commit, push, ledger edit, generated-file edit, or source-worktree edit was performed.

## Changes and acceptance mapping

- `convex/projects.ts`, shared `copyProjectInputRows`: only copied running reviews become failed, with a duplication-specific explanation and `completedAt` equal to the captured copy timestamp. Each gets exactly one destination `pdReviewEvents` row with the new review ID, destination project ID, `actor: system`, `action: review_failed`, matching detail and timestamp.
- `convex/projects.test.ts`, `copied running PD reviews`: six actual-mutation cases exercise both current and legacy entry points. Mixed completed/failed/two-running histories assert status, terminal timestamps, event cardinality/linkage, document remapping, zero/empty provenance, result/model/creator preservation, unchanged source documents/reviews/events/reports/project, unchanged destination human stage and creator, and no scheduled copy work.
- The real `retryPdReview` mutation immediately creates a fresh running destination review and schedules `ai/reviewAgent:runPdReview` with that new ID. The copied failed row stays unchanged.
- Restricted roleless callers are denied in both directions through both entry points; whole-table snapshots prove no mutation effects. Existing access is firm-wide for internal roles, so this test does not invent per-project permissions.
- Existing provenance (including missing optional fields) and transcript-set regressions remain unchanged and pass in the targeted suite.

## Commands and observed results

1. `git rev-parse HEAD` and `git status --short`: baseline above; initially only untracked spec.
2. Before production edits: `npm test -- convex/projects.test.ts convex/reaperIntegration.test.ts convex/pdReviewProjection.test.ts` (exit 1). See `baseline-tests.log`.
   - 4 failed, 85 passed, 89 total.
   - Both copy entries returned running rows where failed was expected.
   - Both real retry calls rejected with `INVALID_INPUT`: "This review can't be retried yet".
3. After repair, same targeted command (exit 0). See `fixed-tests.log`.
   - 3 files passed; 89 tests passed.
4. `npx tsc --noEmit -p convex/tsconfig.json` (exit 0). See `convex-types.log` (no diagnostics).
5. `git diff --check` (exit 0). See `diff-check.log` (no diagnostics).

6. Additional local gate: `bash scripts/loop-verify.sh` (exit 0). See `full-gate.log`.
   - All 8 steps passed: preflight, Convex typecheck, Svelte check (0 errors, 0 warnings), 154 unit-test files / 2044 tests, test discovery, production build, PowerShell harness (50 passed), Bash harness (18 passed).
   - Production build emitted its chunk-size advisory; no build failure.
   - Final `git status --short` still shows only the two implementation files modified and the original untracked spec. Audit evidence is ignored by Git. No component files changed, so the browser component suite was not run.

## Limitations and finalization

No provider action was executed; the real retry mutation and persisted scheduled action were verified without a network AI request. This fixes future copies, not already stranded destination rows; the existing reaper remains unchanged. Historical non-running optional-field and completion timestamp copy behavior is deliberately preserved. The existing bounded copy limits are unchanged.

Independent three-lens review and canonical acceptance decisions remain with the supervising root, per the spec. No canonical decisions or ledger entries were written. The optional type-system-discipline skill referenced by the TypeScript skill was absent from both installed skill roots; the available TypeScript instructions were applied directly.
