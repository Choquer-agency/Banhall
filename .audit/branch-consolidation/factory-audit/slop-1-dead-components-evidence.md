# Evidence · slop-1-dead-components
commit: ae27b5c6c5597d214d045b4792a102f352d62dec   branch: factory/slop-1-dead-components   baseline: 885ac4b049ea176404fe2e0a4e2e1a4767c7d240   date: 2026-09-05T06:47:00Z   kind: refactor

## Coverage
- AC1 (nine files deleted with `git rm`, no other file edited) → `git show --stat ae27b5c` = 9 files changed, 810 deletions(-), zero insertions; `git status --short` clean after commit. [ladder 4]
- AC2 (`rg` predicate empty; live comment machinery untouched) → `rg -q 'CommentHighlight|CommentSidebar|CommentThread|GapCallout|SectionDivider|ReportViewer|components/ui/Header|InsightTile|MenuToggleIcon' src shared convex scripts` exits 1 (no match). `rg -n 'comment-highlight' src` still hits `src/routes/layout.css:785,794,798,804,809`. `src/lib/components/comments/` still holds CommentInput, CommentOverlay, MarginComments; `src/lib/components/editor/Editor.svelte` present. [ladder 4]
- AC3 (check + test + build pass; the nine verify suites report identical counts) → `.audit/slop-1-dead-components/gate-loop-verify.log`, `build-after.log`, `component-pin-before.log` vs `component-pin-after.log` (both `Test Files 9 passed (9)` / `Tests 24 passed (24)`). [ladder 4]

## Gates
| command | exit | note |
| `bash scripts/loop-verify.sh` | 0 | convex tsc + `npm run check` (0 errors) + `npm test` (129 files / 1430 tests) + both client-uploader harnesses (50 + 18 passed) |
| `PUBLIC_CONVEX_URL=… PUBLIC_CONVEX_SITE_URL=… npm run build` | 0 | built in 26.51s; first attempt failed on a missing `PUBLIC_CONVEX_SITE_URL` in my command, not on the deletion — plan `build-baseline.log:3` shows the baseline set both vars |
| ticket `verify` (9 component suites, `--no-file-parallelism`) | 0 | 9 files / 24 tests, identical before and after |
| `done_when` `! test -e` × 9 | pass | `.audit/slop-1-dead-components/done-when.log` |
| `done_when` `! rg -q …` | pass | rg exit 1 (no match) |

## Output tails
### bash scripts/loop-verify.sh
```
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
1788590658142 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/slop-1-dead-components"
1788590658169 COMPLETED 5872 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 Test Files  129 passed (129)
      Tests  1430 passed (1430)
   Duration  15.27s

50 passed, 0 failed        (scripts/client-uploader/tests/run-tests.ps1)
18 passed, 0 failed        (scripts/client-uploader/tests/run-tests.sh)
```
### PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build
```
[PLUGIN_TIMINGS] Your build spent significant time in plugins. Here is a breakdown:
  - vite-plugin-sveltekit-guard (67%)
  - vite-plugin-sveltekit-virtual-modules (12%)
  - vite-plugin-svelte:load-custom (10%)
  - vite-plugin-svelte:compile (8%)

✓ built in 26.51s

Run npm run preview to preview your production build locally.

> Using @sveltejs/adapter-vercel
  ✔ done
```

## Pin
Ticket refactor pin: the nine `verify` component suites run at baseline `885ac4b`, before any deletion, with chromium installed. `.audit/slop-1-dead-components/component-pin-before.log`:
```
 Test Files  9 passed (9)
      Tests  24 passed (24)
   Start at  23:42:30
   Duration  55.78s (transform 0ms, setup 1.73s, import 23.24s, tests 840ms, environment 0ms)
```
Blast radius taken before the first edit (`.audit/slop-1-dead-components/blast-radius-before.log`): every hit for the nine symbols over `src shared convex scripts` lay inside the dead set itself — `CommentSidebar.svelte:5,159,196` importing `CommentThread`, plus port-provenance comments in `CommentHighlight.ts:2`, `CommentThread.svelte:19`, `ReportViewer.svelte:4`, `SectionDivider.svelte:1`, `GapCallout.svelte:2`. A repo-wide sweep outside `src/lib/components/` found exactly one further reference, `docs/svelte-migration.md:77`, a historical migration inventory naming `ui/MenuToggleIcon` and `ui/Header`; no code path imports `ui/Header.svelte`. Zero callers to migrate.

## After
Same nine suites, same command, at `ae27b5c`. `.audit/slop-1-dead-components/component-pin-after.log`:
```
 Test Files  9 passed (9)
      Tests  24 passed (24)
   Start at  23:45:48
   Duration  19.54s (transform 0ms, setup 972ms, import 15.53s, tests 698ms, environment 0ms)
```
`Test Files` and `Tests` are identical to the pin, which is the ticket's stated equivalence condition. The wider equivalence proof on the real artifact is `npm run build` exit 0 over 4335 transformed modules plus `npm run check` at 0 errors across 5872 files: no module resolved to a deleted path. Reader load drops by 810 lines and nine files across four component directories; no behavior changed.

