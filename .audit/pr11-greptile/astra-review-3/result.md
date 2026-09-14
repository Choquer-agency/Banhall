1. **Medium — `convex/generations.ts:2748`: the 200-row lookback still permits duplicate continuation chains.**

   **Failure scenario:** scan A’s continuation remains pending during scheduler delay or retries. At least 200 newer, unrelated scheduled-function rows are created before the next cron tick. The query excludes A, so tick B starts another scan and auxiliary sweeps. Both chains subsequently continue because cursor-bearing invocations bypass the guard.

   `runAfter(0)` does not guarantee execution before newer jobs are created. Completed jobs also occupy this window. Transactional status checks prevent double terminalization, but duplicate reads, scheduling and contention recur precisely when the scheduler is struggling. **This residual risk is not acceptable as resolution of the previous single-owner finding.**

   **Suggested fix:** persist a singleton scan record pointing to its current scheduled continuation, and inspect that job directly by ID. Update ownership atomically with scheduling; handle terminal failures and fence stale continuations. Add a regression with an actual scheduled continuation followed by 200 newer unrelated jobs before tick B.

The other requested checks pass or have these limits:

- **API legality and names:** the existing parent-repository installation matches the lockfile: Convex **1.42.3**, convex-test **0.0.54**. Its `schema.ts:882` confirms `name`, `args`, and the lowercase state discriminants. The system query is supported. Production’s `generations.js:failStaleGenerations` and convex-test’s extensionless name both match the normalization. Official documentation confirms the system-table API and bundled-name format. [Convex scheduling documentation](https://docs.convex.dev/scheduling/scheduled-functions)

- **Concurrent ticks:** both transactions can initially observe no continuation, but cannot both commit that observation unchanged when one inserts a continuation into the other’s queried range. Atomic scheduling and serializable OCC require retry. There is no separate check-then-schedule race here; the bounded visibility problem above remains. [Convex OCC guarantees](https://docs.convex.dev/database/advanced/occ)

- **Failed-page recovery:** a terminally failed mutation leaves no committed successor, and its failed job does not block the next tick. Internal errors are retried; developer errors terminate execution. Production scheduled mutations remain pending until completion; `inProgress` applies to actions. Checking both states is harmless. A permanently reproducible page error still requires repair, an acceptable existing limitation. [Convex scheduling semantics](https://docs.convex.dev/scheduling/scheduled-functions)

- **Tests:** `convex/orderedChainRecovery.test.ts:412` uses actual application scheduling calls and drains handlers through convex-test, rather than fabricating continuation rows. However, ticks are sequential direct mutation calls. Convex-test serializes transactions (`dist/index.js:1388`) and separately transitions even mutations through `inProgress` (`:1113`), so these tests do **not** prove production OCC or scheduler state transitions. They also omit lookback overflow and failed-page recovery.

- **Page-size cap:** correctly caps ordinary numeric requests at 100 and propagates the capped value.

Reviewed source and supplied logs only; no files changed, packages installed, or tests rerun.

ACCEPT_WITH_FIXES