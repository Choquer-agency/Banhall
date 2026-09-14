---
title: 'DW-109/DW-120: complete Brief failure observability locally'
type: 'feature'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred: []
baseline_revision: 4057a582b4d0f45395e0b853ffff93a73ff1b789
baseline_commit: 4057a582b4d0f45395e0b853ffff93a73ff1b789
---

<intent-contract>

## Intent

**Problem:** Brief derivation failures must remain fail-open while being distinguishable from successful derivation, reuse, and no-evidence outcomes. Writers also need safe progress narration when drafting continues without a Brief.

**Approach:** Preserve and verify the existing shared Brief stage runner, structured generation outcome, atomic outcome and progress mutation, and both generation entry-point integrations. Add only missing boundary coverage or repairs proven necessary by tests or independent review.

## Boundaries & Constraints

**Always:** Keep generation fail-open through derivation, normalization, recording, and operational logging failures. Keep `generations.briefOutcome` optional, single-writer, and independent of `briefId`. Store a provider code plus a bounded, valid-Unicode detail for failed attempts, but expose only authored copy in writer progress. Use the existing `briefOutcomeValidator`, `normalizeProviderError`, `runGenerationBriefStage`, and `recordBriefOutcome` paths.

**Block If:** Completion requires a new Convex module, a required or backfilled schema field, a generated-file edit, or a product workflow or permission change.

**Never:** Change Brief derivation, reuse, citation, diff-baseline, or publish semantics. Do not add UI, public query fields, `aiUsage`, QA scorecard changes, or a product-domain amendment. Do not edit the deferred-work ledger, native loop state, or orchestrator-owned result data. Do not push or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Derived or reused | Brief stage succeeds | Outcome is `derived` or `reused`, `briefId` semantics stay unchanged, and one authored progress line is appended | None |
| No evidence | No frozen generation sources | Outcome is `no_evidence`, no model call or `briefId`, and generation continues | None |
| Derivation failure | Provider or non-provider failure | Outcome is `failed` with normalized code and bounded detail; writer sees safe narration; generation continues | Original error is logged for operations |
| Hostile failure value | Stringification, normalization, or logging throws | Outcome falls back safely and the runner resolves | Secondary failures remain contained |
| Missing generation | Outcome writer receives a deleted or absent generation id | Mutation returns `null` without a write | No exception |
| Recording failure | Outcome mutation rejects | Generation continues | Recording failure is logged when possible |

</intent-contract>

## Code Map

- `convex/lib/briefRender.ts:17-58` contains the shared outcome validator, discriminated type, detail bound, and authored progress copy. Reuse without changing public copy unless a failing acceptance check requires it.
- `convex/schema.ts:765-774` holds the optional `generations.briefOutcome` field. Do not edit generated Convex files.
- `convex/generations.ts:1681-1710` contains the only outcome writer, which patches telemetry and progress together and treats a missing generation as a no-op.
- `convex/ai/brief.ts:420-721` contains attempt outcomes, total failure normalization, and the fail-open shared stage runner.
- `convex/ai/pipeline.ts:790-803` and `convex/ai/iterative.ts:257-267` call the shared runner at the existing Brief stage position.
- `convex/ai/briefPipelineWiring.test.ts:343-639` covers outer generation surfaces and stage-runner failures. Extend it with the missing-generation mutation boundary.
- `convex/ai/brief.test.ts:1177-1200` covers a non-provider source-overflow refusal.
- `_bmad-output/implementation-artifacts/spec-dw-109-dw-120-brief-failure-observability.md` records the preserved implementation provenance and historical review limitation. Treat it as read-only history.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/briefPipelineWiring.test.ts` add a direct `recordBriefOutcome` missing-generation regression using the real Convex mutation boundary, without mocking decoded responses or weakening types.
- [x] `convex/ai/brief.ts`, `convex/generations.ts`, `convex/lib/briefRender.ts`, `convex/schema.ts`, `convex/ai/pipeline.ts`, and `convex/ai/iterative.ts` preserve the existing implementation unless a focused test or independent review proves a contract defect.
- [x] `.audit/dw-brief-failure-observability/` record the current revision, decision trail, focused command results, full gate output, and review result. Do not copy unverifiable historical logs.

**Acceptance Criteria:**
- Given each matrix scenario, when the relevant real action, real mutation, or shared helper boundary completes, then the stored outcome, `briefId`, progress narration, and fail-open behavior match the matrix.
- Given a failed Brief attempt, when outcome recording succeeds and an authorized writer reads generation progress, then exactly one safe authored line is visible and no stored error detail appears in progress.
- Given the final worktree, when the focused suites, Convex typecheck, and `bash scripts/loop-verify.sh` run, then they pass without new failures or skips.
- Given the completed diff, when an independent Astra/xhigh reviewer evaluates the bundle against the intent and live evidence, then no unresolved high or medium finding remains.

## Spec Change Log

## Review Triage Log

### 2026-09-14: local completion review passed

- Review model: `gpt-6-astra`, reasoning effort `xhigh`.
- Blind hunter: ten forced candidates; six evidence or defense-in-depth improvements applied, four non-defects rejected.
- Edge-case hunter: no findings.
- Verification-gap reviewer: no gaps.
- Final follow-up: PASS with no high, medium, or low findings.
- Native orchestrator acceptance remains outside this local completion run.

### 2026-09-14: current-pass low-severity follow-up

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - Relabeled `4057a582b4d0f45395e0b853ffff93a73ff1b789` as the implementation starting point and identified completed commit `1df0f8a73e6f85bd758aa96a5ac17fcf7f3196a4`.
  - Clarified matrix coverage across real actions, real mutations, and shared helpers.
  - Qualified the exactly-one authored progress line guarantee with successful outcome recording.
  - Recast the spec digest in evidence as the historical completion-spec digest committed in `1df0f8a73e6f85bd758aa96a5ac17fcf7f3196a4`.
  - Recorded the current-run policy and invocation authority for Astra/xhigh in the blind-review rationale.
- The intent-alignment UI reading was rejected because the verbatim DW-120 entry specifically points to the existing progress-log helper.

### 2026-09-14: native follow-up review

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[low]` `[patch]` Corrected the native verification report to retain the known PowerShell platform skip.
  - `[low]` `[patch]` Qualified the historical standalone typecheck receipt and used native gate step 3 as current proof.
  - `[low]` `[patch]` Qualified the aggregate-only historical focused receipt and used the native full suite plus discovery guard as current proof.
  - `[low]` `[patch]` Bound the current four Astra/xhigh reviews to immutable input, actual CLI headers, commands, timestamps, and exit codes; historical reviewer provenance remains historical.
