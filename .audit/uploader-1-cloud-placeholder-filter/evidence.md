# Evidence · uploader-1-cloud-placeholder-filter
commit: c19b62ae7355   branch: factory/uploader-1-cloud-placeholder-filter   baseline: 470557d8eab88847b54edfe31bda04132a9a7552   date: 2026-09-03   kind: bug

## Coverage
- AC1 (ReparsePoint + empty LinkType is a candidate) → scripts/client-uploader/tests/run-tests.ps1::"AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate" ✓ (ran in `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1`)   [ladder 4]
- AC2 (SymbolicLink / Junction → `link`) → run-tests.ps1::"AC2 symlink is skipped as link", "AC2 junction is skipped as link", "AC2 Test-RealLink is false for a placeholder and true for a symlink" ✓   [ladder 4]
- AC3 (`temp` / `dotfile` / `extension` / plain candidate) → run-tests.ps1::"AC3 Word temp file…", "AC3 dotfile…", "AC3 disallowed extension…", "AC3 allowed plain file is a candidate", "AC3 extension match is case-insensitive" ✓   [ladder 4]
- AC4 (temp tree: exactly one candidate, symlink skipped) → run-tests.ps1::"AC4 exactly one candidate, the real .docx", "AC4 temp and extension skips are tallied", "AC4 the symlink is skipped as link", "AC4 walk reports counts and no errors", "AC4 a missing root yields zero candidates and a recorded error" ✓ (symlink created successfully on this host, so no SKIP for it)   [ladder 4]
- AC5 (`bash scripts/loop-verify.sh` runs the harness and fails on a harness failure) → run-tests.ps1::"AC5 loop-verify.sh runs the harness under set -e" (one un-commented invocation, one `set -euo pipefail`) and ::"AC5 an injected failing case exits 1 and stops a set -e gate" (spawns this harness with `-InjectFailure` inside `bash -c 'set -euo pipefail'`, asserts exit 1 and that the command after it never runs) ✓; gate exit 0 clean (`/tmp/loop-verify-fix1.log`)   [ladder 4]
- AC6 (one filter for all three input modes, 5.1-compatible) → run-tests.ps1::"AC6 one Get-UploadCandidates call site, inside the foreach over roots" (AST: exactly one `CommandAst`, fed `$r`, enclosing `ForEachStatementAst` binds `$r` over `$roots`), ::"AC6 all three input modes converge on roots" (AST assignments: drag-drop `$roots +=`, one `$roots = @($root)`, `$root` from `$config.root`, `$root` from `Pick-Folder`), ::"AC6 <file> parses and stays Windows PowerShell 5.1 compatible" ×3 (parse errors, `TernaryExpressionAst`, token kinds `QuestionQuestion`/`QuestionQuestionEquals`/`QuestionDot`/`QuestionLBracket`, `-Parallel` parameter, `#Requires -Version ≥6`) ✓; plus the live drive of all three modes below   [ladder 4 by test, 5 for the modes]
- Regression guard (the bug's own mechanism) → run-tests.ps1::"regression banhall-uploader.ps1 never mentions ReparsePoint again" (token scan, comments included) ✓ — this is what the ticket's malformed `done_when` 4 regex was meant to assert   [ladder 4]

## Gates
| command | exit | note |
| `npx tsc -p convex/tsconfig.json --noEmit` | 0 | needed `npm ci` first — the worktree had no node_modules |
| `npm run check` | 0 | 5866 files, 0 errors, 0 warnings |
| `npm test` | 0 | 115 files, 1112 tests passed |
| `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1` | 0 | 26 passed, 0 failed, 1 platform SKIP (dotfile enumeration) — was 18 before fix 1 |
| `bash scripts/loop-verify.sh` | 0 | all four of the above in order |
| done_when × 6 (`test -f` ×2, `rg` ×3, harness) | 0 | run verbatim, all pass |

## Output tails
### bash scripts/loop-verify.sh (tail, fix 1)
```
ok    edge link is checked before temp
ok    edge object without a LinkType property is not a link
ok    edge empty allowed list skips everything as extension
ok    edge missing or unset Attributes does not throw
SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force
ok    AC4 exactly one candidate, the real .docx
ok    AC4 temp and extension skips are tallied
ok    AC4 the symlink is skipped as link
ok    AC4 walk reports counts and no errors
ok    AC4 a missing root yields zero candidates and a recorded error
ok    AC6 banhall-uploader.ps1 parses and stays Windows PowerShell 5.1 compatible
ok    AC6 uploader-lib.ps1 parses and stays Windows PowerShell 5.1 compatible
ok    AC6 run-tests.ps1 parses and stays Windows PowerShell 5.1 compatible
ok    AC6 one Get-UploadCandidates call site, inside the foreach over roots
ok    AC6 all three input modes converge on roots
ok    regression banhall-uploader.ps1 never mentions ReparsePoint again
ok    AC5 loop-verify.sh runs the harness under set -e
ok    AC5 an injected failing case exits 1 and stops a set -e gate

26 passed, 0 failed
```
### npm test (tail)
```
 Test Files  115 passed (115)
      Tests  1112 passed (1112)
   Duration  10.35s
```
### npm run check (tail)
```
1788470975567 COMPLETED 5866 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```
### AST scan (PS 7-only syntax, AC6)
```
banhall-uploader.ps1   parsed ok, ps7-only expressions: 0
uploader-lib.ps1       parsed ok, ps7-only expressions: 0
run-tests.ps1          parsed ok, ps7-only expressions: 0
total ps7-only expressions: 0
```

## Before
Reproduction at the baseline tree (470557d, `banhall-uploader.ps1:209-215` inline filter), run before any edit:
```
$ pwsh -NoProfile -Command '$allowedExt=@(".docx"); $f=[pscustomobject]@{Attributes=([IO.FileAttributes]"Archive, ReparsePoint");Name="cloud.docx";Extension=".docx";LinkType=$null}; @($f | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not $_.Name.StartsWith("~$") -and -not $_.Name.StartsWith(".") -and $allowedExt -contains $_.Extension.ToLower() }).Count'
0
```
`0` = the OneDrive cloud placeholder is discarded. Every file under a Files On-Demand sync root carries `ReparsePoint`, which is why every mode printed `Found 0 document(s)` on Michael's machine.

## After
Same input through the new filter — and the harness that pins it:
```
$ pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1
ok    AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate
ok    AC2 symlink is skipped as link
ok    AC2 junction is skipped as link
ok    AC2 Test-RealLink is false for a placeholder and true for a symlink
ok    AC3 Word temp file is skipped as temp
ok    AC3 dotfile is skipped as dotfile
ok    AC3 disallowed extension is skipped as extension
ok    AC3 allowed plain file is a candidate
ok    AC3 extension match is case-insensitive
ok    edge link is checked before temp
ok    edge object without a LinkType property is not a link
ok    edge empty allowed list skips everything as extension
ok    edge missing or unset Attributes does not throw
SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force
ok    AC4 exactly one candidate, the real .docx
ok    AC4 temp and extension skips are tallied
ok    AC4 the symlink is skipped as link
ok    AC4 walk reports counts and no errors
ok    AC4 a missing root yields zero candidates and a recorded error

18 passed, 0 failed
```
The original repro passes on the same surface: AC1 feeds the identical `[pscustomobject]` (ReparsePoint attribute, `LinkType = $null`) to `Get-UploadSkipReason` and asserts `$null` — a candidate.

Mutation check (the harness fails loud if the bug returns). `Test-RealLink` reverted to the old attribute rule, full gate re-run:
```
$ bash scripts/loop-verify.sh   → exit 1
FAIL  AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate - reason expected '', got 'link'
FAIL  AC2 Test-RealLink is false for a placeholder and true for a symlink - placeholder expected 'False', got 'True'
FAIL  edge link is checked before temp - reason expected 'link', got 'temp'
FAIL  edge missing or unset Attributes does not throw - Attributes -1 expected '', got 'link'
14 passed, 4 failed
```

## Live surface
Drove the real `banhall-uploader.ps1` (copied with `uploader-lib.ps1` into `/tmp/banhall-kit-live`, fake config: `https://example.invalid`, 36-char key) against `/tmp/banhall-tree-live/Acme/2024/` containing `real.docx`, `~$real.docx`, `.hidden.docx`, `notes.md`, and `link.docx` → symlink to `real.docx`. Every run answered `n` at the confirm prompt, so nothing was uploaded and no log was written.

Drag-drop mode (folder passed as an argument):
```
Banhall document uploader
  Scanning (read-only): /tmp/banhall-tree-live
  Uploading to:         https://example.invalid/ingestion/upload

Found 1 document(s) (.docx/.doc/.pdf/.txt/.vtt).
Upload them to the Banhall review queue now? (y/n): n
Cancelled. Nothing was uploaded.
```
Config-`root` mode (`root` set, answered `y` to "Scan this folder again?"): same `Found 1 document(s).`
Chooser mode (`root` empty, answered `c` at the OneDrive guess, typed the path): same `Found 1 document(s).`

One candidate in every mode, and it is the real `.docx` — the symlink, the `~$` temp file, the dotfile and the `.md` are all gone. The lib-missing guard was not driven; it is a `Test-Path` on `$scriptDir/uploader-lib.ps1` (`banhall-uploader.ps1:37-45`)   [ladder 2].

## Not proven
- The fix on a real OneDrive Files On-Demand root — no Windows host and no Files On-Demand provider here, so no file on this machine carries the `ReparsePoint` attribute. Proven instead against a `[pscustomobject]` carrying that exact attribute value, per the plan's own instruction (`research.md:30`). The one command that would close it, on Michael's machine or any Windows box with OneDrive: `pwsh -NoProfile -File scripts\client-uploader\tests\run-tests.ps1` then `Run-Uploader.bat` against the `Applications` folder, expecting a non-zero found count.
- Windows PowerShell 5.1 execution — only pwsh 7.6.5 is installed here. Proven by AST parse of all three files plus a scan for ternary/coalesce/`#Requires`/`-Parallel`; `LinkType` itself has existed on `FileInfo` since PS 5.0   [ladder 2 for the 5.1 claim]. Run on a Windows box: `powershell.exe -NoProfile -File scripts\client-uploader\tests\run-tests.ps1`.
- Junction skipping against a real junction — junctions are Windows-only; covered by a `[pscustomobject]` with `LinkType = "Junction"`. Same Windows command as above.
- The dotfile skip inside `Get-UploadCandidates` on a real tree — macOS/Linux `Get-ChildItem` hides dotfiles without `-Force`, so the harness printed `SKIP` for that sub-case rather than passing it silently. The pure-function case ("AC3 dotfile is skipped as dotfile") covers the rule; the tree case will exercise it on Windows.
- The ticket's AC6 regex `rg -n "\?\?|\?\s*[^:]+:|#Requires" scripts/client-uploader/*.ps1` does not return nothing: it matches the pre-existing upload URI at `banhall-uploader.ps1:289` (`?path=…$([uri]::…`). That is a false positive in the check, not a ternary — it is not part of `done_when`. AC6 was proven with the AST scan above instead.

## Fix 1 · QA finding "criteria coverage" (2026-09-03)
Finding: AC6 and the fail-path half of AC5 had no covering test — they rested on an AST scan and a live drive the QA allowlist could not reproduce. Fix: both are harness cases now, so any agent that can run the gate can reproduce them. No production behavior changed; `uploader-lib.ps1` and `banhall-uploader.ps1` are untouched by this fix (`git diff c19b62a..HEAD --stat` shows only the harness, the handoff doc and `.audit/`).

Harness grew from 18 to 26 cases: 3 × PS 5.1 source scan, 1 × single call site, 1 × mode convergence, 1 × ReparsePoint regression, 1 × loop-verify wiring, 1 × injected-failure exit path.

### Mutation table (each new case fails loud when the thing it asserts breaks)
| mutant | case that caught it | harness result |
| a ternary appended to `uploader-lib.ps1` | AC6 uploader-lib.ps1 … 5.1 compatible | `FAIL … ternary at line 60`, exit 1 |
| a second `Get-UploadCandidates $r $allowedExt` in the uploader | AC6 one call site | `FAIL … expected 1 call site, found 2`, exit 1 |
| `# ReparsePoint attribute check would go here` appended to the uploader | regression … never mentions ReparsePoint | `FAIL … ReparsePoint at line 364`, exit 1 |
| harness line deleted from `scripts/loop-verify.sh` | AC5 loop-verify.sh … under set -e | `FAIL … harness invocations expected '1', got '0'`, exit 1 |
| `$roots = @($root)` → `$roots = @($root.FullName)` | AC6 modes converge on roots | `FAIL … expected one 'roots = @(root)', found 0`, exit 1 |
| `if ($script:fail -gt 0) { exit 1 }` deleted from the harness | AC5 injected failing case … | `FAIL … gate exit code expected '1', got '0'`, exit 1 |

Every mutant was reverted with `git checkout --` (or a copy-back) and the clean harness re-run at `26 passed, 0 failed`.

### The fail-path run, verbatim
```
$ pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1 -InjectFailure
FAIL  AC5 injected failing case (self-test only) - injected on purpose
25 passed, 1 failed
EXIT=1
```
The AC5 case runs exactly that child inside `bash -c 'set -euo pipefail; "$1" -NoProfile -File "$2" -InjectFailure > /dev/null 2>&1; echo REACHED_THE_NEXT_GATE_COMMAND'` and asserts exit 1 with empty output — the same mechanics `scripts/loop-verify.sh` uses.

### done_when 4
The ticket's predicate `! rg -q 'FileAttributes\\]::ReparsePoint\\) -and' …` is a malformed regex: `rg` exits non-zero on `error: unopened group`, which the leading `!` turns into a pass, so it would pass on the unfixed tree too. Not editable from this role (`done_when` is out of scope for a fix), so its intent is now asserted by the "regression banhall-uploader.ps1 never mentions ReparsePoint again" harness case, and a fixed-string search confirms the old filter is gone: `rg -F -n 'ReparsePoint) -and' scripts/client-uploader/banhall-uploader.ps1` → exit 1, no match. Recorded in `deferred`.

