# Heidi Startup Script (PowerShell)
# Proper way to start on Windows

$ErrorActionPreference = "Stop"

Write-Host "🧠 Starting HEIDI..." -ForegroundColor Cyan

# Check if Ollama is running
try {
    $ollamaCheck = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2
    Write-Host "✓ Ollama is running" -ForegroundColor Green
} catch {
    Write-Host "⚠ Ollama not running. Starting it..." -ForegroundColor Yellow
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    
    # Verify it started
    try {
        $ollamaCheck = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2
        Write-Host "✓ Ollama started" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to start Ollama" -ForegroundColor Red
        exit 1
    }
}

# Show available models
$models = $ollamaCheck.models | ForEach-Object { $_.name }
Write-Host "Available models: $($models -join ', ')" -ForegroundColor Gray

# Start HEIDI
Write-Host "Starting HEIDI server..." -ForegroundColor Cyan
node server.js
