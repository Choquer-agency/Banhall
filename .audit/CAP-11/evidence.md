# CAP-11 verification evidence

Baseline: `f122b086d745acc40b4decca26b9aaafc7257f6a`.

Scope: dispatched story `11-chat-spend-budget-and-queue-limit.md`, in the existing engine worktree. No generated source files were edited. The additional root `tsconfig.json` include list preserves Svelte generated categories and includes `shared/**/*.ts`; it fixes the baseline OXC failure loading `shared/workItems.ts` through inherited include paths.

## Acceptance mapping

All admission tests exercise public `api.chatV2.sendMessage` with the real agent component registered in convex-test and frozen time. Settings tests exercise public `api.appSettings.setChatAdmissionLimits`. They do not call a model.

| Acceptance or matrix row | Proof in `convex/chatTurns.test.ts` |
| --- | --- |
| Default allowance, exact USD 50, authenticated sender stored | `admits exactly the default budget, sums all call sites, and rejects without side effects` |
| Recorded project costs across non-chat call sites, strict budget comparison | Same test seeds two generation usage records, admits USD 50, rejects USD 50.01 |
| Inclusive window endpoints; old, future, and other-project exclusion | `includes both window endpoints and excludes old, future, and other-project cost` |
| No thread/message/turn/job on spend refusal, including new-thread path | First test compares complete app thread/turn/job records plus real component thread and message queries before and after both refusal paths |
| Cross-project sender queue and other-sender isolation; no refusal side effects | `counts queued turns across projects and releases capacity on start` |
| Queued capacity released by running; all terminal statuses excluded | Cross-project test uses `markTurnStarted`; `running and all terminal states do not consume queued slots` covers running/completed/failed/aborted |
| Legacy sender from component prompt, never thread creator | `legacy shared turns use prompt sender and tolerate missing prompt ownership` and `legacy prompts without this sender never inherit the thread creator` |
| Missing legacy prompt/owner tolerated; modern plus legacy counts combined | Second legacy test deletes a real prompt and uses an ownerless thread; then mixes legacy and modern accepted sender turns |
| Fractional administrator USD and persisted queue immediately applied | `administrator settings immediately control both limits` |
| Invalid values and unauthenticated/non-admin/anonymous-admin updates atomic | `invalid and unauthorized setting updates preserve both values atomically` |
| Malformed stored values fall back per field | Parameterized `stale settings fall back independently` cases |
| Additive schema, complete indexed cost sum, unchanged context constants | `convex/schema.ts`, `convex/aiUsage.ts`; original bounded context tests retained in focused/full suite |

## Limits

Admission uses already-recorded cost, without reserving in-flight spend. Complete usage range reads and legacy prompt attribution remain subject to Convex transaction limits; no truncation or backfill is introduced.

## Verification history

- Initial focused verification could not load `shared/workItems.ts`: OXC reported `TSCONFIG_ERROR` / `Tsconfig not found`, before any tests ran. Running `svelte-kit sync` alone did not resolve it. The explicit root include list fixed resolution.
- The first complete `npm test` run reached 126 passing files and 1,368 passing tests; an unrelated form-control contract test exceeded its 5-second timeout under concurrent host load. The reduced-worker run also reached 126 passing files and 1,369 passing tests but hit the same five-second timeout. The final run adds command-line `--testTimeout=30000` alongside `--maxWorkers=2`; no repository timeout settings change.
- A new legacy fixture initially omitted `userId` on an owned thread; the real agent library filled the prompt owner from that thread. The corrected fixture creates a truly ownerless prompt and explicitly asserts the saved prompt owner, then separately tests another sender on the authenticated sender's thread. The focused suite passes all 42 tests.
- An intermediate full run loaded that old fixture and was terminated before the final run; its output is not used as passing evidence.

## Verified implementation

Exact implementation commit: `88142ded047c1ad9c86dc234d8200259712e0e36`.

Command: `npx vitest run --project convex convex/chatTurns.test.ts`

Recorded output: `.audit/CAP-11/logs/focused.log`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11


 Test Files  1 passed (1)
      Tests  42 passed (42)
   Start at  12:28:37
   Duration  26.23s (transform 13.21s, setup 0ms, import 10.94s, tests 13.05s, environment 768ms)

```

Command: `npm test -- --maxWorkers=2 --testTimeout=30000`

Recorded output: `.audit/CAP-11/logs/full-verified.log`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11


 Test Files  127 passed (127)
      Tests  1370 passed (1370)
   Start at  12:34:09
   Duration  67.21s (transform 32.82s, setup 0ms, import 41.47s, tests 39.77s, environment 8.27s)

```

