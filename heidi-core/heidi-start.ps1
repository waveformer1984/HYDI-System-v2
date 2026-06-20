# heidi-start.ps1 -- STARTUP ONLY (no cleanup, no port-killing).
# Ensures Ollama is up, installs deps if missing, then runs the HEIDI control
# plane in the foreground. Orchestrated by HEIDI.ps1; can also be run directly
# for a no-kill start. Does NOT kill anything -- that is heidi-clean.ps1's job.
param([switch]$SkipOllama)

Set-Location $PSScriptRoot

$PORT = 3458
$OLLAMA_URL = "http://127.0.0.1:11434"
$ollamaRunning = $false

# 1. Ensure Ollama (unless skipped)
if (-not $SkipOllama) {
    Write-Host "`nChecking Ollama..." -ForegroundColor Yellow
    try {
        Invoke-RestMethod -Uri "$OLLAMA_URL/api/tags" -TimeoutSec 3 | Out-Null
        $ollamaRunning = $true
        Write-Host "  Ollama is running" -ForegroundColor Green
    } catch {
        Write-Host "  Ollama not responding -- starting..." -ForegroundColor Yellow
        try { Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden } catch { Write-Host "  Failed to launch ollama" -ForegroundColor Red }
        # Allow up to ~15s for a cold post-reboot start (was ~5s).
        for ($i = 1; $i -le 15; $i++) {
            try { Invoke-RestMethod -Uri "$OLLAMA_URL/api/tags" -TimeoutSec 2 | Out-Null; $ollamaRunning = $true; break } catch { Start-Sleep -Seconds 1 }
        }
        Write-Host ("  Ollama " + $(if ($ollamaRunning) { "ready" } else { "did not come up (continuing offline)" })) -ForegroundColor $(if ($ollamaRunning) { "Green" } else { "Red" })
    }
} else {
    Write-Host "`nSkipping Ollama (as requested)" -ForegroundColor Yellow
}

# 2. Dependencies
if (-not (Test-Path ".\package.json")) { Write-Host "  ERROR: package.json not found" -ForegroundColor Red; exit 1 }
if (-not (Test-Path ".\node_modules")) {
    Write-Host "  Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "  npm install failed" -ForegroundColor Red; exit 1 }
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  Dependencies OK" -ForegroundColor Green
}

# 3. Entry point
$indexFile = ".\index-clean-3458.js"
if (-not (Test-Path $indexFile)) { Write-Host "  ERROR: $indexFile not found" -ForegroundColor Red; exit 1 }

# 4. Start (foreground -- blocks until HEIDI exits)
Write-Host "`nStarting HEIDI control plane..." -ForegroundColor Cyan
Write-Host "  Port: $PORT   Ollama: $(if ($ollamaRunning) { 'Connected' } else { 'Offline' })" -ForegroundColor Gray
node $indexFile
