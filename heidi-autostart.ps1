# heidi-autostart.ps1
# Registers heidi-bridge.py as a Windows Task Scheduler job.
# Runs at logon, restarts on failure, no window.
# Run as Administrator.

$taskName   = "HeidiBridge"
$scriptPath = "$PSScriptRoot\heidi-bridge.py"
$pythonExe  = (Get-Command python -ErrorAction SilentlyContinue).Source

if (-not $pythonExe) {
    Write-Error "Python not found in PATH. Install Python and try again."
    exit 1
}

# Remove old task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute $pythonExe -Argument "`"$scriptPath`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit     ([TimeSpan]::Zero) `
    -RestartCount           3 `
    -RestartInterval        ([TimeSpan]::FromMinutes(1)) `
    -StartWhenAvailable     $true

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

Register-ScheduledTask `
    -TaskName   $taskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Description "Heidi Bridge — ProtoForge local API server for Android/Termux" | Out-Null

Write-Host ""
Write-Host "Task registered: '$taskName'"
Write-Host "  Runs at logon as: $env:USERNAME"
Write-Host "  Script: $scriptPath"
Write-Host "  Python: $pythonExe"
Write-Host ""
Write-Host "Start now without rebooting:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "Check status:"
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Select-Object State"
Write-Host ""
Write-Host "Remove:"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
