# Evidence · proof-1-parser-budget-sequence
commit: d381a689e74f0d30cd712134735eb58207835f00 (product change; branch HEAD 91733d7 adds only the ticket's deferred frontmatter)   branch: factory/proof-1-parser-budget-sequence   baseline: 539a0e0c6895eedf9a8a6d02ee85ec48729106f7   date: 2026-09-05T07:28:31Z   kind: bug
dependency baseline (PERF-1 fix): f82f2b0 `perf-1-parser-timers-editor-index: release the PDF deadline timer when the race settles`, merged at ed1d24f. Ticket cites PERF-1 worktree commit 77825a2; the fixture at that commit is byte-identical to the one at baseline 539a0e0.

## Coverage
- AC1 → src/lib/parseDocument.test.ts:230-252 `PDF parse deadline > keeps one cumulative 60s budget across the load and every page` ✓. `PageSpec.textContent` is now `() => Promise<{ items: { str: string }[] }>` (:176-181), invoked from the fake page's `getTextContent` (:194). The case defines `page1TextContent = vi.fn(() => after(20_000, …))` and `page2TextContent = vi.fn(never)` (:231-232) and passes them to the unchanged `installPdf(after(20_000, null), …)`. After the first `await vi.advanceTimersByTimeAsync(20_000);` it asserts `toHaveBeenCalledTimes(1)` on page 1 and `not.toHaveBeenCalled()` on page 2 (:246-248); after the second, `toHaveBeenCalledTimes(1)` on page 2 (:252). These are callback observations on the real parser loop (src/lib/parseDocument.ts:191-195) through the existing pdfjs mock. Ran green in the parser suite below. [ladder 4]
- AC2 → same test, :256-263: `await vi.advanceTimersByTimeAsync(19_999);` + `expect(settled).toBe(false);`, then `await vi.advanceTimersByTimeAsync(1);` and the preserved `expect(parsed.content).toBe(\`Page one\n\${pdfPageStopMarker(2)}\`)`, `expect(destroyCalls).toBe(1)`, `expect(vi.getTimerCount()).toBe(0)`. The successful multi-page, never-loading and all three rejection cases are unchanged apart from the later-page rejection's fixture delivery (:290, `textContent: () => Promise.reject(boom)`), which keeps `rejects.toBe(boom)`. Parser suite stays at 19 cases, editor suite at 4 — no test-count increase. Only the two listed test files changed (`git show --stat d381a68`); no production source, config, dependency, export or new module. Editor title corrected at src/lib/components/editor/Editor.component.test.ts:108 with fixture and assertions untouched (EXPECTED_REMOVED 20, EXPECTED_ADDED 21). [ladder 4]
- AC3 → `## Before` / `## After` below: recorded negative (eager) and positive (lazy) runs of the exact named test. [ladder 4]

## Gates
| command | exit | note |
| `bash scripts/loop-verify.sh` | 0 | svelte-check 0 errors / 5872 files; vitest 129 files, 1430 tests passed; PowerShell harness 50 passed 0 failed; bash harness 18 passed 0 failed |
| `npx vitest run src/lib/parseDocument.test.ts --expect.requireAssertions` | 0 | 19 passed (19), same count as baseline |
| `npx vitest run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions --no-file-parallelism` | 0 | 4 passed (4) |
| ticket `done_when` (source guard + single-test JSON reporter) | 0 | fails at baseline, passes at d381a689e74f0d30cd712134735eb58207835f00 — see Before/After |

`--no-file-parallelism` was added to the component command only; it is a runner flag for a known local flake in this repo's browser project and changes no assertion. The ticket's verify command without it is what CI-equivalent runs use.

## Before
Baseline 539a0e0, ticket `done_when` predicate (source guard stage, before any Vitest invocation):
```
import { readFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; const file = "src/lib/parseDocument.test.ts"; const name = "keeps one cumulative 60s budget across the load and every page"; const source = readFileSync(file, "utf8"); const start = source.indexOf("it(" + JSON.stringify(name)); if (start < 0) throw new Error("Missing cumulative-budget test"); const end = source.indexOf("\n  it(", start + 1); const body = source.slice(start, end < 0 ? undefined : end); const required = ["expect(page1TextContent).toHaveBeenCalledTimes(1);", "expect(page2TextContent).not.toHaveBeenCalled();", "expect(page2TextContent).toHaveBeenCalledTimes(1);", "await vi.advanceTimersByTimeAsync(19_999);", "expect(settled).toBe(false);", "await vi.advanceTimersByTimeAsync(1);"]; for (const assertion of required) if (!body.includes(assertion)) throw new Error("Missing required phase/boundary assertion: " + assertion); if (body.split("await vi.advanceTimersByTimeAsync(20_000);").length - 1 !== 2) throw new Error("Expected two explicit sequential 20-second advances"); const report = JSON.parse(execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", file, "--testNamePattern", "^PDF parse deadline " + name + "$", "--reporter=json", "--expect.requireAssertions"], { encoding: "utf8" })); const matches = report.testResults.flatMap(result => result.assertionResults).filter(result => result.title === name); if (!report.success || report.numPassedTests !== 1 || matches.length !== 1 || matches[0].status !== "passed") throw new Error("Expected exactly one passing cumulative-budget test; missing, skipped or failed is not done");
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 ^

Error: Missing required phase/boundary assertion: expect(page1TextContent).toHaveBeenCalledTimes(1);
    at file:///Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/proof-1-parser-budget-sequence/[eval1]:1:866
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:224:26
    at async ModuleLoader.executeModuleJob (node:internal/modules/esm/loader:221:20)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.19.0
exit=1
```

Negative proof at this tree with every new assertion retained, page-1 text promise restored to eager construction before `installPdf` (`const eagerPage1Content = after(20_000, …); const page1TextContent = vi.fn(() => eagerPage1Content);`):
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/proof-1-parser-budget-sequence

 ❯ |src| src/lib/parseDocument.test.ts (19 tests | 1 failed | 18 skipped) 10ms
     × keeps one cumulative 60s budget across the load and every page 9ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |src| src/lib/parseDocument.test.ts > PDF parse deadline > keeps one cumulative 60s budget across the load and every page
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

Received:

  1st vi.fn() call:

    Array []


Number of calls: 1

 ❯ src/lib/parseDocument.test.ts:249:34
    247|     await vi.advanceTimersByTimeAsync(20_000);
    248|     expect(page1TextContent).toHaveBeenCalledTimes(1);
    249|     expect(page2TextContent).not.toHaveBeenCalled();
       |                                  ^
    250|
    251|     // t=40s: page 1's text resolves and only then is page 2 asked for…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
   Start at  00:24:43
   Duration  227ms (transform 57ms, setup 0ms, import 97ms, tests 10ms, environment 0ms)

exit=1
```
The failure is the phase assertion `expect(page2TextContent).not.toHaveBeenCalled();` at parseDocument.test.ts:249, at total time 20,000 ms, because the eagerly created page-1 promise settles with the load and the parser reaches page 2 immediately. It is not a missing test (19 collected, 18 skipped), not a compile error and not a timeout. The eager variable was removed before the green run; `grep -n eagerPage1Content src/lib/parseDocument.test.ts` returns nothing at d381a689e74f0d30cd712134735eb58207835f00.

## After
Same filter, lazy callback restored:
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/proof-1-parser-budget-sequence


 Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
   Start at  00:24:50
   Duration  224ms (transform 57ms, setup 0ms, import 96ms, tests 7ms, environment 0ms)

exit=0
```

Full parser suite:
```

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/proof-1-parser-budget-sequence


 Test Files  1 passed (1)
      Tests  19 passed (19)
   Start at  00:24:55
   Duration  334ms (transform 54ms, setup 0ms, import 96ms, tests 121ms, environment 0ms)

exit=0
```

Editor component suite:
```
12:25:20 AM [vite] (client) [console.warn] [tiptap warn]: Duplicate extension names found: ['underline']. This can lead to issues.
12:25:20 AM [vite] (client) [console.warn] [tiptap warn]: Duplicate extension names found: ['underline']. This can lead to issues.

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  00:25:02
   Duration  18.20s (transform 0ms, setup 895ms, import 457ms, tests 102ms, environment 0ms)

exit=0
```

Ticket `done_when` at d381a689e74f0d30cd712134735eb58207835f00: exit 0 (`.audit/proof-1-parser-budget-sequence/after-done_when.log`). Its JSON-reporter stage requires exactly one passing result for the named case with `--expect.requireAssertions`.

## Live surface
untested: no runtime surface. This ticket changes two test files only; there is no production behavior change to drive in the app. The verifiable surface is the test run itself, recorded above. A human can re-run it with:
```sh
npx vitest run src/lib/parseDocument.test.ts --testNamePattern '^PDF parse deadline keeps one cumulative 60s budget across the load and every page$' --expect.requireAssertions
```

## Not proven
- Nothing. Every acceptance criterion has a covering assertion in a suite that ran green here, and the negative proof shows the new phase assertion fails loud when the sequencing it claims is absent.

## Artifacts
- `.audit/proof-1-parser-budget-sequence/before-done_when.log` — baseline predicate failure
- `.audit/proof-1-parser-budget-sequence/before-negative.log` — eager-timer regression run
- `.audit/proof-1-parser-budget-sequence/after-positive.log` — lazy-callback run
- `.audit/proof-1-parser-budget-sequence/after-done_when.log` — predicate at d381a689e74f0d30cd712134735eb58207835f00
- `.audit/proof-1-parser-budget-sequence/verify-parser.log`, `.audit/proof-1-parser-budget-sequence/verify-editor.log`, `.audit/proof-1-parser-budget-sequence/gate.log`
- `.audit/proof-1-parser-budget-sequence/done_when.sh` — the ticket's predicate extracted verbatim from frontmatter for rerun

## QA · 2026-09-05T07:35:58Z · claude claude-fable-5-1
commit: 91733d72eb71bae5c33745f3f4fd3a9b5f4d182c   verdict: test-verified
| check | result | ladder | note |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; svelte-check 5872 files 0 errors; vitest 129 files / 1430 tests; pwsh harness 50/0; bash harness 18/0 |
| ticket verify 1: parser suite | passed | 4 | 19 passed (19), same count as baseline (16 `it` + 1 `it.each` × 3) |
| ticket verify 2: editor component suite | passed | 4 | 4 passed (4); title at :108 is the AC2 string, fixture 20/21 untouched |
| ticket Verification single-test filter | passed | 4 | 1 passed, 18 skipped, `--expect.requireAssertions` |
| ticket done_when predicate | skipped | 3 | allowlist denied the inline `node -e` and `bash done_when.sh`; both stages verified separately: required strings and exactly two `advanceTimersByTimeAsync(20_000)` read at :246-259, single test passed above |
| smoke | skipped | – | none configured |
| criteria coverage | passed | 4 | see below |
| evidence audit | passed | 4 | see below |
| kind proof (bug): reproduce at baseline | skipped | 3 | cannot check out baseline under allowlist; read `git show 539a0e0:src/lib/parseDocument.test.ts` in full: no `page1TextContent`/`page2TextContent`, single `advanceTimersByTimeAsync(59_999)`, so the source guard throws its first "Missing required phase/boundary assertion" exactly as `before-done_when.log` records |
| kind proof (bug): eager-regression rerun | skipped | 3 | Edit denied; traced: eager `after(20_000)` created at t=0 settles with the load in the same 20 s advance, `withDeadline` resolves on the already-settled promise, loop reaches `getPage(2).getTextContent()` inside the flushed microtasks, so `:249` fails as `before-negative.log` shows |
| kind proof (bug): pass at HEAD | passed | 4 | single test and full suite green at 91733d7 |
| live drive | skipped | – | no verify skill; no runtime surface (test-only change) |

### Output tails
Gate (`bash scripts/loop-verify.sh`, exit 0):
```
 Test Files  129 passed (129)
      Tests  1430 passed (1430)
50 passed, 0 failed
18 passed, 0 failed
```
Parser suite (exit 0): `Tests  19 passed (19)`. Editor suite (exit 0): `Tests  4 passed (4)`, port-in-use retry and tiptap duplicate-extension warnings only. Single test (exit 0): `Tests  1 passed | 18 skipped (19)`.

### Criteria coverage (verified)
- AC1 → src/lib/parseDocument.test.ts:230 `PDF parse deadline > keeps one cumulative 60s budget across the load and every page` ✓ ran under `--expect.requireAssertions`; read :231-252: lazy spies `page1TextContent`/`page2TextContent`, first 20_000 advance then `toHaveBeenCalledTimes(1)` / `not.toHaveBeenCalled()`, second 20_000 advance then page 2 `toHaveBeenCalledTimes(1)`. Parser path parseDocument.ts:191-195 awaits load, getPage, getTextContent sequentially under one deadline, so the spy order is a real observation.   [4]
- AC2 → same test :256-263 ✓ 19_999 advance + `settled` false, 1 ms advance, `Page one\n${pdfPageStopMarker(2)}`, one destroy, zero timers. Rejection case :290 `textContent: () => Promise.reject(boom)` keeps `rejects.toBe(boom)`. Scope: `git show --stat d381a68` lists only the two test files. Editor title :108 matches AC2 string; PREVIEW_PAIRS, EXPECTED_REMOVED 20, EXPECTED_ADDED 21 unchanged in diff.   [4]
- AC3 → evidence `## Before`/`## After` present with baseline 539a0e0, dependency f82f2b0 / ed1d24f (both `git cat-file -t` = commit) and fixed commit d381a68; suites reran green here with no count increase (19 / 4). Negative run not re-executed by QA (Edit denied); mechanism traced, artifact line numbers :247-249 match HEAD source.   [4 for suites and records; 3 for the negative rerun]

### Evidence audit
- "commit d381a68 product change; HEAD 91733d7 adds only deferred frontmatter" ✓ `git log 539a0e0..HEAD` two commits; 91733d7 diff is one ticket line.
- "77825a2 fixture byte-identical to baseline" ✓ `git diff --stat 77825a2 539a0e0 -- src/lib/parseDocument.test.ts` empty.
- "grep eagerPage1Content returns nothing" ✓ no match under src/.
- "19 passed / 4 passed / 1430 tests / 0 errors" ✓ matched my runs.
- "no production source changed" ✓ diff touches only the two listed test files.

### Live drive
- none: no verify skill; ticket is test-only with no runtime surface.

### Skipped / needs operator
- done_when predicate — QA allowlist denied both the inline command and `bash .audit/proof-1-parser-budget-sequence/done_when.sh`; substance verified in parts — `bash .audit/proof-1-parser-budget-sequence/done_when.sh`
- eager-regression rerun (AC3 negative) — Edit to src denied — apply the two-line eager change from `## Before`, run `npx vitest run src/lib/parseDocument.test.ts --testNamePattern '^PDF parse deadline keeps one cumulative 60s budget across the load and every page$' --expect.requireAssertions`, expect failure at :249, revert
- reproduction at baseline — checkout not permitted — `git stash push -u -m qa && git checkout 539a0e0 && bash .audit/proof-1-parser-budget-sequence/done_when.sh; git checkout - && git stash pop`

Principles behind QA decisions: verdict held at test-verified not live-verified because kind proof reached ladder 3 only (principle 19, never round up); done_when recorded as skipped rather than passed despite verifying both stages separately (principle 16, prove it works against the real artifact); the eager rerun was attempted rather than trusted from the implementer's log (principle 22, verdict from an agent that did not write the code).

## Orchestrator QA record

The canonical independent QA result is [qa-0.md](qa-0.md), verdict test-verified at 91733d7, with source d381a68 merged as 7a32eee. The engine separately passed the full done_when predicate after QA. Independent source review also confirmed the eager negative control fails at the intended 20-second assertion and the lazy fixture passes, with no production edit or new test. QA could not independently make the temporary eager edit under its allowlist; that limitation remains explicit in qa-0.md. This closes PERF1-PROOF-1 in the sweep execution findings.
