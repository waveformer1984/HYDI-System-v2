param(
  [string]$VercelEnv = "production",
  [string]$VerifyScript = ".\verify-secure.ps1",
  [switch]$SkipLocalEnvCheck
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host "❌ $msg" -ForegroundColor Red
  exit 1
}

function Info($msg) {
  Write-Host "ℹ️  $msg" -ForegroundColor Cyan
}

function Ok($msg) {
  Write-Host "✅ $msg" -ForegroundColor Green
}

# Required keys (keep aligned with verify-secure.ps1)
$requiredVercel = @(
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "KEEPER_BREAK_GLASS_TOKEN"
)

Write-Host "FIX DRIFT" -ForegroundColor Cyan
Write-Host "========="

# 1) Read current Vercel env list
Info "Reading Vercel env: $VercelEnv"
$vercelOutput = (vercel env ls $VercelEnv 2>&1 | Out-String)

if ([string]::IsNullOrWhiteSpace($vercelOutput)) {
  Fail "Could not read Vercel env list. Check Vercel CLI auth/project link."
}

# 2) Find missing keys
$missing = @()
foreach ($k in $requiredVercel) {
  if ($vercelOutput -match "(?m)^\s*$k\s+") {
    Ok "Present: $k"
  } else {
    $missing += $k
    Write-Host "❌ Missing: $k" -ForegroundColor Yellow
  }
}

if ($missing.Count -eq 0) {
  Ok "No Vercel drift detected."
} else {
  Write-Host ""
  Info "Starting interactive repair for missing keys..."
  
  foreach ($k in $missing) {
    Write-Host ""
    Write-Host "Adding $k to $VercelEnv..." -ForegroundColor Yellow
    
    # Interactive prompt for value and sensitivity is handled by Vercel CLI
    vercel env add $k $VercelEnv
    
    if ($LASTEXITCODE -ne 0) {
      Fail "Failed adding $k"
    }
    Ok "Added: $k"
  }
}

# 3) Optional pass to update existing keys interactively
Write-Host ""
$updateChoice = Read-Host "Do you want to interactively UPDATE any existing keys? (y/N)"

if ($updateChoice -match '^(y|yes)$') {
  while ($true) {
    $keyToUpdate = Read-Host "Enter key name to update (or press Enter to finish)"
    
    if ([string]::IsNullOrWhiteSpace($keyToUpdate)) { break }
    
    Write-Host "Updating $keyToUpdate in $VercelEnv..." -ForegroundColor Yellow
    vercel env update $keyToUpdate $VercelEnv
    
    if ($LASTEXITCODE -ne 0) {
      Write-Host "❌ Update failed for $keyToUpdate" -ForegroundColor Red
    } else {
      Ok "Updated: $keyToUpdate"
    }
  }
}

# 4) Re-run verify
Write-Host ""
Info "Re-running verification..."

if (-not (Test-Path $VerifyScript)) {
  Fail "Verify script not found: $VerifyScript"
}

if ($SkipLocalEnvCheck) {
  powershell -ExecutionPolicy Bypass -File $VerifyScript -VercelEnv $VercelEnv -SkipLocalEnvCheck
} else {
  powershell -ExecutionPolicy Bypass -File $VerifyScript -VercelEnv $VercelEnv
}

if ($LASTEXITCODE -ne 0) {
  Fail "Verification failed after attempted repair."
}

Ok "Drift fixed and verification passed."
exit 0
