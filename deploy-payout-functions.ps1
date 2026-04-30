# Deploy ProtoForge Payout Functions to Supabase
# This script deploys the monthly-payout-calculation and stripe-transfer-payout functions

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ProtoForge Payout Functions Deployment                    ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check if supabase CLI is installed
$supabaseVersion = supabase --version 2>$null
if (-not $supabaseVersion) {
    Write-Host "❌ Supabase CLI not found. Please install it first:" -ForegroundColor Red
    Write-Host "   npm install -g supabase" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Supabase CLI version: $supabaseVersion" -ForegroundColor Green
Write-Host ""

# Function to deploy a function
function Deploy-Function {
    param(
        [string]$FunctionName,
        [string]$Description
    )
    
    Write-Host "▶ Deploying $FunctionName..." -ForegroundColor Yellow
    Write-Host "  Description: $Description" -ForegroundColor Gray
    
    try {
        supabase functions deploy $FunctionName --project-ref akbnfovjdcobifeupvbn
        Write-Host "  ✓ $FunctionName deployed successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Failed to deploy $FunctionName" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# Deploy monthly-payout-calculation function
Deploy-Function -FunctionName "monthly-payout-calculation" -Description "Calculates monthly payouts for all active clients"

# Deploy stripe-transfer-payout function  
Deploy-Function -FunctionName "stripe-transfer-payout" -Description "Initiates Stripe transfers for pending payouts"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Setting up Monthly Cron Job                              ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Host "To schedule the monthly payout calculation to run on the 1st of each month:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  supabase cron create monthly-payout-calc \\" -ForegroundColor Cyan
Write-Host "    --schedule '0 0 1 * *' \\" -ForegroundColor Cyan
Write-Host "    --function monthly-payout-calculation" -ForegroundColor Cyan
Write-Host ""

Write-Host "Or manually trigger with:" -ForegroundColor Yellow
Write-Host "  curl -L -X POST 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/monthly-payout-calculation' \\" -ForegroundColor Cyan
Write-Host "    -H 'Authorization: Bearer <service-role-key>'" -ForegroundColor Cyan
Write-Host ""

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Deployment Complete!                                       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Run the test: node test-galactic-bytes-payout.js" -ForegroundColor Yellow
Write-Host "  2. Open client dashboard: http://localhost:3000/client-dashboard" -ForegroundColor Yellow
Write-Host "  3. Test Stripe transfer manually or wait for cron" -ForegroundColor Yellow
