# Banhall document uploader (Path B — BNH-17).
#
# Walks your OneDrive "Applications" folder (READ-ONLY — nothing is modified,
# moved, or deleted) and uploads past PDs / transcripts to the Banhall app,
# where they wait in a review queue. Nothing enters the AI knowledge base
# until an admin reviews and approves each file inside the app.
#
# Two ways to run it:
#   - Double-click Run-Uploader.bat  → auto-detects / asks for the folder.
#   - DRAG one or more folders onto Run-Uploader.bat → scans exactly those
#     folders (e.g. drag a client's "PDs", "Drafts", and "Supporting
#     Documents" folders together).
#
# In every mode the uploaded paths are rebuilt relative to the "Applications"
# folder in the chosen folder's own location (full path if none), so
# Client/Fiscal year context — and dedupe against full-folder runs — is
# preserved no matter which folder under Applications is chosen or dragged.
#
# Runs on the PowerShell built into Windows (5.1+). No installs needed.
# Configuration comes from uploader-config.json next to this script.
#
# Security posture:
#   - Read-only on your files; the only thing written is upload-log.txt
#     next to this script.
#   - Talks to exactly ONE https endpoint (printed before anything is sent).
#   - The access key in uploader-config.json only allows adding files to the
#     review queue — it cannot read, change, or delete anything — and can be
#     revoked server-side at any time.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)

$ErrorActionPreference = "Stop"
# PS 5.1 renders a progress bar per Invoke-RestMethod -InFile call — a
# well-known ~10x throughput killer across thousands of uploads.
$ProgressPreference = "SilentlyContinue"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# File selection lives in uploader-lib.ps1 so a test harness can prove it.
$libPath = Join-Path $scriptDir "uploader-lib.ps1"
if (-not (Test-Path $libPath)) {
    Write-Host "Missing uploader-lib.ps1 - it must sit next to this script." -ForegroundColor Red
    Write-Host "Unzip the whole kit into one folder and run it from there."
    Read-Host "Press Enter to close"
    exit 1
}
. $libPath

$configPath = Join-Path $scriptDir "uploader-config.json"
$logPath = Join-Path $scriptDir "upload-log.txt"

if (-not (Test-Path $configPath)) {
    Write-Host "Missing uploader-config.json next to this script." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$appUrl = "$($config.url)".TrimEnd("/")
$key = "$($config.key)"
if (-not $appUrl.StartsWith("https://")) {
    Write-Host "Config error: url must start with https://" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
if ($key.Length -lt 32) {
    Write-Host "Config error: key looks wrong (too short)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# Remember the chosen folder for next time.
function Save-Root([string]$chosen) {
    $config.root = $chosen
    $config | ConvertTo-Json | Set-Content -Path $configPath
}

# Native Windows folder chooser; falls back to typing a path.
function Pick-Folder([string]$start) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Choose the folder that holds your client documents"
        if ((Test-RootUsable $start) -eq "ok") { $dlg.SelectedPath = $start }
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return $dlg.SelectedPath
        }
        return ""
    } catch {
        return Read-Host "Type the full path of the folder to scan"
    }
}

