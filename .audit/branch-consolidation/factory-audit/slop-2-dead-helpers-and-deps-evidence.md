# Evidence · slop-2-dead-helpers-and-deps
commit: 1ac92ae   branch: factory/slop-2-dead-helpers-and-deps   baseline: 588b8c90c2ec39c3b629b120dd548d0db963eb47   date: 2026-09-05T07:34:00Z   kind: refactor

commits: fb6c6b5 (AC1-AC4 source deletions), 8649315 (AC5 dependency removal), 0775565 (deferred on ticket)

## Coverage
- AC1 → `src/lib/workspace/projectIntentHandoff.test.ts::project start handoff > bounds titles and round-trips a title-only handoff` ✓ (renamed from "bounds titles and preserves the title-only compatibility wrappers"); the other two cases keep their names and still pin normalization + one-time consumption + transcript transfer (`normalizes the title and carries transcript intake once`) and TTL expiry + empty discard (`discards stale and empty values`). Duplicate-start precedence and one-time consumption on the real surface: `newProjectPrefill.component.test.ts::/project/new Home intent prefill > keeps duplicate-project prefill authoritative over Home intent` and `> consumes the one-use Home handoff into the editable internal title`, both now calling `stashProjectStart({ title })` / `takeProjectStart()`. Ran in `npx vitest run …` and `npx vitest run --config vitest.component.config.ts …`. [ladder 4 — the browser cases drive Editor.svelte and the real /project/new page in headless chromium and fail loud if wrong; level 5 is the running app]
- AC2 → `src/lib/workspace/stageRankGroups.test.ts::verifiedStageCounts` both cases kept verbatim ✓. `ProjectsClientGroups.svelte:32,124` still compiles and behaves: `ProjectsClientGroups.component.test.ts` 15/15 ✓, including `hides empty statuses only from exact stageCounts…` and `fails honest before backfill…`. [ladder 4]
- AC3 → `src/lib/dashboard/stageFilter.test.ts::stageFilterItemsFromCounts` three rewritten cases ✓: `offers only stages the counts actually populate`, `labels the legacy bucket only when its count is populated`, `totals every project once and qualifies the count while the facets are truncated`. Live call sites exercised by `ProjectsTableView.component.test.ts` 5/5 and `ProjectsDisplayMenu.component.test.ts` 3/3 ✓. [ladder 4]
- AC4 → `extractSections`/`ReportSections` deleted with zero callers (`rg` over src/convex/shared/scripts); `parseCanonicalReport` and `reportSectionMetrics` untouched, covered by `npm test` 1422/1422 ✓. Underline: headless proof 2 registrations/1 duplicate warning → 1 registration/0 warnings in both editable and read-only, underline JSON and schema preserved, toggle off and on still work; real-browser `Editor.component.test.ts` 4/4 ✓ with the duplicate-underline warning count going 8 → 0. The proof was re-run at HEAD 0017ee6 (`underline-proof-fix1.log`): 1 registration / 0 warnings in both editable and read-only, so the read-only path is now measured rather than inferred. [ladder 4]
- AC5 → `npm uninstall` removed 144 packages; `rm -rf node_modules && npm ci` exit 0, no peer warning naming docx/svelte-exmarkdown/tippy.js/eslint; `npm run check` 0 errors, `npm test` 1422 passed, `npm run build` exit 0. `@tiptap/extension-bubble-menu`, `@tiptap/extension-floating-menu`, `convex-helpers`, `@types/bun` and `bun.lock` untouched. [ladder 4]
- AC6 → `git diff --numstat`: every file the ticket deletes from is net negative; `newProjectPrefill.component.test.ts` is net 0 (+5/-5), see **Not proven**. No new export, file or abstraction anywhere in the diff. [ladder 2]

