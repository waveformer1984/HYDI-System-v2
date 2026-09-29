<#
.SYNOPSIS
  Canonical local verification gate for HYDI-System-v2. The local-first
  equivalent of the two GitHub-required status checks (Jest Unit Tests,
  CodeQL) plus the checks that actually matter for this codebase but were
  never gated on anything -- live service health, local DB integrity, and
  a live-secret scan.

.DESCRIPTION
  Design background: 2026-09-17 GitHub dependency inventory found the two
  *required* branch-protection checks are Jest Unit Tests and CodeQL; every
  other workflow (integration tests, governance gate, rezonate contract,
  procedural-memory eval, health-monitor) is advisory or path-scoped, not a
  merge gate. health-monitor.yml in particular runs every 5 minutes forever,
  checking an already-abandoned Vercel deployment from inside a cloud runner
  that cannot reach this machine either way -- a plausible cause of the
  billing lock that blocked pushes this session, and zero real operational
  value. This script does not try to reproduce all eight workflows; it
  reproduces the two that actually gate merges, plus the checks this session
  proved matter in practice (live health, DB integrity, secret safety).

  Every stage is one of:
    PASS  - ran, succeeded
    FAIL  - ran, failed. Stops the chain (unless -Continue is passed).
    SKIP  - precondition not met (tool not installed, service not running,
            or a stage that's opt-in and wasn't requested). SKIP is always
            printed and recorded -- never silently treated as PASS. A SKIP
            is a fact about the *environment*, not a verdict on the commit.
    WARN  - ran, failed, but is advisory-only (matches what the corresponding
            GitHub workflow's required-vs-advisory status actually is today).

  VERDICT is PASS only if zero stages are FAIL. WARN and SKIP never flip the
  verdict, but are never hidden either -- see the printed table and the
  written artifact.

.PARAMETER RunQualification
  Opt-in only, off by default. Runs scripts/hydi-qualify.js against the live
  running system -- this genuinely kills and restarts real processes (see
  the 2026-09-17 session incident where an unfiltered run for-real killed
  protoforge-core). Never enabled implicitly. When passed, only ever runs a
  single named, deliberately-chosen scenario -- never an unfiltered sweep.

.PARAMETER Scenario
  Which hydi-qualify.js scenario to run when -RunQualification is set.
  Default: F1-bridge-probe (the one already qualified this session).

.PARAMETER SkipIntegration
  Skip the (already-advisory) integration test suite, for a faster local run.

.PARAMETER RequireCleanTree
  Fail stage 1 if the working tree has uncommitted changes. Off by default
  -- a dirty tree is normal mid-development; turn this on for a pre-push-style
  strict run.

.PARAMETER Continue
  Keep running remaining stages after a FAIL instead of stopping the chain.
  Off by default, matching "a failure stops the verification chain."

.EXAMPLE
  .\tools\verify.ps1
  Standard local run: everything except HYDI qualification.

.EXAMPLE
  .\tools\verify.ps1 -RequireCleanTree -Continue
  Strict pre-push-style run that still reports every stage even after a FAIL.

.EXAMPLE
  .\tools\verify.ps1 -RunQualification -Scenario F1-bridge-probe
  Adds the live qualification stage. Understand what this does before using it.
#>

[CmdletBinding()]
param(
    [switch]$RunQualification,
    [string]$Scenario = 'F1-bridge-probe',
    [switch]$SkipIntegration,
    [switch]$RequireCleanTree,
    [switch]$Continue
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Stages = [System.Collections.Generic.List[object]]::new()
$OverallStart = Get-Date

function Write-StageHeader($Name) {
    Write-Host ""
    Write-Host "── $Name " -NoNewline -ForegroundColor Cyan
    Write-Host ('─' * [Math]::Max(1, 70 - $Name.Length - 4)) -ForegroundColor Cyan
}

# Several wrapped tools (verify-supabase.sh in particular) colorize their own
# output; that's fine on a live terminal but leaks raw escape codes into the
# saved artifact if not stripped first.
function Remove-AnsiCodes([string]$Text) {
    if (-not $Text) { return $Text }
    return [regex]::Replace($Text, "`e\[[0-9;]*[a-zA-Z]", '')
}

function Add-Stage {
    param(
        [string]$Name,
        [ValidateSet('PASS', 'FAIL', 'SKIP', 'WARN')][string]$Status,
        [string]$Detail = '',
        [double]$DurationSec = 0
    )
    $Detail = Remove-AnsiCodes $Detail
    $Stages.Add([PSCustomObject]@{
        name        = $Name
        status      = $Status
        detail      = $Detail
        durationSec = [Math]::Round($DurationSec, 1)
    })
    $icon = switch ($Status) {
        'PASS' { '✅' }; 'FAIL' { '❌' }; 'SKIP' { '⏭️ ' }; 'WARN' { '⚠️ ' }
    }
    $color = switch ($Status) {
        'PASS' { 'Green' }; 'FAIL' { 'Red' }; 'SKIP' { 'DarkGray' }; 'WARN' { 'Yellow' }
    }
    Write-Host "$icon $Name — $Status" -ForegroundColor $color
    if ($Detail) { Write-Host "   $Detail" -ForegroundColor DarkGray }
}

function Invoke-Stage {
    param(
        [string]$Name,
        [scriptblock]$Body,
        [switch]$Optional  # a non-zero exit here is WARN, not FAIL
    )
    Write-StageHeader $Name
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = & $Body
        $sw.Stop()
        if ($result -is [hashtable]) {
            Add-Stage -Name $Name -Status $result.Status -Detail $result.Detail -DurationSec $sw.Elapsed.TotalSeconds
            return $result.Status
        }
        Add-Stage -Name $Name -Status 'PASS' -DurationSec $sw.Elapsed.TotalSeconds
        return 'PASS'
    } catch {
        $sw.Stop()
        $status = if ($Optional) { 'WARN' } else { 'FAIL' }
        Add-Stage -Name $Name -Status $status -Detail $_.Exception.Message -DurationSec $sw.Elapsed.TotalSeconds
        return $status
    }
}

function Test-CommandExists($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

$ShouldStop = { param($status) $status -eq 'FAIL' -and -not $Continue }

Write-Host "HYDI-System-v2 local verification gate" -ForegroundColor White
Write-Host "Repo: $RepoRoot"
Write-Host "HEAD: $(git rev-parse --short HEAD 2>$null)  Branch: $(git branch --show-current 2>$null)"

# ── 1. Git state ─────────────────────────────────────────────────────────
$status = Invoke-Stage 'Git state' {
    $short = git status --short 2>&1
    $head = git rev-parse HEAD 2>&1
    $branch = git branch --show-current 2>&1
    if (-not $head -or $LASTEXITCODE -ne 0) {
        return @{ Status = 'FAIL'; Detail = 'not a git repository or HEAD unresolvable' }
    }
    if ($short -and $RequireCleanTree) {
        return @{ Status = 'FAIL'; Detail = "working tree not clean ($(($short | Measure-Object).Count) entries) and -RequireCleanTree was set" }
    }
    if ($short) {
        return @{ Status = 'PASS'; Detail = "working tree has $(($short | Measure-Object).Count) uncommitted entries (informational; pass -RequireCleanTree to gate on this)" }
    }
    return @{ Status = 'PASS'; Detail = 'clean' }
}
if (& $ShouldStop $status) { $overallFail = $true }

# ── 2. Dependency integrity ─────────────────────────────────────────────
if (-not $overallFail) {
    $status = Invoke-Stage 'Dependency integrity' {
        $out = npm ls --depth=0 2>&1
        # npm ls exits non-zero on UNMET/extraneous deps; that's the signal we want.
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'FAIL'; Detail = ($out | Select-Object -Last 5) -join ' | ' }
        }
        return @{ Status = 'PASS'; Detail = 'lockfile and node_modules agree' }
    }
    if (& $ShouldStop $status) { $overallFail = $true }
}

