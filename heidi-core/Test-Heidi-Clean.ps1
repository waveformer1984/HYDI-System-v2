Write-Host "Testing HEIDI..." -ForegroundColor Cyan

# Health check
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3456/health" -TimeoutSec 5
    Write-Host "Health OK: $($health | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "FAILED health check: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Think test
try {
    $body = '{"input": "Hello Heidi"}' 
    $think = Invoke-RestMethod `
        -Uri "http://localhost:3456/think" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 30
    Write-Host "Think response: $($think | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "FAILED think test: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "HEIDI is alive and responding." -ForegroundColor Cyan