## Gates
| command | exit | note |
| `bash scripts/loop-verify.sh` | 0 | tsc(convex) + svelte-check 5872 files 0 errors + 129 unit files/1422 tests + 68 uploader harness cases |
| `npm run check` | 0 | 5872 files, 0 errors, 0 warnings |
| `npm run build` | 0 | 38.42s real; needs both PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL placeholders (pre-existing, `build-gate-review.md:5`) |
| `rm -rf node_modules && npm ci` | 0 | added 457 packages in 19s |
| `npx vitest run` (3 ticket unit files) | 0 | 3 files / 8 tests |
| `npx vitest run --config vitest.component.config.ts` (5 ticket files) | 0 | 5 files / 33 tests, identical to the pin |
| `node …/underline-registration-proof.mjs` | 0 | 1 registration, 0 duplicate warnings |
| done_when 1/2/4 (`rg` absence predicates) | 1 | all three pass (no match) |

## Pin
Taken at baseline 588b8c9 **before any edit** (`.audit/slop-2-dead-helpers-and-deps/pin-unit-before.log`, `.audit/slop-2-dead-helpers-and-deps/pin-component-before.log`, `.audit/slop-2-dead-helpers-and-deps/underline-before.json`).

Unit — 3 files / 16 cases, exit 0:
```
stageRankGroups.test.ts > groupRowsByStageRank > re-maps frozen-rank server order (on_hold before delivered) into pipeline order losslessly
stageRankGroups.test.ts > groupRowsByStageRank > marks only the deepest loaded run and unreached runs incomplete while pagination is unexhausted
stageRankGroups.test.ts > groupRowsByStageRank > fails EVERY group honest while any loaded row is missing its persisted rank (H2)
stageRankGroups.test.ts > verifiedStageCounts > passes through an internally consistent record
stageRankGroups.test.ts > verifiedStageCounts > rejects an empty record on a row that still counts projects, and any sum mismatch (H3)
stageRankGroups.test.ts > visibleStageGroups > hides only exact-zero stages when stageCounts exist and hide-empty is on
stageRankGroups.test.ts > visibleStageGroups > fails honest before backfill: stageCounts absent disables hiding and qualifies counts
stageRankGroups.test.ts > visibleStageGroups > never renders 0+: zero-loaded incomplete groups carry the explicit unverified marker instead
stageRankGroups.test.ts > visibleStageGroups > never hides a stage with a loaded row even when the exact count disagrees
stageRankGroups.test.ts > visibleStageGroups > keeps legacy conditional: rendered only while rows or counts exist
projectIntentHandoff.test.ts > project start handoff > normalizes the title and carries transcript intake once
projectIntentHandoff.test.ts > project start handoff > bounds titles and preserves the title-only compatibility wrappers
projectIntentHandoff.test.ts > project start handoff > discards stale and empty values
stageFilter.test.ts > dashboard workflow-stage filters > uses canonical stage even when legacy status disagrees
stageFilter.test.ts > dashboard workflow-stage filters > isolates stage-less compatibility rows in a labelled legacy bucket
stageFilter.test.ts > dashboard workflow-stage filters > returns only populated stage options and totals every project once
```

Component — 5 files / 33 cases, exit 0. Baseline defect captured in the same run: **8** `[tiptap warn]: Duplicate extension names found: ['underline']` lines across the 4 `Editor.component.test.ts` cases.

Headless underline proof at baseline — `underlineRegistrations: 2, duplicateWarnings: 1` for `editable: true` **and** `editable: false`.

## After
Unit — 3 files / **8** cases, exit 0. The 8 kept/rewritten cases pass; the 8 deleted cases are listed in `decisions.tsv` as `deleted: tests retired UI` and `deleted: pinned server-side at …`.

Component — 5 files / **33** cases, exit 0. Case list unchanged from the pin. Duplicate-underline warning lines: **0** (was 8).

Headless underline proof after the two-line deletion:
```json
[{"phase":"current","editable":true,"explicitEntriesInSource":0,"underlineRegistrations":1,"duplicateWarnings":0,
  "schemaHasUnderline":true,"initialUnderline":true,"text":"Alpha","toggledOff":true,"toggledOn":true},
 {"phase":"current","editable":false,"explicitEntriesInSource":0,"underlineRegistrations":1,"duplicateWarnings":0,
  "schemaHasUnderline":true,"initialUnderline":true,"text":"Alpha","toggledOff":null,"toggledOn":null}]
```

