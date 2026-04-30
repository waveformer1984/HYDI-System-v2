# Minimal scheduled health check
# Run this every 5-10 minutes via Task Scheduler or GitHub Actions

param(
  [string]$LogFile = "health-checks.log",
  [switch]$Silent
)

$ErrorActionPreference = "Stop"

function Log-Message($msg, $level = "INFO") {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logEntry = "[$timestamp] [$level] $msg"
  
  if (-not $Silent) {
    Write-Host $logEntry
  }
  
  Add-Content -Path $LogFile -Value $logEntry -ErrorAction SilentlyContinue
}

function Send-Alert($msg) {
  # Minimal alert - replace with your preferred method
  $subject = "HYDI System Alert: $msg"
  $body = "Time: $(Get-Date)`nMessage: $msg`n`nCheck logs: $LogFile"
  
  # Option 1: Email (requires configuration)
  # Send-MailMessage -To "admin@example.com" -Subject $subject -Body $body -SmtpServer "smtp.example.com"
  
  # Option 2: Webhook (replace URL)
  # Invoke-RestMethod -Uri "https://your-webhook-url" -Method Post -Body @{message=$msg;subject=$subject}
  
  # Option 3: Just log loudly for now
  Log-Message "ALERT: $msg" "ALERT"
  
  # Exit with error code for CI/CD
  exit 1
}

try {
  Log-Message "Starting health check"
  
  # Run existing verification
  $result = & powershell -ExecutionPolicy Bypass -File verify-system-health-fixed.ps1
  
  if ($LASTEXITCODE -ne 0) {
    Log-Message "Health check failed with exit code $LASTEXITCODE" "ERROR"
    Send-Alert "System health check failed"
  }
  
  Log-Message "Health check passed"
  
} catch {
  Log-Message "Health check crashed: $($_.Exception.Message)" "ERROR"
  Send-Alert "System health check crashed"
}

exit 0
