---
title: 'DW-109/DW-120: Brief attempt outcomes in generation telemetry and writer progress'
type: 'feature'
created: '2026-09-12'
status: ready-for-dev
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: [oversized]
deferred: []
baseline_revision: 6449ba581463ad31db8feaf93375b3b0d6f92402
---

<intent-contract>

## Intent

**Problem:** The Brief stage's fail-open catch blocks (`convex/ai/pipeline.ts:796-805`, `convex/ai/iterative.ts:261-269`) only `console.error`, so a generation without `briefId` looks the same whether derivation failed, there was no evidence, or the row predates Briefs (DW-109). Writers get no progress line explaining why drafting has no Brief, although the Build Order and Writer Profile fallbacks in the same action do log one (DW-120).

**Approach:** One shared stage runner in `convex/ai/brief.ts` wraps `deriveOrReuseBrief` for both entry actions and never throws. It turns the attempt into a structured outcome: `derived`, `reused`, `no_evidence`, or `failed` with a provider code and a bounded detail. One internal mutation stores that outcome on `generations.briefOutcome` and appends matching authored copy to `progressLog` in the same transaction.

## Boundaries & Constraints

**Always:**
- Generation stays fail-open. No Brief derivation, recording or logging failure can fail, stall or reorder a generation. The stage runner catches its own recording failure and logs it with `console.error`.
- Keep ops logging: a failed attempt still calls `console.error` with the generation id and the original error.
- `generations.briefOutcome` is optional (AD-10 widen), has exactly one writer (`generations.recordBriefOutcome`), is never backfilled, and does not change `briefId` semantics. Absent means no outcome was recorded (legacy row, or the stage was never reached).
- Outcome shapes, one validator (`briefOutcomeValidator`) shared by schema and mutation: `{ kind: "derived" }`, `{ kind: "reused" }`, `{ kind: "no_evidence" }`, `{ kind: "failed", code, detail }`. `code` is `normalizeProviderError(error).code` (7 literals). `detail` is the raw error message (`String(error)` for non-`Error`s), cut to `BRIEF_OUTCOME_DETAIL_CHARS` (300).
- The progress line is authored copy produced by one pure function from the outcome. It carries no raw error text, so `userSafeNarration` passes it through unchanged. `detail` stays on the row for ops and is not added to any public query.
- Both `generateReport` (single/compare) and `startIterativeGeneration` run the same runner at their current stage position.
- Follow the Convex rules in `convex/_generated/ai/guidelines.md`: validators on args and `returns`, and no hand-edits to `convex/_generated/`.

**Block If:**
- The change needs a new Convex module that `_generated/api.d.ts` would have to learn (`codegen required`), or a required or backfilled schema field.
- A previously passing test asserts that Brief derivation failure is silent in `progressLog` or that `deriveOrReuseBrief` returns a bare id.

**Never:**
- Change derivation, reuse, citation, diff-baseline or publish semantics (`publishDerivedBrief`, `persistDerivedBrief`, `findReusableBrief`).
- Signal consumer-time omission of a stamped Brief, whether it comes from over-bound rows, `storylineQuestion` rows appended after the stage, or read-limit failures. The consumers are queries that already log with `console.error`, and stage-time telemetry cannot prove what a later read does.
- Add UI, a public query field, `aiUsage` or QA scorecard changes, or a `docs/product-domain.md` amendment. This is internal generation state, not a workflow transition.
- Put raw provider text in `progressLog`, or edit the deferred-work ledger or native loop state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Derived | New inputs, model returns a valid Brief | `briefId` set; `briefOutcome` `{kind:"derived"}`; the derived line appears once | None |
| Reused | Second generation, identical frozen hashes | Same `briefId`, no second `submit_generation_brief` call; `{kind:"reused"}`; the reused line appears once | None |
| No evidence | Generation with zero `generationSources` rows | No Brief call, no `briefId`; `{kind:"no_evidence"}`; the no-evidence line appears once | None |
| Model failure (single) | Brief tool output fails schema on both attempts | Generation `completed`, no `briefId`, no Brief block; `{kind:"failed", code:"unknown"}`, `detail` names `submit_generation_brief`; failed line visible verbatim through `getLatestGeneration` | `console.error` kept |
| Model failure (iterative) | Same mock via `startIterativeGeneration` | Not failed; s242 section job scheduled; same outcome; failed line visible verbatim through `getIterativeState` | `console.error` kept |
| Non-provider failure | 201 frozen sources (`INVALID_STATE`) | `{kind:"failed", code:"unknown"}`, generation completes | Existing refusal |
| Long error | Stage error message of 1,000 chars | `detail.length === 300` | None |
| Recording fails | `recordBriefOutcome` call rejects | Runner resolves; nothing thrown to the entry action | `console.error` |

</intent-contract>

## Code Map