## Live surface
`ui: false`. Not driven in a browser beyond the component suites, which mount real components in chromium. No user-visible surface changes: the deleted files were unreachable from every route entry point, proven by the blast-radius sweep and by the build resolving with no missing import.

## Not proven
- That no branch outside this worktree imports a deleted file — only `src shared convex scripts` and the repo tree at this baseline were swept. The ticket calls a rebase `npm run check` failure the intended signal. Human command: `git for-each-ref --format='%(refname)' refs/heads | xargs -I{} git grep -l -E 'CommentHighlight|CommentSidebar|CommentThread|GapCallout|SectionDivider|ReportViewer|components/ui/Header|InsightTile|MenuToggleIcon' {} -- src`

## QA · 2026-09-05T07:00:00Z · claude-fable-5-1 (factory-qa)
commit: 84ca3374945d0ccb7a18d0d7a2c3652c0912fee8   verdict: test-verified
| check | result | ladder | note |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0: convex tsc, svelte-check 5872 files 0 errors, vitest 129 files / 1430 tests, uploader harnesses 50 + 18 |
| ticket verify: 9 component suites at HEAD | passed | 4 | `--no-file-parallelism`; 9 files / 24 tests, 35.01s |
| done_when: `! test -e` × 9 | passed | 4 | all nine absent |
| done_when: `! rg -q …` over src shared convex scripts | passed | 4 | rg exit 1, rerun from worktree root after a cwd slip invalidated the first run |
| smoke | skipped | – | none configured |
| criteria coverage AC1–AC3 | passed | 4 | see below |
| evidence audit | passed | 4 | evidence commit ae27b5c ≠ HEAD 84ca337; `git diff --stat ae27b5c..HEAD` is one engine-owned line in the ticket file, outside the boundary; all other claims resolved |
| kind proof (refactor pin at baseline 885ac4b) | passed | 4 | detached checkout, same 9 suites: 9 files / 24 tests, identical to HEAD; branch restored, tree clean |
| `npm run build` at HEAD | skipped | – | denied by QA tool allowlist; implementer `build-after.log` audited: `✓ built in 26.51s`, adapter-vercel `✔ done` |
| live drive | skipped | – | `ui: false`, no verify skill |

### Output tails
```
# bash scripts/loop-verify.sh
1788591227002 COMPLETED 5872 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  129 passed (129)
      Tests  1430 passed (1430)
50 passed, 0 failed
18 passed, 0 failed
[exited with code 0]

# ticket verify at HEAD 84ca337
 Test Files  9 passed (9)
      Tests  24 passed (24)
   Duration  35.01s

# ticket verify at baseline 885ac4b (pin rerun)
 Test Files  9 passed (9)
      Tests  24 passed (24)
   Duration  10.47s
```

### Criteria coverage (verified)
- AC1 → `git diff --numstat 885ac4b..ae27b5c`: nine rows, every insertion count 0, deletions 29+212+184+35+4+207+70+31+38 = 810; no surviving file touched ✓   [4]
- AC2 → done_when rg predicate exit 1 ✓; `rg -n comment-highlight src` still hits `layout.css:785-813`, `Editor.svelte:516-518`, `ReadOnlyEditor.svelte:86-88`; `CommentInput`, `CommentOverlay`, `MarginComments`, `Editor.svelte` present ✓   [4]
- AC3 → gate exit 0 (check + test) ✓; nine verify suites 9/24 at baseline and at HEAD ✓; build not rerun by QA (allowlist), audited from implementer log   [4 for check/test/suites, 2 for build]

### Live drive
- none (`ui: false`)

### Skipped / needs operator
- `npm run build` — QA allowlist denies it — `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build`
- cross-branch import sweep — outside QA scope, already listed by implementer under Not proven

Principles: 16 prove it works (reran pin on the real suites at both SHAs instead of trusting logs); 19 confidence ladder (build left at 2, verdict not rounded up past test-verified); 22 safe verdict from an agent that did not write the code.

## Orchestrator QA record

Independent QA is saved as `qa-0.md`, done / test-verified at 84ca337. It reran the full gate and all nine neighboring browser suites at HEAD and baseline: 24 tests at both, 810 deleted lines across exactly nine files, branch restored. The build was executed successfully by the implementer; QA's direct build command was denied. The final integration gate will include a fresh build after the remaining changes. Restored the implementer's deferred doc reference from 84ca337; pending dx-1 now removes those deleted components from the active reuse list and marks the full old Verify section historical.
