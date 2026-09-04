# CAP-10 verification evidence

Original reproduction baseline: `f122b086d745acc40b4decca26b9aaafc7257f6a`.
Reviewed implementation commit: `47f5f0a95b03f1965c0431650d9386c5a2c78e56`.
Current verification baseline: `ffd761de7d7fe59e4f111d374f663775d68dfb0d`.
The historical records below retain their original revisions and results. The rearmed verification section records current evidence separately.

## Baseline reproduction

Command: `npx vitest run --project convex convex/ai/pipeline.compare.test.ts`

After correcting local TypeScript configuration discovery, the real generation entry and both real candidate actions produced two analyzer requests for either compare ordering. Pipeline and analyzer orchestration were unchanged from the baseline revision; the independently developed cache instrumentation was already present in the shared working tree. SDK transport was stubbed; analyzer validation, drafting agents, action fencing and artifact storage were real.

[Baseline output](baseline.log):

```text
AssertionError: expected [ [ { …(6) } ], [ { …(6) } ] ] to have a length of 1 but got 2
Test Files  1 failed (1)
Tests  2 failed (2)
```

## Acceptance mapping

| Requirement | Proof |
| --- | --- |
| One analyzer for compare, independent of pair order | `pipeline.compare.test.ts`: both model orderings use default MODEL; analyzer count is one immediately after entry and after both candidates |
| Artifact saved before fanout, shared by candidates | Same tests inspect persisted scheduled payloads and analysis row before candidate execution, assert both completed candidates contain identical analysis, and assert artifact rows remain unchanged |
| Real runtime analyzer contract | Stub omits optional analysis lists; analyzer defaults them before persistence and candidates validate the serialized handoff |
| Candidate-specific drafting | Compare proof checks at least three drafting calls on each candidate's own model |
| Single-model analysis selection | `keeps the selected single-mode analyzer model` |
| Shared analysis failure prevents fanout | `fails generation without scheduling candidates when shared analysis rejects` checks failed generation, no candidate jobs/runs/artifacts |
| Malformed analysis fails before provider call | Parameterized invalid JSON, empty object and null cases assert no provider request and failed candidate run |
| Legacy queued payload works | Payload with analysis omitted successfully runs one candidate-model analyzer and completes |
| Frozen context, role trust, budget and digest policy | `generationAttribution.test.ts`, including updated direct-provider fixture and assertions for both entry flows |
| Anthropic caching and unchanged other traffic | Parent-owned `instrument.test.ts` and final verification record |
| Full test suite and type checks | Parent final verification record |

## Targeted verification

Command: `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/generationAttribution.test.ts`

[Targeted output](targeted.log):

```text
Test Files  2 passed (2)
Tests  40 passed (40)
Duration  11.18s
```

`git diff --check` passed with no output.

## Local runner setup

`npm ci --ignore-scripts` installed worktree dependencies. `npx svelte-kit sync` generated local SvelteKit types. Native OXC failed to resolve inherited include patterns for shared modules, standalone tests and source modules. Root `tsconfig.json` now explicitly lists every generated SvelteKit include, rebased to the root, and adds `shared/**/*.ts`. Compiler options and exclusions still extend the generated configuration. Intermediate directory configs were removed. No transform bypass is used.

Direct native `rolldown/utils` transform probes pass for `convex/ai/model.ts`, `shared/workItems.ts`, `tests/aiUsage.test.ts` and `src/lib/utils.ts`. The standalone test failure is preserved in `aiusage-diagnosis.log`; final consolidated-config suite results are in `root-config-targeted.log`.

## Parent verification

`npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts` passed 23 tests in 2 files. Output: [targeted-final.log](targeted-final.log).

Matrix audit: compare (both orderings), analyzer failure, legacy candidate, and malformed shared analysis ran in pipeline.compare.test.ts; caching and unchanged non-generation traffic ran in instrument.test.ts. The OpenRouter boundary remains covered by generationAttribution.test.ts and the full suite. No matrix case is skipped.

`PUBLIC_CONVEX_URL=http://localhost npm run check` passed with 0 errors and 0 warnings after the feature edits. Output: [check-final.log](check-final.log). The consolidated configuration was subsequently verified below.

Before review patches, `npm test`: 128 files and 1372 tests passed. Output: [npm-test-verified.log](npm-test-verified.log).

Before review patches, `PUBLIC_CONVEX_URL=http://localhost npm run check`: 0 errors and 0 warnings. Output: [check-verified.log](check-verified.log).

## Review follow-up verification

The review added actual entry cache/usage assertions, section request inspection, mixed-provider compare, single-mode promotion, realistic multimodal preservation and explicit cache-policy cases. Runtime behavior was unchanged during this pass.

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`: 26 tests passed in 2 files. [Output](review-parent-targeted.log).
- `npm test`: 1375 tests passed in 128 files. [Output](review-npm-test.log).
- `git diff --check`: passed with no output.

Known limitation: the existing end-to-end action-chain budget does not guarantee completion within the Convex deadline for worst-case condensation, retrieval and provider latency. The story frontmatter records the deferred finding. Tests prove cache marking and usage counters, not live provider cache hits.

- Final `PUBLIC_CONVEX_URL=http://localhost npm run check`: 0 errors and 0 warnings. [Output](review-check.log).

## Verified implementation revision

`47f5f0a95b03f1965c0431650d9386c5a2c78e56` contains the reviewed implementation, story result and verification artifacts. The following audit-only commit records this identifier; it does not change runtime code or tests. Captured logs retain command output with trailing blank lines normalized.

