# Evidence · workspace-2-drop-dead-gate-branches
commit: 76f9aca   branch: factory/workspace-2-drop-dead-gate-branches   baseline: 07d8557b9373f583a03051fad17282135b6187e1   date: 2026-09-04T09:40:00Z   kind: refactor

## Coverage
- AC1 (resolveWorkspaceExperience deleted, doc-comment reference gone, resolveWorkspaceRouteState takes { workspaceParam, access } only, behaviour unchanged and pinned)
  → `src/lib/dashboard/workspaceExperience.ts` is now 41 lines (was 65); `rg -q 'resolveWorkspaceExperience' src/` finds nothing (exit 1).
  → `src/lib/dashboard/workspaceExperience.test.ts` — 6 tests ✓ (ran in `npx vitest run src/lib/dashboard/workspaceExperience.test.ts`) [ladder 4]
  → equivalence: `pin-truthtable-before.txt` vs `pin-truthtable-after.txt`, `diff` empty [ladder 4]
- AC2 (WorkspaceGate imports no `dev`, passes no localDevelopment)
  → `rg -n "environment|localDevelopment" src/lib/workspace/WorkspaceGate.svelte` exits 1, no output.
  → `npm run check`: 5873 files, 0 errors, 0 warnings [ladder 4]
- AC3 (unit test drops the resolveWorkspaceExperience suite, the localDevelopment cases and the agreement case; the rest passes unchanged)
  → suite is 41 lines; 6 tests ✓. Preserved assertions are byte-identical to the baseline: diffing `git show 07d8557:src/lib/dashboard/workspaceExperience.test.ts` (the baseline) lines 39-61 with the localDevelopment lines removed against the new lines 4-24 yields exactly one differing line, the title `resolves preview when the server says available` (its old title named the deleted local-development branch). [ladder 4]
- AC4 (browser suites no longer model an internal user who is not flagged; ?workspace=current, loading, error and available cases kept and passing)
  → `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts` → 2 files, 20 tests, 20 passed, exit 0 (`component-fix1.txt`). `projectRoute.component.test.ts` run alone with an empty `node_modules/.vite`: 4/4 ✓. [ladder 4]
  → `rg -n "available: false|flagged" src/routes src/lib/workspace` returns no fixture; only unrelated prose elsewhere.
- AC5 (dated 2026-09-03 amendment)
  → `docs/product-domain.md:1559` "### 2026-09-03 (second) — The preview workspace is on for every internal role", with Affected ticket/scope, Decision, Supersedes (cites `:763-766`), Domain impact, Migration and compatibility, Authorization/test impact, Approval. `rg -q '2026-09-03' docs/product-domain.md` exit 0. [ladder 2]

## Gates
| command | exit | note |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | 0 | convex tsc + npm run check + npm test + both uploader harnesses (`gate-loop-verify-fix1.txt`) |
| `npm run check` (inside the gate) | 0 | 5873 files, 0 errors, 0 warnings |
| `npm test` (inside the gate) | 0 | 122 files, 1197 tests passed |
| `npx vitest run src/lib/dashboard/workspaceExperience.test.ts` | 0 | 6 passed |
| component set (2 files, --no-file-parallelism) | 0 | 20 passed (`component-fix1.txt`) |
| `projectRoute.component.test.ts` alone, cold vite cache | 0 | 4 passed |
| `! rg -q 'localDevelopment' src/lib/dashboard/workspaceExperience.ts src/lib/workspace/WorkspaceGate.svelte` | 0 | done_when |
| `! rg -q 'resolveWorkspaceExperience' src/` | 0 | done_when |
| `! rg -q 'from "\$app/environment"' src/lib/workspace/WorkspaceGate.svelte` | 0 | done_when |
| `rg -q '2026-09-03' docs/product-domain.md` | 0 | done_when |

