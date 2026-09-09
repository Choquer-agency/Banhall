# Test harness for uploader-lib.ps1 and for the shape of the shipped .ps1
# files. Plain pwsh, no Pester.
#
#   pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1
#
# Exits 1 if any case fails. Dot-sources only the lib — never the uploader,
# uploader-config.json (holds a live key) or upload-log.txt. The AC6 cases read
# the uploader as text and AST; they never execute it.
#
# -InjectFailure adds one always-failing case. The AC5 fail-path case re-runs
# this file with that switch to prove a failing case really fails the gate.

param([switch]$InjectFailure)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "uploader-lib.ps1")

$script:pass = 0
$script:fail = 0

function Check([string]$name, [scriptblock]$body) {
    try {
        $problem = & $body
        if ($problem) {
            $script:fail++
            Write-Host ("FAIL  {0} - {1}" -f $name, $problem)
        } else {
            $script:pass++
            Write-Host ("ok    {0}" -f $name)
        }
    } catch {
        $script:fail++
        Write-Host ("FAIL  {0} - threw: {1}" -f $name, $_.Exception.Message)
    }
}

function Expect([string]$label, $expected, $actual) {
    if ($expected -ne $actual) { return "$label expected '$expected', got '$actual'" }
    return $null
}

# The only difference between a -InjectFailure run and a normal one. The AC5
# fail-path case below spawns that run and asserts the gate stops on it.
if ($InjectFailure) {
    Check "AC5 injected failing case (self-test only)" { return "injected on purpose" }
}

# A FileInfo stand-in. Omit a property by passing $null for LinkType and
# reading nothing else — the lib must not depend on Attributes at all.
function New-FakeFile([string]$name, [string]$linkType, [string]$attributes) {
    $file = [pscustomobject]@{
        Name      = $name
        Extension = [IO.Path]::GetExtension($name)
        LinkType  = $linkType
    }
    if ($attributes) {
        $file | Add-Member -NotePropertyName Attributes -NotePropertyValue ([IO.FileAttributes]$attributes)
    }
    return $file
}

$allowed = @(".docx", ".doc", ".pdf", ".txt", ".vtt")

# --- AC1: OneDrive cloud placeholder is a candidate -------------------------
Check "AC1 cloud placeholder (ReparsePoint attribute, empty LinkType) is a candidate" {
    $file = New-FakeFile "cloud.docx" $null "Archive, ReparsePoint"
    Expect "reason" $null (Get-UploadSkipReason $file $allowed)
}

# --- AC2: real links are skipped -------------------------------------------
Check "AC2 symlink is skipped as link" {
    $file = New-FakeFile "link.docx" "SymbolicLink" "Archive, ReparsePoint"
    Expect "reason" "link" (Get-UploadSkipReason $file $allowed)
}
Check "AC2 junction is skipped as link" {
    $file = New-FakeFile "junction.docx" "Junction" "Directory, ReparsePoint"
    Expect "reason" "link" (Get-UploadSkipReason $file $allowed)
}
Check "AC2 Test-RealLink is false for a placeholder and true for a symlink" {
    (Expect "placeholder" $false (Test-RealLink (New-FakeFile "cloud.docx" $null "Archive, ReparsePoint"))),
    (Expect "symlink" $true (Test-RealLink (New-FakeFile "link.docx" "SymbolicLink" $null))) |
        Where-Object { $_ } | Select-Object -First 1
}

# --- AC3: temp, dotfile, extension, plain ----------------------------------
Check "AC3 Word temp file is skipped as temp" {
    Expect "reason" "temp" (Get-UploadSkipReason (New-FakeFile '~$notes.docx' $null $null) $allowed)
}
Check "AC3 dotfile is skipped as dotfile" {
    Expect "reason" "dotfile" (Get-UploadSkipReason (New-FakeFile ".hidden.docx" $null $null) $allowed)
}
Check "AC3 disallowed extension is skipped as extension" {
    Expect "reason" "extension" (Get-UploadSkipReason (New-FakeFile "notes.md" $null $null) $allowed)
}
Check "AC3 allowed plain file is a candidate" {
    Expect "reason" $null (Get-UploadSkipReason (New-FakeFile "report.docx" $null "Archive") $allowed)
}
Check "AC3 extension match is case-insensitive" {
    Expect "reason" $null (Get-UploadSkipReason (New-FakeFile "REPORT.DOCX" $null $null) $allowed)
}

