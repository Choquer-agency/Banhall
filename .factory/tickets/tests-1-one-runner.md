---
key: tests-1-one-runner
status: done
kind: refactor
deps: []
touches: [tests, vitest.config.ts]
risky: []
verify: [npx vitest run tests, npx vitest run convex/lib/snapshots.test.ts]
done_when: ["test \"$(rg -l 'bun:test' tests | wc -l | tr -d ' ')\" -eq 2", "rg -q 'tests/\\*\\*/\\*\\.test\\.ts' vitest.config.ts", "rg -q 'tests/chatProposals.test.ts' vitest.config.ts", "! rg -q 'snapshot audit state' tests/snapshots.test.ts", npx vitest run tests]
title: The twelve pure suites under tests/ run under vitest unchanged; the one superseded snapshot case retires with its mapping; the two fake-db suites are excluded by name for tests-2
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T08:20:43.009Z"
run: 20260905-072238-8-tickets
branch: factory/tests-1-one-runner
merged: 78e573c
verdict: test-verified
evidence: .audit/tests-1-one-runner/evidence.md
---
## Intent
For every agent and human who runs `npm test`: the pure behaviour tests under `tests/` stop being invisible. Twelve files import `bun:test` and no script, gate or CI job runs them (`vitest.config.ts:29` includes only `tests/aiUsage.test.ts`; `dx-audit.md:33`; `deferred-work.md` DW-10). `orphan-test-map.md:9-21` shows none of their subjects has a direct counterpart elsewhere (`diffWords`, `parseCanonicalReport`, `applyReplacements`, `issueDeduction`, `pickScienceRouted`, `candidateModelsForMode`, the CRA catalogue, `canUseIndustry`, the 78-character wrap boundaries, export preflight and metadata limits, `snapshotIdsToDelete`, `buildMilestoneOptions`, `userDisplayLabel`). Under bun they pass (`slop-audit.md:42-46`; the one failing pure case, `snapshots:84`, is superseded by `convex/lib/snapshots.test.ts:91,126`). The two suites built on a handmade database (`chatProposals`, `projectReviewAccess`) are tests-2's work and stay excluded by name until then. The maintainer inherits one runner and a `tests/` directory vitest includes like any other. Principle: [1 laziness protocol] for the one-line include instead of moving twelve files; [18 sequence work into verifiable units] for leaving the real-endpoint ports to tests-2.

## Acceptance
- AC1: `tests/{diff,reportSections,reportEdits,qaScoring,brainScienceRouting,generationMode,craScienceCodes,industries,lineLimits,exportValidation,snapshots,teamRoster}.test.ts` import `describe`, `expect`, `test` from `vitest`; no assertion changes in the ten whole-file suites. `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts` are untouched (still `bun:test`).
- AC2: `vitest.config.ts` includes `tests/**/*.test.ts` in the `convex` project (replacing `tests/aiUsage.test.ts`) and excludes `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts` with a one-line comment naming `tests-2-real-proposal-access-roster-tests`. `npx vitest run tests` exits 0 and lists all 13 files (12 plus aiUsage).
- AC3: `tests/snapshots.test.ts` keeps "snapshot retention" (`:13`) and both "milestone picker" cases (`:44,60`); the "snapshot audit state" case (`:83-160`) and any import only it used are deleted; `decisions.tsv` records `superseded: convex/lib/snapshots.test.ts::reads a legacy generation as the set of one it is; ::restores the set from matching provenance and drops it with a stale one`.
- AC4: `tests/teamRoster.test.ts` keeps all four cases for now (the two fake-ctx cases at `:56,71` pass under bun and under vitest; tests-2 replaces them with real rows and deletes them). `decisions.tsv` records that handoff.
- AC5: `npm run check` and `npm test` pass; evidence shows the bun pass count per file before (`bun test tests/<file>` with `~/.bun/bin/bun`, 1.3.14) next to the vitest pass count per file after, equal for every kept file.

## Verification
- AC1 → `rg -l 'bun:test' tests` lists exactly the two excluded files; `rg -c 'from "vitest"' tests` shows 13.
- AC2 → `rg -n 'tests/' vitest.config.ts`; `npx vitest run tests` tail in evidence (13 files).
- AC3 → `decisions.tsv`; `npx vitest run tests/snapshots.test.ts convex/lib/snapshots.test.ts`.
- AC4 → `decisions.tsv`; `npx vitest run tests/teamRoster.test.ts`.
- AC5 → gate (`bash scripts/loop-verify.sh`); per-file before/after table in evidence.
Refactor pin: the bun run before conversion is the pin; the vitest run after must report the same case names and counts for every kept file. The old failure (bun: `snapshots` 1 fail) sits next to the new pass in evidence.

## Implementation notes
- `vitest.config.ts:29`: `include: ["convex/**/*.test.ts", "tests/**/*.test.ts"]`, `exclude: [...configDefaults.exclude, "tests/chatProposals.test.ts", "tests/projectReviewAccess.test.ts"]` (spread the defaults back in, as the `src` project does at `:49`). The `convex` project runs under `edge-runtime` and already runs `tests/aiUsage.test.ts` with the same import style. If a converted suite fails only because of the environment (a missing global), add a fifth project `{ name: "tests", include: ["tests/**/*.test.ts"], exclude: [...], environment: "node" }` and move the include there; never add `sveltekit()` or the svelte plugin.
- `tests/exportValidation.test.ts:8` imports `src/lib/exportTemplateDocx` (JSZip; browser-only at export time, import-safe here). Its `exportToTemplateDocx` case rejects before any template fetch; keep it (`orphan-test-map.md:18`).
- `tests/lineLimits.test.ts` overlaps `convex/lib/lineLimits.test.ts` on some cap cases; keep both as they are (`orphan-test-map.md:17`: neither makes the other redundant).
- Do not touch `package.json`, `tsconfig.json`, `bun.lock` (tests-3), `convex/` tests (tests-2) or product code. Do not touch `convex/_generated/`.
- What to delete: one snapshot case and its exclusive imports. Nothing else.

## Edge cases
- A kept case passes under bun and fails under vitest for a matcher difference (`toBeCloseTo`, error matching): fix the assertion to the vitest matcher; record it; the behaviour asserted stays the same.
- `npm run check` reports a type error in a converted suite because `bun:test` typed `expect` more loosely: fix the test's types, not `tsconfig`.
- Run twice: converting an already-converted file is a no-op; the predicates are idempotent.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.

Run each verification command exactly as listed before trying shell additions. Pipes, redirects, an appended echo, or a redundant rm command can make an otherwise allowed command fail the QA tool check. Use the tool result or engine gates file for the exit status. Bare npm ci already replaces an existing node_modules directory. Run dependency installation before, and never concurrently with, tests or builds in that worktree.
