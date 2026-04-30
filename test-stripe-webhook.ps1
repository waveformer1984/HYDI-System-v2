# Stripe Webhook Test Script
$ErrorActionPreference = "Stop"

Write-Host "=== Stripe Webhook Verification ===" -ForegroundColor Cyan

# Check Vercel env vars
Write-Host "`n[1] Checking Vercel Environment Variables..." -ForegroundColor Yellow
try {
    $vercelVars = vercel env ls 2>&1 | Out-String
    
    if ($vercelVars -match "STRIPE_WEBHOOK_SECRET") {
        Write-Host "✓ STRIPE_WEBHOOK_SECRET found" -ForegroundColor Green
    } else {
        Write-Host "✗ STRIPE_WEBHOOK_SECRET NOT found" -ForegroundColor Red
    }

    if ($vercelVars -match "STRIPE_PUBLISHABLE_KEY") {
        Write-Host "✓ STRIPE_PUBLISHABLE_KEY found" -ForegroundColor Green
    } else {
        Write-Host "✗ STRIPE_PUBLISHABLE_KEY NOT found" -ForegroundColor Red
    }

    if ($vercelVars -match "STRIPE_SECRET_KEY") {
        Write-Host "✓ STRIPE_SECRET_KEY found" -ForegroundColor Green
    } else {
        Write-Host "✗ STRIPE_SECRET_KEY NOT found" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Could not check Vercel env vars. Run: vercel env ls" -ForegroundColor Yellow
}

# Check Supabase function
Write-Host "`n[2] Checking Supabase Edge Function..." -ForegroundColor Yellow
try {
    $functions = supabase functions list 2>&1 | Out-String
    
    if ($functions -match "stripe-webhook") {
        Write-Host "✓ stripe-webhook function deployed" -ForegroundColor Green
    } else {
        Write-Host "✗ stripe-webhook function NOT deployed" -ForegroundColor Red
        Write-Host "  Run: supabase functions deploy stripe-webhook" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Could not check functions. Run: supabase functions list" -ForegroundColor Yellow
}

# Test webhook endpoint
Write-Host "`n[3] Testing Webhook Endpoint..." -ForegroundColor Yellow

$payload = @{
    id = "evt_test_$(Get-Random)"
    type = "payment_intent.succeeded"
    data = @{
        object = @{
            id = "pi_test_$(Get-Random)"
            amount = 2000
            currency = "usd"
            status = "succeeded"
        }
    }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-WebRequest `
        -Uri "https://heidi-chat-portal.vercel.app/api/webhooks/stripe" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "stripe-signature" = "t=$(Get-Date -UFormat %s),v1=test_signature"
        } `
        -Body $payload `
        -ErrorAction Stop
    
    Write-Host "✓ Webhook endpoint responded" -ForegroundColor Green
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
    
    try {
        $content = $response.Content | ConvertFrom-Json
        Write-Host "  Response: $($content | ConvertTo-Json -Compress)" -ForegroundColor Gray
    } catch {
        Write-Host "  Response: $($response.Content)" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Webhook endpoint error" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
        Write-Host "  Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
        Write-Host "  Error body: $body" -ForegroundColor Yellow
    } else {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Check database
Write-Host "`n[4] Checking Database (run this in Supabase SQL Editor):" -ForegroundColor Yellow
Write-Host "```sql" -ForegroundColor Gray
Write-Host "SELECT event_id, type, status, processed, created_at" -ForegroundColor Gray
Write-Host "FROM public.webhook_events" -ForegroundColor Gray
Write-Host "ORDER BY created_at DESC" -ForegroundColor Gray
Write-Host "LIMIT 5;" -ForegroundColor Gray
Write-Host "```" -ForegroundColor Gray

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor White
Write-Host "1. If any ✗ above, fix those first" -ForegroundColor Gray
Write-Host "2. Send test event from Stripe Dashboard" -ForegroundColor Gray
Write-Host "3. Check Supabase logs: supabase functions logs stripe-webhook --tail" -ForegroundColor Gray
Write-Host "4. Query database to confirm row written" -ForegroundColor Gray