## Output tails
### bash scripts/loop-verify.sh
```

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

1788514252304 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/workspace-2-drop-dead-gate-branches"
1788514252341 COMPLETED 5873 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/workspace-2-drop-dead-gate-branches


 Test Files  122 passed (122)
      Tests  1197 passed (1197)
   Start at  02:30:53
   Duration  7.65s (transform 16.17s, setup 0ms, import 20.21s, tests 14.27s, environment 5.47s)

ok    AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate
```
### component set
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/workspace-2-drop-dead-gate-branches

 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  02:38:53
   Duration  10.98s (transform 0ms, setup 522ms, import 8.42s, tests 546ms, environment 0ms)
```

## Pin
Behaviour contract pinned before the first edit as a truth table over the full input cross-product (5 `workspaceParam` values × 4 `WorkspaceAccessState` values, plus `shouldQueryWorkspaceAccess` per param — 25 rows), produced by a throwaway vitest file that imported the real module and written to `pin-truthtable-before.txt`:

```
"current"	{"status":"loading"}	current
"current"	{"status":"error"}	current
"current"	{"status":"ready","available":false}	current
"current"	{"status":"ready","available":true}	current
"current"	shouldQuery	false
"preview"	{"status":"loading"}	loading
"preview"	{"status":"error"}	current
"preview"	{"status":"ready","available":false}	current
"preview"	{"status":"ready","available":true}	preview
"preview"	shouldQuery	true
…
```

The existing suite was also run green at the baseline first (`pin-unit-baseline.txt`: 11 passed), and the three component suites were run at the baseline to separate inherited failures from new ones (`component-baseline.txt`).

## After
Same table re-generated from the changed module into `pin-truthtable-after.txt`:

```
$ diff pin-truthtable-before.txt pin-truthtable-after.txt
$ echo $?
0
```

Every one of the 25 outcomes is unchanged. The pin file was deleted before the commit; it is reproducible from `decisions.tsv` and the table above.

Reader load went down: `workspaceExperience.ts` loses one exported function, one optional parameter on the surviving one and two near-duplicate doc comments (32 lines removed, 8 added: 65 lines → 41); the test file loses 52 lines and gains 6 (87 → 41); the gate component loses an import, a branch input and a stale contract bullet.

## Live surface
untested: no browser was driven for this ticket. The change deletes a branch that is unreachable at runtime (the only production call site passed `localDevelopment: false`), so there is no visual delta to capture, and `ui=no`. The nearest real-surface proof a human can run is the signed-in app against a deployed backend:
`npm run dev` then visit `/dashboard`, `/projects`, `/my-work` and `/project/<id>` as an internal user, then the same URLs with `?workspace=current`.

## Fix · findings-1 (gate failure, /projects rail anchor)
The gate failure was the assertion at `src/routes/workspaceRoutes.component.test.ts:56`, `href === "/projects?layout=board"`. Mechanism, not a flake: `WorkspaceDashboard.svelte:145-156` (`viewHref`) fills `group=client` on the Projects href whenever the URL omits it, so the rendered anchor is `/projects?layout=board&group=client`. The `layout` param is left alone because the URL already sets it, which is why the `/my-work` half of the same test passed.

The component is right and the assertion was stale. The client-grouped List default is approved owner direction (`docs/product-domain.md:312-314`, "the already-approved client-grouped List default remains authoritative") and shipped in `0b094ed`; `git log -L54,57:src/routes/workspaceRoutes.component.test.ts` shows the assertion was written earlier, in `c5ae6f7`, and never updated. Changing the component to satisfy the old assertion would have reverted an approved default, so the assertion now pins the approved href and the comment names the direction it encodes.

Verified: the gate command exits 0, 20/20 (`component-fix1.txt`); `bash scripts/loop-verify.sh` exits 0; the unit suite exits 0, 6/6; `npm run check` 5873 files, 0 errors; all five `done_when` predicates pass. The entry was dropped from the ticket's `deferred` list. Commit `76f9aca`. [ladder 4]

## Fix · findings-2 (evidence audit: false line counts)
QA passed every executable check and failed the evidence audit on two numbers in `## Pin`. The claim was checked, not assumed: `git diff --numstat 07d8557..HEAD` gives `8	32` for `src/lib/dashboard/workspaceExperience.ts` and `6	52` for `src/lib/dashboard/workspaceExperience.test.ts`. The written "40 lines removed, 14 added" and "loses 58 lines and gains 11" were the `--stat` change totals (32+8=40, 52+6=58) misread as removals, with the additions invented. QA was right.

