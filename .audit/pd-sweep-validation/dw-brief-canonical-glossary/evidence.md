# dw-brief-canonical-glossary (DW-113): before/after evidence

- Fix commit: `750842f5897deacd04ba15519a6aa640a8660fce`. Baseline (first parent): `f5f27ae1dcbaf0cf3712530ffbf4bd1212561112`. Final head: `e22a4b49c54252cc53010d36ea001bd13fc1b179` (ancestor check passed; `convex/ai/brief.test.ts` is identical at the fix and the head).
- Production change: one line in `convex/ai/brief.ts` (`text: match.text` became `text: match.canonicalTerm`).
- Worktree: `.factory/worktrees/pd-validate-b`, after `npm ci` (exit 0). Node v22.22.3, vitest v4.1.10.
- Env: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`, `PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site` (the preflight placeholders from `scripts/loop-verify.sh`).
- Wrapper: `../../run.sh`. Each raw log header records HEAD, `git status --short`, the env and the exact command:
  `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<label>.json convex/ai/brief.test.ts`

## Runs

| Log | Tree | Exit | Result |
|---|---|---|---|
| `before.raw.log` | baseline f5f27ae plus the fix-commit `brief.test.ts` overlay (status shows `M convex/ai/brief.test.ts`) | 1 | 2 failed / 37 passed / 39 |
| `after-fix.raw.log` | 750842f, clean | 0 | 39 passed / 39 |
| `after-head.raw.log` | e22a4b4, clean | 0 | 39 passed / 39 |

## Discriminating tests (fail before, pass after): 2

1. `derives Storyline, Claim Exclusions, Confidence Map and Glossary Terms, each citing a frozen source`. The baseline fails at `brief.test.ts:253` with `expected 'algorithms' to be 'algorithm'`. This is a behavior-level failure: the rule-path entry stored the surface form.
2. `re-derives on changed inputs and stamps change: added | unchanged | removed`. The baseline fails at the `toContainEqual(objectContaining{group:'glossaryTerm', text:'algorithm', exactExcerpt:'algorithms'})` assertion. This is also behavior-level.

Neither failure is at compile or import level. The baseline has every symbol the test uses.

The other 37 tests are non-discriminating for DW-113. That is expected, because they are pre-existing Brief tests the fix left alone.

## AC to test map

| AC | Test | Discriminating? |
|---|---|---|
| AC1: an inflected-only rule match stores the canonical term, with the exact excerpt and offsets reproducing the inflected bytes | Test 1 above (text/exactExcerpt/offsets/source-slice assertions). Test 2 covers the removed-marker identity. | Yes |
| AC2: a model-classified synonym keeps the canonical term and synonym excerpt bytes | `classifies a flagged glossary candidate via the same call's own quote — no second model call` (asserts `text === "control loop"`, `exactExcerpt === "closed feedback mechanism"` and the source slice) | No. It passes at the baseline, which is correct for a preservation AC. |
| AC3: the focused test and `loop-verify.sh` pass with no schema, generated-file or ledger edits | No automated test; this is a process AC. The fix commit's file list touches only `brief.ts`, `brief.test.ts`, `.audit/`, the spec and the ledger. The full gate was not run here, on instruction. | n/a |

## Gaps and notes

- The spec itself records that the original failing control had no raw capture. `before.raw.log` now provides a reproducible raw baseline failure for the committed test.
- `brief.test.ts` mocks `@anthropic-ai/sdk` with `vi.mock` (line 57). That is acceptable here, because DW-113 does not change the SDK boundary.
- Existing reused Brief rows keep the surface text (documented residual). No test covers that, and no backfill is in scope.
