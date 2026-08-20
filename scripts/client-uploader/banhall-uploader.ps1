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
#     Documents" folders together). Uploaded paths are rebuilt relative to
#     the "Applications" folder in each dropped folder's own location (full
#     path if none), so Client/Fiscal year context — and dedupe against
#     full-folder runs — is preserved no matter which subfolder is dragged.
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
        if ($start -and (Test-Path $start)) { $dlg.SelectedPath = $start }
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
# double-click later still uses the remembered root). Their uploaded paths
# are rebuilt with full ancestry by Get-DropPrefix below.
#
# Otherwise: config "root" wins. Otherwise auto-detect the synced OneDrive
# folder, look for an "Applications" folder up to 2 levels deep, confirm the
# guess with the user, and let them pick the real folder if the guess is
# wrong — we can't assume every machine's layout.
$roots = @()
$droppedMode = $false
if ($Paths -and $Paths.Count -gt 0) {
    $droppedMode = $true
    foreach ($p in $Paths) {
        if (Test-Path $p -PathType Container) {
            $roots += (Get-Item $p).FullName
        } elseif (Test-Path $p) {
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
    if ($root -and (Test-Path $root)) {
        Write-Host "Last time you scanned:"
        Write-Host "  $root"
        $again = Read-Host "Scan this folder again? (y = yes / c = choose a different folder)"
        if ($again -notmatch "^[Yy]") { $root = Pick-Folder $root }
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
            $hit = Get-ChildItem -Path $od -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ieq "Applications" } | Select-Object -First 1
            if ($hit) { $guess = $hit.FullName; break }
        }

        if ($guess) {
            Write-Host "Found a likely documents folder:"
            Write-Host "  $guess"
            $pick = Read-Host "Scan this folder? (y = yes / c = choose a different folder)"
            if ($pick -match "^[Yy]") { $root = $guess }
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
    if (-not $root -or -not (Test-Path $root)) {
        Write-Host "That folder does not exist: $root" -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
    $root = (Get-Item $root).FullName
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

# The server derives clientName/fiscalYear from the first two path segments
# (`Client/Fiscal year/…`) and dedupes by the full relative path. A dropped
# folder therefore can't just contribute its leaf name — that would classify
# every file under a client called "PDs" and collide across clients. Rebuild
# the ancestry instead: anchor at the LAST "Applications" segment of the
# dropped folder's own absolute path (the corpus root convention); if there
# is none, fall back to the full path so rels stay unique and stable.
function Get-DropPrefix([string]$abs) {
    $segs = @(($abs -replace "\\", "/") -split "/" | Where-Object { $_ -and $_ -notmatch "^[A-Za-z]:$" })
    $last = -1
    for ($i = 0; $i -lt $segs.Count; $i++) {
        if ($segs[$i] -ieq "Applications") { $last = $i }
    }
    $tail = if ($last -ge 0 -and $last -lt ($segs.Count - 1)) {
        @($segs[($last + 1)..($segs.Count - 1)]) -join "/"
    } elseif ($last -ge 0) {
        ""  # the Applications folder itself was dropped
    } else {
        $segs -join "/"
    }
    if ($tail) { return "$tail/" } else { return "" }
}

# Collect candidate files across every root. File-level reparse points are
# skipped (note: PS 5.1's -Recurse can still traverse directory junctions —
# keep the corpus free of junction loops). Duplicate rels (nested/overlapping
# drops) are uploaded once.
$entries = New-Object System.Collections.Generic.List[object]
$seenRel = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($r in $roots) {
    $prefix = if ($droppedMode) { Get-DropPrefix $r } else { "" }
    $files = Get-ChildItem -Path $r -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
            -not $_.Name.StartsWith("~$") -and
            -not $_.Name.StartsWith(".") -and
            $allowedExt -contains $_.Extension.ToLower()
        }
    foreach ($f in $files) {
        $rel = $prefix + ($f.FullName.Substring($r.Length).TrimStart("\", "/") -replace "\\", "/")
        if ($seenRel.Add($rel)) {
            $entries.Add([pscustomobject]@{ File = $f; Rel = $rel })
        }
    }
}
$entries = $entries | Sort-Object Rel

Write-Host ("Found {0} document(s) (.docx/.doc/.pdf/.txt/.vtt)." -f @($entries).Count)
if (@($entries).Count -eq 0) {
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
    if ($mode -match "^[Tt]") {
        $entries = @($entries | Select-Object -First $testCap)
        Write-Host ("Test mode: uploading the first {0} documents. Run again later and choose 'a' for the rest." -f $testCap)
    } elseif ($mode -notmatch "^[Aa]") {
        Write-Host "Cancelled. Nothing was uploaded."
        Read-Host "Press Enter to close"
        exit 0
    }
} else {
    $answer = Read-Host "Upload them to the Banhall review queue now? (y/n)"
    if ($answer -notmatch "^[Yy]") {
        Write-Host "Cancelled. Nothing was uploaded."
        Read-Host "Press Enter to close"
        exit 0
    }
}

$staged = 0; $skipped = 0; $tooLarge = 0; $failed = 0
# Log incrementally (UTF-8): a crash, Ctrl-C, or closed window mid-run must
# not lose the record of what was already sent.
Set-Content -Path $logPath -Value @() -Encoding UTF8
function Write-Log([string]$line) {
    try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch {}
}

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
        $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
    } catch {
        $failed++
        Write-Host ("  x unreadable  {0}" -f $rel) -ForegroundColor Yellow
        Write-Log "READ_ERROR`t$rel"
        continue
    }
    $mtime = [DateTimeOffset]::new($f.LastWriteTimeUtc, [TimeSpan]::Zero).ToUnixTimeMilliseconds()
    $uri = "$appUrl/ingestion/upload?path=$([uri]::EscapeDataString($rel))&hash=$hash&mtime=$mtime"

    $ok = $false
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        try {
            $resp = Invoke-RestMethod -Method Post -Uri $uri `
                -Headers @{ Authorization = "Bearer $key" } `
                -ContentType "application/octet-stream" `
                -InFile $f.FullName
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
Write-Host "A log was saved to upload-log.txt next to this script."
Write-Host "Files now wait in the Banhall review queue - nothing is in the AI until approved."
Read-Host "Press Enter to close"
