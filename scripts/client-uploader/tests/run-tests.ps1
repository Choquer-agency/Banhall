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

Check "zero-diag AC4 the root-is-a-file message sits in the Test-RootUsable branch" {
    $usable = @($uploaderParsed.Ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and
        "$($node.GetCommandName())" -eq "Test-RootUsable"
    }, $true))
    if ($usable.Count -lt 2) {
        return "expected Test-RootUsable at both root checks, found $($usable.Count) call site(s)"
    }
    $message = Find-SmallestAstContaining $uploaderParsed.Ast "is a file, not a folder"
    if (-not $message) { return "the root-is-a-file message is missing" }
    $branch = Get-EnclosingIf $message
    if (-not $branch) { return "the root-is-a-file message is not inside an if" }
    $guard = "$($branch.Extent.Text)"
    while ($branch -and -not $guard.Contains("That folder does not exist")) {
        $branch = Get-EnclosingIf $branch.Parent
        if ($branch) { $guard = "$($branch.Extent.Text)" }
    }
    if (-not $branch) { return "the file and missing messages are not two arms of one root check" }
    if (-not "$($branch.Clauses[0].Item1.Extent.Text)".Contains('$rootState')) {
        return "the root check branches on '$($branch.Clauses[0].Item1.Extent.Text)', not on the Test-RootUsable result"
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
