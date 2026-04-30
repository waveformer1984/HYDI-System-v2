# Deploy All ProtoForge Functions to Supabase
# This script deploys all functions: payouts, transfers, and Stripe Connect admin

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ProtoForge Complete Function Deployment                   ║" -ForegroundColor Cyan
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

# Deploy all functions
Write-Host "📦 Deploying Payout Functions:" -ForegroundColor Cyan
Deploy-Function -FunctionName "monthly-payout-calculation" -Description "Calculates monthly payouts for all active clients"
Deploy-Function -FunctionName "stripe-transfer-payout" -Description "Initiates Stripe transfers for pending payouts"

Write-Host "📦 Deploying Stripe Connect Functions:" -ForegroundColor Cyan
Deploy-Function -FunctionName "stripe-connect-admin" -Description "Manages Stripe Connect accounts for clients"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Setting up Cron Jobs                                     ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Host "To schedule the monthly payout calculation to run on the 1st of each month:" -ForegroundColor Yellow
Write-Host "  supabase cron create monthly-payout-calc" -ForegroundColor Cyan
Write-Host "    --schedule '0 0 1 * *'" -ForegroundColor Cyan
Write-Host "    --function monthly-payout-calculation" -ForegroundColor Cyan
Write-Host ""

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Deployment Complete!                                       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📋 Available Functions:" -ForegroundColor White
Write-Host ""
Write-Host "1. monthly-payout-calculation" -ForegroundColor Yellow
Write-Host "   - Calculates monthly payouts automatically" -ForegroundColor Gray
Write-Host "   - Runs on cron schedule (1st of month)" -ForegroundColor Gray
Write-Host ""
Write-Host "2. stripe-transfer-payout" -ForegroundColor Yellow
Write-Host "   - Processes pending payouts via Stripe" -ForegroundColor Gray
Write-Host "   - Updates payout status to completed" -ForegroundColor Gray
Write-Host ""
Write-Host "3. stripe-connect-admin" -ForegroundColor Yellow
Write-Host "   - Manages client Connect accounts" -ForegroundColor Gray
Write-Host "   - Creates, updates, retrieves accounts" -ForegroundColor Gray
Write-Host ""

Write-Host "🚀 Next Steps:" -ForegroundColor White
Write-Host ""
Write-Host "1. Test the payout system:" -ForegroundColor Yellow
Write-Host "   node run-e2e-test.js" -ForegroundColor Gray
Write-Host ""
Write-Host "2. View client dashboard:" -ForegroundColor Yellow
Write-Host "   http://localhost:3000/client-dashboard" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Manage Stripe Connect accounts:" -ForegroundColor Yellow
Write-Host "   node stripe-connect-admin-client.js list" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Create a Connect account for a client:" -ForegroundColor Yellow
Write-Host "   node stripe-connect-admin-client.js create" -ForegroundColor Gray
Write-Host ""

Write-Host "📚 Function URLs:" -ForegroundColor White
Write-Host ""
Write-Host "• Monthly Payout: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/monthly-payout-calculation" -ForegroundColor Gray
Write-Host "• Stripe Transfer: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-transfer-payout" -ForegroundColor Gray
Write-Host "• Connect Admin: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin" -ForegroundColor Gray
Write-Host ""

Write-Host "🔐 Authentication:" -ForegroundColor White
Write-Host "All functions require Bearer token authentication with your SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Gray
