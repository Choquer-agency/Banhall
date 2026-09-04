# Browser gate reconciliation evidence

Baseline: `717c75897cc04256c008a2ed42747df66f6fc6b5`, branch `codex/bmad-browser-fix`, worktree `Banhall-bmad-browser-fix`. Initial reviewed candidate commit: `a76fa6e4ac9d2249526c1f0fffa417a44d081760`. Review patch commit: `5a3aad0f109749d3257e16424e0cc51ee3d8855e`, a test-only diff against that initial candidate. The spec is now done after independent BMAD review and all patches. Integration and shipping remain root-owned.

## Commands and results

Run after `npx svelte-kit sync` (the initial missing generated tsconfig was a startup problem, not a test result):

```sh
npm run test:component -- src/routes/workspaceRoutes.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceChrome.component.test.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts
```

- Parent's pre-edit baseline: `before.log`, 5 failed suites; 8 failed / 33 passed tests, 53.24s.
- First candidate: `focused-first.log`, 2 failed / 50 passed. Both failures were newly added tests attempting `vi.spyOn` on Better Auth's dynamic proxy. Changed that boundary to a module mock, preserving real rendered dialog/focus behavior.
- Second candidate: `focused-second.log`, 52 passed.
- Initial reviewed candidate: `focused.log`, 5 suites / 53 tests passed, 16.71s. Added explicit `matchMedia` verification of reduced-motion emulation and desktop row geometry after the second pass.

```sh
npm run test:component
```

Initial reviewed candidate full run: `full-component.log`, **52 suites / 304 tests passed**, 31.25s. This run followed the initial candidate test edits. No skipped or failing tests.

```sh
git diff --check
```

Passed. No application, backend, config, native run, ledger, sprint-state, or integration changes. The root subsequently requested the type gate in this worktree; its result is recorded in the review patch section below. No full unit gate was run here.

## Revised expectations and contract evidence

| Coverage | Introducing evidence | Live check |
| --- | --- | --- |
| Home retains all query values; Projects retains explicit layout/group and unknown params, adding only absent list/client defaults | `0b094ed4f5500f3401164cdbe0449bbc996bc951`, `navigation-history.diff` | Five route cases, canonical paths and decoded query values, preview mounted and no goto |
| Admin requires admin role AND developer or workspace Owner flag | `docs/product-domain.md:1259`, `account-history.diff` | Both positive flags and role-only/flagged-writer negative cases, exact eight label/URL pairs |
| House rules is eighth distinct admin destination | `66f131b00482af027bc83b9786d85d9050a6dec4`, `account-history.diff` | Eight destinations and eight distinct icon tones; desktop expanded, drawer compact; Enter activates disclosure |
| Independent Settings link and confirmed Sign out replace Settings popup | `66f131b00482af027bc83b9786d85d9050a6dec4`, `account-history.diff` | Real portaled confirmation clears drawer z-index, both controls measure >=44px, cancel and Escape restore trigger focus, drawer remains closable, auth mock and navigation show no sign-out |
| Rail uses 150ms color transitions | `c7167fb59d3eb46b7a21aafbad6a292ed25ea0df`, `rail-motion-history.diff` | Computed duration/property for desktop and standalone drawer; 28px/44px row geometry; real CDP reduced-motion yields transition none |
| Button uses explicit color/background/border/opacity transition over 200ms | `113ef7c77479552d0b254110ff05bf7c5f1a2cb6`, `button-motion-history.diff` | Computed styles on anchor and button, real CDP reduced motion, existing theme and class parity, disabled click has no callback |
| Header creation action uses shared xs size | `d0f659e654d0571ba1d8e00ca97402fd8c23c099`, `header-size-history.diff` | 32px geometry at 390px and 1440px widths, accessible New project name, canonical href and primary theme tokens |

## Limits

No production change was necessary, so no before/after production screenshots were taken. Standalone drawer-row measurements verify only the base targets. The review patch also measures the actual integrated drawer under Chromium touch emulation, requiring matching coarse/fine pointer media before its 44px/28px geometry assertions. Chrome tests exercise actual nested drawer/dialog portals at a mobile viewport. Auth service calls are mocked to prove cancellation and confirmed-success navigation without making a real external sign-out. Existing Svelte `derived_inert` warnings remain visible in raw logs. Independent review, final integration, and full unit verification remain root-owned.


## Review patch authorized by root

The root triaged `.audit/browser-gate-repair/results-blind-hunter.md` and authorized findings 1–10 as bounded test coverage patches. No production behavior, test runner, or backend changed. At patch handoff the spec remained **in-review**; root subsequently completed step05.

- Finding 1: actual `WorkspaceChrome` drawer rows measured under `Emulation.setTouchEmulationEnabled` enabled/disabled. Both matching pointer media and rejection of the opposite media are asserted before measuring 44px coarse and 28px fine rows. The touch override is cleared in `finally`.
- Findings 2–3: exact sanctioned rail transition property list; Button and Rail explicitly establish no-preference before normal-motion assertions, then reduce, with a `finally` around the entire emulation sequence.
- Findings 4–5: group-present/layout-absent and repeated/encoded unknown-query cases. Canonical pathname and all decoded values/counts are checked with `URLSearchParams.getAll` to accept equivalent URL serialization.
- Findings 6–7: admin and non-admin with both presentation flags; drawer disclosure opens with Enter and closes with Space, checking exact eight destinations and retained toggle focus.
- Findings 8–9: initial nested confirmation focus plus forward/backward Tab cycles stay inside it; `elementFromPoint` reaches both visible confirmation controls and excludes the underlying drawer at its close-button coordinates.
- Finding 10: a separate affirmative confirmation test proves zero auth calls before confirmation, exactly one successful mocked sign-out afterward, `/login` navigation, and confirmation removal. The existing navigation stub records destination, not `goto` options; replaceState/invalidateAll option forwarding is not newly claimed here.

Exact commands are the focused five-suite command above, followed by:

```sh
npm run test:component
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check
git diff --check
```

All run in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-fix`.

- `review-focused-first.log`: 5 suites / 60 tests passed, 23.87s.
- `review-focused.log`: final formatted patch, 5 suites / 60 tests passed, 35.49s.
- `review-full-component.log`: final candidate, **52 suites / 311 tests passed**, 60.51s. No skipped or failing tests; exit 0.
- `review-check.log`: **svelte-check found 0 errors and 0 warnings**; exit 0.
- `git diff --check`: passed.

## Root completion

Reviewed final patch5a3aad0f109749d3257e16424e0cc51ee3d8855e against candidatea76fa6e. All three independent review results and per-finding dispositions are preserved here. No additional code change followed the final311-test browser gate or the passing local Svelte check. Spec marked done with a derived Suggested Review Order. No sprint story key applies. VS Code CLI is unavailable; the spec is available through the Codex file panel.
