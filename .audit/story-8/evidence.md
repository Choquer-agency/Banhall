# Story 8 implementation evidence

## Scope and revision

- Sole implementation contract: `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/8-admin-learning-health-page.md` and its approved rerank-measurement companion.
- Baseline revision: `64ee37c8d7498318232f6367b55c7f638e8b830e`.
- Historical implementation-stage note: implementation was then uncommitted pending independent review. The completed review and exact committed revision are recorded below. No push, PR, deployment command, forbidden-file edit, PED formula change, or native-ledger edit was performed.
- Required frontmatter context was loaded before implementation. Existing canonical component baseline passed before component edits: 59 files, 428 tests ([component-baseline.log.gz](component-baseline.log.gz)).

## Implemented behavior

`convex/learningHealth.ts` owns one admin-only read query and a private idempotent operational recording mutation. Global indexed PED/generation/outcome windows and every source join use cap+1 detection. Candidate, report and review populations each share a total join budget across the whole query. Passage processing has a shared budget. Responses expose the exact bounds, caps, truncated populations, source and score missingness, earliest recorded observation and best-effort coverage.

`convex/ai/brain/retrieve.ts` records one terminal outcome through the separately guarded `convex/lib/rerankTelemetry.ts`. Existing provider retries, eligibility, billing attribution, returned values and fallback control flow remain in place. The public metric uses fallback / (success + fallback); skip and overall search failure observations remain separate.

The actual `/admin/learning` page owns its auth/query lifecycle inside the unchanged `AdminWorkspacePage`, with 30/90 controls, refreshed explicit clock, echoed-window stale-result protection, accessible daily SVG/table, native score scales, measured counts, partial/empty/error states, and existing rail/current-presentation navigation.

## Executed verification

