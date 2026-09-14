---
title: 'DW-112 Brief derivation concurrency'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_revision: 'd73df4bb9277886ca97e7b8e59caea618baf051d'
baseline_commit: 'd73df4bb9277886ca97e7b8e59caea618baf051d'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - convex/_generated/ai/guidelines.md
  - _bmad-output/specs/spec-pd-generation/stories/1-generation-brief-storage-and-derivation-stage.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Two generations can both miss `findReusableBrief` for the same brand-new `(projectId, inputsHash)` and each attempt to publish a version-1 Brief. Duplicate first versions make keyed reuse and writer-edit staleness ambiguous.

**Approach:** Reuse one keyed Brief lookup inside `persistDerivedBrief` before its project-wide baseline fence. The first committed row becomes authoritative; a concurrent publisher writes no Brief or entry rows, stamps its generation to the authoritative Brief, and returns that id.

## Boundaries & Constraints

**Always:** The idempotency decision occurs in the same Convex mutation transaction as publication and uses `by_projectId_and_inputsHash`; the authoritative row is the latest stored version for that key; both winning and losing generations end with the authoritative `briefId`; existing changed-input baseline fencing remains intact.

**Block If:** The real mutation boundary cannot be exercised under concurrent first-publication scheduling in `convex-test`.

**Never:** Add a schema uniqueness surrogate, call a separate query from the mutation, rerun the model, create version 2 for a duplicate derivation, change writer-edit/version semantics, modify generated files, mutate report prose, or edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Concurrent first publication | Two generations for one project and hash have both observed no reusable Brief | Exactly one version-1 Brief is stored; both calls return it and both generations reference it | The losing publisher writes no Brief entries and adopts the committed row |
| Existing same-key version | Persistence begins after any Brief version already exists for the key | Return and stamp the latest same-key version without publishing candidates | No project-baseline retry is needed |
| No same-key version, stale project baseline | Another Brief with different inputs became newest after baseline pinning | Preserve the current `null` return so `publishDerivedBrief` rereads and retries | No rows or generation stamp are written |

</intent-contract>

## Code Map

- `convex/generations.ts:1663-1677` (`findReusableBrief`): existing descending lookup on `by_projectId_and_inputsHash`; extract or share its mechanics with persistence.
- `convex/generations.ts:1785-1797` (`newestProjectBrief`): project-wide changed-input fence that must remain after the same-key idempotency check.
- `convex/generations.ts:1910-2071` (`persistDerivedBrief`): transaction boundary and only derived Brief publisher; return/stamp the authoritative same-key row before validation or inserts.
- `convex/ai/brief.ts:379-406` (`publishDerivedBrief`): caller retries only on a lost project-baseline fence; an authoritative id must be treated as success.
- `convex/ai/brief.test.ts:916-982`: existing real `convexTest` publish adapter and fixtures to reuse for the concurrent regression.
- `convex/schema.ts:2221-2267`: existing non-unique keyed index is sufficient because Convex mutations serialize conflicting reads and writes; read-only.
- `_bmad-output/implementation-artifacts/deferred-work.md`: native orchestrator-owned ledger; read-only and byte-preserved.

## Tasks & Acceptance

**Execution:**
- [x] `convex/generations.ts`: share the latest same-key lookup between `findReusableBrief` and `persistDerivedBrief`; in persistence, stamp and return an existing row before the baseline fence and all candidate processing.
- [x] `convex/ai/brief.test.ts`: add a synchronized concurrent-first-derivation regression through the real `persistDerivedBrief` mutation boundary, without assuming which caller wins.

- [x] `convex/ai/brief.test.ts`: cover a current same-key baseline after both initial reuse misses, including same-generation replay and complete row preservation.
- [x] `convex/ai/brief.ts`: document same-key adoption before the changed-input baseline fence.
- [x] `convex/lib/briefRender.ts`: use truthful progress narration for both new publication and adoption after derivation.

**Acceptance Criteria:**
- Given two generations for one project and identical inputs have both observed no reusable Brief, when their first publications race, then exactly one version-1 Brief exists for the key and both generations reference its id.
- Given a same-key Brief already exists when persistence starts, when candidates and a stale baseline are supplied, then persistence returns and stamps the latest same-key Brief without inserting parent or child rows.
- Given only a different-key Brief invalidates the pinned project baseline, when persistence runs, then it returns `null`, writes nothing, and preserves the caller's retry contract.

## Spec Change Log

## Review Triage Log

### 2026-09-14: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 11: (high 0, medium 4, low 7)
- addressed_findings:
  - none

### 2026-09-14: Local completion review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` Added the real-adapter regression for a current same-key baseline and same-generation replay, with ID, stamp, and complete row-preservation assertions.
  - `[low]` `[patch]` Corrected the publication-helper comment to describe adoption before the baseline fence.
  - `[low]` `[patch]` Changed derived progress narration to "Generation Brief ready for drafting." while preserving outcome kinds.

Four required Astra xhigh review layers completed with exit 0. An independent Astra xhigh lead deduplicated and triaged their findings in `.audit/DW-112/local-completion/triage.md`. A bounded Astra xhigh follow-up checked all three repairs and returned no findings. The patch score is 5, so `followup_review_recommended` remains true; this run performed the recommended follow-up.

## Verification

**Commands:**
- `npm test -- convex/ai/brief.test.ts`: expected result is the concurrent regression and existing Brief suite passing.
- `npx tsc --noEmit -p convex/tsconfig.json`: expected result is Convex TypeScript passing without generated-file edits.
- `bash scripts/loop-verify.sh`: expected result is the canonical browser-free repository gate passing.
- `git diff --check`: expected result is no whitespace errors.
- `shasum -a 256 _bmad-output/implementation-artifacts/deferred-work.md`: expected result is `349fb5701b4cfe83cb7463a611b1c443f37f9549437d25f474ba09fb348d2ec8`.

