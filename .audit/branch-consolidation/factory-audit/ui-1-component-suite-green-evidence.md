# Evidence · ui-1-component-suite-green
commit: d7036f7551f1438c64fea5330dc77327ab7c99eb   branch: factory/ui-1-component-suite-green   baseline: 7719d7b02d0a9db7de8ea6f26ca9c4f75d6b5391   date: 2026-09-05T09:39:02Z   kind: bug

## Coverage

| AC | covering test | result |
| --- | --- | --- |
| AC1 Projects href parsed: path, layout preserved, group=client, no navigation | `src/routes/workspaceRoutes.component.test.ts:38` "/projects renders the workspace shell for a flagged user" (assertions at :52-63) | ✓ ran in the five-file verify command [ladder 4] |
| AC2 Button keeps tag choice, href, class parity, min-h-11, disabled, onclick, variant role; class inventory gone | `src/lib/components/ui/Button.component.test.ts` all 6 cases; `CORE_TOKENS` deleted; `min-h-11` now also measured >= 44px | ✓ [ladder 4] |
| AC3 drawer autofocus, Settings by role+name, sign-out dialog opened by real input, visible, layered above the drawer, 44px controls, cancel restores focus, never confirmed | `src/lib/components/workspace/WorkspaceChrome.component.test.ts:75` "autofocuses the modal drawer and layers its confirmed sign-out above it" | ✓ [ladder 4] |
| AC4 owner/admin fixture, Admin collapsed then expands, sanctioned destinations incl. House rules, plain admin sees nothing, placement by nav order, touch row keeps workspace-rail-row + min-h-11, colour-count assertion gone | `WorkspaceRail.component.test.ts`: "keeps the drawer chrome fixed…", "presents Admin as a left-chevron group over the sanctioned destinations", "hides Admin from an admin who is neither workspace Owner nor Developer", "moves the Admin records group below the primary workspace links", "shares the compact rail rhythm…" | ✓ 15 passed [ladder 4] |
| AC5 New project measured at 390px, mobile floor added, both dimensions >= 44, compact desktop height pinned, py-2.5 gone, bg-action-primary / not bg-fir kept | `WorkspaceHeader.component.test.ts` "meets the 44px mobile target and keeps the compact desktop toolbar height" + "uses the shared theme-aware default button…" | ✓ [ladder 5 — measured in the running browser] |
| AC6 one decisions row per dx-audit row with classification, commit and edit; suite exit 0 for every discovered file; before/after screenshots | `decisions.tsv` rows 9-18; `after-test-component.log`; `header-mobile-390-{before,after}.png`, `header-desktop-1280-{before,after}.png` | ✓ [ladder 4] |

Developer-only Admin entries (`/alerts`, `/requests`, the escape hatch) keep their existing coverage in "shows only What's new from the utility links for non-developers" and "shows developer utilities directly for flagged accounts without an accordion"; both already seeded `isDeveloper` and both stayed green.

## Gates

| command | exit | note |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | 0 | Convex tsc silent; svelte-check 5862 files, 0 errors, 0 warnings; vitest 140 files / 1516 tests; pwsh 50 passed; bash 18 passed |
| `npx vitest run --config vitest.component.config.ts <the five files>` | 0 | 5 files / 43 tests |
| `npm run test:component` | 0 | 51 files / 292 tests |
| `rg -q 'getBoundingClientRect' src/lib/components/workspace/WorkspaceHeader.component.test.ts` | 0 | |
| `rg -q 'isOwner: true' src/lib/components/workspace/WorkspaceRail.component.test.ts` | 0 | |

## Output tails

### npm run test:component (before, at baseline 7719d7b)
```

 Test Files  5 failed | 46 passed (51)
      Tests  8 failed | 282 passed (290)
   Start at  02:29:14
   Duration  37.31s (transform 0ms, setup 1.11s, import 12.82s, tests 7.35s, environment 0ms)

EXIT=1
```

### npm run test:component (after)
```
 Test Files  51 passed (51)
      Tests  292 passed (292)
   Start at  02:37:56
   Duration  24.09s (transform 0ms, setup 753ms, import 12.22s, tests 7.88s, environment 0ms)
EXIT=0
```

### npx vitest run --config vitest.component.config.ts <the five ticket files>
```
 Test Files  5 passed (5)
      Tests  43 passed (43)
   Start at  02:37:38
   Duration  11.92s (transform 0ms, setup 537ms, import 7.66s, tests 2.10s, environment 0ms)
EXIT=0
```

### bash scripts/loop-verify.sh
```

1788600993843 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/ui-1-component-suite-green"
1788600993870 COMPLETED 5862 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  140 passed (140)
      Tests  1516 passed (1516)
   Start at  02:36:34
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
EXIT=0
```

## Before