| Command | Result | Evidence |
|---|---|---|
| `npx convex codegen` | Exit 0; supported bindings generated | [codegen.log.gz](codegen.log.gz); installed CLI `node_modules/convex/src/cli/codegen.ts:18` documents no change to running deployment code |
| `npx vitest run convex/learningHealth.test.ts convex/ai/brain/retrieve.test.ts convex/ai/brain/retrieveOutcomes.test.ts` | 3 files, 32 tests passed | [metrics-retrieval-tests.log.gz](metrics-retrieval-tests.log.gz) |
| `npm test` | 152 files, 1,952 tests passed | [unit-tests.log.gz](unit-tests.log.gz) |
| `npm run test:component` | 60 files, 443 tests passed | [component-final.log.gz](component-final.log.gz) |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` | 0 errors, 0 warnings | [svelte-check.log.gz](svelte-check.log.gz) |
| `npx tsc -p convex/tsconfig.json --noEmit` | Exit 0, no output | [convex-typecheck.log.gz](convex-typecheck.log.gz) and executed PTY completion |
| `git diff --check` | Exit 0 | Executed command output |
| `shasum -a 256 -c .audit/story-8/ledger-baseline.sha256` | `_bmad-output/implementation-artifacts/deferred-work.md: OK` | Original `ledger-baseline.sha256` retained |

Initial backend fixture failures (missing required project fixture fields) and existing rail destination-count assertions were corrected before these passing runs. No failing check remains from those runs. Historical test-generated PNG changes were restored only against their original recorded hashes; `historical-screenshots-before.json` records that baseline and `historical-screenshots-restored.json` verifies all 55 original hashes. The final focused actual-page suite also passed 12/12 after cohort-copy and screenshot-framing corrections ([ui-tests.log.gz](ui-tests.log.gz)).

## Matrix and acceptance mapping

All listed test files execute real framework paths. Backend queries use `convex-test` storage, indexes and authorization; retrieval tests mock only external RAG/provider boundaries and run the real SDK retry/routing logic. Browser tests mount the actual route and real shared shell with auth/Convex transport fixtures; these are local browser evidence, not a deployed production session.

| Story matrix row | Executed passing evidence |
|---|---|
| PED window | `convex/learningHealth.test.ts`: “preserves PED zero and multiple milestones, daily means, inclusive bounds and missing days”; actual route daily SVG/table test |
| Source joins | Metrics tests: “joins retained candidate scores directly and separates native judgment scales and identities”; “deduplicates source use per generation while counting repeated use across generations” |
| Historical sources | Same source-join test includes missing source IDs, distinct entry IDs/equal titles, malformed and deleted IDs, known version mismatch, legacy reviews; “missing provenance and missing linked reports never establish no historical source use” |
| Rerank arithmetic | Metrics test “records idempotently, calculates 8 success/2 fallback/5 skip, excludes search failures and bounds”; retrieval test “actual mixed retrieval outcomes produce the approved dashboard denominator” |
| Actual success | `convex/ai/brain/retrieveOutcomes.test.ts`: two real-path success cases without billed metadata and with zero surviving exemplars; “billed success retains existing attribution and exact token amounts” |
| Retry terminal | Two “SDK retry terminal result records once” cases execute real SDK with transient provider errors and prove two provider calls/one terminal row |
| No attempts | Metrics tests “historical billing alone never becomes operational coverage” and “zero attempts stays unavailable; measured successes produce genuine zero fallback rate”; actual route empty state |
| Recording failure | Four real retrieval-path tests for success/fallback/skip/search_error persistence failure, identical returned result, one payload-free diagnostic, no additional stored row |
| Bounds and access | Metrics unauthorized/anonymous/roleless/unmapped caller matrix and finite ordered window validation; top-level caps, per-join caps, shared candidate/report budget and separate shared review budget tests; route denied-user tests |
| Page lifecycle | `LearningHealth.component.test.ts`: loading, safe recoverable error, empty evidence, stale subscription, cached-window rejection, keyboard 90-day change, clock refresh |
| Browser/layout | Actual page frame/native scale/navigation/primary-white range/weight test; missing-day SVG test; desktop/narrow source containment and current PageBar test; shared rail inventory tests |

Acceptance 1 is established by actual page keyboard/window/value refresh and frame tests. Acceptance 2 is established by actual retrieval-to-stored-observation-to-admin-query integration. Acceptance 3 is established by persisted historical/missing/truncated fixtures and their page states. Acceptance 4 is established independently at server and page boundaries. Acceptance 5 is established by the canonical gates above.

## Browser artifacts and inspection

- `learning-before.png`: pre-change shared `AdminWorkspacePage` shell fixture, explicitly labelled as a fixture because there was no prior learning-health page. Provenance: [ui-baseline.log.gz](ui-baseline.log.gz).
- `learning-desktop-after.png`: actual learning route at 1440 × 900 browser viewport.
- `learning-mobile-after.png`: actual route at 390 × 844 viewport.
- `learning-sources-desktop-after.png` and `learning-sources-mobile-after.png`: actual source table scrolled into view, including native score/missingness columns and contained narrow horizontal scrolling.
- `learning-current-after.png`: actual route's `?workspace=current` rollback presentation. Installed browser provider captures the iframe body; the test applies a screenshot-only body-height style to frame the visible viewport without editing image bytes.

Implementation agent inspected before, desktop, narrow, source-table and current captures with the image tool. The visible chart preserves unmeasured-day gaps; measured values and score scales are legible; the table remains within its scroll container. Browser assertions also prove document width containment, one main/h1, keyboard controls and maximum 500 weight for newly added headings/metrics.

## Historical pre-review status and inherent limits

At this implementation-stage checkpoint, parent review, verification and the reviewed commit were still pending. Those steps subsequently completed as recorded below. There was no implementation blocker. Telemetry is prospective and best-effort; dates show recorded observations, not continuous/deployment coverage. Bounded queries deliberately return partial cohorts with visible flags. Source-associated judgments are observational and do not establish source-level causality. Historical missing provenance/version evidence remains unavailable and is not backfilled.

## Parent verification

The parent read the new query, terminal retrieval diff, telemetry helper, backend/retrieval tests and actual route source. Every matrix row maps to executed tests, including parameterized SDK retries and all four persistence-failure outcomes. Independently rerun `npm test`: 151 files / 1,938 passed ([parent-unit.log.gz](parent-unit.log.gz)); Svelte check: zero errors/warnings ([parent-check.log.gz](parent-check.log.gz)); Convex typecheck: exit 0 ([parent-convex-check.log.gz](parent-convex-check.log.gz)). Diff whitespace and unchanged ledger checksum passed. Parent visually inspected the actual desktop/mobile/current-page artifacts and the explicitly labelled pre-change shell fixture.

The parent's independent canonical Chromium rerun passed 60 files / 440 tests ([parent-component.log.gz](parent-component.log.gz)). Only test-generated changes to historical story-7 screenshots were restored afterward. The complete review diff was constructed read-only, without staging, from the canonical baseline plus each untracked implementation/spec file ([review.diff.gz](review.diff.gz)). At that checkpoint, four independent review layers were being dispatched with three reviewer processes at once; their completed dispositions are recorded below.


## Final review patch verification

All 11 requested review findings were patched under the unchanged intent contract. The final full Verification commands ran after the final source edits: `npm test` passed 152 files / 1,952 tests, `npm run test:component` passed 60 files / 443 tests, Svelte check returned zero errors and warnings, Convex typecheck returned exit 0, supported codegen returned exit 0, diff check passed, and the original ledger checksum remained OK. The canonical log paths in the table above contain those final runs. The final focused browser review suite passed 15 tests ([component-review-fixes.log.gz](component-review-fixes.log.gz)). All 55 historical screenshot hashes match the original manifest after restoring the six known incidental PNG writes from the final canonical suite.

### Byte-read baseline control and patched result

`convex/learningHealthBytes.test.ts`, test **“large generations reproduce eager read failure, then return oldest-first partial evidence safely”**, runs with `convexTest({ transactionLimits: true })`. It persists 24 generation documents with 800,000-character bodies, each below the single-document limit. The baseline-equivalent indexed `.take(201)` read is executed against that real test storage and is required to reject with **“Read too much data”** under the default 16 MiB read limit. This is an explicit eager-read control reproducing the former strategy, not a claim to have checked out and executed the complete baseline revision. On the same fixture, the actual patched `api.learningHealth.getHealth` succeeds, returns an incomplete oldest-first generation selection and per-source incomplete flags, reports byte exhaustion, and stays below its conservative 8 MiB budget. It does not falsely increment the known-missing-report count for unperformed joins. The final full unit suite executes and passes both assertions.

The four additional **“guards large %s bodies and marks row-level missing loading separately”** cases run with enforced transaction limits and cover Brain source content, candidate comments, report content, and writer-review comments. They prove the shared budget applies across all those reads, not only generation reads. Together these five cases pass in [review-metrics-tests.log.gz](review-metrics-tests.log.gz) and the final full suite.

`convex/lib/learningHealthReads.ts` uses installed Convex `getConvexSize` (public `convex/values`, `node_modules/convex/src/values/size.ts:40`) whose source explicitly matches Convex bandwidth/document-size accounting. It adds conservative per-document overhead, includes a two-document allowance for the existing authorization helper, and reserves 1 MiB + 4 KiB before each sequential read against a shared 8 MiB budget. Installed `QueryImpl.next()` (`node_modules/convex/src/server/impl/query_impl.ts:255`) performs one `queryStreamNext` syscall and decodes one returned document; the JavaScript iterator does not eagerly fetch the remaining stream. The helper checks headroom before every `next()` and single-document lookup, and always calls `return()` to close partial streams. Cap+1 probes are also charged. No eager large arrays remain in the metrics query's database reads.

### Review finding mapping

| Finding | Patch and executed regression |
|---|---|
| 1. Full-body byte exposure | Shared guarded read helper plus the five enforced-limit byte tests and failing eager control above |
| 2. Oldest-first selection hidden | Main PED/source/rerank populations return `selection` with direction, actual first/last loaded timestamps and completeness; page shows these; source-window and actual route tests assert the values |
| 3. Truncated PED gaps described as unmeasured | Partial chart and empty-state copy now labels omitted intervals/readings unknown; browser partial-population case checks this |
| 4. Judgment dates independent of source window | Page explicitly describes currently available associated judgments regardless of judgment date; **“source cohorts use inclusive generation bounds and retain later current judgments”** includes post-window reviews and later score updates |
| 5. Per-source incomplete evidence | Separate candidate/review/source-metadata incompleteness flags and visible not-loaded/partial labels; **“exhausted judgment budgets distinguish omitted evidence from verified empty joins”** proves null/zero with flags true versus genuinely empty complete joins with flags false; actual page test covers both labels |
| 6. Blank historical title wins | First nonblank title across a stable identity is retained; three **“later historical title replaces an early unavailable title”** cases cover absent, empty and whitespace titles |
| 7. Missing visible chart scale | Token-colored 0% and 100% labels/reference lines; browser assertions and refreshed desktop/narrow captures |
| 8. Exact-cap gaps | **“exact top-level caps are complete when no additional record exists”**, **“exact per-join and passage caps do not imply truncated evidence”**, and **“exact shared candidate report and review budgets stay complete”** all pass alongside over-cap cases |
| 9. Live access loss | Actual mounted page tests revoke admin role and sign out after metrics are visible, then assert metrics disappear and subscriptions stop; reactive test auth state retains the existing stub import API |
| 10. Source window regression | Inclusive generation-start bounds plus before/after and 90-day-only sources, counts and native-scale judgments are asserted by the source cohort test |
| 11. Weighted multi-generation means | **“shared-source means weight judgment samples across unequal and unjudged generations”** asserts three generations/six passages, candidate 15/3 = 5 and review 150/3 = 50, including an unjudged generation |

Refreshed screenshots retain their existing paths. The implementation agent inspected the desktop and narrow scale/coverage captures after the final changes; the UI delegate inspected the remaining source-table and current-presentation captures. No ledger or intent-contract edits were made. At that checkpoint, final review triage and the reviewed commit were still pending; both subsequently completed below.


## Final parent acceptance

After all eleven review patches, parent independently reran the complete commands: `npm test` passed 152 files / 1,952 tests ([parent-final-unit.log.gz](parent-final-unit.log.gz)); canonical `npm run test:component` passed 60 files / 443 tests ([parent-final-component.log.gz](parent-final-component.log.gz)); Svelte check returned zero errors/warnings ([parent-final-check.log.gz](parent-final-check.log.gz)); Convex typecheck returned exit 0 ([parent-final-convex.log.gz](parent-final-convex.log.gz)). Parent inspected the new sequential byte guard, installed iterator close/next behavior, enforced-limit regression control, final query/page and auth-stub changes, and final desktop/narrow source screenshots. All matrix rows remain covered. Whitespace check and original ledger checksum passed. All 55 historical PNG hashes match after restoring only five known test-generated story-7 images. Four-layer review and local story completion are complete; native run acceptance is separate.

The links above target committed `.gz` artifacts. Read any log in a fresh checkout with `gzip -dc .audit/story-8/<name>.log.gz`; read the saved diff with `gzip -dc .audit/story-8/review.diff.gz`. These contain the exact original bytes, verified by decompress-and-compare, and preserve transcript whitespace.

## Committed implementation

Exact verified implementation revision: `04b1a6aa13a218d19e1dd4d08ff89ad106f88e79`. Every reviewed source/spec file in `reviewed-paths.json` is present in the change set after baseline `64ee37c8d7498318232f6367b55c7f638e8b830e`; none remained uncommitted. The version-controlled working copy was clean after that commit. Ledger bytes remained unchanged and were not staged. This subsequent evidence-only commit records the canonical implementation revision.


## Follow-up review, 2026-09-05

Entry revision: `abc2d23ed38b7e2c4558bd3a8a6d120967f6c102`. Fresh review of the done story completed all four layers. Nine focused patches (medium 1, low 8), zero deferrals and six rejected observations are recorded in [followup-review-triage.md](followup-review-triage.md). Follow-up recommendation remains true with score 11; no unresolved intent or implementation blocker was found.

The new tests were first run against the entry page implementation: 5 failed and 15 passed. The failures establish stale-access display, access-error/loading subscription retention, missing named daily-scroll region and missing judgment-order explanation. See [regression before](followup-regression-before.log.gz). After patching, all 20 actual-route tests pass in [regression after](followup-regression-after.log.gz), including recovery, actual vertical/horizontal keyboard scrolling, and numeric SVG coordinates for non-midnight bounds and the full PED scale.

Final commands were independently rerun after all source/test edits:

| Command | Outcome | Committed output |
|---|---|---|
| `npm test` | 152 files, 1,952 tests passed | [unit](followup-final-unit.log.gz) |
| `npm run test:component` | 60 files, 448 tests passed | [browser](followup-final-component.log.gz) |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` | 0 errors, 0 warnings | [Svelte check](followup-final-check.log.gz) |
| `npx tsc -p convex/tsconfig.json --noEmit` | Exit 0, no output | [Convex typecheck](followup-final-convex.log.gz) |
| `git diff --check` | Exit 0 | Executed parent command |
| `shasum -a 256 -c .audit/story-8/ledger-baseline.sha256` | OK | Original checksum preserved |