# Folders to scan.
#
# Drag-and-drop wins: folders dropped onto Run-Uploader.bat arrive here as
# $Paths and are scanned as-is (the choice is not persisted — a plain
# double-click later still uses the remembered root).
#
# Otherwise: config "root" wins. Otherwise auto-detect the synced OneDrive
# folder, look for an "Applications" folder up to 2 levels deep, confirm the
# guess with the user, and let them pick the real folder if the guess is
# wrong — we can't assume every machine's layout.
$roots = @()
if ($Paths -and $Paths.Count -gt 0) {
    foreach ($p in $Paths) {
        $dropState = Test-RootUsable $p
        if ($dropState -eq "ok") {
            $roots += (Get-Item -LiteralPath $p).FullName
        } elseif ($dropState -eq "is_file") {
            Write-Host "  ! skipped (drop folders, not single files): $p" -ForegroundColor Yellow
        } else {
            Write-Host "  ! skipped (not found): $p" -ForegroundColor Yellow
        }
    }
    if ($roots.Count -eq 0) {
        Write-Host "None of the dropped items were folders." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
} else {
    $root = "$($config.root)"
    $foundOneDrive = $null
    # A remembered folder is a default, not a lock-in: confirm it each run and
    # offer the chooser again (client feedback Aug 18).
    $rememberedState = Test-RootUsable $root
    if ($rememberedState -eq "ok") {
        Write-Host "Last time you scanned:"
        Write-Host "  $root"
        $again = Read-Host "Scan this folder again? (y = yes / c = choose a different folder)"
        if ("$again" -notmatch "^[Yy]") { $root = Pick-Folder $root }
    } elseif ($rememberedState -eq "is_file") {
        # A remembered path that now names a file is a broken config, not a
        # folder to guess past: stop the same way a typed one does.
        Write-Host "That path is a file, not a folder: $root" -ForegroundColor Red
        Write-Host "Choose the folder that holds your client documents instead."
        Read-Host "Press Enter to close"
        exit 1
    } elseif ($root) {
        Write-Host "The remembered folder no longer exists: $root"
        $root = ""
    }
    if (-not $root) {
        $guess = ""
        $oneDriveRoots = @()
        foreach ($envRoot in @($env:OneDriveCommercial, $env:OneDrive, $env:OneDriveConsumer)) {
            if ($envRoot -and (Test-Path $envRoot)) { $oneDriveRoots += $envRoot }
        }
        $oneDriveRoots += Get-ChildItem -Path $HOME -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }
        foreach ($od in ($oneDriveRoots | Select-Object -Unique)) {
            $foundOneDrive = $od
            $guess = Get-ApplicationsGuess $od
            if ($guess) { break }
        }

        if ($guess) {
            Write-Host "Found a likely documents folder:"
            Write-Host "  $guess"
            $pick = Read-Host "Scan this folder? (y = yes / c = choose a different folder)"
            if ("$pick" -match "^[Yy]") { $root = $guess }
            else { $root = Pick-Folder $guess }
        } elseif ($foundOneDrive) {
            Write-Host "Found your OneDrive at: $foundOneDrive"
            Write-Host "Now choose the folder inside it that holds your client documents."
            $root = Pick-Folder $foundOneDrive
        } else {
            Write-Host "Could not find a OneDrive folder on this computer."
            Write-Host "Choose the folder that holds your client documents."
            $root = Pick-Folder $HOME
        }
    }
    $rootState = Test-RootUsable $root
    if ($rootState -ne "ok") {
        if ($rootState -eq "is_file") {
            Write-Host "That path is a file, not a folder: $root" -ForegroundColor Red
            Write-Host "Choose the folder that holds your client documents instead."
        } else {
            Write-Host "That folder does not exist: $root" -ForegroundColor Red
        }
        Read-Host "Press Enter to close"
        exit 1
    }
    $root = (Get-Item -LiteralPath $root).FullName
    # Persist so the next run scans the same folder without asking again.
    Save-Root $root
    $roots = @($root)
}

$allowedExt = @(".docx", ".doc", ".pdf", ".txt", ".vtt")
$maxBytes = 15MB
$testCap = 100

Write-Host ""
Write-Host "Banhall document uploader" -ForegroundColor Cyan
foreach ($r in $roots) {
    Write-Host "  Scanning (read-only): $r"
}
Write-Host "  Uploading to:         $appUrl/ingestion/upload"
Write-Host ""