# --- Edge cases -------------------------------------------------------------
Check "edge link is checked before temp" {
    Expect "reason" "link" (Get-UploadSkipReason (New-FakeFile '~$notes.docx' "SymbolicLink" $null) $allowed)
}
Check "edge object without a LinkType property is not a link" {
    $file = [pscustomobject]@{ Name = "report.docx"; Extension = ".docx" }
    (Expect "Test-RealLink" $false (Test-RealLink $file)),
    (Expect "reason" $null (Get-UploadSkipReason $file $allowed)) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "edge empty allowed list skips everything as extension" {
    Expect "reason" "extension" (Get-UploadSkipReason (New-FakeFile "report.docx" $null $null) @())
}
Check "edge missing or unset Attributes does not throw" {
    $noAttr = [pscustomobject]@{ Name = "report.docx"; Extension = ".docx"; LinkType = $null }
    $unsetAttr = [pscustomobject]@{ Name = "report.docx"; Extension = ".docx"; LinkType = $null; Attributes = $null }
    $minusOne = [pscustomobject]@{ Name = "report.docx"; Extension = ".docx"; LinkType = $null; Attributes = -1 }
    (Expect "no Attributes property" $null (Get-UploadSkipReason $noAttr $allowed)),
    (Expect "Attributes null" $null (Get-UploadSkipReason $unsetAttr $allowed)),
    (Expect "Attributes -1" $null (Get-UploadSkipReason $minusOne $allowed)) |
        Where-Object { $_ } | Select-Object -First 1
}

# --- zero-found diagnostics: Test-CloudOnly ---------------------------------
# 0x400000 is FileAttributes.RecallOnDataAccess. It has no name on .NET
# Framework 4.8 (Windows PowerShell 5.1), so the lib matches the bit.
$recallOnDataAccess = 0x400000
Check "zero-diag AC3 Offline attribute is cloud-only" {
    Expect "cloud-only" $true (Test-CloudOnly (New-FakeFile "cloud.docx" $null "Archive, Offline"))
}
Check "zero-diag AC3 RecallOnDataAccess bit is cloud-only" {
    # Raw bits, not [IO.FileAttributes]: the enum on this host (.NET on macOS)
    # has no RecallOnDataAccess member and rejects the cast. Windows hands the
    # lib the same bit pattern inside a real FileInfo.
    $file = [pscustomobject]@{
        Name = "cloud.docx"; Extension = ".docx"; LinkType = $null
        Attributes = ($recallOnDataAccess -bor [int][IO.FileAttributes]::Archive)
    }
    Expect "cloud-only" $true (Test-CloudOnly $file)
}
Check "zero-diag AC3 a hydrated local file is not cloud-only" {
    (Expect "archive" $false (Test-CloudOnly (New-FakeFile "local.docx" $null "Archive"))),
    (Expect "reparse point alone" $false (Test-CloudOnly (New-FakeFile "ph.docx" $null "Archive, ReparsePoint"))) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "zero-diag edge Test-CloudOnly tolerates a missing or unset Attributes" {
    $noAttr = [pscustomobject]@{ Name = "a.docx"; Extension = ".docx" }
    $unset = [pscustomobject]@{ Name = "a.docx"; Extension = ".docx"; Attributes = $null }
    (Expect "null file" $false (Test-CloudOnly $null)),
    (Expect "no Attributes property" $false (Test-CloudOnly $noAttr)),
    (Expect "Attributes null" $false (Test-CloudOnly $unset)) |
        Where-Object { $_ } | Select-Object -First 1
}

# --- zero-found diagnostics: Get-ExtensionHistogram -------------------------
Check "zero-diag AC1 histogram counts by extension, most frequent first" {
    $files = @(
        (New-FakeFile "a.xlsx" $null $null), (New-FakeFile "b.xlsx" $null $null),
        (New-FakeFile "c.XLSX" $null $null), (New-FakeFile "d.msg" $null $null),
        (New-FakeFile "e.png" $null $null), (New-FakeFile "f.png" $null $null)
    )
    $hist = @(Get-ExtensionHistogram $files 8)
    (Expect "buckets" 3 $hist.Count),
    (Expect "first" ".xlsx (3)" ("{0} ({1})" -f $hist[0].Extension, $hist[0].Count)),
    (Expect "second" ".png (2)" ("{0} ({1})" -f $hist[1].Extension, $hist[1].Count)),
    (Expect "third" ".msg (1)" ("{0} ({1})" -f $hist[2].Extension, $hist[2].Count)) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "zero-diag edge histogram caps at top N and labels extensionless files" {
    $many = @(0..99 | ForEach-Object { New-FakeFile ("f{0}.e{0}" -f $_) $null $null })
    $many += (New-FakeFile "README" $null $null)
    $hist = @(Get-ExtensionHistogram $many 8)
    (Expect "cap" 8 $hist.Count),
    (Expect "extensionless bucket" 1 @(Get-ExtensionHistogram @((New-FakeFile "README" $null $null)) 8 |
        Where-Object { $_.Extension -eq "(none)" }).Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "zero-diag edge histogram of nothing is empty" {
    Expect "buckets" 0 @(Get-ExtensionHistogram @() 8).Count
}

# --- zero-found diagnostics: Format-ScanDiagnostics -------------------------
# The block the client screenshots. Counts and extensions only - never a file
# name (architecture invariant 8).
Check "zero-diag AC1/AC5 formatter renders every required line for a zero-candidate scan" {
    $fabricated = [pscustomobject]@{
        Candidates = @()
        Skipped    = [ordered]@{ link = 0; temp = 3; dotfile = 1; extension = 414 }
        Errors     = @("Access to the path is denied.")
        Walked     = 418
        Extensions = @(
            [pscustomobject]@{ Extension = ".xlsx"; Count = 301 },
            [pscustomobject]@{ Extension = ".msg"; Count = 60 },
            [pscustomobject]@{ Extension = ".png"; Count = 41 }
        )
    }
    $expected = @(
        "Walked: 418 files",
        "Skipped - link: 0",
        "Skipped - temp: 3",
        "Skipped - dotfile: 1",
        "Skipped - extension: 414",
        "Access errors: 1",
        "Extensions seen: .xlsx (301), .msg (60), .png (41)",
        "Under OneDrive sync root: yes"
    )
    $actual = @(Format-ScanDiagnostics $fabricated "yes")
    if ($actual.Count -ne $expected.Count) {
        return "expected $($expected.Count) lines, got $($actual.Count): $($actual -join ' | ')"
    }
    for ($i = 0; $i -lt $expected.Count; $i++) {
        $problem = Expect "line $i" $expected[$i] $actual[$i]
        if ($problem) { return $problem }
    }
    return $null
}
Check "zero-diag edge formatter prints an all-zero block for an empty folder" {
    $empty = [pscustomobject]@{
        Candidates = @(); Skipped = [ordered]@{ link = 0; temp = 0; dotfile = 0; extension = 0 }
        Errors = @(); Walked = 0; Extensions = @()
    }
    $lines = @(Format-ScanDiagnostics $empty "unknown")
    (Expect "walked" "Walked: 0 files" $lines[0]),
    (Expect "errors" "Access errors: 0" $lines[5]),
    (Expect "extensions" "Extensions seen: none" $lines[6]),
    (Expect "onedrive" "Under OneDrive sync root: unknown" $lines[7]) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "zero-diag AC1 formatter never prints a file name" {
    $scan = [pscustomobject]@{
        Candidates = @(); Skipped = [ordered]@{ link = 0; temp = 0; dotfile = 0; extension = 1 }
        Errors = @(); Walked = 1
        Extensions = @([pscustomobject]@{ Extension = ".xlsx"; Count = 1 })
    }
    $joined = (@(Format-ScanDiagnostics $scan "no") -join " ")
    if ($joined -match "secret-client") { return "leaked a file name: $joined" }
    return $null
}

# --- zero-found diagnostics: Test-UnderOneDrive -----------------------------
# Reads the same three env vars the auto-detect probe reads; the probe itself
# only picks a folder to offer, so its result says nothing about this root.
function Invoke-WithOneDriveEnv([string]$commercial, [string]$consumer, [string]$plain, [scriptblock]$body) {
    $saved = @($env:OneDriveCommercial, $env:OneDrive, $env:OneDriveConsumer)
    try {
        $env:OneDriveCommercial = $commercial
        $env:OneDrive = $plain
        $env:OneDriveConsumer = $consumer
        return & $body
    } finally {
        $env:OneDriveCommercial = $saved[0]
        $env:OneDrive = $saved[1]
        $env:OneDriveConsumer = $saved[2]
    }
}
Check "zero-diag AC1 root under a sync root reports yes, case- and separator-insensitively" {
    Invoke-WithOneDriveEnv "C:\Users\m\OneDrive - Banhall" "" "" {
        (Expect "child" "yes" (Test-UnderOneDrive "c:\users\m\onedrive - banhall\Applications\Acme")),
        (Expect "the sync root itself" "yes" (Test-UnderOneDrive "C:\Users\m\OneDrive - Banhall")),
        (Expect "forward slashes" "yes" (Test-UnderOneDrive "C:/Users/m/OneDrive - Banhall/Applications")) |
            Where-Object { $_ } | Select-Object -First 1
    }
}
Check "zero-diag AC1 root outside every sync root reports no" {
    Invoke-WithOneDriveEnv "" "C:\Users\m\OneDrive" "" {
        (Expect "elsewhere" "no" (Test-UnderOneDrive "D:\Archive\Applications")),
        (Expect "sibling with a shared prefix" "no" (Test-UnderOneDrive "C:\Users\m\OneDrive-Backup")) |
            Where-Object { $_ } | Select-Object -First 1
    }
}
Check "zero-diag AC1 no OneDrive env var at all reports unknown" {
    Invoke-WithOneDriveEnv "" "" "" {
        Expect "unknown" "unknown" (Test-UnderOneDrive "C:\Users\m\Documents")
    }
}

# --- root prefix: the Client/Fiscal year ancestry of any chosen folder -------
# The Sept 9 bug: a folder chosen below the client level sent bare file names
# and the server rejected all of them. The prefix now comes from the root's
# own absolute path in every mode. Each row is one line of the spec's I/O
# matrix; the second has the exact shape of the root in the screenshot, with
# placeholder names (no real person or client name is committed here).
$screenshotRoot = "C:\Users\writer\Firm Ltd\Production - Documents\1. Applications\Client Co\2025-03-31\Submitted"
$prefixMatrix = @(
    @{ Name = "the Applications folder itself";               Path = "C:\Users\writer\Firm Ltd\Production - Documents\1. Applications"; Prefix = "" },
    @{ Name = "screenshot-shaped root below the client level"; Path = $screenshotRoot;                                                 Prefix = "Client Co/2025-03-31/Submitted/" },
    @{ Name = "loose anchor '1. Applications'";               Path = "C:\Users\writer\Production - Documents\1. Applications\Client Co\2025-03-31"; Prefix = "Client Co/2025-03-31/" },
    @{ Name = "bracketed anchor";                             Path = "C:\Users\writer\OneDrive - Firm\Applications [2024]\Client\FY2024"; Prefix = "Client/FY2024/" },
    @{ Name = "two anchors, last wins";                       Path = "C:\Users\writer\Applications\Archive\1. Applications\Client\FY2023"; Prefix = "Client/FY2023/" },
    @{ Name = "one-segment root";                             Path = "D:\Applications";                                                Prefix = "" },
    @{ Name = "no anchor, root is a corpus folder";           Path = "D:\SRED Files";                                                  Prefix = "" },
    @{ Name = "no anchor, root below the client level";       Path = "D:\Scans\Client\FY2025";                                         Prefix = "" },
    @{ Name = "no anchor, root one level above Applications"; Path = "C:\Users\writer\Firm Ltd\Production - Documents";                Prefix = "" },
    @{ Name = "dragged client folder";                        Path = "C:\Users\writer\Production - Documents\1. Applications\Client Co"; Prefix = "Client Co/" },
    @{ Name = "bracketed folder with wildcard characters";    Path = "/x/Applications [2024]/Client [2]/FY2024";                       Prefix = "Client [2]/FY2024/" }
)
foreach ($row in $prefixMatrix) {
    Check ("root-prefix I/O matrix: {0}" -f $row.Name) {
        Expect "prefix" $row.Prefix (Get-RootPrefix $row.Path)
    }
}
Check "root-prefix the anchor is case-insensitive and separator-agnostic" {
    (Expect "upper-case, forward slashes" "Client/FY2024/" (Get-RootPrefix "C:/Users/writer/APPLICATIONS/Client/FY2024")),
    (Expect "UNC path" "Client/FY2024/" (Get-RootPrefix "\\server\share\Applications\Client\FY2024")),
    (Expect "trailing separator" "Client/" (Get-RootPrefix "C:\Applications\Client\")) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-RootAnchorIndex is -1 only when no segment contains 'applications'" {
    (Expect "screenshot-shaped root" 4 (Get-RootAnchorIndex $screenshotRoot)),
    (Expect "one-segment root" 0 (Get-RootAnchorIndex "D:\Applications")),
    (Expect "no anchor" -1 (Get-RootAnchorIndex "D:\Scans\Client\FY2025")),
    (Expect "empty path" -1 (Get-RootAnchorIndex "")),
    (Expect "last of two" 4 (Get-RootAnchorIndex "C:\Users\writer\Applications\Archive\1. Applications\Client\FY2023")) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-RootSegments of a one-segment path is one segment, not its characters" {
    $segs = @(Get-RootSegments "D:\Applications")
    (Expect "count" 1 $segs.Count),
    (Expect "segment" "Applications" $segs[0]) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix a drive letter is dropped only as the first segment" {
    (Expect "first segment dropped" "Applications|Client" ((Get-RootSegments "C:\Applications\Client") -join "|")),
    (Expect "a folder named X: deeper in a Mac path is kept" "Volumes|X:|Applications|Client" ((Get-RootSegments "/Volumes/X:/Applications/Client") -join "|")),
    (Expect "prefix through it" "Client/" (Get-RootPrefix "/Volumes/X:/Applications/Client")),
    (Expect "a bare drive is no segment" 0 @(Get-RootSegments "C:").Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-RelSegments counts like the server's sanitizeRelPath" {
    (Expect "trimmed, dot dropped" "Client|FY2025|x.docx" ((Get-RelSegments " Client / FY2025 /./x.docx") -join "|")),
    (Expect "dot-dot dropped" 3 @(Get-RelSegments "Client/../FY/x.docx").Count),
    (Expect "backslashes" 3 @(Get-RelSegments "Client\FY\x.docx").Count),
    (Expect "empty" 0 @(Get-RelSegments "").Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix an empty path yields an empty prefix rather than throwing" {
    Expect "prefix" "" (Get-RootPrefix "")
}

# --- root prefix: the label summary printed before the y ---------------------
Check "root-prefix Get-LabelSummary tallies Client / Fiscal year, biggest first, ties by label" {
    $rels = @(
        "Beta Ltd/FY2023/PDs/a.docx",
        "Client Co/2025-03-31/Submitted/x.docx",
        "Client Co/2025-03-31/Submitted/y.docx",
        "Client Co/2024-03-31/z.pdf",
        "Beta Ltd/FY2023/b.docx",
        "Client Co/2025-03-31/w.txt"
    )
    $rows = @(Get-LabelSummary $rels)
    (Expect "rows" 3 $rows.Count),
    (Expect "first" "Client Co / 2025-03-31 (3)" ("{0} ({1})" -f $rows[0].Label, $rows[0].Count)),
    (Expect "second" "Beta Ltd / FY2023 (2)" ("{0} ({1})" -f $rows[1].Label, $rows[1].Count)),
    (Expect "third" "Client Co / 2024-03-31 (1)" ("{0} ({1})" -f $rows[2].Label, $rows[2].Count)) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-LabelSummary caps at 5 rows by default and keeps all with top 0" {
    $rels = @(0..7 | ForEach-Object { "Client {0}/FY/file.docx" -f $_ })
    $rels += "Client 3/FY/second.docx"
    $rows = @(Get-LabelSummary $rels)
    (Expect "cap" 5 $rows.Count),
    (Expect "biggest first" "Client 3 / FY" $rows[0].Label),
    (Expect "then alphabetical" "Client 0 / FY" $rows[1].Label),
    (Expect "top 0 keeps all" 8 @(Get-LabelSummary $rels 0).Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix a rel with a file name where a folder belongs never prints the file name" {
    $rows = @(Get-LabelSummary @("secret-client-memo.docx", "Client/secret-client-memo.docx", "Client/FY2024/ok.docx"))
    $joined = (@($rows | ForEach-Object { $_.Label }) -join " ")
    if ($joined -match "secret-client") { return "leaked a file name: $joined" }
    (Expect "rows" 2 $rows.Count),
    (Expect "short rels bucket" "(missing Client/Fiscal year folders)" $rows[0].Label),
    (Expect "short rels count" 2 $rows[0].Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Format-LabelSummary renders the line the client confirms against" {
    $rels = @(1..12 | ForEach-Object { "Client Co/2025-03-31/Submitted/doc{0}.docx" -f $_ })
    $rels += "Beta Ltd/FY2023/one.pdf"
    $lines = @(Format-LabelSummary $rels)
    (Expect "lines" 2 $lines.Count),
    (Expect "plural" "Labels: Client Co / 2025-03-31 (12 files)" $lines[0]),
    (Expect "singular" "Labels: Beta Ltd / FY2023 (1 file)" $lines[1]),
    (Expect "nothing found prints nothing" 0 @(Format-LabelSummary @()).Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Format-LabelSummary prints Get-LabelRowCap rows then one 'and N more' line" {
    $cap = Get-LabelRowCap
    $rels = @(0..($cap + 2) | ForEach-Object { "Client {0}/FY/file.docx" -f $_ })
    $lines = @(Format-LabelSummary $rels)
    (Expect "cap is five" 5 $cap),
    (Expect "lines" ($cap + 1) $lines.Count),
    (Expect "last row" ("Labels: Client {0} / FY (1 file)" -f ($cap - 1)) $lines[$cap - 1]),
    (Expect "tail" "Labels: (and 3 more)" $lines[$cap]),
    (Expect "exactly cap has no tail" $cap @(Format-LabelSummary @(0..($cap - 1) | ForEach-Object { "Client {0}/FY/f.docx" -f $_ })).Count) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-LabelLines is the bare payload the log records carry" {
    $lines = @(Get-LabelLines @("Client Co/2025-03-31/x.docx", "Client Co/2025-03-31/y.docx"))
    (Expect "payload" "Client Co / 2025-03-31 (2 files)" $lines[0]),
    (Expect "screen line" "Labels: Client Co / 2025-03-31 (2 files)" @(Format-LabelSummary @("Client Co/2025-03-31/x.docx", "Client Co/2025-03-31/y.docx"))[0]) |
        Where-Object { $_ } | Select-Object -First 1
}

# --- root prefix: the pre-upload check for a root with no anchor -------------
# Such a root is taken to be the corpus folder (empty prefix). The check is
# what stops the run when the scan shows that assumption was wrong.
Check "root-prefix Get-UploadRefusal accepts a no-anchor corpus folder whose files have Client and Fiscal-year folders" {
    (Expect "corpus folder" $null (Get-UploadRefusal @("Client/FY2025/x.docx", "Client/FY2025/PDs/y.pdf") "D:\SRED Files")),
    (Expect "no rels" $null (Get-UploadRefusal @() "D:\SRED Files")) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-UploadRefusal refuses short rels with guidance naming the Applications folder and no document name" {
    $ref = Get-UploadRefusal @("secret-memo.docx", "Client/secret-memo.docx", "Client/FY2025/ok.docx") "D:\Scans\Client\FY2025"
    if (-not $ref) { return "no refusal" }
    $text = $ref.Reason + " " + ($ref.Guidance -join " ")
    if ($text -match "secret-memo") { return "leaked a file name: $text" }
    (Expect "reason" "2 of 3 files under D:\Scans\Client\FY2025 would be sent without Client and Fiscal-year folders" $ref.Reason),
    (Expect "guidance lines" 2 @($ref.Guidance).Count),
    (Expect "names the Applications folder" $true (($ref.Guidance -join " ").Contains("Choose your Applications folder"))) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-UploadRefusal refuses a root one level above Applications and names the child folder" {
    $root = "C:\Users\writer\Firm Ltd\Production - Documents"
    $ref = Get-UploadRefusal @("1. Applications/Client Co/2025-03-31/x.docx", "1. Applications/Other/FY/y.docx") $root
    if (-not $ref) { return "no refusal" }
    (Expect "reason" "root sits above an Applications folder: $root (1 found)" $ref.Reason),
    (Expect "names the child" "Choose this folder instead: $root\1. Applications" $ref.Guidance[1]),
    (Expect "child wins over short rels" $true ("$((Get-UploadRefusal @('1. Applications/x.docx') $root).Reason)".StartsWith("root sits above"))) |
        Where-Object { $_ } | Select-Object -First 1
}
Check "root-prefix Get-UploadRefusal builds the child path with the root's own separator" {
    $ref = Get-UploadRefusal @("Applications/Client/FY/x.docx") "/Users/writer/Documents/"
    Expect "posix child, trailing slash absorbed" "Choose this folder instead: /Users/writer/Documents/Applications" $ref.Guidance[1]
}
# A one-segment rel whose FILE NAME contains "applications" is a short rel,
# not a child Applications folder: the last segment is never a folder.
Check "root-prefix a file name containing 'applications' never becomes a child folder in the guidance" {
    $ref = Get-UploadRefusal @("SRED applications summary.docx", "Client/FY2025/ok.docx") "/Volumes/Scans"
    if (-not $ref) { return "no refusal" }
    $text = $ref.Reason + " " + ($ref.Guidance -join " ")
    if ($text -match "summary\.docx") { return "leaked a file name: $text" }
    (Expect "short-rel refusal" "1 of 2 files under /Volumes/Scans would be sent without Client and Fiscal-year folders" $ref.Reason),
    (Expect "two-segment file name is not a child either" $true ("$((Get-UploadRefusal @('Client/applications notes.docx') '/x').Reason)".StartsWith("1 of 1 files"))) |
        Where-Object { $_ } | Select-Object -First 1
}
# The check looks at every folder segment, not just the first: a root two
# levels above Applications is a wrong pick too, and every matching folder
# is listed.
Check "root-prefix a root two levels above Applications is refused and every matching folder is listed" {
    $root = "C:\Users\writer"
    $ref = Get-UploadRefusal @(
        "Firm Ltd/Production - Documents/1. Applications/Client Co/2025-03-31/x.docx",
        "Firm Ltd/Archive/Applications [2023]/Old/FY/y.docx",
        "Firm Ltd/Production - Documents/1. Applications/Other/FY/z.docx"
    ) $root
    if (-not $ref) { return "no refusal" }
    (Expect "reason" "root sits above an Applications folder: $root (2 found)" $ref.Reason),
    (Expect "client named" $true $ref.Guidance[0].Contains('client "Firm Ltd"')),
    (Expect "list header" "Choose one of these folders instead:" $ref.Guidance[1]),
    (Expect "first path" "  $root\Firm Ltd\Production - Documents\1. Applications" $ref.Guidance[2]),
    (Expect "second path" "  $root\Firm Ltd\Archive\Applications [2023]" $ref.Guidance[3]),
    (Expect "guidance lines" 4 @($ref.Guidance).Count) |
        Where-Object { $_ } | Select-Object -First 1
}

# --- root prefix: the auto-detect probe -------------------------------------
$probeParent = Join-Path ([IO.Path]::GetTempPath()) ("banhall-uploader-tests-" + [Guid]::NewGuid().ToString("N"))
try {
    $od1 = Join-Path $probeParent "od1"
    $od2 = Join-Path $probeParent "od2"
    New-Item -ItemType Directory -Path (Join-Path $od1 "1. Applications") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $od2 "Applications Archive") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $od2 "Applications") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path (Join-Path $od2 "Documents") "Other") -Force | Out-Null
    Check "root-prefix Get-ApplicationsGuess offers a loosely named folder and prefers an exact one" {
        (Expect "loose only" (Join-Path $od1 "1. Applications") (Get-ApplicationsGuess $od1)),
        (Expect "exact beats loose" (Join-Path $od2 "Applications") (Get-ApplicationsGuess $od2)),
        (Expect "nothing there" "" (Get-ApplicationsGuess (Join-Path $probeParent "nope"))),
        (Expect "empty root" "" (Get-ApplicationsGuess "")) |
            Where-Object { $_ } | Select-Object -First 1
    }
} finally {
    Remove-Item -LiteralPath $probeParent -Recurse -Force -ErrorAction SilentlyContinue
}

# --- AC4: Get-UploadCandidates over a real temp tree ------------------------
$tree = Join-Path ([IO.Path]::GetTempPath()) ("banhall-uploader-tests-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $tree -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $tree "sub") -Force | Out-Null
    $real = Join-Path $tree "sub/real.docx"
    Set-Content -LiteralPath $real -Value "real" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $tree 'sub/~$real.docx') -Value "temp" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $tree "sub/.hidden.docx") -Value "hidden" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $tree "notes.md") -Value "notes" -Encoding UTF8

    $linkMade = $false
    try {
        New-Item -ItemType SymbolicLink -Path (Join-Path $tree "link.docx") -Target $real -ErrorAction Stop | Out-Null
        $linkMade = $true
    } catch {
        Write-Host ("SKIP  AC4 symlink sub-case - this platform refused to create a symlink: {0}" -f $_.Exception.Message)
    }

    $walked = @(Get-ChildItem -LiteralPath $tree -Recurse -File -ErrorAction SilentlyContinue)
    $dotEnumerated = @($walked | Where-Object { $_.Name -eq ".hidden.docx" }).Count -eq 1
    if (-not $dotEnumerated) {
        Write-Host "SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force"
    }

    $scan = Get-UploadCandidates $tree $allowed

    Check "AC4 exactly one candidate, the real .docx" {
        (Expect "candidate count" 1 $scan.Candidates.Count),
        (Expect "candidate name" "real.docx" $scan.Candidates[0].Name) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "AC4 temp and extension skips are tallied" {
        (Expect "temp" 1 $scan.Skipped["temp"]),
        (Expect "extension" 1 $scan.Skipped["extension"]) |
            Where-Object { $_ } | Select-Object -First 1
    }
    if ($linkMade) {
        Check "AC4 the symlink is skipped as link" {
            Expect "link" 1 $scan.Skipped["link"]
        }
    }
    if ($dotEnumerated) {
        Check "AC4 the dotfile is skipped as dotfile" {
            Expect "dotfile" 1 $scan.Skipped["dotfile"]
        }
    }
    Check "AC4 walk reports counts and no errors" {
        (Expect "walked" $walked.Count $scan.Walked),
        (Expect "errors" 0 $scan.Errors.Count) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "AC4 a missing root yields zero candidates and a recorded error" {
        $missing = Get-UploadCandidates (Join-Path $tree "does-not-exist") $allowed
        (Expect "candidates" 0 $missing.Candidates.Count),
        (Expect "errors" 1 $missing.Errors.Count) |
            Where-Object { $_ } | Select-Object -First 1
    }

    Check "zero-diag AC1 the scan records an extension histogram of every file it walked" {
        $hist = @($scan.Extensions)
        $counted = 0
        foreach ($bucket in $hist) { $counted += $bucket.Count }
        $md = @($hist | Where-Object { $_.Extension -eq ".md" })
        (Expect "every walked file is counted" $walked.Count $counted),
        (Expect ".docx is the biggest bucket" ".docx" "$($hist[0].Extension)"),
        (Expect ".md bucket" 1 @($md).Count),
        (Expect ".md count" 1 $md[0].Count) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "zero-diag AC4 Test-RootUsable separates a folder, a file and a missing path" {
        (Expect "folder" "ok" (Test-RootUsable $tree)),
        (Expect "file" "is_file" (Test-RootUsable $real)),
        (Expect "missing" "missing" (Test-RootUsable (Join-Path $tree "does-not-exist"))),
        (Expect "empty" "missing" (Test-RootUsable "")) |
            Where-Object { $_ } | Select-Object -First 1
    }
} finally {
    Remove-Item -LiteralPath $tree -Recurse -Force -ErrorAction SilentlyContinue
}

# --- review fix: a root whose name holds wildcard characters ---------------
# "Applications [2024]" is a real client folder shape. Every root check has to
# read it as a literal path; a wildcard read matches nothing and hands the rest
# of the run an empty root.
$bracketParent = Join-Path ([IO.Path]::GetTempPath()) ("banhall-uploader-tests-" + [Guid]::NewGuid().ToString("N"))
try {
    $bracketRoot = Join-Path $bracketParent "Applications [2024]"
    New-Item -ItemType Directory -Path $bracketRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $bracketRoot "real.docx") -Value "real" -Encoding UTF8

    Check "review-fix a bracket-named root is usable and yields its candidate" {
        $scan = Get-UploadCandidates $bracketRoot $allowed
        (Expect "root state" "ok" (Test-RootUsable $bracketRoot)),
        (Expect "walked" 1 $scan.Walked),
        (Expect "candidates" 1 $scan.Candidates.Count),
        (Expect "errors" 0 $scan.Errors.Count) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "review-fix a wildcard read of that root is what loses it" {
        (Expect "wildcard match" 0 @(Get-Item $bracketRoot -ErrorAction SilentlyContinue).Count),
        (Expect "literal match" 1 @(Get-Item -LiteralPath $bracketRoot).Count) |
            Where-Object { $_ } | Select-Object -First 1
    }
} finally {
    Remove-Item -LiteralPath $bracketParent -Recurse -Force -ErrorAction SilentlyContinue
}

# --- root prefix: a real tree in the screenshot's shape, scanned below the
# client level, at the dragged-client level, from a no-anchor corpus folder,
# from a no-anchor folder below the client level, and from one level above
# the Applications folder. The rel is composed exactly the way the uploader
# composes it, so a regression in either half shows here.
$uploaderSource = Join-Path (Split-Path -Parent $PSScriptRoot) "banhall-uploader.ps1"
$corpusParent = Join-Path ([IO.Path]::GetTempPath()) ("banhall-uploader-tests-" + [Guid]::NewGuid().ToString("N"))
try {
    $above = Join-Path $corpusParent "Production - Documents"
    $appsRoot = Join-Path $above "1. Applications"
    $clientRoot = Join-Path $appsRoot "Client Co"
    $submitted = Join-Path (Join-Path $clientRoot "2025-03-31") "Submitted"
    New-Item -ItemType Directory -Path $submitted -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $submitted "x.docx") -Value "x" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $submitted "y.pdf") -Value "y" -Encoding UTF8
    $sred = Join-Path $corpusParent "SRED Files"
    New-Item -ItemType Directory -Path (Join-Path (Join-Path $sred "Client") "FY2025") -Force | Out-Null
    Set-Content -LiteralPath (Join-Path (Join-Path (Join-Path $sred "Client") "FY2025") "x.docx") -Value "x" -Encoding UTF8
    $scans = Join-Path (Join-Path (Join-Path $corpusParent "Scans") "Client") "FY2025"
    New-Item -ItemType Directory -Path $scans -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $scans "secret-memo.docx") -Value "x" -Encoding UTF8

    function Get-ComposedRels([string]$root) {
        $prefix = Get-RootPrefix $root
        $scan = Get-UploadCandidates $root $allowed
        $rels = @($scan.Candidates | ForEach-Object {
            $prefix + ($_.FullName.Substring($root.Length).TrimStart("\", "/") -replace "\\", "/")
        } | Sort-Object)
        # The comma keeps a one-element array an array on the way out.
        return ,$rels
    }

    Check "root-prefix a root below the client level sends Client/Fiscal year/... rels with 3+ segments" {
        $rels = Get-ComposedRels $submitted
        $short = @($rels | Where-Object { @($_ -split "/").Count -lt 3 })
        (Expect "rels" "Client Co/2025-03-31/Submitted/x.docx|Client Co/2025-03-31/Submitted/y.pdf" ($rels -join "|")),
        (Expect "rels shorter than 3 segments" 0 $short.Count),
        (Expect "summary" "Labels: Client Co / 2025-03-31 (2 files)" @(Format-LabelSummary $rels)[0]) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "root-prefix a dragged client folder and the Applications folder itself yield the same rels" {
        (Expect "dragged client" "Client Co/2025-03-31/Submitted/x.docx" (Get-ComposedRels $clientRoot)[0]),
        (Expect "Applications folder" "Client Co/2025-03-31/Submitted/x.docx" (Get-ComposedRels $appsRoot)[0]),
        (Expect "Applications prefix stays empty" "" (Get-RootPrefix $appsRoot)) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "root-prefix a no-anchor corpus folder keeps its rels, labels and no refusal, as before this fix" {
        $rels = Get-ComposedRels $sred
        (Expect "anchor" -1 (Get-RootAnchorIndex $sred)),
        (Expect "rel" "Client/FY2025/x.docx" $rels[0]),
        (Expect "label" "Labels: Client / FY2025 (1 file)" @(Format-LabelSummary $rels)[0]),
        (Expect "refusal" $null (Get-UploadRefusal $rels $sred)) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "root-prefix a no-anchor folder below the client level is refused without naming the document" {
        $rels = Get-ComposedRels $scans
        $ref = Get-UploadRefusal $rels $scans
        if (-not $ref) { return "no refusal for rels: $($rels -join '|')" }
        $text = $ref.Reason + " " + ($ref.Guidance -join " ")
        if ($text -match "secret-memo") { return "leaked a file name: $text" }
        (Expect "rel is bare" "secret-memo.docx" $rels[0]),
        (Expect "reason" "1 of 1 files under $scans would be sent without Client and Fiscal-year folders" $ref.Reason) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "root-prefix a root one level above the Applications folder is refused and the child is named" {
        $rels = Get-ComposedRels $above
        $ref = Get-UploadRefusal $rels $above
        if (-not $ref) { return "no refusal for rels: $($rels -join '|')" }
        (Expect "first segment is the child" $true $rels[0].StartsWith("1. Applications/")),
        (Expect "reason" "root sits above an Applications folder: $above (1 found)" $ref.Reason),
        (Expect "child named" "Choose this folder instead: $appsRoot" $ref.Guidance[1]) |
            Where-Object { $_ } | Select-Object -First 1
    }
    Check "root-prefix a root two levels above the Applications folder is refused too" {
        $rels = Get-ComposedRels $corpusParent
        $ref = Get-UploadRefusal $rels $corpusParent
        if (-not $ref) { return "no refusal for rels: $($rels -join '|')" }
        (Expect "reason" "root sits above an Applications folder: $corpusParent (1 found)" $ref.Reason),
        (Expect "child named" "Choose this folder instead: $appsRoot" $ref.Guidance[1]) |
            Where-Object { $_ } | Select-Object -First 1
    }

    # --- executed runs: the uploader main path in drop mode ------------------
    # Everything above proves the helpers; this proves the wiring by running
    # banhall-uploader.ps1 itself against a throwaway kit (copied script and
    # lib, fake config, its own upload-log.txt) with stdin closed, so every
    # prompt reads EOF and the run can only cancel. Drop mode needs no
    # WinForms and no OneDrive. bash is the only way to redirect stdin here.
    $kitTmp = Join-Path $corpusParent "kit"
    New-Item -ItemType Directory -Path $kitTmp -Force | Out-Null
    Copy-Item -LiteralPath $uploaderSource -Destination (Join-Path $kitTmp "banhall-uploader.ps1")
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "uploader-lib.ps1") -Destination (Join-Path $kitTmp "uploader-lib.ps1")
    Set-Content -LiteralPath (Join-Path $kitTmp "uploader-config.json") -Encoding UTF8 -Value (
        '{ "url": "https://example.invalid", "key": "' + ("k" * 40) + '", "root": "" }')
    $kitLog = Join-Path $kitTmp "upload-log.txt"
    Set-Content -LiteralPath (Join-Path $appsRoot "stray.docx") -Value "stray" -Encoding UTF8

    function Invoke-UploaderDrop([string]$folder) {
        Remove-Item -LiteralPath $kitLog -Force -ErrorAction SilentlyContinue
        $bash = Get-Command bash -ErrorAction SilentlyContinue
        if (-not $bash) { return $null }
        $out = & $bash.Source -c '"$1" -NoProfile -File "$2" "$3" < /dev/null 2>&1' bash (Get-Process -Id $PID).Path (Join-Path $kitTmp "banhall-uploader.ps1") $folder
        $log = ""
        if (Test-Path -LiteralPath $kitLog) { $log = (Get-Content -LiteralPath $kitLog -Raw) }
        return [pscustomobject]@{ Exit = $LASTEXITCODE; Out = ("$out" -join "`n"); Log = "$log" }
    }
    $prompt = "Upload them to the Banhall review queue now?"
    if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
        Write-Host "SKIP  executed-run cases - bash is not on PATH, so stdin cannot be redirected to /dev/null for the uploader"
    } else {
        Check "executed a no-anchor folder below the client level exits 1 with a REFUSED record and never reaches the prompt" {
            $run = Invoke-UploaderDrop $scans
            if ($run.Out -match "secret-memo" -and $run.Out -notmatch "Scanning \(read-only\)") { return "leaked a file name" }
            (Expect "exit" 1 $run.Exit),
            (Expect "REFUSED record" $true ($run.Log -match "(?m)^REFUSED`t1 of 1 files under ")),
            (Expect "prompt never reached" $false $run.Out.Contains($prompt)),
            (Expect "not cancelled, refused" $true $run.Out.Contains("Nothing was uploaded.")) |
                Where-Object { $_ } | Select-Object -First 1
        }
        Check "executed a no-anchor corpus folder logs WARN, reaches the prompt and cancels on EOF" {
            $run = Invoke-UploaderDrop $sred
            (Expect "exit" 0 $run.Exit),
            (Expect "LABELS payload" $true ($run.Log -match "(?m)^LABELS`tClient / FY2025 \(1 file\)$")),
            (Expect "WARN record" $true ($run.Log -match "(?m)^WARN`tNo ""Applications"" folder above ")),
            (Expect "no REFUSED" $false ($run.Log -match "(?m)^REFUSED`t")),
            (Expect "prompt reached" $true $run.Out.Contains($prompt)),
            (Expect "cancelled" $true $run.Out.Contains("Cancelled. Nothing was uploaded.")) |
                Where-Object { $_ } | Select-Object -First 1
        }
        Check "executed a root above the Applications folder exits 1 with REFUSED naming the child" {
            $run = Invoke-UploaderDrop $above
            (Expect "exit" 1 $run.Exit),
            (Expect "REFUSED record" $true ($run.Log -match "(?m)^REFUSED`troot sits above an Applications folder: ")),
            (Expect "child named on screen" $true $run.Out.Contains("Choose this folder instead: $appsRoot")),
            (Expect "prompt never reached" $false $run.Out.Contains($prompt)) |
                Where-Object { $_ } | Select-Object -First 1
        }
        Check "executed an anchored root with a stray file directly inside Applications is not refused and reaches the prompt" {
            $run = Invoke-UploaderDrop $appsRoot
            (Expect "exit" 0 $run.Exit),
            (Expect "no REFUSED" $false ($run.Log -match "(?m)^REFUSED`t")),
            (Expect "no WARN" $false ($run.Log -match "(?m)^WARN`t")),
            (Expect "stray counted without its name" $true ($run.Log -match "(?m)^LABELS`t\(missing Client/Fiscal year folders\) \(1 file\)$")),
            (Expect "no file name in the log" $false ($run.Log -match "stray")),
            (Expect "prompt reached" $true $run.Out.Contains($prompt)),
            (Expect "cancelled" $true $run.Out.Contains("Cancelled. Nothing was uploaded.")) |
                Where-Object { $_ } | Select-Object -First 1
        }
    }
} finally {
    Remove-Item -LiteralPath $corpusParent -Recurse -Force -ErrorAction SilentlyContinue
}

# --- AC6: the shipped scripts, read as source ------------------------------
# Token and AST checks, not text searches: banhall-uploader.ps1 holds a "?" in
# an upload URI, which a ternary regex matches and a tokenizer does not.
$kitDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $kitDir)
$uploaderPath = Join-Path $kitDir "banhall-uploader.ps1"
$ps7TokenKinds = @("QuestionQuestion", "QuestionQuestionEquals", "QuestionDot", "QuestionLBracket")

function Get-ParsedScript([string]$path) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    return [pscustomobject]@{ Ast = $ast; Tokens = @($tokens); Errors = @($errors) }
}

# $null when the file would run on Windows PowerShell 5.1, otherwise the first
# PS7-only construct found and its line.
function Test-Ps51Compatible([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return "missing file $path" }
    $parsed = Get-ParsedScript $path

    if ($parsed.Errors.Count -gt 0) {
        return "parse error line $($parsed.Errors[0].Extent.StartLineNumber): $($parsed.Errors[0].Message)"
    }
    $ternaries = @($parsed.Ast.FindAll({ param($node) $node.GetType().Name -eq "TernaryExpressionAst" }, $true))
    if ($ternaries.Count -gt 0) { return "ternary at line $($ternaries[0].Extent.StartLineNumber)" }

    $ps7Ops = @($parsed.Tokens | Where-Object { $ps7TokenKinds -contains "$($_.Kind)" })
    if ($ps7Ops.Count -gt 0) {
        return "PS7 operator '$($ps7Ops[0].Text)' at line $($ps7Ops[0].Extent.StartLineNumber)"
    }
    $parallel = @($parsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandParameterAst]) -and $node.ParameterName -eq "Parallel"
    }, $true))
    if ($parallel.Count -gt 0) { return "-Parallel at line $($parallel[0].Extent.StartLineNumber)" }

    $req = $parsed.Ast.ScriptRequirements
    if ($req -and $req.RequiredPSVersion -and $req.RequiredPSVersion.Major -ge 6) {
        return "#Requires -Version $($req.RequiredPSVersion)"
    }
    return $null
}

foreach ($scanned in @($uploaderPath, (Join-Path $kitDir "uploader-lib.ps1"), $PSCommandPath)) {
    $leaf = Split-Path -Leaf $scanned
    Check ("AC6 {0} parses and stays Windows PowerShell 5.1 compatible" -f $leaf) {
        Test-Ps51Compatible $scanned
    }
}

$uploaderParsed = Get-ParsedScript $uploaderPath

Check "AC6 one Get-UploadCandidates call site, inside the foreach over roots" {
    $calls = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Get-UploadCandidates"
    }, $true))
    if ($calls.Count -ne 1) { return "expected 1 call site, found $($calls.Count)" }

    $call = $calls[0]
    $fedWith = "$($call.CommandElements[1].Extent.Text)"
    if ($fedWith -ne '$r') { return "call site is fed '$fedWith', not the loop variable" }

    $loop = $call.Parent
    while ($loop -and -not ($loop -is [System.Management.Automation.Language.ForEachStatementAst])) {
        $loop = $loop.Parent
    }
    if (-not $loop) { return "the call site is not inside a foreach" }
    $walks = "$($loop.Condition.Extent.Text)"
    if ("$($loop.Variable.Extent.Text)" -ne '$r' -or $walks -ne '$roots') {
        return "enclosing foreach binds $($loop.Variable.Extent.Text) over $walks"
    }
    return $null
}

# The prefix is derived from the root in every mode: the same foreach that
# scans each root computes it with Get-RootPrefix, with no mode switch in the
# way, and the old drop-only helper is gone from the uploader.
Check "root-prefix every root gets Get-RootPrefix inside the foreach over roots" {
    $defs = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and $node.Name -eq "Get-DropPrefix"
    }, $true))
    if ($defs.Count -gt 0) { return "Get-DropPrefix is still defined at line $($defs[0].Extent.StartLineNumber)" }

    $prefixAssignments = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Left.Extent.Text)" -eq '$prefix'
    }, $true))
    if ($prefixAssignments.Count -ne 1) { return "expected one prefix assignment, found $($prefixAssignments.Count)" }
    $rhs = "$($prefixAssignments[0].Right.Extent.Text)"
    if ($rhs -ne 'Get-RootPrefix $r') { return "prefix is assigned from '$rhs', not from Get-RootPrefix on the loop variable" }

    $loop = $prefixAssignments[0].Parent
    while ($loop -and -not ($loop -is [System.Management.Automation.Language.ForEachStatementAst])) {
        $loop = $loop.Parent
    }
    if (-not $loop) { return "the prefix assignment is not inside a foreach" }
    if ("$($loop.Condition.Extent.Text)" -ne '$roots') { return "enclosing foreach walks $($loop.Condition.Extent.Text), not roots" }

    # Computing the prefix is worthless unless the rel is built from it: the
    # one $rel assignment in that loop has to start with "$prefix +".
    $relAssignments = @($loop.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Left.Extent.Text)" -eq '$rel'
    }, $true))
    if ($relAssignments.Count -ne 1) { return "expected one rel assignment in the roots loop, found $($relAssignments.Count)" }
    $relRhs = "$($relAssignments[0].Right.Extent.Text)"
    if (-not $relRhs.StartsWith('$prefix +')) { return "rel is built from '$relRhs', which does not start with '`$prefix +'" }

    # The no-anchor check runs on each root's own rels, only for roots with
    # no anchor: an anchored root's stray top-level file is the server's
    # per-file REJECTED, not a reason to refuse the batch.
    $refusalCalls = @($loop.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Get-UploadRefusal"
    }, $true))
    if ($refusalCalls.Count -ne 1) { return "expected one Get-UploadRefusal call in the roots loop, found $($refusalCalls.Count)" }
    $guard = $refusalCalls[0].Parent
    while ($guard -and -not ($guard -is [System.Management.Automation.Language.IfStatementAst])) { $guard = $guard.Parent }
    if (-not $guard) { return "Get-UploadRefusal is not guarded by an if" }
    $guardText = "$($guard.Clauses[0].Item1.Extent.Text)"
    if (-not ($guardText.Contains("Get-RootAnchorIndex") -and $guardText.Contains("-lt 0"))) {
        return "Get-UploadRefusal is guarded by '$guardText', not by a missing anchor"
    }
    return $null
}

