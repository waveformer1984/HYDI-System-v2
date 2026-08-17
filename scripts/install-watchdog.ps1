# scripts/install-watchdog.ps1
# ----------------------------------------------------------------------------
# Installs the HYDI-Watchdog scheduled task (runs every 2 minutes, no admin
# needed - creates a per-user task). This is the ONLY scheduled task the HYDI
# system should have going forward.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1
#
# To uninstall:
#   schtasks /Delete /TN "HYDI-Watchdog" /F
# ----------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { Write-Error "node not found on PATH"; exit 1 }

$watchdogScript = Join-Path $repoRoot 'scripts\watchdog.js'
if (-not (Test-Path $watchdogScript)) { Write-Error "watchdog.js not found at $watchdogScript"; exit 1 }

$taskName = 'HYDI-Watchdog'
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "$watchdogScript --once" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1)

# Register per-user (no admin needed)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName"
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "HYDI system health watchdog - polls health endpoints every 2 minutes and logs to logs/watchdog.log" | Out-Null

Write-Host ""
Write-Host "Installed scheduled task: $taskName"
Write-Host "  Runs every 2 minutes"
Write-Host "  Command: $nodeExe $watchdogScript --once"
Write-Host "  Log file: $repoRoot\logs\watchdog.log"
Write-Host ""
Write-Host "To verify: schtasks /Query /TN $taskName"
$uninstallCmd = "schtasks /Delete /TN `"$taskName`" /F"
Write-Host "To uninstall: $uninstallCmd"
