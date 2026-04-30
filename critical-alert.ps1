# Single critical alert - payout failure detection
# Run this after any payout operation

param(
  [string]$AlertMethod = "log", # log, email, webhook
  [string]$LogFile = "critical-alerts.log"
)

function Send-CriticalAlert($message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $alertMsg = "[$timestamp] CRITICAL: $message"
  
  switch ($AlertMethod) {
    "log" {
      Write-Host $alertMsg -ForegroundColor Red
      Add-Content -Path $LogFile -Value $alertMsg
    }
    "email" {
      # Configure your email settings
      $to = "admin@example.com"
      $subject = "CRITICAL: HYDI Payout System Alert"
      $body = "Time: $timestamp`nAlert: $message`n`nImmediate attention required."
      # Send-MailMessage -To $to -Subject $subject -Body $body -SmtpServer "smtp.example.com"
      Write-Host "Email alert would be sent to $to" -ForegroundColor Yellow
    }
    "webhook" {
      # Configure your webhook URL
      $webhookUrl = "https://your-webhook-url"
      $payload = @{message=$message;timestamp=$timestamp;severity="critical"}
      # Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload | ConvertTo-Json
      Write-Host "Webhook alert would be sent to $webhookUrl" -ForegroundColor Yellow
    }
  }
}

# Check for recent payout failures (last 5 minutes)
try {
  $fiveMinutesAgo = (Get-Date).AddMinutes(-5)
  
  # This would query your logs/database for payout failures
  # For now, we'll simulate the check
  
  # Simulated check - replace with real logic
  $recentFailures = 0 # Get actual failure count from your system
  
  if ($recentFailures -gt 0) {
    Send-CriticalAlert "Payout failures detected: $recentFailures in last 5 minutes"
  } else {
    Write-Host "No recent payout failures detected" -ForegroundColor Green
  }
  
} catch {
  Send-CriticalAlert "Payout monitoring system failed: $($_.Exception.Message)"
}
