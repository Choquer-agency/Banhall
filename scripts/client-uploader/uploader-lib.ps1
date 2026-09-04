# Pure file-selection helpers for banhall-uploader.ps1.
#
# Dot-sourced by the uploader and by tests/run-tests.ps1. Functions only —
# no top-level side effects, no config or log access, Windows PowerShell 5.1
# compatible: no ternary, no null-coalescing, no -Parallel.

# A real link is a symlink or a junction: a second name for content that lives
# elsewhere. A OneDrive Files On-Demand placeholder also carries the
# ReparsePoint *attribute*, but its LinkType is empty — it is the file itself,
# not a link to one, and hydrates on read. Attributes therefore cannot decide
# this; LinkType can. Never read LinkTarget (absent on 5.1 for some providers).
function Test-RealLink($file) {
    if ($null -eq $file) { return $false }
    $prop = $file.PSObject.Properties['LinkType']
    if (-not $prop) { return $false }
    $linkType = "$($prop.Value)"
    return ($linkType -eq "SymbolicLink" -or $linkType -eq "Junction")
}

# $null when the file is a candidate, otherwise the reason it was skipped:
# link | temp | dotfile | extension. Checked in that order, so a symlink named
# "~$notes.docx" reports "link".
function Get-UploadSkipReason($file, [string[]]$allowedExt) {
    if (Test-RealLink $file) { return "link" }
    $name = "$($file.Name)"
    if ($name.StartsWith('~$')) { return "temp" }
    if ($name.StartsWith(".")) { return "dotfile" }
    if ($allowedExt -notcontains "$($file.Extension)".ToLower()) { return "extension" }
    return $null
}

# A OneDrive Files On-Demand file whose bytes are not on disk yet: reading it
# blocks while OneDrive downloads it. Offline is the classic bit;
# RecallOnDataAccess (0x400000) is the Files On-Demand one and has no named
# member on .NET Framework 4.8, so the bit is matched directly.
function Test-CloudOnly($file) {
    if ($null -eq $file) { return $false }
    $prop = $file.PSObject.Properties['Attributes']
    if (-not $prop -or $null -eq $prop.Value) { return $false }
    $bits = 0
    try { $bits = [int]$prop.Value } catch { return $false }
    if ($bits -lt 0) { return $false }
    $cloudBits = ([int][IO.FileAttributes]::Offline) -bor 0x400000
    return (($bits -band $cloudBits) -ne 0)
}

# ok | is_file | missing. A path typed or remembered in the config can be any
# of the three, and "not a folder" is not the same problem as "not there".
function Test-RootUsable([string]$path) {
    if (-not $path) { return "missing" }
    if (Test-Path -LiteralPath $path -PathType Container) { return "ok" }
    if (Test-Path -LiteralPath $path) { return "is_file" }
    return "missing"
}

# yes | no | unknown, from the same three env vars the uploader's auto-detect
# probe reads. The probe only picks a folder to offer; it says nothing about
# the root actually chosen. "unknown" is a real answer: with no OneDrive
# variable set there is nothing to compare against.
function Test-UnderOneDrive([string]$root) {
    $syncRoots = @(@($env:OneDriveCommercial, $env:OneDrive, $env:OneDriveConsumer) | Where-Object { $_ })
    if ($syncRoots.Count -eq 0) { return "unknown" }
    $normalized = ("$root" -replace "\\", "/").TrimEnd("/")
    foreach ($syncRoot in $syncRoots) {
        $prefix = ("$syncRoot" -replace "\\", "/").TrimEnd("/")
        if (-not $prefix) { continue }
        if ($normalized -ieq $prefix) { return "yes" }
        if ($normalized.StartsWith($prefix + "/", [StringComparison]::OrdinalIgnoreCase)) { return "yes" }
    }
    return "no"
}

# The $top most frequent extensions as {Extension, Count}, biggest first, ties
# broken alphabetically so two runs of the same folder print the same block.
# $top of 0 or less keeps all of them.
function Get-ExtensionHistogram($files, [int]$top) {
    $tally = @{}
    foreach ($file in @($files)) {
        if ($null -eq $file) { continue }
        $ext = "$($file.Extension)".ToLower()
        if (-not $ext) { $ext = "(none)" }
        if ($tally.ContainsKey($ext)) { $tally[$ext] = $tally[$ext] + 1 } else { $tally[$ext] = 1 }
    }
    $ranked = @($tally.GetEnumerator() |
        Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Key }; Descending = $false })

    $histogram = New-Object System.Collections.Generic.List[object]
    foreach ($bucket in $ranked) {
        if ($top -gt 0 -and $histogram.Count -ge $top) { break }
        $histogram.Add([pscustomobject]@{ Extension = $bucket.Key; Count = $bucket.Value })
    }
    return $histogram.ToArray()
}

# The block a client screenshots when the scan finds nothing. Pure: counts and
# extensions only, never a file name, so the screenshot carries no document
# titles. $underOneDrive is a Test-UnderOneDrive answer (yes | no | unknown).
function Format-ScanDiagnostics($scan, [string]$underOneDrive) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("Walked: $($scan.Walked) files")
    foreach ($reason in @("link", "temp", "dotfile", "extension")) {
        $count = 0
        if ($scan.Skipped -and $null -ne $scan.Skipped[$reason]) { $count = $scan.Skipped[$reason] }
        $lines.Add("Skipped - ${reason}: $count")
    }
    $lines.Add("Access errors: $(@($scan.Errors).Count)")

    $seen = @(@($scan.Extensions) | Where-Object { $_ } | ForEach-Object { "$($_.Extension) ($($_.Count))" })
    if ($seen.Count -eq 0) { $lines.Add("Extensions seen: none") }
    else { $lines.Add("Extensions seen: " + ($seen -join ", ")) }

    $lines.Add("Under OneDrive sync root: $underOneDrive")
    return $lines.ToArray()
}

# Walk one root and split it into candidates, a per-reason skip tally and the
# extension histogram of everything walked. Format-ScanDiagnostics turns the
# whole result into the block printed when the candidate count is zero.
function Get-UploadCandidates([string]$root, [string[]]$allowedExt) {
    $walkErrors = @()
    # -LiteralPath: a client folder named "Applications [2024]" is a literal
    # path, not a wildcard. An unreadable subtree lands in $walkErrors and the
    # walk continues.
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable walkErrors)

    $candidates = New-Object System.Collections.Generic.List[object]
    $skipped = [ordered]@{ link = 0; temp = 0; dotfile = 0; extension = 0 }
    foreach ($file in $files) {
        $reason = Get-UploadSkipReason $file $allowedExt
        if ($reason) { $skipped[$reason] = $skipped[$reason] + 1 }
        else { $candidates.Add($file) }
    }

    return [pscustomobject]@{
        # .ToArray(), not @(): wrapping this List in @() throws "Argument types
        # do not match" on pwsh 7.6.5 (the harness host).
        Candidates = $candidates.ToArray()
        Skipped    = $skipped
        Errors     = @($walkErrors)
        Walked     = $files.Count
        # Top 8: enough to name what the folder actually holds, short enough
        # that the whole zero-result block fits in one screenshot.
        Extensions = Get-ExtensionHistogram $files 8
    }
}
