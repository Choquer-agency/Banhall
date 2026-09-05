# Banhall

Banhall generates SR&ED reports for a consulting firm. It uses SvelteKit 2, Svelte 5, Tailwind CSS and Convex. The domain contract is in [docs/product-domain.md](docs/product-domain.md); repository conventions are in [AGENTS.md](AGENTS.md).

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