## QA · 2026-09-03T21:41:23Z · claude-fable-5-1 (factory-qa, headless allowlist)
commit: 38835263e349a5d51f84b7df8df0663b0b20dd12   verdict: typecheck-only
| check | result | ladder | note |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; tsc + svelte-check (5866 files, 0 errors) + vitest (115 files / 1112 tests) + harness (18 passed, 0 failed, 1 printed SKIP) |
| ticket verification: harness | passed | 4 | ran inside the gate; direct `pwsh -NoProfile -File …run-tests.ps1` was denied by the QA allowlist, same command, same output |
| ticket verification: done_when 1,2,3,5 | passed | 4 | `test -f` ×2, `rg -q uploader-lib.ps1 …`, `rg -q run-tests.ps1 scripts/loop-verify.sh` all exit 0 |
| ticket verification: done_when 4 | passed | 3 | the ticket regex is malformed under rg ("unopened group"), so `!` makes it pass vacuously; proven instead with a fixed-string search for `ReparsePoint) -and` in banhall-uploader.ps1 → no match |
| ticket verification: AC6 call site | passed | 3 | `rg -n Get-UploadCandidates` → one call at :221 fed by `$r` from `$roots`; `$roots` is filled by drag-drop (:105-120), config root (:126-130) and chooser (:135-175), read |
| ticket verification: AC6 regex | passed | 3 | ticket regex matches only the pre-existing URI at banhall-uploader.ps1:289 (false positive, agrees with implementer); `-Parallel|#Requires|\?\?=|\s\?\s` matches only a comment in uploader-lib.ps1:5 |
| smoke | skipped | – | no smoke commands supplied |
| criteria coverage | failed | – | AC1-AC4 at 4; AC5 fail-path and AC6 have no covering test (see below) |
| evidence audit | passed | 4 | sha points at c19b62a, HEAD is 3883526, tree identical outside `.audit/`; tails and test names match |
| kind proof (bug): before | skipped | 2 | `pwsh -NoProfile -Command '…'` denied by allowlist; baseline `git show 470557d:…banhall-uploader.ps1` shows the inline `-band ReparsePoint` filter at :209-215; implementer's `/tmp/repro-before.txt` reads `0` |
| kind proof (bug): after | passed | 4 | harness case "AC1 cloud placeholder … is a candidate" feeds the same ReparsePoint + null LinkType object and asserts `$null` |
| live drive | skipped | – | verify_skill=none; direct pwsh denied, so the implementer's three-mode drive could not be reproduced |