# Drag-drop appends each dropped folder; the JSON root and the chooser both
# write $root, which becomes @($root). One filter serves all three.
Check "AC6 all three input modes converge on roots" {
    $assignments = @($uploaderParsed.Ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst]
    }, $true))
    $toRoots = @($assignments | Where-Object { "$($_.Left.Extent.Text)" -eq '$roots' })
    $toRoot = @($assignments | Where-Object { "$($_.Left.Extent.Text)" -eq '$root' })
    $dropped = @($toRoots | Where-Object { "$($_.Operator)" -eq "PlusEquals" })
    $single = @($toRoots | Where-Object { "$($_.Right.Extent.Text)" -eq '@($root)' })
    $fromConfig = @($toRoot | Where-Object { "$($_.Right.Extent.Text)" -like "*config.root*" })
    $fromChooser = @($toRoot | Where-Object { "$($_.Right.Extent.Text)" -like "Pick-Folder*" })

    if ($dropped.Count -lt 1) { return "no drag-drop append to roots" }
    if ($single.Count -ne 1) { return "expected one 'roots = @(root)', found $($single.Count)" }
    if ($fromConfig.Count -lt 1) { return "root is never read from the JSON config" }
    if ($fromChooser.Count -lt 1) { return "root is never set by the folder chooser" }
    return $null
}

