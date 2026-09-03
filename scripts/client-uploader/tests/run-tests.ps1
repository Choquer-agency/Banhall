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
} finally {
    Remove-Item -LiteralPath $tree -Recurse -Force -ErrorAction SilentlyContinue
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

# The bug was an inline Attributes -band ReparsePoint filter in the uploader.
# The vocabulary belongs to uploader-lib.ps1 now; a comment here would mean it
# is creeping back.
Check "regression banhall-uploader.ps1 never mentions ReparsePoint again" {
    $hits = @($uploaderParsed.Tokens | Where-Object { "$($_.Text)" -match "ReparsePoint" })
    if ($hits.Count -gt 0) { return "ReparsePoint at line $($hits[0].Extent.StartLineNumber)" }
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
