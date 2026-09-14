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

- `failStaleGenerations` still pages `take(100)` on `startedAt < cutoff`; a deployment with more
  than 100 concurrently running-but-live ordered chains older than 30 minutes could push a stale
  one past the page. Not a realistic load for this deployment; noted only.
- The reaper's whole-fail leaves the ordered `generationSectionRuns` rows as they were (running /
  queued / pending), exactly as before this change; only candidate runs are terminalized. Unchanged
  behaviour, outside this finding.
- PRs #12/#13 touch `convex/generations.ts` heavily. The edits here are confined to: the
  `renderBriefForGeneration` filter (identical text to 738331e), one added field in two existing
  patches, one two-line patch in `claimOrderedSectionRun`, one guarded `continue` in
  `failStaleGenerations`, and comment lines. No code was moved or reformatted.
- The ledger (`_bmad-output/implementation-artifacts/deferred-work.md`) was not edited; DW-119's
  status is owned by the orchestrator.