Diff shape (`git diff --stat 588b8c9 -- src package.json package-lock.json`):
```
 package-lock.json                                  | 2075 +-------------------
 package.json                                       |    4 -
 src/lib/dashboard/stageFilter.test.ts              |   55 +-
 src/lib/dashboard/stageFilter.ts                   |   22 -
 src/lib/reportSections.ts                          |   16 -
 src/lib/tiptapConfig.ts                            |    2 -
 src/lib/workspace/projectIntentHandoff.test.ts     |    8 +-
 src/lib/workspace/projectIntentHandoff.ts          |   10 -
 src/lib/workspace/stageRankGroups.test.ts          |  134 +-
 src/lib/workspace/stageRankGroups.ts               |  170 --
 .../new/newProjectPrefill.component.test.ts        |   10 +-
 11 files changed, 62 insertions(+), 2444 deletions(-)
```

## Output tails
### bash scripts/loop-verify.sh
```
ok    AC1 walk classifies link/temp/dotfile/extension and keeps 3 candidates
ok    AC4 symlink to an allowed file is skipped and counted under link
ok    AC1 argument prefix is prepended to the relative path
ok    AC1 zero-result block reports walked, per-reason skips, extensions, OneDrive
ok    edge empty folder reports zeros and 'Extensions seen: none'
ok    AC1 extension histogram is capped at 8, ties broken alphabetically
ok    edge ext_of matches .NET GetExtension for dotfiles and bare names
ok    AC3 root_state answers ok / is_file / missing
ok    AC3 a file path prints 'That path is a file, not a folder' and exits 1
ok    AC3 a folder passes and a missing path reports 'does not exist'
ok    AC2 an unreadable file logs READ_ERROR and never calls the endpoint
ok    AC2 control: a readable file does reach the stubbed endpoint
ok    AC2 sha256_of returns nothing for an unreadable or missing file
ok    AC1 under_onedrive answers yes / no / unknown
ok    AC5 scripts/loop-verify.sh runs this harness exactly once
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
```

### npm run build
```
  - vite-plugin-svelte:compile (9%)
See https://rolldown.rs/reference/InputOptions.checks#plugintimings for more details.

✓ built in 31.74s

Run npm run preview to preview your production build locally.

> Using @sveltejs/adapter-vercel
  ✔ done
real 38.42
user 45.55
sys 9.48
```

### rm -rf node_modules && npm ci
```
> banhall-app@0.1.0 prepare
> svelte-kit sync || echo ''


added 457 packages in 19s
npm warn allow-scripts 4 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   esbuild@0.27.0 (postinstall: node install.js)
npm warn allow-scripts   esbuild@0.28.1 (postinstall: node install.js)
npm warn allow-scripts   fsevents@2.3.3 (install: (install scripts present))
npm warn allow-scripts   fsevents@2.3.2 (install: (install scripts present))
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

### npx vitest run --config vitest.component.config.ts (5 ticket files)
```
 ✓ |component (chromium)| src/routes/project/new/newProjectPrefill.component.test.ts > /project/new Home intent prefill > consumes the one-use Home handoff into the editable internal title 15ms
 ✓ |component (chromium)| src/routes/project/new/newProjectPrefill.component.test.ts > /project/new Home intent prefill > carries the Home transcript into the wizard without creating anything 17ms
 ✓ |component (chromium)| src/routes/project/new/newProjectPrefill.component.test.ts > /project/new Home intent prefill > keeps duplicate-project prefill authoritative over Home intent 11ms
 ✓ |component (chromium)| src/lib/components/workspace/ProjectsDisplayMenu.component.test.ts > ProjectsDisplayMenu > changes multiple list options without closing the display menu 66ms
 ✓ |component (chromium)| src/lib/components/workspace/ProjectsDisplayMenu.component.test.ts > ProjectsDisplayMenu > dismisses after choosing a sort order 167ms
 ✓ |component (chromium)| src/lib/components/workspace/ProjectsDisplayMenu.component.test.ts > ProjectsDisplayMenu > does not claim client stages are hidden until verified counts are available 11ms

 Test Files  5 passed (5)
      Tests  33 passed (33)
   Start at  00:05:06
   Duration  28.77s (transform 0ms, setup 767ms, import 11.15s, tests 882ms, environment 0ms)
