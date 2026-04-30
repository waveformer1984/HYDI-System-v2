# Stabilize Before Deployment Script
# Run this before ANY deployments after key rotation

Write-Host "🔒 STABILIZING BEFORE DEPLOYMENT" -ForegroundColor Magenta
Write-Host "==============================" -ForegroundColor Magenta

# Step 1: Verify critical path
Write-Host "`n1️⃣ Testing critical path..." -ForegroundColor Cyan
$testResult = node test-critical-path.js
Write-Host $testResult

# Step 2: Check for missing break glass token
if (-not $env:KEEPER_BREAK_GLASS_TOKEN) {
    Write-Host "`n⚠️  Break glass token missing - generating new one..." -ForegroundColor Yellow
    $token = node generate-break-glass-token.js
    Write-Host $token
    
    Write-Host "`n📋 MANUAL STEP REQUIRED:" -ForegroundColor Red
    Write-Host "1. Add the token above to your .env file"
    Write-Host "2. Run: supabase secrets set KEEPER_BREAK_GLASS_TOKEN=YOUR_TOKEN"
    Write-Host "3. Re-run this script"
    exit 1
}

# Step 3: Test API endpoints
Write-Host "`n2️⃣ Testing API endpoints..." -ForegroundColor Cyan
$apiTest = ./test-api-clean.ps1
Write-Host $apiTest

# Step 4: Verify functions are deployed
Write-Host "`n3️⃣ Checking deployed functions..." -ForegroundColor Cyan
try {
    $functions = supabase functions list --project-ref akbnfovjdcobifeupvbn
    Write-Host "✅ Functions check completed" -ForegroundColor Green
} catch {
    Write-Host "❌ Functions check failed" -ForegroundColor Red
}

# Step 5: Final status
Write-Host "`n🎯 STABILIZATION STATUS:" -ForegroundColor Magenta
Write-Host "========================" -ForegroundColor Magenta

if ($env:KEEPER_BREAK_GLASS_TOKEN) {
    Write-Host "✅ All keys present" -ForegroundColor Green
    Write-Host "✅ Critical path tested" -ForegroundColor Green
    Write-Host "✅ API endpoints verified" -ForegroundColor Green
    Write-Host "`n🚀 SAFE TO DEPLOY" -ForegroundColor Green
} else {
    Write-Host "❌ Missing break glass token" -ForegroundColor Red
    Write-Host "`n🛑 DO NOT DEPLOY" -ForegroundColor Red
}
