# Code quality sweep results

**IN PROGRESS.** Snapshot: 2026-09-05. Five of the eleven sweep tickets are marked done; six remain pending. This draft records completed changes and their evidence, not final approval of the combined branch. No final CI or live end-to-end outcome is claimed.

The sweep found useful tests outside the normal runner, unused code, repeatable parser/editor/database waste, and verification instructions that no longer matched the app. The completed work removes nine abandoned components, unused helpers and four dependencies, and reduces work in three measured paths. The remaining tickets address the test inventory, further deletions, the failing browser baseline, and the shared verification command.

## Completed changes

| Ticket | Result | Recorded proof |
| --- | --- | --- |
| `perf-1-parser-timers-editor-index` | Clears deadline timers after settlement; builds one editor search index per proposal batch and none for empty batches. | Baseline-failing timer/count assertions, preserved match ranges, repeated CPU benchmark, and four passing Chromium/Tiptap component cases. Evidence: `.audit/perf-1-parser-timers-editor-index/evidence.md`. |
| `perf-2-empty-upload-reads` | Empty and whitespace-only uploads skip the existing-document scan. Nonempty dedupe and authorization stay unchanged. | Actual registered Convex mutation, public transaction metrics, two runs before and after, baseline-failing named regression test; 35 targeted tests pass. Evidence: `.audit/perf-2-empty-upload-reads/evidence.md`. |
| `slop-1-dead-components` | Deletes nine unreachable component files: **810 lines removed, zero inserted**. Live comment and editor components remain. | Reference sweep, build and gate pass; the same nine component suites and 24 cases pass before and after. Evidence: `.audit/slop-1-dead-components/evidence.md`. |
| `proof-1-parser-budget-sequence` | Corrects the existing parser fixture to prove sequential 20/40-second phases and the cumulative 60-second deadline; clarifies one Editor test title. | Eager negative control fails at the intended assertion; parser 19/19, Editor 4/4 and the full gate pass. No new tests or production changes. Evidence: `.audit/proof-1-parser-budget-sequence/evidence.md`. |
| `slop-2-dead-helpers-and-deps` | Removes unused helpers, four unused dependencies and duplicate Underline registration: 220 production lines and 135 net test lines removed; 144 lockfile package entries removed, none added or upgraded. | 8 retained unit cases and 33 browser cases pass; clean install, build and actual editable/read-only underline proof pass independently through the engine. QA test-verified; its operator note is closed by engine and root evidence. Evidence: `.audit/slop-2-dead-helpers-and-deps/evidence.md`. |

## Measured performance

| Measurement | Before → after | Limits |
| --- | --- | --- |
| Editor document traversals, 20 proposal pairs × 30 preview builds | **600 → 30**, a 95% reduction; empty batches use zero. | Synthetic Node CPU harness on real Tiptap documents, both 22,790 and 91,490 characters. Match-position hash identical. |
| Median CPU time per preview build, two runs | 22,790 chars: **62.82 / 60.59 → 3.49 / 3.53 ms**. 91,490 chars: **251.77 / 252.33 → 14.00 / 14.07 ms**. | Contextual timings, not production browser latency or INP. Stable criteria are traversal count and preserved output. |
| Pending timers after successful parsing | Three-page PDF path: **7 → 0**. Separate deadline-helper benchmark, 201 completed operations: **201 → 0**. | Fake timers and mocked `pdfjs-dist` boundary; no real-PDF browser proof. Error identity and cleanup paths are also tested. |
| Empty upload with three existing 100,000-character documents | Queries **3 → 2**; documents read **5 → 2**; bytes read **301,074 → 375**. | Local `convex-test` mutation metrics, two identical runs each; no network latency measurement. Result remains `reference_only`. |
| Empty upload with no existing documents | Queries **3 → 2**; documents read **2 → 2**; bytes read **375 → 375**. | Same local fixture. Fixed read cost is equal across the zero- and three-document corpora; nonempty uploads still scan. |

Editor measurements compare `184d376` with `f82f2b0`; the baseline source matches the sweep starting revision `11bfe3e`. Upload measurements compare `9d7f102` with production change `18f383c`; the baseline `convex/documents.ts` hash also matches `11bfe3e`. These are the measured revisions, not a claim about the final integration revision.