# A path typed, remembered or dropped by a client is data, not a pattern:
# "Applications [2024]" read as a wildcard matches nothing, and the cmdlet
# returns nothing instead of failing - an empty root, then a null hash. Every
# path read in the uploader parses literally.
Check "review-fix every path the uploader reads is a literal path" {
    foreach ($cmdlet in @("Get-Item", "Get-FileHash")) {
        $calls = @($uploaderParsed.Ast.FindAll({
            param($node)
            ($node -is [System.Management.Automation.Language.CommandAst]) -and
            "$($node.GetCommandName())" -eq $cmdlet
        }, $true))
        if ($calls.Count -lt 1) { return "no $cmdlet call site left to check" }
        foreach ($call in $calls) {
            $literal = @($call.CommandElements | Where-Object {
                ($_ -is [System.Management.Automation.Language.CommandParameterAst]) -and
                $_.ParameterName -eq "LiteralPath"
            })
            if ($literal.Count -ne 1) {
                return "$cmdlet at line $($call.Extent.StartLineNumber) lacks -LiteralPath"
            }
        }
    }
    return $null
}

# -InFile is the one path with no -LiteralPath twin, so the wildcard has to be
# escaped instead. Unescaped, every file under a bracket-named client folder
# fails to open.
Check "review-fix the upload body path is wildcard-escaped" {
    $inFile = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandParameterAst]) -and
        $node.ParameterName -eq "InFile"
    }, $true))
    if ($inFile.Count -ne 1) { return "expected 1 -InFile, found $($inFile.Count)" }
    $fed = "$($inFile[0].Parent.CommandElements[[array]::IndexOf($inFile[0].Parent.CommandElements, $inFile[0]) + 1].Extent.Text)"
    $escapes = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Right.Extent.Text)".Contains("WildcardPattern]::Escape")
    }, $true))
    $escaped = @($escapes | Where-Object { "$($_.Left.Extent.Text)" -eq $fed })
    if ($escaped.Count -ne 1) { return "-InFile is fed '$fed', which is never wildcard-escaped" }
    return $null
}

