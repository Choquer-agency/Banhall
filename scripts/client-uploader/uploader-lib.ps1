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

# Path segments of an absolute path, separator-agnostic, without the empty
# segments a leading "\\" or "/" produces. A drive letter ("C:") is dropped
# only when it is the FIRST segment: a folder literally named "X:" deeper in
# a Mac path is a folder.
function Get-RootSegments([string]$abs) {
    $segs = @(("$abs" -replace "\\", "/") -split "/" | Where-Object { $_ })
    if ($segs.Count -gt 0 -and $segs[0] -match "^[A-Za-z]:$") {
        if ($segs.Count -eq 1) { return @() }
        $segs = @($segs[1..($segs.Count - 1)])
    }
    return $segs
}

# Index of the anchor segment in Get-RootSegments, or -1 when the path has
# none. The anchor is the corpus root: any segment containing "applications"
# (case-insensitive - clients name it "Applications", "1. Applications",
# "Applications [2024]"). The LAST match wins, so an archive folder that
# happens to sit above the live corpus does not steal the anchor.
function Get-RootAnchorIndex([string]$abs) {
    # @(): a one-segment path comes off the pipeline as a string, and indexing
    # a string walks its characters.
    $segs = @(Get-RootSegments $abs)
    $last = -1
    for ($i = 0; $i -lt $segs.Count; $i++) {
        if ($segs[$i] -like "*applications*") { $last = $i }
    }
    return $last
}

# The "Client/Fiscal year/…/" prefix every relative path under $abs must carry
# so the server reads the right first two segments, whatever folder the user
# chose. Rebuilt from the root's own absolute path: the segments after the
# anchor, joined with "/" and ending in "/". The Applications folder itself
# yields "" (rels and dedupe keys unchanged for existing corpus uploads). A
# path with no anchor also yields "": the root is treated as the corpus folder
# itself, which is what every run did before this helper existed, so a
# remembered corpus root not named Applications keeps its labels and dedupe
# keys. Get-UploadRefusal is what stops the run when that assumption is wrong.
function Get-RootPrefix([string]$abs) {
    $segs = @(Get-RootSegments $abs)
    $last = Get-RootAnchorIndex $abs
    $tail = @()
    if ($last -ge 0 -and $last -lt ($segs.Count - 1)) {
        $tail = @($segs[($last + 1)..($segs.Count - 1)])
    }
    if ($tail.Count -eq 0) { return "" }
    return (($tail -join "/") + "/")
}

# Segments of a relative path counted the way the server's sanitizeRelPath
# counts them (convex/lib/ingestionClassify.ts): backslashes become slashes,
# each segment is trimmed, and empty, "." and ".." segments are dropped.
function Get-RelSegments([string]$rel) {
    return @(("$rel" -replace "\\", "/") -split "/" | ForEach-Object { "$_".Trim() } |
        Where-Object { $_ -and $_ -ne "." -and $_ -ne ".." })
}

# The separator a path was written with, so guidance built from it keeps the
# shape the user typed or pasted. Not Join-Path: that validates the drive, and
# the harness host has no "C:".
function Get-PathSeparator([string]$path) {
    if ("$path".Contains("\")) { return "\" }
    return "/"
}

# How many "Labels:" rows the scan prints before collapsing the rest into one
# "(and N more)" line: enough to confirm a pick, short enough for one screen.
function Get-LabelRowCap { return 5 }

# What the server will label each file with, tallied as {Label, Count} rows
# over the first two rel segments ("Client / Fiscal year"), biggest first, ties
# broken by label (Sort-Object: culture-aware, case-insensitive). $top caps the
# rows; 0 or less keeps all of them. A rel with fewer than three segments has
# no fiscal-year folder; it is counted under a fixed label so no document name
# is ever printed.
function Get-LabelSummary($rels, [int]$top = (Get-LabelRowCap)) {
    $tally = @{}
    foreach ($rel in @($rels)) {
        if ($null -eq $rel) { continue }
        $segs = Get-RelSegments $rel
        $label = "(missing Client/Fiscal year folders)"
        if ($segs.Count -ge 3) { $label = "$($segs[0]) / $($segs[1])" }
        if ($tally.ContainsKey($label)) { $tally[$label] = $tally[$label] + 1 } else { $tally[$label] = 1 }
    }
    $ranked = @($tally.GetEnumerator() |
        Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Key }; Descending = $false })

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($bucket in $ranked) {
        if ($top -gt 0 -and $rows.Count -ge $top) { break }
        $rows.Add([pscustomobject]@{ Label = $bucket.Key; Count = $bucket.Value })
    }
    return $rows.ToArray()
}