Reproduced at the ticket's baseline `7719d7b`, before any edit, with dependencies installed in this worktree and Chromium present (`before-test-component.log`):

```
 Test Files  5 failed | 46 passed (51)
      Tests  8 failed | 282 passed (290)
EXIT=1
```

The eight failures and their assertion lines, verbatim from that log:

```
 FAIL  src/routes/workspaceRoutes.component.test.ts > canonical workspace routes > /projects renders the workspace shell for a flagged user
AssertionError: expected false to be true // Object.is equality
 FAIL  src/lib/components/ui/Button.component.test.ts > Button > renders an anchor with the variant classes and min-h-11 passthrough when href is set
AssertionError: expected 'inline-flex items-center justify-cent…' to contain 'transition-colors'
 FAIL  src/lib/components/workspace/WorkspaceChrome.component.test.ts > WorkspaceChrome > autofocuses the modal drawer and layers its 44px account menu above the drawer
TypeError: Cannot read properties of null (reading 'click')
 FAIL  src/lib/components/workspace/WorkspaceHeader.component.test.ts > WorkspaceHeader > uses the shared theme-aware default button for the page-level creation action
AssertionError: expected 'inline-flex items-center justify-cent…' to contain 'py-2.5'
 FAIL  src/lib/components/workspace/WorkspaceRail.component.test.ts > WorkspaceRail > keeps the drawer chrome fixed, scrolls only its links, and starts Admin compact
AssertionError: expected undefined to be 'false' // Object.is equality
 FAIL  src/lib/components/workspace/WorkspaceRail.component.test.ts > WorkspaceRail > presents Admin as an Attio-style left-chevron group with distinct icon colours
AssertionError: the given combination of arguments (undefined and string) is invalid for this assertion. You can use an array, a map, an object, a set, a string, or a weakset instead of a string
 FAIL  src/lib/components/workspace/WorkspaceRail.component.test.ts > WorkspaceRail > moves the Admin records group below the primary workspace links
AssertionError: the given combination of arguments (undefined and string) is invalid for this assertion. You can use an array, a map, an object, a set, a string, or a weakset instead of a string
 FAIL  src/lib/components/workspace/WorkspaceRail.component.test.ts > WorkspaceRail > shares the compact rail rhythm with fine-pointer drawers without shrinking touch targets
AssertionError: expected 'min-h-11 workspace-rail-row flex w-fu…' to contain 'duration-300'
```

AC5's mechanism was measured, not inferred. A probe rendered `WorkspaceHeader` in the same harness at two viewports and printed the anchor's `getBoundingClientRect()` (`header-probe-before.log`, probe source archived as `HeaderTargetProbe.component.test.ts.txt`):

```
"measured": {
  "desktop-1280": { "height": 32, "width": 121.67 },
  "mobile-390":   { "height": 32, "width": 41 },
},
"phase": "before",
```

41 x 32 at 390px is under the 44px mobile minimum in `docs/product-domain.md:233` in both dimensions.

## After

```
 Test Files  51 passed (51)
      Tests  292 passed (292)
EXIT=0
```

The same probe after the header caller gained its mobile floor (`header-probe-after.log`):

```
"measured": {
  "desktop-1280": { "height": 32, "width": 121.67 },
  "mobile-390":   { "height": 44, "width": 44 },
},
"phase": "after",
```

Mobile reaches the contract; the desktop toolbar height is unchanged at 32px, so no other `xs` caller moved. The probe was then deleted from `src/`: the permanent lever is the committed test, which asserts the same two measurements.

290 tests at baseline became 292: the two added here are the header geometry case and the non-eligible-admin rail case. No test file was restored or deleted, and discovery stayed at 51 files.

## Live surface

Driven for real in headless Chromium through the component harness at 390x844 and 1280x800, app chrome visible (title, count, navigation toggle, search, primary action):

- `.audit/ui-1-component-suite-green/header-mobile-390-before.png` — 41x32 target
- `.audit/ui-1-component-suite-green/header-mobile-390-after.png` — 44x44 target
- `.audit/ui-1-component-suite-green/header-desktop-1280-before.png` — 121.67x32
- `.audit/ui-1-component-suite-green/header-desktop-1280-after.png` — 121.67x32, unchanged

untested: the full SvelteKit app at `/projects` on a real phone. The harness mounts real components with real CSS at a real viewport, which is what the 44px contract is about, but it does not run the routed app against a live Convex deployment. A human can check it with `npm run dev` and Chrome device emulation at 390px on `/projects`.

## Not proven