# The bug was an inline Attributes -band ReparsePoint filter in the uploader.
# The vocabulary belongs to uploader-lib.ps1 now; a comment here would mean it
# is creeping back.
Check "regression banhall-uploader.ps1 never mentions ReparsePoint again" {
    $hits = @($uploaderParsed.Tokens | Where-Object { "$($_.Text)" -match "ReparsePoint" })
    if ($hits.Count -gt 0) { return "ReparsePoint at line $($hits[0].Extent.StartLineNumber)" }
    return $null
}

# --- zero-found diagnostics: the uploader's wiring, read as AST -------------
# The zero-result run cannot be driven here (the folder chooser is WinForms),
# so the order the uploader writes the log in is asserted on the source.
function Find-SmallestAstContaining($ast, [string]$needle) {
    $hits = @($ast.FindAll({ param($node) "$($node.Extent.Text)".Contains($needle) }, $true))
    if ($hits.Count -eq 0) { return $null }
    return ($hits | Sort-Object { $_.Extent.Text.Length } | Select-Object -First 1)
}

function Get-EnclosingIf($node) {
    $current = $node
    while ($current -and -not ($current -is [System.Management.Automation.Language.IfStatementAst])) {
        $current = $current.Parent
    }
    return $current
}

function Get-CommandLine($ast, [string]$name, [string]$argNeedle) {
    $calls = @($ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq $name
    }, $true))
    if ($argNeedle) { $calls = @($calls | Where-Object { "$($_.Extent.Text)".Contains($argNeedle) }) }
    if ($calls.Count -eq 0) { return -1 }
    return $calls[0].Extent.StartLineNumber
}

