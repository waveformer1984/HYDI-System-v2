# HEIDI Robust Startup Script
# Handles port conflicts, checks Ollama, uses clean ASCII

Set-Location $PSScriptRoot

# Configuration
$PORT = 3458
$OLLAMA_URL = "http://127.0.0.1:11434"
$MAX_RETRIES = 3

Write-Host "HEIDI Robust Startup" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan

# 1. Kill any existing Node processes on target port
Write-Host "Checking for processes on port $PORT..." -ForegroundColor Yellow
$pids = netstat -ano | Select-String ":$PORT " | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
if ($pids) {
    Write-Host "Found processes: $pids" -ForegroundColor Yellow
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed PID $p" -ForegroundColor Green
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "Port $PORT is free" -ForegroundColor Green
}

# 2. Check Ollama
Write-Host "Checking Ollama..." -ForegroundColor Yellow
$ollamaOK = $false
for ($i = 1; $i -le $MAX_RETRIES; $i++) {
    try {
        $r = Invoke-RestMethod -Uri "$OLLAMA_URL/api/tags" -TimeoutSec 3
        $ollamaOK = $true
        Write-Host "Ollama responding" -ForegroundColor Green
        break
    } catch {
        Write-Host "Attempt $i/$MAX_RETRIES: Ollama not responding" -ForegroundColor Red
        if ($i -lt $MAX_RETRIES) {
            Write-Host "  Waiting 2 seconds..." -ForegroundColor Gray
            Start-Sleep -Seconds 2
        }
    }
}

if (-not $ollamaOK) {
    Write-Host "WARNING: Ollama not responding after $MAX_RETRIES attempts" -ForegroundColor Yellow
    Write-Host "HEIDI will start but think calls will fail" -ForegroundColor Yellow
    Write-Host "Start Ollama with: ollama serve" -ForegroundColor Gray
}

# 3. Check dependencies
if (-not (Test-Path ".\node_modules")) {
    Write-Host "node_modules missing - running install..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install failed" -ForegroundColor Red
        exit 1
    }
}

# 4. Start HEIDI
Write-Host "Starting HEIDI on port $PORT..." -ForegroundColor Cyan
$env:PORT = $PORT
$env:OLLAMA_URL = $OLLAMA_URL

# Use the 3458 version since we know it works
$indexFile = ".\index-clean-3458.js"
if (-not (Test-Path $indexFile)) {
    Write-Host "ERROR: $indexFile not found" -ForegroundColor Red
    exit 1
}

node $indexFile
