---
title: Verify pointer row sizes in genuine isolated browser contexts
type: bugfix
created: 2026-09-05
status: in-review
review_loop_iteration: 0
baseline_commit: 8e022cf6eb8e737a00dff818c337ca01fd354414
context: []
---

<frozen-after-approval reason="existing user authorization covers actual hosted failure repair, independent review and private commit without repeat approval">

## Intent

**Problem:** Hosted Linux Chromium restores pointer:none after CDP touch disable, so the previous readiness-only repair cannot create a fine-pointer environment. Root's real Linux probe confirms this across default headless shell, full Chromium and blink settings. Drawer size assertions require genuine coarse and fine input contexts.

**Approach:** Run the existing pointer-specific drawer checks in two dedicated, explicitly configured fresh browser contexts. Declare the expected mode independently of actual media state. Preserve every meaningful mode/layout/row-count/open/close assertion while removing CDP toggle and invalid fine-restoration assumptions. Keep all unrelated tests selected exactly once.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-pointer` on `codex/bmad-browser-pointer` from exact baseline8e022cf6eb8e737a00dff818c337ca01fd354414. Use existing own dependencies/runtime; coordinate available disk with root before large gates. Preserve actual fine/coarse/opposite-mode assertions and44/28px row expectations. Retain both failed hosted revisions honestly; previous local passes did not prove Linux behavior. Preserve all protected product/dependency/native ledger/source/archive bytes.

**Ask First:** Product behavior changes or another architecture if real configured contexts do not provide the declared modes. Coordinate concrete evidence with root before scope expansion.

**Never:** Infer fine from28px CSS or pointer:none; skip/relax assertions; retry whole tests; add fixed sleeps; change browser distribution/channel or gate readiness; mock matchMedia; mutate product/native policy/ledger/state; push/merge/GitHub changes; start loops/Docker or render into original. Only the pointer suite is excluded from ordinary execution, because it executes in both dedicated contexts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Fine instance | Explicit hasTouch:false and declared fine mode | Actual fine true/coarse false, rows28px | Bounded actual assertion failure if environment differs |
| Coarse instance | Explicit hasTouch:true and declared coarse mode | Actual coarse true/fine false, rows44px | Same real failure, no fallback |
| Isolation | Separate named instance providers | Coarse context never toggles/restores fine; ordinary suite unaffected | Detect duplicate/missing routing via real listing |
| Coverage | Canonical component invocation | Existing cases once; new pointer case once in each declared instance | No broad exclusions or orphaned tests |

</frozen-after-approval>

## Code Map

- `vitest.component.config.ts`: retain plugins/aliases/optimization/default headless shell. BrowserInstanceOption supports include/exclude/provide/provider. Installed cli-api cloneConfig explicitly replaces nonempty instance include/exclude arrays and selects instance provider. Configure ordinary instance with exact pointer-suite exclusion; two dedicated instances each include only new suite and use playwright contextOptions hasTouch false/true plus typed provided expected mode.
- `src/lib/components/workspace/WorkspaceChrome.component.test.ts`: move only paired pointer row case into new dedicated suite; remove now-unused CDP import/readiness helper. Other6 tests remain untouched.
- `src/lib/components/workspace/WorkspaceChromePointer.component.test.ts`: one actual drawer case, executed per declared mode. Use Vitest inject with proper ProvidedContext typing, not observed state to select expectation. Reuse equivalent app/auth/Convex setup and tall-content snippet. Preserve actual media assertions, rowcount>=2, visibility, close, disconnected and44/28 sizing. No touch toggle/restore.
- `.audit/browser-pointer-platform/`: prior local-context observations, installed API evidence and failed hosted logs. Root Linux probe33987464839 at diagnostic a4732b26 demonstrates freshfalse=fine28/freshtrue=coarse44, but disable=none across all3 variants. Copy exact root results/log when available; no inferred replacement proof.
- `scripts/loop-verify.sh`, package files, product components/CSS, all native guidance and historic archives remain read-only. Preflight correctly checks unchanged headless shell distribution.

## Tasks & Acceptance

**Execution:**
- [ ] Preserve root actual Linux baseline/probe identities and previous failed readiness-only outcome.
- [ ] Split only pointer case into dedicated suite and explicit fresh context instances.
- [ ] Run actual canonical listing to prove existing60 ordinary file selections once and new pointer file in exactly fine/coarse instances;215 unique executable tests across unit/browser expected.
- [ ] Run focused old/new actual suites and coordinate root Linux candidate verification before broad final gates. Notify coordinator as soon as candidate is ready.
- [ ] After capacity confirmation and final candidate validation, run one `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, retain exact source/log/capture identities and restore only generated historic screenshots.
- [ ] Fresh independent BMAD review, scoped fixes and coordinator private commit; no shipping or ledger mutations.

**Acceptance Criteria:**
- Given declared fine/coarse contexts, when real drawer tests run, then actual media matches declared mode and existing row/open/close expectations all pass.
- Given full canonical listing, when project/file multiplicities are inspected, then unrelated tests are not duplicated or lost and pointer suite runs twice in isolated declared contexts.
- Given actual Linux candidate results, when evaluated, then the platform that invalidated the prior fix has exercised the new context architecture without treating none as fine.
- Given final source, when unified optional gate runs, then every step passes; expected browser463 tests across62 project-file executions/61 unique files, with unchanged unit1970/154 and uploader50+18 unless genuine added regression assertions justify documented counts.

## Spec Change Log

## Design Notes

hasTouch:false is suitable only in a fresh context, as demonstrated by root's Linux probe. It is not a restoration command after emulation. Dedicated instances isolate input capabilities for their entire test lifecycle. Ordinary instance include/exclude must not leak into dedicated instances. Actual listing and Linux execution adjudicate configuration semantics before finalization.

## Verification

- Canonical `vitest list --filesOnly --json` via existing component config, with explicit multiplicity accounting.
- Focused old/new WorkspaceChrome suites, preserving actual media and28/44 expectations.
- Root-owned actual Linux candidate proof; parent owns diagnostic branch operations.
- One final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` after root confirms disk capacity; no repeated broad baseline chase.
- Immutable product/config-boundary/archive comparisons, source hashes and committed whitespace checks; fresh independent BMAD review.
