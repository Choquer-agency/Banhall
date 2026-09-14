# PR #11 Greptile findings — fix evidence

Branch `fix/pd1-greptile`, base `36a234d`. Worktree `.factory/worktrees/pd-validate-a`.
Every finding was reproduced by a failing test on the unmodified source before the fix
(`*-before.raw.log`), then shown passing (`*-after.raw.log`). Env for every run:
`PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site`.

## Finding 1 — Brief reads lack authorization (`convex/briefs.ts`)

Backport of the later stack's fix (`git show 55011ea:convex/briefs.ts`, commit ba845a8):
`getBrief` and `listBriefEntries` call `getInternalProjectAccessOrNull(ctx, projectId)` and
return `null` for an unauthenticated caller, a mapped user with no internal role, or a missing
row. `listBriefEntries` now returns `null` (was `[]`) for a missing Brief so the null contract
matches the later stack exactly and the merge is trivial. Access is checked before any entry
read, so a probe cannot distinguish a real Brief from an invented id.

Callers: no `src/` or non-test `convex/` caller of `api.briefs.getBrief` / `listBriefEntries`
exists at this commit (grep in `finding1` step); the only consumer was the existing test,
updated to read as the writer identity exactly as the later stack's version of that test does.

Tests (`convex/ai/brief.test.ts`):
- existing "getBrief and listBriefEntries read the stored Brief for the UI panel" — now reads
  through `t.withIdentity({ subject: "brief-writer" })` (admin user) and asserts non-null.
- new "getBrief and listBriefEntries return null to an unauthenticated caller and to a
  non-internal user" — unauthenticated `t.query` and a `withIdentity` user with no `role`.

Before (`finding1-before.raw.log`, unmodified `briefs.ts`): the unauthenticated `getBrief`
returned the full Brief with entries.
```
 Tests  1 failed | 1 passed | 11 skipped (13)
```
After (`finding1-after.raw.log`, whole file):
```
 Tests  13 passed (13)
```

## Finding 2 — Removed entries remain active (`convex/generations.ts` renderBriefForGeneration)

At `36a234d` only `renderBriefForGeneration` lacked the filter; `loadBriefCheck` (the other
prompt reader, used by `claimOrderedSectionRun` and the Self-check) already applied
`entry.change !== "removed"`. Ported the later stack's filter and comment
(`git show 738331e:convex/generations.ts`, commit 90215c0) so both readers render exactly the
same rows: `entries.filter((e) => e.group !== "storylineQuestion" && e.change !== "removed")`.

Test (`convex/ai/brief.test.ts`): "renderBriefForGeneration omits a re-derivation's change:
removed entries from the section prompt" — seeds a version-2 Brief directly with one live and one
`change: "removed"` row in each rendered group (claimExclusion, confidenceMap, glossaryTerm),
then queries `internal.generations.renderBriefForGeneration` and asserts every LIVE text is
present and no REMOVED text is. (The block renders `storylineText`, not storyline claim rows, so
those carry no assertion.)

Before (`finding2-before.raw.log`): the rendered block listed `REMOVED exclusion`,
`REMOVED confidence fact` and `REMOVED term`.
```
 Tests  1 failed | 13 skipped (14)
```
After (`finding2-after.raw.log`, `brief.test.ts` + `briefPipelineWiring.test.ts`):
```
 Tests  16 passed (16)
```

## Finding 3 — DW-119: Progressing chains appear stale + Section actions can time out

Approved ledger decision (DW-119, 2026-09-14): "Use progress-aware recovery — Approve timeout
semantics in the existing reaper, preserve single recovery ownership and test slow-active versus
stalled chains." No new reaper (AD-24), the 30-minute window and the cron cadence are unchanged.

### Design

- `convex/schema.ts`: `generations.lastProgressAt: v.optional(v.number())` — optional, so every
  existing row (iterative, legacy, reserved) validates unchanged and falls through to the
  previous `startedAt` behaviour.
