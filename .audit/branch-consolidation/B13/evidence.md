# B13 implementation evidence

Baseline: `1d6053388326fe4fde43a86177955157f11ce588`, matching the assigned spec. Frontmatter context AGENTS.md and its factory reference were read before implementation. The spec governs scope and parent ownership. Source hashes before test/source edits are in baseline-sha256.txt; final source/test hashes are in final-sha256.txt.

## Changes and acceptance

- docSearch.ts retains the raw normalized index, folds the whole haystack once, then maps folded units to original complete code-point start/exclusive-end spans in one linear pass. Isolated lowercase output is used only for lengths; contextual sigma remains authoritative. No per-needle mapping work or prefix folding.
- Supported hardBreak nodes set the existing pending separator. Shared extractMatchedText represents only hardBreak as a space and preserves other leaves' leafText fallback and existing block separators.
- Editor.svelte imports that extraction only for AI range validation. Fallback/drift search is unchanged.
- Tests use getSchema(getEditorExtensions({editable})) for both true and false. They cover shifted and lost target matches, expansion inside/partial matches, sigma across bold marks, supplementary emoji and Deseret, repeated breaks/whitespace/empty paragraphs, horizontalRule extraction, blank/duplicate slots, and actual traversal counts. Original golden tests remain unchanged. A single-code-point fold guard was added after the production repair as an additional control.
- Mounted tests use actual Tiptap JSON. Exact target ranges drive preview strikes, cross-break range/text drive visible AI reference decorations including the BR, preview spans include the BR, and flushPendingSave returns identical original JSON. Existing sorting, smart-case, duplicate identity and 20-pair traversal controls remain passing.

## Baseline versus repaired behavior

Before production edits: original mounted suite 6/6 passes; new mounted cases 3 fail with the 6 controls passing. Helper suite with new cases has 14 failures and 14 passes. The first repeated-boundary expectation miscounted positions and spaces; direct ProseMirror node positions/textBetween established beta17..21 and seven interior spaces. Corrected fixture was rerun against unchanged production source and still failed; both raw runs are retained. No failing assertion was skipped.

After repair: helper 30/30 passes; mounted Editor 9/9 passes. The JSON probe records 8/10 baseline expectations failing and all 10 repaired expectations passing. It retains an additional pre-B2 cc6b706 comparison; the current-source before snapshot is the assigned post-B2 baseline, with hashes proving its identity. Probe exit 0 means execution success; matchesExpectation fields establish correctness.

Exact baseline failures include target3..9 becoming4..11 with text `arget t`, a missing trailing target, and alphabeta falsely spanning1..11. Repaired output is target3..9 and cross-break alpha beta1..11 with space-preserving text; alphabeta returns no match.

Both benchmark fixture position digests remain `97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397`. Both retain 30 document traversals for 30 batches of 20 needles. Median times were 3.39 → 3.92ms (22,790 chars) and 13.27 → 15.41ms (91,490 chars); timing is descriptive, not a threshold. The extra linear mapping adds CPU/allocation overhead while retaining B2 batching.

## Commands and exits

All commands ran in the assigned checkout. stdout/stderr is captured in the matching .log, .jsonl, or .json/.stderr files. Exact exit codes are also retained in .exit files.

| Artifact prefix | Command | Exit |
| --- | --- | --- |
| component-original | `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 0 |
| helper-before | `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 1 |
| helper-before-corrected-fixture | `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 1 |
| component-before | `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 1 |
| helper-after | `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 0 |
| component-after | `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 0 |
| bench-before | `node scripts/bench/editor-search.mjs` | 0 |
| bench-after | `node scripts/bench/editor-search.mjs` | 0 |
| probe-before | `node .audit/branch-consolidation/B13/probe.mjs` | 0 |
| probe-after | `node .audit/branch-consolidation/B13/probe.mjs` | 0 |
| check | `npm run check` | 1 |
| check-with-placeholders | `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` | 0 |
| diff-check | `git diff --check` | 0 |

## Limits and handoff

Plain npm run check encountered missing PUBLIC_CONVEX_URL exports in two unrelated files because the environment was unset. The placeholder rerun follows repository preflight convention, without changing configuration or dependencies. Existing duplicate Underline warnings remain outside B13 scope.

No installation, staging, commits, reviewers, shipping, ledger/state changes or other-worktree edits. No historical screenshot changes were produced. Changes are unstaged. B13 audit files are ignored by repository rules and remain on disk for parent collection. The pre-existing untracked spec is untouched. Parent still owns fresh independent review, final VERIFY_COMPONENT=1 bash scripts/loop-verify.sh, staging and shipping; focused evidence here is not final integration acceptance.
