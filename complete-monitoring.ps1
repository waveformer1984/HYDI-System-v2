# Complete monitoring - ties everything together
param(
  [switch]$TestMode
)

$ErrorActionPreference = "Stop"

function Write-MonitoringLog($msg, $level = "INFO") {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logEntry = "[$timestamp] [$level] $msg"
  Write-Host $logEntry
  
  Add-Content -Path "complete-monitoring.log" -Value $logEntry -ErrorAction SilentlyContinue
}

try {
  Write-MonitoringLog "Starting complete monitoring check"
  
  # 1. Health check
  Write-MonitoringLog "Running health verification"
  $healthResult = & powershell -ExecutionPolicy Bypass -File verify-system-health-fixed.ps1
  
  if ($LASTEXITCODE -ne 0) {
    Write-MonitoringLog "Health check FAILED" "ERROR"
    & powershell -ExecutionPolicy Bypass -File send-unavoidable-alert.ps1 -Message "System health check failed" -Severity "critical"
  }
  
  # 2. Tripwire check
  Write-MonitoringLog "Running tripwire detection"
  & powershell -ExecutionPolicy Bypass -File tripwire-detector.ps1
  
  # 3. Vercel environment check (if token available)
  $vercelToken = $env:VERCEL_TOKEN
  if ($vercelToken) {
    Write-MonitoringLog "Checking Vercel environment"
    $vercelResult = & node vercel-api-check.js
    
    if ($LASTEXITCODE -ne 0) {
      Write-MonitoringLog "Vercel environment check FAILED" "ERROR"
      & powershell -ExecutionPolicy Bypass -File send-unavoidable-alert.ps1 -Message "Vercel environment drift detected" -Severity "critical"
    }
  } else {
    Write-MonitoringLog "VERCEL_TOKEN not available, skipping Vercel check" "WARN"
  }
  
  # 4. Critical alert check
  Write-MonitoringLog "Running critical alert check"
  & powershell -ExecutionPolicy Bypass -File critical-alert.ps1
  
  Write-MonitoringLog "Complete monitoring check PASSED"
  
} catch {
  Write-MonitoringLog "Complete monitoring CRASHED: $($_.Exception.Message)" "ERROR"
  & powershell -ExecutionPolicy Bypass -File send-unavoidable-alert.ps1 -Message "Monitoring system crashed: $($_.Exception.Message)" -Severity "critical"
  exit 1
}

Write-MonitoringLog "Monitoring cycle completed successfully"
exit 0
