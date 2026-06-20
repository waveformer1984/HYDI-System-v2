# HEIDI - Single Entry Point (ORCHESTRATION ONLY)
# The ONE canonical way to start HEIDI. Cleanup and startup are delegated to
# heidi-clean.ps1 and heidi-start.ps1 so this file stays boot-logic only.
#
# Port map -- HEIDI owns ONLY 3458. Everything else is an EXTERNAL DEPENDENCY
# and must never be killed by this script:
#   3000 -> heidi-web              (ProtoForge hub, node)   -- do NOT touch
#   3005 -> protoforge-core        (ProtoForge hub, node)   -- do NOT touch
#   3006 -> mobile UI              (node)                   -- do NOT touch
#   3458 -> heidi-core control plane (THIS service)         -- the ONLY target
#
# Used by install-heidi-autostart.ps1, which runs "HEIDI.ps1 -KillFirst" at logon.
#   -KillFirst : restart cleanly (kill anything on 3458 first, then start)
#   -SkipOllama: pass through to startup; do not try to launch Ollama

param(
    [switch]$SkipOllama,
    [switch]$KillFirst
)

Set-Location $PSScriptRoot

$PORT = 3458

Write-Host "HEIDI Startup" -ForegroundColor Cyan
Write-Host "============" -ForegroundColor Cyan

$alreadyUp = [bool](Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)

# Idempotency: if it is already running and we were not asked to restart,
# do nothing -- this prevents autostart + a manual run from double-binding 3458.
if ($alreadyUp -and -not $KillFirst) {
    Write-Host "HEIDI already running on $PORT -- nothing to do (use -KillFirst to restart)." -ForegroundColor Green
    exit 0
}

# Cleanup (port 3458 ONLY) -- delegated.
if ($KillFirst) {
    Write-Host "`nCleaning port $PORT..." -ForegroundColor Yellow
    & "$PSScriptRoot\heidi-clean.ps1" -Port $PORT
}

# Startup -- delegated (runs in the foreground and blocks until HEIDI exits).
if ($SkipOllama) {
    & "$PSScriptRoot\heidi-start.ps1" -SkipOllama
} else {
    & "$PSScriptRoot\heidi-start.ps1"
}
