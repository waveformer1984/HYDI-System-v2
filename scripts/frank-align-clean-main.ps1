#Requires -Version 5.1
<#
.SYNOPSIS
  Align Frank (heidi-pc) with cloud-verified clean-main and Evolution 2.0 / M1 work.

.DESCRIPTION
  Read-only by default: records git state, verifies baseline commit ancestry, and
  prints the next safe step. Optional switches run existing collectors and checks
  — no new autonomy, no PM2 restarts, no deploy.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/frank-align-clean-main.ps1

.EXAMPLE
  powershell -File scripts/frank-align-clean-main.ps1 -Pull -Collector -FullM1
#>
param(
  [switch]$Pull,
  [switch]$Collector,
  [switch]$FullM1,
  [string]$BaselineCommit = '1a86a7ee'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$Accept = Join-Path $Root ".runtime\acceptance\frank-align-$ts"
New-Item -ItemType Directory -Force -Path $Accept | Out-Null

function Write-Artifact($Name, $Content) {
  $path = Join-Path $Accept $Name
  if ($Content -is [string]) {
    Set-Content -Path $path -Value $Content -Encoding utf8
  } else {
    $Content | ConvertTo-Json -Depth 12 | Set-Content -Path $path -Encoding utf8
  }
  return $path
}

git status -sb | Out-String | ForEach-Object { Write-Artifact 'git-status.txt' $_ } | Out-Null
git fetch origin 2>&1 | Out-String | ForEach-Object { Write-Artifact 'git-fetch.log' $_ } | Out-Null

$head = (git rev-parse HEAD).Trim()
$originMain = (git rev-parse origin/clean-main).Trim()
Write-Artifact 'git-head.txt' $head | Out-Null
Write-Artifact 'origin-clean-main.txt' $originMain | Out-Null

$behind = [int](git rev-list --count HEAD..origin/clean-main)
$ahead = [int](git rev-list --count origin/clean-main..HEAD)
$summary = @{
  host = $env:COMPUTERNAME
  utc = $ts
  head = $head
  origin_clean_main = $originMain
  commits_behind_origin_clean_main = $behind
  commits_ahead_origin_clean_main = $ahead
  baseline_commit = $BaselineCommit
  baseline_is_ancestor = $false
  acceptance_dir = $Accept
}
git merge-base --is-ancestor $BaselineCommit HEAD
if ($LASTEXITCODE -eq 0) { $summary.baseline_is_ancestor = $true }

if ($Pull) {
  if ((git status --porcelain).Length -gt 0) {
    throw "Refusing -Pull: uncommitted changes. Stash or commit first. See $Accept\git-status.txt"
  }
  git pull origin clean-main 2>&1 | Out-String | ForEach-Object { Write-Artifact 'git-pull.log' $_ } | Out-Null
  $summary.head_after_pull = (git rev-parse HEAD).Trim()
}

Write-Artifact 'summary.json' $summary | Out-Null

Write-Host "Frank align — artifacts: $Accept"
Write-Host "HEAD=$head origin/clean-main=$originMain behind=$behind ahead=$ahead"
if (-not $summary.baseline_is_ancestor) {
  Write-Warning "HEAD is not a descendant of $BaselineCommit — confirm you merged PR #603+ before M1."
}

if ($Collector) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\frank-production-truth-collect.ps1') `
    2>&1 | Tee-Object (Join-Path $Accept 'collector.log')
  $summary.collector_exit = $LASTEXITCODE
}

if ($FullM1) {
  npm run runtime:audit 2>&1 | Tee-Object (Join-Path $Accept 'runtime-audit.log')
  node (Join-Path $Root 'scripts\heidi-self-improve.js') dashboard 2>&1 |
    Tee-Object (Join-Path $Accept 'dashboard.json')
  $env:ESLINT_USE_FLAT_CONFIG = 'true'
  node (Join-Path $Root 'scripts\local-ci.js') HEAD 2>&1 | Tee-Object (Join-Path $Accept 'local-ci.log')
  $summary.local_ci_exit = $LASTEXITCODE
  Write-Host "local-ci exit: $LASTEXITCODE (see log; ciChildEnv strips ESLINT_USE_FLAT_CONFIG for children)"
}

Write-Host @"

Next steps (manual):
  1. Merge GitHub PR #605 (Frank handoff + FRANK_VERIFIED proof labels) if not on clean-main yet.
  2. git pull origin clean-main  (or re-run this script with -Pull)
  3. -Collector then node scripts/heidi-self-improve.js dashboard
  4. Owner-only: node scripts/heidi-self-improve.js run --owner-requested --force-new

Docs: docs/reports/FRANK_CLOUD_TO_PRODUCTION_HANDOFF.md
"@