```

## Live surface
Not a UI ticket (`ui: false`), but the Editor change is user-visible behaviour, so it was driven for real: `Editor.component.test.ts` renders `Editor.svelte` in headless chromium against the shared `getEditorExtensions` config. Before: 8 duplicate-underline warnings. After: 0, all 4 cases still green (`.audit/slop-2-dead-helpers-and-deps/pin-component-before.log` vs `.audit/slop-2-dead-helpers-and-deps/pin-component-after.log`). The headless proof additionally instantiates real Tiptap editors in both editable and read-only modes and confirms underline JSON survives and the toggle commands work (`.audit/slop-2-dead-helpers-and-deps/underline-before.json` vs `.audit/slop-2-dead-helpers-and-deps/underline-after.json`).

## Not proven
- AC6 literal wording ("net deletion in **every** touched source file") — `src/routes/project/new/newProjectPrefill.component.test.ts` is net 0 (+5/-5). Migrating one import and four call sites off the deleted wrappers is line-for-line; making that file net negative would require edits the ticket did not ask for. Every other touched file is net negative and nothing new is exported. Check with `git diff --numstat 588b8c9 -- src`.
- `ReadOnlyEditor.svelte:191` has no browser suite of its own. Its underline path is proven only by the headless `editable: false` rows (1 registration, 0 warnings, underline JSON and schema preserved) — the toggle commands are `null` there because a read-only editor has none. To see it in the running app: `npm run dev` and open a report preview surface that mounts `ReadOnlyEditor`, then confirm the browser console has no `[tiptap warn]: Duplicate extension names found` line.
- `npm run build` is not part of `scripts/loop-verify.sh`, so the engine's gate will not re-run it. I ran it by hand: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build` → exit 0.

## QA · 2026-09-05T07:15:00Z · claude-code/claude-fable-5-1
commit: 0775565c66af82ac00c72e2bf6fe7130be48b3c4   verdict: typecheck-only   (status: needs_operator)

| check | result | ladder | note |
| gate `bash scripts/loop-verify.sh` | passed | 4 | tsc(convex) silent, svelte-check 5872 files 0 errors 0 warnings, vitest 129 files / 1422 tests, uploader harness 50 + 18 passed |
| ticket verify: 3 unit suites | passed | 4 | 3 files / 8 tests, case names match evidence |
| ticket verify: 5 component suites (chromium) | passed | 5 | 5 files / 33 tests; 0 `Duplicate extension names` lines in output (pin-component-before.log has 8) |
| done_when 1 (deleted symbols absent in src) | passed | 4 | rg-equivalent search over src: no match for any of the 9 symbols, `stageFilterKey`, or `ReportSections\b` |
| done_when 2 (four deps absent in package.json) | passed | 4 | no match; also absent from package-lock.json `node_modules/*` entries and from node_modules on disk; no import site outside node_modules |
| done_when 4 (Underline import/item absent in tiptapConfig.ts) | passed | 4 | no match |
| AC5 `rm -rf node_modules && npm ci` | skipped | 2 | operator-only: `rm -rf` and `npm ci` denied by QA allowlist. Implementer's npm-ci.log: added 457 packages, exit 0, no peer warning naming the four |
| AC5 `npm run build` | skipped | 2 | operator-only: `npm run build` denied by QA allowlist (with and without env prefix). Implementer's gate-build.log: `✓ built in 31.74s`, adapter-vercel done |
| AC4 headless underline proof (`node …/underline-registration-proof.mjs`) | skipped | 2 | `node` denied by QA allowlist. Read underline-before.json (2 registrations / 1 warning both modes) and underline-after.json (1 / 0 both modes); not rerun |
| evidence audit | passed | 4 | HEAD = 0775565 matches; every named test exists and ran; tails match; StarterKit 3.28.0 on disk registers Underline at starter-kit.ts:264; package.json keeps bubble-menu, floating-menu, convex-helpers, extension-underline; decisions.tsv `deleted:` rows name convex/dashboardStageCounts.test.ts:151 and :424, both cases exist |
| refactor pin | passed | 4 | kept cases pass with unchanged names (verifiedStageCounts x2, projectIntentHandoff x2 unchanged + 1 renamed as AC1 requires); rewritten stageFilter cases pass with names stating the assertion; 8 deleted cases listed in decisions.tsv |
| side effects | passed | 4 | `git status --short` empty after all runs; no files outside .audit/ touched |