Corrected to the numstat values, each cross-checked against the file lengths so the sentence is falsifiable two ways:
```
$ git diff --numstat 07d8557..HEAD -- src/lib/dashboard/workspaceExperience.ts src/lib/dashboard/workspaceExperience.test.ts
8       32      src/lib/dashboard/workspaceExperience.ts
6       52      src/lib/dashboard/workspaceExperience.test.ts
$ wc -l src/lib/dashboard/workspaceExperience.ts src/lib/dashboard/workspaceExperience.test.ts
      41 src/lib/dashboard/workspaceExperience.ts
      41 src/lib/dashboard/workspaceExperience.test.ts
$ git show 07d8557:src/lib/dashboard/workspaceExperience.ts | wc -l       # 65  → 65 - 32 + 8 = 41 ✓
$ git show 07d8557:src/lib/dashboard/workspaceExperience.test.ts | wc -l  # 87  → 87 - 52 + 6 = 41 ✓
```

The `HEAD~1` reference in the AC3 line was also stale (at 76f9aca `HEAD~1` is 406a3c8, which already holds the new file), so it now names the baseline sha explicitly. The comparison itself was re-run against the baseline and still holds at ladder 4:
```
$ git show 07d8557:src/lib/dashboard/workspaceExperience.test.ts | sed -n '39,61p' | grep -v localDevelopment > /tmp/pin_base.txt
$ sed -n '4,24p' src/lib/dashboard/workspaceExperience.test.ts > /tmp/pin_new.txt
$ diff /tmp/pin_base.txt /tmp/pin_new.txt
19c19
<   it("resolves preview when the server says available, and in local development", () => {
---
>   it("resolves preview when the server says available", () => {
```
One differing line, the title, exactly as claimed.

No product file changed for this fix, so HEAD stays 76f9aca and the header sha is unchanged; `.audit/` is gitignored, so there is no commit to make. Gates and predicates were re-run at that same sha to confirm the correction did not disturb them (see `## Gates · fix2` below).

## Gates · fix2 (re-run at 76f9aca, after the evidence correction)
| command | exit | note |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | 0 | svelte-check 5873 files / 0 errors / 0 warnings; 122 test files, 1197 tests; uploader harness 18 passed, 0 failed (`gate-loop-verify-fix2.txt`) |
| `npx vitest run src/lib/dashboard/workspaceExperience.test.ts` | 0 | 1 file, 6 tests (`unit-fix2.txt`) |
| `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts` | 0 | 2 files, 20 tests (`component-fix2.txt`) |
| `! rg -q 'localDevelopment' src/lib/dashboard/workspaceExperience.ts src/lib/workspace/WorkspaceGate.svelte` | 0 | done_when 1 |
| `! rg -q 'resolveWorkspaceExperience' src/` | 0 | done_when 2 |
| `! rg -q 'from "$app/environment"' src/lib/workspace/WorkspaceGate.svelte` | 0 | done_when 3 |
| `rg -q '2026-09-03' docs/product-domain.md` | 0 | done_when 4 |

`diff gate-loop-verify-fix1.txt gate-loop-verify-fix2.txt` differs only in the two timestamp lines and the vitest duration line; every count is identical, which is the point of re-running an evidence-only fix.

### Output tails · fix2
#### bash scripts/loop-verify.sh
```
ok    AC5 scripts/loop-verify.sh runs this harness exactly once
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
```
(svelte-check line from the same file: `COMPLETED 5873 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`; vitest line: `Test Files  122 passed (122)` / `Tests  1197 passed (1197)`)

#### npx vitest run src/lib/dashboard/workspaceExperience.test.ts
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  02:51:20
   Duration  199ms (transform 23ms, setup 0ms, import 32ms, tests 4ms, environment 0ms)