The parser proof correction is complete: the original fixture eagerly started two 20-second promises together; `proof-1` now starts page text lazily and proves sequential 20/40-second phases before the absolute 60-second deadline. Its eager negative control fails at the intended phase assertion. QA independently reran the passing suites and inspected the recorded negative control, but could not make its own temporary eager edit under the allowlist. The production optimization is unchanged. Editor browser tests mount real components and call their exported functions; they are component integration evidence, not an authenticated user journey.

## Pending tickets

| Ticket | Remaining outcome |
| --- | --- |
| `slop-3-mywork-island` | Remove eight files belonging to retired My Work presentation and its tests. |
| `tests-1-one-runner` | Bring useful orphan pure tests into Vitest with an explicit mapping for retired coverage. |
| `tests-2-real-proposal-access-roster-tests` | Replace handmade database scenarios with real Convex endpoint/row fixtures. |
| `tests-3-runner-cleanup-and-guard` | Remove Bun-only runner remnants and prove every tracked test is discovered. |
| `ui-1-component-suite-green` | Resolve seven stale browser assertions/fixtures; measure the mobile header target and fix it if below the 44px contract. |
| `dx-1-one-verify-entry` | Add preflight and timed named steps, discovery guard and production build to the shared gate; wire CI and browser smoke; correct setup/environment/worktree docs. |

## Verification baseline and final closeout

At `11bfe3e`, the existing gate passed in **55.841 seconds**: 128 unit-test files / 1,413 tests, clean typechecks, and uploader harnesses with 50 PowerShell plus 18 Bash passes. The standalone browser baseline failed: **281 passed / 8 failed across 51 files**, 50.988 seconds wall time. The 14 orphan Bun suites were separate: 105 passed / 11 failed, so blanket deletion would discard useful coverage. Logs and triage are in this plan's `gate-baseline.log`, `component-baseline.log`, `uploader-baseline.log`, `slop-audit.md`, and `dx-audit.md`.

The completed perf-2 and slop-1 ticket gates each report 129 unit-test files / 1,430 passing tests. The perf-1 full browser run still reproduced all eight original failures. Slop-1's production build passed with both public Convex URL placeholders. These ticket results do not replace the final combined checks below.

| Final field | Status to fill at closeout |
| --- | --- |
| Integration revision and completed ticket count | Pending |
| Combined diff summary and retained/deferred inventory reconciliation | Pending |
| Fresh-dependency bootstrap and default shared gate: exit, duration, test counts, build | Pending; exercise the actual script with local node_modules absent after all tickets finish |
| Full component gate: exit, duration, counts, mobile geometry evidence | Pending |
| Discovery coverage and missing-tool/browser preflight proofs | Pending |
| Independent review, QA verdicts and unresolved findings | Pending |
| CI run and delivery status | Pending; distinguish local validation from observed CI |

## Deferred work worth pursuing

Full document-body reads and nonempty dedupe need a content-hash/index design and backfill; project/industry facets and generation usage totals need maintained projections or compound indexes. Prove these against larger seeded local corpora before changing schemas. The route also includes both current and preview project shells: the recorded static closure is **1,976,926 raw / 573,265 gzip bytes**. Lazy-loading the rollback surface needs a restoration-behavior decision and repeatable build/browser measurements; those bytes are not observed network transfer.

A disposable local Convex/auth end-to-end harness is feasible without shared credentials. It still needs an owned backend launcher, private ports/storage/environment, generated local secrets, finite inviter/invitation fixtures, real signup plus a persisted-data browser journey, evidence capture and cleanup. Full AI generation additionally needs a controlled provider fixture or separately supplied credentials. No such harness has been built in this sweep; `.factory/verify` remains follow-up implementation work. Component tests and in-memory mutation tests do not establish the full cookie, subscription and persisted-write chain.

Other scoped deferrals are recorded in `research.md` and ticket evidence, including the independent `ReadOnlyEditor` search implementation and authorization/public-query cleanup that requires its own test migration. These remain findings, not completed fixes.