# The names Test-RootUsable results are stored under. AC4 is about what each
# of those states does next, so the checks below follow the variables rather
# than hard-coded names.
function Get-RootStateVariables($ast) {
    $assignments = @($ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Right.Extent.Text)".Contains("Test-RootUsable")
    }, $true))
    return @(@($assignments | ForEach-Object { "$($_.Left.Extent.Text)" }) | Select-Object -Unique)
}

# The nearest enclosing if that actually ends the run.
function Get-EnclosingExitingIf($node) {
    $branch = Get-EnclosingIf $node
    while ($branch) {
        $exits = @($branch.FindAll({
            param($inner)
            $inner -is [System.Management.Automation.Language.ExitStatementAst]
        }, $true))
        if ($exits.Count -gt 0) { return $branch }
        $branch = Get-EnclosingIf $branch.Parent
    }
    return $null
}

Check "zero-diag AC4 every root-is-a-file message stops the run from a Test-RootUsable state" {
    $usable = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Test-RootUsable"
    }, $true))
    if ($usable.Count -lt 2) {
        return "expected Test-RootUsable at both root checks, found $($usable.Count) call site(s)"
    }
    $stateVars = Get-RootStateVariables $uploaderParsed.Ast
    if ($stateVars.Count -lt 2) {
        return "expected the remembered and chosen roots to each keep a Test-RootUsable result, found: $($stateVars -join ', ')"
    }

    # Both the remembered (JSON) root and the chosen one: a file there is a
    # dead end, never a reason to fall through to the auto-detect guess.
    $messages = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.Extent.Text)".Contains("That path is a file, not a folder")
    }, $true))
    if ($messages.Count -ne 2) {
        return "expected the root-is-a-file message at both root checks, found $($messages.Count)"
    }
    foreach ($message in $messages) {
        $line = $message.Extent.StartLineNumber
        $branch = Get-EnclosingExitingIf $message
        if (-not $branch) { return "the root-is-a-file message on line $line never reaches an exit" }
        $condition = "$($branch.Clauses[0].Item1.Extent.Text)"
        if (@($stateVars | Where-Object { $condition.Contains($_) }).Count -eq 0) {
            return "the exiting branch around line $line tests '$condition', not a Test-RootUsable result"
        }
    }

    $missing = Find-SmallestAstContaining $uploaderParsed.Ast "That folder does not exist"
    if (-not $missing) { return "the root-does-not-exist message is missing" }
    $missingBranch = Get-EnclosingIf $missing
    if (-not $missingBranch) { return "the root-does-not-exist message is not inside an if" }
    $missingCondition = "$($missingBranch.Clauses[0].Item1.Extent.Text)"
    if (@($stateVars | Where-Object { $missingCondition.Contains($_) }).Count -eq 0) {
        return "the root-does-not-exist message branches on '$missingCondition', not on a Test-RootUsable result"
    }
    return $null
}

