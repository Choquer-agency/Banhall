# Client uploader — dev hand-off checklist

The kit in this folder is what gets zipped and sent to the client (Michael).
Windows runs `banhall-uploader.ps1` (stock PowerShell 5.1+), Mac runs
`banhall-uploader.sh` (stock bash/curl/shasum). Both hit
`POST /ingestion/upload` (convex/http.ts) and land files in the
`/admin/ingestion` review queue — nothing reaches the Brain without approval.

## One-command setup

`setup.sh` auto-provisions everything: fetches the deployment's
INGEST_API_KEY (generating + setting one if missing), resolves the site URL,
writes `uploader-config.json`, and optionally builds the hand-off zip.

    # local testing (dev deployment, URL read from .env.local):
    bash scripts/client-uploader/setup.sh

    # client hand-off (prod key + zip on the Desktop):
    bash scripts/client-uploader/setup.sh --prod \
      --url https://<prod-deployment>.convex.site --zip

The zip excludes setup.sh / dev notes and preserves the Mac launcher's exec
bit (always build it on a Mac; from a Windows-made zip the fallback for a Mac
recipient is `bash banhall-uploader.sh` from Terminal). Send it + tell the
client to read README.txt (double-click, type y).

`root` stays `""` in the config (auto-detects `OneDrive…/Applications`); set
it explicitly only if the client's folder lives somewhere unusual.

## Local dry-run of the kit

Run `setup.sh` (no flags), point `root` at any folder shaped
`Client/Fiscal year/…` if you don't have OneDrive installed, double-click
`Run-Uploader.command`. Re-runs are idempotent (server dedupes by sha256,
recomputed server-side — the client hash is only an upload-integrity check).

## To revoke access

`npx convex env set INGEST_API_KEY "<new random>" --prod` — the old kit's key
stops working immediately. The endpoint refuses to run at all if the key is
unset or shorter than 32 chars.

## Behavior notes

- Files >15MB, unsupported extensions, `~$` Word temp files, dotfiles, and
  real links are skipped client-side; the server re-validates all of it.
  "Real link" means `LinkType` is `SymbolicLink` or `Junction`. A OneDrive
  Files On-Demand placeholder also carries the `ReparsePoint` attribute but
  has no `LinkType`, so it is kept and hydrated on read — filtering on the
  attribute is what made every mode report `Found 0 document(s)`.
  The rule lives in `uploader-lib.ps1` (pure functions, dot-sourced by
  `banhall-uploader.ps1`, must ship beside it in the kit) and is proved by
  `pwsh -NoProfile -File tests/run-tests.ps1`, which `scripts/loop-verify.sh`
  runs. `tests/` is excluded from the client zip. The harness also parses the
  three `.ps1` files and fails on Windows PowerShell 5.1 incompatibilities
  (ternary, `??`, `-Parallel`, `#Requires -Version 7`) or on a second
  `Get-UploadCandidates` call site, so the client's machine cannot be the
  place where a PS7-only edit is discovered.
- A zero-result run is self-diagnosing. `Found 0 document(s)` is followed by
  `Format-ScanDiagnostics` output: files walked, per-reason skip counts, access
  errors, the top 8 extensions seen, and `Under OneDrive sync root:
  yes|no|unknown` (`Test-UnderOneDrive` compares the root against
  `$env:OneDriveCommercial` / `$env:OneDrive` / `$env:OneDriveConsumer`;
  `unknown` means none of the three is set). The same lines go to
  `upload-log.txt` as `SCAN\t…`, so the next zero-result report from the
  client is one file, not a screen share. Counts and extensions only, never a
  document name.
- `upload-log.txt` is cleared by the **first line a run writes**, inside
  `Write-Log`'s `try`, not up front: those `SCAN` lines survive the zero-result
  exit, a read-only kit folder still prints the diagnostics instead of dying on
  the truncation, and a run that logs nothing leaves the last real log alone.
  Both closing lines that mention the log are gated on `$script:logWritten`,
  set only after an `Add-Content` returns: when the kit folder is read-only the
  run asks for a screenshot instead of pointing the client at a file that was
  never written.
- Client folder names hold wildcard characters (`Applications [2024]`). Every
  path read parses literally - `Get-Item -LiteralPath`, `Get-FileHash
  -LiteralPath`, `Test-RootUsable` (which uses `Test-Path -LiteralPath`) - and
  `-InFile`, which has no literal twin, is fed a
  `[WildcardPattern]::Escape`d path. A wildcard read of such a folder returns
  nothing rather than failing, so the symptom is an empty root or a null hash,
  not an error. The harness asserts this on the AST.
- Cloud-only files are announced before uploading (`N files are cloud-only and
  will be downloaded by OneDrive while uploading`). `Test-CloudOnly` matches
  the `Offline` attribute or bit `0x400000` (`RecallOnDataAccess`, which has no
  named member on .NET Framework 4.8).
- `Test-RootUsable` returns `ok | is_file | missing` and backs both root
  checks: a dropped file is skipped with a message, a configured or typed file
  path exits with `That path is a file, not a folder`.
- Corrupt/unreadable files land in the Failed tab and are retried on each
  re-run (cheap; visible to the admin).
- The only file either script writes is `upload-log.txt` beside itself.