Command: `PUBLIC_CONVEX_URL=http://localhost npm run check`

Recorded output: `.audit/CAP-11/logs/check.log`

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

`git diff --check` passed with no output before committing. All 127 test files / 1,370 tests pass with the command-line host-contention allowance; focused 42 tests pass, and the required check reports zero errors and warnings. No functional scope remains incomplete.

## Review patch

The review found binary floating-point accumulation violated the strict budget boundary: a public send with usage `0.1 + 0.2` was rejected against a `0.3` setting. The added public mutation regression failed before the fix against source revision `55caeff` (same implementation as `88142de`); `.audit/CAP-11/logs/review-red.log` records that actual failure.

`usdDecimalUnits` parses each finite number's canonical decimal representation, including scientific notation, into BigInt units at 324 decimal places. This covers the canonical decimal representation of every finite Number, including `Number.MIN_VALUE`, without rounding or truncating any cost. `projectRollingCostUsdUnits` sums those exact local units over the complete indexed range, and admission compares against the budget converted to the same units. BigInt arithmetic stays within the mutation; usage storage and logging do not change.

Additional public mutation regressions:

| Review request | Proof in `convex/chatTurns.test.ts` |
| --- | --- |
| Exact decimal budget boundary, meaningful excess | `compares exact decimal costs at a fractional budget` admits `0.1 + 0.2` at `0.3`, then rejects another `0.000001` |
| Scientific notation and tiny costs remain significant | Parameterized `preserves scientific-notation cost ... without rounding away an excess` uses `1e-20` and `Number.MIN_VALUE` |
| Repeated fractions and no arbitrary range truncation | `sums 10000 fractional rows exactly and includes the decisive last range row` admits 10,000 rows of `0.00003` at `0.3`, then rejects the 10,001st row |
| Actual mixed call sites | Default-budget test now combines `chat` and `generation:242`; exact-decimal test also uses `financial`, and the large fixture alternates chat/financial |
| Malformed budget fallback enforced without queue masking | Four `malformed budget ... rejects over default with free queue and no side effects` cases compare complete refusal state |
| Valid fractional budget independent of malformed queue | `keeps a valid fractional budget while a malformed queue independently defaults to three` proves both queue default and persisted `0.3` spend limit with capacity released |
| Updates take effect, no duplicate settings | `updates both existing settings without duplicate keys and immediately raises or lowers admission` exercises both directions for both values and verifies exactly two key rows |
| Expired usage releases spend block | `readmits a blocked project after recorded usage expires` advances frozen time beyond 24 hours and admits a formerly blocked project |

The complete suite passed before a behavior-preserving helper rename. The post-rename focused suite and type check verify the final source spelling; no repeat broad run was needed for that rename.

### Final review-patch verification

Exact final source revision: `145a1feabdcda68a6d78e7204ce5b0f3906161bb`.

Command: `npx vitest run --project convex convex/chatTurns.test.ts`

Output: `.audit/CAP-11/logs/review-focused-renamed.log`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11


 Test Files  1 passed (1)
      Tests  53 passed (53)
   Start at  12:41:35
   Duration  2.38s (transform 756ms, setup 0ms, import 724ms, tests 1.46s, environment 51ms)

```

Command: `npm test -- --maxWorkers=2 --testTimeout=30000`

Output: `.audit/CAP-11/logs/review-full.log`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11


 Test Files  127 passed (127)
      Tests  1381 passed (1381)
   Start at  12:41:03
   Duration  24.64s (transform 6.74s, setup 0ms, import 13.07s, tests 12.01s, environment 4.77s)

```

Command: `PUBLIC_CONVEX_URL=http://localhost npm run check`

Output: `.audit/CAP-11/logs/review-check.log`

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-chatspend/.bmad-loop/runs/20260904-121647-f30f/worktrees/11
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

Final result: 53 focused tests, all 127 files / 1,381 full-suite tests, and zero type-check errors or warnings. `git diff --check` passed. All six review patch requests are addressed, with the intent contract and story file unchanged.

## Final parent verification

The normal `npm test` command passed after host contention eased: 127 files and 1381 tests, 35.02 seconds, exit 0. Full output: `.audit/CAP-11/logs/final-default.log`. This supersedes the earlier default-command timeout limitation. The verified source revision remains `145a1feabdcda68a6d78e7204ce5b0f3906161bb`; subsequent changes only record evidence and story completion. Parent independently inspected the complete implementation, expanded tests, acceptance mapping, and successful check output.