Check "review-fix the uploader only claims a log was saved when a write succeeded" {
    $writeLog = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and $node.Name -eq "Write-Log"
    }, $true))
    if ($writeLog.Count -ne 1) { return "expected one Write-Log definition, found $($writeLog.Count)" }
    $flagSets = @($writeLog[0].FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Left.Extent.Text)" -eq '$script:logWritten' -and
        "$($node.Right.Extent.Text)" -eq '$true'
    }, $true))
    if ($flagSets.Count -ne 1) { return "Write-Log never records that a line reached the file" }

    # Add-Content throws on a read-only kit folder; the flag has to sit after
    # it, or a swallowed failure still reports success.
    $add = @($writeLog[0].FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Add-Content"
    }, $true))
    if ($add.Count -ne 1) { return "expected one Add-Content in Write-Log, found $($add.Count)" }
    if (-not ($add[0].Extent.StartLineNumber -lt $flagSets[0].Extent.StartLineNumber)) {
        return "logWritten is set before the write that can fail"
    }

    $claims = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.Extent.Text)".Contains("saved to upload-log.txt")
    }, $true))
    if ($claims.Count -lt 2) { return "expected the zero-found and end-of-run log claims, found $($claims.Count)" }
    foreach ($claim in $claims) {
        $branch = Get-EnclosingIf $claim
        if (-not $branch) { return "the log claim on line $($claim.Extent.StartLineNumber) is unconditional" }
        if (-not "$($branch.Clauses[0].Item1.Extent.Text)".Contains('$script:logWritten')) {
            return "the log claim on line $($claim.Extent.StartLineNumber) is guarded by '$($branch.Clauses[0].Item1.Extent.Text)', not by logWritten"
        }
        if (-not $branch.ElseClause) {
            return "the log claim on line $($claim.Extent.StartLineNumber) has no message for the run that could not write"
        }
    }
    return $null
}