```

#### component set (--no-file-parallelism)
```
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  02:51:25
   Duration  11.05s (transform 0ms, setup 580ms, import 8.46s, tests 526ms, environment 0ms)
```

## Not proven
- Component suites are local-only and are not in CI, so AC4 is proven on this machine, not by the gate. The gate proves AC1, AC2, AC3 and AC5. — `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts 'src/routes/project/[id]/projectRoute.component.test.ts'`
- Running `projectRoute.component.test.ts` in a factory worktree needs `ln -s <repo>/node_modules/@convex-dev <worktree>/node_modules/@convex-dev` and an empty `node_modules/.vite`, because `src/lib/chat/agentInternal.ts` imports `../../../node_modules/@convex-dev/agent/dist/*.js`, which only resolves from the main checkout. Untracked, unrelated to this ticket, deferred. — `npx vitest run --config vitest.component.config.ts 'src/routes/project/[id]/projectRoute.component.test.ts'` in a fresh worktree
- The amendment text itself is prose (ladder 2: `docs/product-domain.md:1559-1611`). Its factual claims about the code are each backed by a command above; the approval line records owner direction 2026-09-03 from the plan's `idea.md`, not a message this session saw.

## QA · 2026-09-04T09:47:00Z · claude-code/claude-fable-5-1
commit: 76f9aca3c973a805a32cc5466cacd11d61ca080e   verdict: unproven (min_verdict test-verified not reached; see evidence audit)

| check | result | ladder | note |
| --- | --- | --- | --- |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; convex tsc clean, `svelte-check` 5873 files 0 errors 0 warnings, `npm test` 122 files / 1197 tests passed, uploader harnesses 50/0 and 18/0 |
| ticket verify: `npx vitest run src/lib/dashboard/workspaceExperience.test.ts` | passed | 4 | 1 file, 6 passed |
| ticket verify: component set (2 files, `--no-file-parallelism`) | passed | 4 | 2 files, 20 passed, exit 0 |
| done_when 1 `! rg -q 'localDevelopment' …workspaceExperience.ts …WorkspaceGate.svelte` | passed | 4 | exit 0 |
| done_when 2 `! rg -q 'resolveWorkspaceExperience' src/` | passed | 4 | exit 0 |
| done_when 3 `! rg -q 'from "\$app/environment"' …WorkspaceGate.svelte` | passed | 4 | exit 0 |
| done_when 4 `rg -q '2026-09-03' docs/product-domain.md` | passed | 4 | exit 0; hits at :1485 (transcripts), :1559, :1563, :1610 |
| done_when 5 (unit suite) | passed | 4 | same run as ticket verify, 6/6 |
| smoke | skipped | – | `smoke=''` |
| criteria coverage AC1–AC5 | passed | 4 | see below |
| evidence audit | failed | – | two line-count claims in `## Pin` do not hold; every other claim resolves (see below) |
| kind proof (refactor pin) | passed | 4 | unit suite re-run at HEAD 6/6; baseline test file (`git show 07d8557:…test.ts`) vs HEAD: every surviving `resolveWorkspaceRouteState` assertion byte-identical, one title changed, matches the implementer's claim; `diff pin-truthtable-before.txt pin-truthtable-after.txt` empty; the 25 after-rows hand-walked against the 4-line resolver at HEAD, all agree |
| AC4 third suite `projectRoute.component.test.ts` alone | passed | 4 | 1 file, 4 passed, exit 0 (not in `verify`; run because AC4 names it) |
| live drive | skipped | – | `verify_skill=none`, `ui=no`; no hermetic harness in the allowlist |

### Output tails
`bash scripts/loop-verify.sh` (exit 0):
```
1788515152002 COMPLETED 5873 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  122 passed (122)
      Tests  1197 passed (1197)
50 passed, 0 failed
18 passed, 0 failed
[exited with code 0]
```
`npx vitest run src/lib/dashboard/workspaceExperience.test.ts` (exit 0):
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  02:45:20
   Duration  327ms
```
component set (exit 0):
```
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  02:45:33
   Duration  12.50s (transform 0ms, setup 530ms, import 9.92s, tests 504ms, environment 0ms)
```
`projectRoute.component.test.ts` (exit 0):
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  02:46:18
   Duration  11.62s
```

### Criteria coverage (verified)
- AC1 → `src/lib/dashboard/workspaceExperience.test.ts::resolveWorkspaceRouteState` (5 cases) ✓ asserts current-by-param, loading, error/unavailable → current, available → preview, invalid params; `! rg -q 'resolveWorkspaceExperience' src/` ✓; `workspaceExperience.ts:24-27` signature is `{ workspaceParam, access }` only; gate typecheck proves no remaining importer   [4]
- AC2 → done_when 3 ✓ plus `rg "environment|localDevelopment"` on `WorkspaceGate.svelte` empty; read `:24-36` (imports) and `:74` (call passes `{ workspaceParam, access }`)   [4]
- AC3 → same unit file: `resolveWorkspaceExperience` suite gone, `localDevelopment` lines gone, agreement case gone; surviving assertions byte-identical to baseline (verified against `git show 07d8557:…`); 6/6   [4]
- AC4 → `WorkspaceGate.component.test.ts` (3 fixtures now `__setQueryError`), `workspaceRoutes.component.test.ts` (2 fixtures), `projectRoute.component.test.ts` (1 fixture) ✓ assert current/redirect on a failed query, preview on available, `?workspace=current` precedence, loading; `rg "available: false"` in `src/routes src/lib/workspace` finds no fixture; 20/20 + 4/4   [4]
- AC5 → done_when 4 ✓; read `docs/product-domain.md:1559-1612`: on for every internal role ✓, `?workspace=current` rollback surface ✓, supersedes the `:763-766` clause (text at `:763-766` confirmed) ✓, 2026-08-11 short-circuit only in code comments ✓, rollout tables + `appSettings` master row remain ✓   [4 for the ticket's predicate; content by read]
- Edge case (`ready` + `available: false` → `current`) → unit test `:18-19`, `:27` ✓   [4]

### Evidence audit
Holds: commit sha = HEAD; `workspaceExperience.ts` 41 lines (was 65: numstat +8/−32) ✓; unit 6/6 ✓; `npm run check` 5873/0/0 ✓; `npm test` 122/1197 ✓; component 20/20 ✓; projectRoute 4/4 ✓; all five done_when ✓; amendment at `:1559` with every named field ✓; truth-table diff empty ✓; fix section: `WorkspaceDashboard.svelte:145-156` sets `group=client` when absent ✓, `product-domain.md:313-314` client-grouped List default ✓, commits `0b094ed` and `c5ae6f7` exist ✓; `rg "available: false|flagged"` leaves only prose ✓.

Does not hold (quoted, `## Pin`, "Reader load went down"): "`workspaceExperience.ts` … (40 lines removed, 14 added)" and "the test file loses 58 lines and gains 11". `git diff --numstat 07d8557..HEAD` gives +8/−32 for the module and +6/−52 for the test; 40 and 58 are the `--stat` change totals, not removals, and 14 / 11 match nothing. The headline "41 lines (was 65)" is right; the breakdown is wrong. Principle 16 (prove it works) and 19 (never round up): a false number in evidence is a failed claim even when it carries no acceptance weight, so the audit is recorded as failed rather than waved through.

Minor, not failed: AC3 cites "`git show HEAD~1:…test.ts`"; at 76f9aca `HEAD~1` already holds the new file. The intended comparison (baseline) holds. Comment date mismatch: `workspaceRoutes.component.test.ts:55` says "2026-08-14 owner direction", `WorkspaceDashboard.svelte:149` says "2026-08-19"; evidence.md makes no claim about the date.

### Live drive
- none — `verify_skill=none`, no UI delta claimed (`ui=no`). [–]

### Skipped / needs operator
- smoke — `smoke=''` — nothing to run.
- live drive — no verify skill — a human can run `npm run dev` and visit `/dashboard`, `/projects`, `/my-work`, `/project/<id>` as an internal user, then the same with `?workspace=current`.
- pin truth-table regeneration — the generator was a throwaway vitest file (deleted); `vitest.config.ts` only includes `src/**/*.test.ts`, so re-running it would mean writing a file outside `.audit/`. Re-diffed the stored tables and hand-walked all 25 after-rows against the resolver instead. Principle 1 (smallest change) over a side effect outside the audit boundary.

What raises the verdict to test-verified: correct or delete the two line-count sentences in `## Pin` (and optionally the `HEAD~1` reference), then re-run QA. Every executable check passed at level 4.

