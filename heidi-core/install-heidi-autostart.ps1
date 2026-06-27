# install-heidi-autostart.ps1
# Registers HEIDI to relaunch automatically at user logon (survives reboot).
# Run ONCE, from an elevated-or-normal PowerShell:  .\install-heidi-autostart.ps1
# Remove with:  Unregister-ScheduledTask -TaskName "HEIDI Autostart" -Confirm:$false
#
# This only registers a Task Scheduler entry. It does not start HEIDI right now;
# it ensures HEIDI starts on the next (and every) logon.

param(
    [switch]$SkipOllama,   # pass through to HEIDI.ps1
    [switch]$RunNow        # also start HEIDI immediately after registering
)

$ErrorActionPreference = "Stop"

$ScriptDir  = $PSScriptRoot
$HeidiPs1   = Join-Path $ScriptDir "HEIDI.ps1"
$TaskName   = "HEIDI Autostart"

if (-not (Test-Path $HeidiPs1)) {
    Write-Host "ERROR: HEIDI.ps1 not found next to this installer ($HeidiPs1)" -ForegroundColor Red
    exit 1
}

# Build the argument list HEIDI.ps1 should receive at boot.
$heidiArgs = "-KillFirst"
if ($SkipOllama) { $heidiArgs += " -SkipOllama" }

# Run pwsh/powershell hidden, set working dir to the script folder.
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = "powershell.exe" }

$action = New-ScheduledTaskAction `
    -Execute $pwsh `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$HeidiPs1`" $heidiArgs" `
    -WorkingDirectory $ScriptDir

$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Starts HEIDI (port 3458) automatically at logon." `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host "  Runs at every logon: $pwsh -File `"$HeidiPs1`" $heidiArgs" -ForegroundColor Gray

if ($RunNow) {
    Write-Host "Starting HEIDI now..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
}
