# Client uploader — dev hand-off checklist

The kit in this folder is what gets zipped and sent to the client.
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
it explicitly only if the client's folder lives somewhere unusual. Any root
under an Applications folder works: the `Client/Fiscal year/…` prefix the
server needs is rebuilt from the root's own absolute path in every mode (see
the root-prefix note below), so a client who picks one client folder, one
fiscal year or a `Submitted` folder still sends correctly labelled paths.

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
- The Mac script has no separate lib: every function sits above a
  `BANHALL_UPLOADER_LIB_ONLY` guard in `banhall-uploader.sh`, so
  `bash tests/run-tests.sh` sources the shipped file itself and calls
  `collect_candidates`, `format_scan_diagnostics`, `root_state`,
  `require_folder`, `under_onedrive`, `sha256_of` and `upload_one` directly —
  no config read, no network, no `upload-log.txt` write. Nothing that reads the
  config or the network may move above that guard. `scripts/loop-verify.sh`
  runs it. The harness re-execs under `/bin/bash` (stock macOS bash 3.2) and
  fails on bash-4 constructs (`declare -A`, `mapfile`, `${x^^}`, `&>>`) and on
  a function defined below the guard, so the client's Mac cannot be where a
  bash-4 edit is discovered.
- `find` never follows symlinks, so the Mac script's old `-type f` filter
  dropped them without counting them. It now walks `-type f -o -type l` and
  classifies each entry in the loop, which is what makes `link` a countable
  skip reason instead of an invisible one.
- A zero-result run is self-diagnosing. `Found 0 document(s)` is followed by
  `Format-ScanDiagnostics` output: files walked, per-reason skip counts, access
  errors, the top 8 extensions seen, and `Under OneDrive sync root:
  yes|no|unknown` (`Test-UnderOneDrive` compares the root against
  `$env:OneDriveCommercial` / `$env:OneDrive` / `$env:OneDriveConsumer`;
  `unknown` means none of the three is set). The same lines go to
  `upload-log.txt` as `SCAN\t…`, so the next zero-result report from the
  client is one file, not a screen share. Counts and extensions only, never a
  document name. The Mac script prints and logs the identical block from
  `format_scan_diagnostics`; its `under_onedrive` compares the root against
  `~/Library/CloudStorage/OneDrive*` and `~/OneDrive*` instead of env vars, and
  returns `unknown` when the machine has neither.
- `upload-log.txt` is cleared by the **first line a run writes**, inside
  `Write-Log`'s `try` (`log_line` on the Mac), not up front: those `SCAN` lines survive the zero-result
  exit, a read-only kit folder still prints the diagnostics instead of dying on
  the truncation, and a run that logs nothing leaves the last real log alone.
  Both closing lines that mention the log are gated on `$script:logWritten`
  (`LOG_WRITTEN` on the Mac), set only after the append returns: when the kit folder is read-only the
  run asks for a screenshot instead of pointing the client at a file that was
  never written.
