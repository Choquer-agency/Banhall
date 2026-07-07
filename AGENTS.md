# Frontend: SvelteKit 2 + Svelte 5 (runes) — NOT React/Next.js

The frontend was migrated off Next.js/React on 2026-07-02. Do not write JSX,
React hooks, or Next.js APIs. **Read `docs/svelte-migration.md` before any
frontend work** — it has the stack, React→Svelte conventions, convex-svelte
idioms, and post-cutover gotchas (e.g. exportTemplateDocx is not SSR-safe). Routes
live in `src/routes/`, components in `src/lib/components/`. Visual work
follows the design system — tokens in `src/routes/layout.css`, rules in
`docs/design-system.md`, live at `/styleguide`; use type roles + the
remapped gray ramp, never ad-hoc hexes. Dev server:
`npm run dev` (or bun/pnpm) → localhost:3000.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
