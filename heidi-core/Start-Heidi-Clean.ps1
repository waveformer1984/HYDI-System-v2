Write-Host "Starting HEIDI..." -ForegroundColor Cyan

$ollamaRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
    $ollamaRunning = $true
    Write-Host "Ollama is running." -ForegroundColor Green
} catch {
    Write-Host "Ollama not detected. Start it first with: ollama serve" -ForegroundColor Yellow
}

$indexPath = ".\server.js"
if (-not (Test-Path $indexPath)) {
    Write-Host "ERROR: server.js not found in $(Get-Location)" -ForegroundColor Red
    exit 1
}

Write-Host "Launching HEIDI on port 3456..." -ForegroundColor Cyan
node $indexPath