Check "zero-diag AC2 the log is truncated before the scan and the SCAN lines beat the zero exit" {
    $truncations = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Set-Content" -and
        "$($node.Extent.Text)".Contains('$logPath')
    }, $true))
    if ($truncations.Count -ne 1) { return "expected 1 log truncation, found $($truncations.Count)" }

    # An unwritable kit folder must not kill the run before it prints the
    # diagnostics: the truncation runs on the first logged line, inside the
    # same try/catch as the write.
    $scope = $truncations[0].Parent
    $inTry = $false
    $inWriteLog = $false
    while ($scope) {
        if ($scope -is [System.Management.Automation.Language.TryStatementAst]) { $inTry = $true }
        if (($scope -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and $scope.Name -eq "Write-Log") {
            $inWriteLog = $true
        }
        $scope = $scope.Parent
    }
    if (-not $inWriteLog) { return "the log truncation runs outside Write-Log, so a failed one is fatal" }
    if (-not $inTry) { return "the log truncation is not inside a try/catch" }

    $truncate = $truncations[0].Extent.StartLineNumber
    $collect = Get-CommandLine $uploaderParsed.Ast "Get-UploadCandidates" ""
    $scanLog = Get-CommandLine $uploaderParsed.Ast "Write-Log" "SCAN"
    $zeroExit = -1
    $nothing = Find-SmallestAstContaining $uploaderParsed.Ast "Nothing to upload"
    $zeroBranch = Get-EnclosingIf $nothing
    if ($zeroBranch) {
        $exits = @($zeroBranch.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.ExitStatementAst]
        }, $true))
        if ($exits.Count -gt 0) { $zeroExit = $exits[0].Extent.StartLineNumber }
    }
    if ($collect -lt 0) { return "no Get-UploadCandidates call site" }
    if ($scanLog -lt 0) { return "nothing writes SCAN lines to the log" }
    if ($zeroExit -lt 0) { return "no exit inside the zero-found branch" }
    if (-not ($truncate -lt $collect)) { return "log truncation (line $truncate) runs after the scan (line $collect)" }
    if (-not ($collect -lt $scanLog)) { return "the SCAN write (line $scanLog) runs before the scan (line $collect)" }
    if (-not ($scanLog -lt $zeroExit)) { return "the SCAN write (line $scanLog) runs after the zero exit (line $zeroExit)" }
    return $null
}

Check "zero-diag AC3 the cloud-only line is printed only when the count is above zero" {
    $calls = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Test-CloudOnly"
    }, $true))
    if ($calls.Count -lt 1) { return "the uploader never calls Test-CloudOnly" }
    $message = Find-SmallestAstContaining $uploaderParsed.Ast "cloud-only and will be downloaded by OneDrive while uploading"
    if (-not $message) { return "the cloud-only announcement is missing" }
    $branch = Get-EnclosingIf $message
    if (-not $branch) { return "the cloud-only line is not guarded by an if" }
    $condition = "$($branch.Clauses[0].Item1.Extent.Text)"
    if (-not $condition.Contains("-gt 0")) { return "cloud-only line is guarded by '$condition', not by a count above zero" }
    return $null
}

Check "zero-diag AC1 the zero-found branch prints the formatter's lines and never a file name" {
    $branch = Get-EnclosingIf (Find-SmallestAstContaining $uploaderParsed.Ast "Nothing to upload")
    if (-not $branch) { return "no zero-found branch" }
    $body = "$($branch.Extent.Text)"
    if (-not $body.Contains("Format-ScanDiagnostics")) { return "the zero-found branch never calls Format-ScanDiagnostics" }
    foreach ($leak in @("FullName", ".Name", "Candidates")) {
        if ($body.Contains($leak)) { return "the zero-found branch touches '$leak' - it must print counts only" }
    }
    return $null
}

# The summary, the WARN note and the refusal sit between the found count and
# the first question, so the user sees the labels before typing y and a wrong
# pick never reaches the question. Each of the three also lands in the log as
# a LABELS, WARN or REFUSED record.
Check "root-prefix the uploader prints and logs labels, warnings and refusals before asking" {
    $summary = Get-CommandLine $uploaderParsed.Ast "Get-LabelLines" ""
    $found = -1
    $foundNode = Find-SmallestAstContaining $uploaderParsed.Ast "Found {0} document(s)"
    if ($foundNode) { $found = $foundNode.Extent.StartLineNumber }
    $ask = -1
    $askNode = Find-SmallestAstContaining $uploaderParsed.Ast "Upload them to the Banhall review queue now?"
    if ($askNode) { $ask = $askNode.Extent.StartLineNumber }
    if ($summary -lt 0) { return "the uploader never calls Get-LabelLines" }
    if ($found -lt 0) { return "the found count line is missing" }
    if ($ask -lt 0) { return "the upload question is missing" }
    if (-not ($found -lt $summary)) { return "the summary (line $summary) prints before the found count (line $found)" }
    if (-not ($summary -lt $ask)) { return "the summary (line $summary) prints after the upload question (line $ask)" }

    foreach ($record in @('LABELS`t', 'WARN`t', 'REFUSED`t')) {
        $line = Get-CommandLine $uploaderParsed.Ast "Write-Log" $record
        if ($line -lt 0) { return "nothing writes a $record record to the log" }
        if (-not ($found -lt $line -and $line -lt $ask)) { return "the $record write (line $line) is not between the found count and the question" }
    }

    $refused = Find-SmallestAstContaining $uploaderParsed.Ast 'REFUSED`t'
    $branch = Get-EnclosingExitingIf $refused
    if (-not $branch) { return "the REFUSED write never reaches an exit" }
    $condition = "$($branch.Clauses[0].Item1.Extent.Text)"
    if (-not $condition.Contains('$refusals.Count -gt 0')) { return "the refusal branch tests '$condition', not the refusal list" }
    $body = "$($branch.Extent.Text)"
    if (-not $body.Contains(".Guidance")) { return "the refusal branch never prints the guidance" }
    if (-not $body.Contains("Nothing was uploaded")) { return "the refusal branch never says nothing was uploaded" }
    foreach ($leak in @("FullName", ".Name", "Candidates", ".Rel")) {
        if ($body.Contains($leak)) { return "the refusal branch touches '$leak' - it must print folders only" }
    }
    $exit = @($branch.FindAll({ param($node) $node -is [System.Management.Automation.Language.ExitStatementAst] }, $true))[0]
    if (-not ($exit.Extent.StartLineNumber -lt $ask)) { return "the refusal exit (line $($exit.Extent.StartLineNumber)) comes after the question" }

    # The probe goes through the lib helper so the harness can prove it.
    $probe = Get-CommandLine $uploaderParsed.Ast "Get-ApplicationsGuess" ""
    if ($probe -lt 0) { return "the auto-detect probe does not use Get-ApplicationsGuess" }
    return $null
}

# Read-Host returns $null on closed stdin, and `$null -notmatch` is an empty
# array (falsy): an unquoted guard would fall through to uploading. Every
# answer is compared as a string.
Check "regression every Read-Host answer is compared as a string, so closed stdin cancels" {
    $reads = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) -and
        "$($node.Right.Extent.Text)".StartsWith("Read-Host") -and
        "$($node.Left.Extent.Text)" -ne '$null'
    }, $true))
    $answers = @($reads | ForEach-Object { "$($_.Left.Extent.Text)" } | Select-Object -Unique)
    if ($answers.Count -lt 3) { return "expected the answer variables, found: $($answers -join ', ')" }
    $bare = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.BinaryExpressionAst]) -and
        ("$($node.Operator)" -match "^(I|C)?(Not)?match$") -and
        ($answers -contains "$($node.Left.Extent.Text)")
    }, $true))
    if ($bare.Count -gt 0) { return "bare answer in a -match at line $($bare[0].Extent.StartLineNumber): $($bare[0].Extent.Text)" }
    return $null
}

# --- AC5: the gate wiring, and that a failing case actually fails it --------
Check "AC5 loop-verify.sh runs the harness under set -e" {
    $gatePath = Join-Path $repoRoot "scripts/loop-verify.sh"
    if (-not (Test-Path -LiteralPath $gatePath)) { return "missing $gatePath" }
    $lines = @(Get-Content -LiteralPath $gatePath)
    (Expect "set -euo pipefail lines" 1 @($lines | Where-Object { $_.Trim() -eq "set -euo pipefail" }).Count),
    (Expect "harness invocations" 1 @($lines | Where-Object { $_ -notmatch "^\s*#" -and $_ -match "run-tests\.ps1" }).Count) |
        Where-Object { $_ } | Select-Object -First 1
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($InjectFailure) {
    # The child run: spawning another one would recurse forever.
} elseif (-not $bash) {
    Write-Host "SKIP  AC5 fail-path sub-case - bash is not on PATH"
} else {
    Check "AC5 an injected failing case exits 1 and stops a set -e gate" {
        $fragment = 'set -euo pipefail' + "`n" +
            '"$1" -NoProfile -File "$2" -InjectFailure > /dev/null 2>&1' + "`n" +
            'echo REACHED_THE_NEXT_GATE_COMMAND'
        $out = & $bash.Source -c $fragment bash (Get-Process -Id $PID).Path $PSCommandPath 2>&1
        (Expect "gate exit code" 1 $LASTEXITCODE),
        (Expect "output after the harness" "" "$out".Trim()) |
            Where-Object { $_ } | Select-Object -First 1
    }
}

Write-Host ""
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
