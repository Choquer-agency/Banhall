# dw-brief-failure-observability (DW-109, DW-120): before/after evidence

## Commits
- Baseline: `90215c0`, the parent of `d8359a3`.
- Fix: `d8359a3` (source and tests), then merge `4057a58` (6449ba5 + d8359a3). `git diff --stat d8359a3 4057a58 -- convex` is empty. Last is `d73df4b`, which adds tests and audit files only: the `recordBriefOutcome` missing-generation test and 2 `not.toHaveProperty("briefOutcome")` assertions.
- After: `d73df4b`. Head: `e22a4b4`.
- Test files: `convex/ai/brief.test.ts`, `convex/ai/briefPipelineWiring.test.ts` (sha at d73df4b: `21bb139f…`, `0cf8070f…`; the wiring sha matches `.audit/dw-brief-failure-observability/evidence.md`).

## Environment
The environment is the same as for bundle 1: node v22.22.3, vitest 4.1.10, the placeholder Convex URLs, and `../run-phase.sh`. The command was `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<phase>.json convex/ai/brief.test.ts convex/ai/briefPipelineWiring.test.ts`.

## Results
| Phase | Tree | Result | Log |
|---|---|---|---|
| before | 90215c0 + d73df4b tests | 12 failed / 35 passed (47), EXIT 1 | before.raw.log |
| intermediate | d8359a3 + d73df4b tests | 47 passed, EXIT 0 | intermediate-d8359a3-with-d73df4b-tests.raw.log |
| after-fix | d73df4b | 47 passed, EXIT 0 | after-fix.raw.log |
| after-head | e22a4b4 | 50 passed, EXIT 0. The 3 extra tests are DW-112's. | after-head.raw.log |

Comparison: `comparison.txt`.

## The 12 discriminating tests

### Behavior-level: 6 tests
At baseline `briefOutcome` is `undefined` (`expected undefined to deeply equal {kind: …}`). This is the DW-109/DW-120 red that spec AC3 predicts.
1. brief.test: `refuses a source read above MAX_BRIEF_SOURCE_ROWS; the generation completes with no Brief` (non-provider failure → `failed/unknown`)
2. wiring: `renders the derived Brief into every section-agent prompt` (derived)
3. wiring: `never fails the generation when Brief derivation fails — completes with no Brief and no rendered block` (single-mode failure, `getLatestGeneration` verbatim line, no detail)
4. wiring: `reused: identical frozen inputs stamp the same Brief with no second call, record { kind: reused } and narrate it once`
5. wiring: `no evidence: zero frozen sources make no Brief call, stamp no Brief, record { kind: no_evidence } and narrate it once`
6. wiring: `iterative: a failed derivation records the same failed outcome, still schedules s242, and narrates verbatim through getIterativeState`

### API-shape (compile-level) only: 6 tests
- `recordBriefOutcome mutation boundary (DW-109/DW-120) returns null without recreating a missing generation`: `Expected a Convex function exported…` because the mutation does not exist at baseline. This test was added in d73df4b and **passes on d8359a3 source** (intermediate run). It pins behavior that already existed and is not a discriminating proof of a d73df4b change.
- `runGenerationBriefStage`/`briefFailureOutcome is not a function` (5): `bounds a 1,000-character stage error…`, `resolves when recording the outcome rejects…`, `resolves and records an unknown failure when the thrown value defeats stringification and provider normalization`, `resolves when both derivation and recording error logging throw`, `classifies with the provider code, keeps non-Error text, and never cuts a surrogate pair in half`.

## Non-discriminating: 35 tests
They pass before and after. The list is in `comparison.txt`.

## Acceptance criteria → tests
Spec 1 is `spec-dw-109-dw-120-brief-failure-observability.md`; spec 2 is `…-2.md`.
| AC / matrix row | Test(s) | Before-proof |
|---|---|---|
| S1-AC1 Derived | wiring `renders the derived Brief…` (asserts outcome + line exactly once) | Behavior |
| S1-AC1 Reused | wiring `reused: …` | Behavior |
| S1-AC1 No evidence | wiring `no evidence: …` | Behavior |
| S1-AC1 Model failure (single) | wiring `never fails the generation…` | Behavior |
| S1-AC1 Model failure (iterative) | wiring `iterative: …` | Behavior |
| S1-AC1 Non-provider failure | brief.test `refuses a source read above MAX_BRIEF_SOURCE_ROWS…` | Behavior |
| S1-AC2 `getLatestGeneration` verbatim line, no detail | wiring `never fails the generation…` | Behavior |
| S1-AC3 red on baseline because `briefOutcome` undefined | reproduced in before.raw.log | Yes |
| S1 matrix: Long error (300 chars) | `bounds a 1,000-character stage error…` | API-shape only |
| S1 matrix: Recording fails | `resolves when recording the outcome rejects…` | API-shape only |
| S2 matrix: Hostile failure value | `…defeats stringification and provider normalization`, `resolves when both derivation and recording error logging throw` | API-shape only. The spec cites a behavioral red in `.audit/complete-local-20260914-worker/before-hostile-error.log`, which is **not in the tree**. |
| S2 matrix: Missing generation | `returns null without recreating a missing generation` | API-shape at 90215c0; passes at d8359a3 |
| S1-AC4 / S2-AC3 loop-verify and typecheck | not run (scope) | GAP (scope) |
| S2-AC4 independent Astra review with no high/medium findings | not test-mappable | `.audit/dw-brief-failure-observability/review/final-review.md` records `gpt-6-astra`, effort `xhigh`. The repo reviewer policy says `medium`. This is a process deviation, not a test gap. |

## Gaps and findings
- The d8359a3 source was implemented while the spec-1 review was "NOT PERFORMED" (usage limit). Acceptance rests on the 2026-09-14 local-completion review.
- No flakiness was observed (single runs, all consistent).