# The label payloads printed under the found count and logged as LABELS
# records: "Client / Fiscal year (N files)" for the top Get-LabelRowCap rows,
# then "(and N more)" when there were more.
function Get-LabelLines($rels) {
    $cap = Get-LabelRowCap
    $lines = New-Object System.Collections.Generic.List[string]
    $rows = @(Get-LabelSummary $rels 0)
    foreach ($row in $rows) {
        if ($lines.Count -ge $cap) { break }
        $noun = "files"
        if ($row.Count -eq 1) { $noun = "file" }
        $lines.Add("$($row.Label) ($($row.Count) $noun)")
    }
    if ($rows.Count -gt $cap) { $lines.Add("(and $($rows.Count - $cap) more)") }
    return $lines.ToArray()
}

# The same payloads as screen lines: "Labels: " in front of each.
function Format-LabelSummary($rels) {
    return @(@(Get-LabelLines $rels) | ForEach-Object { "Labels: $_" })
}

# The pre-upload check for a root with no Applications folder above it. Such a
# root is assumed to be the corpus folder (empty prefix); this is where that
# assumption is tested against what the scan actually found. $null when the
# rels look right; otherwise {Reason, Guidance}: Reason is one line for the
# log, Guidance the lines to print, and neither ever holds a document name.
#   - A FOLDER segment of a rel that matches the anchor pattern (never the
#     last segment, which is the file) means the root sits above the
#     Applications folder - one level ("Production - Documents" whose child
#     is "1. Applications") or more. Every file would be labelled with the
#     folders in between. Guidance names each such Applications folder by
#     its full path, built with the root's own separator.
#   - A rel with fewer than three segments has no fiscal-year folder: the
#     server rejects a one-segment path outright; it accepts two but
#     classifies with no fiscal year (docKind "unknown", pair key
#     "Client::?"), which is a mislabelled row in the review queue.
function Get-UploadRefusal($rels, [string]$root) {
    $short = 0
    $total = 0
    $sep = Get-PathSeparator $root
    $base = "$root".TrimEnd("\", "/")
    $children = New-Object System.Collections.Generic.List[string]
    $firstClient = ""
    foreach ($rel in @($rels)) {
        if ($null -eq $rel) { continue }
        $total++
        $segs = Get-RelSegments $rel
        if ($segs.Count -lt 3) { $short++ }
        # Folder segments only: the last segment is the file name.
        for ($i = 0; $i -lt ($segs.Count - 1); $i++) {
            if ($segs[$i] -like "*applications*") {
                $child = $base + $sep + (@($segs[0..$i]) -join $sep)
                if (-not $children.Contains($child)) { $children.Add($child) }
                if (-not $firstClient) { $firstClient = $segs[0] }
                break
            }
        }
    }
    if ($children.Count -gt 0) {
        $guidance = New-Object System.Collections.Generic.List[string]
        $guidance.Add("The folder you chose sits above your Applications folder, so every file would be labelled with the client ""$firstClient"".")
        if ($children.Count -eq 1) {
            $guidance.Add("Choose this folder instead: $($children[0])")
        } else {
            $guidance.Add("Choose one of these folders instead:")
            foreach ($child in $children) { $guidance.Add("  $child") }
        }
        return [pscustomobject]@{
            Reason   = "root sits above an Applications folder: $root ($($children.Count) found)"
            Guidance = $guidance.ToArray()
        }
    }
    if ($short -gt 0) {
        return [pscustomobject]@{
            Reason   = "$short of $total files under $root would be sent without Client and Fiscal-year folders"
            Guidance = @(
                "There is no ""Applications"" folder above the folder you chose, and $short of $total documents sit less than two folders below it, so they would arrive without a client or fiscal year.",
                "Choose your Applications folder, or one client folder inside it, instead."
            )
        }
    }
    return $null
}

# The auto-detect probe: the folder to offer under a OneDrive root, or "".
# Walks up to three levels; a folder named exactly "Applications" wins, else
# the first folder whose name contains "applications" (so "1. Applications"
# is offered too), matching the anchor rule in Get-RootAnchorIndex.
function Get-ApplicationsGuess([string]$oneDriveRoot) {
    if (-not $oneDriveRoot -or -not (Test-Path -LiteralPath $oneDriveRoot -PathType Container)) { return "" }
    $dirs = @(Get-ChildItem -LiteralPath $oneDriveRoot -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue)
    $exact = @($dirs | Where-Object { $_.Name -ieq "Applications" } | Select-Object -First 1)
    if ($exact.Count -gt 0) { return $exact[0].FullName }
    $loose = @($dirs | Where-Object { $_.Name -like "*applications*" } | Select-Object -First 1)
    if ($loose.Count -gt 0) { return $loose[0].FullName }
    return ""
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