The full component baseline passed before this pass's edits ([baseline browser](followup-baseline-component.log.gz)); the matching full nonbrowser baseline is [baseline unit](followup-baseline-unit.log.gz). Compressed logs were verified byte-for-byte against actual output. Existing evidence links were checked against files in this checkout. Supported bindings remain the earlier codegen output: this pass changes no backend/schema/generated contracts.

Parent inspected the actual page/test diff, auth transition failures, final mobile overview and desktop source screenshot. The UI delegate inspected all five refreshed captures. Desktop and narrow source-table copy remains legible and contained. The canonical suite regenerated five historical story-7 audit screenshots; each was restored only after confirming its original SHA-256 matched HEAD. All prior historical audit PNGs match the entry manifest, as recorded in [followup-historical-screenshots.json](followup-historical-screenshots.json). Two ignored transient test images regenerated and are not committed.

The existing matrix-to-test mapping above remains valid; new page tests strengthen its lifecycle, access and browser rows. No forbidden files or ledger bytes changed. Residual limitations remain prospective best-effort telemetry, explicitly bounded observational cohorts, and fixture-based auth/provider boundaries. Native orchestrator acceptance is separate from local completion.

## Committed follow-up implementation

Exact verified follow-up implementation revision: `d0434b953939f05f59cb5b1cd144185068b2a037`. All 18 reviewed follow-up paths are committed and present in the baseline-to-HEAD change set. The tracked working tree was clean immediately after this commit. The original native ledger checksum passed again and no ledger file was staged. This subsequent evidence-only commit records that canonical revision.