### Output tails
gate (`bash scripts/loop-verify.sh`), last lines:
```
 Test Files  129 passed (129)
      Tests  1422 passed (1422)
…
50 passed, 0 failed
…
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
```
unit (`npx vitest run` 3 files):
```
 Test Files  3 passed (3)
      Tests  8 passed (8)
```
component (`npx vitest run --config vitest.component.config.ts` 5 files):
```
 ✓ |component (chromium)| src/lib/components/editor/Editor.component.test.ts > Editor search surface > highlights the expected paragraph for exact, fragment and paraphrase references 8ms

 Test Files  5 passed (5)
      Tests  33 passed (33)
```

### Criteria coverage (verified)
- AC1 → `projectIntentHandoff.test.ts::project start handoff > bounds titles and round-trips a title-only handoff` ✓ asserts `stashProjectStart({title})` → `takeProjectStart().title`; `> normalizes the title and carries transcript intake once` ✓ asserts normalization, transcript transfer, one-time consumption; `> discards stale and empty values` ✓ asserts TTL expiry and blank discard. `newProjectPrefill.component.test.ts::consumes the one-use Home handoff…` and `::keeps duplicate-project prefill authoritative over Home intent` ✓ drive the real `/project/new` page and assert the consumed handoff equals the live empty object. Renamed case confirmed. [5]
- AC2 → `stageRankGroups.test.ts::verifiedStageCounts` two cases ✓ verbatim; `ProjectsClientGroups.svelte:32,124` still imports/calls `verifiedStageCounts`; svelte-check 0 errors; `ProjectsClientGroups.component.test.ts` 15/15 ✓ including hide-empty and fail-honest cases. [5]
- AC3 → `stageFilter.test.ts::stageFilterItemsFromCounts` three cases ✓ assert only populated stages, labelled legacy bucket, totals once (+ truncated qualifier). Both live callers (`AllProjectsView.svelte:142`, `ProjectsTableView.svelte:328-329`) covered by `ProjectsTableView` 5/5 and `ProjectsDisplayMenu` 3/3 ✓. [5]
- AC4 → symbols absent (done_when 1); `npm run check` 0 errors; `Editor.component.test.ts` 4/4 ✓ with zero duplicate-underline warnings in the real browser (editable config). Read-only config (`ReadOnlyEditor.svelte:191`) proven only by the implementer's underline-after.json; not rerun here. [5 editable / 2 read-only]
- AC5 → deps absent (done_when 2, lockfile, disk) [4]; `npm run check` + `npm test` via gate ✓ [4]; clean `npm ci` and `npm run build` skipped operator-only [2].
- AC6 → `git diff --numstat`: every deleted-from source file net negative; `newProjectPrefill.component.test.ts` +5/-5 (net 0) as the implementer disclosed; no new export/file/abstraction in the diff. Literal wording not met on that one file, disclosed in ticket `deferred`. [4 by inspection of the real diff]

### Live drive
- No verify skill. Editor surface → real chromium render of `Editor.svelte` via `Editor.component.test.ts` → 4/4 green, 0 `[tiptap warn]: Duplicate extension names` (was 8 at baseline in pin-component-before.log). [5]

