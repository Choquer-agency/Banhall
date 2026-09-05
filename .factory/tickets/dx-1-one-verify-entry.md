---
key: dx-1-one-verify-entry
status: todo
kind: chore
deps: [tests-3-runner-cleanup-and-guard, ui-1-component-suite-green]
touches: [scripts, docs, .github, AGENTS.md, README.md, env.example, .nvmrc, .factory/factory.toml]
risky: []
verify: []
done_when: ["rg -q 'check-test-discovery' scripts/loop-verify.sh", "rg -q 'preflight' scripts/loop-verify.sh", "rg -q 'loop-verify.sh' .github/workflows/ci.yml", "rg -q 'test:component' .github/workflows/ci.yml", test -f .nvmrc, "! rg -q 'create-next-app|app/page.tsx|localhost:3000' README.md", "! rg -q 'NEXT_PUBLIC' env.example", "rg -q 'historical' docs/bmad-loop.md docs/svelte-migration.md", "rg -q 'test:component' .factory/factory.toml", "! rg -q 'CI runs only' AGENTS.md"]
title: "One verification entry point: loop-verify.sh preflights and names its steps and runs the discovery guard; CI runs the gate script and the browser suite; README and env.example describe this app"
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T06:29:26.993Z"
---
## Intent
For the next agent opening this repo cold: the README says what the app is and gives one command that proves a change; that command fails fast with the name of a missing tool, prints each step with its time, and runs the discovery guard from tests-3; CI runs exactly that command plus the browser suite, so CI and the factory gate cannot drift again. Today `README.md:1-19` is the `create-next-app` template (port 3000, `app/page.tsx`), `env.example` uses `NEXT_PUBLIC_*` names, CI (`ci.yml:28-38`) runs two of the gate's six steps on Node 22 while the changelog workflow and this Mac run Node 24, `loop-verify.sh` discovers a missing `pwsh` after three minutes of typechecking, and 51 browser test files run in no gate (`dx-audit.md:7-19,31-35`). The maintainer inherits one script, one CI job that calls it, and docs that stop contradicting `.factory/AGENTS.factory.md`. Principle: [5 minimize reader load] and [13 idempotent] for CI calling the gate script instead of restating it; [24 exit condition as predicate]: the browser job is added only now that ui-1 made it green and tests-3 made the guard pass.

