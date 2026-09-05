# Bounded structural QA extraction audit

Result: no new actionable in-contract finding in the inspected snapshot. This is an additional integration code audit, not native review acceptance or a fresh test pass.

## Provenance and bounds

Inspected worker: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/.bmad-loop/runs/20260904-162523-6e72/worktrees/dw-blocking-qa-native-followup`.

Captured at 2026-09-05T00:54:57.897969+00:00. HEAD before and after copying was `54a898d44878bf911eec5fb70777982eae43efde`, advanced from the assignment revision. The worker was active, so this conclusion binds the copied bytes, not future revisions or native terminal status. All seven copied working files were subsequently compared with `git show 54a898d44878bf911eec5fb70777982eae43efde:<path>`. The extractor, registered QA tests and flat follow-up spec differ from that commit; the other four files match. Therefore the latest repair assessed here is a WORKING-BYTE snapshot, not the captured committed implementation. Adjacent `qa-structural-boundary-input/manifest.json` records both working-snapshot and captured-HEAD hashes, byte lengths and equality results; copied source, test and spec files preserve the exact inputs.

Principal source: `convex/lib/tiptapReport.ts`, 9,654 bytes, SHA-256 `798806db4384e9bb5957ff45bd280f02c9b946ad51e9e1f7d5bbd23efd6287a3`. Detector: `convex/ai/qaChecks.ts`, 13,145 bytes, SHA-256 `de5dce8681e7afedc7766942d3c51f865b6ad7f3c294ee18c33c68b18c723768`.

Read the original frozen story, current flat follow-up, Convex guidelines, factory rules, TypeScript skill, extractor/detector, extractor tests and relevant registered QA boundary tests. The TypeScript skill's referenced type-system-discipline skill was not found under the configured local skill roots searched. No source, native state, ledger or worker audit files were edited. No tests were executed, no agents spawned and no commits made.

## Already-known active repairs, not new findings

The inspected source already includes the block-entry/block-exit repair and `horizontalRule` in `REPORT_BLOCK_TYPES` (extractor lines 12-15, 130-145). Each recognized block emits a separator before traversal and queues another after its descendants. Separators therefore survive arbitrary unknown inline-wrapper ancestry; the decision no longer depends solely on whether neighboring immediate children are block nodes. Unknown wrappers within paragraph/heading/codeBlock inline context inherit that context, preserving token cohesion.

The registered tests at `convex/qaBlocking.test.ts:536` cover uncertainty before a wrapped block, after a wrapped block, wrapped block siblings, direct horizontalRule and wrapped horizontalRule. They call readiness and publish before and after save and assert an exact-reference persisted blocker. Tests at line 569 split actual words (`un`/`certain`, `whe`/`ther`, `be`/`cause`) across nested wrappers and retain both blocked and allowed outcomes. Earlier nested paragraph/heading/codeBlock/blockquote/listItem and list/table tests remain at lines 505 and 520. These are inspected assertions, not execution evidence from this audit.

## Structural assessment

- **Inline and block composition:** The explicit entry/exit separators are sufficient for the reported ancestry bypass: a known nested block cannot contribute its because clause to adjacent inline text through wrappers. Unknown inline containers themselves do not manufacture breaks inside established inline context. Real nested paragraph blocks preserve their own inline text while separating adjoining blocks.
- **Breaks:** `hardBreak` emits a single newline (line 139), retaining a soft wrap under the existing detector. Repeated breaks and whitespace-only blank lines normalize into paragraph separation (line 222). `horizontalRule` now emits blank separation even when it has no content and is hidden inside wrappers. The top-level traversal independently separates terminal prose blocks.
- **Titles and section headings:** Blank nodes do not displace the first nonempty title (line 211). A first H1 that is itself the initial recognized 242 heading remains a section boundary because title skipping requires `firstSectionIndex > index` (line 216). The existing detector protects substantive heading text from being consumed as a label (line 153). A late first uncertainty heading preserves preceding recognized uncertainty except the established leading-title exclusion. The tests around lines 420-503 exercise the repaired title/preamble interactions.
- **Legacy text:** Standalone section lines are parsed separately from paragraph grouping; soft body wraps stay intact. The established-label restriction prevents prose cross-references from silently switching sections. Whitespace-only blank lines are normalized before grouping. No new interpretation of freeform prose is introduced by this structural repair.
- **Heap traversal:** Both block walking and nested inline walking use explicit arrays, with no recursive descendant call (lines 117-148 and 173-189). Only JSON parsing is caught, so a later traversal failure cannot silently fall back to empty sections. The existing depth-5,000 registered cases at test line 365 cover each traversal mode. This is not a proof of unlimited resource safety; it addresses the prior JavaScript call-stack failure without a new input-size policy.
- **Detector contract:** `checkBecauseClauses` still checks the three existing marker families, splits on blank paragraphs and sentence-ending punctuation, and uses the existing `/because/i` sentence predicate (`qaChecks.ts:80-120`). Multiple markers sharing one sentence, substring matching and semantic relevance are accepted detector limits, not new extraction findings. Hardening those would exceed this bounded structural task and the frozen deferral.

## Conclusion and remaining acceptance

No concrete additional counterexample was established within the specified structural contract. The latest repair addresses the known indirect block/horizontalRule bypass at the traversal level, with corresponding registered gate/persistence tests in the captured source. Native fresh verification, review finalization and orchestrator acceptance remain owned by the active native workflow. This report does not infer those outcomes from source inspection or earlier passing counts.