- Individual dispositions and scope evidence: `.audit/dw-brief-failure-observability/followup-20260914/triage.md`.

## Design Notes

The existing implementation in commit `d8359a379f2a298b24ab180eb22e1fc87eb538b8` is the reuse baseline. Commit `4057a582b4d0f45395e0b853ffff93a73ff1b789` is the implementation starting point for this local completion run and merges that baseline without changing the relevant files. Completed local work was committed as `1df0f8a73e6f85bd758aa96a5ac17fcf7f3196a4`.

## Verification

**Commands:**
- `npx vitest run convex/ai/briefPipelineWiring.test.ts convex/ai/brief.test.ts convex/sanitizationBoundary.test.ts convex/ai/promptProgram.test.ts convex/lib/briefRender.test.ts` with live output captured under `.audit/dw-brief-failure-observability/`.
- `npx tsc --noEmit -p convex/tsconfig.json` with exit code 0.
- `bash scripts/loop-verify.sh` with every numbered step passing.

## Suggested Review Order

**Mutation boundary**

- A valid deleted ID proves the real mutation returns safely without recreating state.
  [`briefPipelineWiring.test.ts:487`](../../convex/ai/briefPipelineWiring.test.ts#L487)

**Writer-safe projection**

- Single-mode progress exposes authored copy while withholding operational outcome detail.
  [`briefPipelineWiring.test.ts:404`](../../convex/ai/briefPipelineWiring.test.ts#L404)

- Iterative progress enforces the same safe projection contract.
  [`briefPipelineWiring.test.ts:477`](../../convex/ai/briefPipelineWiring.test.ts#L477)

**Completion evidence**

- Focused, typecheck, gate, dependency, and review receipts map directly to acceptance.
  [`evidence.md:1`](../../.audit/dw-brief-failure-observability/evidence.md#L1)

## Auto Run Result

Status: done

The existing Brief outcome implementation and its committed mutation/privacy regressions were inspected and preserved. This follow-up changed documentation and evidence only. No human decision is needed for this local completion.

Files changed in this pass:

- This spec: records the fresh review, current evidence limits, and completion result.
- `.audit/dw-brief-failure-observability/evidence.md`: distinguishes historical summaries from the current native proof.
- `.audit/dw-brief-failure-observability/followup-20260914/`: retains invocation/source/native-ledger binding, Sol/high verification evidence, four Astra/xhigh review receipts, individual triage and finalization checks.
- `.audit/dw-brief-failure-observability/decisions.tsv`: appends the current decisions.

Review: four required Astra/xhigh layers completed with exit code 0. Four low-severity evidence patches were applied; eight low-severity candidates were rejected; nothing was deferred. No high or medium finding remains. Follow-up review recommendation: false. Patched counts are high 0, medium 0, low 4; score `3 * 0 + 1 * 4 = 4`.

Verification: reused the native `bash scripts/loop-verify.sh` receipt at journal timestamp `1789380309.161122`, with return code 0, the exact owning worktree, complete log captures and the supervisor-bound source SHA-256 `0cf8070f3859c7a80dd67a898cdbc9ffbb21bb1ed75c0d48b8582b859c66f833`. All nine steps passed: Convex typecheck, Svelte check with zero errors/warnings, 187 unit files and 2,674 tests, discovery, production build and uploader harnesses with 93 and 47 passes. The known PowerShell dotfile skip remains documented. No redundant test or build commands were run. The earlier standalone typecheck and focused summaries are historical; current acceptance uses the native gate.

The pre-existing orchestrator ledger bytes are preserved and may be included unchanged in the local finalization commit under the repository's native-ledger rule. The ledger's `done` rows establish neither verification nor native acceptance. The spec path, baseline revision, native task binding, sprint files and native result/state ownership are preserved. No push or deployment was performed.

Residual limits: this pass proves the backend progress-log/query contract, not rendered UI visibility. Recording failure can leave telemetry absent while generation remains fail-open, as explicitly allowed by the intent. Final native acceptance remains the orchestrator's responsibility.
