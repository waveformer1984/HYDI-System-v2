<#
.SYNOPSIS
    Run the recommended phone-access diagnostic order on heidi-pc (read-only + fix serve/web).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1 -Fix
#>
[CmdletBinding()]
param([switch]$Fix)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host '=== 1) Local heidi-web health ===' -ForegroundColor Cyan
try {
    $code = (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 8).StatusCode
    Write-Host "  http://127.0.0.1:3000/api/health -> $code"
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host '=== 2) PM2 ===' -ForegroundColor Cyan
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    pm2 jlist 2>$null | ConvertFrom-Json | ForEach-Object {
        $_.name + ' -> ' + $_.pm2_env.status
    } | Select-Object -First 25
} else {
    Write-Host '  pm2 not on PATH'
}

Write-Host '=== 3) tailscale serve status ===' -ForegroundColor Cyan
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    & tailscale serve status
    & tailscale status --peers=false 2>$null
} else {
    Write-Host '  tailscale not on PATH' -ForegroundColor Red
}

Write-Host '=== 4) Tailnet MCP healthz (8470) ===' -ForegroundColor Cyan
try {
    $hz = Invoke-WebRequest -Uri 'https://heidi-pc.tailc50af2.ts.net:8470/healthz' -UseBasicParsing -TimeoutSec 10
    Write-Host "  :8470/healthz -> $($hz.StatusCode)"
} catch {
    Write-Host "  :8470/healthz FAIL (MCP serve optional): $($_.Exception.Message)"
}

Write-Host '=== 5) Legacy :3006 mobile chat ===' -ForegroundColor Cyan
try {
    $m = Invoke-WebRequest -Uri 'http://127.0.0.1:3006/api/health' -UseBasicParsing -TimeoutSec 5
    Write-Host "  :3006/api/health -> $($m.StatusCode) (not on default 443 serve; use /heidi on 443)"
} catch {
    Write-Host "  :3006 not up (OK if using /heidi only)"
}

if ($Fix) {
    Write-Host '=== FIX: serve-heidi-web.ps1 ===' -ForegroundColor Yellow
    & "$PSScriptRoot\serve-heidi-web.ps1"
}

Write-Host "`nPhone: connect Tailscale, then open https://heidi-pc.tailc50af2.ts.net/heidi" -ForegroundColor Cyan
Write-Host 'If HTTPS fails, try http://<100.x.x.x>:3000/heidi (Tailscale IP from app) to isolate Serve vs web.' -ForegroundColor Cyan