# ── 3. Typecheck ─────────────────────────────────────────────────────────
if (-not $overallFail) {
    $status = Invoke-Stage 'Typecheck (tsc --noEmit)' {
        $out = npx tsc --noEmit 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'FAIL'; Detail = ($out | Select-Object -First 5) -join ' | ' }
        }
        return @{ Status = 'PASS' }
    }
    if (& $ShouldStop $status) { $overallFail = $true }
}

# ── 4. Lint ───────────────────────────────────────────────────────────────
if (-not $overallFail) {
    $status = Invoke-Stage 'Lint' {
        $out = npm run lint 2>&1
        if ($LASTEXITCODE -ne 0) {
            $errorLines = $out | Select-String -Pattern '\d+ error' | Select-Object -Last 3
            return @{ Status = 'FAIL'; Detail = if ($errorLines) { $errorLines -join ' | ' } else { 'lint failed, see output' } }
        }
        return @{ Status = 'PASS'; Detail = 'warnings allowed, 0 errors required' }
    }
    if (& $ShouldStop $status) { $overallFail = $true }
}

# ── 5. Unit tests ─────────────────────────────────────────────────────────
# One automatic retry, ONLY when the failure signature matches the specific
# flaky-under-load pattern this session established twice (long real-Postgres
# qualification tests exceeding a 150s timeout purely from cumulative load,
# proven via git-stash isolation to be unrelated to the code under test).
# Any other failure shape fails immediately -- this is not a general
# "retry until green" policy.
if (-not $overallFail) {
    $status = Invoke-Stage 'Unit tests (jest)' {
        $out = npm test 2>&1
        if ($LASTEXITCODE -eq 0) {
            return @{ Status = 'PASS' }
        }
        $isTimeoutFlake = ($out -join "`n") -match 'Exceeded timeout of \d+ ms'
        if ($isTimeoutFlake) {
            Write-Host "   ⚠️  Failure matches known timeout-flake signature — retrying once..." -ForegroundColor Yellow
            $out2 = npm test 2>&1
            if ($LASTEXITCODE -eq 0) {
                return @{ Status = 'PASS'; Detail = 'passed on automatic retry (first run hit the known timeout-flake signature)' }
            }
            $summary = $out2 | Select-String -Pattern '^FAIL ' | ForEach-Object { $_.Line }
            return @{ Status = 'FAIL'; Detail = "failed twice, including retry: $($summary -join ' | ')" }
        }
        $summary = $out | Select-String -Pattern '^FAIL ' | ForEach-Object { $_.Line }
        return @{ Status = 'FAIL'; Detail = ($summary -join ' | ') }
    }
    if (& $ShouldStop $status) { $overallFail = $true }
}