- Reduced-motion behaviour of `Button` — `@vitest/browser` 4.1.10 and `@vitest/browser-playwright` expose no per-test `prefers-reduced-motion` emulation (no `emulateMedia`/`reducedMotion` in `node_modules/@vitest/browser/context.d.ts`); the only lever is a run-wide Playwright context option, which cannot express a per-case contract. Left unasserted per the ticket's edge case. A human can check it with `npx playwright test` under a context configured `reducedMotion: "reduce"`, or by launching Chromium with `--force-prefers-reduced-motion` and confirming `transition-duration` computes to `0s` on a Button.
- That the 44px floor is right for every phone width, not just 390px. Only 390x844 and 1280x800 were measured. A human can widen it with `npx vitest run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts` after adding 320px and 428px cases.

## QA · 2026-09-05T09:49:21Z · claude claude-fable-5-1
commit: 85efbce47f8a96ebd7fc2dcecbefcf816dbd5ee9   verdict: test-verified

| check | result | ladder | note |
| --- | --- | --- | --- |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; convex tsc silent; svelte-check 5862 files 0 errors 0 warnings; vitest 140 files / 1516 tests; pwsh 50 passed; bash 18 passed |
| ticket verify: five-file vitest command | passed | 4 | exit 0; 5 files / 43 tests |
| ticket done_when: `rg -q 'getBoundingClientRect' …WorkspaceHeader.component.test.ts` | passed | 4 | exit 0 |
| ticket done_when: `rg -q 'isOwner: true' …WorkspaceRail.component.test.ts` | passed | 4 | exit 0 |
| ticket done_when: `npm run test:component` | passed | 4 | exit 0; 51 files / 292 tests |
| smoke | skipped | 1 | no `smoke` commands configured for this run |
| criteria coverage AC1–AC6 | passed | 4 | every criterion has a committed assertion that ran green in the commands above; details below |
| evidence audit | passed | 4 | every tail, count, test name, screenshot and log resolved; two notes below (commit sha delta, AC5 rung label) |
| kind proof (bug): reproduce at baseline, pass at HEAD | passed | 5 | baseline sources checked out for the six touched files, five-file command → `Test Files 5 failed (5)`, `Tests 8 failed | 33 passed (41)`, exit 1, same eight test names as `before-test-component.log:387-518`; HEAD restored → 5 passed / 43; the bug's surface is the suite command itself |
| live drive | skipped | 1 | verify_skill=none; header 44px fix seen only in the component harness at 390x844, routed `/projects` not driven |

### Output tails

`bash scripts/loop-verify.sh` (exit 0):
```
1788601645516 COMPLETED 5862 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  140 passed (140)
      Tests  1516 passed (1516)
50 passed, 0 failed
18 passed, 0 failed
```

five-file verify (exit 0):
```
 Test Files  5 passed (5)
      Tests  43 passed (43)
   Start at  02:46:56
   Duration  14.28s (transform 0ms, setup 823ms, import 9.34s, tests 2.04s, environment 0ms)
```

`npm run test:component` (exit 0):
```
 Test Files  51 passed (51)
      Tests  292 passed (292)
   Start at  02:48:04
   Duration  25.15s (transform 0ms, setup 904ms, import 12.17s, tests 8.12s, environment 0ms)
```

five-file verify at baseline sources (exit 1), the reproduction:
```
 ❯ WorkspaceChrome.component.test.ts (4 tests | 1 failed)
     × autofocuses the modal drawer and layers its 44px account menu above the drawer
 ❯ workspaceRoutes.component.test.ts (7 tests | 1 failed)
     × /projects renders the workspace shell for a flagged user
 ❯ WorkspaceRail.component.test.ts (14 tests | 4 failed)
     × keeps the drawer chrome fixed, scrolls only its links, and starts Admin compact
     × presents Admin as an Attio-style left-chevron group with distinct icon colours
     × moves the Admin records group below the primary workspace links
     × shares the compact rail rhythm with fine-pointer drawers without shrinking touch targets
 ❯ WorkspaceHeader.component.test.ts (10 tests | 1 failed)
     × uses the shared theme-aware default button for the page-level creation action
 ❯ Button.component.test.ts (6 tests | 1 failed)
     × renders an anchor with the variant classes and min-h-11 passthrough when href is set
 Test Files  5 failed (5)
      Tests  8 failed | 33 passed (41)
```

