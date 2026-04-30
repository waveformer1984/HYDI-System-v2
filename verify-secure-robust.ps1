param(
  [string]$VercelEnv = "production",
  [string]$LocalEnvFile = ".env",
  [string]$HealthCommand = "node test-critical-path.js",
  [switch]$SkipLocalEnvCheck
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host "❌ $msg" -ForegroundColor Red
  exit 1
}

function Ok($msg) {
  Write-Host "✅ $msg" -ForegroundColor Green
}

function Warn($msg) {
  Write-Host "⚠️  $msg" -ForegroundColor Yellow
}

Write-Host "SECURE VERIFY (ROBUST)" -ForegroundColor Cyan
Write-Host "======================"

# ---- Required keys (edit if needed) ----
$requiredVercel = @(
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", 
  "SUPABASE_ANON_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "KEEPER_BREAK_GLASS_TOKEN"
)

$requiredLocal = @(
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY", 
  "STRIPE_SECRET_KEY",
  "KEEPER_BREAK_GLASS_TOKEN"
)

# ---- 1) Vercel presence check with error handling ----
Write-Host "`n1) Checking Vercel env ($VercelEnv)..." -ForegroundColor Cyan

try {
  # Try multiple approaches to handle Vercel CLI encoding issues
  $vercelOutput = $null
  
  # Method 1: Direct call with error suppression
  try {
    $vercelOutput = (vercel env ls $VercelEnv 2>&1 | Out-String)
  } catch {
    Warn "Method 1 failed, trying alternative..."
  }
  
  # Method 2: CMD wrapper
  if ([string]::IsNullOrWhiteSpace($vercelOutput) -or $vercelOutput -match "NativeCommandError") {
    try {
      $vercelOutput = (cmd /c "vercel env ls $VercelEnv" 2>&1 | Out-String)
    } catch {
      Warn "Method 2 failed, trying PowerShell call..."
    }
  }
  
  # Method 3: PowerShell call operator
  if ([string]::IsNullOrWhiteSpace($vercelOutput) -or $vercelOutput -match "NativeCommandError") {
    try {
      $vercelOutput = (& vercel env ls $VercelEnv 2>&1 | Out-String)
    } catch {
      Warn "Method 3 failed"
    }
  }
  
  if ([string]::IsNullOrWhiteSpace($vercelOutput) -or $vercelOutput -match "NativeCommandError") {
    Fail "Could not read Vercel env list. Check Vercel CLI auth and project link."
  }
  
  # Parse output for required keys
  $missingVercel = @()
  foreach ($k in $requiredVercel) {
    if ($vercelOutput -match "(?m)^.*$k\s+.*") {
      Ok "Vercel: $k present"
    } else {
      $missingVercel += $k
      Write-Host "❌ Vercel: $k missing" -ForegroundColor Red
    }
  }
  
  if ($missingVercel.Count -gt 0) {
    Fail "Vercel drift detected. Missing: $($missingVercel -join ', ')"
  }
  
} catch {
  Fail "Vercel check failed: $($_.Exception.Message)"
}

# ---- 2) Local .env presence check (optional) ----
if (-not $SkipLocalEnvCheck) {
  Write-Host "`n2) Checking local env file ($LocalEnvFile)..." -ForegroundColor Cyan
  
  if (-not (Test-Path $LocalEnvFile)) {
    Fail "Local env file not found: $LocalEnvFile"
  }
  
  try {
    $localRaw = Get-Content $LocalEnvFile -Raw
    $missingLocal = @()
    
    foreach ($k in $requiredLocal) {
      if ($localRaw -match "(?m)^\s*$k\s*=\s*.+\s*$") {
        Ok "Local: $k present"
      } else {
        $missingLocal += $k
        Write-Host "❌ Local: $k missing/empty" -ForegroundColor Red
      }
    }
    
    if ($missingLocal.Count -gt 0) {
      Fail "Local env drift detected. Missing/empty: $($missingLocal -join ', ')"
    }
  } catch {
    Fail "Local env check failed: $($_.Exception.Message)"
  }
} else {
  Write-Host "`n2) Skipping local env check (-SkipLocalEnvCheck)." -ForegroundColor Yellow
}

# ---- 3) Health / critical path check ----
Write-Host "`n3) Running health check: $HealthCommand" -ForegroundColor Cyan

try {
  & node test-critical-path.js
  
  if ($LASTEXITCODE -ne 0) {
    Fail "Health command failed with exit code $LASTEXITCODE"
  }
  Ok "Health command passed"
} catch {
  Fail "Health check failed: $($_.Exception.Message)"
}

Write-Host "`n🎯 VERIFY STATUS: PASS (no drift detected)" -ForegroundColor Green
exit 0
