# Clean API testing script
# No command fusion, just proper testing

# Test stripe-connect-admin function
Write-Host "`nTESTING STRIPE CONNECT ADMIN" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan

$headers = @{
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
}

$body = '{"action": "list"}'

try {
    $response = Invoke-WebRequest -Uri "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -UseBasicParsing

    Write-Host "API Response: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Content: $($response.Content)" -ForegroundColor White
}
catch {
    Write-Host "API Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow
    }
}

Write-Host "`nTest complete!" -ForegroundColor Magenta
