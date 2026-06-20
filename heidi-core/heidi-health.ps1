# heidi-health.ps1 -- read-only health probe (no side effects).
# Confirms the HEIDI control plane (3458) is up, its /health endpoint answers,
# the hub dependencies (3000/3005/3006) are reachable, and logs are writable.
# Exit 0 = control plane healthy, 1 = degraded.
$ErrorActionPreference = "SilentlyContinue"

$ports = [ordered]@{
    "3458 heidi-core"      = 3458
    "3000 heidi-web"       = 3000
    "3005 protoforge-core" = 3005
    "3006 mobile-ui"       = 3006
}

$allOk = $true
Write-Host "HEIDI health" -ForegroundColor Cyan
Write-Host "============" -ForegroundColor Cyan

foreach ($name in $ports.Keys) {
    $up = [bool](Get-NetTCPConnection -LocalPort $ports[$name] -State Listen -ErrorAction SilentlyContinue)
    Write-Host ("  {0,-22} {1}" -f $name, $(if ($up) { "UP" } else { "down" })) -ForegroundColor $(if ($up) { "Green" } else { "Red" })
    if ($name -like "3458*" -and -not $up) { $allOk = $false }   # only 3458 is fatal here
}

# Control-plane /health endpoint
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:3458/health" -TimeoutSec 4 -ErrorAction Stop
    Write-Host "  /health: ok (model=$($h.model), sessions=$($h.sessions), tasks=$($h.tasks))" -ForegroundColor Green
} catch {
    Write-Host "  /health: unreachable" -ForegroundColor Red
    $allOk = $false
}

# Log/dir writability
try {
    $probe = Join-Path $PSScriptRoot ".health-write-test"
    "ok" | Out-File -FilePath $probe -ErrorAction Stop
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
    Write-Host "  logs writable: yes" -ForegroundColor Green
} catch {
    Write-Host "  logs writable: NO" -ForegroundColor Red
    $allOk = $false
}

if ($allOk) {
    Write-Host "OVERALL: healthy" -ForegroundColor Green
    exit 0
} else {
    Write-Host "OVERALL: degraded" -ForegroundColor Red
    exit 1
}