### Skipped / needs operator
- AC5 clean install — `rm -rf` / `npm ci` outside QA allowlist — run: `rm -rf node_modules && npm ci`
- AC5 build — `npm run build` outside QA allowlist — run: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build`
- AC4 read-only underline proof — `node` outside QA allowlist — run: `node .factory/plans/20260904-code-quality-sweep/underline-registration-proof.mjs` and confirm both rows show `underlineRegistrations: 1, duplicateWarnings: 0`
- Raising to `test-verified` needs the first two commands to exit 0 from a human or the engine; the third raises AC4 read-only from level 2 to 4.

Principles behind the verdict: [19 confidence ladder] never round up: three sub-claims I could not execute stay at level 2 even though the implementer's logs look right; [22 safe means a verdict from an agent that did not write the code] the implementer's build/ci logs are inputs, not the verdict; [16 prove it works] the duplicate-underline fix was judged on the real browser output, not the source diff.

## Fix loop 1 · 2026-09-05T07:34:00Z · re-run at HEAD 0017ee6
Findings addressed: `findings-1.md` (verdict `typecheck-only` below the required `test-verified`, held there only because three ticket verification commands were denied by the QA allowlist) plus the one open `consider` from `review-0.md` and two of its `noted` items. No acceptance criterion changed, no test assertion weakened.

Source change: exactly one, `src/lib/dashboard/stageFilter.test.ts:17` case rename (commit `0017ee6`). The old name described rows; the case receives a counts record. Row-to-bucket classification is pinned server-side at `convex/dashboardStageCounts.test.ts:151,424`.

The three commands QA could not run, executed here at HEAD:

| command | exit | note | log |
| `rm -rf node_modules && npm ci` | 0 | added 457 packages in 19s; no peer warning naming docx / svelte-exmarkdown / tippy.js / eslint | `npm-ci-fix1.log` |
| `PUBLIC_CONVEX_URL=… PUBLIC_CONVEX_SITE_URL=… npm run build` | 0 | `✓ built in 30.16s`, `Using @sveltejs/adapter-vercel ✔ done` | `build-fix1.log` |
| `node .factory/plans/20260904-code-quality-sweep/underline-registration-proof.mjs` | 0 | both modes: `explicitEntriesInSource: 0`, `underlineRegistrations: 1`, `duplicateWarnings: 0`, `schemaHasUnderline: true`, `initialUnderline: true`, text preserved; editable mode `toggledOff: true` / `toggledOn: true` | `underline-proof-fix1.log` |

Gate and ticket verify re-run at `0017ee6`:

| command | exit | note | log |
| `bash scripts/loop-verify.sh` | 0 | svelte-check 0 errors; vitest 129 files / 1422 tests; uploader harness 18 passed, 0 failed | `gate-loop-verify-fix1.log` |
| 3 unit suites | 0 | 3 files / 8 tests; renamed case reads `labels the legacy bucket only when its count is populated` | `pin-unit-fix1.log` |
| 5 chromium component suites (`--no-file-parallelism`) | 0 | 5 files / 33 tests; `grep -c "Duplicate extension names"` = 0 | `pin-component-fix1.log` |
| all 4 `done_when` predicates + numstat | — | all PASS; tree clean after every run | `done-when-fix1.log` |

Ladder correction (review `noted`, principle 19): AC1–AC4 were recorded at ladder 5 on the strength of vitest browser-mode component tests and a headless Tiptap harness. Those are ladder 4 — the code ran and fails loud if wrong, but level 5 is the running app. Corrected above. The `ReadOnlyEditor` entry under **Not proven** stands as the one surface still undriven in a real app, but its underline registration is now measured at HEAD rather than inferred from the pre-fix artifact.

### Output tails · fix loop 1
#### node underline-registration-proof.mjs
```
    { "phase": "current", "editable": true,  "explicitEntriesInSource": 0, "underlineRegistrations": 1,
      "duplicateWarnings": 0, "schemaHasUnderline": true, "initialUnderline": true, "text": "Alpha",
      "toggledOff": true, "toggledOn": true },
    { "phase": "current", "editable": false, "explicitEntriesInSource": 0, "underlineRegistrations": 1,
      "duplicateWarnings": 0, "schemaHasUnderline": true, "initialUnderline": true, "text": "Alpha",
      "toggledOff": null, "toggledOn": null }
EXIT=0
```
#### npm run build
```
✓ built in 30.16s

Run npm run preview to preview your production build locally.

> Using @sveltejs/adapter-vercel
  ✔ done
EXIT=0
```
#### npx vitest run --config vitest.component.config.ts --no-file-parallelism (5 suites)
```
 Test Files  5 passed (5)
      Tests  33 passed (33)
