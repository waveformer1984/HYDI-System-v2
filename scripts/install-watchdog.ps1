# scripts/install-watchdog.ps1
# ----------------------------------------------------------------------------
# RETIRED 2026-10-30. This used to register the per-user scheduled task
# "HYDI-Watchdog", running `node scripts\watchdog.js --once` every 2 minutes.
#
# Two problems:
#   1. A per-user task runs on the desktop, and node.exe is a console program,
#      so every run opened a new terminal window that stole focus: one window
#      every 2 minutes, around the clock. A failed run (exit code 1) stayed
#      open, so they piled up. See docs/FRANK_CONSOLE_POPUPS.md.
#   2. It duplicated PM2's `hydi-watchdog` app (ecosystem.config.js), which
#      runs the same script continuously and hidden.
#
# Running this script now REMOVES the task if it exists, and installs nothing.
#
# Usage (no admin needed; it is a per-user task):
#   powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1
# Same as:
#   schtasks /Delete /TN "HYDI-Watchdog" /F
# ----------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$taskName = 'HYDI-Watchdog'

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task: $taskName" -ForegroundColor Green
} else {
    Write-Host "Scheduled task '$taskName' is not installed (nothing to remove)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "The watchdog runs under PM2 as 'hydi-watchdog' (pm2 describe hydi-watchdog)."
Write-Host "No HYDI scheduled task is needed for it."