- `convex/ai/pipeline.ts:790-805` -- single/compare catch to replace with the runner; client built with `clientForModel(..., callSite "generation:brief")`.
- `convex/ai/iterative.ts:257-269` -- iterative catch to replace; client is `clientFor("generation:brief")`.
- `convex/ai/brief.ts:414-586` -- `deriveOrReuseBrief`: `:434` no-evidence return, `:441-447` reuse stamp, `:577` publish. Only `runQuery`/`runMutation` are used, so its ctx can narrow to `BriefPublishCtx` (`:268`). Only the two catch sites above call it.
- `convex/ai/providers.ts:158-235` -- `normalizeProviderError` code union. Reuse it; do not re-classify.
- `convex/ai/writerSettings.ts:144-155`, `convex/ai/brainRetrieval.ts:171-178` -- precedent for a fallback that never throws and still narrates.
- `convex/generations.ts:1677-1682` -- `stampGenerationBriefId`; add `recordBriefOutcome` beside it. `:3360-3369` `appendProgress` is the append shape. `:3376-3397` `recordWriterSettings` is the single-writer record precedent.
- `convex/generations.ts:2585-2590` -- `userSafeNarration` strips ` failed: …`, so the copy must not contain `failed:`. `:130-187` `getLatestGeneration` and `:2593-2676` `getIterativeState` are the writer-facing progress surfaces.
- `convex/schema.ts:764-767` -- `generations.briefId`; add `briefOutcome` next to it. `:1-17` imports lib validators.
- `convex/lib/briefRender.ts` -- existing pure Brief lib, already in `_generated/api.d.ts`. It holds the validator, type, bound and copy function, so no new module is needed.
- `convex/ai/briefPipelineWiring.test.ts:98-347` -- fake-timer drive helpers (`makeProject`, `makeGeneration`, `runCandidates`) and the existing failure case to extend. User `brief-wiring-writer` is admin, so `t.withIdentity({ subject: "brief-wiring-writer" })` passes access.
- `convex/ai/brief.test.ts:407-425,1150-1215` -- reuse pattern (patch project between generations) and source-overflow case.
- `convex/ai/promptProgram.test.ts:150-210,542` -- iterative fixture shape and `startIterativeGeneration` drive.

## Tasks & Acceptance

**Execution:**
- `convex/ai/briefPipelineWiring.test.ts` -- First, before any source change, extend the failure case with the `briefOutcome` and `getLatestGeneration` assertions. Run it on baseline bytes and keep the red log under `.audit/dw-brief-failure-observability/`. -- Reproduces DW-109/DW-120 at the outer surfaces.
- `convex/lib/briefRender.ts` -- Add `BRIEF_OUTCOME_DETAIL_CHARS`, `briefOutcomeValidator`, `type BriefOutcome` and `describeBriefOutcome(outcome)`, with one authored line per kind (copy in Design Notes). -- One definition shared by schema, mutation and copy.
- `convex/schema.ts` -- Add optional `briefOutcome: briefOutcomeValidator` to `generations`, commented as written only by `generations.recordBriefOutcome`. -- Telemetry field.
- `convex/generations.ts` -- Add `recordBriefOutcome` internalMutation (`{ generationId, outcome }`, `returns: v.null()`). A missing generation returns `null`. Otherwise one patch sets `briefOutcome` and appends `describeBriefOutcome(outcome)` to `progressLog`. -- Telemetry and progress commit together.
- `convex/ai/brief.ts` -- Make `deriveOrReuseBrief` take `BriefPublishCtx` and return `{ kind: "derived" | "reused"; briefId } | { kind: "no_evidence" }`. Export `briefFailureOutcome(error)` and `runGenerationBriefStage(ctx, client, args)`. The runner never throws, runs `console.error` on failure, calls `recordBriefOutcome` once and catches that call's failure with `console.error`. -- One stage policy for both modes.
- `convex/ai/pipeline.ts`, `convex/ai/iterative.ts` -- Replace each try/catch with `await runGenerationBriefStage(...)` at the same position and update the comments. -- DW-120 call sites.
- `convex/ai/briefPipelineWiring.test.ts` -- Add the derived assertions to the existing wiring case, plus the reused, no-evidence and iterative failure cases. Add fake-ctx runner cases for the 1,000-char detail bound and a rejecting `runMutation`. -- Matrix rows.
- `convex/ai/brief.test.ts` -- In the source-overflow case, also assert a `failed` outcome with code `unknown`. -- Non-provider failure row.

**Acceptance Criteria:**
- Given each matrix row driven through an entry action (Derived, Reused, No evidence, both Model failure rows, Non-provider failure), when that action returns, then the generation row carries exactly the listed `briefOutcome`, and `progressLog` contains its `describeBriefOutcome` line exactly once.
- Given the single-mode failure, when an authorized writer queries `getLatestGeneration`, then `progressLog` contains `"Generation Brief derivation failed — drafting without a Brief."` verbatim, and no progress entry contains the stored `detail`.
- Given the same failure test on baseline bytes, when it runs, then it fails because `briefOutcome` is undefined (red recorded), and it passes after the change.
- Given `bash scripts/loop-verify.sh` on final bytes, when it runs, then every numbered step passes with no new failures or skips.

