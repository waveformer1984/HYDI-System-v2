# Aggregate Frank-side pending checks (read-only by default).
param(
  [switch]$ApplyArchive
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== inventory (read-only) ===" -ForegroundColor Cyan
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

Write-Host "`n=== hydi-verify ===" -ForegroundColor Cyan
node scripts/hydi-verify.js --quick

Write-Host "`nDone. See docs/NEEDS_FROM_JORDAN.md for paste-back items." -ForegroundColor Green
