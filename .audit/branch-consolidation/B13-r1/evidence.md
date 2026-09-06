# B13 iteration 1 implementation evidence

Baseline: `1d6053388326fe4fde43a86177955157f11ce588`. The full spec and its sole frontmatter context file, `AGENTS.md`, were read before changes, along with `.factory/AGENTS.factory.md`, schema configuration and editor conventions. The spec governs worker scope. Only the four allowed source/test files were changed; evidence is local and unstaged in this directory. No installation, reviewer dispatch, staging, commit, shipping, other-worktree changes or ledger/state edits.

## Changes and acceptance

- `docSearch.ts`: retain the raw index shape; index actual `hardBreak` nodes as pending whitespace. One authoritative whole-string lowercase plus a linear code-point length pass maps folded units to complete original UTF-16 spans. Filter each needle's mapped candidates against its last accepted exclusive end, keeping the first non-overlapping original span.
- `extractMatchedText`: hardBreak-only space callback with the existing leafText fallback for other leaves. Shared by batch matches, AI validation, exact/fragment return construction, and paragraph return construction. Lookup, significant-word ranking and legacy drift fallback remain unchanged.
- Actual editable and read-only schemas cover prefix/end/partial/repeated Unicode expansion, overlapping mapped spans, supplementary characters and malformed surrogate needles, contextual sigma across marks/breaks/paragraphs, repeated boundaries, horizontal rules, actual casing and raw index shape. All existing golden literals, duplicate/blank slots and one-walk/one-whole-fold controls remain.
- Mounted Editor JSON tests cover exact ranges, preview strikes/widgets and hard-break spans, visible highlightRange, exact/fragment/paragraph highlightText, untouched serialized prose during preview and explicit replaceRange producing `İ result tail`. DOM assertions use the mounted container; combined clearing checks remove strikes, widgets and AI highlights. Existing sorting, smart-case and caller traversal guards remain.

## Reproduction and preservation

All four preserved snapshot SHA-256 values were verified against `../B13/rederive-preservation.json` before copying. Tests were restored first, with iteration-1 regressions added before production changes. `baseline-hashes.json` identifies the original four source files. The original six mounted tests passed before touching components.

- Baseline with new tests: 22 helper failures / 14 passes; 6 mounted failures / 7 passes. Raw expected/received ranges, text, stack locations and failure screenshot paths are in `before-helper.log` and `before-component.log`.
- Preserved B13 production source with the same tests: 2 helper failures / 34 passes and 1 mounted failure / 12 passes. `preserved-helper.log` shows extra overlapping original ranges 2..4 and 4..6 for repeated İ; `preserved-component.log` shows the earlier paragraph's `alphabeta` span receiving the AI highlight. These were captured before the iteration-1 production correction.
- Final: 36 helper tests and 13 mounted tests pass. Verbose logs identify every control, including all preserved 30 helper and 9 mounted behaviors.
- `probe.mjs` is an owned adaptation of the read-only baseline probe. It compiles the actual helper at baseline and current source, constructs both actual schemas, asserts final expected ranges and records complete fixtures, raw indexes, before/after ranges and source hashes in `results.json`. All 10 fixture/schema combinations pass. It does not claim browser or backend persistence evidence.

## Commands and exits

All commands ran from the repository root. Output redirection targets are listed below. The Vitest commands use the existing installation with no dependency changes.

| Command | Phase / output | Exit |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | baseline-component.log, original tests | 0 |
| `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | before-helper.log, original source with new tests | 1 |
| Same helper command | preserved-helper.log, verified B13 snapshots | 1 |
| Same mounted command | before-component.log, original source with new tests | 1 |
| Same mounted command | preserved-component.log, verified B13 snapshots | 1 |
| Same helper command plus `--reporter=verbose` | after-helper.log | 0 |
| Same mounted command plus `--reporter=verbose` | after-component.log | 0 |
| `node scripts/bench/editor-search.mjs` | before-benchmark.jsonl and after-benchmark.jsonl | 0, 0 |
| `node .audit/branch-consolidation/B13-r1/probe.mjs` | results.json and probe.stderr.log | 0 |
| `npm run check` | check.log; missing PUBLIC_CONVEX_URL in environment | 1 |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` | check-with-placeholders.log | 0 |
| `git diff --check` | diff-check.log, empty output | 0 |

The check with documented placeholder values reports zero errors and warnings. No configuration workaround was made. Existing duplicate Underline extension warnings remain visible in test/probe logs and are outside scope.

The ordinary 22,790-character and 91,490-character fixtures retain digest `97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397` and exactly 30 descendant traversals for 30 batches, each containing 20 pairs. `benchmark-comparison.json` records an asserted equality check. Median CPU times were 3.35 to 3.95 ms and 13.27 to 15.91 ms in this run; these are descriptive costs of the additional linear mapping, not thresholds. Final sources are identified in `final-hashes.json`.

## Remaining integration work and limits

The authorized worker implementation is complete. Per the spec, parent owns fresh independent review, final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, staging and shipping. That final integration gate was not run here. Mounted proof exercises actual Editor behavior and serialized onUpdate output, not a backend persistence flow. The independent ReadOnlyEditor search consumer is deliberately outside scope; both schemas were exercised through the repaired helper.

The audit directory is ignored by Git and remains on disk for parent pickup. Existing B13 raw history was preserved. No historical tracked screenshot changes appeared in `git diff`; baseline failure screenshots were copied into this owned audit directory.

Parent inspected the four-file diff, matrix cases, preservation receipts and exact final source hashes before independent review. The five-column worker decisions.tsv is an auxiliary work note; the canonical append-only six-column task trail remains ../decisions.tsv.