- Root prefix (Sept 9 bug): `convex/http.ts` rejects a one-segment `?path`;
  for two or more it strips the last segment (the file) and calls
  `classify()` with the directory part, which reads `clientName` from the
  first segment and `fiscalYearLabel` from the second. A two-segment rel
  (`Client/file.docx`) is therefore accepted but has no fiscal year: it lands
  as docKind `unknown` with pair key `Client::?`. Three segments are what
  classification needs. A rel relative to the chosen folder is only right
  when that folder is the Applications folder itself. The client chose a root shaped
  `…\1. Applications\<Client>\2025-03-31\Submitted` and every file came back
  `Invalid or missing ?path`. `Get-RootPrefix` (`uploader-lib.ps1`) and
  `root_prefix` (Mac) now rebuild the `Client/Fiscal year/…/` prefix from the
  root's own absolute path in every mode, not just drag-and-drop: the anchor
  is the last segment containing "applications" (case-insensitive, so
  `1. Applications` and `Applications [2024]` count - kept loose on purpose,
  Sept 9; a client folder whose name contains "applications" would become the
  anchor, a documented risk), the segments after it become the prefix, and the
  Applications folder itself yields an empty prefix so existing uploads keep
  their `local:<rel>` dedupe keys. A root with no anchor also yields an empty
  prefix (it is taken to be the corpus folder, exactly as every run did
  before), and `Get-UploadRefusal` / `upload_refusal` then check that root's
  own rels, counting segments the way the server's `sanitizeRelPath` does
  (trimmed; empty, `.` and `..` dropped): if any rel has fewer than three
  segments, or any *folder* segment of a rel (never the file name) matches
  the anchor pattern - the root sits one or more levels above an Applications
  folder - the run prints guidance naming the folder to choose (every
  matching Applications folder by full path, in the root's own separator),
  logs `REFUSED\t<reason>` and exits before the upload question. An anchored root is never refused: a stray file
  directly in the Applications folder is the server's per-file `REJECTED`,
  not a reason to stop the batch. Before the `y` question the scan prints
  `Labels: <Client> / <Fiscal year> (N files)` for the top five pairs and one
  `Labels: (and N more)` line past that (`Format-LabelSummary` /
  `label_summary`), counts only, never a document name; a rel with fewer than
  three segments is counted under `(missing Client/Fiscal year folders)`. The
  payloads go to `upload-log.txt` as `LABELS\t<Client> / <Fiscal year> (N
  files)` (bare payload after the tab, like every other record), a no-anchor
  root that passed the check as `WARN\t…`, a refusal as `REFUSED\t…`. Row
  order: Windows `Sort-Object` is culture-aware and case-insensitive, the Mac
  sorts with `LC_ALL=C` (byte order); each is deterministic on its own
  platform, and mixed-case ties may order differently between the two. The
  five-row cap is `Get-LabelRowCap` / `LABEL_ROW_CAP`. Both auto-detect
  probes go through `Get-ApplicationsGuess` / `guess_applications_root`
  (exact `Applications` wins, else the first folder containing
  "applications"). Both harnesses also execute the uploader itself in
  folder-argument mode against a throwaway kit with stdin closed, which is
  what surfaced that `Read-Host` returns `$null` on closed stdin and
  `$null -notmatch` is an empty array (falsy): every answer is now compared
  as `"$answer"`, so a closed stdin cancels instead of uploading.
  Operator note: a remembered root that was BELOW the Applications folder
  and previously uploaded two-segment rels successfully (a client folder as
  root gives `FY/file`) will re-stage those files under their corrected
  `Client/FY/file` keys on the next run; expect duplicates in the review
  queue for that population and clear the old `unknown` rows by hand. Both harnesses run
  the screenshot's root shape with placeholder names
  (`C:\Users\writer\Firm Ltd\Production - Documents\1. Applications\Client
  Co\2025-03-31\Submitted`) as a fixture; no real person or client name is
  committed. The Mac `root_segments` turns globbing off around its IFS split
  (a segment `Client [2]` would otherwise match a file `Client 2` in cwd), and
  the Windows lib wraps `Get-RootSegments` in `@()` (a one-segment path comes
  off the pipeline as a string). Both auto-detect probes now use the same
  loose match, so a `1. Applications` folder is offered. Not fixed here: the
  probes only search `$env:OneDrive*` / `$HOME/OneDrive*`, and the client's
  corpus is a SharePoint library synced under `…\<Firm> Ltd\…`, so it is never
  offered and the user always picks manually.
- Corpus-root names hold wildcard characters (`Applications [2024]` is one
  real shape; the same is possible for any client folder below it). Every
  path read parses literally - `Get-Item -LiteralPath`, `Get-FileHash
  -LiteralPath`, `Test-RootUsable` (which uses `Test-Path -LiteralPath`) - and
  `-InFile`, which has no literal twin, is fed a
  `[WildcardPattern]::Escape`d path. A wildcard read of such a folder returns
  nothing rather than failing, so the symptom is an empty root or a null hash,
  not an error. The harness asserts this on the AST.
- Not mirrored on the Mac: the cloud-only pre-warning. macOS exposes no
  cheap per-file dataless flag to `stat`, and the count is a nicety, not a
  diagnostic. Cloud-only files are announced before uploading (`N files are cloud-only and
  will be downloaded by OneDrive while uploading`). `Test-CloudOnly` matches
  the `Offline` attribute or bit `0x400000` (`RecallOnDataAccess`, which has no
  named member on .NET Framework 4.8).
- `Test-RootUsable` (Windows) and `root_state` (Mac) return
  `ok | is_file | missing` and back both root checks: a dropped/argument file is
  skipped with a message, a configured or typed file path exits with `That path
  is a file, not a folder`. On the Mac a run left with no folder at all after
  the argument loop reports the first file argument that way, so one stray file
  alongside real folders still does not kill the run.
- A file that cannot be hashed is logged as `READ_ERROR\t<rel>` and skipped
  without a request: on Windows `Get-FileHash` throws, on the Mac `sha256_of`
  returns nothing (a locked, ACL-denied or failed-to-hydrate file). Sending it
  anyway would put an empty `hash=` in the URL.
- Corrupt/unreadable files land in the Failed tab and are retried on each
  re-run (cheap; visible to the admin).
- The only file either script writes is `upload-log.txt` beside itself.
