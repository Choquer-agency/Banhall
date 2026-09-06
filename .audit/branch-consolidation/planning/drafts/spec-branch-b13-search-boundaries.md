---
title: Preserve actual editor search ranges across Unicode expansion and hard breaks
type: bugfix
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="user authorized audited correction of wrong search ranges; parent dispatches after B2 before B3">

## Intent

**Problem:** Whole-string lowercasing can expand Unicode characters after the search position map is built, returning shifted or missing matches. Ignoring supported hardBreak nodes joins separate words and falsely matches across a visible boundary.

**Approach:** Align normalized lowercase offsets with original ProseMirror UTF-16 spans while retaining whole-string casing behavior. Index hardBreak as a whitespace separator under the existing whitespace/block matching convention. Preserve B2 batching and actual caller behavior.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping rules do not replace this authorized workflow.  Use the parent-assigned baseline/worker after B2. Preserve ordinary punctuation/whitespace matching, actual matched casing, non-overlapping per-needle results, input-slot alignment, duplicate needles and caller sorting. One traversal per nonempty batch, zero for empty/all-blank input. Represent hardBreak as a single space in returned matched text, consistent with existing block-separator extraction while preserving all ordinary text/casing. Parent owns review, staging, final gate and shipping.

**Ask First:** Report any required change to public matching policy, editor schema, dependencies or persistence to parent before extending scope. Correcting proven wrong ranges and supported hardBreak boundaries is authorized.

**Never:** Install, stage, dispatch reviewers, commit, push, merge, edit other worktrees or native ledgers/state. No source outside the allowed helper, narrow Editor binding and tests, locale-specific matching redesign, unsupported inline-atom feature, browser configuration workaround, fixed sleeps, skipped assertions or backend/prose mutation changes. Do not hand-edit generated files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Expansion before match | `İ target tail`; needle `target` | Range3..9, actual text `target` | Never shifted `arget t` |
| Expansion before end | `İ target`; same needle | Range3..9 remains present | No undefined-map dropped match |
| Expansion inside match | Needles around/including expanded character | Map to complete original UTF-16 spans | No synthetic character offsets |
| Contextual lowercase | Greek final sigma, surrounding cased text/marks | Whole-string lowercase behavior retained | No per-codepoint casing substitution |
| Hard break | `alpha`, hardBreak, `beta`; `alphabeta` | No match | Never silently concatenate words |
| Whitespace spanning break | Same document; `alpha beta` or newline needle | One range1..11 across the separator | Returned text must not conceal the break |
| Review highlight | Pass cross-break findReplaceMatches range/text to highlightRange | Actual AI reference highlight remains visible | Same narrow extraction convention |
| Repeated boundaries | Multiple breaks, surrounding whitespace/empty blocks | Existing collapsed-separator semantics | No leading/trailing false spans |
| Ordinary batch | ASCII, quotes/dashes, duplicates, blanks, supplementary text | Prior golden ranges and ordering retained | No split-surrogate bounds |

</frozen-after-approval>

## Code Map

- `src/lib/components/editor/docSearch.ts`: repair case-expanded mapping and ignored hardBreak without per-needle document work.
- `src/lib/components/editor/Editor.svelte`: import shared matched-text extraction and use it only for AI range validation; do not redesign fallback/drift resolution.
- `src/lib/components/editor/docSearch.test.ts`: extend B2 goldens/performance with actual getEditorExtensions schemas, case context and UTF-16 controls.
- `src/lib/components/editor/Editor.component.test.ts`: prove actual caller ranges/preview spans from Tiptap JSON; retain B2 performance and rendering assertions.
- Read-only `src/lib/tiptapConfig.ts` and `src/lib/components/review/ReadOnlyEditor.svelte` establish schemas; the independent read-only search consumer is outside scope.
- `.audit/branch-consolidation/search-boundary-audit/{summary.md,probe.mjs,results.json}` records actual-schema baseline proof. Pre-B2 `cc6b706c3b43f971d944cb703a4174eabf3134d9` reproduces both; parent supplies post-B2 baseline.

## Tasks & Acceptance

**Execution:**
- [ ] Hash baseline sources; add actual-schema tests first and retain failing ranges/text and exits before production edits.
- [ ] Map expansion while retaining whole-string casing; no independent per-character output or repeated whole-prefix folding.
- [ ] Treat actual node name `hardBreak` as a pending whitespace boundary; preserve normalized block/whitespace behavior. Extract matched text with a whitespace representation of hardBreak, retaining ordinary text/casing and existing block conventions.
- [ ] Share hardBreak-only matched-text extraction with Editor AI range validation. Prove mounted highlightRange retains the new cross-break match and leaves prose unchanged.
- [ ] Cover both schemas, including sigma across marks, expanded matches, supplementary characters and repeated boundaries; no invented nodes.
- [ ] Run focused actual Editor regression and existing helper/caller performance tests. Compare unchanged golden cases and prove one traversal rather than merely observing faster timing.
- [ ] Retain before/after commands, exits, fixture outputs and final source hashes under owned B13 audit. Deliver unstaged changes/evidence to parent; do not launch reviews.

**Acceptance Criteria:**
- Same genuine baseline-failing Unicode/hardBreak cases pass after repair with exact valid document ranges.
- Existing whole-string case semantics and B2 batching remain; mapping work is linear in normalized document size, independent of needle count.
- No public API/schema/backend change or automatic report mutation is introduced. Distinguish helper, mounted caller and final integration evidence.

## Spec Change Log

## Design Notes

Use authoritative whole-string lowercasing; an additional linear code-point pass can map folded units to complete original start/exclusive-end spans using isolated lowercase lengths only. Preserve contextual sigma and avoid O(n²) prefix work or a second whole-haystack fold for a single code point. Keep the existing raw buildSearchIndex map meaning. Extract hardBreak as space via ProseMirror textBetween’s leaf callback; preserve `leaf.type.spec.leafText?.(leaf) ?? ""` for other leaves. A blanket leaf override changes horizontalRule block extraction, so retain its regression control. Shared extraction aligns matching and AI range validation; fallback search remains unchanged.

## Verification

**Commands:**
- `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` with new tests before source fix, then after.
- `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` for actual caller behavior and retained B2 controls.
- `node scripts/bench/editor-search.mjs` retains B2 ordinary fixture position digest and traversal totals; timing is descriptive, not a threshold.
- `git diff --check`; parent conducts fresh independent review and final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.

Worker evidence belongs in `.audit/branch-consolidation/B13/`, including `evidence.md`, source hashes and actual raw failing/passing controls. No worker ledger edits; parent will close the two native follow-ups only after independent review and the gate.
