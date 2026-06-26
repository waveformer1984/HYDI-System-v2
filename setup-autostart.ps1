# =====================================================================
#  ONE-TIME SETUP — registers HYDI/Heidi to start automatically
#  every time you log into Windows, and to keep itself running.
#
#  Run ONCE, as Administrator:
#     powershell -ExecutionPolicy Bypass -File setup-autostart.ps1
#
#  After this, you never need to run `node ...` manually again.
#  The system starts at login and the watchdog in start-system.ps1
#  restarts anything that crashes.
#
#  To remove later:
#     Unregister-ScheduledTask -TaskName "HeidiSystem" -Confirm:$false
# =====================================================================

$taskName = "HeidiSystem"
$scriptPath = "C:\Users\Owner\HYDI-System-v2\start-system.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit 0 `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Remove any existing registration first
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force

Write-Host "Registered scheduled task '$taskName'."
Write-Host "It will start automatically at your next login."
Write-Host ""
Write-Host "To start it right now without logging out, run:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
