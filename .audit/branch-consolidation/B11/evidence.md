# B11 implementation evidence

Baseline HEAD: `7c6a0099901a580d4c231df747d358faff064eaf`, matching the spec. Initial working tree had only the untracked supplied spec. Read the full spec and its complete frontmatter context (`AGENTS.md`), factory instructions, B11 planning/preflight/identity records, route, existing learning route test setup, and relevant current backend/schema definitions before implementation.

Runtime: login shell `node --version` = `v24.19.0`; `npm --version` = `11.17.0`. No installation or runtime change.

## Change

Only production change: the route maps revoke to `Revoked (unlearn requested)`, unlearn_confirmed to `Erasure confirmed`, and unlearn_failed to `Erasure attempt failed`. New adjacent `BrainAudit.component.test.ts` renders the actual route with existing shell/auth/page/query stubs. No shared configuration or backend changes.

## Executed commands and results

All log paths below are relative to this directory. Logs retain actual tool output.

| Command | Exit | Evidence |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/routes/admin/brain/BrainAudit.component.test.ts` before route edit | 1 (expected) | `red.log`: 1 failed, 6 passed; three soft assertion failures show old revoke wording and both raw outcome slugs |
| Same exact command after route edit, unchanged regression bytes | 0 | `green.log`: 7 passed |
| `node node_modules/vitest/vitest.mjs run convex/brainUnlearn.test.ts` | 0 | `backend.log`: 24 passed |
| `node node_modules/vitest/vitest.mjs list --config vitest.component.config.ts src/routes/admin/brain/BrainAudit.component.test.ts` | 0 | `discovery.log`: each of seven tests listed once, all under component (chromium), no pointer instances |
| `npm run check` | 1 | `check.log`: missing PUBLIC_CONVEX_URL in two existing files; no other diagnostics |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` | 0 | `check-with-public-placeholders.log`: 0 errors, 0 warnings |
| `git diff --check` | 0 | No output |
| `shasum -a 256 -c .audit/branch-consolidation/B11/regression.sha256` | 0 | Regression file OK: same bytes before and after mapping edit |
| Python hashlib comparison of before manifest, excluding intended route edit | 0 | `identities.log`: all protected files unchanged |

`before.sha256` retains baseline route/backend/stub/config hashes, all matching preflight identities where provided. `regression.sha256` binds the exact test bytes used in both runs. `identities.log` retains the final route hash and protected-file identities. The full before-manifest check also ran after editing: its sole mismatch was the intended route edit; all protected entries were OK.

## Executed matrix

All rows passed in `green.log`.

| Spec scenario | Browser witness |
| --- | --- |
| Request | First test compares rendered revoke action cell to exact requested label |
| Confirmation | First test compares rendered confirmation cell to exact label |
| Failure | First test compares rendered failed-attempt cell; retry count stays in reason |
| Recovery | First test compares all ordered rows; shared source request, failure, confirmation have increasing times and appear newest first; no post-confirmation failure fixture |
| Other events | First test checks Imported, Approved, Rejected, Reweighted, Reverted |
| Row details | First test checks every reason or omitted-reason fallback, browser-localized numeric at, CLI literal actor, and existing human/system-as-admin rendering |
| Unknown boundary | Second test clones a valid row, replaces only action, passes unknown data to existing query stub; rendered raw slug verified. This is not a schema-valid persisted event |
| Tabs | Third test clicks Queue to Audit log to Queue; asserts audit subscription counts 0, 1, 0 and args [], [{}], []; source and feedback gates also checked |
| Signed out | Fourth test starts signed out and waits for login navigation, checking skipped queries; fifth signs out from active audit and checks removal and navigation |
| Access denied | Sixth test seeds authenticated brainStats null and checks Admin access only, absent tabs and audit skip |
| Authenticated loading nuance | Seventh test hides the UI while retaining authenticated audit and stats subscriptions, with no login navigation; restores UI when loading clears |

Browser results establish rendering and subscription wiring through the current stubs. They do not execute backend adminOrNull. The unchanged backend outcome suite is a separate witness.

## Parent handoff

Implementation and requested focused regression are complete. Per the spec, staging, independent review, canonical staged discovery (`node scripts/check-test-discovery.mjs`), full integration gate (`VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`), admission and shipping remain parent-owned and were not performed. No staging, commits, remotes, review agents, other-worktree edits, or ledger/native-state changes. The supplied spec remains unchanged. Audit evidence is ignored by git and must be retained explicitly by the parent as appropriate.

## Actual output tails

### red.log

```text


 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Start at  20:13:42
   Duration  8.91s (transform 0ms, setup 544ms, import 6.59s, tests 551ms, environment 0ms)

```

### green.log

```text
8:14:05 PM [vite-plugin-svelte] no Svelte config found at /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation - using default configuration.

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  20:14:05
   Duration  8.48s (transform 0ms, setup 517ms, import 6.71s, tests 439ms, environment 0ms)

```

### backend.log

```text


 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  20:14:17
   Duration  729ms (transform 308ms, setup 0ms, import 415ms, tests 157ms, environment 44ms)

```

### check-with-public-placeholders.log

```text
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

## Parent review and boundary clarification

The actual red.log contains three separate assertion differences: received `unlearn_confirmed` versus expected `Erasure confirmed`; received `unlearn_failed` versus expected `Erasure attempt failed`; received `Revoked (unlearned)` versus expected `Revoked (unlearn requested)`. Both worker red and green runs used regression SHA256 `624f7f75f9e7b34ee02d50ef00bf7bf875ff8168d05a77d2526ff8b259c884f4`, now retained as worker-regression.test.ts.snapshot. Parent added an explicit zero-row assertion during authenticated loading; parent-patch.json binds the stronger final test digest and rerun results. Production mapping bytes did not change during parent review. Automatic baseline failure screenshot and original path/hash are preserved separately.

Browser row checks establish preservation of supplied query order and exact cell contents. They do not execute backend sorting or prove live event delivery. The unchanged query orders descending in convex/brain.ts listBrainAudit. Backend test `successful remediation fences a stale failure without losing earlier evidence` at convex/brainUnlearn.test.ts:315 proves earlier failure remains while later stale failure is suppressed; the overlapping failure case at336 is complementary. Both belong to the24 backend cases actually run.

The browser command explicitly loads vitest.component.config.ts: Svelte compiler, Tailwind, Chromium, browser aliases and existing auth/query stubs. No root Svelte config is present, so the plugin reports default compiler configuration. Repository policy deliberately omits sveltekit() from this browser config. This is actual Svelte route rendering with stubbed runtime boundaries; full build/typechecks are separate parent-gate witnesses, not claimed production SSR/router parity.

## Parent acceptance

After independent review and the explicit loading-row assertion, the full Node24 gate passed all nine steps:2020 unit tests,489 browser tests across63 browser project files, typechecks, discovery, build and both uploader harnesses. gate/result.json binds166.66 seconds,6,010 tracked paths, zero unexpected changes and log SHA256 da9e223cb11c93294bbc69cf248a4e13f9504f6dc725ad8f36bbac248765aa62. Nine maintained historical captures were saved then restored; no other source changed. New BrainAudit suite is staged and discovered in ordinary Chromium only. This gate covers the complete accepted product source from all thirteen batches.
