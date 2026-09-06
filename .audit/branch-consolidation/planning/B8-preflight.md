# B8 read-only preflight

2026-09-05. Reviewed actual four-file draft `planning/drafts/spec-branch-b8-header-mobile-target.md`, current components/tests and canonical browser routing. No tests, browser measurements, source or canonical-spec edits. Historical dimensions remain historical; the following dimensions describe source expectations until fresh runtime proof.

## Four-file scope is correct

Only WorkspaceHeader.svelte, WorkspaceHeader.component.test.ts, Button.component.test.ts and WorkspaceRail.component.test.ts need changes. Current Header:177–185 uses shared Button size xs with `gap-1.5 motion-reduce:transition-none`. Button's xs implementation gives h-8/px-3; the Header's current paired 390/1440 test at157–169 asserts32px for both. Add local min-h-11/min-w-11 and sm:min-h-0/sm:min-w-0 while retaining xs and existing classes. CSS min-height overrides fixed height at mobile; desktop resets preserve h-8. Do not enlarge shared Button or alter global spacing/breakpoints.

Correct the existing paired geometry assertion first. For390, assert the actual `a[href="/project/new"]` width and height >=44; for1440 retain height32 and intrinsic width, not a historical exact font-dependent width. Preserve semantic class, href, ml-auto and no sm:h-7 assertions. Do not measure the enclosing toolbar. Existing hidden-action case151–154 remains. Use explicit non-null expectation before reading bounds so selector failures cannot look like geometry failures. The accessible name remains exactly New project through current visible/sr-only spans.

The shared Button anchor case36–49 already supplies min-h-11 and verifies tag/href/name/classes. Add actual height>=44 there without deleting its current CORE_TOKENS inventory or later motion/theme/parity/disabled tests. Historical 4cc4a85 removed stale tokens; current main already removed the stale transition-colors token and has meaningful reduced-motion coverage. Only its useful geometry assertion is required now.

## Exact Admin fixtures and non-vacuous selectors

Use current eligible fixture `{role:"admin", name:"Admin Writer", isDeveloper:true}` already present in the target cases. A role-only admin would hide the group. Do not replace the full current role/owner/developer matrix or copy the historical eight-link list: current ADMIN_DESTINATIONS contains nine pairs, including `["Learning health","/admin/learning"]`.

For the all-icon assertion, operate on **destination anchors**, not all nav links or all SVGs:

```ts
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#workspace-admin-links a"));
expect(links.map(link => [link.textContent?.trim(), link.getAttribute("href")]))
  .toEqual(ADMIN_DESTINATIONS);
expect(links.every(link => link.querySelector("[data-admin-icon-tone] svg") !== null)).toBe(true);
```

Place it while the default rail Admin group is expanded, before that test's keyboard collapse; otherwise `.every` on an empty list falsely passes. Exact list equality makes the icon assertion non-vacuous and includes Learning health automatically. Preserve tile count, distinct computed colors, ingestion-specific SVG check, group caret, aria controls and keyboard assertions. The chevron is outside destination anchors and cannot satisfy this selector.

For ordering, extend the current “moves the Admin records group below the primary workspace links” case at212–216. Keep mt-5 assertion, add existence checks, then both independent relationships:

```ts
const home = navLink("Home")!;
const projects = navLink("Projects")!;
const admin = document.querySelector<HTMLElement>("[data-rail-admin]")!;
expect(home.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(projects.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Ensure nodes exist and belong to the mounted document before comparing; disconnected-node flags are not ordering proof. Compare the entire Admin container, not an arbitrary destination or its toggle. Current product markup has Home215, Projects225 and Admin230 in that order. This is a recovered test assertion, not an existing product-order defect.

## Canonical suite selection and preservation

Existing draft command names precisely the three affected component test files and is sufficient for focused before/after execution:

`node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts`

All three match ordinary component include and do not equal pointerSuite. The default Chromium instance excludes only WorkspaceChromePointer.component.test.ts; fine/coarse instances include only that file. Thus these suites each execute once in ordinary Chromium, not once per pointer mode. This is source-derived selection, not a new runtime listing receipt. Do not override config or add context flags.

Preserve Button's real reduced-motion checks and Rail's standalone44/28 target/motion cases. Preserve WorkspaceChromePointer.component.test.ts and config byte-for-byte: it uses injected expectedPointer in separate real contexts, asserts actual media queries and measures row44/28. No CDP touch toggle is needed or permitted for this header breakpoint repair. Parent's combined gate exercises those untouched pointer controls; focused Header success alone does not prove them.

The component setup imports actual layout.css, so the planned geometry check is meaningful. Run the same source selections before and after with updated expectations and retain genuine baseline mobile failure. Added Button/rail assertions should pass before the Header fix; do not claim they exposed new product failures. No fixed sleeps or retries. Current sources confirm no extra fixture/config/source path is needed.

## Recommended draft clarifications

Add the non-vacuous exact destination list plus per-anchor SVG selector, both DOM-order comparisons with existence/connected-node checks, and explicit preservation of current Button CORE_TOKENS. State that the existing three-file command runs ordinary Chromium only; parent owns unchanged pointer-suite proof. Retain historical versus fresh dimension distinction. These are concrete fixture/evidence clarifications, not expanded product scope.