## QA · 2026-09-04T09:58:36Z · claude-code/claude-fable-5-1
commit: 76f9aca3c973a805a32cc5466cacd11d61ca080e   verdict: test-verified

Second pass, same HEAD as the first QA (only `.audit/` text changed between passes; `git status --porcelain` empty). Every check re-run rather than carried over (principle 22a: completions are events, not conclusions).

| check | result | ladder | note |
| --- | --- | --- | --- |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; svelte-check 5873 files 0 errors 0 warnings; `npm test` 122 files / 1197 tests; uploader harnesses 50/0 and 18/0 |
| ticket verify: `npx vitest run src/lib/dashboard/workspaceExperience.test.ts` | passed | 4 | 1 file, 6 passed, exit 0 |
| ticket verify: component set (2 files, `--no-file-parallelism`) | passed | 4 | 2 files, 20 passed, exit 0 |
| done_when 1 `! rg -q 'localDevelopment' …workspaceExperience.ts …WorkspaceGate.svelte` | passed | 4 | exit 0 |
| done_when 2 `! rg -q 'resolveWorkspaceExperience' src/` | passed | 4 | exit 0 |
| done_when 3 `! rg -q 'from "\$app/environment"' …WorkspaceGate.svelte` | passed | 4 | exit 0 |
| done_when 4 `rg -q '2026-09-03' docs/product-domain.md` | passed | 4 | exit 0 |
| done_when 5 (unit suite) | passed | 4 | same run as ticket verify, 6/6 |
| smoke | skipped | – | `smoke=''` |
| criteria coverage AC1–AC5 | passed | 4 | see below |
| evidence audit | passed | 4 | the two `## Pin` counts failed last pass now match `git diff --numstat` (+8/−32, +6/−52) and `wc -l` (41, 41; baseline 65, 87); every `## Fix · findings-2` and `## Gates · fix2` claim re-derived, see below |
| kind proof (refactor pin) | passed | 4 | unit suite 6/6 at HEAD; `diff pin-truthtable-before.txt pin-truthtable-after.txt` empty; 25 after-rows walked against `workspaceExperience.ts:28-31` and `:39-41`, all agree; baseline test file lines 39-61 minus the two `localDevelopment` lines vs HEAD lines 4-24 differ only in the one title line |
| AC4 third suite `projectRoute.component.test.ts` alone | passed | 4 | 1 file, 4 passed, exit 0 (not in `verify`; run because AC4 names it) |
| live drive | skipped | – | `verify_skill=none`, `ui=no`; no hermetic harness in the allowlist |

