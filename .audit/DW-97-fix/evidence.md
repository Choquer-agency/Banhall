# DW-97 implementation evidence

Baseline commit: `74f8789d582c7b3ea4b66f2d70624811d269186f`. Private commit is created after the independent review and BMAD finalization; its canonical ID is recorded in the parent-readable result report.

The panel now retains the locally submitted research ID while its listed status is active. Listed completed, failed, or canceled status releases it. Existing direct-details terminal/missing handling and freshness guards are unchanged.

## Acceptance mapping

| Acceptance | Actual-panel proof in RegenerateLimits.component.test.ts |
| --- | --- |
| Visible active A displaced by 20 newer terminal summaries stays guarded | `keeps previously visible research busy after displacement until %s`, four terminal/missing outcomes; disabled control and zero sends, then exact stored-prompt send on recovery |
| Listed terminal status recovers without details dependency | `releases listed research on %s without direct metadata`, three terminal statuses with undefined detail data |
| Unavailable details remain conservative | `retains displaced research guard through %s direct metadata until fresh recovery`, loading and retained stale/error terminal data |
| Prompt, drafts, Stop, retry unchanged | Focused RegenerateTurn, RegenerateQueryState and RegenerateLimits suites, 59 tests pass |

## Red then green

`red-confirmed.log` captures the baseline component failing `toBeDisabled()` after first visibility and displacement. Exit 1, one failed and 16 skipped. Production code was unchanged for this run. `focused-green.log` captures 59 tests passing after the guard change. Exit 0.

The initial `red.log` also captured seven intended failing regression cases plus three overbroad subscription assertions. Those assertions counted ResearchFeed's independent query and were removed. Normal terminal recovery is instead checked with detail data unavailable. `focused-fixture-error.log` retains the intermediate failed run caused by missing empty collections in the synthetic query response; fixture collections were then completed. These intermediate receipts are not claimed as product failures beyond the confirmed baseline regression.

## Commands

All executed in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-fix`; dependencies are checkout-owned, installed by parent. Each `<name>.log` has adjacent `<name>.exit`.

| Receipt | Command |
| --- | --- |
| npm-ci | `npm ci` (parent) |
| sync | `npx svelte-kit sync` |
| red | `npm run test:component -- src/lib/components/chat/RegenerateLimits.component.test.ts` |
| red-confirmed | `npm run test:component -- src/lib/components/chat/RegenerateLimits.component.test.ts -t 'keeps previously visible research busy after displacement until completed'` |
| focused-green | `npm run test:component -- src/lib/components/chat/RegenerateLimits.component.test.ts src/lib/components/chat/RegenerateTurn.component.test.ts src/lib/components/chat/RegenerateQueryState.component.test.ts` |
| component-full | `npm run test:component` |
| unit | `npm test` |
| convex-types | `npx tsc --noEmit -p convex/tsconfig.json` |
| check | `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` |
| diff-check | `git diff --check` |

## Scope and limits

No backend production, generated files, domain policies, native worker files, ledger, or original story/spec changed. No live provider call or visual redesign claimed. Existing suites regenerate story-6 screenshots; final cleanup preserves those fresh artifacts here and restores their original tracked bytes. Private commit follows clean review; root retains integration and ledger ownership.

## Final gate output tails

### red-confirmed: exit 1

```text
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 16 skipped (17)
   Start at  01:25:00
   Duration  17.31s (transform 0ms, setup 531ms, import 829ms, tests 15.05s, environment 0ms)

```

### focused-green: exit 0

```text
    at http://localhost:63316/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-fix/src/lib/components/chat/RegenerateQueryState.component.test.ts?import&browserv=1788596824699:65:43
    at async http://localhost:63316/node_modules/@vitest/runner/dist/chunk-artifact.js?v=fb19c9d1:1903:20

 Test Files  3 passed (3)
      Tests  59 passed (59)
   Start at  01:26:52
   Duration  12.67s (transform 0ms, setup 1.15s, import 1.65s, tests 7.68s, environment 0ms)

```

### component-full: exit 0

```text
1:28:25 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:28:28 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert

 Test Files  58 passed (58)
      Tests  406 passed (406)
   Start at  01:27:21
   Duration  69.58s (transform 0ms, setup 2.07s, import 30.54s, tests 28.02s, environment 0ms)

```

### unit: exit 0

```text
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-fix


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:25:46
   Duration  31.42s (transform 9.37s, setup 0ms, import 15.83s, tests 20.78s, environment 5.47s)

```

### convex-types: exit 0

```text
(no output)
```

### check: exit 0

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-fix
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

### diff-check: exit 0

```text
(no output)
```


## Independent review and finalization

Four fresh reviewer contexts completed blind, edge, verification-gap and acceptance layers, with no findings. All layer outputs are retained in review.json. Parent verified exact source equality with the reviewed diff after review (serialized verbatim in review-diff.json), command exits and matrix coverage, and directly inspected regenerate-after.png. This screenshot documents the unchanged action presentation, not the new asynchronous displacement transition. The runtime assertions provide that transition proof.

Standalone repair spec finalized done. Original story/status, ledger, native workers and generated/backend files remain untouched. The rendered BMAD runtime was read from the installed main workspace, while every writable artifact is in this repair checkout. Existing authorization covers this narrow spec and repair; no new product decision was required.

Terminal blank lines in retained text logs were normalized before commit for whitespace validation; substantive command output and exit receipts were preserved.