# ── 6. Static security (CodeQL-equivalent) ──────────────────────────────
# No zero-cost, zero-cloud drop-in for CodeQL exists. semgrep is the closest
# local option but is not installed and is not silently assumed present --
# if it's missing this stage SKIPs with an explicit note rather than either
# failing the whole gate or quietly pretending equivalent coverage exists.
if (-not $overallFail) {
    Invoke-Stage 'Static security scan (CodeQL-equivalent)' {
        if (-not (Test-CommandExists 'semgrep')) {
            return @{ Status = 'SKIP'; Detail = 'semgrep not installed — no local CodeQL-equivalent available yet. This gate is weaker than the GitHub check for this one stage; see design notes.' }
        }
        $out = semgrep --config=auto --error --quiet 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'FAIL'; Detail = ($out | Select-Object -First 5) -join ' | ' }
        }
        return @{ Status = 'PASS' }
    }
}

# ── 6b. Tier 2 local-service tests ────────────────────────────────────────────
# Phase 12 made `npm test` mean TIER 1 ONLY: 354 hermetic suites run with every
# local service blocked at the socket layer. That is deliberate -- a fast gate
# that silently requires Docker is a gate that lies.
#
# But it means the 26 database-backed suites would vanish from this gate unless
# named explicitly, which would be exactly the silent coverage loss Phase 12
# exists to prevent. They run here instead, and SKIP honestly when the local
# stack is down rather than failing a developer who simply has Docker stopped.
if (-not $overallFail) {
    Invoke-Stage 'Tier 2 local-service tests' -Optional {
        $pg = Test-NetConnection -ComputerName 127.0.0.1 -Port 54322 -InformationLevel Quiet -WarningAction SilentlyContinue
        if (-not $pg) {
            return @{ Status = 'SKIP'; Detail = 'local Postgres (127.0.0.1:54322) not reachable -- Tier 2 needs it; this is a machine-state fact, not a defect in the commit' }
        }
        $out = npm run test:local 2>&1
        if ($LASTEXITCODE -ne 0) {
            $summary = ($out | Select-String -Pattern 'Tests:\s+.*' | Select-Object -Last 1).ToString().Trim()
            return @{ Status = 'WARN'; Detail = "tier 2 failures: $summary" }
        }
        return @{ Status = 'PASS' }
    }
}

