---
key: slop-1-dead-components
status: done
kind: refactor
deps: []
touches: [src]
risky: []
verify: ["npx vitest run --config vitest.component.config.ts src/routes/project/[id]/projectRoute.component.test.ts src/lib/components/generation/GenerationRecoveryPanel.component.test.ts src/lib/components/ui/PageBar.component.test.ts src/lib/components/ui/Disclosure.component.test.ts src/lib/components/ui/StageBadge.component.test.ts src/lib/components/ui/ViewModeToggle.component.test.ts src/lib/components/ui/SelectInput.component.test.ts src/lib/components/ui/Input.component.test.ts src/lib/components/ui/UserMenu.component.test.ts"]
done_when: [! test -e src/lib/components/comments/CommentHighlight.ts, ! test -e src/lib/components/comments/CommentSidebar.svelte, ! test -e src/lib/components/comments/CommentThread.svelte, ! test -e src/lib/components/editor/GapCallout.svelte, ! test -e src/lib/components/editor/SectionDivider.svelte, ! test -e src/lib/components/generation/ReportViewer.svelte, ! test -e src/lib/components/ui/Header.svelte, ! test -e src/lib/components/ui/InsightTile.svelte, ! test -e src/lib/components/ui/MenuToggleIcon.svelte, "! rg -q 'CommentHighlight|CommentSidebar|CommentThread|GapCallout|SectionDivider|ReportViewer|components/ui/Header|InsightTile|MenuToggleIcon' src shared convex scripts"]
title: Delete the nine abandoned React-port components under src/lib/components; nothing imports them
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T06:58:46.050Z"
run: 20260905-055642-10-tickets
branch: factory/slop-1-dead-components
merged: 9e3940d
verdict: test-verified
evidence: .audit/slop-1-dead-components/evidence.md
deferred: ["docs/svelte-migration.md:77 still lists ui/MenuToggleIcon and ui/Header in its historical port inventory; outside the done_when predicate and outside this ticket's deletion-only scope"]
---
## Intent
For the next reader of `src/lib/components`: nine files (810 lines) ported from the pre-Svelte React tree and never wired in stop competing with live code. No route, component, test, styleguide page or script imports them; the only references are inside the dead files themselves (`CommentSidebar.svelte:5,159,196` imports `CommentThread`), and `ReportViewer.svelte:4` calls itself a temporary pre-Tiptap viewer (`slop-audit.md:5-21`, re-checked with one `rg` over `src shared convex scripts` in `research.md`). Nothing a user sees changes. Principle: [4 subtract before you add]; [1 laziness protocol]: deletion only, no renames, no tidying of what stays.

## Acceptance
- AC1: The nine files in `done_when` are deleted with `git rm`; no other file is edited unless `npm run check` names an import of a deleted file, in which case only that import line goes.
- AC2: `rg` for every deleted file and symbol over `src shared convex scripts` returns nothing (the `done_when` pattern). `MarginComments`, `CommentOverlay`, `CommentInput`, `ReadOnlyEditor`, `Editor` and the `.comment-highlight` CSS rule (live editor decorations, `slop-audit.md:19`) are untouched.
- AC3: `npm run check`, `npm test` and `npm run build` pass; the component suites in `verify` report the same file and case counts before and after. `verify` names the nine suites green at baseline near the deleted files (`component-baseline.log:534`: every ui suite except `Button`); `Button.component.test.ts:46` is red at baseline and belongs to ui-1, so it is not in this gate and is not edited here.

## Verification
- AC1 → `git diff --stat` shows nine deletions and at most import-line removals.
- AC2 → the `done_when` `rg` predicate; `rg -n 'comment-highlight' src` still hits the live CSS and decorations.
- AC3 → gate; `npm run build` tail; `verify` command tails before and after.
Refactor pin: the `verify` run before deletion is the pin; after deletion the `Test Files` and `Tests` lines are identical.

## Implementation notes
- `git rm` the nine paths. Nothing else.
- Do not touch `src/lib/workspace/WorkspaceGate.svelte`, `src/lib/dashboard/workspaceExperience.ts`, their tests, `src/routes/workspaceRoutes.component.test.ts`, `src/routes/project/[id]/projectRoute.component.test.ts` or `docs/product-domain.md` (escalated `workspace-2-drop-dead-gate-branches`).
- Chromium must be installed once (`npx playwright install chromium`) for the `verify` command; `npm test` stays browser-free.

## Edge cases
- A `codex/*` or bmad lane branch still imports a deleted file: it fails `npm run check` on rebase with the file name; that is the intended signal.
- `npm run build` warns about an unused export from a kept file: leave it (slop-2 handles helper exports).
- Run twice: `git rm` on a missing path is a no-op for the predicates.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.