### Output tails
`bash scripts/loop-verify.sh` (exit 0):
```
1788515822348 COMPLETED 5873 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  122 passed (122)
      Tests  1197 passed (1197)
   Start at  02:57:03
50 passed, 0 failed
18 passed, 0 failed
```
`npx vitest run src/lib/dashboard/workspaceExperience.test.ts` (exit 0):
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  02:57:16
   Duration  191ms
```
component set (exit 0):
```
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  02:57:17
   Duration  12.17s (transform 0ms, setup 528ms, import 9.68s, tests 506ms, environment 0ms)
```
`projectRoute.component.test.ts` (exit 0):
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  02:57:43
   Duration  12.49s
```

### Criteria coverage (verified)
- AC1 → `src/lib/dashboard/workspaceExperience.test.ts::resolveWorkspaceRouteState` (5 cases, `:5-30`) ✓ asserts current-by-param mid-load/error/ready, loading, error/unavailable → current, available → preview, invalid params; done_when 2 ✓; `workspaceExperience.ts:24-27` signature is `{ workspaceParam, access }` only, no `resolveWorkspaceExperience` symbol in the file; gate typecheck proves no remaining importer   [4]
- AC2 → done_when 3 ✓; read `WorkspaceGate.svelte:24-36` (no `$app/environment` import) and `:74` (call passes `{ workspaceParam, access }` only)   [4]
- AC3 → same unit file: `resolveWorkspaceExperience` suite gone, both `localDevelopment` assertions gone, agreement case gone; the surviving `resolveWorkspaceRouteState` assertions compared line by line against `git show 07d8557:…test.ts` lines 39-61: byte-identical except the one title at HEAD `:22`; 6/6   [4]
- AC4 → `WorkspaceGate.component.test.ts` (3 fixtures on `__setQueryError`), `workspaceRoutes.component.test.ts` (2 fixtures), `projectRoute.component.test.ts` (1 fixture) ✓ assert current/redirect on a failed query, preview on available, `?workspace=current` precedence, loading; `rg "available: false|flagged"` over `src/routes src/lib/workspace` finds no fixture; 20/20 + 4/4 under `--no-file-parallelism`   [4]
- AC5 → done_when 4 ✓; read `docs/product-domain.md:1559-1612`: on for every internal role ✓, `?workspace=current` rollback surface ✓, supersedes the `:763-766` clause (that text confirmed at `:764-766`) ✓, 2026-08-11 short-circuit only in code comments ✓, rollout tables + `appSettings` master row remain until a separate narrow decision ✓   [4 for the predicate; content by read]
- Edge case (`ready` + `available: false` → `current`) → unit test `:18-19`, `:27`; truth-table rows 3, 8, 13, 18, 23 ✓   [4]

