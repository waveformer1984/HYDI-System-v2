# Single tripwire - consecutive failure detector
# Alert if failures > 3 in a row

param(
  [string]$StateFile = "tripwire-state.json",
  [int]$FailureThreshold = 3,
  [string]$LogFile = "tripwire-alerts.log"
)

function Get-TripwireState {
  if (Test-Path $StateFile) {
    return Get-Content $StateFile | ConvertFrom-Json
  } else {
    return @{
      consecutiveFailures = 0
      lastCheck = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
      alertSent = $false
    }
  }
}

function Set-TripwireState($state) {
  $state.lastCheck = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  $state | ConvertTo-Json | Set-Content $StateFile
}

function Send-TripwireAlert($message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $alertMsg = "[$timestamp] TRIPWIRE: $message"
  
  Write-Host $alertMsg -ForegroundColor Red
  Add-Content -Path $LogFile -Value $alertMsg
  
  # Reset after alert
  $state = @{
    consecutiveFailures = 0
    lastCheck = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    alertSent = $true
  }
  Set-TripwireState $state
}

try {
  $state = Get-TripwireState
  
  # Run health check to determine success/failure
  $healthCheck = & powershell -ExecutionPolicy Bypass -File verify-system-health-fixed.ps1
  
  if ($LASTEXITCODE -ne 0) {
    # Failure detected
    $state.consecutiveFailures++
    Set-TripwireState $state
    
    Write-Host "Consecutive failures: $($state.consecutiveFailures)/$FailureThreshold" -ForegroundColor Yellow
    
    if ($state.consecutiveFailures -ge $FailureThreshold -and -not $state.alertSent) {
      Send-TripwireAlert "System failed $($state.consecutiveFailures) times consecutively"
    }
  } else {
    # Success detected - reset counter
    if ($state.consecutiveFailures -gt 0) {
      Write-Host "System recovered after $($state.consecutiveFailures) consecutive failures" -ForegroundColor Green
    }
    
    $state.consecutiveFailures = 0
    $state.alertSent = $false
    Set-TripwireState $state
  }
  
} catch {
  Send-TripwireAlert "Tripwire detector failed: $($_.Exception.Message)"
}
