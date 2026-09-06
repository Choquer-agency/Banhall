---
title: Batch editor search while preserving preview and writer-edit behavior
type: refactor
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="existing all-branch integration authorization; parent owns approval and dispatch">

## Intent

**Problem:** A multi-pair preview rebuilds the same document search index and lowercase haystack for every needle, increasing editor work without improving matching.

**Approach:** Extract the existing position-aligned search helpers, evaluate each replacement batch against one index, and preserve rendered decorations and explicit writer-controlled edits.

## Boundaries & Constraints

**Always:** The user chose BMAD and authorized the audited integration; generic factory engine/shipping rules do not supersede this workflow. Use the parent-assigned consolidation baseline and owned workspace. Preserve main/prior parser repairs; only five files below. Keep punctuation/whitespace normalization, actual matched casing, offsets, exported Editor methods, document-identity cache, positional sorting and smartCaseReplace semantics. Preserve server authorization, snapshots, revision fences, provenance and autosave hold.

**Ask First:** Escalate concrete matching, persistence or authority changes to the parent; routine implementation and verification already have authorization and require no repeated human approval.

**Never:** The implementation worker must not stage, commit, push, merge, launch review workers, change the deferred ledger/native state, install dependencies or mutate other worktrees. Parent owns review, final gate and shipping.  Apply historical parser hunks, remove Underline ahead of B5, change backend/dependencies/configuration, bypass human proposal application, relax tests, introduce retries or rewrite native ledgers. Do not commit executable historical test copies under audit directories.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Batch | Twenty nonblank needles | One document walk and whole-haystack case-fold; index-aligned result slots | Missing matches yield empty slots |
| Empty | Empty/all-blank list | Empty results, zero walks | No document work |
| Mixed | Blank, duplicate and ordinary needles | Preserve input order and duplicate slots | No index shifting |
| Matching | Mixed case, quotes, dashes, whitespace/block boundaries | Existing non-overlapping ranges and actual text | Preserve existing fallback |
| Preview | Repeated occurrences/replacement pairs | Merge identical strikes per occurrence; retain widgets per pair | Empty replacement has strike only |
| Writer action | Clear preview/find-replace | Decorations clear; sorted matches and case handling unchanged | No automatic persistence |

</frozen-after-approval>

## Code Map

- `src/lib/components/editor/Editor.svelte`: refactor module helpers, buildDecorationSet and findReplaceAllMatches only.
- `src/lib/components/editor/docSearch.ts`: Range, normalization, position index and batch helpers.
- `src/lib/components/editor/docSearch.test.ts`: golden ranges and traversal/folding counters.
- `src/lib/components/editor/Editor.component.test.ts`: four actual rendered behavior pins; ordinary Chromium instance only.
- `scripts/bench/editor-search.mjs`: real decoration-source benchmark; supports both implementations.
- Read-only provenance: `9ee49b2bb94fb4c87c3e570bd11a7ed74c6916d5` benchmark, `1e84c27339676ad19a034d95bee92144e81b57d5` browser pins, `e4495a50c183507e8661422c4281785c7cffd3a1` refactor/tests; `d381a689e74f0d30cd712134735eb58207835f00` supplies only the merged-strikes/per-pair-widgets test-title correction. Details: `.audit/branch-consolidation/planning/B2.md`.

## Tasks & Acceptance

**Execution:**
- [ ] Confirm baseline/ownership; hash intended and protected paths.
- [ ] Add benchmark/browser pins first, keeping Editor unchanged; execute baseline commands and retain outputs/exits. Browser pins should pass; traversal counts establish the defect.
- [ ] Extract helpers and batch both Editor consumers; keep single-needle delegation and matrix behavior.
- [ ] Run unit/browser/benchmark proof; retain source and match-position hashes.
- [ ] In isolated audit controls, substitute per-needle evaluation and remove the empty-batch guard separately; prove the respective counter assertions fail, then restore exact source. Store controls as non-test snapshots or gzip.
- [ ] Record actual commands, exits and source hashes in `.audit/branch-consolidation/B2/evidence.md` and owned raw receipts. Report readiness; parent will stage new files after independent review for the canonical gate. Preserve historic screenshots.

**Acceptance Criteria:**
- Same fixtures preserve matchPositionsSha256 at both sizes; measured walks fall to 30 for 30 builds/20 pairs.
- Canonical selection runs Editor once in ordinary Chromium, never in pointer instances.
- Proposal/stepped-edit regressions and unified verification pass without authority changes.

## Spec Change Log

## Design Notes

Position-map alignment is the contract. Normalization collapses whitespace runs, so do not repeat the historical inaccurate “length-preserving” claim or expand Unicode semantics. Timings are observations, not thresholds. The CPU benchmark does not prove authenticated interaction or ReadOnlyEditor performance; preserve its current parser appendix.

## Verification

**Commands:**
- Baseline: `node scripts/bench/editor-search.mjs` and `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions`.
- After refactor: rerun both; additionally `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions`.
- Authority pins: `node node_modules/vitest/vitest.mjs run convex/chatProposals.test.ts tests/chatProposals.test.ts --expect.requireAssertions`.
- After staging: `node scripts/check-test-discovery.mjs`; parent coordinates `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` and `git diff --check` on final source.

Drafting executed no checks. Historical 600-to-30 receipts are references; retain fresh commands, hashes and exits.
