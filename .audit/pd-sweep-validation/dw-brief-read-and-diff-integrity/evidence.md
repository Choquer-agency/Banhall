# dw-brief-read-and-diff-integrity (DW-107, DW-118): before/after evidence

Status note: this bundle's review stalled and it was never natively accepted. Spec frontmatter says `followup_review_recommended: true`. The 3 review-patch tests were never independently reviewed (spec, "Follow-up review recommendation").

## Commits
- Fix: `90215c0` (90215c08b505fb27a5c438a4f8ded8e8a645f872)
- Baseline (first parent): `7b0723b` (7b0723b18cd19fe6e90f9216ff6272674edf2006)
- Final head: `e22a4b4`
- Test files: `convex/ai/brief.test.ts`, `convex/ai/promptProgram.test.ts`. At the fix commit their sha256 are `02b56df1…` and `731b52bf…`, which match the "final bytes" the spec records.

## Environment
- Worktree `.factory/worktrees/pd-validate-a`, `npm ci` exit 0 (`../npm-ci.log`). The package lock and `vitest.config.ts` are the same from `7b0723b` to `e22a4b4`.
- node v22.22.3, vitest 4.1.10, `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`, `PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site` (the loop-verify preflight defaults).
- Runner: `../run-phase.sh`. It runs `git reset --hard`, then `git checkout --detach <ref>`, then optionally `git checkout <fix> -- <tests>`. It then runs `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<phase>.json <tests>` and returns to `e22a4b4`. Each log header records the HEAD, the test sha256 values and git status.

## Results
| Phase | Tree | Result | Log |
|---|---|---|---|
| before | 7b0723b + 90215c0 tests | 29 failed / 29 passed (58), EXIT 1 | before.raw.log |
| before-constshim | as above, plus the missing constant imports inlined in the tests (500/200/4 MiB) | 28 failed / 30 passed (58), EXIT 1 | before-constshim.raw.log |
| after-fix | 90215c0 | 58 passed, EXIT 0 | after-fix.raw.log |
| after-head | e22a4b4 | 61 passed, EXIT 0. The 3 extra tests are DW-112's. | after-head.raw.log |

Comparisons: `comparison.txt` (before vs after-fix vs head) and `constshim-comparison.txt`.

**Shim (test-side only, uncommitted, reverted).** At 7b0723b, `MAX_BRIEF_ENTRY_ROWS`, `MAX_BRIEF_SOURCE_ROWS` and `BRIEF_BASELINE_PAGE_BYTES` are not exported. They import as `undefined`, so the seeding loops (`i < MAX+1`) seed nothing. In the plain `before` run, several "over-bound" tests therefore fail without exercising overflow at all. The shim replaced those import lines with `const` definitions that use the 90215c0 values. That separates behavior failures from missing-symbol failures.

## The 29 discriminating tests (fail before, pass after-fix and at head), by strength

### A. Behavior-level: 9 tests
Each still fails with a behavioral assertion at baseline with the shim applied, and passes after.
1. `recovers an over-bound newest Brief on the next changed-input derivation`. This runs only through `generateReport`. At baseline v3 has 512 rows instead of 522 (`expected [ '0000:added', …(511) ] to deeply equal [ …(521) ]`), which is consistent with the 7b0723b `take(500)` baseline prefix. This is the DW-107 diff-baseline proof.
2. `renders only live evidence, byte-identically to the Brief the ordered chain checks against`. A removed-marker text renders at baseline (DW-118, render side).
3. `refuses a source read above MAX_BRIEF_SOURCE_ROWS; the generation completes with no Brief`. `NO_ERROR` vs `INVALID_STATE`: 201 sources are silently read as a prefix (DW-107).
4. `omits an over-bound Brief from both prompt readers instead of throwing`
5. `reuses an already-over-bound Brief onto a new generation, and both readers omit it`
6. `omits a Brief whose live rows alone are under the bound but whose markers push it over`
7. promptProgram: `omits an over-bound Brief from the ordered chain: every section drafts, none is left queued`
8. promptProgram: `omits an over-bound Brief from iterative's own section and from its one-shot ghost`
9. promptProgram: `iterative's one-shot ghost still drafts every section with the stored Brief block (story 1 wiring)`. The removed exclusion text reaches the ghost prompt at baseline (DW-118).