## Spec Change Log

## Review Triage Log

### 2026-09-12 — Review pass (blocked exit: review NOT PERFORMED)

No reviewer ran, so nothing was found or triaged. The zero counts below mean no triage happened. They do not mean the review passed. Codex rejected every layer with `ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 3:54 AM.`:
- **Preferred reviewer:** all four layers on `gpt-6-astra` at reasoning effort `medium`, 23:22:17Z to 23:22:23Z.
- **Fallback reviewer:** `gpt-5.6-sol` at effort `high`, first layer only (blind hunter), 23:32:38Z to 23:32:42Z.

Both runs used `CODEX_HOME=/Users/johnnynguyen/.codex2`, a read-only sandbox, and `BMAD_LOOP_TASK_ID` unset. The reviewer policy allows no other reviewer. Prompts and failure logs are in `.audit/dw-brief-failure-observability/review/` (`astra-unavailable/`, `sol-unavailable/`, `reviewer-fallback.tsv`). The reviewed diff is `review/diff.patch` (sha256 `440ad41b…`).
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Design Notes

Copy (`describeBriefOutcome`):
- derived: `Derived a new Generation Brief from this generation's inputs.`
- reused: `Reusing the stored Generation Brief — its inputs are unchanged.`
- no_evidence: `No frozen evidence to derive a Generation Brief from — drafting without a Brief.`
- failed: `Generation Brief derivation failed — drafting without a Brief.`

```ts
// brief.ts, shape only
let outcome: BriefOutcome;
try { const attempt = await deriveOrReuseBrief(ctx, client, args); outcome = { kind: attempt.kind }; }
catch (error) { console.error("Generation Brief derivation failed; continuing without a Brief", args.generationId, error); outcome = briefFailureOutcome(error); }
try { await ctx.runMutation(internal.generations.recordBriefOutcome, { generationId: args.generationId, outcome }); }
catch (error) { console.error("Generation Brief outcome not recorded", args.generationId, outcome.kind, error); }
```

The record is a separate mutation after the stamp. If the action dies between the stamp and the record, `briefId` is set with no outcome, which reads as "not recorded". This is an accepted residual because the generation itself is then reaped.

## Verification

**Commands:**
- `npx vitest run convex/ai/briefPipelineWiring.test.ts -t "never fails the generation"` on baseline bytes -- expected: fails on undefined `briefOutcome`; log in `.audit/dw-brief-failure-observability/before-failure-outcome.txt`.
- `npx tsc --noEmit -p convex/tsconfig.json` -- expected: clean.
- `npx vitest run convex/ai/briefPipelineWiring.test.ts convex/ai/brief.test.ts convex/sanitizationBoundary.test.ts convex/ai/promptProgram.test.ts convex/lib/briefRender.test.ts` -- expected: all pass.
- `bash scripts/loop-verify.sh` -- expected: every numbered step passes; log in `.audit/dw-brief-failure-observability/`.

## 2026-09-14 Local Recovery Handoff

This section records a local recovery repair on the preserved `90215c08b505fb27a5c438a4f8ded8e8a645f872` worktree. It does not replace the historical September 12 result, change native state, or establish native acceptance.

The stale unstringifiable-error residual above was reproduced and hardened. A hostile thrown value could make `briefFailureOutcome` throw while reading its message, converting it to text, or passing it to `normalizeProviderError`. Operational logging could also throw. The stage now uses a bounded fallback detail when conversion fails, falls back to provider code `unknown` when classification fails, replaces lone surrogate code units before Convex storage, and contains logger failures. `runGenerationBriefStage` therefore resolves through derivation, normalization, recording, and logging failures.

Recovery evidence is under `.audit/complete-local-20260914-worker/`:

- `before-hostile-error.log`: the new regression failed before the repair because the stage promise rejected with `property access rejected` from `briefFailureOutcome`.
- `after-hostile-error.log`: all five focused fail-open runner tests passed after the repair.
- `convex-typecheck.log`: `npx tsc --noEmit -p convex/tsconfig.json` exited 0.
- `targeted-suites.log`: the five scoped suites passed, 5 files and 77 tests.
- `loop-verify.log`: `bash scripts/loop-verify.sh` exited 0. All nine steps passed, including 187 files and 2,673 unit tests, the production build, and uploader harnesses at 93 passed and 47 passed with zero failures.

The tracked diff sha256 after verification is `e7feff2beac8525ca7c148f577356df93a8f3dc8e72003dd6d68c712bd8796e0`. No source edit followed that verification.
