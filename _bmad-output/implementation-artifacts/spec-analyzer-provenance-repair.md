---
title: 'Correct analyzer model routing provenance'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '9da55bece5948da12129720dd2330a3032c985bf'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="user authorized narrow integration repair">

## Intent

**Problem:** The deployment prompt program describes every analyzer as candidate-selected, although approved boundary Story 10 now chooses fixed MODEL for compare entry analysis. The canonical prompt hash therefore misdescribes current routing.

**Approach:** Correct only the analyzer model disclosure to represent compare, single, iterative and legacy candidate fallback routes. Add meaningful regression tests demonstrating truthful routing and canonical hash sensitivity.

## Boundaries & Constraints

**Always:** Preserve fixed compare MODEL independent of pair ordering; preserve selected single/iterative models and candidate fallback for old queued payloads. Keep one deployment-level program containing all branches, excluding runtime selections. Preserve full canonical revision identifiers and baseline failure evidence. Use worktree-owned dependencies. Existing user authorization covers implementation, reviews and local commits.

**Ask First:** Runtime model-policy changes, broader manifest completeness changes, or any scope extending beyond truthful analyzer routing disclosure.

**Never:** Change runtime routing, schema, generated Convex files, historical frozen intent, native state, ledgers, other worktrees or active integration. No push, PR, deployment or live provider calls. Do not reopen DW-7.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Compare | Candidate pair in either order | Manifest declares fixed MODEL; real entry analyzer uses MODEL | Existing handling |
| Single | Selected model differs from MODEL | Manifest declares selected candidate with MODEL fallback; entry retains selected model | Existing handling |
| Iterative | Selected model | Manifest declares selected candidate with MODEL fallback; existing iterative selection unchanged | Existing handling |
| Legacy | Queued candidate without shared analysis | Manifest declares candidate-selected fallback; real legacy candidate analyzes using its own model | Existing handling |
| Hash | Corrected routing versus old candidate-only declaration | Full canonical deployment hash changes; runtime selections remain excluded | Existing serialization validation |

</frozen-after-approval>

## Code Map

- `convex/ai/promptProgram.ts:300`: incorrect analyzer model descriptor. Only hash consumers use generationPromptProgram, so disclosure can change without runtime semantics.
- `convex/ai/pipeline.ts:674-687`: authoritative compare versus single analyzer selection. Candidate fallback remains in runPipelineForModel; optional shared analysis bypasses it.
- `convex/ai/iterative.ts:217`: selected-model analyzer precedent, read-only.
- `convex/ai/pipeline.compare.test.ts`: real convex-test entry/candidate actions with network stubs, both pair orders, single selection and legacy fallback.
- `tests/aiUsage.test.ts`: canonical hash contract and model-routing mutation coverage.
- `convex/ai/promptScaffolds.test.ts`: manifest scaffold checks, useful adjacent regression coverage.
- `convex/generationAttribution.test.ts`: prompt stamping and legacy provenance compatibility.
- Sprint 1b Story 10 specifies deployment-level routing hash; boundary pipeline Story 10 explicitly authorizes fixed compare analysis.

## Tasks & Acceptance

**Execution:**
- [x] `tests/aiUsage.test.ts`, optionally `convex/ai/pipeline.compare.test.ts`: reproduce incorrect disclosure before production edit, then test manifest routes against existing action behavior and hash sensitivity.
- [x] `convex/ai/promptProgram.ts`: correct analyzer routing declaration only.
- [x] `.audit/analyzer-provenance-repair/`: retain baseline/final outputs and reviewed revision evidence.

**Acceptance Criteria:**
- Given compare, single, iterative and legacy routes, when reading the canonical analyzer descriptor, then each model rule matches its existing production route.
- Given only this descriptor correction, when hashing the deployment program, then the old and corrected hashes differ and all established canonical semantics remain intact.
- Given local installed dependencies, when focused tests, npm test, PUBLIC_CONVEX_URL=http://localhost npm run check and backend tsc run, then all pass without generated-file changes.

## Spec Change Log

## Design Notes

Use a declarative mode map with an explicit legacy-candidate branch, consistent with existing descriptor conventions. Do not make runtime choose models from the manifest or extract runtime policy merely to test this metadata repair. Existing real action tests provide the behavioral reference; add assertions that relate those observed models to the corrected descriptor. Iterative selection can use existing relevant coverage without introducing network traffic. This small spec intentionally stays below the advisory token target.

## Verification

- `npx vitest run --project convex tests/aiUsage.test.ts convex/ai/pipeline.compare.test.ts convex/ai/promptScaffolds.test.ts convex/generationAttribution.test.ts`
- `npm test`
- `PUBLIC_CONVEX_URL=http://localhost npm run check`
- `npx tsc --noEmit -p convex`
- `git diff --check`
- `git diff --exit-code -- convex/_generated`


## Review Triage Log

Three independent Astra medium review layers completed before triage. Blind hunter returned ten findings; edge-case and verification-gap layers returned none. Three low patches strengthened legacy candidate distinction, iterative successful initialization and immutable evidence identity. Seven coverage expansions were rejected with source-based reasons in the audit triage. No intent gap, bad spec or deferred finding. Follow-up score 3; follow-up review not recommended.

## Auto Run Result

Status: done. Analyzer routing disclosure now represents fixed compare MODEL, selected single/iterative and legacy candidate fallback. Production routing is unchanged. Baseline regression failed before the metadata edit; final focused tests passed 71, full suite passed 1733, Svelte check passed with zero errors/warnings, backend tsc passed, whitespace and generated checks passed. All raw evidence and reviews retained under .audit/analyzer-provenance-repair. No push or deployment.

## Suggested Review Order

- Read the complete analyzer routing disclosure.
  [promptProgram.ts:300](../../convex/ai/promptProgram.ts#L300)

- Verify both candidate orders and successful iterative initialization.
  [pipeline.compare.test.ts:158](../../convex/ai/pipeline.compare.test.ts#L158)

- Inspect legacy candidate-specific model proof.
  [pipeline.compare.test.ts:277](../../convex/ai/pipeline.compare.test.ts#L277)

- Check old-versus-new canonical hash and per-branch sensitivity.
  [aiUsage.test.ts:47](../../tests/aiUsage.test.ts#L47)
