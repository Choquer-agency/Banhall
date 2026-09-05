# Banhall

Banhall generates SR&ED (Scientific Research and Experimental Development) reports for a
consulting firm. Consultants collect client transcripts and supporting documents, an AI engine
drafts the CRA project-description sections from them, and humans review, edit and export the
result. The app is SvelteKit 2 with Svelte 5 runes and Tailwind; the backend is Convex
(`convex/`); Claude and OpenRouter calls live in `convex/ai/`. The domain contract every change
must respect is `docs/product-domain.md`.

## Prerequisites

- **Node 24** — the version in `.nvmrc` (`nvm use`). Node 22.12+ also works; Node 23 does not.
- **npm** — ships with Node. `npm ci` installs the lockfile.
- **PowerShell 7 (`pwsh`)** — the client-uploader harness (`scripts/client-uploader/tests/run-tests.ps1`)
  is PowerShell. [Install PowerShell](https://learn.microsoft.com/powershell/scripting/install/installing-powershell).
- **Chromium, once** — `npx playwright install chromium`, only for the component suite.

## Develop

```bash
npm ci
npm run dev        # http://localhost:3001
```

## Verify a change

One command proves a change. It is browser-free, needs no deployment and no credentials:

```bash
bash scripts/loop-verify.sh
```

It runs, in order and numbered: preflight (tool and Node version check, public URL defaults),
Convex typecheck, `svelte-check`, unit tests, the test-discovery guard, a production build, and
the two client-uploader harnesses. A missing tool fails at step 1 with the tool's name and an
install hint, before any typechecking. Each step prints its name and its duration.

Add the browser component suite:

```bash
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
```

CI runs exactly this script in one job and `npx playwright install --with-deps chromium` plus
`npm run test:component` in a second job (`.github/workflows/ci.yml`), so CI and the local gate
cannot drift.

Individual pieces, if you want them on their own:

```bash
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check
npm test
npm run test:component
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build
```

`npm run check` needs `PUBLIC_CONVEX_URL` because `svelte-kit sync` materializes
`$env/static/public` from the environment. The production build needs `PUBLIC_CONVEX_SITE_URL`
too: the installed `@mmailaender/convex-better-auth-svelte` SvelteKit adapter imports both from
`$env/static/public`. Placeholders satisfy both; verification never uses a shared deployment.

## Running the real app

Beyond the prerequisites you need a Convex deployment. In this order:

```bash
cp env.example .env.local
npx convex dev
```

`env.example` first: `npx convex dev` provisions a deployment and fills three names in place in
`.env.local` — `CONVEX_DEPLOYMENT`, `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` (the CLI
detects SvelteKit and picks the `PUBLIC_` names). Copying the template afterwards would blank all
three. `PUBLIC_BUILD_TIME` stays empty locally. Then set the Convex-side names, listed as comments
at the bottom of `env.example`, on the deployment itself with `npx convex env set`. Real
deployment URLs are only needed to run the app, never to verify a change.

## Hermetic instance — not yet built

The recipe below is the intended next step for a `factory verify-skill` that drives the real app
without touching a shared deployment. Nothing here exists yet; do not follow it as instructions.

- Run a local `convex-local-backend` instead of a cloud deployment.
- Point a private env file (never `.env.local`) at that backend.
- Import a seed inviter and one invitation into it.
- Complete a real signup against it, then drive the surface under test.

Source: `.factory/plans/20260904-code-quality-sweep/dx-audit.md:76-86`.

## Where to look next

- `AGENTS.md` — conventions, policy and pitfalls for anyone (human or agent) editing this repo.
- `.factory/AGENTS.factory.md` — the isolate → build → prove → ship rules for factory sessions.
- `docs/product-domain.md` — the domain contract: roles, stages, permissions, transitions.