## Acceptance
- AC1: `scripts/loop-verify.sh` starts with a `preflight` step that checks `node` (major 22 or newer), `npm`, `pwsh`, and prints where `PUBLIC_CONVEX_URL` came from (env or the placeholder); a missing tool exits 1 before any typecheck with the tool's name and one install hint. Every step prints `[n/N] <name>` before and `ok <seconds>s` after; a failing step prints its name and exits with that step's code. `node scripts/check-test-discovery.mjs` runs as a step after `npm test`. With `VERIFY_COMPONENT=1` the preflight also checks the Chromium executable exists (via `playwright`'s `chromium.executablePath()`) and the script runs `npm run test:component` as the last step; default is off so `[verify].commands` stays browser-free.
- AC2: `.github/workflows/ci.yml` has a job that runs `bash scripts/loop-verify.sh` (Node from `.nvmrc`, `PUBLIC_CONVEX_URL` placeholder kept) and a second job that runs `npx playwright install --with-deps chromium` then `npm run test:component`; both jobs are required (no `continue-on-error`). `.nvmrc` contains `24`. The `Typecheck (svelte-check)` and `Unit tests (vitest)` steps are removed (the script runs them).
- AC3: `README.md` is rewritten for this app: what Banhall is (one paragraph), prerequisites (Node 24 via `.nvmrc`, npm, PowerShell for the uploader harness, Chromium once via `npx playwright install chromium`), `npm run dev` on port 3001, `PUBLIC_CONVEX_URL` placeholder for typechecks, the one verification command and `VERIFY_COMPONENT=1`, what running the real app needs beyond that (a Convex deployment and the env names in `env.example`), that verification never uses a shared deployment, and a short "hermetic instance" section stating the recipe from `dx-audit.md:76-86` (local `convex-local-backend`, private env file, imported inviter and invitation, real signup) as the next step for `factory verify-skill`, explicitly marked not yet built. Pointers to `AGENTS.md`, `.factory/AGENTS.factory.md`, `docs/product-domain.md`.
- AC4: `env.example` lists the public names consumed by the app and uploader setup: `PUBLIC_CONVEX_URL` (`src/routes/+layout.svelte:11`, `ProjectWorkflowMenu.svelte:258`), `PUBLIC_CONVEX_SITE_URL` (`scripts/client-uploader/setup.sh:39`, uploader setup reads `.env.local`; name that consumer in the template comment), `PUBLIC_BUILD_TIME` (`src/lib/components/BuildStamp.svelte:10`), and, as comments, the Convex-side names from `convex/convex.config.ts:20-38` and `convex/auth.ts` (`SITE_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_SECRET`); names only, no values. `PUBLIC_AGENT_CHAT` and `PUBLIC_SITE_URL` are not listed: neither has a reader outside `src/lib/test/env-static-public-stub.ts`.
- AC5: `docs/bmad-loop.md:52-72` (in-place work, symlink `node_modules`, copy `.env.local`) and `docs/svelte-migration.md:87` (use the shared :3001 server) each get a one-line note marking the recipe historical and pointing to `README.md` and `.factory/AGENTS.factory.md`; also mark the obsolete browser-gate claim at `docs/bmad-loop.md:81` historical. Update only the Running and verifying bullets in `AGENTS.md` to name the default browser-free `bash scripts/loop-verify.sh`, optional `VERIFY_COMPONENT=1`, and the two CI jobs; preserve the requirement to run component tests before component edits and all product policy. Close only Q8 in `docs/system-map.md:414` with the actual test migration and CI outcome, linking the commands; other rows stay unchanged.
- AC6: `.factory/factory.toml` `[qa].smoke` is `["npm run test:component"]`; `[verify].commands` is unchanged.

## Verification
- AC1 → `bash scripts/loop-verify.sh` full output with the numbered steps; a run with `pwsh` hidden from `PATH` exits 1 at step 1 naming `pwsh`; `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` runs the browser step and exits 0.
- AC2 → `rg -n 'loop-verify.sh|test:component|node-version-file|continue-on-error' .github/workflows/ci.yml` (last pattern must not match); `cat .nvmrc`. CI itself runs on push by a human (`factory ship`); this ticket cannot observe it and says so in evidence.
- AC3, AC4 → the `done_when` `rg` predicates; a reviewer reads the README against `package.json` scripts and `vite.config.ts:8-14`; inspect actual reads in `src/routes/+layout.svelte`, `ProjectWorkflowMenu.svelte`, `BuildStamp.svelte`, and `scripts/client-uploader/setup.sh:39`; comments and test stubs are not runtime consumers. Confirm each documented name against those readers.
- `verify` is empty on purpose: `[verify].commands` already runs `bash scripts/loop-verify.sh`, and the engine appends ticket `verify` to it, so naming it again would run the gate twice per fix loop.
- AC5 → `rg -n 'historical' docs/bmad-loop.md docs/svelte-migration.md`.
- AC6 → `rg -n 'smoke' .factory/factory.toml`.

## Implementation notes
- `loop-verify.sh`: keep `set -euo pipefail`, the `npm ci` on empty `node_modules`, the `PUBLIC_CONVEX_URL` default and the step order (preflight, convex tsc, check, test, guard, pwsh harness, bash harness, optional component). A `step()` function that prints the banner, times the command and exits on failure is enough; no colours, no new dependencies. `pwsh` is preinstalled on `ubuntu-latest`; do not add a PowerShell install step.
- CI: two jobs, both `actions/setup-node@v4` + `node-version-file: .nvmrc` + `cache: npm` + `npm ci`. The component job needs `--with-deps` for the runner's system libraries. Keep the existing concurrency block.
- Do not create `.factory/verify/` here (inventory #29 in `research.md`). Do not add ESLint; `npm run lint` stays an alias of `check`. Do not change `vitest.config.ts`, `vitest.component.config.ts`, `package.json` dependencies or `scripts/check-test-discovery.mjs`.
- Delete: the README template text, the `NEXT_PUBLIC_*` lines, the two CI steps the script replaces.

## Edge cases
- `VERIFY_COMPONENT=1` without Chromium: preflight names Chromium and prints `npx playwright install chromium`; the browser step never starts.
- A worktree with no `node_modules`: the script's `npm ci` runs before preflight's `npx`-dependent checks; order the Chromium check after install.
- The guard fails in CI because a branch added a test outside the includes: that is the intended failure; the message names the file.
- Run twice: every edit is idempotent; the script leaves no files behind.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.
