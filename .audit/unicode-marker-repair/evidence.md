# Unicode metadata marker repair evidence

Baseline: `c7075572f14e51433b524026db55d5520eddde03` on `codex/bmad-unicode-fix`.

The regression was added and run before production code changed. The real generation builder failed 19 tests, with 44 passing, on the baseline production implementation. `red.log` records this output. Its failures cover every supported Unicode dash, mixed/longer runs, both metadata entry points and a folded Unicode separator case. The ASCII-run and ordinary name cases passed already.

Setup: physically cloned root node_modules and copied _bmad into this worktree. The first test run failed to import because `.svelte-kit/tsconfig.json` was absent; preserved as `setup-failure.log`. `npx svelte-kit sync` generated local configuration successfully (`setup.log`); this was setup, not a typecheck.

Commands:

- `npx vitest run convex/ai/trustedContext.test.ts` -> exit 1, 19 failed / 44 passed (`red.log`).
- `npx vitest run convex/ai/trustedContext.test.ts convex/ai/chatEvidence.test.ts convex/ai/contextBoundary.test.ts` -> exit 0, 139 passed across 3 files (`green.log`).
- `git diff --check` -> exit 0.

Matrix coverage:

| Requirement | Tests |
| --- | --- |
| Each supported dash, mixed/longer filename markers | `prevents filename markers with dash run %s` (10 cases) compares all prompt marker tokens against benign builder output, plus client trust, raw provenance label and body containment |
| Multipart transcript-label markers | `prevents multipart transcript-label markers with dash run %s` (10 cases) covers END and BEGIN, case folding and mid-label placement; asserts genuine body boundaries and unchanged raw provenance |
| Ordinary names | `preserves ordinary single and double dashes %s in Unicode filenames` (8 cases) |
| Line folding and empty fallback | `folds metadata line separators and retains the empty-name fallback`; existing filename separator cases |
| Existing content/chat behavior | Existing trusted-context marker tests, chat Unicode filename case and fixture-driven contextBoundary suite |

These tests prove formatting containment for the supported marker grammar, not actual model obedience. Prompt constants, trust policy, bodies, budgets and provenance metadata are unchanged. Full-suite/typecheck gates remain root-owned and are intentionally not claimed here.

## After independent review

Root supplied blind, edge and verification-gap reviews, preserved in `review-blind.md`, `review-edge.md`, and `review-gap.md`. Triage is recorded in `review-triage.md`. No production correction was requested by review; five focused test improvements were accepted.

`npx vitest run convex/ai/trustedContext.test.ts convex/ai/chatEvidence.test.ts convex/ai/contextBoundary.test.ts` returned exit 0 with **152 passed across 3 files** (`review-green.log`). The original red failure output is retained; terminal-only trailing blank lines were removed from committed logs to satisfy whitespace checks. `git diff --check` returned exit 0 after the review changes.

The final candidate is deliberately **in-review** pending root's native full verification. Historical deferred ledger IDs are not closed by this commit.
