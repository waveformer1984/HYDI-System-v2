# Simple test for tool-executor
Write-Host "🤖 Simple Tool-Executor Test" -ForegroundColor Blue
Write-Host "========================" -ForegroundColor Blue

# Test 1: Health check
Write-Host "Test 1: Health check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/tool-executor" -Method GET -Headers @{
        "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE"
    }
    Write-Host "✅ Health check passed: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Check for queued actions
Write-Host "Test 2: Check for queued actions..." -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/tool-executor" -Method POST -Headers @{
        "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE"
        "Content-Type" = "application/json"
    } -Body "{}"
    
    Write-Host "✅ Tool-executor response:" -ForegroundColor Green
    Write-Host "  - ok: $($result.ok)" -ForegroundColor Cyan
    Write-Host "  - processed: $($result.processed)" -ForegroundColor Cyan
    Write-Host "  - message: $($result.message)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Tool-executor failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "🎉 Simple test completed!" -ForegroundColor Green
