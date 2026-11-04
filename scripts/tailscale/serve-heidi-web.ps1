<#
.SYNOPSIS
    Expose heidi-web (Next.js :3000) to the tailnet at HTTPS :443 for /heidi phone chat.
    Idempotent — safe to re-run on heidi-pc.

.DESCRIPTION
    1. Probes http://127.0.0.1:3000/api/health
    2. If unhealthy, restarts PM2 app heidi-web-standalone (then hydi-boot if still down)
    3. Registers tailscale serve:443 -> http://127.0.0.1:3000
    4. Verifies MagicDNS URL /api/health and /heidi

    Does not enable Funnel. Does not change the :8470 MCP serve.

.PARAMETER Remove
    Turn off only the :443 serve mapping (other serves untouched).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\serve-heidi-web.ps1
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$LocalUrl  = 'http://127.0.0.1:3000'
$Health    = "$LocalUrl/api/health"
$HeidiPath = "$LocalUrl/heidi"

function Need($cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' not found on PATH." }
}

Need tailscale

if ($Remove) {
    & tailscale serve --https=443 off 2>$null
    Write-Host 'Turned off tailscale serve on :443 (8470 MCP and Funnel untouched).' -ForegroundColor Green
    exit 0
}

Set-Location $Root

function Test-LocalHeidiWeb {
    try {
        $r = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 8
        return @{ ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500); code = $r.StatusCode }
    } catch {
        return @{ ok = $false; code = 0; error = $_.Exception.Message }
    }
}

function Restart-HeidiWebIfNeeded {
    $probe = Test-LocalHeidiWeb
    if ($probe.ok) {
        Write-Host "Local heidi-web OK (HTTP $($probe.code))." -ForegroundColor Green
        return
    }
    Write-Host "Local heidi-web not healthy ($($probe.error)) — restarting PM2..." -ForegroundColor Yellow
    if (Get-Command pm2 -ErrorAction SilentlyContinue) {
        pm2 restart heidi-web-standalone 2>&1 | Out-Host
        Start-Sleep -Seconds 8
        $probe = Test-LocalHeidiWeb
        if ($probe.ok) {
            Write-Host "heidi-web-standalone recovered (HTTP $($probe.code))." -ForegroundColor Green
            return
        }
        Write-Host 'heidi-web-standalone still down — trying hydi-boot...' -ForegroundColor Yellow
        pm2 restart hydi-boot 2>&1 | Out-Host
        Start-Sleep -Seconds 20
        $probe = Test-LocalHeidiWeb
        if (-not $probe.ok) {
            throw "heidi-web still unreachable at $Health after PM2 restarts. Check: pm2 logs heidi-web-standalone --err"
        }
        Write-Host "heidi-web OK after hydi-boot (HTTP $($probe.code))." -ForegroundColor Green
    } else {
        throw "pm2 not on PATH and $Health failed — start heidi-web manually (npm run boot or pm2 start ecosystem.config.js)."
    }
}

Restart-HeidiWebIfNeeded

Write-Host 'Configuring tailscale serve 443 -> 127.0.0.1:3000 ...' -ForegroundColor Cyan
& tailscale serve --bg --https=443 http://127.0.0.1:3000
& tailscale serve status

$dns = (& tailscale status --json 2>$null | ConvertFrom-Json).Self.DNSName
if (-not $dns) { $dns = 'heidi-pc.tailc50af2.ts.net' }
$tailnetBase = "https://$($dns.TrimEnd('.'))"
$tailHealth = "$tailnetBase/api/health"
$tailHeidi  = "$tailnetBase/heidi"

Write-Host "`nTailnet URLs (open on phone with Tailscale connected):" -ForegroundColor Cyan
Write-Host "  Chat PWA: $tailHeidi"
Write-Host "  Dashboard: $tailnetBase/"

try {
    $tr = Invoke-WebRequest -Uri $tailHealth -UseBasicParsing -TimeoutSec 15
    Write-Host "Tailnet health check: HTTP $($tr.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Tailnet health check failed from this PC: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If local health OK but tailnet fails: check Tailscale admin DNS and phone MagicDNS.'
}

Write-Host "`nDone. Pair device at /heidi -> Ops if first visit." -ForegroundColor Green
