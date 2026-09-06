---
title: Preserve actual editor search ranges across Unicode expansion and hard breaks
type: bugfix
created: 2026-09-05
status: done
review_loop_iteration: 2
baseline_commit: 1d6053388326fe4fde43a86177955157f11ce588
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
- `src/lib/components/editor/Editor.svelte`: share matched-text extraction across AI validation, both findAllInDoc returns and locateSectionParagraph; preserve section selection, lookup/ranking and legacy drift fallback algorithms.
- `src/lib/components/editor/docSearch.test.ts`: extend B2 goldens/performance with actual getEditorExtensions schemas, case context and UTF-16 controls.
- `src/lib/components/editor/Editor.component.test.ts`: prove actual caller ranges/preview spans from Tiptap JSON; retain B2 performance and rendering assertions.
- Read-only `src/lib/tiptapConfig.ts` and `src/lib/components/review/ReadOnlyEditor.svelte` establish schemas; the independent read-only search consumer is outside scope.
- `.audit/branch-consolidation/search-boundary-audit/{summary.md,probe.mjs,results.json}` records actual-schema baseline proof. Pre-B2 `cc6b706c3b43f971d944cb703a4174eabf3134d9` reproduces both; parent supplies post-B2 baseline.

## Tasks & Acceptance

**Execution:**
- [x] Hash baseline sources; add actual-schema tests first and retain failing ranges/text and exits before production edits.
- [x] Reapply B13-r1/rederive-preservation.json. Preserve per-needle non-overlap without omitting later valid spans: accepted candidates advance full needle length; rejected overlaps advance one folded unit. Before correcting it, six İ characters searched for combining-dot+i+combining-dot+i must expose missing4..7 after accepted1..4.
- [x] Treat actual node name `hardBreak` as a pending whitespace boundary; preserve normalized block/whitespace behavior. Extract matched text with a whitespace representation of hardBreak, retaining ordinary text/casing and existing block conventions.
- [x] Preserve repaired highlightText return paths. Add locateSectionParagraph shared extraction; before correction, prove QA navigation to paragraph2 wrongly highlights paragraph1 with concatenated decoy text. Preserve headings, paragraph null/clamping behavior and scrolling; inventory every aiHighlights writer and actual caller. Keep exact/fragment/paragraph highlightText controls and add Unicode prefix coverage.
- [x] Cover both schemas: repeated expansion, partial expansion selecting complete original characters, malformed surrogate needles never splitting characters, sigma across marks/breaks/paragraphs, supplementary characters and repeated boundaries. Add combined Unicode/break mounted preview and explicit replaceRange proof. Scope DOM checks to the mounted container; clearing removes strikes, widgets and AI highlights. Add actual nested heading/list/blockquote hardBreak controls. Assert no updates before explicit flush; test explicit replacement while decorations are active and assert full resulting JSON with marked neighbors preserved.
- [x] Run focused actual Editor regression and existing helper/caller performance tests. Compare unchanged golden cases and prove one traversal rather than merely observing faster timing.
- [x] Retain before/after commands, exits, fixture outputs and final source hashes under owned B13-r2 audit. Deliver unstaged changes/evidence to parent; do not launch reviews.

**Acceptance Criteria:**
- Same genuine baseline-failing Unicode/hardBreak cases pass after repair with exact valid document ranges.
- Existing whole-string case semantics and B2 batching remain; mapping work is linear in normalized document size, independent of needle count.
- No public API/schema/backend change or automatic report mutation is introduced. Distinguish helper, mounted caller and final integration evidence.

## Spec Change Log

Iteration2: fresh edge review found skipped valid ranges after overlap rejection; gap review found QA paragraph navigation still supplied concatenated hardBreak text. Amend non-frozen tasks/Code Map for candidate advancement and the third AI-highlight producer. KEEP all four snapshots in `.audit/branch-consolidation/B13-r1/rederive-preservation.json`, every36-helper/13-mounted control, original map/casing/batching, both repaired findAllInDoc returns and writer boundaries. Require fresh failing-before tests against the preserved candidate, then final tests/benchmark and fresh reviews. Use B13-r2 evidence; preserve both earlier iterations and their raw failures.

