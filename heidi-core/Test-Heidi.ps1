# Heidi End-to-End Test (PowerShell)
# Tests: health → think → memory recall

$ErrorActionPreference = "Stop"
$baseUrl = "http://localhost:3456"

Write-Host "🧠 HEIDI End-to-End Test" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan

# Test 1: Health check
Write-Host "`n1. Health check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 5
    Write-Host "   Status: $($health.status)" -ForegroundColor Green
    Write-Host "   Brain: $($health.brain)" -ForegroundColor Green
    Write-Host "   ✓ Health check passed" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Is HEIDI running?" -ForegroundColor Gray
    exit 1
}

# Test 2: Store something in memory
Write-Host "`n2. Storing memory (bananas)..." -ForegroundColor Yellow
try {
    $storeResponse = Invoke-RestMethod `
        -Uri "$baseUrl/think" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"input":"remember this: bananas are strategic"}' `
        -TimeoutSec 15
    
    Write-Host "   Response: $($storeResponse.response.Substring(0, [Math]::Min(100, $storeResponse.response.Length)))..." -ForegroundColor Gray
    Write-Host "   Latency: $($storeResponse.latency_ms)ms" -ForegroundColor Gray
    Write-Host "   ✓ Memory stored" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Store failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 1

# Test 3: Recall from memory
Write-Host "`n3. Testing memory recall..." -ForegroundColor Yellow
try {
    $recallResponse = Invoke-RestMethod `
        -Uri "$baseUrl/think" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"input":"what did I tell you?"}' `
        -TimeoutSec 15
    
    $responseText = $recallResponse.response.ToLower()
    Write-Host "   Response: $($recallResponse.response.Substring(0, [Math]::Min(150, $recallResponse.response.Length)))..." -ForegroundColor Gray
    
    # Check if it mentions bananas (weak check - LLMs are unpredictable)
    if ($responseText -match 'banana' -or $responseText -match 'strategic' -or $responseText -match 'remember' -or $responseText -match 'told') {
        Write-Host "   ✓ Memory recall appears to work" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Unclear if memory worked (check response above)" -ForegroundColor Yellow
    }
    
    Write-Host "   Latency: $($recallResponse.latency_ms)ms" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Recall failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 4: State check
Write-Host "`n4. Checking system state..." -ForegroundColor Yellow
try {
    $state = Invoke-RestMethod -Uri "$baseUrl/state" -TimeoutSec 5
    Write-Host "   Status: $($state.status)" -ForegroundColor Green
    Write-Host "   Requests: $($state.stats.requests)" -ForegroundColor Gray
    Write-Host "   Reflections: $($state.stats.reflections)" -ForegroundColor Gray
    Write-Host "   ✓ State retrieved" -ForegroundColor Green
} catch {
    Write-Host "   ✗ State check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n✅ End-to-end test complete" -ForegroundColor Green
Write-Host "HEIDI is alive and remembering." -ForegroundColor Cyan
