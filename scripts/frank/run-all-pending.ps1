# Aggregate Frank-side pending checks (read-only by default).
param(
  [switch]$ApplyArchive,
  [switch]$JobScout   # state-changing: pulls, migrates local Supabase, restarts PM2, runs one scan
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== HEIDI_ADMIN_TOKEN (generate if missing, never echo value) ===" -ForegroundColor Cyan
$envLocal = Join-Path $Root '.env.local'
$example = Join-Path $Root '.env.example'
if (-not (Test-Path -LiteralPath $envLocal) -and (Test-Path -LiteralPath $example)) {
  Copy-Item -LiteralPath $example -Destination $envLocal
}
if (Test-Path -LiteralPath $envLocal) {
  $lines = Get-Content -LiteralPath $envLocal
  $hasToken = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*HEIDI_ADMIN_TOKEN\s*=\s*\S+') { $hasToken = $true; break }
  }
  if (-not $hasToken) {
    $token = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    Add-Content -LiteralPath $envLocal -Value "HEIDI_ADMIN_TOKEN=$token"
    Write-Host "HEIDI_ADMIN_TOKEN added to .env.local (value not printed)." -ForegroundColor Green
  } else {
    Write-Host "HEIDI_ADMIN_TOKEN already set in .env.local (not printed)." -ForegroundColor DarkGray
  }
  if (-not ($lines -match 'HEIDI_ALLOW_EXEC')) {
    Add-Content -LiteralPath $envLocal -Value 'HEIDI_ALLOW_EXEC=false'
    Write-Host "HEIDI_ALLOW_EXEC=false appended to .env.local" -ForegroundColor Green
  }
}

Write-Host "`n=== hydi-verify (offline then quick) ===" -ForegroundColor Cyan
node scripts/hydi-verify.js --offline
if ($LASTEXITCODE -ne 0) { Write-Host "hydi-verify --offline FAILED" -ForegroundColor Red }
node scripts/hydi-verify.js --quick

Write-Host "`n=== inventory (read-only) ===" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\frank\inventory.ps1')

Write-Host "`n=== port-doctor ===" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\frank\port-doctor.ps1')

Write-Host "`n=== archive-folders ===" -ForegroundColor Cyan
if ($ApplyArchive) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\frank\archive-folders.ps1') -Apply
} else {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\frank\archive-folders.ps1')
}

Write-Host "`n=== port registry (node) ===" -ForegroundColor Cyan
node scripts/check-port-registry.js
node scripts/sync-ports-registry.js --check

if ($JobScout) {
  Write-Host "`n=== job-scout go-live (STATE-CHANGING — see docs/NEEDS_FROM_JORDAN.md) ===" -ForegroundColor Yellow
  Write-Host "1) git pull" -ForegroundColor Cyan
  git pull
  Write-Host "`n2) local Supabase migration (job_lead notification category)" -ForegroundColor Cyan
  npx supabase migration up
  Write-Host "`n3) pm2 restart hydi-schedulers heidi-web-standalone ursula-local --update-env" -ForegroundColor Cyan
  pm2 restart hydi-schedulers heidi-web-standalone ursula-local --update-env
  Write-Host "`n4) node scripts/job-scout.js --once" -ForegroundColor Cyan
  node scripts/job-scout.js --once
  Write-Host "`n5) npm run runtime:audit" -ForegroundColor Cyan
  npm run runtime:audit
} else {
  Write-Host "`n(job-scout go-live skipped — re-run with -JobScout after the job-scout PRs merge)" -ForegroundColor DarkGray
}

Write-Host "`nDone. See docs/NEEDS_FROM_JORDAN.md for paste-back items." -ForegroundColor Green