# Log incrementally (UTF-8): a crash, Ctrl-C, or closed window mid-run must
# not lose the record of what was already sent. The previous run's log is
# cleared by the first line this run writes, inside the same try as the write:
# a read-only kit folder must not kill the run before it prints the very
# diagnostics the client is being asked for, and a run that uploads nothing
# leaves the last real log alone.
# $logWritten is what the closing lines are allowed to claim: a read-only kit
# folder swallows every write, and telling the client to send a file that was
# never written recreates the unactionable report this run exists to end.
$script:logStarted = $false
$script:logWritten = $false
function Write-Log([string]$line) {
    try {
        if (-not $script:logStarted) {
            Set-Content -Path $logPath -Value @() -Encoding UTF8
            $script:logStarted = $true
        }
        Add-Content -Path $logPath -Value $line -Encoding UTF8
        $script:logWritten = $true
    } catch {}
}

# Collect candidate files across every root. Get-UploadCandidates decides what
# counts as a document: real links (symlinks, junctions) are skipped, OneDrive
# cloud placeholders are kept (note: PS 5.1's -Recurse can still traverse
# directory junctions — keep the corpus free of junction loops). Duplicate rels
# (nested/overlapping drops) are uploaded once.
#
# The server reads clientName from the first path segment and fiscalYear from
# the second (`Client/Fiscal year/…`): it rejects a one-segment path; it
# accepts two but classifies the directory part alone, so the fiscal year is
# undefined and the item lands as docKind "unknown" (pair key "Client::?");
# three segments are what classification needs. A rel relative to the chosen
# folder alone is therefore only right when that folder IS the Applications
# folder. Get-RootPrefix rebuilds the
# ancestry from the root's own absolute path in every mode (remembered,
# chosen, dropped): a folder below the client level still sends
# `Client/Fiscal year/…`, and the Applications folder itself yields an empty
# prefix, so existing uploads keep their dedupe keys. A root with no
# Applications folder above it also gets an empty prefix (it is taken to be
# the corpus folder, as every run did before), and Get-UploadRefusal checks
# that assumption against what the scan found before anything is sent.
$entries = New-Object System.Collections.Generic.List[object]
$seenRel = New-Object 'System.Collections.Generic.HashSet[string]'
$scans = New-Object System.Collections.Generic.List[object]
$refusals = New-Object System.Collections.Generic.List[object]
$unanchored = New-Object System.Collections.Generic.List[string]
foreach ($r in $roots) {
    $prefix = Get-RootPrefix $r
    $scan = Get-UploadCandidates $r $allowedExt
    $scans.Add([pscustomobject]@{ Root = $r; Scan = $scan })
    $rootRels = New-Object System.Collections.Generic.List[string]
    foreach ($f in $scan.Candidates) {
        $rel = $prefix + ($f.FullName.Substring($r.Length).TrimStart("\", "/") -replace "\\", "/")
        $rootRels.Add($rel)
        if ($seenRel.Add($rel)) {
            $entries.Add([pscustomobject]@{ File = $f; Rel = $rel })
        }
    }
    if ((Get-RootAnchorIndex $r) -lt 0) {
        $refusal = Get-UploadRefusal $rootRels.ToArray() $r
        if ($refusal) { $refusals.Add($refusal) } else { $unanchored.Add($r) }
    }
}
$entries = $entries | Sort-Object Rel

Write-Host ("Found {0} document(s) (.docx/.doc/.pdf/.txt/.vtt)." -f @($entries).Count)

# Show what the server will label the files with before asking for a y: the
# client and fiscal-year folders with a count, never a document name. The same
# lines go to the log so a mislabelled batch can be traced to the run.
foreach ($line in @(Get-LabelLines @(@($entries) | ForEach-Object { $_.Rel }))) {
    Write-Host ("  Labels: " + $line)
    Write-Log ("LABELS`t" + $line)
}
foreach ($r in $unanchored) {
    $note = "No ""Applications"" folder above $r - treating it as the corpus folder (client folders directly inside it)."
    Write-Host ("  ! " + $note) -ForegroundColor Yellow
    Write-Log ("WARN`t" + $note)
}

# A root with no Applications folder above it whose files would arrive
# without Client and Fiscal-year folders, or that sits above an Applications
# folder, is a wrong pick, not a batch to send: say which folder to choose and
# stop before the question. Reasons and guidance carry folder names only.
if ($refusals.Count -gt 0) {
    Write-Host ""
    foreach ($refusal in $refusals) {
        foreach ($line in $refusal.Guidance) { Write-Host ("  ! " + $line) -ForegroundColor Yellow }
        Write-Log ("REFUSED`t" + $refusal.Reason)
    }
    Write-Host "Nothing was uploaded."
    Read-Host "Press Enter to close"
    exit 1
}

# Dehydrated Files On-Demand documents upload fine, but each one blocks while
# OneDrive fetches it. Say so before the run instead of leaving the client
# watching a stalled progress line.
$cloudOnly = @($entries | Where-Object { Test-CloudOnly $_.File }).Count
if ($cloudOnly -gt 0) {
    Write-Host ("{0} files are cloud-only and will be downloaded by OneDrive while uploading" -f $cloudOnly)
}

# Zero found is the report that used to arrive with nothing to act on. Print
# and log the breakdown: counts and extensions only, never a document name.
if (@($entries).Count -eq 0) {
    foreach ($s in $scans) {
        if ($scans.Count -gt 1) {
            Write-Host ("  Root: {0}" -f $s.Root)
            Write-Log ("SCAN`tRoot: {0}" -f $s.Root)
        }
        foreach ($line in (Format-ScanDiagnostics $s.Scan (Test-UnderOneDrive $s.Root))) {
            Write-Host ("  " + $line)
            Write-Log ("SCAN`t" + $line)
        }
    }
    if ($script:logWritten) {
        Write-Host "The same breakdown was saved to upload-log.txt - send that file to the dev team."
    } else {
        Write-Host "Could not write upload-log.txt next to the script - send a screenshot of this window instead." -ForegroundColor Yellow
    }
    Read-Host "Nothing to upload. Press Enter to close"
    exit 0
}

# Big first runs: offer a small test batch so the review queue can be checked
# before committing to a full historical ingestion. Re-running later uploads
# the rest — already-sent files are skipped by the server.
if (@($entries).Count -gt $testCap) {
    $mode = Read-Host ("Upload ALL {0}, or just the first {1} as a TEST batch? (a = all / t = test {1} / n = cancel)" -f @($entries).Count, $testCap)
    # Only an explicit answer proceeds — Enter, typos, and closed stdin all
    # cancel. The dangerous option (everything) must never be the default.
    # "$mode", not $mode: Read-Host returns $null on closed stdin, and
    # `$null -notmatch` is an empty array (falsy), which would fall through to
    # uploading everything.
    if ("$mode" -match "^[Tt]") {
        $entries = @($entries | Select-Object -First $testCap)
        Write-Host ("Test mode: uploading the first {0} documents. Run again later and choose 'a' for the rest." -f $testCap)
    } elseif ("$mode" -notmatch "^[Aa]") {
        Write-Host "Cancelled. Nothing was uploaded."
        Read-Host "Press Enter to close"
        exit 0
    }
} else {
    $answer = Read-Host "Upload them to the Banhall review queue now? (y/n)"
    if ("$answer" -notmatch "^[Yy]") {
        Write-Host "Cancelled. Nothing was uploaded."
        Read-Host "Press Enter to close"
        exit 0
    }
}

$staged = 0; $skipped = 0; $tooLarge = 0; $failed = 0

foreach ($e in $entries) {
    $f = $e.File
    $rel = $e.Rel
    if ($f.Length -gt $maxBytes) {
        $tooLarge++
        Write-Host ("  - too large   {0}" -f $rel) -ForegroundColor DarkGray
        Write-Log "TOO_LARGE`t$rel"
        continue
    }
    # A single locked/ACL-denied/cloud-dehydration-failed file must not kill
    # the whole run under $ErrorActionPreference = "Stop".
    try {
        $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
    } catch {
        $failed++
        Write-Host ("  x unreadable  {0}" -f $rel) -ForegroundColor Yellow
        Write-Log "READ_ERROR`t$rel"
        continue
    }
    # -InFile has no -LiteralPath twin: it resolves wildcards, so a client
    # folder named "Applications [2024]" would fail to open. Escape it.
    $inFile = [Management.Automation.WildcardPattern]::Escape($f.FullName)
    $mtime = [DateTimeOffset]::new($f.LastWriteTimeUtc, [TimeSpan]::Zero).ToUnixTimeMilliseconds()
    $uri = "$appUrl/ingestion/upload?path=$([uri]::EscapeDataString($rel))&hash=$hash&mtime=$mtime"

    $ok = $false
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        try {
            $resp = Invoke-RestMethod -Method Post -Uri $uri `
                -Headers @{ Authorization = "Bearer $key" } `
                -ContentType "application/octet-stream" `
                -InFile $inFile
            if ($resp.skipped) {
                $skipped++
                Write-Host ("  - skipped     {0} ({1})" -f $rel, $resp.reason) -ForegroundColor DarkGray
                Write-Log ("SKIPPED`t$rel`t$($resp.reason)")
            } else {
                $staged++
                Write-Host ("  + uploaded    {0} [{1}]" -f $rel, $resp.docKind) -ForegroundColor Green
                Write-Log ("STAGED`t$rel`t$($resp.docKind)")
            }
            $ok = $true
            break
        } catch {
            $status = 0
            if ($_.Exception.Response) {
                try { $status = [int]$_.Exception.Response.StatusCode } catch {}
            }
            # Surface the server's explanation ("expected Client/Fiscal
            # year/…", "upload corrupted?", …) instead of a bare status code.
            $why = ""
            try {
                $errBody = $_.ErrorDetails.Message
                if ($errBody -match '"error"\s*:\s*"([^"]*)"') { $why = $Matches[1] }
            } catch {}
            if ($status -eq 401 -or $status -eq 403) {
                # Key revoked/wrong: every remaining file would fail the same
                # way — stop now with a message the client can act on.
                Write-Host ""
                Write-Host ("The access key in uploader-config.json is not valid (HTTP {0})." -f $status) -ForegroundColor Red
                Write-Host "It may have been revoked. Contact the dev team for a new kit."
                Write-Log ("ABORTED`taccess key rejected (HTTP $status)")
                Read-Host "Press Enter to close"
                exit 1
            }
            if ($status -eq 503) {
                Write-Host ""
                Write-Host "The server is not accepting uploads right now (HTTP 503)." -ForegroundColor Red
                Write-Host "Contact the dev team, then run this again."
                Write-Log ("ABORTED`tserver unavailable (HTTP 503)")
                Read-Host "Press Enter to close"
                exit 1
            }
            if ($status -ge 400 -and $status -lt 500) {
                $failed++
                $detail = if ($why) { " - $why" } else { "" }
                Write-Host ("  x rejected    {0} (HTTP {1}{2})" -f $rel, $status, $detail) -ForegroundColor Yellow
                Write-Log ("REJECTED`t$rel`tHTTP $status`t$why")
                $ok = $true
                break
            }
            # Back off before the next try; no pointless sleep after the last.
            if ($attempt -lt 3) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt)) }
        }
    }
    if (-not $ok) {
        $failed++
        Write-Host ("  x failed      {0} (network)" -f $rel) -ForegroundColor Yellow
        Write-Log ("FAILED`t$rel`tnetwork")
    }
}

Write-Host ""
Write-Host ("Done. Uploaded: {0}   Skipped: {1}   Too large: {2}   Failed: {3}" -f $staged, $skipped, $tooLarge, $failed) -ForegroundColor Cyan
if ($script:logWritten) {
    Write-Host "A log was saved to upload-log.txt next to this script."
} else {
    Write-Host "Could not write upload-log.txt next to this script - send a screenshot of this window instead." -ForegroundColor Yellow
}
Write-Host "Files now wait in the Banhall review queue - nothing is in the AI until approved."
Read-Host "Press Enter to close"
