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

# Walk one root and split it into candidates and a per-reason skip tally.
# Skipped/Walked/Errors are reported even though the uploader prints only the
# candidate count today — the zero-found diagnostics read them from here.
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
    }
}
