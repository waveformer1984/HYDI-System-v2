# Start Ollama in background
# Use this before starting HEIDI

Write-Host "Starting Ollama in background..." -ForegroundColor Cyan

# Check if already running
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
    Write-Host "Ollama already running" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Starting Ollama serve..." -ForegroundColor Yellow
}

# Start in background
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden

# Wait for startup
Write-Host "Waiting for Ollama to respond..." -ForegroundColor Gray
for ($i = 1; $i -le 10; $i++) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
        Write-Host "Ollama is ready" -ForegroundColor Green
        exit 0
    } catch {
        Write-Host "  Attempt $i/10..." -ForegroundColor Gray
        Start-Sleep -Seconds 1
    }
}

Write-Host "Ollama failed to start within 10 seconds" -ForegroundColor Red
exit 1
