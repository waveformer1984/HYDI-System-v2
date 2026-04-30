# Deploy All ProtoForge Functions to Supabase

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ProtoForge Function Deployment                             ║" -ForegroundColor Cyan
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

# Deploy monthly-payout-calculation
Write-Host "▶ Deploying monthly-payout-calculation..." -ForegroundColor Yellow
Write-Host "  Description: Calculates monthly payouts for all active clients" -ForegroundColor Gray
try {
    supabase functions deploy monthly-payout-calculation --project-ref akbnfovjdcobifeupvbn
    Write-Host "  ✓ monthly-payout-calculation deployed successfully" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Failed to deploy monthly-payout-calculation" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
}
Write-Host ""

# Deploy stripe-transfer-payout
Write-Host "▶ Deploying stripe-transfer-payout..." -ForegroundColor Yellow
Write-Host "  Description: Initiates Stripe transfers for pending payouts" -ForegroundColor Gray
try {
    supabase functions deploy stripe-transfer-payout --project-ref akbnfovjdcobifeupvbn
    Write-Host "  ✓ stripe-transfer-payout deployed successfully" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Failed to deploy stripe-transfer-payout" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
}
Write-Host ""

# Deploy stripe-connect-admin
Write-Host "▶ Deploying stripe-connect-admin..." -ForegroundColor Yellow
Write-Host "  Description: Manages Stripe Connect accounts for clients" -ForegroundColor Gray
try {
    supabase functions deploy stripe-connect-admin --project-ref akbnfovjdcobifeupvbn
    Write-Host "  ✓ stripe-connect-admin deployed successfully" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Failed to deploy stripe-connect-admin" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Deployment Complete!                                       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📚 Function URLs:" -ForegroundColor White
Write-Host ""
Write-Host "• Monthly Payout: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/monthly-payout-calculation" -ForegroundColor Gray
Write-Host "• Stripe Transfer: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-transfer-payout" -ForegroundColor Gray
Write-Host "• Connect Admin: https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin" -ForegroundColor Gray
Write-Host ""

Write-Host "🔐 Authentication:" -ForegroundColor White
Write-Host "All functions require Bearer token authentication with your SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Gray
