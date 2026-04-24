# FINAL VERIFICATION CURLS - Run after manual steps
Write-Output "=== FINAL VERIFICATION ==="

# Test 1 - hydi-monitor HTTP status
Write-Output "`n[1] hydi-monitor HTTP status:"
try {
    $response = Invoke-WebRequest -Uri "https://hydi-monitor.vercel.app" -UseBasicParsing
    Write-Output "HTTP Code: $($response.StatusCode)"
} catch {
    Write-Output "HTTP Code: $($_.Exception.Response.StatusCode.value__)"
}

# Test 2 - Checkout endpoint
Write-Output "`n[2] Stripe checkout endpoint:"
try {
    $checkoutResponse = Invoke-RestMethod -Uri "https://hydi-monitor.vercel.app/api/checkout" -Method POST -ContentType "application/json" -Body '{"tier":"pro","email":"j.arenstein@protoforgeindustries.com","company":"ProtoForge"}'
    Write-Output "Response: $($checkoutResponse | ConvertTo-Json -Compress)"
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}

# Test 3 - Ursula sync
Write-Output "`n[3] Ursula /api/hydi/sync:"
try {
    $ursulaResponse = Invoke-RestMethod -Uri "https://ursula-nine.vercel.app/api/hydi/sync"
    Write-Output "Response: $($ursulaResponse | ConvertTo-Json -Compress)"
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}

Write-Output "`n=== VERIFICATION COMPLETE ==="