### Criteria coverage (verified)
- AC1 → `src/routes/workspaceRoutes.component.test.ts:38` "/projects renders the workspace shell for a flagged user" ✓ parses the Projects href with `URL`, asserts pathname `/projects`, `layout=board`, `group=client`, `gotoUrls()` empty; the diff is one hunk replacing baseline line 54 only   [4]
- AC2 → `src/lib/components/ui/Button.component.test.ts` ✓ `:26-41` anchor vs button + href + `min-h-11` (also measured ≥44px) + variant role tokens; `:71-81` class parity; `:83-92` onclick; `:94-103` disabled on button branch only; `CORE_TOKENS` deleted (diff). Reduced motion unasserted, recorded in `deferred` and `decisions.tsv` row 12, permitted by the ticket's edge case   [4]
- AC3 → `src/lib/components/workspace/WorkspaceChrome.component.test.ts:80` "autofocuses the modal drawer and layers its confirmed sign-out above it" ✓ autofocus on Close (`:88-90`), Settings by role+name with href `/settings` (`:93-98`), Sign out opened by a real click (`:100-104`), dialog visible (`:112`), wrapper z-index above the drawer's (`:114-115`), controls ≥44px (`:119-123`), "Stay signed in" closes it and focus returns to the trigger (`:126-128`), no `goto` (`:129`). Settings is located, not activated (review's low note stands)   [4]
- AC4 → `src/lib/components/workspace/WorkspaceRail.component.test.ts` ✓ `ownerAdmin` fixture `role: "admin", isOwner: true` (`:37-41`); collapsed then expands on click (`:124-138`); ordered sanctioned hrefs incl. `/admin/house-rules` (`:44-53,:153`); plain admin sees no group (`:161-168`); developer-only entries gated on `isDeveloper` (`:170-206`, pre-existing); nav order via `compareDocumentPosition` (`:208-217`); touch row keeps `workspace-rail-row` + `min-h-11`, `duration-300` gone (`:219-226`); colour-count assertion gone (diff). Ticket's "seed no current user" wording was wrong; baseline cases did seed `role: "admin"`, recorded in decisions row 19   [4]
- AC5 → `src/lib/components/workspace/WorkspaceHeader.component.test.ts:175` "meets the 44px mobile target and keeps the compact desktop toolbar height" ✓ width and height ≥44 at 390x844, `Math.round(height) === 32` at 1280x800; `:157-166` keeps `bg-action-primary`, `not bg-fir`, `py-2.5` check gone. Fix is caller-scoped in `WorkspaceHeader.svelte:181-185` (`min-h-11 min-w-11 … sm:min-h-0 sm:min-w-0`); `Button.svelte` untouched   [4]
- AC6 → `decisions.tsv` rows 9, 11, 13, 14, 15, 16, 17, 18 map one-to-one onto `dx-audit.md:60-67` with classification, commit or source line, and edit; before `8 failed | 282 passed (290)` and after `292 passed (292)` both in evidence and re-run here; four screenshots present at 390 and 1280 with app chrome ("Projects 30+", nav toggle, search, primary action) visible, mobile after shows a visibly larger target, desktop pair byte-identical (8607 B), all tied to the archived probe's `browserPage.screenshot` call   [4]

### Evidence audit notes
- evidence.md names commit `d7036f7`; HEAD is `85efbce`. `git diff d7036f7..HEAD -- src` is empty; the extra commit adds one `deferred:` line to the engine-owned ticket file. Every gate above was rerun at `85efbce`, so this verdict is fresh at HEAD (principle 22).
- AC5 is labelled "ladder 5 — measured in the running browser". Under the protocol's ladder, 5 is the running app; the measurement was in the component harness mounting `WorkspaceHeader` alone, which the evidence's own Live surface section calls untested for the routed app. Recorded here at 4. Does not change any acceptance outcome (principle 19, never round up).
- Everything else resolved: eight baseline failure lines match `before-test-component.log:387-518` verbatim; 41x32 → 44x44 matches `header-probe-{before,after}.log`; 51/292 and 140/1516 match my runs.

### Live drive
- none (no verify skill). Harness-level evidence only: `WorkspaceHeader` in headless Chromium at 390x844 measures 44x44 after, 41x32 before.

### Skipped / needs operator
- smoke — no `smoke` commands configured — nothing to run.
- live drive of the routed app — `verify_skill=none` — a human can run `npm run dev`, open `/projects` in Chrome device emulation at 390px, and confirm the "New project" anchor measures at least 44x44 with `getBoundingClientRect()`; that would raise the verdict to live-verified.
- Side effect note: the baseline reproduction regenerated the gitignored `__screenshots__/` directories under the five suites (present since the implementer's own baseline run); `git status --porcelain` is clean and HEAD is unchanged.

## Root integration review, 2026-09-05

Integrated via acf55d9, done1336bef. Canonical QA output is qa-0.md; review0 approved and QA0 is done/test-verified, with independently reproduced baseline failures and full51files/292browser cases passing at HEAD85efbce. Root viewed all four before/after PNGs and checked desktop image equality. Mobile390 measured41x32 before and44x44 after; desktop1280 measured121.67x32 both.

Corrections superseding the original evidence/decision row: AC5 is ladder4, real component-harness execution, not ladder5/routed app proof. The preserved workspaceRoutes gate cases after this edit are lines66-72 and108-118. The three low review considerations remain explicit follow-ups in the ticket; no claim is made that the test activates Settings, measures dialog-control width, or restores the incoming viewport. The UI-only temporary review hook was removed after review and QA.
