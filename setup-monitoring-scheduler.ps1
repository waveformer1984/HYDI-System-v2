# Setup Task Scheduler for automatic monitoring
$ErrorActionPreference = "Stop"

function Write-SetupLog($msg) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logEntry = "[$timestamp] SETUP: $msg"
  Write-Host $logEntry
  Add-Content -Path "monitoring-setup.log" -Value $logEntry -ErrorAction SilentlyContinue
}

try {
  Write-SetupLog "Setting up HYDI monitoring scheduler"
  
  # Remove existing task if it exists
  $existingTask = Get-ScheduledTask -TaskName "HYDI Health Monitor" -ErrorAction SilentlyContinue
  if ($existingTask) {
    Write-SetupLog "Removing existing monitoring task"
    Unregister-ScheduledTask -TaskName "HYDI Health Monitor" -Confirm:$false
  }
  
  # Create new task
  $scriptPath = Join-Path $PSScriptRoot "complete-monitoring.ps1"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""
  
  # Trigger every 5 minutes
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
  
  # Settings
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun
  
  # Register task
  Register-ScheduledTask -TaskName "HYDI Health Monitor" -Action $action -Trigger $trigger -Settings $settings -Description "HYDI System Health Monitoring - Runs every 5 minutes"
  
  Write-SetupLog "Monitoring scheduler setup complete"
  Write-SetupLog "Task will run every 5 minutes automatically"
  Write-SetupLog "Logs will be written to: complete-monitoring.log"
  
  # Show task info
  $task = Get-ScheduledTask -TaskName "HYDI Health Monitor"
  Write-SetupLog "Task created: $($task.TaskName)"
  Write-SetupLog "Next run: $($task.Triggers.StartBoundary)"
  
} catch {
  Write-SetupLog "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-SetupLog "Setup completed successfully" -ForegroundColor Green
