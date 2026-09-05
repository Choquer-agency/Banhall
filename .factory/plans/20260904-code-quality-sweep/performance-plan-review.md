# Performance ticket review

Reviewed `.factory/tickets/perf-1-parser-timers-editor-index.md` against current `Editor.svelte`, `parseDocument.ts`, their tests, both Vitest configurations, and the saved benchmark. This review changes no planner/ticket/product files. Findings below concern the draft as read, not an assertion that the planner has failed to apply later feedback.

## Remaining actionable verification gaps

### P1: Test the accumulated whole-file deadline, not only an initially stalled operation

Draft AC2 (`perf-1-parser-timers-editor-index.md:19`) stalls either document loading or one text operation, without specifying prior time consumed. A mistaken implementation that resets a 60-second timer for every page can pass both cases. The existing parser creates the absolute deadline once after reading the file (`src/lib/parseDocument.ts:179`) and passes that same value to document load, page load and text extraction (`:187`, `:190`, `:191`).

Require a parser integration fixture with accumulated elapsed time: document loading consumes 20 seconds, a first page operation consumes another 20 seconds, then a later page operation never resolves. Advancing fake time to 59,999 ms total must leave the parse pending; at 60,000 ms total it must resolve with the correct page marker, one destroy call and no pending timers. This catches a per-page timeout regression that the current AC wording does not.

### P1: The extracted fuzzy-reference search currently has no behavior characterization

AC3 moves `findAllInDoc` into the new module, but AC4 characterizes only case-insensitive find/replace. `findAllInDoc` is a different algorithm used by `highlightText` and its scroll target (`Editor.svelte:1070`, `:1078`). Its exact search is case-sensitive; failing that, it tries a leading fragment for references of at least 24 characters, capped at 60 characters (`:178`, `:193`), then a significant-word paragraph overlap fallback requiring at least two words and a best score of at least 0.5 (`:211`, `:237`). A refactor could break AI-reference highlights while all proposed batch tests pass.

Either leave this separate helper in the editor and expose only the mechanics it shares, or add baseline-derived expected outputs for all three match modes, fallback boundaries, ties, no-match and actual returned source text. Include its `SIG_WORD` dependency (`:148`) if moving it. Avoid changing its case behavior to match `findAllOccurrencesCI` simply because both use the same index.

### P2: Clarify the rejection boundary and prove cleanup on rejection

AC2 says “getDocument rejects,” but PDF.js `getDocument` returns a loading-task object (`parseDocument.ts:180`). Its `promise` rejects asynchronously. The current outer `try/finally` begins only after the task is created (`:186`), and also covers `getPage` and `getTextContent` rejections.

Require separate controlled `loadingTask.promise`, `pdf.getPage` and `page.getTextContent` rejection cases, each asserting the original error object propagates unchanged, timer count becomes zero, and `destroy` is called once. A synchronous throw from `getDocument` is a different pre-task case with no acquired loading task and cannot prove cleanup of a raced timer. Test the asynchronous rejection cases, including one after a prior page already succeeded.

### P2: One traversal alone does not prove all repeated document normalization was removed

The existing case-insensitive matcher lowercases the full indexed text at `Editor.svelte:262`. Draft implementation notes instruct copying the per-needle loop after building one `{ hay, posMap }`. If full-document `hay.toLowerCase()` remains inside that loop, traversal counts improve while each pair still allocates and scans a complete lowercase string.

Specify that the indexed document and its case-folded search text are each constructed at most once per nonempty batch; only needle normalization and occurrence search belong in the per-needle loop. Record timings as supporting evidence while keeping operation counts as the stable gate.

## Root findings to preserve in the final acceptance contract

Root independently identified the following two constraints. They are retained here for the validator's context rather than claimed as new findings.

