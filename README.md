# Banhall

Banhall generates SR&ED reports for a consulting firm. It uses SvelteKit 2, Svelte 5, Tailwind CSS and Convex. The domain contract is in [docs/product-domain.md](docs/product-domain.md); repository conventions are in [AGENTS.md](AGENTS.md).

## Run the app

Use Node 24 from `.nvmrc` and install this checkout's dependencies with `npm ci`.
For initial setup, copy the example before provisioning Convex:

```bash
if [ ! -e .env.local ]; then
  cp env.example .env.local
fi
npx convex dev
```

The copy preserves an existing `.env.local`; add only missing entries from the
example when updating an already configured checkout. Follow the Convex prompts
to select or create the intended development deployment.
The CLI populates `CONVEX_DEPLOYMENT`, `PUBLIC_CONVEX_URL` and
`PUBLIC_CONVEX_SITE_URL` in `.env.local` for SvelteKit. Keep those generated
values; do not copy the blank example over them afterward. Both public URLs
are consumed by the app's auth integration. The backend auth `SITE_URL` is a
separate setting, not `PUBLIC_CONVEX_SITE_URL`.

Configure backend provider, auth and ingest settings on the Convex deployment
as needed for the features you use. `env.example` lists the declared optional
app names separately from direct environment reads and the installed auth
library's secret. These backend settings are not frontend assignments.

`ANTHROPIC_TRANSPORT` chooses where Anthropic models run. Leave it unset (or
`direct`) to call Anthropic with `ANTHROPIC_API_KEY`. Set it to `openrouter`
to call them through OpenRouter, pinned to Anthropic's own endpoint and billed
to OpenRouter credits, with `OPENROUTER_ANTHROPIC_API_KEY` (or
`OPENROUTER_API_KEY`). The report chat assistant still calls Anthropic
directly. Before switching, turn off prompt logging and data use in the
OpenRouter account; to roll back, set it to `direct`. The full note is under
owner decision 30 in `docs/product-domain.md`.

With `npx convex dev` running, start the app in another terminal:

```bash
npm run dev
```

The app runs at `http://localhost:3001`. For a frontend deployment, supply the
matching `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` settings.
`PUBLIC_BUILD_TIME` is an optional timestamp you supply at build/deploy time;
blank or invalid values hide the stamp.

### Several local apps at once

Browsers share cookies across every port on `localhost`. Two Banhall apps
running at once, such as a test app on 5173 and the demo on 5175, overwrite
each other's sign-in. Give each Convex deployment its own cookie names with
`BETTER_AUTH_COOKIE_PREFIX`:

| Apps | Value |
| --- | --- |
| Apps on the e2e deployment | `banhall-e2e` |
| The demo app | `banhall-demo` |

Set the value in two places, and keep them the same: on the Convex deployment,
and in that checkout's `.env.local` so the SvelteKit server reads the same
cookies. Restart the app after changing `.env.local`. Apps that use the same
Convex deployment share one sign-in. Changing the value signs that app out
once. Use letters, digits, dots, underscores and hyphens only.

Leave it unset in production and on preview deployments. Unset keeps the
default `better-auth.*` cookie names, so nobody is signed out. Open local apps
at `http://localhost:<port>`; `127.0.0.1` and LAN addresses are not trusted
for sign-in.

## Verification

Install Node 24 (pinned in `.nvmrc`, with npm), PowerShell 7 (`pwsh`), and Git. Install this checkout's lockfile dependencies, then run:

```bash
npm ci
bash scripts/loop-verify.sh
```

Run `npm ci` inside each fresh checkout and after dependency changes. The gate only bootstraps an empty `node_modules`; it does not validate an existing installation for freshness or ownership.

The gate checks prerequisites, installs dependencies into an empty checkout, typechecks Convex and Svelte, runs unit tests, checks test discovery, builds the app and runs both client-uploader harnesses. It supplies public placeholder Convex URLs when unset, so verification does not require a deployment.

To include browser component tests, install Chromium once and enable the ninth step:

```bash
npm ci
npx playwright install chromium
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
```

On Linux, use `npx playwright install --with-deps chromium` to install browser system dependencies too. Optional preflight launches and closes headless Chromium to check readiness.

`npm test` is browser-free. Run the component suite before changing `src/lib/components`. CI defines separate verification and component jobs; the component job installs Chromium. Required status checks are configured separately in branch protection.

The discovery guard accounts for three exact historical QA source copies retained under `.audit/integration-code-review-9da55be/qa-structural-boundary-input/`. Every other tracked `*.test.ts` file must be discovered by one of the two canonical Vitest configurations.

Existing component tests write screenshots into tracked historical `.audit` paths. Check `git status` and screenshot diffs after a browser run. Preserve intentional new evidence, but restore only generated changes to historical outputs that the task requires keeping unchanged; do not discard unrelated work.