EXIT=0
Duplicate extension names: 0 occurrences
```

## QA · 2026-09-05T07:52:00Z · claude-code/claude-fable-5-1
commit: 1ac92aecc17d9b4f7d93a60e15b30d519a8009d4   verdict: test-verified   (status: needs_operator)

| check | result | ladder | note |
| gate `bash scripts/loop-verify.sh` | passed | 4 | tsc(convex) silent, svelte-check 5872 files 0 errors 0 warnings, vitest 129 files / 1422 tests, uploader harness 50 + 18 passed, exit 0 |
| ticket verify: 3 unit suites | passed | 4 | 3 files / 8 tests; case names identical to the fix-loop pin, renamed stageFilter case reads `labels the legacy bucket only when its count is populated` |
| ticket verify: 5 component suites (chromium, `--no-file-parallelism`) | passed | 4 | 5 files / 33 tests; 0 `Duplicate extension names` lines (pin-component-before.log has 8) |
| done_when 1 / AC3+AC4 symbol absence | passed | 4 | rg over src: no match for the 8 done_when symbols, `stageFilterKey`, or `ReportSections\b` |
| done_when 2 (four deps absent) | passed | 4 | absent from package.json, from every package-lock.json entry, and from node_modules on disk; no import site outside node_modules; no eslint config at repo root |
| done_when 4 (Underline import/item absent) | passed | 4 | no match; StarterKit 3.28.0 on disk registers Underline at starter-kit.ts:264 and tiptapConfig.ts does not disable it |
| AC5 `npm run build` | passed | 4 | `PUBLIC_CONVEX_URL=… PUBLIC_CONVEX_SITE_URL=… npm run build` → `✓ built in 30.69s`, adapter-vercel `✔ done` |
| AC5 `rm -rf node_modules && npm ci` | skipped | 2 | operator-only: denied by QA allowlist. package.json and package-lock.json are byte-identical to 0017ee6 where the implementer's npm-ci-fix1.log shows exit 0, 457 packages, no peer warning naming the four |
| AC4 headless underline proof (`node …/underline-registration-proof.mjs`) | skipped | 3 | `node` denied by QA allowlist. Read underline-proof-fix1.log (both modes 1 registration / 0 warnings, EXIT=0). Read-only path walked in source: `ReadOnlyEditor.svelte:191` calls the same `getEditorExtensions` the browser suite drove; `editable` only changes placeholder text |
| evidence audit | passed | 4 | HEAD = 1ac92ae matches evidence header; every named test exists and ran here; tails match; decisions.tsv `deleted:` rows name convex/dashboardStageCounts.test.ts:151 and :424, both cases exist; ladder-4 corrections in fix loop 1 are honest. One stale figure: the "Diff shape" block shows stageFilter.test.ts at 55 +- from 0775565; at HEAD it is 57 (28+/29-) after the rename, and done-when-fix1.log records the current numstat |
| refactor pin | passed | 4 | kept cases pass with unchanged names; rewritten stageFilter cases pass; 8 deleted cases listed in decisions.tsv with `deleted:` reasons |
| side effects | passed | 4 | `git status --short` empty after gate, suites and build; nothing written outside .audit/ |

### Output tails
gate, last lines:
```
 Test Files  129 passed (129)
      Tests  1422 passed (1422)
…
50 passed, 0 failed
…
18 passed, 0 failed
[exited with code 0]
```
unit (3 files):
```
 Test Files  3 passed (3)
      Tests  8 passed (8)
```
component (5 files):
```
 ✓ |component (chromium)| src/lib/components/editor/Editor.component.test.ts > Editor search surface > highlights the expected paragraph for exact, fragment and paraphrase references 7ms

 Test Files  5 passed (5)
      Tests  33 passed (33)
```
build:
```
✓ built in 30.69s

Run npm run preview to preview your production build locally.

> Using @sveltejs/adapter-vercel
  ✔ done