- Stamped by the three ordered-chain mutations in `convex/generations.ts`, each already fenced
  by `orderedChainFence`:
  - `createOrderedSectionRuns` — added to the existing `progressLog` patch (no extra write);
  - `claimOrderedSectionRun` — one new `patch(generation, { lastProgressAt })` when a section
    action starts its work, so the window measures from the start of the current action;
  - `completeOrderedSectionRun` — added to the existing `progressLog` patch, i.e. the moment a
    section is drafted and the next section (or finalize) is scheduled.
- `failStaleGenerations`: after the iterative branch and before the whole-generation fail, a
  running non-iterative generation whose `lastProgressAt >= cutoff` is skipped (`continue`).
  Selection still uses the `by_status_and_startedAt` index with `startedAt < cutoff`; the skip is
  applied per row. Iterative rows never carry the stamp and the condition excludes them
  explicitly, so their per-section path is byte-for-byte the previous one.
- Finalize (`finalizeOrderedCandidate`) does not stamp: it is scheduled in the same transaction
  as the last section's stamp and, being one Convex action, either completes the candidate or
  dies within the action limit — well inside the 30-minute window measured from that stamp.
- Compare mode: both candidates stamp the shared generation. A stuck candidate is therefore
  reaped 30 minutes after the *other* candidate's last progress at the latest; nothing is reaped
  while any chain of the generation is still moving.

### How this bounds the "Section actions can time out" finding

The finding: one `generateOrderedSection` action may run draft + two compression squeezes +
Self-check + repair sequentially, each Anthropic call allowing two 240 s attempts, so the action
can overrun Convex's action limit before `completeOrderedSectionRun` or `failOrderedSectionRun`
runs; the section row stays `running` and the chain stalls. Provider timeouts were explicitly left
untouched (the task forbids changing them; DW-70 orchestration redesign was deferred by the owner).

With progress-aware recovery the damage is bounded as follows: a timed-out action is, by
definition, an action that never reached its completion mutation, so it never stamps
`lastProgressAt` again. The generation's last stamp is that section's claim (or the previous
completion), so the reaper fails the generation (and, through
`terminalizeOrphanedCandidateRuns`, its candidate runs) within 30 minutes of the overrun plus the
10-minute cron cadence, exactly as before DW-119 — while a chain that is merely slow but still
completing sections is no longer collateral damage. What changes for the writer is therefore only
the false-positive case (a live chain killed at 30 minutes wall-clock); the stuck case keeps its
existing recovery owner and latency. Anything tighter (per-section deadlines, splitting the
section action, shortening the window for ordered chains) is an orchestration change under
DW-70 and is not warranted by this finding alone; the `ORDERED_SECTION_ACTION_SLOTS` comment in
`convex/ai/providers.ts` now records the recovery path so the bound is documented next to the
slot count it qualifies.

### Tests (`convex/orderedChainRecovery.test.ts`, new file)

Time moves only via `vi.setSystemTime`, so convex-test's scheduled chain actions never fire; the
chain is driven through the real fenced mutations (`createOrderedSectionRuns` →
`claimOrderedSectionRun` → `completeOrderedSectionRun`) and then `failStaleGenerations`
(`olderThanMinutes: 30`) is invoked as the cron does.

- (a) slow but live compare chain: s242 drafted at T0+25, s244 claimed; reaper at T0+35 → not
  failed; s244 drafted at T0+55, s246 claimed; reaper at T0+65 → still running, candidate run
  running, project pointer intact.
- (b) stalled single chain: s242 drafted at T0+20, s244 claimed and its action dies; reaper at
  T0+49 (29 min after last progress) → live; reaper at T0+51 → generation failed with the existing
  copy, candidate run failed ("Timed out before the draft completed."), project freed to `draft`.