## Third review, 2026-09-05

Entry revision: `e7f58d017eac1f5d232a8df1c72233d5e2bb3cb6`. All four review layers completed. [Third review dispositions](third-review-triage.md) record nine low-severity patches, five rejections and zero deferrals. No intent/spec repair loop was needed. Follow-up recommendation is true with score 9.

The page now distinguishes historical entry identity and wholly unattributed evidence, labels loaded source counts, explains the authorization allowance in budget consumption, and wraps long titles. The system map now includes the terminal retrieval/outcome-storage/query flow and corrects stale write-only descriptions. Production backend/schema/generated contracts were unchanged; supported generated bindings remain the earlier codegen output.

### Executed proof

| Command | Result | Output |
|---|---|---|
| `npm test` | 152 files / 1,955 tests passed | [final unit](third-final-unit.log.gz) |
| `npm run test:component` | 60 files / 451 tests passed | [final browser](third-final-component.log.gz) |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` | Zero errors and warnings | [Svelte check](third-final-check.log.gz) |
| `npx tsc -p convex/tsconfig.json --noEmit` | Exit 0 | [Convex typecheck](third-final-convex.log.gz) |
| `npx vitest run convex/learningHealth.test.ts convex/learningHealthBytes.test.ts` | 30 tests passed | [focused backend](third-backend.log.gz) |
| `npx vitest run --config vitest.component.config.ts src/routes/admin/learning/LearningHealth.component.test.ts` | Prior page: 3 failed / 20 passed; patched page: 23 passed | [before](third-ui-before.log.gz), [after](third-ui-after.log.gz) |

The browser baseline ran before edits and passed 448 tests ([baseline browser](fresh-component.log.gz)); baseline nonbrowser tests passed 1,952 ([baseline unit](fresh-unit.log.gz)). Final commands above ran after all source/test changes. Compressed artifacts were verified by decompress-and-compare.

The new oldest-created candidate test persists 21 distinct scores. The actual query returns the oldest 20 with mean 1. A temporary `.order("desc")` mutation to the real candidate query produced mean 1.45 and failed the new assertion ([reversed-order control](third-order-mutant.log.gz)). Restoring the exact original production bytes makes it pass ([restored query](third-order-restored.log.gz)). This is a deliberate regression sensitivity control, not a claim that the entry implementation had the ordering defect.

The mixed-byte fixture uses real Convex test storage with transaction limits. Generation, source, candidate, report and review bodies jointly consume the budget; early joins remain complete while only one of three later reviews loads, with review incompleteness and byte exhaustion explicitly reported. The wrong-table-ID regression proves a project ID cannot provide unrelated source metadata. These strengthen the existing matrix's Bounds/access and Historical sources rows.

The three new actual-page browser cases produce nine failing assertions against the entry page, then pass after the UI patch. They cover all five UI findings: historical identity, unattributed score association, loaded counts, budget allowance, and long-title containment. These strengthen the existing matrix's Historical sources, Bounds, and Browser/layout rows. Existing AC mappings above still apply and all mapped tests execute in the final suites.

Parent and UI delegate visually inspected [entry page](third-learning-before.png) and [long-title narrow result](third-learning-long-title-after.png). Parent also inspected the refreshed desktop source table and mobile overview; the delegate inspected all five existing refreshed page captures. The long title and ID wrap within the source cell, loaded-count headings remain legible, and page width stays contained. Browser assertions independently verify geometry and keyboard horizontal scrolling.

The canonical browser suite wrote six unrelated historical story-7 PNGs. Initial git status established that none had entry changes; only those test-written paths were restored from HEAD. [Restoration hashes](third-restored-screenshots.json) retain both generated and restored hashes. No unrelated source changes or existing deferred-work ledger modifications were made. Whitespace check and original ledger checksum passed.

Residual limits remain prospective best-effort telemetry, bounded observational cohorts, and local auth/provider/transport fixtures. These tests do not establish deployed end-to-end behavior or native orchestrator acceptance. No push or deployment occurred.


## Committed third-review implementation

Exact verified implementation revision: `12d2a0af4195746014b78f03f3947358e030dc9b`. All 30 reviewed paths, including the path manifest itself, match their committed blobs and occur in the baseline-to-HEAD change set. The tracked working tree was clean after that commit. Every third-review compressed command log matches its original command output bytes. The original ledger checksum passed again; no ledger file was staged. This subsequent evidence-only commit records the canonical implementation revision.