## Fresh review verification (2026-09-04)

Starting revision: `db9f1effd03bf8ee94245b6095ba2c0724d14113`. Two test-only patches add project recovery assertions after analyzer failure and a populated nested-type rejection case. Runtime source remains unchanged from that revision.

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`: 27 tests passed in 2 files; [output](followup-targeted.log).
- `npm test`: 1376 tests passed in 128 files; [output](followup-npm-test.log).
- `PUBLIC_CONVEX_URL=http://localhost npm run check`: 0 errors, 0 warnings; [output](followup-check.log).
- `git diff --check`: passed after normalizing trailing blank lines in authored artifacts.

All commands above were rerun after the patches. Four review layers produced two low patches and ten rejected suggestions after deduplication. No new deferred entries. Cache hit rates and worst-case action latency are not established by these tests. The orchestrator-owned deferred-work ledger was already modified at entry and has not been opened for inspection, edited, staged, or committed by this follow-up.

Reviewed follow-up revision: `248c8931c49c24ac990dd5332406b2fbfde5fc47`. Post-commit `git status --short` reported only ` M _bmad-output/implementation-artifacts/deferred-work.md`. Finalization therefore records `blocked` under the workflow clean-tree rule; this is an ownership/finalization condition, not a failing test or unfinished implementation.

## Rearmed verification (2026-09-04)

Current verification baseline: `ffd761de7d7fe59e4f111d374f663775d68dfb0d`.
The existing implementation fulfills CAP-10; this run changes only the story status and audit evidence. Independent implementation inspection confirmed shared model selection and persistence before fanout (`convex/ai/pipeline.ts:677`, `convex/ai/pipeline.ts:692`), runtime handoff parsing (`convex/ai/pipeline.ts:806`, `convex/ai/analyzerAgent.ts:92`), the legacy fallback (`convex/ai/pipeline.ts:370`), storage upsert (`convex/generations.ts:1350`), and generation-only caching with explicit-policy preservation (`convex/ai/instrument.ts:140`, `convex/ai/instrument.ts:204`).

The earlier dirty-tree finalization block is historical and resolved at this baseline. The parent observed clean `git status --short` at entry; `ffd761de7d7fe59e4f111d374f663775d68dfb0d` preserved the deferred-work ledger and rearmed the story. Current story/audit edits are owned by this verification run.

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`: 27 tests passed using ancestor dependencies before worktree-local installation; [output](rearm-targeted.log).
- Initial `npm test` used ancestor dependencies because this worktree lacked installed packages. It failed on one missing component module and two timing limits; [output](rearm-initial-suite.log).
- `npm ci --ignore-scripts` completed local lockfile installation, adding 601 packages; [installation output](rearm-install.log). A two-worker rerun resolved the missing module but exceeded a source-parser timeout; [output](rearm-local-suite-timeout.log). A subsequent run with a 30-second timeout passed that test but failed `shared/humanProse.test.ts:58` (`findDashConnectors > stays linear on long input`): 110.55341699999997 ms exceeded the 100 ms assertion; [output](rearm-local-suite-timing.log). Machine contention is suspected, not established as the cause.
- `npm test -- --maxWorkers=1 --testTimeout=30000`: all 1376 tests passed in 128 files; [output](rearm-serial-suite.log). No assertions or source configuration were changed.
- `PUBLIC_CONVEX_URL=http://localhost npm run check`: zero errors and warnings; [output](rearm-check.log).
- `git diff --check`: passed.

All six matrix cases ran and passed in the focused suite: compare (both pair orderings), shared analyzer rejection, legacy payload fallback, invalid shared analysis, Anthropic cache markers and unchanged other traffic. Compare proof executes real entry/candidate actions and persistence with the provider transport stubbed; it asserts one analyzer request after both candidates complete, one analysis artifact, identical candidate analysis and candidate-specific drafting models.

The existing action-chain deadline limitation remains deferred. Live provider cache hits are not claimed. No runtime code or tests changed in this verification run.

Current successful command output tails:

`npm test -- --maxWorkers=1 --testTimeout=30000` ([output](rearm-serial-suite.log)):

```text
 Test Files  128 passed (128)
      Tests  1376 passed (1376)
   Start at  13:22:51
   Duration  46.18s (transform 6.65s, setup 0ms, import 12.39s, tests 11.10s, environment 4.19s)
```

`PUBLIC_CONVEX_URL=http://localhost npm run check` ([output](rearm-check.log)):

```text
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

The serial-suite success does not establish a passing current default `npm test` run. The parent will rerun the standard verification commands after these documentation patches.

## Post-review gate result

The local focused command passed again: [output](rearm-standard-targeted.log), 27 tests in 2 files.

The unmodified `npm test` gate remains failing: [output](rearm-standard-suite.log).

```text
Test Files  2 failed | 126 passed (128)
Tests       2 failed | 1374 passed (1376)
```

Failures were timeouts in `convex/chatTurns.test.ts:152` (30000 ms) and `src/lib/components/ui/formControlContract.test.ts:61` (5000 ms). Both passed in the successful serial suite. No production assertion or test expectation was changed to bypass these limits. The prior type check passed with zero errors and warnings; the redundant post-documentation type check was stopped after the default test gate failed again, with no diagnostics emitted.

Final workflow status: blocked, `patch verification failed`. CAP-10 behavior is proved, but the exact default-suite requirement is not green on this host. Runtime source is unchanged. No additional provider limitation or application defect is inferred from these timing failures. The final commit preserves all referenced rearm logs, including ignored log files.
