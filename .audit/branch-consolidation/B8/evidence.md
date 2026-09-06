# B8 implementation evidence

Baseline: `d28cfc0bc0a34e78683152553143179fac2682c7` on `codex/branch-consolidation`, in the user-assigned checkout. Initial status contained only the untracked supplied spec. Header bytes matched `d7036f7551f1438c64fea5330dc77327ab7c99eb^`. No other worktree was edited.

Runtime observed before verification: Node `v24.19.0`, npm `11.17.0`, login shell. Existing checkout/dependencies used; no install or dependency changes.

## Change

Only four source files changed (see `final.diff`). Header adds local mobile minimum dimensions and existing sm resets. Header measures the anchor at 390/1440. Button adds explicit min-h-11 anchor height proof while retaining CORE_TOKENS. Rail adds connected Home-to-Projects-to-Admin document order and exact nine destinations with one SVG per anchor, including Learning health. Existing role, keyboard, theme, motion, focus, omission and href assertions remain.

## Browser reproduction and repair

Before component edit, corrected responsive geometry expectations ran with:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts
```

`before.log`, exit `1`: 1 failed, 40 passed across 3 suites. The genuine failure was mobile anchor height 32 < 44, actual bounds 41 x 32. Desktop height assertion passed at 32; passing-test console output was suppressed, so baseline desktop width is not retained.

The same command after the narrow patch: `after.log`, exit `0`, 41 passed across 3 suites.

One additional bounded evidence run enabled passing-test console output:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts --silent=false --reporter=verbose
```

`bounds.log`, exit `0`: 41 passed. Actual final mobile bounds 44 x 44; desktop 121.671875 x 32. The header has 11 tests and executes once in ordinary component Chromium. All three suites appear only in ordinary Chromium. No pointer emulation, sleeps, routing/configuration edits, or historical capture edits were introduced.

## Source protection and acceptance

`baseline-hashes.json` and `final-hashes.json` retain SHA-256 source identities. `protected-check.txt` confirms unchanged shared Button implementation, layout.css tokens/styles, browser configuration and pointer suite. `final.diff` preserves existing header props/classes/placement, and contains only the four authorized source files. `diff-check.log` records `git diff --check`, exit 0. Working-tree status has no historical screenshot modifications.

The failing baseline plus passing same geometry case proves mobile repair and desktop height preservation. The Button min-height assertion and rail order/icon additions pass with existing coverage intact. Browser configuration retains the separate fine/coarse pointer instances and excludes that suite from ordinary Chromium.

## Handoff limits

Implementation and bounded browser verification are complete. As required by the spec, independent BMAD review, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, separate pointer proof in that gate, final admission and integration remain parent-owned and were not run here. No staging, reviewers, commits, remotes, native state or ledger mutations. Audit artifacts are in the repository's ignored audit directory and remain available locally for parent review. No additional UI screenshots were deliberately captured; the runner generated its standard failure screenshot outside historical audit space.

## Parent acceptance

Three fresh Astra6 medium review layers completed; per-item disposition is review-triage.md. Parent captured exact baseline desktop width121.671875 and height32 with the unchanged header; it matches the repaired desktop. Mobile baseline41x32 fails corrected geometry; repaired44x44 passes. See parent-baseline-width.json and lossless source snapshots. Maintained test no longer prints batch diagnostics and now checks desktop computed minima reset to0px. All41 affected tests pass after this patch. Final Node24 gate passes all nine steps,2006 unit and478 browser tests including independent pointer contexts. No unexpected tracked mutations; protected shared Button/style/config unchanged. Final source hashes are parent-reviewed-source.json. No story_key or native ledger change. Hosted CI and final shipping remain pending.
