# CAP-10 verification evidence

Original reproduction baseline: `f122b086d745acc40b4decca26b9aaafc7257f6a`.
Reviewed implementation commit: `47f5f0a95b03f1965c0431650d9386c5a2c78e56`.
Current verification baseline: `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`.
Current status: done. Implementation behavior matches the contract; focused verification, the standard full suite and typecheck passed.
The historical records below retain their original revisions and results. [Current focused verification](#coordinated-verification-at-0f5bd6b-2026-09-04) and [coordinated gates](#coordinated-gates-at-0f5bd6b) are recorded separately.

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
| Anthropic caching and unchanged other traffic | `instrument.test.ts` and mixed-provider compare proof: [current focused verification](#coordinated-verification-at-0f5bd6b-2026-09-04), [exact output](verification-0f5bd6b-focused.log) |
| Full test suite and type checks | [Coordinated gates at the current baseline](#coordinated-gates-at-0f5bd6b), passed |

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


## Coordinated verification at 0f5bd6b (2026-09-04)

Historical pre-gate snapshot: the pending statements in this section were superseded by the successful results under [Coordinated gates](#coordinated-gates-at-0f5bd6b).

Verification baseline: `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`. The story and both frontmatter context files were read before inspection. The implementation behavior matches the contract; full-suite and typecheck acceptance gates remain pending. This pass makes no runtime or test changes. Historical failing-gate records above remain unchanged.

Independent inspection confirms default-model compare analysis before fanout (`convex/ai/pipeline.ts:674`), artifact persistence with the existing brain-block envelope (`convex/ai/pipeline.ts:692`, `convex/generations.ts:1350`), runtime validation before drafting (`convex/ai/pipeline.ts:806`, `convex/ai/analyzerAgent.ts:92`), and legacy fallback only when analysis is absent (`convex/ai/pipeline.ts:370`). Generation-only direct caching preserves explicit policies and adds at most two cache markers (`convex/ai/instrument.ts:140`, `convex/ai/instrument.ts:204`). Root includes retain all currently generated SvelteKit include coverage and add shared modules (`tsconfig.json:6`).

Command: `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts convex/generationAttribution.test.ts`

Exit status: 0. [Exact native output](verification-0f5bd6b-focused.log):

```text
 Test Files  3 passed (3)
      Tests  59 passed (59)
   Start at  14:11:34
   Duration  27.26s (transform 25.44s, setup 0ms, import 29.81s, tests 18.25s, environment 986ms)
```

The focused suite covers all six story matrix cases plus frozen-context, role, budget and usage attribution assertions. Full-suite and typecheck execution are held for the coordinator's verification slot; this result does not claim those gates passed at this revision. No assertion or timeout was changed. The existing deferred end-to-end action deadline limitation remains; these stubbed tests do not prove live provider cache hits.


## Current inspection evidence

[Exact read-only inspection output](verification-0f5bd6b-inspection.log) records worktree-local `vitest/package.json` resolution under this worktree's `node_modules`, version `4.1.10`. The TypeScript include comparison rebases each generated include to the repository root: no generated includes are missing, and the sole additional root include is `shared/**/*.ts` (`Comparison: PASS`).

The same log preserves `git diff 0f5bd6b1c9161d2da7f4e828976177fe6f87003a --name-only`, which lists only the story and two audit documents. This supports the no-runtime/test-edit claim for this verification pass. Ignored logs do not appear in that diff; the files awaiting explicit force-add at that pre-gate snapshot were `verification-0f5bd6b-focused.log` and `verification-0f5bd6b-inspection.log`. The later gate logs were also committed. The focused log's original bytes are unchanged.

## Coordinated gates at 0f5bd6b

Status: passed. The coordinator granted this worker the verification slot before execution. Both commands used the standard settings at baseline `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`; only story and audit documentation changed during this run. No assertions or timeouts were adjusted.

`npm test`, exit 0. [Exact native output](verification-0f5bd6b-npm-test.log):

```text
 Test Files  128 passed (128)
      Tests  1376 passed (1376)
   Start at  14:15:21
   Duration  59.97s (transform 23.11s, setup 0ms, import 39.77s, tests 21.89s, environment 13.63s)
```

`PUBLIC_CONVEX_URL=http://localhost npm run check`, exit 0. [Exact native output](verification-0f5bd6b-check.log):

```text
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

`git diff --check` passed. All six matrix cases ran in the focused suite and again within the standard full suite. Four review layers completed, with nine low-severity documentation patches, three rejected suggestions and no new deferred findings. The existing deferred action-chain deadline limitation remains unchanged. Follow-up review is recommended by the workflow's scoring rule: 0 high, 0 medium, 9 low, score 9.

The four `verification-0f5bd6b-*.log` files retain native output and are included in commit `36772c9c3490bc360b628a60a251b9a5f211b807`. Historical unsuccessful verification runs above remain historical evidence.

## Fresh evidence review (2026-09-04)

Starting revision: `36772c9c3490bc360b628a60a251b9a5f211b807`, obtained with `git rev-parse HEAD`. The initial working tree contained only the supplied story's removed terminal-result section. This workflow restores its result after review. No runtime or test files changed in this pass. Four review layers found seven low documentation patches after deduplication, three rejected suggestions, and no intent, specification or verification gaps. Existing deferred entries remain unchanged.

The [working-tree inventory](review-36772c9-status.log) was captured before documentation patches with `git status --short` followed by `git ls-files --others --exclude-standard`, both exit 0. Only the story was modified, and there were no nonignored untracked files. Ignored files added by this run are the six explicitly retained `review-36772c9-*.log` evidence files; they contain command output, not application changes.

The four prior `verification-0f5bd6b-*.log` artifacts were verified with `git show --format=fuller --stat HEAD` as part of starting revision `36772c9c3490bc360b628a60a251b9a5f211b807` (exit 0).

Reproduction prerequisites for a clean checkout: run `npm ci --ignore-scripts` and `npx svelte-kit sync` from the worktree root before comparing the generated configuration.

Reproducible include comparison, executed from the worktree root with exit 0 ([output](review-36772c9-includes.log)):

```sh
node <<'JS'
const ts = require('typescript');
const path = require('node:path');
const root = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config.include;
const generated = ts.readConfigFile('.svelte-kit/tsconfig.json', ts.sys.readFile).config.include.map(p => path.posix.normalize(path.posix.join('.svelte-kit', p)));
const missing = generated.filter(p => !root.includes(p));
const extra = root.filter(p => !generated.includes(p));
console.log(JSON.stringify({missing, extra}, null, 2));
if (missing.length || JSON.stringify(extra) !== JSON.stringify(['shared/**/*.ts'])) process.exitCode = 1;
JS
```

There were no missing generated includes; `shared/**/*.ts` was the sole extra root include.

Current command outcomes at the starting revision plus documentation edits:

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`, exit 0: 27 tests passed in 2 files; [native output](review-36772c9-focused.log).
- `npm test`, exit 0: 1376 tests passed in 128 files; [native output](review-36772c9-npm-test.log).
- `PUBLIC_CONVEX_URL=http://localhost npm run check`, exit 0: zero errors and warnings; [native output](review-36772c9-check.log).
- `git diff --check`, exit 0 after final documentation edits; [empty successful output](review-36772c9-diff-check.log).

Output tails:

```text
 Test Files  2 passed (2)
      Tests  27 passed (27)

 Test Files  128 passed (128)
      Tests  1376 passed (1376)

svelte-check found 0 errors and 0 warnings
```

Follow-up review recommended: true (patched high 0, medium 0, low 7; score 7). Stubbed action/SDK proof covers the contract's compare, persistence, failure, legacy, validation and cache-marker behaviors; live cache hits remain unmeasured. The existing deferred action deadline entry is unchanged.

## Completion review (2026-09-04)

Starting revision: `4d413b9413730e8291380bf84e913ed0804a2694`, obtained directly with `git rev-parse HEAD`. The initial working tree contained only the story's removed terminal-result section. This pass changes only the story, audit documents and three verification logs. The original verification baseline remains unchanged for cumulative review.

Four review layers completed. One low documentation patch records clean-checkout prerequisites for the include comparison; nine suggestions were rejected. Edge-case and verification reviewers found no gaps, and the intent auditor found no material divergence. Follow-up score: 1 (high 0, medium 0, low 1), recommendation false. Existing deferred entries were not changed.

Commands executed in this worktree (all exit 0):

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`: [output](review-4d413b9-focused.log), 27 tests passed in 2 files.
- `npm test`: [output](review-4d413b9-npm-test.log), 1376 tests passed in 128 files. The documentation clarification was made while this command ran; runtime and test files were unchanged throughout.
- `PUBLIC_CONVEX_URL=http://localhost npm run check`: [output](review-4d413b9-check.log), zero errors and warnings.
- `git diff --check`: exit 0, no output after final documentation edits.

Output tails (retained native logs have trailing blank lines normalized):

```text
 Test Files  2 passed (2)
      Tests  27 passed (27)
 Test Files  128 passed (128)
      Tests  1376 passed (1376)
svelte-check found 0 errors and 0 warnings
```

Finalization restores the terminal result and commits the reviewed documentation and logs. Tests establish the action/SDK contract, not live cache hits. Existing deferred risk is unchanged.
