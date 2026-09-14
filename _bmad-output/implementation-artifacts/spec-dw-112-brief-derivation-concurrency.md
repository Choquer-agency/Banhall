---
title: 'DW-112 Brief derivation concurrency'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_revision: 'd73df4bb9277886ca97e7b8e59caea618baf051d'
baseline_commit: 'd73df4bb9277886ca97e7b8e59caea618baf051d'
review_loop_iteration: 0
followup_review_recommended: false
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

### 2026-09-14: Bounded additional review
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` Replace the derived progress narration with "Generation Brief stage completed." because oversized Briefs can be stored while drafting readers omit them.

Four fresh Astra xhigh layers and an independent Astra xhigh lead completed with exit 0. The lead separated fourteen claim/action units and accepted only the narration repair; publication behavior and the frozen intent require no changes. This pass's patch score is 1, so its follow-up recommendation is false. The earlier three-repair pass and its completed follow-up remain preserved above.

The lead's installation-provenance limitation was superseded by supervisor-supplied evidence received after its launch. A bounded independent Astra xhigh supplemental review bound the successful blocking npm-bootstrap hook to this worktree, the exact tracked manifest's unconditional `npm ci`, and unchanged package/lock hashes. This establishes historical hook provenance, without claiming recovered raw npm stdout. See `.audit/DW-112/additional-review/npm-provenance-review.md` and `npm-provenance-binding.json`.

## Verification

**Commands:**
- `npm test -- convex/ai/brief.test.ts`: expected result is the concurrent regression and existing Brief suite passing.
- `npx tsc --noEmit -p convex/tsconfig.json`: expected result is Convex TypeScript passing without generated-file edits.
- `bash scripts/loop-verify.sh`: expected result is the canonical browser-free repository gate passing.
- `git diff --check`: expected result is no whitespace errors.
- `shasum -a 256 _bmad-output/implementation-artifacts/deferred-work.md`: expected result is `349fb5701b4cfe83cb7463a611b1c443f37f9549437d25f474ba09fb348d2ec8`.

## Auto Run Result

Status: done

Summary: Reused the DW-112 transaction-local same-key adoption implementation and its three previously accepted repairs from `0b34a249bac1a7c7e618308ee0416c4826214ccd`. This bounded additional review changed only derived progress narration to "Generation Brief stage completed." so successful storage does not promise drafting availability for an oversized Brief. Publication logic, outcome kinds, and the frozen intent remain unchanged.

Files changed across DW-112:
- `convex/generations.ts`: shares the indexed same-key lookup and adopts/stamps the authoritative Brief before baseline fencing and candidate processing.
- `convex/ai/brief.test.ts`: covers concurrent first publication, latest same-key adoption, current-baseline adoption, replay, and changed-input fencing.
- `convex/ai/brief.ts`: documents same-key adoption and conditional baseline retries.
- `convex/lib/briefRender.ts`: reports truthful stage completion for newly published and adopted Briefs.
- This spec and `.audit/DW-112/`: retain review triage, exact inputs and source bindings, verification receipts, and finalization evidence.

This pass: 1 patch applied (high 0, medium 0, low 1), 0 deferred, 13 rejected claim/action units. No intent gap or spec repair loop was required. Follow-up recommendation: false; score `3 × 0 + 1 = 1`. Four required Astra xhigh review layers and an independent Astra xhigh lead completed successfully. A bounded Astra xhigh supplemental review resolved the installation-provenance question from the supervisor's existing native hook evidence. Original review artifacts remain unchanged.

Verification performed:
- Initially bound and reused the post-repair 39-test and 2,677-test receipts against unchanged source, package, lock, gate, and configuration bytes.
- After the accepted narration patch, `npm test -- convex/ai/brief.test.ts` passed 39/39, exit 0.
- `npx tsc --noEmit -p convex/tsconfig.json` passed, exit 0.
- `bash scripts/loop-verify.sh` passed all nine steps, exit 0: 187 test files, 2,677 tests, Svelte check with 0 errors and 0 warnings, production build, 93 PowerShell harness cases, and 47 Bash harness cases. The existing platform-conditional PowerShell dotfile sub-case remains skipped.
- Exact fresh command captures and actual exit/source-hash receipts are `.audit/DW-112/additional-review/patch-*20260914T120527Z*`; `verified-source-binding.json` matches the repaired bytes.
- `git diff --check` passed. The ledger SHA-256 remains `349fb5701b4cfe83cb7463a611b1c443f37f9549437d25f474ba09fb348d2ec8`, matching both the invocation bytes and the retained native close snapshot.
- Successful blocking npm-bootstrap hook provenance is bound to the frozen journal, tracked manifest, this worktree, and unchanged dependency inputs. It establishes historical installation; no recovered raw npm stdout is claimed and no reinstall was needed.

Residual limits: `convex-test` serializes top-level transactions, so the regression proves concurrent caller scheduling through the real mutation boundary, without simulating production optimistic-conflict retries. No browser component source changed; the canonical gate is browser-free. The original failing control, historical reviews, and native close evidence remain preserved. The local audit relies on retained command/source receipts and snapshots because no active root agent-transcripts source was available. This is local/dev completion; final native run acceptance remains with the orchestrator. No deferred-work or sprint-status file was written or reverted, and nothing was pushed or deployed.
