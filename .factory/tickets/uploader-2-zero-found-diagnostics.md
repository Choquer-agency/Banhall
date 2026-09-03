---
key: uploader-2-zero-found-diagnostics
status: todo
kind: feature
deps: [uploader-1-cloud-placeholder-filter]
touches: [scripts]
risky: []
verify: [pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1]
done_when: ["rg -q 'Format-ScanDiagnostics' scripts/client-uploader/uploader-lib.ps1", "rg -q 'cloud-only' scripts/client-uploader/banhall-uploader.ps1", "rg -q 'is a file, not a folder' scripts/client-uploader/banhall-uploader.ps1", "rg -q 'Format-ScanDiagnostics' scripts/client-uploader/tests/run-tests.ps1", "! rg -q 'exactly what was sent' scripts/client-uploader/README.txt", pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1]
title: "Uploader prints and logs a skip breakdown on zero results, warns about cloud-only files, rejects a file path as root"
plan: 20260903-client-sync
deferred: []
updated: "2026-09-03T21:17:39.899Z"
---
## Intent
Owner commitment from the 2026-08-26 meeting: the next zero-result report from the client must be actionable without a screen share. When the scan finds nothing, the uploader prints and logs a breakdown (files walked, skip counts per reason, first extensions seen, whether the root is under a OneDrive sync root). Dehydrated cloud-only files are counted and announced before uploading starts. A `root` that is a file, or does not exist, gets an explicit message. The maintainer inherits one pure formatter in the lib, proved by the harness, and a log that also records the scan.

## Acceptance
- AC1: Given a scan with zero candidates, when the script reaches the found-count step, then it prints `Found 0 document(s)` followed by a diagnostics block containing: `Walked: N files`, one line per skip reason with its count (`link`, `temp`, `dotfile`, `extension`), `Access errors: N`, `Extensions seen: .ext1 (n), .ext2 (n), ...` (top 8), and `Under OneDrive sync root: yes|no|unknown`.
- AC2: Given the same zero-candidate scan, when the script exits, then `upload-log.txt` contains the same diagnostics lines prefixed with `SCAN\t`, and the log is not truncated afterwards.
- AC3: Given candidates whose `Attributes` include `Offline` or the `RecallOnDataAccess` bit (0x400000), when the found-count is printed, then the script prints `N files are cloud-only and will be downloaded by OneDrive while uploading` (omitted when N is 0).
- AC4: Given a JSON `root` or typed path that points at a file, when the script validates the root, then it prints `That path is a file, not a folder: <path>` and exits 1; a non-existent path keeps printing `That folder does not exist`.
- AC5: `Format-ScanDiagnostics` is a pure function in `uploader-lib.ps1` taking the scan result and returning `string[]`, and the harness asserts its output for a fabricated scan result (zero candidates, mixed skip reasons, one access error).
- AC6: `README.txt` and `DEV-HANDOFF.md` describe the new zero-result output and the `SCAN` log lines; the sentence claiming the log lists only what was sent is gone.

## Verification
- AC1, AC5 → harness case: feed a fabricated scan object to `Format-ScanDiagnostics`, assert each required line; `Test-CloudOnly` cases with `Offline` and `0x400000` attributes.
- AC2 → manual run on this Mac against an empty temp folder via `pwsh -File scripts/client-uploader/banhall-uploader.ps1` is blocked by the WinForms chooser; instead the harness asserts the `SCAN\t` prefixing helper output, and the implementer records a code walk of the log write order (`file:line` of truncation and of the diagnostics write) in evidence.
- AC3 → harness case for `Test-CloudOnly`.
- AC4 → harness case cannot drive the interactive script; prove by `rg -n "is a file, not a folder" scripts/client-uploader/banhall-uploader.ps1` sitting inside the root validation branch, plus a helper `Test-RootUsable($path)` in the lib returning `ok | missing | is_file`, covered by a temp-tree harness case.
- AC6 → `rg -n "SCAN" scripts/client-uploader/README.txt scripts/client-uploader/DEV-HANDOFF.md`.

## Implementation notes
- Lib additions: `Test-CloudOnly($file)` (attributes `Offline` or `0x400000`), `Test-RootUsable($path)`, `Format-ScanDiagnostics($scan, [bool]$underOneDrive)`, `Get-ExtensionHistogram($files, $top)`; extend `Get-UploadCandidates` to record extensions of walked files and `CloudOnly` count.
- OneDrive detection: `Test-UnderOneDrive($root)` compares the resolved root against the same three env vars the auto-detect probe reads (`banhall-uploader.ps1:127`: `$env:OneDriveCommercial`, `$env:OneDrive`, `$env:OneDriveConsumer`) as case-insensitive path prefixes; `yes` on a match, `no` when at least one var is set and none matches, `unknown` when none is set. The probe at `:124-137` only picks a candidate folder to scan (env vars plus `Get-ChildItem $HOME -Filter OneDrive*`); it says nothing about whether the chosen root is under a sync root, so do not reuse its result.
- Log: `Set-Content` truncation currently at `banhall-uploader.ps1:258`, after the zero-exit at `:226-229`. Move the truncation and `Write-Log` definition (`:259-261`) above the collection step so the scan lines can be written; write `SCAN\t<line>` per diagnostics line before the zero exit.
- Root validation lives at `:115` and `:155-159`; use `Test-RootUsable` in both.
- Keep the diagnostics block short; never print file names in the zero case (only extensions and counts) to keep the client's screenshots free of document titles.
- Do not change the upload loop or status tokens (`TOO_LARGE`, `READ_ERROR`, `STAGED`, ...). The `READ_ERROR` path at `:274-281` already absorbs hydration failures.
- Do NOT touch `banhall-uploader.sh` (next ticket).

## Edge cases
- Zero files walked at all (empty folder): diagnostics still print with all zeros.
- Root exists but every file is access-denied: `Access errors: N` non-zero, walked 0.
- Thousands of extensions: histogram capped at top 8.
- Attributes lack the cloud bits on macOS test runs: `Test-CloudOnly` returns false; the count line is omitted.
- Log path unwritable: `Write-Log` already swallows; diagnostics still print to console.
