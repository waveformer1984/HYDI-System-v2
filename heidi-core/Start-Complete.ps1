# Complete HEIDI Startup Sequence
# 1. Start Ollama
# 2. Start HEIDI on port 3458

Set-Location $PSScriptRoot

Write-Host "HEIDI Complete Startup" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan

# Step 1: Start Ollama
Write-Host "`nStep 1: Starting Ollama..." -ForegroundColor Yellow
.\Start-Ollama.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start Ollama" -ForegroundColor Red
    Write-Host "HEIDI will start but think calls will fail" -ForegroundColor Yellow
}

# Step 2: Start HEIDI
Write-Host "`nStep 2: Starting HEIDI..." -ForegroundColor Yellow

# Kill any existing processes on port 3458
$pids = netstat -ano | Select-String ":3458 " | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
if ($pids) {
    Write-Host "Cleaning up port 3458..." -ForegroundColor Gray
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# Check dependencies
if (-not (Test-Path ".\node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Start HEIDI
Write-Host "Starting HEIDI on port 3458..." -ForegroundColor Cyan
node index-clean-3458.js
