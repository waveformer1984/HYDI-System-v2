# ProtoForge Monthly Payout Automation - Windows Task Scheduler Setup
# Run this as Administrator to schedule monthly payouts

$TaskName = "ProtoForge_Monthly_Payout"
$ScriptPath = "$PSScriptRoot\monthly-payout-automation.js"
$WorkingDir = Split-Path -Parent $PSScriptRoot
$NodePath = "node"

# Check if running as administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "⚠️  Please run this script as Administrator" -ForegroundColor Yellow
    exit 1
}

Write-Host "Setting up ProtoForge Monthly Payout Automation..." -ForegroundColor Cyan
Write-Host ""

# Remove existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the action
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument $ScriptPath -WorkingDirectory $WorkingDir

# Create the trigger - Run on the 1st of every month at 9 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At "09:00" -DaysInterval 30
# Alternative: Monthly trigger
# $Trigger = New-ScheduledTaskTrigger -Monthly -DaysOfMonth 1 -At "09:00"

# Create the principal (run whether user is logged in or not, with highest privileges)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Create the settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable

# Register the task
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "ProtoForge monthly payout automation - processes client payments and triggers ACH transfers"
    
    Write-Host "✅ Task '$TaskName' created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task Details:" -ForegroundColor Cyan
    Write-Host "  Name: $TaskName"
    Write-Host "  Schedule: 1st of every month at 9:00 AM"
    Write-Host "  Script: $ScriptPath"
    Write-Host "  Working Directory: $WorkingDir"
    Write-Host ""
    Write-Host "To run manually: node $ScriptPath"
    Write-Host "To check status: schtasks /query /tn $TaskName"
    Write-Host "To remove: schtasks /delete /tn $TaskName /f"
    
} catch {
    Write-Host "❌ Failed to create task: $_" -ForegroundColor Red
    exit 1
}

# Display current scheduled tasks
Write-Host ""
Write-Host "Current Scheduled Tasks:" -ForegroundColor Cyan
Get-ScheduledTask -TaskName "*ProtoForge*" | Select-Object TaskName, State, NextRunTime | Format-Table
