# ============================================================================
# DEPRECATED / NOT USED BY INSTALLER.
# The canonical HEIDI launcher lives at:
#   C:\Users\Owner\HYDI-System-v2\heidi-core\HEIDI.ps1
# install-heidi-autostart.ps1 registers and runs THAT copy, not this one.
# This file is kept only for reference. Its all-node kill has been removed so it
# is no longer a footgun, but prefer the v2 copy for any real startup.
# ============================================================================

# HEIDI - Single Entry Point
# The ONLY way to start HEIDI. No variants, no mazes.

param(
    [switch]$SkipOllama,
    [switch]$KillFirst,
    [switch]$Server
)

Set-Location $PSScriptRoot

Write-Host "HEIDI Startup" -ForegroundColor Cyan
Write-Host "============" -ForegroundColor Cyan

# Configuration
$PORT = 3458
$OLLAMA_URL = "http://127.0.0.1:11434"

# 1. Kill existing processes (always do this to prevent port conflicts)
    
    # Kill HEIDI on port 3458
    try {
        $connections = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
        if ($connections) {
            $connections | ForEach-Object {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "  Killed process $($_.OwningProcess) on port $PORT" -ForegroundColor Green
            }
        } else {
            Write-Host "  No processes on port $PORT" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  No processes on port $PORT" -ForegroundColor Gray
    }

    # (Removed) machine-wide node kill -- see canonical v2 copy. Only port 3458
    # is ever touched here.

    Start-Sleep -Seconds 2

# 2. Ensure Ollama is running (unless skipped)
if (-not $SkipOllama) {
    Write-Host "`nChecking Ollama..." -ForegroundColor Yellow
    
    $ollamaRunning = $false
    try {
        $response = Invoke-RestMethod -Uri "$OLLAMA_URL/api/tags" -TimeoutSec 3
        $ollamaRunning = $true
        Write-Host "  Ollama is running" -ForegroundColor Green
    } catch {
        Write-Host "  Ollama not responding" -ForegroundColor Red
        Write-Host "  Starting Ollama..." -ForegroundColor Yellow
        
        try {
            Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
            Write-Host "  Ollama started" -ForegroundColor Green
            
            # Wait for startup
            for ($i = 1; $i -le 5; $i++) {
                try {
                    Invoke-RestMethod -Uri "$OLLAMA_URL/api/tags" -TimeoutSec 2 | Out-Null
                    Write-Host "  Ollama is ready" -ForegroundColor Green
                    $ollamaRunning = $true
                    break
                } catch {
                    Write-Host "  Waiting... ($i/5)" -ForegroundColor Gray
                    Start-Sleep -Seconds 1
                }
            }
            
            if (-not $ollamaRunning) {
                Write-Host "  Ollama failed to start" -ForegroundColor Red
            }
        } catch {
            Write-Host "  Failed to start Ollama" -ForegroundColor Red
        }
    }
} else {
    Write-Host "`nSkipping Ollama (as requested)" -ForegroundColor Yellow
}

# 3. Check dependencies
Write-Host "`nChecking dependencies..." -ForegroundColor Yellow

if (-not (Test-Path ".\package.json")) {
    Write-Host "  ERROR: package.json not found" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".\node_modules")) {
    Write-Host "  Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  Dependencies OK" -ForegroundColor Green
}

# 4. Check for index file
$agentFile = ".\heidi-agent.js"
$indexFile = ".\index-clean-3458.js"

if ($Server) {
    $toRun = $indexFile
} else {
    $toRun = if (Test-Path $agentFile) { $agentFile } else { $indexFile }
}

if (-not (Test-Path $toRun)) {
    Write-Host "  ERROR: Neither $agentFile nor $indexFile found" -ForegroundColor Red
    exit 1
}

# 5. Set environment variables for Supabase (load from .env.local or use defaults)
Write-Host "`nConfiguring environment..." -ForegroundColor Yellow

# Load from .env.local if it exists
$envLocalPath = Join-Path $PSScriptRoot "..\.env.local"
if (Test-Path $envLocalPath) {
    Write-Host "  Loading from .env.local..." -ForegroundColor Gray
    Get-Content $envLocalPath | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove quotes if present
            if ($value -match '^"(.*)"$') { $value = $matches[1] }
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

if ([string]::IsNullOrEmpty($env:SUPABASE_URL) -or $env:SUPABASE_URL -eq "True") {
    $env:SUPABASE_URL = "http://127.0.0.1:54321"
}
# NOTE: Load SUPABASE_SERVICE_ROLE_KEY from .env.local or environment
if ([string]::IsNullOrEmpty($env:SUPABASE_SERVICE_ROLE_KEY) -or $env:SUPABASE_SERVICE_ROLE_KEY -eq "True") {
    Write-Host "  ⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Load from .env.local or environment." -ForegroundColor Yellow
    $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"
}
Write-Host "  Supabase: $($env:SUPABASE_URL)" -ForegroundColor Green

# 6. Start HEIDI
Write-Host "`nStarting HEIDI..." -ForegroundColor Cyan
Write-Host "  Port: $PORT" -ForegroundColor Gray
Write-Host "  Ollama: $(if ($ollamaRunning) { 'Connected' } else { 'Offline' })" -ForegroundColor Gray
Write-Host "  Advisory Mode: $($env:HEIDI_ADVISORY_MODE -eq 'true')" -ForegroundColor Gray
Write-Host "  Agent: $(Split-Path $toRun -Leaf)" -ForegroundColor Gray

try {
    node $toRun
} catch {
    Write-Host "  Failed to start HEIDI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