### Output tails
bash scripts/loop-verify.sh (exit 0):
```
 Test Files  115 passed (115)
      Tests  1112 passed (1112)
   Duration  8.99s
ok    AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate
ok    AC2 symlink is skipped as link
ok    AC2 junction is skipped as link
ok    AC2 Test-RealLink is false for a placeholder and true for a symlink
ok    AC3 Word temp file is skipped as temp
ok    AC3 dotfile is skipped as dotfile
ok    AC3 disallowed extension is skipped as extension
ok    AC3 allowed plain file is a candidate
ok    AC3 extension match is case-insensitive
ok    edge link is checked before temp
ok    edge object without a LinkType property is not a link
ok    edge empty allowed list skips everything as extension
ok    edge missing or unset Attributes does not throw
SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force
ok    AC4 exactly one candidate, the real .docx
ok    AC4 temp and extension skips are tallied
ok    AC4 the symlink is skipped as link
ok    AC4 walk reports counts and no errors
ok    AC4 a missing root yields zero candidates and a recorded error

18 passed, 0 failed
```
`git status --short` after the gate: clean.

### Criteria coverage (verified)
- AC1 → run-tests.ps1::"AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate" ✓ asserts `Get-UploadSkipReason` returns `$null` for Attributes `Archive, ReparsePoint`, LinkType `$null`, `.docx`   [4]
- AC2 → run-tests.ps1::"AC2 symlink is skipped as link", "AC2 junction is skipped as link", "AC2 Test-RealLink …" ✓ assert reason `link` for LinkType SymbolicLink / Junction   [4]
- AC3 → run-tests.ps1::"AC3 Word temp file…" (`temp`), "AC3 dotfile…" (`dotfile`), "AC3 disallowed extension…" (`extension`), "AC3 allowed plain file is a candidate" (`$null`) ✓   [4]
- AC4 → run-tests.ps1::"AC4 exactly one candidate, the real .docx" (count 1, name real.docx), "AC4 the symlink is skipped as link" (Skipped.link = 1) ✓ on a real temp tree with real.docx, ~$real.docx, .hidden.docx, notes.md, symlink; dotfile sub-case prints SKIP on macOS as the ticket allows   [4]
- AC5 → "runs the harness": my gate run above shows the harness lines after vitest ✓   [4]. "fails the gate when any case fails": no test; walked `set -euo pipefail` + harness `exit 1` on `$script:fail -gt 0`, and read the implementer's `/tmp/loop-verify-mutant.log` (14 passed, 4 failed) which matches evidence; not re-run by QA because a mutation needs a code edit outside the allowlist   [3]
- AC6 → no covering test. Call site and `$roots` flow read (above); PS 5.1 syntax by search only; implementer's AST scan and three-mode live drive not reproducible here (pwsh denied)   [3]

