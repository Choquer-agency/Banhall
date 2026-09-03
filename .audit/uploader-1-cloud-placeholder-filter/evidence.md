# Evidence · uploader-1-cloud-placeholder-filter
commit: c19b62ae7355   branch: factory/uploader-1-cloud-placeholder-filter   baseline: 470557d8eab88847b54edfe31bda04132a9a7552   date: 2026-09-03   kind: bug

## Coverage
- AC1 (ReparsePoint + empty LinkType is a candidate) → scripts/client-uploader/tests/run-tests.ps1::"AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate" ✓ (ran in `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1`)   [ladder 4]
- AC2 (SymbolicLink / Junction → `link`) → run-tests.ps1::"AC2 symlink is skipped as link", "AC2 junction is skipped as link", "AC2 Test-RealLink is false for a placeholder and true for a symlink" ✓   [ladder 4]
- AC3 (`temp` / `dotfile` / `extension` / plain candidate) → run-tests.ps1::"AC3 Word temp file…", "AC3 dotfile…", "AC3 disallowed extension…", "AC3 allowed plain file is a candidate", "AC3 extension match is case-insensitive" ✓   [ladder 4]
- AC4 (temp tree: exactly one candidate, symlink skipped) → run-tests.ps1::"AC4 exactly one candidate, the real .docx", "AC4 temp and extension skips are tallied", "AC4 the symlink is skipped as link", "AC4 walk reports counts and no errors", "AC4 a missing root yields zero candidates and a recorded error" ✓ (symlink created successfully on this host, so no SKIP for it)   [ladder 4]
- AC5 (`bash scripts/loop-verify.sh` runs the harness and fails on a harness failure) → gate exit 0 clean (`/tmp/loop-verify-final.log`); mutation run exit 1 with `14 passed, 4 failed` (`/tmp/loop-verify-mutant.log`)   [ladder 4]
- AC6 (one filter for all three input modes, 5.1-compatible) → live drive of `banhall-uploader.ps1` in drag-drop, config-root and chooser modes below; `rg -n Get-UploadCandidates scripts/client-uploader/banhall-uploader.ps1` → single call site at `:221` fed by `$r` from `$roots`; AST scan of all three `.ps1` files → parsed ok, 0 ternary/coalesce expressions, no `#Requires`, no `-Parallel`   [ladder 5 for the modes, 4 for the syntax scan]

## Gates
| command | exit | note |
| `npx tsc -p convex/tsconfig.json --noEmit` | 0 | needed `npm ci` first — the worktree had no node_modules |
| `npm run check` | 0 | 5866 files, 0 errors, 0 warnings |
| `npm test` | 0 | 115 files, 1112 tests passed |
| `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1` | 0 | 18 passed, 0 failed, 1 platform SKIP (dotfile enumeration) |
| `bash scripts/loop-verify.sh` | 0 | all four of the above in order |
| done_when × 6 (`test -f` ×2, `rg` ×3, harness) | 0 | run verbatim, all pass |

## Output tails
### bash scripts/loop-verify.sh (tail)
```
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