Iteration1: fresh reviews exposed original-coordinate overlaps after expansion and a findAllInDoc text-extraction mismatch that redirects highlightText. Non-frozen tasks and Code Map now require original-span non-overlap and shared extraction for both existing return paths, with failing-before controls. KEEP all four snapshots in `.audit/branch-consolidation/B13/rederive-preservation.json`, 30 helper/9 browser passing behaviors, one-walk/one-whole-fold B2 guards, raw index shape, contextual sigma, narrow hardBreak callback/horizontalRule behavior and unchanged ordinary benchmark digest. Reuse existing receipts only when source hashes match; rerun final tests/benchmark and new caller/overlap controls. Avoid retaining a correct new helper behind an incompatible existing caller. Use `.audit/branch-consolidation/B13-r1/` for new evidence and preserve B13 raw history.

## Design Notes

Iteration2 clarifications: greedily emit complete original-code-point spans in order without overlap or missing later candidates. Partial expansion/malformed UTF-16 needles may match a complete code point; grapheme-cluster and locale redesign remain excluded. All three AI state producers must use compatible text. Existing vitest-browser-svelte import registers cleanup automatically; do not introduce redundant cleanup or runtime changes.

Use authoritative whole-string lowercasing; an additional linear code-point pass can map folded units to complete original start/exclusive-end spans using isolated lowercase lengths only. Preserve contextual sigma and avoid O(n²) prefix work or a second whole-haystack fold for a single code point. Keep the existing raw buildSearchIndex map meaning. Extract hardBreak as space via ProseMirror textBetween’s leaf callback; preserve `leaf.type.spec.leafText?.(leaf) ?? ""` for other leaves. A blanket leaf override changes horizontalRule block extraction, so retain its regression control. Shared extraction aligns matching and AI range validation; fallback search remains unchanged.

## Verification

**Commands:**
- `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` with new tests before source fix, then after.
- `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` for actual caller behavior and retained B2 controls.
- `node scripts/bench/editor-search.mjs` retains B2 ordinary fixture position digest and traversal totals; timing is descriptive, not a threshold.
- `git diff --check`; parent conducts fresh independent review and final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.

Worker evidence belongs in `.audit/branch-consolidation/B13-r2/`, including `evidence.md`, source hashes and actual raw failing/passing controls. No worker ledger edits; parent will close the two native follow-ups only after independent review and the gate.

## Final Acceptance

Three fresh review rounds exposed and resolved Unicode overlap/enumeration and both existing highlight-producer mismatches. Final edge and verification-gap reviews found no remaining defects/gaps; parent triaged all blind findings and proved the small assertion patches. The final nine-step gate passed 2,020 unit and 481 browser tests, typechecks, build, discovery and 50 PowerShell/18 shell harness assertions. All four reviewed source hashes match; no unexpected tracked-file changes. Native DW-101/DW-102 are closed with all other 100 entries preserved. No sprint story key exists, so sync is a no-op.

## Suggested Review Order

- Map lowercase units to complete original spans and enumerate every non-overlapping match.
  [docSearch.ts:76](../../src/lib/components/editor/docSearch.ts#L76)

- Use one hard-break extraction convention for existing AI reference producers.
  [Editor.svelte:116](../../src/lib/components/editor/Editor.svelte#L116)

- Keep QA paragraph navigation on the requested passage.
  [Editor.svelte:1001](../../src/lib/components/editor/Editor.svelte#L1001)

- Review actual-schema expansion, non-overlap and nested-boundary regressions.
  [docSearch.test.ts:308](../../src/lib/components/editor/docSearch.test.ts#L308)

- Prove explicit application preserves marked neighbors and clears obsolete decorations.
  [Editor.component.test.ts:326](../../src/lib/components/editor/Editor.component.test.ts#L326)

- Inspect independently reproduced defects and final review dispositions.
  [review-triage.md:1](../../.audit/branch-consolidation/B13-r2/review-triage.md#L1)

- Verify final gate and native closure receipts.
  [native-closure.json:1](../../.audit/branch-consolidation/B13-r2/native-closure.json#L1)