```

### Criteria coverage (verified)
- AC1 → `projectIntentHandoff.test.ts::project start handoff > bounds titles and round-trips a title-only handoff` ✓ asserts `stashProjectStart({title})` then `takeProjectStart().title`; `> normalizes the title and carries transcript intake once` ✓ asserts normalization, transcript transfer, one-time consumption; `> discards stale and empty values` ✓ asserts TTL expiry and blank discard. `newProjectPrefill.component.test.ts::consumes the one-use Home handoff…` and `::keeps duplicate-project prefill authoritative over Home intent` ✓ drive the real `/project/new` page and assert the consumed handoff equals the live empty object. Rename confirmed. [4]
- AC2 → `stageRankGroups.test.ts::verifiedStageCounts` two cases ✓ verbatim; `ProjectsClientGroups.svelte:32,124` still imports and calls `verifiedStageCounts`; svelte-check 0 errors; `ProjectsClientGroups.component.test.ts` 15/15 ✓ incl. hide-empty and fail-honest cases. [4]
- AC3 → `stageFilter.test.ts::stageFilterItemsFromCounts` three cases ✓ assert only populated stages, legacy bucket labelled only when populated, totals once plus the truncated qualifier. Both live callers (`AllProjectsView.svelte:142`, `ProjectsTableView.svelte:328-329`) covered by `ProjectsTableView` 5/5 and `ProjectsDisplayMenu` 3/3 ✓. Deleted `stageFilterKey` rule pinned server-side at `convex/dashboardStageCounts.test.ts:151,424`, ran in the gate. [4]
- AC4 → symbols absent; `npm run check` 0 errors; `Editor.component.test.ts` 4/4 ✓ with zero duplicate-underline warnings in real chromium through the shared `getEditorExtensions`. Read-only editor uses the same function; headless proof not rerun here. [4 shared config / 3 read-only path]
- AC5 → deps absent from package.json, lockfile, disk [4]; `npm run check` + `npm test` via gate ✓ [4]; `npm run build` ✓ [4]; clean `npm ci` skipped operator-only [2, implementer log on identical package.json/lock].
- AC6 → `git diff --numstat 588b8c9..HEAD`: every deleted-from source file net negative; `newProjectPrefill.component.test.ts` +5/-5 (net 0) as disclosed in ticket `deferred`; no new export, file or abstraction in the diff. [4 by inspection of the real diff]

### Live drive
- No verify skill. Editor surface → real chromium render of `Editor.svelte` via `Editor.component.test.ts` → 4/4 green, 0 `[tiptap warn]: Duplicate extension names` (was 8 at baseline). [4]

### Skipped / needs operator
- AC5 clean install — `rm -rf` / `npm ci` outside QA allowlist — run: `rm -rf node_modules && npm ci` (expect exit 0, no peer warning naming docx / svelte-exmarkdown / tippy.js / eslint)
- AC4 read-only underline proof — `node` outside QA allowlist — run: `node .factory/plans/20260904-code-quality-sweep/underline-registration-proof.mjs` and confirm both rows show `underlineRegistrations: 1, duplicateWarnings: 0`

Principles behind the verdict: [16 prove it works] build and every suite were rerun at HEAD rather than carried over from the fix loop; [19 confidence ladder] the two commands I could not execute stay below 4 and are listed with the exact operator command, and vitest browser mode is recorded as 4, not 5; [22 safe means a verdict from an agent that did not write the code] the implementer's npm-ci log is an input to AC5, not its proof, so status is needs_operator rather than done.

## Orchestrator QA record

Canonical QA is [qa-0.md](qa-0.md), test-verified at 1ac92ae, merged as 7b9b01e with done status ac69311. Its needs_operator note is resolved by the independently executed engine commands in [gates-0.md](gates-0.md): npm ci exited 0 in 21759ms, production build in 42792ms, and the direct underline proof in 448ms. npm ci itself replaces an existing node_modules directory. Root also ran the exact bare underline command after integration, exit 0, recorded in [root-integrated-underline.json](root-integrated-underline.json). Both modes have one underline registration, zero warnings and preserved JSON; editable toggles pass. Root git diff --exit-code 1ac92ae HEAD -- package.json package-lock.json src/lib/tiptapConfig.ts exited 0, so these proofs apply to the integrated files. No user action is required for the QA tool restriction. The stale Diff shape number for stageFilter.test.ts is corrected here: 28 insertions / 29 deletions (57 changed lines) at final source; total source/test net deletion remains 355 lines. The one line-for-line prefill test migration is accepted as scoped behavior preservation, not a reason to delete unrelated lines.
