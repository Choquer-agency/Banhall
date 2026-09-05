<!-- bmad:context -->
<!-- Verified 2026-08-25 against 0e48926. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Banhall

SR&ED report generation for a consulting firm. SvelteKit 2 + Svelte 5 runes, Tailwind, Convex backend, Claude/OpenRouter via `convex/ai/`. Domain contract in `docs/product-domain.md`, AI target architecture in `docs/ai-architecture-plan.md`, current findings in `docs/ai-engine-audit-2026-08-25.md`. Tickets live in futur-board (BNH-*), not this repo.

## Policy

- Never repurpose `projects.createdBy`, mix human workflow with generation state, or invent transitions/permissions outside `docs/product-domain.md` without recording an approved amendment there.
- Agents propose, humans apply: no code path may let an AI tool mutate report prose directly; route through `chatProposals` + `applyProposal`.
- Never hand-edit `convex/_generated/`.

## Where things are

- Convex code: read `convex/_generated/ai/guidelines.md` first; it overrides training-data Convex patterns.
- Frontend conventions and convex-svelte idioms: `docs/svelte-migration.md`.
- Design tokens: `src/routes/layout.css`; rules in `docs/design-system.md`; live at `/styleguide`.
- Changelog entries: `docs/changelog-guidelines.md`.

## Running and verifying

- One command proves a change: `bash scripts/loop-verify.sh`. Numbered steps: preflight, Convex typecheck, `npm run check`, `npm test`, the test-discovery guard, `npm run build`, the two client-uploader harnesses. Browser-free by default.
- Preflight defaults `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` to public placeholders when unset, so no deployment is needed; it also fails at step 1 naming a missing `node`/`npm`/`pwsh`/`git`.
- Run `npm ci` in each fresh checkout and after dependency changes. The gate only bootstraps an empty `node_modules`; an existing directory does not establish installation freshness or ownership.
- `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` adds the browser component suite (`npm run test:component`), which needs `npx playwright install chromium` once (Linux: `npx playwright install --with-deps chromium`). Optional preflight launches headless Chromium. `npm test` itself never touches a browser.
- CI defines two jobs: one runs `bash scripts/loop-verify.sh`, the other installs Chromium and runs `npm run test:component`. Still run `test:component` locally before touching `src/lib/components`. Required branch-protection checks are configured separately from this workflow.

- Existing component tests rewrite historical screenshots under `.audit`. Inspect their diffs after browser runs and restore only generated historical outputs that must stay unchanged, preserving unrelated work.

## Conventions that differ from defaults

- No JSX, React hooks, or Next.js APIs; Svelte 5 runes only.
- Use design-system type roles and the remapped gray ramp; never ad-hoc hex values.
- Max font weight 500 in new or redesigned UI; hierarchy via size and ink color, not bold.
- Use bits-ui/shadcn-svelte primitives over native `<select>`/`<input>` controls.
- Active tab = primary fill + white text; inactive hover = primary wash.

## Known pitfalls

- `exportTemplateDocx` is not SSR-safe; import it only inside browser-only code paths.
- Never add `sveltekit()` to `vitest.component.config.ts`; it pulls `$app`/`$env` and breaks the browser project.

<!-- /bmad:context -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

Read `.factory/AGENTS.factory.md` for the isolate → build → prove → ship rules.

## Native BMAD ledger finalization

The native BMAD orchestrator owns deferred-work ledger content and status. Do not author, revert, regenerate, or manually change ledger entries. During native finalization, you may stage and commit the exact unchanged ledger bytes written by the orchestrator, alongside reviewed artifacts, when native journal/state or the invocation snapshot establishes their provenance. Confirm the working-tree bytes and staged blob match that snapshot and retain the evidence. Do not stage unexplained ledger changes. Committing an existing native close does not itself establish final run acceptance.