# ── 7. Integration tests (advisory, matches integration-tests.yml's status) ──
if (-not $overallFail -and -not $SkipIntegration) {
    Invoke-Stage 'Integration tests (advisory)' -Optional {
        $out = npm run test:integration:jest 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'WARN'; Detail = 'advisory-only, matches GitHub integration-tests.yml which is not a required check' }
        }
        return @{ Status = 'PASS' }
    }
} elseif ($SkipIntegration) {
    Add-Stage -Name 'Integration tests (advisory)' -Status 'SKIP' -Detail '-SkipIntegration was set'
}

# ── 8. HYDI qualification (opt-in only — see .PARAMETER RunQualification) ──
if ($RunQualification -and -not $overallFail) {
    Invoke-Stage "HYDI qualification ($Scenario)" -Optional {
        Write-Host "   ⚠️  This will exercise the LIVE running system and may briefly" -ForegroundColor Yellow
        Write-Host "      restart real processes. Running scenario: $Scenario" -ForegroundColor Yellow
        $out = node scripts/hydi-qualify.js "--scenario=$Scenario" --json 2>&1
        $jsonLine = $out | Where-Object { $_ -match '^\{' } | Select-Object -First 1
        if ($jsonLine) {
            try {
                $parsed = $jsonLine | ConvertFrom-Json
                if ($parsed.overallVerdict -eq 'OPERATIONAL') {
                    return @{ Status = 'PASS'; Detail = "recovered=$($parsed.evidence.recoverySuccessRate)% escalated=$($parsed.evidence.escalationRate)%" }
                }
                return @{ Status = 'WARN'; Detail = "verdict=$($parsed.overallVerdict)" }
            } catch {
                return @{ Status = 'WARN'; Detail = 'could not parse qualification output' }
            }
        }
        return @{ Status = 'WARN'; Detail = 'no JSON result found in qualification output' }
    }
} else {
    Add-Stage -Name 'HYDI qualification' -Status 'SKIP' -Detail 'opt-in only — pass -RunQualification to include (exercises the live system for real)'
}

# ── 9. Live service health (best-effort — reflects machine state, not the commit) ──
if (-not $overallFail) {
    Invoke-Stage 'Live service health' -Optional {
        $pm2Online = $null
        try { $pm2Json = pm2 jlist 2>$null | ConvertFrom-Json -AsHashtable; $pm2Online = ($pm2Json | Where-Object { $_.pm2_env.status -eq 'online' }).Count } catch {}

        if ($null -eq $pm2Online -or $pm2Online -eq 0) {
            return @{ Status = 'SKIP'; Detail = 'PM2 not running or no apps online — nothing to check (this is a machine-state fact, not a defect in the commit)' }
        }

        $endpoints = @(
            @{ url = 'http://127.0.0.1:3000/api/health'; name = 'heidi-web' }
            @{ url = 'http://127.0.0.1:3005/health'; name = 'protoforge-core' }
            @{ url = 'http://127.0.0.1:3006/api/health'; name = 'heidi-mobile-chat' }
            @{ url = 'http://127.0.0.1:11434/api/tags'; name = 'ollama' }
        )
        $results = foreach ($e in $endpoints) {
            try {
                $r = Invoke-WebRequest -Uri $e.url -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
                "$($e.name)=HTTP$($r.StatusCode)"
            } catch {
                "$($e.name)=UNREACHABLE"
            }
        }
        $unreachable = $results | Where-Object { $_ -match 'UNREACHABLE' }
        if ($unreachable) {
            return @{ Status = 'WARN'; Detail = ($results -join ', ') }
        }
        return @{ Status = 'PASS'; Detail = ($results -join ', ') + " ($pm2Online PM2 apps online)" }
    }
}

