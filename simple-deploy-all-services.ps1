# Simple deployment script for all services
$ErrorActionPreference = "Stop"

function Write-Log($msg) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $msg"
  Add-Content -Path "all-services-deployment.log" -Value "[$timestamp] $msg" -ErrorAction SilentlyContinue
}

function Deploy-Service($serviceName) {
  Write-Log "Deploying service: $serviceName"
  
  try {
    $result = & supabase functions deploy $serviceName --no-verify-jwt
    
    if ($LASTEXITCODE -eq 0) {
      Write-Log "SUCCESS: $serviceName deployed"
      return $true
    } else {
      Write-Log "FAILED: $serviceName deployment failed"
      return $false
    }
  } catch {
    Write-Log "ERROR: $serviceName - $($_.Exception.Message)"
    return $false
  }
}

# Main deployment
try {
  Write-Log "Starting comprehensive services deployment"
  
  # Web Services
  Write-Log "Deploying Web Services..."
  $webServices = @(
    "api-gateway",
    "user-management", 
    "payment-processing",
    "notification-service",
    "analytics-service",
    "file-storage",
    "search-service",
    "cache-service"
  )
  
  $webSuccess = 0
  $webFailed = 0
  
  foreach ($service in $webServices) {
    $success = Deploy-Service $service
    if ($success) {
      $webSuccess++
    } else {
      $webFailed++
    }
  }
  
  # Marketing Services
  Write-Log "Deploying Marketing Services..."
  $marketingServices = @(
    "marketing-automation",
    "lead-generation",
    "content-management", 
    "email-marketing",
    "social-media",
    "customer-segments",
    "campaign-analytics",
    "brand-awareness"
  )
  
  $marketingSuccess = 0
  $marketingFailed = 0
  
  foreach ($service in $marketingServices) {
    $success = Deploy-Service $service
    if ($success) {
      $marketingSuccess++
    } else {
      $marketingFailed++
    }
  }
  
  # Summary
  Write-Log "Deployment Summary:"
  Write-Log "Web Services: $webSuccess successful, $webFailed failed"
  Write-Log "Marketing Services: $marketingSuccess successful, $marketingFailed failed"
  
  $totalSuccess = $webSuccess + $marketingSuccess
  $totalFailed = $webFailed + $marketingFailed
  
  Write-Log "Total: $totalSuccess successful, $totalFailed failed"
  
  if ($totalFailed -eq 0) {
    Write-Log "ALL SERVICES DEPLOYED SUCCESSFULLY"
  } else {
    Write-Log "PARTIAL DEPLOYMENT - Some services failed"
  }
  
} catch {
  Write-Log "Deployment failed: $($_.Exception.Message)"
  exit 1
}

Write-Log "Deployment process finished"
