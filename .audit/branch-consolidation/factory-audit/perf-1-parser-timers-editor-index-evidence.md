# Evidence · perf-1-parser-timers-editor-index
commit: f82f2b0   branch: factory/perf-1-parser-timers-editor-index   baseline: 184d376   date: 2026-09-05   kind: perf

Baseline note: `184d376` is a planning-artifacts commit on top of `11bfe3e`; `git diff 11bfe3e 184d376 -- src/ scripts/` is empty, so every "baseline" number below is also the number at `11bfe3e`.

## Coverage
- AC1 → `src/lib/parseDocument.test.ts::PDF parse deadline > leaves no pending timers after a successful multi-page parse` ✓ (ran in `npx vitest run src/lib/parseDocument.test.ts`). Asserts the exact parsed object, `destroyCalls === 1` and `vi.getTimerCount() === 0`. Fails at the baseline parser: `expected 7 to be +0` (2N+1 for N=3).   [ladder 4]
- AC2(a) → `::keeps one cumulative 60s budget across the load and every page` ✓. Pending at 59,999 ms, resolved at 60,000 ms with `Page one` + `pdfPageStopMarker(2)`, `destroyCalls === 1`, `vi.getTimerCount() === 0`. **Passes at the baseline too** — see `## Not proven`.   [ladder 4]
- AC2(b) → `::returns empty text with no page marker when the document never loads` ✓. Also passes at the baseline.   [ladder 4]
- AC2(c) → `::propagates the original error and cleans up when %s` ✓, three cases (load rejects, `getPage` rejects, a later page's `getTextContent` rejects). `rejects.toBe(boom)` pins error identity. Fails at the baseline with 1, 2 and 5 timers pending.   [ladder 4]
- AC2 (`ParseTimeout` identity, `PDF_PARSE_TIMEOUT_MS`) → both unchanged in the diff; observable through AC2(a)/(b) (the 60,000 ms boundary) and AC2(c) (a non-`ParseTimeout` error propagates instead of being swallowed).   [ladder 4]
- AC3 → `src/lib/components/editor/docSearch.test.ts::docSearch batch cost` (4 cases: 0 traversals for `[]`, 0 for `["", "   "]`, 1 for the 20-needle batch, 1 for 19 real + one whitespace with `[]` in slot 19) and `::case-folds the whole haystack once for a 20-needle batch` ✓ (ran in `npx vitest run src/lib/components/editor/docSearch.test.ts`).   [ladder 4]
- AC4 → `docSearch.test.ts::findAllOccurrencesCI returns the pre-move ranges for every corpus needle`, `::every findOccurrencesBatch slot equals the pre-move ranges`, `::two identical needles in one batch return equal arrays` ✓. Literals captured from the baseline `Editor.svelte` by `capture-goldens.mjs` (see `## Pin`).   [ladder 4]
- AC5 → `rg` output below + `npm run check` (0 errors, 5881 files). `CurrentProjectPage.svelte` and `PreviewProjectPage.svelte` are not in the diff.   [ladder 4]
- AC6(a) → `src/lib/components/editor/Editor.component.test.ts`, 4 cases ✓ under `vitest.component.config.ts`, green against the baseline `Editor.svelte` **before** the helpers moved (`component-baseline.log`) and green at HEAD (`component-after.log`).   [ladder 5 — real Chromium, real Tiptap mount]
- AC6(b) → `scripts/bench/editor-search.mjs` at baseline and HEAD, two runs each (see `## Baseline / After`).   [ladder 4]

## Gates
| command | exit | note |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | 0 | convex tsc, `npm run check`, `npm test`, both uploader harnesses |
| `npm run check` | 0 | 5881 files, 0 errors, 0 warnings |
| `npm test` | 0 | 129 files, 1428 tests |
| `npx vitest run src/lib/parseDocument.test.ts src/lib/components/editor/docSearch.test.ts` | 0 | 28 tests |
| `npx vitest run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts` | 0 | 4 tests |
| `node scripts/bench/editor-search.mjs` | 0 | see below |
| `npm run test:component` (full suite) | 1 | the same 8 failures as the plan-dir baseline, none in this ticket's files |

## Output tails
### bash scripts/loop-verify.sh
```
1788588643129 COMPLETED 5881 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  129 passed (129)
      Tests  1428 passed (1428)
...
50 passed, 0 failed        (scripts/client-uploader/tests/run-tests.ps1)
18 passed, 0 failed        (scripts/client-uploader/tests/run-tests.sh)
EXIT=0
```
### npx vitest run src/lib/parseDocument.test.ts src/lib/components/editor/docSearch.test.ts
```
 Test Files  2 passed (2)
      Tests  28 passed (28)
```
### npx vitest run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
### rg -n 'buildSearchIndex|findAllOccurrencesCI|findOccurrencesBatch|normalizeForMatch|findAllInDoc|docSearch' src/lib/components/editor/Editor.svelte  (AC5)
```
42:    buildSearchIndex,
43:    findAllOccurrencesCI,
44:    findOccurrencesBatch,
45:    normalizeForMatch,
47:  } from "./docSearch";
104:  function findAllInDoc(doc: PMNode, text: string): Range[] {
109:    const { hay, posMap } = buildSearchIndex(doc);
126:    const search = normalizeForMatch(needle);
173:        const bw = new Set(normalizeForMatch(b.text).toLowerCase().match(SIG_WORD) ?? []);
421:      ? findOccurrencesBatch(doc, diffs.map((d) => d.find))
984:      if (trimmed) ranges.push(...findAllInDoc(editor.state.doc, trimmed));
992:        ? findAllInDoc(editor.state.doc, scrollTo.trim())[0]
1029:    const found = findOccurrencesBatch(editor.state.doc, pairs.map((p) => p.find));
1061:    const first = findAllOccurrencesCI(editor.state.doc, previewDiffs[0].find)[0];
1076:          const first = findAllOccurrencesCI(editor.state.doc, anchor)[0];
```
Import line, the `findAllInDoc` definition and call sites, the two batch call sites, and the two single-needle scroll anchors. Nothing else.

## Before / After  (parser)
`npx vitest run src/lib/parseDocument.test.ts` with the new test file against the **baseline** `src/lib/parseDocument.ts` (restored with `git show 184d376:src/lib/parseDocument.ts`, full log in `parser-before.log`):
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  ... > leaves no pending timers after a successful multi-page parse
AssertionError: expected 7 to be +0 // Object.is equality
 FAIL  ... > propagates the original error and cleans up when the document load rejects
AssertionError: expected 1 to be +0 // Object.is equality
 FAIL  ... > propagates the original error and cleans up when getPage rejects
AssertionError: expected 2 to be +0 // Object.is equality
 FAIL  ... > propagates the original error and cleans up when a later page's getTextContent rejects
AssertionError: expected 5 to be +0 // Object.is equality
      Tests  4 failed | 15 passed (19)
```
After (`parser-after.log`):
```
      Tests  19 passed (19)
```

## Pin  (search helpers)
Goldens captured **before** any code moved, from the baseline `findAllOccurrencesCI` inside `Editor.svelte`, using the benchmark's module-extraction method (`performance-benchmark.mjs:14-28`):
```
node .audit/perf-1-parser-timers-editor-index/capture-goldens.mjs
```
Output: `.audit/perf-1-parser-timers-editor-index/goldens.json` — 20 real needles (curly quotes, en/em dashes, repeated whitespace, a cross-paragraph phrase, a duplicated phrase, a phrase whose case differs between occurrences, a needle absent from the document) plus `""` and `"   "`. The `{ from, to, text }` values are literals in `docSearch.test.ts`'s `GOLDEN`, with the capture commit in the file header.

Negative runs proving the count assertions can fail (`## After` state of the module, mutated temporarily then restored):
```
=== NEGATIVE 1: per-needle index build ===
     × walks the document once for a 20-needle batch
     × walks the document once for 19 real needles plus a whitespace needle
     × case-folds the whole haystack once for a 20-needle batch
AssertionError: expected 20 to be 1 // Object.is equality
AssertionError: expected 19 to be 1 // Object.is equality
AssertionError: expected 20 to be 1 // Object.is equality
      Tests  3 failed | 6 passed (9)
=== NEGATIVE 2: no empty-batch early return ===
     × never touches the document for an empty batch
     × never touches the document when every needle normalises to empty
AssertionError: expected 1 to be +0 // Object.is equality
      Tests  2 failed | 7 passed (9)
=== RESTORED ===
      Tests  9 passed (9)
```

## Baseline / After  (perf)
Command, both trees: `node scripts/bench/editor-search.mjs`. Two runs each. The new harness reproduces the plan-dir original's baseline numbers — the original run in this worktree gave the same 600 / 600 / 201 and the same `matchPositionsSha256`.

| metric | baseline `184d376` | HEAD `f82f2b0` |
| --- | ---: | ---: |
| `descendantTraversals` per 30 preview builds, 22,790 chars | 600 | **30** |
| `descendantTraversals` per 30 preview builds, 91,490 chars | 600 | **30** |
| `matchPositionsSha256` (both sizes) | `97e33b1b…5397` | `97e33b1b…5397` (identical) |
| `pendingAfterCompletion` over 201 successful operations | 201 | **0** |
| `medianMs` / build, 22,790 chars (context) | 62.82 / 60.59 | 3.49 / 3.53 |
| `medianMs` / build, 91,490 chars (context) | 251.77 / 252.33 | 14.00 / 14.07 |

Baseline, run 1 (`/tmp/bench-baseline-1.txt`):
```
{"kind":"synthetic_editor_cpu","chars":22790,"proposalPairs":20,"iterations":30,"descendantTraversals":600,"medianMs":62.82,"p95Ms":72.21,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"synthetic_editor_cpu","chars":91490,"proposalPairs":20,"iterations":30,"descendantTraversals":600,"medianMs":251.77,"p95Ms":278.65,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"deadline_helper_only_not_pdf_integration","source":"src/lib/parseDocument.ts","sha256":"1a47de2b39cd3ffc3041debff222691fb6cb4d6c866f405911a2ad4c6d19be8c","successfulOperations":201,"allocatedTimers":201,"pendingAfterCompletion":201}
```
HEAD, run 1:
```
{"kind":"synthetic_editor_cpu","chars":22790,"proposalPairs":20,"iterations":30,"descendantTraversals":30,"medianMs":3.49,"p95Ms":4.58,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"synthetic_editor_cpu","chars":91490,"proposalPairs":20,"iterations":30,"descendantTraversals":30,"medianMs":14,"p95Ms":17.52,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"deadline_helper_only_not_pdf_integration","source":"src/lib/parseDocument.ts","sha256":"8dde3d3a7938a55cba76fe350f33e595d795431f6e0d64857839d3738a3ed69a","successfulOperations":201,"allocatedTimers":201,"pendingAfterCompletion":0}
```
Timing is context, not a target; the counts and the match hash are the criterion. Both metrics moved far past noise, and the match hash did not move at all.

## Live surface
Real Chromium, real Tiptap mount, no screenshots (ui: false).
- `src/lib/components/editor/Editor.component.test.ts` seeds a report (three headings, twelve paragraphs, a phrase repeated in two paragraphs, one phrase whose casing differs between occurrences), mounts the real `Editor` with `render` from `vitest-browser-svelte`, waits for `.tiptap-editor`, and drives the exported functions on `result.component`: `previewProposal` with 20 pairs including a duplicated `find`, `clearProposalPreview`, `findReplaceMatches`, `replaceRange` + `flushPendingSave`, `highlightText` in four reference modes.
- Green against the baseline `Editor.svelte` before the helpers moved: `.audit/perf-1-parser-timers-editor-index/component-baseline.log` (4 passed at `184d376`). Green at HEAD: `component-after.log`.
- Full suite: `component-suite.log`, 5 failed files / 8 failed tests — the same eight names as `.factory/plans/20260904-code-quality-sweep/component-baseline.log` (Button, WorkspaceChrome, WorkspaceHeader, WorkspaceRail ×4, workspaceRoutes). Totals moved 289 → 293 tests and 281 → 285 passed, i.e. exactly the four cases this ticket adds. Owned by `ui-1-component-suite-green`.
- Observed baseline detail that the ticket predicted differently: ProseMirror collapses two identical inline decorations over the same range into one span, so a duplicated pair renders one `.proposal-removed` per occurrence (20 for the 20-pair batch) while widgets do not merge and the duplicate shows four `.proposal-added` (21 total). The suite pins what the baseline renders, and HEAD renders the same.

## Not proven
- AC2(a) and AC2(b) as *baseline discriminators* — they pass on both trees. At 60,000 ms every timer the baseline allocated is already due, so neither case can distinguish the two implementations; they are kept because they fail a per-call 60 s timeout, which is the wrong fix the ticket warns against. The timer-leak regression is proven by AC1 and AC2(c), which do fail at the baseline. Command a human can rerun: `git show 184d376:src/lib/parseDocument.ts > src/lib/parseDocument.ts && npx vitest run src/lib/parseDocument.test.ts` (then restore with `git checkout src/lib/parseDocument.ts`).
- Browser latency and real-PDF parsing. The bench is a synthetic Node CPU/helper measurement over extracted source, not browser INP and not a pdf.js integration test; the component suite proves rendered output and wiring, not walk counts. A real generated text PDF in Chromium would additionally exercise the pdf.js boundary. Command: none in this repo today.
- Walk counts inside the browser. `Editor.svelte` has four other `doc.descendants` callers, so a prototype spy there could not attribute a traversal to the batch; counts are proven in node against the fixture doc instance instead (`docSearch.test.ts`) and end-to-end through `buildDecorationSet` in the bench.

## Orchestrator QA record

The engine saved the independent QA result as `qa-0.md` beside this evidence. Its reported inability to append evidence is now resolved by this orchestrator entry; no user write action is needed. QA returned done / test-verified at 77825a2 and independently reran the gate, targeted unit/browser suites and benchmark. Read `qa-0.md` for exact commands, results and limits. The separate sequential-delay fixture correction remains open under proposed `proof-1-parser-budget-sequence`; this does not change the recorded production benchmark results.

## Root closeout corrections, 2026-09-05

The earlier parser fixture follow-up is now resolved by proof-1-parser-budget-sequence (source d381a689e74f0d30cd712134735eb58207835f00, integration merge 7a32eee): sequential lazy page callbacks, intended eager negative-control failure, parser19/19 and Editor4/4 passed. See ../proof-1-parser-budget-sequence/evidence.md and qa-0.md. The duplicate Underline warning is resolved by slop-2-dead-helpers-and-deps (source fb6c6b5, merge7b9b01e): one registration in editable/read-only editors, zero warnings, preserved underline roundtrip and four passing real Editor component cases. See ../slop-2-dead-helpers-and-deps/evidence.md and root-integrated-underline.json. The original limitations about real-PDF browser proof and ReadOnlyEditor search remain.