### B. API-shape (compile-level) only: 19 tests
They fail at baseline only because the new API does not exist. This is weaker evidence.
- `publishDerivedBrief is not a function` (16): does not re-insert a removed marker…; never carries the previous version's storylineQuestion rows forward…; persists an oversized derivation in full…; reads a Brief of exactly MAX_BRIEF_ENTRY_ROWS completely… (with the shim; without it the failure came from the constant); stamps a returning key `added`…; treats a previous version whose rows are all filtered out…; re-reads and re-publishes when a writer edit lands…; gives up after BRIEF_PUBLISH_ATTEMPTS lost fences…; writes nothing when a baseline page read fails part-way…; marks a retained baseline row removed…; aborts the whole publish with INVALID_STATE…; keeps the last baseline row for a diff key duplicated across pages…; stamps the first validated duplicate candidate unchanged…; stops without publishing when a one-row page still needs a split…; re-reads a byte-heavy baseline page smaller after SplitRequired… (with the shim); sends no retained baseline text….
- `Validator error: Unexpected field baselineBriefId` (3): the two tenant cases `persistDerivedBrief drops a candidate entry whose source belongs to a different project/generation` and `… different generation in the same project`, plus `diffs against every live row of an over-bound baseline, and a stale fence writes nothing`.

### C. Failed only because of the missing constant: 1 test
- `reads exactly MAX_BRIEF_SOURCE_ROWS frozen sources completely, without refusing`. It passes at baseline with the shim, so it is a non-discriminating boundary guard.

## Non-discriminating: 29 tests
They pass both before and after: the pre-existing story-1 derivation, editing and promptProgram tests (list in `comparison.txt`). They are regression guards only.

## Acceptance criteria → tests
| AC | Test(s) | Before-proof strength |
|---|---|---|
| AC1: 820+question newest Brief via generateReport; changed-input v3 is exactly unchanged/added/removed; priors byte-identical | `recovers an over-bound newest Brief…` | Behavior (fails at baseline on the 500-row prefix) |
| AC2: recovered version as newest; next derivation diffs live rows only; `renderBriefForGeneration` renders it | same test (v4 section) | At baseline the test fails before reaching v4, so v4 has after-only proof |
| AC3: same regression fails on the "adopted attempt-1 bytes" with no `briefId` | none reproducible | GAP. Attempt-1 bytes were never a commit. The cited logs under `.audit/dw-brief-read-and-diff-integrity/attempt-2/` are not in the tree at e22a4b4, and neither is `.audit/resume-sweep-20260912T194000Z/`. The 7b0723b before run fails for a different reason (prefix diff, not lockout). |
| AC4: writer edit between pin and publish; baseline moves every attempt → throws; failing page read writes nothing | `re-reads and re-publishes when a writer edit lands…`, `gives up after BRIEF_PUBLISH_ATTEMPTS…`, `writes nothing when a baseline page read fails part-way…` | API-shape only |
| AC5: SplitRequired page discarded, every live row reaches the diff | `re-reads a byte-heavy baseline page smaller after SplitRequired…` | API-shape only |
| AC6: argument < 16 MiB measured via `convexToJson` | `sends no retained baseline text…` | API-shape only. The pre-P1 red bytes are not a commit, and the cited log is not in the tree. |
| AC7: `bash scripts/loop-verify.sh` passes | not run (out of scope for this worker) | GAP (scope) |

## Gaps and findings
- **DW-118 diff side has no behavior-level before proof.** Every marker-accumulation and question-carry-forward test calls `publishDerivedBrief`, which does not exist at baseline. Only the render side of DW-118 (tests A2 and A9) is proven behaviorally.
- **Cited evidence is not committed.** The spec's evidence directory `.audit/dw-brief-read-and-diff-integrity/` is absent from the tree at e22a4b4. None of its red/green claims can be re-checked from git.
- **Head changed the fixture.** At head, `brief.test.ts` differs from the fix commit (sha `0baa06d4…` vs `02b56df1…`). DW-112 (f5f27ae) changed the `derive` fixture to use a unique `inputsHash` per call and renamed the at-bound re-derive hash. Run with the 90215c0-era fixture against the DW-112 source, 10 of these DW-107 tests fail (see `../dw-brief-derivation-concurrency/fix-source-with-pre-fix-tests.raw.log`). The DW-107 tests that pass at head therefore exercise changed-input derivations only.
- **Deferred risk recorded in spec frontmatter.** Assertions on prompts in `brief.test.ts` are unreliable because of leftover scheduled jobs sharing the Anthropic mock. The source-overflow case still asserts `briefCalls()` has length 0 (at head, inside that test near line 1512).
- No flaky behavior was observed in the single run of each phase.
