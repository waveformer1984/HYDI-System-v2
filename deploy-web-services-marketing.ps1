# Deploy Web Services and Marketing Strategy
param(
  [switch]$DryRun,
  [switch]$SkipMarketing,
  [switch]$SkipWebServices
)

$ErrorActionPreference = "Stop"

function Write-DeployLog($msg, $level = "INFO") {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logEntry = "[$timestamp] [$level] $msg"
  Write-Host $logEntry
  Add-Content -Path "web-services-marketing-deployment.log" -Value $logEntry -ErrorAction SilentlyContinue
}

function Deploy-WebService($serviceName, $description, $endpoint) {
  Write-DeployLog "Deploying web service: $serviceName"
  Write-DeployLog "Description: $description"
  Write-DeployLog "Endpoint: $endpoint"
  
  if ($DryRun) {
    Write-DeployLog "DRY RUN: Would deploy $serviceName"
    return $true
  }
  
  try {
    # Check if function exists
    $functionPath = "supabase\functions\$serviceName"
    if (-not (Test-Path $functionPath)) {
      New-Item -ItemType Directory -Path $functionPath -Force | Out-Null
      Write-DeployLog "Created function directory: $serviceName"
    }
    
    # Deploy the function
    $result = & supabase functions deploy $serviceName --no-verify-jwt
    
    if ($LASTEXITCODE -eq 0) {
      Write-DeployLog "✅ $serviceName: DEPLOYED SUCCESSFULLY"
      return $true
    } else {
      Write-DeployLog "❌ $serviceName: DEPLOYMENT FAILED"
      return $false
    }
  } catch {
    Write-DeployLog "❌ $serviceName: $($_.Exception.Message)"
    return $false
  }
}

function Deploy-MarketingService($serviceName, $description) {
  Write-DeployLog "Deploying marketing service: $serviceName"
  Write-DeployLog "Description: $description"
  
  if ($DryRun) {
    Write-DeployLog "DRY RUN: Would deploy marketing service $serviceName"
    return $true
  }
  
  try {
    # Create marketing function
    $marketingPath = "supabase\functions\$serviceName"
    if (-not (Test-Path $marketingPath)) {
      New-Item -ItemType Directory -Path $marketingPath -Force | Out-Null
    }
    
    # Deploy marketing function
    $result = & supabase functions deploy $serviceName --no-verify-jwt
    
    if ($LASTEXITCODE -eq 0) {
      Write-DeployLog "✅ Marketing service $serviceName: DEPLOYED"
      return $true
    } else {
      Write-DeployLog "❌ Marketing service $serviceName: FAILED"
      return $false
    }
  } catch {
    Write-DeployLog "❌ Marketing service $serviceName: $($_.Exception.Message)"
    return $false
  }
}

# Main deployment
try {
  Write-DeployLog "Starting Web Services and Marketing Deployment"
  Write-DeployLog "=============================================="
  
  $results = @{
    webServices = @{ deployed = 0; failed = 0 }
    marketingServices = @{ deployed = 0; failed = 0 }
  }
  
  # Deploy Web Services
  if (-not $SkipWebServices) {
    Write-DeployLog ""
    Write-DeployLog "🌐 DEPLOYING WEB SERVICES"
    Write-DeployLog "======================"
    
    $webServices = @(
      @{ name = "api-gateway"; description = "Central API gateway for all services"; endpoint = "/api/v1" },
      @{ name = "user-management"; description = "User authentication and management"; endpoint = "/api/v1/users" },
      @{ name = "payment-processing"; description = "Payment processing and billing"; endpoint = "/api/v1/payments" },
      @{ name = "notification-service"; description = "Email and push notifications"; endpoint = "/api/v1/notifications" },
      @{ name = "analytics-service"; description = "Usage analytics and reporting"; endpoint = "/api/v1/analytics" },
      @{ name = "file-storage"; description = "File upload and storage service"; endpoint = "/api/v1/files" },
      @{ name = "search-service"; description = "Full-text search functionality"; endpoint = "/api/v1/search" },
      @{ name = "cache-service"; description = "Redis-based caching service"; endpoint = "/api/v1/cache" }
    )
    
    foreach ($service in $webServices) {
      $success = Deploy-WebService $service.name $service.description $service.endpoint
      
      if ($success) {
        $results.webServices.deployed++
      } else {
        $results.webServices.failed++
      }
    }
  }
  
  # Deploy Marketing Services
  if (-not $SkipMarketing) {
    Write-DeployLog ""
    Write-DeployLog "📈 DEPLOYING MARKETING SERVICES"
    Write-DeployLog "============================="
    
    $marketingServices = @(
      @{ name = "marketing-automation"; description = "Automated marketing campaigns" },
      @{ name = "lead-generation"; description = "Lead capture and qualification" },
      @{ name = "content-management"; description = "Content creation and distribution" },
      @{ name = "email-marketing"; description = "Email campaign management" },
      @{ name = "social-media"; description = "Social media posting and monitoring" },
      @{ name = "customer-segments"; description = "Customer segmentation and targeting" },
      @{ name = "campaign-analytics"; description = "Marketing campaign performance" },
      @{ name = "brand-awareness"; description = "Brand awareness tracking" }
    )
    
    foreach ($service in $marketingServices) {
      $success = Deploy-MarketingService $service.name $service.description
      
      if ($success) {
        $results.marketingServices.deployed++
      } else {
        $results.marketingServices.failed++
      }
    }
  }
  
  # Summary
  Write-DeployLog ""
  Write-DeployLog "📊 DEPLOYMENT SUMMARY"
  Write-DeployLog "===================="
  
  if (-not $SkipWebServices) {
    Write-DeployLog "Web Services:"
    Write-DeployLog "  Deployed: $($results.webServices.deployed)"
    Write-DeployLog "  Failed: $($results.webServices.failed)"
  }
  
  if (-not $SkipMarketing) {
    Write-DeployLog "Marketing Services:"
    Write-DeployLog "  Deployed: $($results.marketingServices.deployed)"
    Write-DeployLog "  Failed: $($results.marketingServices.failed)"
  }
  
  $totalDeployed = $results.webServices.deployed + $results.marketingServices.deployed
  $totalFailed = $results.webServices.failed + $results.marketingServices.failed
  
  Write-DeployLog ""
  Write-DeployLog "Total Deployed: $totalDeployed"
  Write-DeployLog "Total Failed: $totalFailed"
  
  if ($DryRun) {
    Write-DeployLog ""
    Write-DeployLog "🎯 DRY RUN COMPLETE - Ready for deployment"
  } elseif ($totalFailed -eq 0) {
    Write-DeployLog ""
    Write-DeployLog "🎯 ALL SERVICES DEPLOYED SUCCESSFULLY"
  } else {
    Write-DeployLog ""
    Write-DeployLog "⚠️  PARTIAL DEPLOYMENT - Some services failed"
  }
  
} catch {
  Write-DeployLog "Deployment failed: $($_.Exception.Message)" "ERROR"
  exit 1
}

Write-DeployLog "Web Services and Marketing deployment process finished"