- (b') first-section action that never completes: reaped 31 minutes after its claim.
- (c) iterative unchanged: stale running section run → `awaiting_input`, section `failed` with
  the existing copy, candidate run and project pointer untouched. Passes before and after.
- (c') a `lastProgressAt` stamp on an iterative generation never governs its recovery.

Before (`finding3-dw119-before.raw.log`, unmodified source):
```
 × (a) never reaps a chain whose sections keep completing past 30 minutes since startedAt
     AssertionError: expected 1 to be +0        ← live chain reaped at T0+35
 × (b) reaps a chain with no progress for 30 minutes, including a single stuck first action
     AssertionError: expected 1 to be +0        ← reaped at T0+49, 29 min after last progress
 × (c') a progress stamp never governs iterative recovery
     Error: Validator error: Unexpected field `lastProgressAt` in object   ← field did not exist
 Tests  3 failed | 2 passed (5)                 ← (b') and (c) already held
```
After (`finding3-dw119-after.raw.log`; new file + `generationRecovery`, `generationReaper`,
`reaperIntegration`, `ai/providers` suites):
```
 Test Files  5 passed (5)
 Tests  35 passed (35)
```

## Full gates on the final tree

- `npx tsc -p convex/tsconfig.json --noEmit` → exit 0 (`tsc-convex.raw.log`). A first run
  flagged the new test's helpers typed as `ReturnType<typeof convexTest>` (loses the schema, so
  `withIndex` names fail to type); fixed by typing them `TestConvex<typeof schema>`.
- `npx vitest run` → 171 files, 2218 tests passed, exit 0 (`vitest-full.raw.log`).
- `npm run check` → 5931 files, 0 errors, 0 warnings, exit 0 (`npm-check.raw.log`).

## Limitations / notes for the stack merge

- ~~`failStaleGenerations` still pages `take(100)` on `startedAt < cutoff`~~ — resolved by the
  Astra review fix below (paged scan with bounded self-continuation).
- The reaper's whole-fail leaves the ordered `generationSectionRuns` rows as they were (running /
  queued / pending), exactly as before this change; only candidate runs are terminalized. Unchanged
  behaviour, outside this finding.
- PRs #12/#13 touch `convex/generations.ts` heavily. The edits here are confined to: the
  `renderBriefForGeneration` filter (identical text to 738331e), one added field in two existing
  patches, one two-line patch in `claimOrderedSectionRun`, one guarded `continue` in
  `failStaleGenerations`, and comment lines. No code was moved or reformatted.
- The ledger (`_bmad-output/implementation-artifacts/deferred-work.md`) was not edited; DW-119's
  status is owned by the orchestrator.

## Astra review (gpt-6-astra, medium) — ACCEPT_WITH_FIXES, applied

Review record: `astra-review/` (prompt.md, result.md, review.raw.log, status-*.sha). Logs for
the fixes: `review-fix/`.

### Review fix 1 (Medium) — the running scan could hide a stalled generation behind live ones

Problem: `failStaleGenerations` read the oldest 100 running rows (`startedAt < cutoff`,
`take(100)`) and only then consulted `lastProgressAt`. With 100 older chains all progressing, a
stalled generation at position 101 was never examined, and every cron run revisited the same page.

Fix (`convex/generations.ts`): the running scan is paged. Each invocation reads one bounded page
(`STALE_GENERATION_SCAN_PAGE_SIZE = 100`, overridable via `pageSize`) through the existing
`by_status_and_startedAt` index with `.paginate({ numItems, cursor })` — the single `paginate`
of the function — and, when `isDone` is false, schedules **itself** with `{ cutoff, cursor:
continueCursor }` so the same recovery owner continues; no parallel reaper, one transaction per
page. The cutoff is passed explicitly to continuation pages so the index range (and therefore the
cursor) stays stable across pages. Reserved rows (`take(100)`, all failed on sight so the page
drains), the orphaned-run sweep and the project sweep run once, on the first page only.
`returns` now carries `scanned` and `isDone`; `projectSweepJobId` is optional (absent on
continuation pages). Callers (`crons.ts`, tests) pass only `olderThanMinutes` and are unchanged;
`generationReaper.test.ts`'s "is scheduled by failStaleGenerations" still reads
`projectSweepJobId` from the first page.