# ── 10. Database integrity ──────────────────────────────────────────────
if (-not $overallFail) {
    Invoke-Stage 'Database integrity (verify-supabase.sh)' -Optional {
        if (-not (Test-Path './verify-supabase.sh')) {
            return @{ Status = 'SKIP'; Detail = 'verify-supabase.sh not found' }
        }
        if (-not (Test-CommandExists 'bash')) {
            return @{ Status = 'SKIP'; Detail = 'bash not available to run verify-supabase.sh' }
        }
        $out = bash ./verify-supabase.sh 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'WARN'; Detail = ($out | Select-String -Pattern 'FAILED|✗' | Select-Object -First 3) -join ' | ' }
        }
        $summaryLine = $out | Select-String -Pattern 'RESULT:' | Select-Object -Last 1
        return @{ Status = 'PASS'; Detail = if ($summaryLine) { $summaryLine.ToString().Trim() } else { 'ok' } }
    }
}

# ── 11. Revenue safety (reuses the existing live-secret scanner, not a new one) ──
if (-not $overallFail) {
    $status = Invoke-Stage 'Revenue safety (live-secret scan)' {
        $out = npm run scan:secrets 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'FAIL'; Detail = ($out | Select-Object -Last 5) -join ' | ' }
        }
        return @{ Status = 'PASS' }
    }
    if (& $ShouldStop $status) { $overallFail = $true }
}

# ── ARTIFACT ─────────────────────────────────────────────────────────────
$sha = git rev-parse HEAD 2>$null
if (-not $sha) { $sha = 'no-commit' }
$shortSha = $sha.Substring(0, [Math]::Min(12, $sha.Length))
$artifactDir = Join-Path $RepoRoot '.hydi/verification'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

$hasFail = ($Stages | Where-Object { $_.status -eq 'FAIL' }).Count -gt 0
$verdict = if ($hasFail) { 'FAIL' } else { 'PASS' }
$totalDuration = ((Get-Date) - $OverallStart).TotalSeconds

$record = [PSCustomObject]@{
    commit      = $sha
    branch      = (git branch --show-current 2>$null)
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    durationSec = [Math]::Round($totalDuration, 1)
    stages      = $Stages
    verdict     = $verdict
}

$jsonPath = Join-Path $artifactDir "$shortSha.json"
$txtPath = Join-Path $artifactDir "$shortSha.txt"
$record | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding utf8

$txtLines = @(
    "LOCAL VERIFICATION RECORD"
    ""
    "COMMIT:   $sha"
    "BRANCH:   $($record.branch)"
    "GENERATED: $($record.generatedAt)"
    "DURATION: $($record.durationSec)s"
    ""
) + ($Stages | ForEach-Object {
    "{0,-45} {1,-6} {2}" -f $_.name, $_.status, $_.detail
}) + @("", "VERDICT: $verdict")
$txtLines | Set-Content -Path $txtPath -Encoding utf8

Write-Host ""
Write-Host ('═' * 70) -ForegroundColor White
Write-Host "VERDICT: $verdict" -ForegroundColor $(if ($verdict -eq 'PASS') { 'Green' } else { 'Red' })
Write-Host ('═' * 70) -ForegroundColor White
Write-Host "Artifact: $jsonPath"
Write-Host "          $txtPath"

if ($verdict -eq 'FAIL') { exit 1 } else { exit 0 }
