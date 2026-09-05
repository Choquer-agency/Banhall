---
key: tests-3-runner-cleanup-and-guard
status: todo
kind: chore
deps: [tests-1-one-runner, tests-2-real-proposal-access-roster-tests]
touches: [scripts, tests, vitest.config.ts, package.json, package-lock.json, tsconfig.json, bun.lock]
risky: []
verify: [node scripts/check-test-discovery.mjs, npx vitest run tests]
done_when: ["! rg -q 'bun:test' tests", "! rg -q 'chatProposals|projectReviewAccess' vitest.config.ts", "! rg -q '@types/bun' package.json", "! rg -q '\"test/\\*\\*' tsconfig.json", ! test -e bun.lock, test -f scripts/check-test-discovery.mjs, node scripts/check-test-discovery.mjs]
title: "No bun:test, no @types/bun, no bun.lock, no test/** include; a script proves every tracked test file is discovered by one of the two vitest configs"
plan: 20260904-code-quality-sweep
ui: false
deferred: []
updated: "2026-09-05T08:42:42.317Z"
---
## Intent
For the next person who adds a test file: the two vitest configs are the only runners, and a script says so when a file lands outside them. After tests-1 and tests-2 nothing imports `bun:test`, so `@types/bun`, `bun.lock` and the by-name excludes in `vitest.config.ts` are dead weight, and `tsconfig.json:16-18` includes a `test/**` directory that does not exist. The retrospective asked for exactly this guard (`RETROSPECTIVE.md:122`: "add a CI guard that fails when a `*.test.ts` file is outside the vitest projects"). Principle: [23 encode lessons in structure]: the orphan-tests lesson becomes a check, not a paragraph; [14 migrate callers, then delete legacy]: the bun runner's last traces go in the same wave as the migration; [9 build the lever].

## Acceptance
- AC1: `vitest.config.ts` no longer excludes `tests/chatProposals.test.ts` or `tests/projectReviewAccess.test.ts` (the files are gone); `npx vitest run tests` exits 0.
- AC2: `package.json` no longer lists `@types/bun`; `package-lock.json` is regenerated (`npm install`); `bun.lock` is deleted; `npm ci` from an empty `node_modules` succeeds; `npm run check` passes (the suites are still typechecked through the kept `tests/**/*.ts` include).
- AC3: `tsconfig.json` no longer includes `test/**/*.js`, `test/**/*.ts`, `test/**/*.svelte`; the `tests/**` and `shared/**` includes stay.
- AC4: `scripts/check-test-discovery.mjs` (plain Node, no dependencies, under 60 lines) lists every `*.test.ts` tracked by git (`git ls-files -- '*.test.ts'`), runs `npx vitest list --filesOnly --json=<tmpfile> --config <cfg>` for `vitest.config.ts` and `vitest.component.config.ts` and reads the JSON from the file (never from stdout, which starts with a `[vite-plugin-svelte]` warning), normalises to repo-relative paths, prints `orphan: <path>` for each tracked file no project discovers, and exits 1 if any; otherwise prints `discovered <n> test files` and exits 0. It exits 0 at HEAD of this ticket, and exits 0 with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent` (listing the component config needs no browser: `orchestrator-review.md:21`, `discovery-without-chromium.log`, 51 files); with a probe file `scripts/zz.orphan.test.ts` outside every include, staged with `git add -N` so git ls-files sees it it exits 1 naming that file; the probe is deleted before commit and all three runs are in evidence.
- AC5: The gate (`bash scripts/loop-verify.sh`) passes. Wiring the guard into the gate and CI belongs to dx-1; this ticket only creates and proves it.

## Verification
- AC1 → `rg -n 'tests/' vitest.config.ts`; `npx vitest run tests` tail.
- AC2 → `! rg -q '@types/bun' package.json`; `! test -e bun.lock`; `rm -rf node_modules && npm ci` tail; `npm run check`.
- AC3 → `! rg -q '"test/\*\*' tsconfig.json`; `rg -n 'tests/\*\*|shared/\*\*' tsconfig.json`.
- AC4 → `node scripts/check-test-discovery.mjs` (exit 0, count); `PLAYWRIGHT_BROWSERS_PATH=/nonexistent node scripts/check-test-discovery.mjs` (exit 0, same count); probe run (exit 1, `orphan: …`); `! test -e <probe>`.
- AC5 → gate output tail.

## Implementation notes
- Guard: `execFileSync("npx", ["vitest", "list", "--filesOnly", `--json=${tmp}`, "--config", cfg], { stdio: "ignore" })` then `JSON.parse(readFileSync(tmp))`; write the temp file under `os.tmpdir()` and delete it. Do not parse stdout: on the component config it begins with a Vite warning containing `[vite-plugin-svelte]`, so "first `[`" is wrong (`orchestrator-review.md:21`). The DX audit's 128-file count was the root config alone (`dx-audit.md:33`); the component config lists 51 more.
- Compare as sets of repo-relative POSIX paths. No allowlist: a deliberately unrun test is a decision for a future ticket, not a flag.
- `bun.lock`: confirm with `rg -n 'bun' .github/workflows scripts package.json` that nothing consumes it (CI runs `npm ci`; `loop-verify.sh` runs `npm ci`), then `git rm bun.lock`.
- Do not edit `scripts/loop-verify.sh`, `.github/workflows/ci.yml` or `README.md` (dx-1).

## Edge cases
- `npx vitest list` in a worktree with an empty `node_modules`: the script prints the resolution error and exits 1; the gate runs `npm ci` first, so in practice the guard runs after install.
- A `*.test.ts` under `node_modules` or `.svelte-kit`: `git ls-files` never lists them.
- A component test that the root config also matches (`src/**/*.test.ts` includes `*.component.test.ts` before the exclude): the union of both listings is what counts; a file discovered by either config is not an orphan.
- Run twice: idempotent.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.

Run each verification command exactly as listed before trying shell additions. Pipes, redirects, an appended echo, or a redundant rm command can make an otherwise allowed command fail the QA tool check. Use the tool result or engine gates file for the exit status. Bare npm ci already replaces an existing node_modules directory. Run dependency installation before, and never concurrently with, tests or builds in that worktree.

Scope sequencing: tests-2 is approved to remove the two temporary named Vitest exclusions together with their files. AC1 here verifies their absence and the retained tests; no edit is needed when already satisfied.

Negative-control clarification: src/lib/zz.orphan.spec.test.ts is discovered by src/**/*.test.ts and is not an orphan. Use only the scripts/zz.orphan.test.ts probe above, stage intent-to-add, capture exit 1 naming it, then remove the probe and its index entry before commit.