### Evidence audit
Holds: commit sha = HEAD ✓; `git diff --numstat 07d8557..HEAD` → `8 32` module, `6 52` test ✓; `wc -l` 41 / 41 ✓; baseline `wc -l` 65 / 87 ✓ (65−32+8=41, 87−52+6=41) ✓; AC3 now cites the baseline sha and the comparison holds ✓; `diff gate-loop-verify-fix1.txt gate-loop-verify-fix2.txt` differs only in the two svelte-check timestamp lines and the vitest Start/Duration lines, every count identical ✓; `gate-loop-verify-fix2.txt` carries 5873/0/0, 122/1197, 50/0, 18/0 ✓; `unit-fix2.txt` 6/6 ✓; `component-fix2.txt` 20/20 ✓; `.gitignore:68` is `.audit/` ✓; `WorkspaceDashboard.svelte:153` sets `group=client` when absent ✓; `product-domain.md:314` client-grouped List default ✓; commits `0b094ed` and `c5ae6f7` exist ✓; amendment at `:1559` with every named field ✓; truth-table diff empty ✓.

Does not hold: nothing. The two counts that failed the first pass were corrected to the numstat values and each cross-checks against the file lengths.

Not re-checked: the "24 rows" vs "25 rows" wording in `## Pin` says 25 and the stored table has 25 lines ✓ (counted).

### Live drive
- none — `verify_skill=none`, no UI delta claimed (`ui=no`). [–]

### Skipped / needs operator
- smoke — `smoke=''` — nothing to run.
- live drive — no verify skill — a human can run `npm run dev` and visit `/dashboard`, `/projects`, `/my-work`, `/project/<id>` as an internal user, then the same with `?workspace=current`.
- pin truth-table regeneration — the generator was a throwaway vitest file (deleted); regenerating means a file outside `.audit/`. Re-diffed the stored tables and walked all 25 after-rows against the resolver at HEAD instead (principle 1, smallest change, over a side effect outside the audit boundary).

Verdict reasoning: steps 1–5 passed with every criterion at level 4 and no live drive, so `test-verified` (principle 19, never round up: no level-5 proof exists, so not `live-verified`). `min_verdict=test-verified` is met.
