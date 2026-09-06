B13 iteration 2 implementation evidence

Baseline: `1d6053388326fe4fde43a86177955157f11ce588`. The full spec and its sole frontmatter context file, `AGENTS.md`, were read before edits, together with `.factory/AGENTS.factory.md`. The spec controls scope and handoff. Only the two allowed production files and their two test files are changed. No installation, staging, reviews, commits, shipping, other-worktree edits, or native ledger/state edits were performed.

The four B13-r1 snapshots were SHA-256 verified against `rederive-preservation.json` before reapplication. `snapshot-verification.json` retains that manifest. `baseline-hashes.json`, `r2-before-hashes.json`, and `final-hashes.json` identify the source states. `before-source/` and `final-source/` retain the exact four source files as snapshots; original B13 and B13-r1 artifacts remain intact.

Implementation:

- `docSearch.ts` retains the raw normalized index map and authoritative whole-string lowercase. One additional linear code-point pass maps folded units to complete original UTF-16 start/end spans. Partial expansions and surrogate needles select complete original characters. Accepted matches consume the needle length; rejected overlaps consume one folded unit, preserving later valid original spans.
- Supported `hardBreak` nodes create pending whitespace boundaries. `extractMatchedText` represents them as spaces, preserving ordinary text, actual casing, block separators and other leaves' existing leafText behavior.
- `Editor.svelte` shares extraction in both `findAllInDoc` return paths, AI decoration validation, and `locateSectionParagraph`. The exact/fragment/paragraph lookup and ranking algorithms, headings, paragraph filtering/clamping, scrolling and legacy drift fallback remain unchanged.

Fresh failure evidence:

| Source and tests | Result | Receipt |
| --- | --- | --- |
| Baseline production, preserved actual-schema helper tests | 22 failures, 14 passes | `baseline-helper.log` |
| Baseline production, preserved mounted caller tests | 6 failures, 7 passes | `baseline-component.log` |
| Reapplied B13-r1 source and tests | 36 helper and 13 mounted passes | `preserved-helper.log`, `preserved-component.log` |
| B13-r1 production, new overlap control in both schemas | Both fail: only 1..4 is returned; 4..7 is absent | `r2-before-helper.log` |
| B13-r1 production, new QA paragraph control | Decoy DOM paragraph index 0 highlighted instead of index 2 (the second nonempty paragraph) | `r2-decoy-before-component.log` |

The initial QA failure and first post-fix type-check failure are retained in `r2-before-component.log` and `final-check.log`. The type-check failure identified nullable editor capture, which was corrected by retaining the document before the callback. Public Convex environment values were then supplied using the repository gate's public placeholders. There was no browser workaround or deployment.

`probe.mjs` runs the actual `getEditorExtensions` schemas against the baseline git object, preserved candidate and final helper, without changing working sources. `results.json` retains input JSON, needles, source hashes and actual output ranges for both schema configurations, including the shifted/dropped target, missing later overlap, hard break and malformed surrogate cases. Browser failure screenshots are copied into `before-screenshots/`.

Acceptance coverage:

| Requirement | Live proof |
| --- | --- |
| Exact original Unicode ranges, partial expansion, repeated expansion, malformed surrogate needles, supplementary letters | 40-test `verified-helper.log`; both editable and read-only schemas; `results.json` |
| Whole-string sigma across marks, hard breaks and paragraphs; original raw map | Actual-schema helper assertions |
| Repeated breaks, whitespace and empty blocks; horizontalRule behavior | Actual-schema helper assertions |
| Ordinary punctuation, casing, duplicates, slots, non-overlap and ordering | Unchanged B2 golden assertions plus mounted caller controls |
| One traversal per nonempty batch and zero for empty/all-blank batches | Helper instrumentation; mounted findReplaceMatches and preview traversal spies |
| One whole-haystack lowercase, including a single expanding code point | Existing B2 and actual-schema helper counters |
| Compatible highlightText exact, fragment and paragraph returns | Mounted decoy tests with both empty and Unicode prefixes |
| Compatible QA paragraph navigation | Mounted second-paragraph, null, lower/upper clamp, empty paragraph, missing section and heading controls |
| Supported nested heading/list/blockquote boundaries | Helper exact ranges in both schemas and mounted ranges, strikes, widgets and AI highlights |
| Combined Unicode/break preview without mutation, explicit replaceRange with active decorations | Mounted full JSON before/after, no updates before flush, bold prefix and italic suffix preserved |
| Clearing removes strikes, insertion widgets and AI highlights | Mounted container-scoped assertions |
| No public API/schema/backend/persistence changes | `final.diff` and source hashes; changes restricted to helper, narrow Editor extraction and tests |

Final focused checks passed: 40 helper tests, 18 mounted Editor tests, Svelte checking with zero errors and zero warnings, benchmark, and `git diff --check`. Commands and process exit codes are recorded in `commands.jsonl`; `run.py` captures combined stdout/stderr into phase-specific raw logs.

`benchmark-comparison.json` asserts the same ordinary position digest (`97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397`) and 30 traversals for 30 iterations in both 22,790- and 91,490-character fixtures, before and after. Final medians were 3.99 ms and 15.39 ms versus baseline 3.42 ms and 13.44 ms. Timings are descriptive; the additional mapping pass is linear and independent of needle count. This benchmark is synthetic helper/decoration CPU evidence, not production latency evidence.

AI highlight writer and caller inventory:

- `highlightText` writes ranges from `findAllInDoc`. CurrentProjectPage and PreviewProjectPage pass chat reference text to it.
- `highlightRange` writes the supplied range/text. Both project pages pass actual `findReplaceMatches` results during proposal review start and stepping.
- `locateSectionParagraph` writes the selected nonempty paragraph. Both project pages call it from QA gap navigation.
- `clearHighlight` and the click handler only clear AI state; the initial state is empty. No other Editor writers exist. See `highlight-writers.txt` and `highlight-callers.txt` for exact source locations.
- CandidateSelection uses the independent ReadOnlyEditor navigation consumer. Its schema shares `getEditorExtensions({ editable: false })`; that consumer's search/navigation implementation remains outside this spec's allowed scope.

The parent still owns fresh independent review, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, staging and shipping. Those steps have not been represented as complete. The existing duplicate `underline` extension warning appears in baseline and passing mounted runs; schema/dependency changes are outside this task.

The broader `npm run test:component` also passed: 481 tests across 63 files (`verified-component-all.log`). Its nine regenerated historical PNG files were copied into `component-suite-generated/` and restored to their initially clean HEAD bytes. `historical-screenshot-restoration.json` records original/generated sizes and hashes. No earlier B13/B13-r1 artifacts changed. The redundant body cleanup added in the preserved boundary describe block was removed because vitest-browser-svelte already registers cleanup; the final 18-test focused rerun is retained in `final-tests-component.log`.

Parent final review found no new edge defects or verification gaps. Three small test patches add explicit block presence and post-apply decoration disappearance, and clarify the list-item fixture title. Earlier worker final hashes remain historical; root-reviewed-source.json will bind the final patched state and parent gate.

Parent final nine-step gate passed: 2,020 unit tests, 481 browser tests, both typechecks, production build, discovery and 50 PowerShell/18 shell harness assertions. `gate/result.json` verifies 5,147 tracked paths with no unexpected source changes. `root-reviewed-source.json` matches final source. `native-closure.json` records native closure of DW-101/DW-102 while preserving all other 100 entries. All three review rounds and both independently executed defect probes remain archived.