Regression test (`convex/orderedChainRecovery.test.ts`, describe "DW-119 review: the running
scan pages past live chains"): 100 running generations older than the stalled one, every one with a
fresh `lastProgressAt` (fills exactly one production-sized page), then one stalled single chain
(created and claimed at T0, nothing after). Reaper at T0+61 → `finishAllScheduledFunctions` →
stalled generation failed with its candidate run and project freed; all 100 live rows still
`running`; the first page reports `scanned: 100, isDone: false`.

Before (`review-fix/pagination-before.raw.log`, HEAD `3e8ea81` source):
```
 × fails a stalled generation behind a full page of older, still-progressing ones
     AssertionError: expected 'running' to be 'failed'
 Tests  1 failed | 7 passed (8)
```
After (`review-fix/pagination-after.raw.log`; new file + generationRecovery, generationReaper,
reaperIntegration):
```
 Test Files  4 passed (4)
 Tests  29 passed (29)
```

### Review fix 2 (Low) — each stamp site independently required; two candidates; cutoff equality

The DW-119 tests were rewritten so creation, claim and completion happen at distinct times and
every reaper check sits in a window where exactly one stamp is recent:

- (a) `startedAt = T0-40`; create at T0, reaper at T0+5 → only the **create** stamp is recent;
  claim at T0+20, reaper at T0+45 (cutoff T0+15) → only the **claim** stamp; complete at T0+50,
  reaper at T0+75 (cutoff T0+45) → only the **completion** stamp; then 244/246 at T0+80/100/105
  and a reaper at T0+130.
- (a') claim at T0+20; reaper at exactly T0+50 (cutoff == lastProgressAt) → live; reaper at
  T0+50 + 1 ms → failed.
- (b) complete at T0+20, claim at T0+25, no more progress; reaper at T0+54 → live, at T0+56 →
  failed (whole-fail copy, candidate run failed, project freed).
- (b') stuck first action reaped 31 minutes after its claim.
- (b'') **two compare candidates** on one generation: A and B both created at T0, claimed at
  T0+1 / T0+2; B's action dies; A drafts 242 at T0+30. Reaper at T0+55 (cutoff T0+25) → live and B
  untouched (protected by A's progress); no progress from anyone afterwards → reaper at T0+61
  fails the generation and both runs.
- (c)/(c') iterative unchanged, as before.

Mutation runs (each stamp site removed from source, uncommitted, test file run, source restored
from a sha-verified snapshot `6a686f98…`; diffs and logs in `review-fix/mutation-*`):

| Mutation | Removed | Result |
|---|---|---|
| 1 `mutation-1-create-stamp` | `lastProgressAt: now` in `createOrderedSectionRuns` | (a) fails at the T0+5 check — `1 failed \| 7 passed` |
| 2 `mutation-2-claim-stamp` | the generation patch in `claimOrderedSectionRun` | (a), (a'), (b) fail — `3 failed \| 5 passed` |
| 3 `mutation-3-complete-stamp` | `lastProgressAt: now` in `completeOrderedSectionRun` | (a), (b'') fail — `2 failed \| 6 passed` |

Unmutated source: `8 passed (8)`.

### Gates after the review fixes (final tree)

- `npx tsc -p convex/tsconfig.json --noEmit` → exit 0 (`review-fix/tsc-convex.raw.log`).
- `npx vitest run` → 171 files, 2221 tests passed (`review-fix/vitest-full.raw.log`).
- `npm run check` → 5931 files, 0 errors, 0 warnings (`review-fix/npm-check.raw.log`).

### Review notes not requiring code changes

- Merge-up note from the review: the later stack's claim-read budget comment should count the
  extra generation patch in `claimOrderedSectionRun` (its conservative estimate becomes 15 MiB,
  still under the documented 16 MiB). To be applied in the stack merge, not here.

## Astra follow-up review of 3bfa743 (gpt-6-astra, medium) — ACCEPT_WITH_FIXES, applied

Review record: `astra-review-2/`. Both earlier fixes confirmed resolved by the reviewer
(position-101 regression; per-stamp mutation runs). Logs for this round: `review-fix-2/`.

### Fix 1 (Medium) — overlapping cron ticks started duplicate continuation chains

Problem: a cursorless invocation (the 10-minute cron in `crons.ts`, or a manual run) that
arrived while scan A's continuation pages were still scheduled unconditionally started scan B,
so two chains walked the same range.

Fix (`convex/generations.ts`), proportionate and without a new table: on a cursorless
invocation only, read the newest `STALE_SCAN_JOB_LOOKBACK = 200` rows of
`ctx.db.system.query("_scheduled_functions").order("desc")` (the system table has only its
creation-time index; that `take` is the bound) and look for a row that is this same function
(`isStaleScanJobName`: the backend records the bundled path `generations.js:failStaleGenerations`,
convex-test records `generations:failStaleGenerations` — compared with the extension stripped,
against `getFunctionName(internal.generations.failStaleGenerations)`), in state `pending` or
`inProgress`, whose `args[0].cursor` is a string (i.e. a continuation page, never the cron's own
cursorless row). Finding one, the invocation returns the additive
`skipped: "scan_in_progress"` (`failed: 0, scanned: 0, isDone: false`) without scheduling
anything — no second chain, no duplicate project or orphan-run sweeps. Recovery: a page that
fails leaves no pending/in-progress row, so the next tick starts a fresh scan; nothing to release.
Fields verified against `node_modules/convex/dist/esm-types/server/schema.d.ts` (`_systemSchema`:
`name`, `args: any[]`, `scheduledTime`, `completedTime?`, `state.kind`) and convex-test's
scheduler (`name: functionPath.udfPath`, `args: [parsedArgs]`, `state: { kind: "pending" }` →
`inProgress` → `success`). The system-table check is reliable in convex-test, so no persisted
fence was needed.

Why the bound is safe: a continuation page is scheduled with no delay by the page before it, so a
live scan's pending page is among the newest jobs; only >200 other jobs scheduled between that
page and the tick could hide it, and the failure mode then is the previous behaviour (a second
chain), never a missed reap.

### Fix 2 (Nit) — `pageSize` capped

`pageSize = Math.min(Math.max(1, floor(args.pageSize ?? 100)), STALE_GENERATION_SCAN_PAGE_SIZE)`;
continuation pages carry the capped value.

### Tests (`convex/orderedChainRecovery.test.ts`, describe "DW-119 review: the running scan pages past live chains")

- "a cron tick that lands while a scan's pages are still scheduled starts no second chain": the
  100+1 seed; tick A at T0+61 (`isDone: false`, one continuation job); tick B at T0+71 before
  draining → still exactly one continuation job, `skipped: "scan_in_progress"`, `failed: 0`,
  `scanned: 0`, no `projectSweepJobId`; `finishAllScheduledFunctions` → the stalled row is reaped
  once, the 100 live rows stay running, the single continuation job is `success`; tick C at T0+81
  owns a fresh scan (`skipped` undefined, `isDone: true`).
- "caps a requested pageSize at the production page": `pageSize: 1000` over 101 rows in range →
  `scanned: 100`, `isDone: false`, and draining still reaps only the stalled row.

Before (`review-fix-2/overlap-before.raw.log`, HEAD `3bfa743` source):
```
 × a cron tick that lands while a scan's pages are still scheduled starts no second chain
     AssertionError: expected [ { …(6) }, { …(6) } ] to have a length of 1 but got 2
 × caps a requested pageSize at the production page
     AssertionError: expected 101 to be 100
 Tests  2 failed | 8 passed (10)
```
After (`review-fix-2/overlap-after.raw.log`; new file + generationRecovery, generationReaper,
reaperIntegration):
```
 Test Files  4 passed (4)
 Tests  31 passed (31)
```

### Gates after this round (final tree)

- `npx tsc -p convex/tsconfig.json --noEmit` → exit 0 (`review-fix-2/tsc-convex.raw.log`).
- `npx vitest run` → 171 files, 2223 tests passed (`review-fix-2/vitest-full.raw.log`).
- `npm run check` → 5931 files, 0 errors, 0 warnings (`review-fix-2/npm-check.raw.log`).
