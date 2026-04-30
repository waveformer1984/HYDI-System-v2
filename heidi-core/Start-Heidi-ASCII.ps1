Set-Location $PSScriptRoot

Write-Host "Checking Ollama..." -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
    Write-Host "Ollama OK" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Ollama not responding. Start it with: ollama serve" -ForegroundColor Yellow
}

if (-not (Test-Path ".\node_modules")) {
    Write-Host "node_modules missing - running install..." -ForegroundColor Yellow
    npm install
}

Write-Host "Starting HEIDI on port 3456..." -ForegroundColor Cyan
node index-clean.js