### Evidence audit
- "commit: c19b62ae7355" ≠ HEAD 3883526. `git diff c19b62a..HEAD --stat` touches only `.audit/**` (decisions.tsv, evidence.md), so the code under test is the one stamped. Passed with note. Principle 22: a new head SHA voids the verdict, but this SHA changed no non-engine file.
- Named tests exist in run-tests.ps1 (all 18 names match the harness source). Tails in `## Gates` / `## After` match my gate run line for line.
- `/tmp/loop-verify-mutant.log` and `/tmp/repro-before.txt` exist and read as claimed.
- Ladder claims: AC1-AC5 at 4 earned. AC6 "ladder 5 for the modes" is the implementer's own drive; QA could not reproduce it, so it counts as an implementer report, not a QA-verified level (principle 22: safe means a verdict from an agent that did not write the code).

### Live drive
- skipped: no verify skill; `pwsh` outside the harness is denied under the QA allowlist.

### Skipped / needs operator
- Bug reproduction at baseline — QA allowlist denies `pwsh -NoProfile -Command`. Run from the worktree: `pwsh -NoProfile -Command '$allowedExt=@(".docx"); $f=[pscustomobject]@{Attributes=([IO.FileAttributes]"Archive, ReparsePoint");Name="cloud.docx";Extension=".docx";LinkType=$null}; @($f | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not $_.Name.StartsWith("~$") -and -not $_.Name.StartsWith(".") -and $allowedExt -contains $_.Extension.ToLower() }).Count'` → expect `0`.
- AC6 three-mode drive and 5.1 syntax scan — not QA-runnable. To reach test-verified without an operator: add a harness case to run-tests.ps1 that parses all three .ps1 files with `[System.Management.Automation.Language.Parser]::ParseFile` and asserts zero TernaryExpressionAst / Coalesce / `#Requires` / `-Parallel`, plus a case asserting exactly one `Get-UploadCandidates` call in banhall-uploader.ps1 (principle 23: encode the check in structure, principle 9: build the lever). live-verified additionally needs a verify skill or smoke command that drives the three modes.
- Real OneDrive Files On-Demand root, Windows PowerShell 5.1, real junction — operator on a Windows box: `powershell.exe -NoProfile -File scripts\client-uploader\tests\run-tests.ps1`, then `Run-Uploader.bat` against `Applications`, expect a non-zero found count.
- done_when 4 regex is malformed (`rg` "unopened group") and passes only because of the leading `!`; ticket file is engine-owned, so recorded here, not fixed. Suggested replacement: `! rg -qF 'ReparsePoint) -and' scripts/client-uploader/banhall-uploader.ps1` (principle 23: a gate that cannot fail proves nothing).
