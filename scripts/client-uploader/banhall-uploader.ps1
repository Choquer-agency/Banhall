# Banhall document uploader (Path B — BNH-17).
#
# Walks your OneDrive "Applications" folder (READ-ONLY — nothing is modified,
# moved, or deleted) and uploads past PDs / transcripts to the Banhall app,
# where they wait in a review queue. Nothing enters the AI knowledge base
# until an admin reviews and approves each file inside the app.
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

$ErrorActionPreference = "Stop"
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

# Folder to scan: config "root" wins. Otherwise auto-detect the synced
# OneDrive folder, look for an "Applications" folder up to 2 levels deep,
# confirm the guess with the user, and let them pick the real folder if the
# guess is wrong — we can't assume every machine's layout.
$root = "$($config.root)"
$foundOneDrive = $null
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

$allowedExt = @(".docx", ".doc", ".pdf", ".txt", ".vtt")
$maxBytes = 15MB

Write-Host ""
Write-Host "Banhall document uploader" -ForegroundColor Cyan
Write-Host "  Scanning (read-only): $root"
Write-Host "  Uploading to:         $appUrl/ingestion/upload"
Write-Host ""

# Collect candidate files. Symlinks / junctions are never followed.
$files = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        -not $_.Name.StartsWith("~$") -and
        -not $_.Name.StartsWith(".") -and
        $allowedExt -contains $_.Extension.ToLower()
    }

Write-Host ("Found {0} document(s) (.docx/.doc/.pdf/.txt/.vtt)." -f $files.Count)
if ($files.Count -eq 0) {
    Read-Host "Nothing to upload. Press Enter to close"
    exit 0
}
$answer = Read-Host "Upload them to the Banhall review queue now? (y/n)"
if ($answer -notmatch "^[Yy]") {
    Write-Host "Cancelled. Nothing was uploaded."
    Read-Host "Press Enter to close"
    exit 0
}

$staged = 0; $skipped = 0; $tooLarge = 0; $failed = 0
$log = New-Object System.Collections.Generic.List[string]
$rootFull = (Get-Item $root).FullName

foreach ($f in $files) {
    $rel = $f.FullName.Substring($rootFull.Length).TrimStart("\", "/") -replace "\\", "/"
    if ($f.Length -gt $maxBytes) {
        $tooLarge++
        Write-Host ("  - too large   {0}" -f $rel) -ForegroundColor DarkGray
        $log.Add("TOO_LARGE`t$rel")
        continue
    }
    $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
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
                $log.Add("SKIPPED`t$rel`t$($resp.reason)")
            } else {
                $staged++
                Write-Host ("  + uploaded    {0} [{1}]" -f $rel, $resp.docKind) -ForegroundColor Green
                $log.Add("STAGED`t$rel`t$($resp.docKind)")
            }
            $ok = $true
            break
        } catch {
            $status = 0
            if ($_.Exception.Response) {
                try { $status = [int]$_.Exception.Response.StatusCode } catch {}
            }
            if ($status -ge 400 -and $status -lt 500) {
                $failed++
                Write-Host ("  x rejected    {0} (HTTP {1})" -f $rel, $status) -ForegroundColor Yellow
                $log.Add("REJECTED`t$rel`tHTTP $status")
                $ok = $true
                break
            }
            Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
        }
    }
    if (-not $ok) {
        $failed++
        Write-Host ("  x failed      {0} (network)" -f $rel) -ForegroundColor Yellow
        $log.Add("FAILED`t$rel`tnetwork")
    }
}

$log | Set-Content -Path $logPath
Write-Host ""
Write-Host ("Done. Uploaded: {0}   Already there: {1}   Too large: {2}   Failed: {3}" -f $staged, $skipped, $tooLarge, $failed) -ForegroundColor Cyan
Write-Host "A log was saved to upload-log.txt next to this script."
Write-Host "Files now wait in the Banhall review queue - nothing is in the AI until approved."
Read-Host "Press Enter to close"
