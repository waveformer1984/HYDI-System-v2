<#
.SYNOPSIS
    Install (or remove) the "HYDI Boot Agent" auto-start as a per-user
    Scheduled Task that fires at logon. No administrator/UAC required, because
    it runs as the current interactive user at Limited run level.

.DESCRIPTION
    Registers a Scheduled Task that launches scripts\run-boot.cmd at logon,
    which in turn runs the boot agent (npm-less, direct node) and logs to
    logs\boot-agent.log. Running as the logged-in user means the task inherits
    your PATH, your .env, and your Tailscale user context -- all of which a
    SYSTEM-level Windows service would NOT have.

.PARAMETER Mode
    'dev'  -> boot agent runs `next dev`  (default; matches the current setup)
    'prod' -> boot agent runs `next start` (run `npm run build` first)

.PARAMETER Remove
    Unregister the scheduled task and exit.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1 -Mode prod
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1 -Remove
#>
[CmdletBinding()]
param(
    [ValidateSet('dev', 'prod')] [string]$Mode = 'dev',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName  = 'HYDI Boot Agent'
$ScriptDir = $PSScriptRoot
$Root      = Split-Path -Parent $ScriptDir
$Wrapper   = Join-Path $ScriptDir 'run-boot.cmd'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
    } else {
        Write-Host "Scheduled task '$TaskName' was not found (nothing to remove)." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $Wrapper)) { throw "Wrapper not found: $Wrapper" }

# Action: run the wrapper (optionally in prod mode), with repo root as cwd.
if ($Mode -eq 'prod') {
    $action = New-ScheduledTaskAction -Execute $Wrapper -Argument '--prod' -WorkingDirectory $Root
} else {
    $action = New-ScheduledTaskAction -Execute $Wrapper -WorkingDirectory $Root
}

$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -StartWhenAvailable `
                -RestartCount 3 `
                -RestartInterval (New-TimeSpan -Minutes 1) `
                -ExecutionTimeLimit (New-TimeSpan -Seconds 0)   # 0 = no time limit
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' (mode=$Mode)." -ForegroundColor Green
Write-Host "  Trigger : at logon for $env:USERNAME"
Write-Host "  Runs    : $Wrapper"
Write-Host "  Logs    : $(Join-Path $Root 'logs\boot-agent.log')"
Write-Host ""
Write-Host "Start it now (no reboot needed):" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check status:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
