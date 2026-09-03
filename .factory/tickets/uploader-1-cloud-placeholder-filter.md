---
key: uploader-1-cloud-placeholder-filter
status: todo
kind: bug
deps: []
touches: [scripts]
risky: []
verify: [pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1]
done_when: [test -f scripts/client-uploader/uploader-lib.ps1, test -f scripts/client-uploader/tests/run-tests.ps1, "rg -q 'uploader-lib.ps1' scripts/client-uploader/banhall-uploader.ps1", "! rg -q 'FileAttributes\\\\]::ReparsePoint\\\\) -and' scripts/client-uploader/banhall-uploader.ps1", "rg -q 'run-tests.ps1' scripts/loop-verify.sh", pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1]
title: Uploader keeps OneDrive cloud placeholders and skips only real links; filter is a unit-tested function
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.899Z"
---
## Intent
Michael (client, Windows, OneDrive Files On-Demand) runs `Run-Uploader.bat` and every mode prints `Found 0 document(s)` because `banhall-uploader.ps1:211` drops every file whose attributes include `ReparsePoint`, and OneDrive marks every file under a sync root as a cloud reparse point. After this ticket the filter keeps cloud placeholders, skips only real links (symlinks, junctions, non-cloud reparse points), and lives in a function that a `pwsh` harness proves. The next maintainer inherits `uploader-lib.ps1` (pure functions, dot-sourced by the main script) and `tests/run-tests.ps1` wired into the gate.

## Acceptance
- AC1: Given a file object with `Attributes` containing `ReparsePoint` and `LinkType` empty (a OneDrive placeholder) and an allowed extension, when the filter runs, then the file is a candidate.
- AC2: Given a file object whose `LinkType` is `SymbolicLink` or `Junction`, when the filter runs, then it is skipped with reason `link`.
- AC3: Given a `~$` temp file, a dotfile, and a disallowed extension, when the filter runs, then each is skipped with reasons `temp`, `dotfile`, `extension` respectively; an allowed plain file is a candidate.
- AC4: Given a temp directory tree containing a real `.docx`, a symlink to it, a `~$x.docx`, a `.hidden.docx` and a `notes.md`, when `Get-UploadCandidates` walks it, then exactly one candidate (the real `.docx`) is returned and the symlink is skipped.
- AC5: `bash scripts/loop-verify.sh` runs the harness and fails the gate when any harness case fails.
- AC6: `banhall-uploader.ps1` runs the same function for all three input modes (chooser, drag-drop, JSON `root`) and remains Windows PowerShell 5.1 compatible (no `#Requires -Version 7`, no ternary, no `??`, no `-Parallel`).

## Verification
- Bug reproduction at baseline `36df137`, before any change (record output in evidence):
  ```
  pwsh -NoProfile -Command '$allowedExt=@(".docx"); $f=[pscustomobject]@{Attributes=([IO.FileAttributes]"Archive, ReparsePoint");Name="cloud.docx";Extension=".docx";LinkType=$null}; @($f | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not $_.Name.StartsWith("~$") -and -not $_.Name.StartsWith(".") -and $allowedExt -contains $_.Extension.ToLower() }).Count'
  ```
  Expected failure: prints `0` (the inline filter from `banhall-uploader.ps1:209-215` discards the placeholder).
- AC1, AC2, AC3 → `scripts/client-uploader/tests/run-tests.ps1` cases calling `Get-UploadSkipReason` with `[pscustomobject]` fakes (no filesystem).
- AC4 → same harness, a temp-tree case using `New-Item -ItemType SymbolicLink` (skip the symlink sub-case with a printed `SKIP` line if the platform refuses to create links, never a silent pass).
- AC5 → `rg -n run-tests.ps1 scripts/loop-verify.sh`; then `bash scripts/loop-verify.sh` tail in evidence.
- AC6 → `rg -n "Get-UploadCandidates" scripts/client-uploader/banhall-uploader.ps1` shows one call site fed by `$roots`; `rg -n "\\?\\?|\\?\\s*[^:]+:|#Requires" scripts/client-uploader/*.ps1` returns nothing.

## Implementation notes
- New `scripts/client-uploader/uploader-lib.ps1`, functions only, no top-level side effects:
  - `Test-RealLink($file)`: true when `$file.LinkType` is `SymbolicLink` or `Junction`. A `ReparsePoint` attribute with empty `LinkType` is a cloud placeholder and is NOT a link. Do not read `LinkTarget` (absent on 5.1 for some providers).
  - `Get-UploadSkipReason($file, [string[]]$allowedExt)`: returns `$null` (candidate) or one of `link | temp | dotfile | extension`. Order: link, temp, dotfile, extension.
  - `Get-UploadCandidates([string]$root, [string[]]$allowedExt)`: `Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable walkErrors`, applies `Get-UploadSkipReason`, returns `[pscustomobject]@{ Candidates=@(...); Skipped=@{link=n;temp=n;dotfile=n;extension=n}; Errors=@($walkErrors); Walked=n }`. The counts are consumed by `uploader-2-zero-found-diagnostics`; keep them even though this ticket prints nothing new.
- `banhall-uploader.ps1`: after `$scriptDir` (`:35`), dot-source the lib with a clear failure message if missing (`uploader-lib.ps1 must sit next to this script`). Replace `:209-215` with a call to `Get-UploadCandidates $r $allowedExt` and iterate `.Candidates`. Keep `$allowedExt` at `:166` as the single extension list; pass it in, do not duplicate it in the lib.
- Harness `scripts/client-uploader/tests/run-tests.ps1`: plain `pwsh -File` script, no Pester (availability unverified on this Mac). Dot-source only the lib. Count pass/fail, print one line per case, `exit 1` on any failure. Build the temp tree under `[IO.Path]::GetTempPath()` and remove it in `finally`. Never read `uploader-config.json` or `upload-log.txt` (config holds a live key).
- `scripts/loop-verify.sh`: append `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1` after `npm test`. If `pwsh` is missing the gate fails; do not add a soft skip.
- `DEV-HANDOFF.md:45-46` currently says symlinks are skipped; correct it to describe the link/placeholder rule and mention the lib + harness.
- Do NOT touch `banhall-uploader.sh`, `README.txt` wording, or diagnostics output (next tickets). Do not change the upload loop, endpoint, or key handling.

## Edge cases
- Root itself is a junction or symlink: `Get-ChildItem -Recurse` follows it; candidates inside are judged on their own `LinkType`.
- `LinkType` property absent on the object (fake or provider): treat as not a link.
- Empty `allowedExt`: everything skipped with reason `extension` (harness case).
- Attributes value `-1`/unset: `-band` on `$null` must not throw; coerce with `[int]`.
- Access denied subtree: `walkErrors` collects it; the run continues.
- Run twice: pure functions, no state.
