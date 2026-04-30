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

Write-Host "SECURE VERIFY" -ForegroundColor Cyan
Write-Host "============="

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

# ---- 1) Vercel presence check ----
Write-Host "`n1) Checking Vercel env ($VercelEnv)..." -ForegroundColor Cyan
$vercelOutput = (vercel env ls $VercelEnv 2>&1 | Out-String)

if ([string]::IsNullOrWhiteSpace($vercelOutput)) {
  Fail "Could not read Vercel env list. Is Vercel CLI authenticated and project linked?"
}

$missingVercel = @()
foreach ($k in $requiredVercel) {
  # Match a line starting with key name
  if ($vercelOutput -match "(?m)^\s*$k\s+") {
    Ok "Vercel: $k present"
  } else {
    $missingVercel += $k
    Write-Host "❌ Vercel: $k missing" -ForegroundColor Red
  }
}

if ($missingVercel.Count -gt 0) {
  Fail "Vercel drift detected. Missing: $($missingVercel -join ', ')"
}

# ---- 2) Local .env presence check (optional) ----
if (-not $SkipLocalEnvCheck) {
  Write-Host "`n2) Checking local env file ($LocalEnvFile)..." -ForegroundColor Cyan
  
  if (-not (Test-Path $LocalEnvFile)) {
    Fail "Local env file not found: $LocalEnvFile"
  }
  
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
} else {
  Write-Host "`n2) Skipping local env check (-SkipLocalEnvCheck)." -ForegroundColor Yellow
}

# ---- 3) Health / critical path check ----
Write-Host "`n3) Running health check: $HealthCommand" -ForegroundColor Cyan
cmd /c $HealthCommand

if ($LASTEXITCODE -ne 0) {
  Fail "Health command failed with exit code $LASTEXITCODE"
}
Ok "Health command passed"

Write-Host "`n🎯 VERIFY STATUS: PASS (no drift detected)" -ForegroundColor Green
exit 0
