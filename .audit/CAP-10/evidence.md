# CAP-10 verification evidence

Baseline revision: `f122b086d745acc40b4decca26b9aaafc7257f6a`.
Implementation verification below ran against the working tree based on that revision. Final commit and full-suite gates are recorded by the parent verifier.

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