- **No-work cost must remain zero.** Empty batches, only-empty/whitespace needles, and the existing `doc.content.size < 2` short circuit must not trigger indexing. `findAllOccurrencesCI` returns before `buildSearchIndex` at `Editor.svelte:259`; today `buildDecorationSet` with no diffs does no proposal search at all (`:508`). A batch helper that unconditionally builds an index would add document work to ordinary editor updates with no preview. Add explicit zero-traversal cases and a mixed blank/nonblank case that still makes only one traversal.
- **Use a baseline oracle.** Batch-vs-single comparisons between two newly refactored functions can pass when both share a regression. Freeze baseline `{ from, to, text }` results or run the same corpus against the baseline implementation and the fixed implementation. Preserve occurrence order, exact source text, duplicate pair multiplicity and `smartCaseReplace` behavior. The saved benchmark's ASCII-only position hash is useful for its fixture, but does not characterize quotes, whitespace or multiblock mapping.

## Findings already sent to root and included in orchestrator review

These overlap the root's existing review. Keep one authoritative finding for each when triaging.

### P1: The named component suite never mounts the editor

Draft AC6 (`perf-1-parser-timers-editor-index.md:23`) names `src/routes/project/[id]/projectRoute.component.test.ts` as proof of proposal preview, typing, comment highlight and apply flow. That suite explicitly keeps the report pages in their loading states (`projectRoute.component.test.ts:15`) and only seeds rollout access. Its assertions concern route/cohort markers, so the actual Editor component is never instantiated. A repository inventory found no editor/chat component suites to supply the missing proof:

```text
rg --files src | rg '(editor|chat|projectRoute).*\.component\.test\.ts$'
src/routes/project/[id]/projectRoute.component.test.ts
```

Require a real Editor browser harness/component suite with report content and appropriate props. Exercise previewProposal, typing while a preview is active, clearing stale previews, findReplaceMatches/replaceRange and comment highlights. Assertions should inspect rendered decorations and serialized content. Run it explicitly with `vitest.component.config.ts`; the root Vitest config excludes `.component.test.ts`. A route loading-state pass must not be reported as editor-flow proof.

### P1: Mandatory verification still runs the incompatible original benchmark

The draft frontmatter `verify` command runs the original plan-dir `performance-benchmark.mjs` (`perf-1-parser-timers-editor-index.md:10`). That harness deliberately removes import declarations and evaluates the editor module script with only Decoration/DecorationSet injected. After AC3 moves matching functions into `docSearch.ts`, the original harness will have unresolved imported helper names. The verification section adapts an `.audit/` copy (`:29`), but does not update the mandatory command, so required verification cannot pass after the planned extraction.

Use one compatible runner for both layouts and point the required command at it. For baseline it must execute the baseline editor-local functions; for fixed HEAD it may load/transpile the actual fixed module. Do not inject fixed matching functions while measuring the baseline editor, because that would erase the old algorithm from the before measurement. The runner should retain source hashes, fixture equivalence, match-position hashes and full operation counts. The original plan-dir harness should remain a historical baseline artifact unless its maintenance is explicitly in ticket scope.

## Bounds and scope notes

- Keep per-build reuse local. The draft correctly prohibits module/global caches and preserves document-identity changes between calls.
- The 600-to-30 traversal benchmark intentionally isolates proposal searches with no comment ranges, AI ranges or section metrics. Real decorations can also traverse the document for comment reanchoring and section metrics; do not assert one total traversal for all combined editor features. Attribute the count to search-index construction.
- Two identical `find` strings must still produce occurrences for each pair in the caller's original order. Using a map may share the lookup result, but must not silently deduplicate the requested decorations/replacements.
- `previewProposal` and `clearProposalPreview` perform separate first-match searches to position scrolling (`Editor.svelte:1147`, `:1162`). The batch optimization should preserve that behavior. Those extra calls are outside the isolated `buildDecorationSet` benchmark and should not be hidden in a browser timing claim.
- Preserve PDF cap termination: the current parser can stop when extracted text exceeds `MAX_CONTENT_CHARS`, after which `capContent` may replace the page marker with the generic cap marker (`parseDocument.ts:201`, `:215`). Existing pure marker tests help, but an integration fixture is preferable if parser control flow changes beyond timer cleanup.
- The latest verified saved-harness medians in `performance-audit.md` are 60.61 ms and 262.48 ms; 63 ms and 282 ms quoted in draft intent came from the earlier ad hoc run. Both are recorded observations with identical operation counts, but final evidence should name the exact saved run used for its comparison.
