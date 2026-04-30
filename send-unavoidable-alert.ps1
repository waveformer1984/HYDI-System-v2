# Unavoidable alert system - failure = interruption
param(
  [string]$Message,
  [string]$Severity = "critical",
  [string]$ConfigFile = "alert-config.json"
)

$ErrorActionPreference = "Stop"

function Send-UnavoidableAlert($msg, $severity) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  
  try {
    $config = Get-Content $ConfigFile | ConvertFrom-Json
  } catch {
    Write-Host "❌ Alert config not found, using fallback" -ForegroundColor Red
    $config = @{ alertMethods = @{ log = @{ enabled = $true; file = "critical-alerts.log" } } }
  }
  
  $alertSent = $false
  
  # Try webhook first (Slack/Discord)
  if ($config.alertMethods.webhook.enabled -and $config.alertMethods.webhook.url -and $config.alertMethods.webhook.url -notmatch "YOUR/SLACK/WEBHOOK") {
    try {
      $payload = @{
        text = "🚨 HYDI $severity Alert: $msg"
        timestamp = $timestamp
        severity = $severity
      } | ConvertTo-Json -Depth 10
      
      Invoke-RestMethod -Uri $config.alertMethods.webhook.url -Method Post -Body $payload -ContentType "application/json" | Out-Null
      Write-Host "📡 Webhook alert sent" -ForegroundColor Green
      $alertSent = $true
    } catch {
      Write-Host "❌ Webhook failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  
  # Try email if webhook fails
  if (-not $alertSent -and $config.alertMethods.email.enabled) {
    try {
      $subject = "HYDI $severity Alert: $msg"
      $body = "Time: $timestamp`nSeverity: $severity`nMessage: $msg`n`nImmediate attention required."
      
      # Send-MailMessage -To $config.alertMethods.email.to -Subject $subject -Body $body -SmtpServer $config.alertMethods.email.smtp -Port $config.alertMethods.email.port -From $config.alertMethods.email.from
      Write-Host "📧 Email alert would be sent to $($config.alertMethods.email.to)" -ForegroundColor Yellow
      $alertSent = $true
    } catch {
      Write-Host "❌ Email failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  
  # Always log as last resort
  if ($config.alertMethods.log.enabled) {
    $logEntry = "[$timestamp] [$severity] $msg"
    Write-Host $logEntry -ForegroundColor Red
    Add-Content -Path $config.alertMethods.log.file -Value $logEntry -ErrorAction SilentlyContinue
  }
  
  # Make it impossible to ignore - exit with error
  if ($severity -eq "critical") {
    Write-Host "🚨 CRITICAL ALERT - SYSTEM REQUIRES ATTENTION" -BackgroundColor Red -ForegroundColor White
    exit 1
  }
}

# If called directly
if ($Message) {
  Send-UnavoidableAlert $Message $Severity
}
